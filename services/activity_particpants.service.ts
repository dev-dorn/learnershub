import { z } from "zod"

import { logger } from "@/lib/logger"

import { Database } from "@/types/supabase"
import {
  ActivityParticipantsRepository,
  ListParticipantsOptions,
  PaginatedParticipants,
} from "@/dal /activity_participants.repository"
import {
  ConflictError,
  DALError,
  NotFoundError,
  ValidationError,
} from "@/dal /errors"
import { requireRole } from "@/lib/rbac"

type ParticipantRow =
  Database["public"]["Tables"]["activity_participants"]["Row"]

// ── Schemas ───────────────────────────────────────────────────────────
// Split by operation domain — prevents assessment fields leaking
// into enrollment writes and vice versa

const EnrollSchema = z.object({
  activity_id: z.string().uuid(),
  student_id: z.string().uuid(),
  role: z.string().max(100).nullable().optional(),
  joined_at: z.string().nullable().optional(),
})

const AssessSchema = z.object({
  competency_rating: z.number().min(1).max(5),
  teacher_feedback: z.string().max(1000).nullable().optional(),
  peer_feedback: z.string().max(1000).nullable().optional(),
  skills_demonstrated: z
    .array(z.string().max(50))
    .max(100)
    .nullable()
    .optional(),
  evidence_urls: z.array(z.string().url()).max(50).nullable().optional(),
  position_awarded: z.string().max(100).nullable().optional(),
})

const EvidenceSchema = z.object({
  urls: z.array(z.string().url()).min(1).max(50),
})

const SkillsSchema = z.object({
  skills: z.array(z.string().max(50)).min(1).max(100),
})

const CertificateSchema = z.object({
  certificateUrl: z.string().url(),
})

export type EnrollInput = z.infer<typeof EnrollSchema>
export type AssessInput = z.infer<typeof AssessSchema>

// ── Context ───────────────────────────────────────────────────────────

export interface ParticipantContext {
  schoolId: string // from auth session — never from client
  userId: string // from auth session — never from client
  role: string // from auth session — never from client
}

// ── Result types ──────────────────────────────────────────────────────

export interface ActivitySummary {
  activityId: string
  total: number
  enrolled: number
  waitlisted: number
  withdrawn: number
  completed: number
  absent: number
  avgCompetencyRating: number | null
}

export interface BulkEnrollResult {
  enrolled: ParticipantRow[]
  skipped: string[] // studentIds already enrolled — ignoreDuplicates: true
}

// ── Constants ─────────────────────────────────────────────────────────

// Centralized role sets — update here, applies everywhere
// TODO: move to src/lib/rbac.ts once more services adopt this pattern
const WRITE_ROLES = ["teacher", "admin", "principal"] as const
const ASSESS_ROLES = ["teacher", "admin", "principal"] as const
const CERTIFICATE_ROLES = ["admin", "principal"] as const // stricter
const MAX_BULK = 200

// Valid re-enrollment transitions — completed students cannot be silently re-enrolled
const RE_ENROLLABLE_STATUSES = new Set(["withdrawn", "waitlisted"])

// ── Service ───────────────────────────────────────────────────────────

export class ActivityParticipantsService {
  constructor(private repo: ActivityParticipantsRepository) {}

  // ── Read ──────────────────────────────────────────────────────────

  async getById(
    id: string,
    context: ParticipantContext
  ): Promise<ParticipantRow | null> {
    return this.repo.getById(id, context.schoolId)
  }

  async getByStudentAndActivity(
    studentId: string,
    activityId: string,
    context: ParticipantContext
  ): Promise<ParticipantRow | null> {
    return this.repo.getByStudentAndActivity(
      studentId,
      activityId,
      context.schoolId
    )
  }

  async list(
    options: ListParticipantsOptions,
    context: ParticipantContext
  ): Promise<PaginatedParticipants> {
    return this.repo.list(options, context.schoolId)
  }

  async getStudentActivities(
    studentId: string,
    context: ParticipantContext,
    status?: string
  ): Promise<ParticipantRow[]> {
    return this.repo.getStudentActivities(studentId, context.schoolId, status)
  }

  // Aggregated in JS — move to DB RPC when activity enrollment counts grow large
  async getActivitySummary(
    activityId: string,
    context: ParticipantContext
  ): Promise<ActivitySummary> {
    const rows = await this.repo.getActivityParticipantRows(
      activityId,
      context.schoolId
    )

    const rated = rows.filter((r) => r.competency_rating !== null)
    const avgRating =
      rated.length > 0
        ? rated.reduce((sum, r) => sum + (r.competency_rating ?? 0), 0) /
          rated.length
        : null

    return {
      activityId,
      total: rows.length,
      enrolled: rows.filter((r) => r.enrollment_status === "enrolled").length,
      waitlisted: rows.filter((r) => r.enrollment_status === "waitlisted")
        .length,
      withdrawn: rows.filter((r) => r.enrollment_status === "withdrawn").length,
      completed: rows.filter((r) => r.enrollment_status === "completed").length,
      absent: rows.filter((r) => r.enrollment_status === "absent").length,
      avgCompetencyRating:
        avgRating !== null ? Math.round(avgRating * 100) / 100 : null,
    }
  }

  // ── Write ─────────────────────────────────────────────────────────

  async create(
    input: unknown,
    context: ParticipantContext
  ): Promise<ParticipantRow> {
    requireRole(context.role, WRITE_ROLES, "create participants")

    const parsed = EnrollSchema.safeParse(input)
    if (!parsed.success)
      throw new ValidationError(
        parsed.error.issues
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")
      )

    return this.repo.create({
      ...parsed.data,
      school_id: context.schoolId, // ← always from session
      enrolled_by: context.userId, // ← always from session
      enrollment_status: "enrolled",
      joined_at: new Date().toISOString(),
    })
  }

  async delete(id: string, context: ParticipantContext): Promise<void> {
    requireRole(context.role, WRITE_ROLES, "delete participants")
    return this.repo.delete(id, context.schoolId)
  }

  // ── Enrollment transitions ────────────────────────────────────────

  async enroll(
    activityId: string,
    studentId: string,
    context: ParticipantContext
  ): Promise<ParticipantRow> {
    requireRole(context.role, WRITE_ROLES, "enroll participants")
    logger.info("activity_participants", "enroll", { activityId, studentId })

    const existing = await this.repo.getByStudentAndActivity(
      studentId,
      activityId,
      context.schoolId
    )

    if (existing) {
      if (existing.enrollment_status === "enrolled")
        throw new ConflictError("ActivityParticipant", "student and activity")

      // Enforce state machine — only specific statuses allow re-enrollment
      if (!RE_ENROLLABLE_STATUSES.has(existing.enrollment_status ?? ""))
        throw new DALError(
          "CONFLICT",
          `Cannot re-enroll from status: ${existing.enrollment_status}`
        )

      return this.repo.updateEnrollment(
        existing.id,
        {
          enrollment_status: "enrolled",
          enrolled_by: context.userId, // ← always from session
          joined_at: new Date().toISOString(),
        },
        context.schoolId
      )
    }

    return this.repo.create({
      activity_id: activityId,
      student_id: studentId,
      school_id: context.schoolId, // ← always from session
      enrolled_by: context.userId, // ← always from session
      enrollment_status: "enrolled",
      joined_at: new Date().toISOString(),
    })
  }

  async waitlist(
    id: string,
    context: ParticipantContext
  ): Promise<ParticipantRow> {
    requireRole(context.role, WRITE_ROLES, "waitlist participants")
    return this.repo.updateEnrollment(
      id,
      { enrollment_status: "waitlisted" },
      context.schoolId
    )
  }

  async withdraw(
    id: string,
    context: ParticipantContext
  ): Promise<ParticipantRow> {
    requireRole(context.role, WRITE_ROLES, "withdraw participants")
    return this.repo.updateEnrollment(
      id,
      { enrollment_status: "withdrawn" },
      context.schoolId
    )
  }

  async markCompleted(
    id: string,
    context: ParticipantContext
  ): Promise<ParticipantRow> {
    requireRole(context.role, WRITE_ROLES, "complete participants")
    return this.repo.updateEnrollment(
      id,
      { enrollment_status: "completed" },
      context.schoolId
    )
  }

  async markAbsent(
    id: string,
    context: ParticipantContext
  ): Promise<ParticipantRow> {
    requireRole(context.role, WRITE_ROLES, "mark participants absent")
    return this.repo.updateEnrollment(
      id,
      { enrollment_status: "absent" },
      context.schoolId
    )
  }

  // ── Assessment ────────────────────────────────────────────────────

  async assess(
    id: string,
    input: unknown,
    context: ParticipantContext
  ): Promise<ParticipantRow> {
    requireRole(context.role, ASSESS_ROLES, "assess participants")

    const parsed = AssessSchema.safeParse(input)
    if (!parsed.success)
      throw new ValidationError(
        parsed.error.issues
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")
      )

    return this.repo.updateAssessment(
      id,
      {
        ...parsed.data,
        assessed_by: context.userId, // ← always from session, never from client
        assessed_at: new Date().toISOString(),
      },
      context.schoolId
    )
  }

  async addPeerFeedback(
    id: string,
    feedback: string,
    context: ParticipantContext
  ): Promise<ParticipantRow> {
    requireRole(context.role, WRITE_ROLES, "add peer feedback")

    if (!feedback || feedback.length > 1000)
      throw new ValidationError(
        "peer_feedback: must be between 1 and 1000 characters"
      )

    return this.repo.updateAssessment(
      id,
      {
        assessed_by: context.userId,
        assessed_at: new Date().toISOString(),
        competency_rating: 0, // required by type — use assess() for rated feedback
        peer_feedback: feedback,
      },
      context.schoolId
    )
  }

  async awardPosition(
    id: string,
    position: string,
    context: ParticipantContext
  ): Promise<ParticipantRow> {
    requireRole(context.role, ASSESS_ROLES, "award positions")

    if (!position || position.length > 100)
      throw new ValidationError(
        "position_awarded: must be between 1 and 100 characters"
      )

    return this.repo.updateAssessment(
      id,
      {
        assessed_by: context.userId,
        assessed_at: new Date().toISOString(),
        competency_rating: 0,
        position_awarded: position,
      },
      context.schoolId
    )
  }

  // ── Certificate ───────────────────────────────────────────────────

  async issueCertificate(
    id: string,
    input: unknown,
    context: ParticipantContext
  ): Promise<ParticipantRow> {
    requireRole(context.role, CERTIFICATE_ROLES, "issue certificates") // admin/principal only

    const parsed = CertificateSchema.safeParse(input)
    if (!parsed.success)
      throw new ValidationError(
        parsed.error.issues
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")
      )

    logger.info("activity_participants", "issueCertificate", {
      id,
      issuedBy: context.userId, // audit trail in logs until DB audit table exists
    })

    return this.repo.updateCertificate(
      id,
      {
        certificate_issued: true,
        certificate_url: parsed.data.certificateUrl,
      },
      context.schoolId
    )
  }

  async revokeCertificate(
    id: string,
    context: ParticipantContext
  ): Promise<ParticipantRow> {
    requireRole(context.role, CERTIFICATE_ROLES, "revoke certificates") // admin/principal only

    logger.info("activity_participants", "revokeCertificate", {
      id,
      revokedBy: context.userId, // audit trail in logs until DB audit table exists
    })

    return this.repo.updateCertificate(
      id,
      {
        certificate_issued: false,
        certificate_url: null,
      },
      context.schoolId
    )
  }

  // ── Evidence & skills ─────────────────────────────────────────────
  // Read-modify-write — susceptible to concurrent update loss.
  // TODO: replace with Postgres array append RPC when concurrency becomes an issue.

  async addEvidence(
    id: string,
    input: unknown,
    context: ParticipantContext
  ): Promise<ParticipantRow> {
    requireRole(context.role, WRITE_ROLES, "add evidence")

    const parsed = EvidenceSchema.safeParse(input)
    if (!parsed.success)
      throw new ValidationError(
        parsed.error.issues
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")
      )

    const existing = await this.repo.getById(id, context.schoolId)
    if (!existing) throw new NotFoundError("ActivityParticipant", id)

    const merged = [
      ...new Set([...(existing.evidence_urls ?? []), ...parsed.data.urls]),
    ]
    if (merged.length > 50)
      throw new ValidationError("evidence_urls: max 50 URLs per participant")

    return this.repo.updateArrayFields(
      id,
      { evidence_urls: merged },
      context.schoolId
    )
  }

  async removeEvidence(
    id: string,
    input: unknown,
    context: ParticipantContext
  ): Promise<ParticipantRow> {
    requireRole(context.role, WRITE_ROLES, "remove evidence")

    const parsed = EvidenceSchema.safeParse(input)
    if (!parsed.success)
      throw new ValidationError(
        parsed.error.issues
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")
      )

    const existing = await this.repo.getById(id, context.schoolId)
    if (!existing) throw new NotFoundError("ActivityParticipant", id)

    const filtered = (existing.evidence_urls ?? []).filter(
      (u) => !parsed.data.urls.includes(u)
    )
    return this.repo.updateArrayFields(
      id,
      { evidence_urls: filtered },
      context.schoolId
    )
  }

  async addSkillsDemonstrated(
    id: string,
    input: unknown,
    context: ParticipantContext
  ): Promise<ParticipantRow> {
    requireRole(context.role, WRITE_ROLES, "add skills")

    const parsed = SkillsSchema.safeParse(input)
    if (!parsed.success)
      throw new ValidationError(
        parsed.error.issues
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")
      )

    const existing = await this.repo.getById(id, context.schoolId)
    if (!existing) throw new NotFoundError("ActivityParticipant", id)

    const merged = [
      ...new Set([
        ...(existing.skills_demonstrated ?? []),
        ...parsed.data.skills,
      ]),
    ]
    if (merged.length > 100)
      throw new ValidationError(
        "skills_demonstrated: max 100 skills per participant"
      )

    return this.repo.updateArrayFields(
      id,
      { skills_demonstrated: merged },
      context.schoolId
    )
  }

  async removeSkillsDemonstrated(
    id: string,
    input: unknown,
    context: ParticipantContext
  ): Promise<ParticipantRow> {
    requireRole(context.role, WRITE_ROLES, "remove skills")

    const parsed = SkillsSchema.safeParse(input)
    if (!parsed.success)
      throw new ValidationError(
        parsed.error.issues
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")
      )

    const existing = await this.repo.getById(id, context.schoolId)
    if (!existing) throw new NotFoundError("ActivityParticipant", id)

    const filtered = (existing.skills_demonstrated ?? []).filter(
      (s) => !parsed.data.skills.includes(s)
    )
    return this.repo.updateArrayFields(
      id,
      { skills_demonstrated: filtered },
      context.schoolId
    )
  }

  // ── Bulk operations ───────────────────────────────────────────────

  async bulkEnroll(
    activityId: string,
    studentIds: string[],
    context: ParticipantContext
  ): Promise<BulkEnrollResult> {
    requireRole(context.role, WRITE_ROLES, "bulk enroll participants")

    if (studentIds.length === 0)
      throw new ValidationError("bulkEnroll: studentIds must not be empty")

    if (studentIds.length > MAX_BULK)
      throw new ValidationError(`bulkEnroll: max ${MAX_BULK} students per call`)

    logger.info("activity_participants", "bulkEnroll", {
      activityId,
      count: studentIds.length,
      enrolledBy: context.userId,
    })

    const records = studentIds.map((studentId) => ({
      activity_id: activityId,
      student_id: studentId,
      school_id: context.schoolId, // ← always from session
      enrolled_by: context.userId, // ← always from session
      enrollment_status: "enrolled" as const,
      joined_at: new Date().toISOString(),
    }))

    const enrolled = await this.repo.bulkEnroll(records)

    // Identify skipped students — those not returned due to ignoreDuplicates: true
    const enrolledIds = new Set(enrolled.map((r) => r.student_id))
    const skipped = studentIds.filter((id) => !enrolledIds.has(id))

    return { enrolled, skipped }
  }

  async bulkComplete(
    activityId: string,
    context: ParticipantContext
  ): Promise<void> {
    requireRole(context.role, WRITE_ROLES, "bulk complete participants")
    return this.repo.bulkUpdateStatus(
      activityId,
      context.schoolId,
      "enrolled",
      "completed"
    )
  }
}
