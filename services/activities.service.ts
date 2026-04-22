import { z } from "zod"
import { logger } from "@/lib/logger"
import { requireRole } from "@/lib/rbac"

import { Database } from "@/types/supabase"
import {
  ActivitiesRepository,
  ListActivitiesOptions,
  PaginatedActivities,
} from "@/dal /activities.repository"
import { NotFoundError, ValidationError } from "@/dal /errors"

type ActivityRow = Database["public"]["Tables"]["activities"]["Row"]

// ── Schemas ───────────────────────────────────────────────────────────

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/
const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/

const ActivityCreateSchema = z
  .object({
    // Required
    category: z.enum([
      "academic",
      "sports",
      "arts",
      "leadership",
      "community",
      "cbc_competency",
      "co_curricular",
      "other",
    ]),
    start_date: z.string().regex(DATE_REGEX, "Must be in format YYYY-MM-DD"),
    title: z.string().min(2).max(200),

    // Scheduling
    end_date: z
      .string()
      .regex(DATE_REGEX, "Must be in format YYYY-MM-DD")
      .nullable()
      .optional(),
    start_time: z
      .string()
      .regex(TIME_REGEX, "Must be in format HH:MM")
      .nullable()
      .optional(),
    end_time: z
      .string()
      .regex(TIME_REGEX, "Must be in format HH:MM")
      .nullable()
      .optional(),
    expires_at: z.string().nullable().optional(),
    location: z.string().max(200).nullable().optional(),

    // Details
    description: z.string().max(2000).nullable().optional(),
    evidence_requirements: z.string().max(1000).nullable().optional(),
    image_url: z.string().url().nullable().optional(),
    gallery_urls: z.array(z.string().url()).max(50).nullable().optional(),
    skill_tags: z.array(z.string().max(50)).max(100).nullable().optional(),

    // Audience
    audience: z
      .enum(["all", "specific_class", "specific_grade", "teachers_only"])
      .nullable()
      .optional(),
    capacity: z.number().int().positive().nullable().optional(),
    target_class_id: z.string().uuid().nullable().optional(),
    min_grade_level: z.string().nullable().optional(),
    max_grade_level: z.string().nullable().optional(),

    // CBC
    cbc_competency_area: z
      .enum([
        "communication",
        "critical_thinking",
        "creativity",
        "collaboration",
        "citizenship",
        "digital_literacy",
        "learning_to_learn",
      ])
      .nullable()
      .optional(),

    // Enrollment
    enrollment_status: z
      .enum(["open", "closed", "cancelled", "completed"])
      .nullable()
      .optional()
      .default("open"),

    // Managing teacher — validated but NOT posted_by/published fields
    // posted_by injected from session on publish()
    managing_teacher_id: z.string().uuid().nullable().optional(),
  })
  .refine((d) => !d.end_date || d.start_date <= d.end_date, {
    message: "end_date must be on or after start_date",
    path: ["end_date"],
  })
  .refine((d) => !d.start_time || !d.end_time || d.start_time < d.end_time, {
    message: "end_time must be after start_time",
    path: ["end_time"],
  })

// Update schema omits immutable fields
const ActivityUpdateSchema = ActivityCreateSchema.omit({
  enrollment_status: true, // use openEnrollment/closeEnrollment/cancel/complete
}).partial()

const GallerySchema = z.object({
  urls: z.array(z.string().url()).min(1).max(50),
})

const SkillTagsSchema = z.object({
  tags: z.array(z.string().max(50)).min(1).max(100),
})

export type CreateActivityInput = z.infer<typeof ActivityCreateSchema>
export type UpdateActivityInput = z.infer<typeof ActivityUpdateSchema>

// ── Context ───────────────────────────────────────────────────────────

export interface ActivityContext {
  schoolId: string // from auth session — never from client
  userId: string // from auth session — never from client
  role: string // from auth session — never from client
}

// ── Constants ─────────────────────────────────────────────────────────

// TODO: move to src/lib/rbac.ts once roles are finalized
const WRITE_ROLES = ["teacher", "admin", "principal"] as const
const PUBLISH_ROLES = ["admin", "principal"] as const // stricter
const MAX_GALLERY = 50
const MAX_SKILL_TAGS = 100

// ── Service ───────────────────────────────────────────────────────────

export class ActivitiesService {
  constructor(private repo: ActivitiesRepository) {}

  // ── Read ──────────────────────────────────────────────────────────

  async getById(
    id: string,
    context: ActivityContext
  ): Promise<ActivityRow | null> {
    return this.repo.getById(id, context.schoolId)
  }

  async list(
    options: ListActivitiesOptions,
    context: ActivityContext
  ): Promise<PaginatedActivities> {
    return this.repo.list(options, context.schoolId)
  }

  async getUpcoming(
    context: ActivityContext,
    limit?: number
  ): Promise<ActivityRow[]> {
    return this.repo.getUpcoming(context.schoolId, limit)
  }

  async getByTeacher(
    teacherId: string,
    context: ActivityContext,
    upcoming?: boolean
  ): Promise<ActivityRow[]> {
    return this.repo.getByTeacher(teacherId, context.schoolId, upcoming)
  }

  async getForClass(
    classId: string,
    context: ActivityContext
  ): Promise<ActivityRow[]> {
    return this.repo.getForClass(classId, context.schoolId)
  }

  // ── Write ─────────────────────────────────────────────────────────

  async create(input: unknown, context: ActivityContext): Promise<ActivityRow> {
    requireRole(context.role, WRITE_ROLES, "create activities")

    const parsed = ActivityCreateSchema.safeParse(input)
    if (!parsed.success)
      throw new ValidationError(
        parsed.error.issues
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")
      )

    return this.repo.create({
      ...parsed.data,
      school_id: context.schoolId, // ← always from session, never from client
    })
  }

  async update(
    id: string,
    input: unknown,
    context: ActivityContext
  ): Promise<ActivityRow> {
    requireRole(context.role, WRITE_ROLES, "update activities")

    const parsed = ActivityUpdateSchema.safeParse(input)
    if (!parsed.success)
      throw new ValidationError(
        parsed.error.issues
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")
      )

    return this.repo.update(id, parsed.data, context.schoolId)
  }

  async delete(id: string, context: ActivityContext): Promise<void> {
    requireRole(context.role, WRITE_ROLES, "delete activities")
    return this.repo.delete(id, context.schoolId)
  }

  // ── Publishing ────────────────────────────────────────────────────

  async publish(id: string, context: ActivityContext): Promise<ActivityRow> {
    requireRole(context.role, PUBLISH_ROLES, "publish activities")

    logger.info("activities", "publish", {
      id,
      publishedBy: context.userId, // audit trail in logs
    })

    return this.repo.updatePublishState(
      id,
      {
        is_published: true,
        published_at: new Date().toISOString(),
        posted_by: context.userId, // ← always from session, never from client
      },
      context.schoolId
    )
  }

  async unpublish(id: string, context: ActivityContext): Promise<ActivityRow> {
    requireRole(context.role, PUBLISH_ROLES, "unpublish activities")

    logger.info("activities", "unpublish", {
      id,
      unpublishedBy: context.userId,
    })

    return this.repo.updatePublishState(
      id,
      {
        is_published: false,
        published_at: null,
        posted_by: context.userId, // ← always from session
      },
      context.schoolId
    )
  }

  // ── Enrollment status transitions ─────────────────────────────────

  async openEnrollment(
    id: string,
    context: ActivityContext
  ): Promise<ActivityRow> {
    requireRole(context.role, WRITE_ROLES, "manage activity enrollment")
    return this.repo.updateEnrollmentStatus(
      id,
      { enrollment_status: "open" },
      context.schoolId
    )
  }

  async closeEnrollment(
    id: string,
    context: ActivityContext
  ): Promise<ActivityRow> {
    requireRole(context.role, WRITE_ROLES, "manage activity enrollment")
    return this.repo.updateEnrollmentStatus(
      id,
      { enrollment_status: "closed" },
      context.schoolId
    )
  }

  async cancel(id: string, context: ActivityContext): Promise<ActivityRow> {
    requireRole(context.role, PUBLISH_ROLES, "cancel activities") // stricter — admin/principal only
    return this.repo.updateEnrollmentStatus(
      id,
      { enrollment_status: "cancelled" },
      context.schoolId
    )
  }

  async complete(id: string, context: ActivityContext): Promise<ActivityRow> {
    requireRole(context.role, WRITE_ROLES, "complete activities")
    return this.repo.updateEnrollmentStatus(
      id,
      { enrollment_status: "completed" },
      context.schoolId
    )
  }

  // ── Gallery ───────────────────────────────────────────────────────
  // Read-modify-write — susceptible to concurrent update loss.
  // TODO: replace with Postgres array append RPC when concurrency becomes an issue.

  async addGalleryImages(
    id: string,
    input: unknown,
    context: ActivityContext
  ): Promise<ActivityRow> {
    requireRole(context.role, WRITE_ROLES, "add gallery images")

    const parsed = GallerySchema.safeParse(input)
    if (!parsed.success)
      throw new ValidationError(
        parsed.error.issues
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")
      )

    const existing = await this.repo.getById(id, context.schoolId)
    if (!existing) throw new NotFoundError("Activity", id)

    const merged = [
      ...new Set([...(existing.gallery_urls ?? []), ...parsed.data.urls]),
    ]
    if (merged.length > MAX_GALLERY)
      throw new ValidationError(
        `gallery_urls: max ${MAX_GALLERY} images per activity`
      )

    return this.repo.updateArrayFields(
      id,
      { gallery_urls: merged },
      context.schoolId
    )
  }

  async removeGalleryImages(
    id: string,
    input: unknown,
    context: ActivityContext
  ): Promise<ActivityRow> {
    requireRole(context.role, WRITE_ROLES, "remove gallery images")

    const parsed = GallerySchema.safeParse(input)
    if (!parsed.success)
      throw new ValidationError(
        parsed.error.issues
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")
      )

    const existing = await this.repo.getById(id, context.schoolId)
    if (!existing) throw new NotFoundError("Activity", id)

    const filtered = (existing.gallery_urls ?? []).filter(
      (u) => !parsed.data.urls.includes(u)
    )
    return this.repo.updateArrayFields(
      id,
      { gallery_urls: filtered },
      context.schoolId
    )
  }

  // ── Skill tags ────────────────────────────────────────────────────

  async addSkillTags(
    id: string,
    input: unknown,
    context: ActivityContext
  ): Promise<ActivityRow> {
    requireRole(context.role, WRITE_ROLES, "add skill tags")

    const parsed = SkillTagsSchema.safeParse(input)
    if (!parsed.success)
      throw new ValidationError(
        parsed.error.issues
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")
      )

    const existing = await this.repo.getById(id, context.schoolId)
    if (!existing) throw new NotFoundError("Activity", id)

    const merged = [
      ...new Set([...(existing.skill_tags ?? []), ...parsed.data.tags]),
    ]
    if (merged.length > MAX_SKILL_TAGS)
      throw new ValidationError(
        `skill_tags: max ${MAX_SKILL_TAGS} tags per activity`
      )

    return this.repo.updateArrayFields(
      id,
      { skill_tags: merged },
      context.schoolId
    )
  }

  async removeSkillTags(
    id: string,
    input: unknown,
    context: ActivityContext
  ): Promise<ActivityRow> {
    requireRole(context.role, WRITE_ROLES, "remove skill tags")

    const parsed = SkillTagsSchema.safeParse(input)
    if (!parsed.success)
      throw new ValidationError(
        parsed.error.issues
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")
      )

    const existing = await this.repo.getById(id, context.schoolId)
    if (!existing) throw new NotFoundError("Activity", id)

    const filtered = (existing.skill_tags ?? []).filter(
      (t) => !parsed.data.tags.includes(t)
    )
    return this.repo.updateArrayFields(
      id,
      { skill_tags: filtered },
      context.schoolId
    )
  }

  // ── Teacher assignment ────────────────────────────────────────────

  async assignTeacher(
    id: string,
    teacherId: string,
    context: ActivityContext
  ): Promise<ActivityRow> {
    requireRole(context.role, PUBLISH_ROLES, "assign teachers") // admin/principal only

    if (!teacherId || teacherId.length === 0)
      throw new ValidationError("teacherId must not be empty")

    return this.repo.update(
      id,
      { managing_teacher_id: teacherId },
      context.schoolId
    )
  }

  async removeTeacher(
    id: string,
    context: ActivityContext
  ): Promise<ActivityRow> {
    requireRole(context.role, PUBLISH_ROLES, "remove teachers") // admin/principal only
    return this.repo.update(id, { managing_teacher_id: null }, context.schoolId)
  }
}
