// src/dal/activities.repository.ts
import { SupabaseClient, PostgrestError } from "@supabase/supabase-js"
import { Database } from "@/types/supabase"
import { z } from "zod"
import {
  DALError,
  NotFoundError,
  ValidationError,
  ConflictError,
  DatabaseError,
} from "./errors"
import { logger } from "@/lib/logger"

// ── Types ─────────────────────────────────────────────────────────────

type ActivityRow = Database["public"]["Tables"]["activities"]["Row"]
type ActivityInsert = Database["public"]["Tables"]["activities"]["Insert"]
type ActivityUpdate = Database["public"]["Tables"]["activities"]["Update"]

// ── Schemas ───────────────────────────────────────────────────────────

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/ // YYYY-MM-DD
const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/ // HH:MM

const ActivityInsertSchema = z
  .object({
    // Required / non-nullable
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
    school_id: z.string().uuid(),
    start_date: z.string().regex(DATE_REGEX, "Must be in format YYYY-MM-DD"),
    title: z.string().min(2).max(200),

    // Optional / nullable — scheduling
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

    // Optional / nullable — details
    description: z.string().max(2000).nullable().optional(),
    evidence_requirements: z.string().max(1000).nullable().optional(),
    image_url: z.string().url().nullable().optional(),
    gallery_urls: z.array(z.string().url()).nullable().optional(),
    skill_tags: z.array(z.string().max(50)).nullable().optional(),

    // Optional / nullable — audience
    audience: z
      .enum(["all", "specific_class", "specific_grade", "teachers_only"])
      .nullable()
      .optional(),
    capacity: z.number().int().positive().nullable().optional(),
    target_class_id: z.string().uuid().nullable().optional(),
    min_grade_level: z.string().nullable().optional(),
    max_grade_level: z.string().nullable().optional(),

    // Optional / nullable — CBC
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

    // Optional / nullable — enrollment
    enrollment_status: z
      .enum(["open", "closed", "cancelled", "completed"])
      .nullable()
      .optional()
      .default("open"),

    // Optional / nullable — management
    managing_teacher_id: z.string().uuid().nullable().optional(),
    posted_by: z.string().uuid().nullable().optional(),

    // Publishing — system managed
    // is_published → set via publish()
    // published_at → set via publish()
  })
  .refine((data) => !data.end_date || data.start_date <= data.end_date, {
    message: "end_date must be on or after start_date",
    path: ["end_date"],
  })
  .refine(
    (data) =>
      !data.start_time || !data.end_time || data.start_time < data.end_time,
    { message: "end_time must be after start_time", path: ["end_time"] }
  )

const ActivityUpdateSchema = ActivityInsertSchema.omit({ school_id: true }) // never changes after creation
  .partial()

// ── Exported input types ──────────────────────────────────────────────

export type CreateActivityInput = z.infer<typeof ActivityInsertSchema>
export type UpdateActivityInput = z.infer<typeof ActivityUpdateSchema>

// ── List options ──────────────────────────────────────────────────────

export interface ListActivitiesOptions {
  schoolId?: string
  category?: string
  audience?: string
  targetClassId?: string
  managingTeacherId?: string
  enrollmentStatus?: string
  isPublished?: boolean
  cbcCompetencyArea?: string
  upcoming?: boolean // filters to start_date >= today
  limit?: number
  offset?: number
}

// ── Pagination result ─────────────────────────────────────────────────

export interface PaginatedActivities {
  data: ActivityRow[]
  count: number
  hasMore: boolean
}

// ── Constants ─────────────────────────────────────────────────────────

const SAFE_COLS = [
  "id",
  "audience",
  "capacity",
  "category",
  "cbc_competency_area",
  "description",
  "end_date",
  "end_time",
  "enrollment_status",
  "evidence_requirements",
  "expires_at",
  "gallery_urls",
  "image_url",
  "is_published",
  "location",
  "managing_teacher_id",
  "max_grade_level",
  "min_grade_level",
  "posted_by",
  "published_at",
  "school_id",
  "skill_tags",
  "start_date",
  "start_time",
  "target_class_id",
  "title",
  "created_at",
  "updated_at",
].join(", ")

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
const DEFAULT_OFFSET = 0

// ── Repository ────────────────────────────────────────────────────────

export class ActivitiesRepository {
  constructor(private db: SupabaseClient<Database>) {}

  // ── Error handling ────────────────────────────────────────────────

  private handleDbError(error: PostgrestError, operation: string): never {
    logger.error("activities", `PostgREST error during ${operation}`, {
      code: error.code,
      hint: error.hint,
      details: error.details,
    })

    switch (error.code) {
      case "23505":
        throw new ConflictError("Activity", "title and school")
      case "23503":
        throw new DALError(
          "FOREIGN_KEY_ERROR",
          `Related record not found: ${operation}`
        )
      case "23502":
        throw new DALError(
          "VALIDATION_ERROR",
          `Required field missing: ${error.details}`
        )
      case "23514":
        throw new DALError(
          "VALIDATION_ERROR",
          `Value out of allowed range: ${error.details}`
        )
      case "42501":
        throw new DALError(
          "UNAUTHORIZED",
          "You do not have permission to access this resource"
        )
      default:
        throw new DatabaseError(operation, error)
    }
  }

  // ── Query helpers ─────────────────────────────────────────────────

  private safeSelect(cols?: string) {
    return this.db.from("activities").select(cols ?? SAFE_COLS)
  }

  private today(): string {
    return new Date().toISOString().split("T")[0] // YYYY-MM-DD
  }

  // ── Read ──────────────────────────────────────────────────────────

  async getById(id: string): Promise<ActivityRow | null> {
    logger.info("activities", "getById", { id })

    const { data, error } = await this.safeSelect().eq("id", id).single()

    if (error?.code === "PGRST116") return null
    if (error) this.handleDbError(error, "getById")
    if (!data) return null
    return data as unknown as ActivityRow
  }

  async list(
    options: ListActivitiesOptions = {}
  ): Promise<PaginatedActivities> {
    const {
      schoolId,
      category,
      audience,
      targetClassId,
      managingTeacherId,
      enrollmentStatus,
      isPublished,
      cbcCompetencyArea,
      upcoming,
      limit = DEFAULT_LIMIT,
      offset = DEFAULT_OFFSET,
    } = options

    const safeLimit = Math.min(limit, MAX_LIMIT)

    logger.info("activities", "list", {
      schoolId,
      category,
      audience,
      enrollmentStatus,
      isPublished,
      limit: safeLimit,
      offset,
    })

    let q = this.db.from("activities").select(SAFE_COLS, { count: "exact" })

    if (schoolId) q = q.eq("school_id", schoolId)
    if (category) q = q.eq("category", category)
    if (audience) q = q.eq("audience", audience)
    if (targetClassId) q = q.eq("target_class_id", targetClassId)
    if (managingTeacherId) q = q.eq("managing_teacher_id", managingTeacherId)
    if (enrollmentStatus) q = q.eq("enrollment_status", enrollmentStatus)
    if (cbcCompetencyArea) q = q.eq("cbc_competency_area", cbcCompetencyArea)
    if (isPublished !== undefined) q = q.eq("is_published", isPublished)
    if (upcoming) q = q.gte("start_date", this.today())

    const { data, count, error } = await q
      .range(offset, offset + safeLimit - 1)
      .order("start_date", { ascending: true })

    if (error) this.handleDbError(error, "list")

    return {
      data: (data ?? []) as unknown as ActivityRow[],
      count: count ?? 0,
      hasMore: (count ?? 0) > offset + safeLimit,
    }
  }

  // Fetches all published upcoming activities for a school
  async getUpcoming(
    schoolId: string,
    limit = DEFAULT_LIMIT
  ): Promise<ActivityRow[]> {
    logger.info("activities", "getUpcoming", { schoolId })

    const { data, error } = await this.safeSelect()
      .eq("school_id", schoolId)
      .eq("is_published", true)
      .eq("enrollment_status", "open")
      .gte("start_date", this.today())
      .order("start_date", { ascending: true })
      .limit(Math.min(limit, MAX_LIMIT))

    if (error) this.handleDbError(error, "getUpcoming")
    return (data ?? []) as unknown as ActivityRow[]
  }

  // Fetches activities managed by a specific teacher
  async getByTeacher(
    teacherId: string,
    upcoming = false
  ): Promise<ActivityRow[]> {
    logger.info("activities", "getByTeacher", { teacherId, upcoming })

    let q = this.safeSelect().eq("managing_teacher_id", teacherId)

    if (upcoming) q = q.gte("start_date", this.today())

    const { data, error } = await q.order("start_date", { ascending: true })

    if (error) this.handleDbError(error, "getByTeacher")
    return (data ?? []) as unknown as ActivityRow[]
  }

  // Fetches activities available to a specific class
  async getForClass(classId: string, schoolId: string): Promise<ActivityRow[]> {
    logger.info("activities", "getForClass", { classId, schoolId })

    const { data, error } = await this.safeSelect()
      .eq("school_id", schoolId)
      .eq("is_published", true)
      .gte("start_date", this.today())
      .or(`audience.eq.all,target_class_id.eq.${classId}`)
      .order("start_date", { ascending: true })

    if (error) this.handleDbError(error, "getForClass")
    return (data ?? []) as unknown as ActivityRow[]
  }

  // ── Write ─────────────────────────────────────────────────────────

  async create(input: unknown): Promise<ActivityRow> {
    const parsed = ActivityInsertSchema.safeParse(input)
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues
          .map((e: z.ZodIssue) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")
      )
    }

    logger.info("activities", "create", {
      title: parsed.data.title,
      category: parsed.data.category,
      start_date: parsed.data.start_date,
    })

    const { data, error } = await this.db
      .from("activities")
      .insert(parsed.data as unknown as ActivityInsert)
      .select(SAFE_COLS)
      .single()

    if (error) this.handleDbError(error, "create")
    if (!data) throw new DatabaseError("create — no data returned")
    return data as unknown as ActivityRow
  }

  async update(id: string, input: unknown): Promise<ActivityRow> {
    const parsed = ActivityUpdateSchema.safeParse(input)
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues
          .map((e: z.ZodIssue) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")
      )
    }

    logger.info("activities", "update", { id })

    const { data, error } = await this.db
      .from("activities")
      .update(parsed.data as unknown as ActivityUpdate)
      .eq("id", id)
      .select(SAFE_COLS)
      .single()

    if (error?.code === "PGRST116") throw new NotFoundError("Activity", id)
    if (error) this.handleDbError(error, "update")
    if (!data) throw new NotFoundError("Activity", id)
    return data as unknown as ActivityRow
  }

  async delete(id: string): Promise<void> {
    logger.info("activities", "delete", { id })

    const exists = await this.getById(id)
    if (!exists) throw new NotFoundError("Activity", id)

    const { error } = await this.db.from("activities").delete().eq("id", id)

    if (error) this.handleDbError(error, "delete")
  }

  // ── Publishing ────────────────────────────────────────────────────

  async publish(id: string, postedBy: string): Promise<ActivityRow> {
    logger.info("activities", "publish", { id, postedBy })
    return this.update(id, {
      is_published: true,
      published_at: new Date().toISOString(),
      posted_by: postedBy,
    })
  }

  async unpublish(id: string): Promise<ActivityRow> {
    logger.info("activities", "unpublish", { id })
    return this.update(id, {
      is_published: false,
      published_at: null,
    })
  }

  // ── Enrollment status ─────────────────────────────────────────────

  async openEnrollment(id: string): Promise<ActivityRow> {
    logger.info("activities", "openEnrollment", { id })
    return this.update(id, { enrollment_status: "open" })
  }

  async closeEnrollment(id: string): Promise<ActivityRow> {
    logger.info("activities", "closeEnrollment", { id })
    return this.update(id, { enrollment_status: "closed" })
  }

  async cancel(id: string): Promise<ActivityRow> {
    logger.info("activities", "cancel", { id })
    return this.update(id, { enrollment_status: "cancelled" })
  }

  async complete(id: string): Promise<ActivityRow> {
    logger.info("activities", "complete", { id })
    return this.update(id, { enrollment_status: "completed" })
  }

  // ── Gallery ───────────────────────────────────────────────────────

  async addGalleryImages(id: string, urls: string[]): Promise<ActivityRow> {
    logger.info("activities", "addGalleryImages", { id, count: urls.length })

    const existing = await this.getById(id)
    if (!existing) throw new NotFoundError("Activity", id)

    const merged = [...new Set([...(existing.gallery_urls ?? []), ...urls])]
    return this.update(id, { gallery_urls: merged })
  }

  async removeGalleryImages(id: string, urls: string[]): Promise<ActivityRow> {
    logger.info("activities", "removeGalleryImages", { id, count: urls.length })

    const existing = await this.getById(id)
    if (!existing) throw new NotFoundError("Activity", id)

    const filtered = (existing.gallery_urls ?? []).filter(
      (u) => !urls.includes(u)
    )
    return this.update(id, { gallery_urls: filtered })
  }

  // ── Skill tags ────────────────────────────────────────────────────

  async addSkillTags(id: string, tags: string[]): Promise<ActivityRow> {
    logger.info("activities", "addSkillTags", { id, tags })

    const existing = await this.getById(id)
    if (!existing) throw new NotFoundError("Activity", id)

    const merged = [...new Set([...(existing.skill_tags ?? []), ...tags])]
    return this.update(id, { skill_tags: merged })
  }

  async removeSkillTags(id: string, tags: string[]): Promise<ActivityRow> {
    logger.info("activities", "removeSkillTags", { id, tags })

    const existing = await this.getById(id)
    if (!existing) throw new NotFoundError("Activity", id)

    const filtered = (existing.skill_tags ?? []).filter(
      (t) => !tags.includes(t)
    )
    return this.update(id, { skill_tags: filtered })
  }

  // ── Teacher assignment ────────────────────────────────────────────

  async assignTeacher(id: string, teacherId: string): Promise<ActivityRow> {
    logger.info("activities", "assignTeacher", { id, teacherId })
    return this.update(id, { managing_teacher_id: teacherId })
  }

  async removeTeacher(id: string): Promise<ActivityRow> {
    logger.info("activities", "removeTeacher", { id })
    return this.update(id, { managing_teacher_id: null })
  }
}
