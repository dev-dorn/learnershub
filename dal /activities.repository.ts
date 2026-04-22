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

type ActivityRow = Database["public"]["Tables"]["activities"]["Row"]
type ActivityInsert = Database["public"]["Tables"]["activities"]["Insert"]

// ── Internal input types ──────────────────────────────────────────────

export interface InternalActivityInput {
  // Required
  category: "academic" | "sports" | "arts" | "leadership" | "community" | "cbc_competency" | "co_curricular" | "other"
  school_id: string             // always from session
  start_date: string
  title: string

  // Scheduling
  end_date?: string | null
  start_time?: string | null
  end_time?: string | null
  expires_at?: string | null
  location?: string | null

  // Details
  description?: string | null
  evidence_requirements?: string | null
  image_url?: string | null
  gallery_urls?: string[] | null
  skill_tags?: string[] | null

  // Audience
  audience?: "all" | "specific_class" | "specific_grade" | "teachers_only" | null
  capacity?: number | null
  target_class_id?: string | null
  min_grade_level?: string | null
  max_grade_level?: string | null

  // CBC
  cbc_competency_area?: "communication" | "critical_thinking" | "creativity" | "collaboration" | "citizenship" | "digital_literacy" | "learning_to_learn" | null

  // Enrollment
  enrollment_status?: "open" | "closed" | "cancelled" | "completed" | null

  // Management
  managing_teacher_id?: string | null
}

// Narrow update types per operation domain
// Prevents cross-domain field injection at the type level

export interface InternalActivityUpdate {
  category?: "academic" | "sports" | "arts" | "leadership" | "community" | "cbc_competency" | "co_curricular" | "other"
  start_date?: string
  title?: string
  end_date?: string | null
  start_time?: string | null
  end_time?: string | null
  expires_at?: string | null
  location?: string | null
  description?: string | null
  evidence_requirements?: string | null
  image_url?: string | null
  audience?: "all" | "specific_class" | "specific_grade" | "teachers_only" | null
  capacity?: number | null
  target_class_id?: string | null
  min_grade_level?: string | null
  max_grade_level?: string | null
  cbc_competency_area?: "communication" | "critical_thinking" | "creativity" | "collaboration" | "citizenship" | "digital_literacy" | "learning_to_learn" | null
  managing_teacher_id?: string | null
}

export interface InternalPublishUpdate {
  is_published: boolean
  published_at: string | null
  posted_by: string             // always from session
}

export interface InternalEnrollmentStatusUpdate {
  enrollment_status: "open" | "closed" | "cancelled" | "completed"
}

export interface InternalArrayUpdate {
  gallery_urls?: string[] | null
  skill_tags?: string[] | null
}

// ── List options ──────────────────────────────────────────────────────

// schoolId is intentionally excluded — always passed as a mandatory
// separate param from session context. NEVER add schoolId here.
export interface ListActivitiesOptions {
  category?: string
  audience?: string
  targetClassId?: string
  managingTeacherId?: string
  enrollmentStatus?: string
  isPublished?: boolean
  cbcCompetencyArea?: string
  upcoming?: boolean
  limit?: number
  offset?: number
}

// ── Result types ──────────────────────────────────────────────────────

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
    return this.db.from("activities").select(cols ?? SAFE_COLS)
  }

  private today(): string {
    return new Date().toISOString().split("T")[0]
  }

  // ── Read ──────────────────────────────────────────────────────────

  async getById(id: string, schoolId: string): Promise<ActivityRow | null> {
    logger.info("activities", "getById", { id })

    const { data, error } = await this.safeSelect()
      .eq("id", id)
      .eq("school_id", schoolId)  // ← tenant isolation
      .single()

    if (error?.code === "PGRST116") return null
    if (error) this.handleDbError(error, "getById")
    if (!data) return null
    return data as unknown as ActivityRow
  }

  async list(options: ListActivitiesOptions, schoolId: string): Promise<PaginatedActivities> {
    const {
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

    let q = this.db
      .from("activities")
      .select(SAFE_COLS, { count: "exact" })
      .eq("school_id", schoolId)  // ← tenant isolation always applied first

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

  async getUpcoming(schoolId: string, limit = DEFAULT_LIMIT): Promise<ActivityRow[]> {
    logger.info("activities", "getUpcoming", { schoolId })

    const { data, error } = await this.safeSelect()
      .eq("school_id", schoolId)  // ← tenant isolation
      .eq("is_published", true)
      .eq("enrollment_status", "open")
      .gte("start_date", this.today())
      .order("start_date", { ascending: true })
      .limit(Math.min(limit, MAX_LIMIT))

    if (error) this.handleDbError(error, "getUpcoming")
    return (data ?? []) as unknown as ActivityRow[]
  }

  async getByTeacher(
    teacherId: string,
    schoolId: string,         // ← tenant isolation
    upcoming = false
  ): Promise<ActivityRow[]> {
    logger.info("activities", "getByTeacher", { teacherId, upcoming })

    let q = this.safeSelect()
      .eq("managing_teacher_id", teacherId)
      .eq("school_id", schoolId)  // ← tenant isolation

    if (upcoming) q = q.gte("start_date", this.today())

    const { data, error } = await q.order("start_date", { ascending: true })

    if (error) this.handleDbError(error, "getByTeacher")
    return (data ?? []) as unknown as ActivityRow[]
  }

  async getForClass(classId: string, schoolId: string): Promise<ActivityRow[]> {
    logger.info("activities", "getForClass", { classId, schoolId })

    const { data, error } = await this.safeSelect()
      .eq("school_id", schoolId)  // ← tenant isolation
      .eq("is_published", true)
      .gte("start_date", this.today())
      .or(`audience.eq.all,target_class_id.eq.${classId}`)
      .order("start_date", { ascending: true })

    if (error) this.handleDbError(error, "getForClass")
    return (data ?? []) as unknown as ActivityRow[]
  }

  // ── Write ─────────────────────────────────────────────────────────

  async create(record: InternalActivityInput): Promise<ActivityRow> {
    logger.info("activities", "create", {
      title: record.title,
      category: record.category,
      start_date: record.start_date,
    })

    const { data, error } = await this.db
      .from("activities")
      .insert(record as unknown as ActivityInsert)
      .select(SAFE_COLS)
      .single()

    if (error) this.handleDbError(error, "create")
    if (!data) throw new DatabaseError("create — no data returned")
    return data as unknown as ActivityRow
  }

  // General content update — no publish or enrollment status fields
  async update(
    id: string,
    data: InternalActivityUpdate,
    schoolId: string
  ): Promise<ActivityRow> {
    logger.info("activities", "update", { id })
    return this._update(id, data, schoolId, "update")
  }

  // Publish-specific update — posted_by always from session
  async updatePublishState(
    id: string,
    data: InternalPublishUpdate,
    schoolId: string
  ): Promise<ActivityRow> {
    logger.info("activities", "updatePublishState", { id, is_published: data.is_published })
    return this._update(id, data, schoolId, "updatePublishState")
  }

  // Enrollment status update — separate from content updates
  async updateEnrollmentStatus(
    id: string,
    data: InternalEnrollmentStatusUpdate,
    schoolId: string
  ): Promise<ActivityRow> {
    logger.info("activities", "updateEnrollmentStatus", { id, status: data.enrollment_status })
    return this._update(id, data, schoolId, "updateEnrollmentStatus")
  }

  // Array patch update — gallery and skill tags
  async updateArrayFields(
    id: string,
    data: InternalArrayUpdate,
    schoolId: string
  ): Promise<ActivityRow> {
    logger.info("activities", "updateArrayFields", { id })
    return this._update(id, data, schoolId, "updateArrayFields")
  }

  // Single internal update — all public update methods route here
  // school_id on every update prevents cross-tenant writes
  private async _update(
    id: string,
    data: object,
    schoolId: string,
    operation: string
  ): Promise<ActivityRow> {
    const { data: row, error } = await this.db
      .from("activities")
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("school_id", schoolId)  // ← tenant isolation on every write
      .select(SAFE_COLS)
      .single()

    if (error?.code === "PGRST116") throw new NotFoundError("Activity", id)
    if (error) this.handleDbError(error, operation)
    if (!row) throw new NotFoundError("Activity", id)
    return row as unknown as ActivityRow
  }

  async delete(id: string, schoolId: string): Promise<void> {
    logger.info("activities", "delete", { id })

    // Single round-trip — no pre-flight getById
    // school_id filter prevents cross-tenant deletes
    const { data, error } = await this.db
      .from("activities")
      .delete()
      .eq("id", id)
      .eq("school_id", schoolId)  // ← tenant isolation
      .select("id")

    if (error) this.handleDbError(error, "delete")
    if (!data || data.length === 0) throw new NotFoundError("Activity", id)
  }
}