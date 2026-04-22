import { SupabaseClient, PostgrestError } from "@supabase/supabase-js"
import { Database } from "@/types/supabase"
import {
  DALError,
  NotFoundError,
  ConflictError,
  DatabaseError,
} from "./errors"
import { logger } from "@/lib/logger"

// ── Types ─────────────────────────────────────────────────────────────

type ParticipantRow = Database["public"]["Tables"]["activity_participants"]["Row"]
type ParticipantInsert = Database["public"]["Tables"]["activity_participants"]["Insert"]

// ── Internal input types ──────────────────────────────────────────────

// Enrollment — only fields valid at creation time
export interface InternalEnrollInput {
  activity_id: string
  student_id: string
  school_id: string               // always from session
  enrolled_by: string             // always from session
  enrollment_status: "enrolled" | "waitlisted" | "withdrawn" | "completed" | "absent"
  joined_at: string
  role?: string | null
}

// Narrow update types per operation domain
// Prevents cross-domain field injection at the type level

export interface InternalEnrollmentUpdate {
  enrollment_status?: "enrolled" | "waitlisted" | "withdrawn" | "completed" | "absent"
  enrolled_by?: string
  joined_at?: string
  role?: string | null
}

export interface InternalAssessmentUpdate {
  assessed_by: string             // always from session, never optional
  assessed_at: string
  competency_rating: number
  teacher_feedback?: string | null
  peer_feedback?: string | null
  skills_demonstrated?: string[] | null
  evidence_urls?: string[] | null
  position_awarded?: string | null
}

export interface InternalCertificateUpdate {
  certificate_issued: boolean
  certificate_url: string | null
}

// Array-only updates — used by evidence/skills patch methods
export interface InternalArrayUpdate {
  evidence_urls?: string[] | null
  skills_demonstrated?: string[] | null
}

// ── List options ──────────────────────────────────────────────────────

// schoolId is intentionally excluded — always passed as a mandatory
// separate param from session context. NEVER add schoolId here.
export interface ListParticipantsOptions {
  activityId?: string
  studentId?: string
  enrollmentStatus?: string
  role?: string
  certificateIssued?: boolean
  assessedBy?: string
  limit?: number
  offset?: number
}

// ── Result types ──────────────────────────────────────────────────────

export interface PaginatedParticipants {
  data: ParticipantRow[]
  count: number
  hasMore: boolean
}

export interface ActivitySummaryRow {
  enrollment_status: string | null
  competency_rating: number | null
}

// ── Constants ─────────────────────────────────────────────────────────

const SAFE_COLS = [
  "id",
  "activity_id",
  "assessed_at",
  "assessed_by",
  "certificate_issued",
  "certificate_url",
  "competency_rating",
  "created_at",
  "enrolled_by",
  "enrollment_status",
  "evidence_urls",
  "joined_at",
  "peer_feedback",
  "position_awarded",
  "role",
  "school_id",
  "skills_demonstrated",
  "student_id",
  "teacher_feedback",
  "updated_at",
].join(", ")

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const DEFAULT_OFFSET = 0

// ── Repository ────────────────────────────────────────────────────────

export class ActivityParticipantsRepository {
  constructor(private db: SupabaseClient<Database>) {}

  // ── Error handling ────────────────────────────────────────────────

  private handleDbError(error: PostgrestError, operation: string): never {
    logger.error("activity_participants", `PostgREST error during ${operation}`, {
      code: error.code,
      hint: error.hint,
      details: error.details,
    })

    switch (error.code) {
      case "23505":
        throw new ConflictError("ActivityParticipant", "student and activity")
      case "23503":
        throw new DALError("FOREIGN_KEY_ERROR", `Related record not found: ${operation}`)
      case "23502":
        throw new DALError("VALIDATION_ERROR", `Required field missing: ${error.details}`)
      case "23514":
        throw new DALError("VALIDATION_ERROR", `Value out of allowed range: ${error.details}`)
      case "42501":
        throw new DALError("UNAUTHORIZED", "RLS policy violation — insufficient permissions")
      default:
        throw new DatabaseError(operation, error)
    }
  }

  // ── Query helpers ─────────────────────────────────────────────────

  private safeSelect(cols?: string) {
    return this.db.from("activity_participants").select(cols ?? SAFE_COLS)
  }

  // ── Read ──────────────────────────────────────────────────────────

  async getById(id: string, schoolId: string): Promise<ParticipantRow | null> {
    logger.info("activity_participants", "getById", { id })

    const { data, error } = await this.safeSelect()
      .eq("id", id)
      .eq("school_id", schoolId)  // ← tenant isolation
      .single()

    if (error?.code === "PGRST116") return null
    if (error) this.handleDbError(error, "getById")
    if (!data) return null
    return data as unknown as ParticipantRow
  }

  async getByStudentAndActivity(
    studentId: string,
    activityId: string,
    schoolId: string
  ): Promise<ParticipantRow | null> {
    logger.info("activity_participants", "getByStudentAndActivity", { studentId, activityId })

    const { data, error } = await this.safeSelect()
      .eq("student_id", studentId)
      .eq("activity_id", activityId)
      .eq("school_id", schoolId)  // ← tenant isolation
      .single()

    if (error?.code === "PGRST116") return null
    if (error) this.handleDbError(error, "getByStudentAndActivity")
    if (!data) return null
    return data as unknown as ParticipantRow
  }

  async list(options: ListParticipantsOptions, schoolId: string): Promise<PaginatedParticipants> {
    const {
      activityId,
      studentId,
      enrollmentStatus,
      role,
      certificateIssued,
      assessedBy,
      limit = DEFAULT_LIMIT,
      offset = DEFAULT_OFFSET,
    } = options

    const safeLimit = Math.min(limit, MAX_LIMIT)

    logger.info("activity_participants", "list", {
      schoolId,
      activityId,
      studentId,
      enrollmentStatus,
      limit: safeLimit,
      offset,
    })

    let q = this.db
      .from("activity_participants")
      .select(SAFE_COLS, { count: "exact" })
      .eq("school_id", schoolId)  // ← tenant isolation always applied first

    if (activityId) q = q.eq("activity_id", activityId)
    if (studentId) q = q.eq("student_id", studentId)
    if (enrollmentStatus) q = q.eq("enrollment_status", enrollmentStatus)
    if (role) q = q.eq("role", role)
    if (assessedBy) q = q.eq("assessed_by", assessedBy)
    if (certificateIssued !== undefined) q = q.eq("certificate_issued", certificateIssued)

    const { data, count, error } = await q
      .range(offset, offset + safeLimit - 1)
      .order("created_at", { ascending: false })

    if (error) this.handleDbError(error, "list")

    return {
      data: (data ?? []) as unknown as ParticipantRow[],
      count: count ?? 0,
      hasMore: (count ?? 0) > offset + safeLimit,
    }
  }

  async getStudentActivities(
    studentId: string,
    schoolId: string,          // ← tenant isolation
    status?: string
  ): Promise<ParticipantRow[]> {
    logger.info("activity_participants", "getStudentActivities", { studentId, status })

    let q = this.safeSelect()
      .eq("student_id", studentId)
      .eq("school_id", schoolId)  // ← tenant isolation

    if (status) q = q.eq("enrollment_status", status)

    const { data, error } = await q.order("created_at", { ascending: false })

    if (error) this.handleDbError(error, "getStudentActivities")
    return (data ?? []) as unknown as ParticipantRow[]
  }

  // Returns raw rows for summary aggregation in the service layer
  async getActivityParticipantRows(
    activityId: string,
    schoolId: string           // ← tenant isolation
  ): Promise<ActivitySummaryRow[]> {
    logger.info("activity_participants", "getActivityParticipantRows", { activityId })

    const { data, error } = await this.safeSelect("enrollment_status, competency_rating")
      .eq("activity_id", activityId)
      .eq("school_id", schoolId)  // ← tenant isolation

    if (error) this.handleDbError(error, "getActivityParticipantRows")
    return (data ?? []) as unknown as ActivitySummaryRow[]
  }

  // ── Write ─────────────────────────────────────────────────────────

  async create(record: InternalEnrollInput): Promise<ParticipantRow> {
    logger.info("activity_participants", "create", {
      activity_id: record.activity_id,
      student_id: record.student_id,
    })

    const { data, error } = await this.db
      .from("activity_participants")
      .insert(record as unknown as ParticipantInsert)
      .select(SAFE_COLS)
      .single()

    if (error) this.handleDbError(error, "create")
    if (!data) throw new DatabaseError("create — no data returned")
    return data as unknown as ParticipantRow
  }

  // Narrow typed update methods — each accepts only its own domain fields
  // preventing cross-domain field injection at the type level

  async updateEnrollment(
    id: string,
    data: InternalEnrollmentUpdate,
    schoolId: string
  ): Promise<ParticipantRow> {
    logger.info("activity_participants", "updateEnrollment", { id })
    return this._update(id, data, schoolId, "updateEnrollment")
  }

  async updateAssessment(
    id: string,
    data: InternalAssessmentUpdate,
    schoolId: string
  ): Promise<ParticipantRow> {
    logger.info("activity_participants", "updateAssessment", { id })
    return this._update(id, data, schoolId, "updateAssessment")
  }

  async updateCertificate(
    id: string,
    data: InternalCertificateUpdate,
    schoolId: string
  ): Promise<ParticipantRow> {
    logger.info("activity_participants", "updateCertificate", { id })
    return this._update(id, data, schoolId, "updateCertificate")
  }

  async updateArrayFields(
    id: string,
    data: InternalArrayUpdate,
    schoolId: string
  ): Promise<ParticipantRow> {
    logger.info("activity_participants", "updateArrayFields", { id })
    return this._update(id, data, schoolId, "updateArrayFields")
  }

  // Single internal update implementation — all public update methods route here
  // schoolId on every update prevents cross-tenant writes
  private async _update(
    id: string,
    data: object,
    schoolId: string,
    operation: string
  ): Promise<ParticipantRow> {
    const { data: row, error } = await this.db
      .from("activity_participants")
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("school_id", schoolId)  // ← tenant isolation on every write
      .select(SAFE_COLS)
      .single()

    if (error?.code === "PGRST116") throw new NotFoundError("ActivityParticipant", id)
    if (error) this.handleDbError(error, operation)
    if (!row) throw new NotFoundError("ActivityParticipant", id)
    return row as unknown as ParticipantRow
  }

  async delete(id: string, schoolId: string): Promise<void> {
    logger.info("activity_participants", "delete", { id })

    // Single round-trip — no pre-flight getById
    // school_id filter prevents cross-tenant deletes
    const { data, error } = await this.db
      .from("activity_participants")
      .delete()
      .eq("id", id)
      .eq("school_id", schoolId)  // ← tenant isolation
      .select("id")

    if (error) this.handleDbError(error, "delete")
    if (!data || data.length === 0) throw new NotFoundError("ActivityParticipant", id)
  }

  async bulkEnroll(records: InternalEnrollInput[]): Promise<ParticipantRow[]> {
    logger.info("activity_participants", "bulkEnroll", { count: records.length })

    // All records guaranteed to have school_id from session — injected by service
    const { data, error } = await this.db
      .from("activity_participants")
      .upsert(records as unknown as ParticipantInsert[], {
        onConflict: "student_id, activity_id",
        ignoreDuplicates: true,
      })
      .select(SAFE_COLS)

    if (error) this.handleDbError(error, "bulkEnroll")
    return (data ?? []) as unknown as ParticipantRow[]
  }

  async bulkUpdateStatus(
    activityId: string,
    schoolId: string,          // ← tenant isolation
    fromStatus: string,
    toStatus: string
  ): Promise<void> {
    logger.info("activity_participants", "bulkUpdateStatus", {
      activityId,
      fromStatus,
      toStatus,
    })

    const { error } = await this.db
      .from("activity_participants")
      .update({ enrollment_status: toStatus, updated_at: new Date().toISOString() })
      .eq("activity_id", activityId)
      .eq("school_id", schoolId)  // ← tenant isolation
      .eq("enrollment_status", fromStatus)

    if (error) this.handleDbError(error, "bulkUpdateStatus")
  }
}