// src/dal/teachers.repository.ts
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

type TeacherRow = Database["public"]["Tables"]["teachers"]["Row"]
type TeacherInsert = Database["public"]["Tables"]["teachers"]["Insert"]
type TeacherUpdate = Database["public"]["Tables"]["teachers"]["Update"]

// ── Schemas ───────────────────────────────────────────────────────────

const TeacherInsertSchema = z.object({
  // Required / non-nullable
  user_id: z.string().uuid(),
  employee_number: z.string().min(2).max(50),
  school_id: z.string().uuid(),

  // Optional / nullable
  department: z.string().max(100).nullable().optional(),
  is_class_teacher: z.boolean().nullable().optional(),

  employment_status: z
    .enum(["active", "on_leave", "suspended", "terminated", "resigned"])
    .nullable()
    .optional(),

  employment_start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be in format YYYY-MM-DD")
    .nullable()
    .optional(),
  employment_end_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be in format YYYY-MM-DD")
    .nullable()
    .optional(),

  background_check_status: z
    .enum(["pending", "passed", "failed", "expired"])
    .nullable()
    .optional(),
  background_check_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be in format YYYY-MM-DD")
    .nullable()
    .optional(),

  hr_verified: z.boolean().nullable().optional(),
  hr_verificaton_date: z
    .string() // note: typo is in your DB schema
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be in format YYYY-MM-DD")
    .nullable()
    .optional(),

  // SIS — system managed, never set manually
  // sis_employee_id    → set by SIS sync
  // sis_last_synced_at → set by SIS sync
})

const TeacherUpdateSchema = TeacherInsertSchema.omit({
  user_id: true,
  school_id: true,
}) // never change after creation
  .partial()

// ── Exported input types ──────────────────────────────────────────────

export type CreateTeacherInput = z.infer<typeof TeacherInsertSchema>
export type UpdateTeacherInput = z.infer<typeof TeacherUpdateSchema>

// ── List options ──────────────────────────────────────────────────────

export interface ListTeachersOptions {
  schoolId?: string
  department?: string
  employmentStatus?: string
  isClassTeacher?: boolean
  hrVerified?: boolean
  limit?: number
  offset?: number
}

// ── Pagination result ─────────────────────────────────────────────────

export interface PaginatedTeachers {
  data: TeacherRow[]
  count: number
  hasMore: boolean
}

// ── Constants ─────────────────────────────────────────────────────────

const SAFE_COLS = [
  "id",
  "user_id",
  "employee_number",
  "school_id",
  "department",
  "is_class_teacher",
  "employment_status",
  "employment_start_date",
  "employment_end_date",
  "background_check_status",
  "background_check_date",
  "hr_verified",
  "hr_verificaton_date", // note: typo preserved from DB schema
  "created_at",
  "updated_at",
].join(", ")

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
const DEFAULT_OFFSET = 0

// ── Repository ────────────────────────────────────────────────────────

export class TeachersRepository {
  constructor(private db: SupabaseClient<Database>) {}

  // ── Error handling ────────────────────────────────────────────────

  private handleDbError(error: PostgrestError, operation: string): never {
    logger.error("teachers", `PostgREST error during ${operation}`, {
      code: error.code,
      hint: error.hint,
      details: error.details,
    })

    switch (error.code) {
      case "23505":
        throw new ConflictError("Teacher", "employee_number")
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
    return this.db.from("teachers").select(cols ?? SAFE_COLS)
  }

  // ── Read ──────────────────────────────────────────────────────────

  async getById(id: string): Promise<TeacherRow | null> {
    logger.info("teachers", "getById", { id })

    const { data, error } = await this.safeSelect().eq("id", id).single()

    if (error?.code === "PGRST116") return null
    if (error) this.handleDbError(error, "getById")
    if (!data) return null
    return data as unknown as TeacherRow
  }

  async getByUserId(userId: string): Promise<TeacherRow | null> {
    logger.info("teachers", "getByUserId", { userId })

    const { data, error } = await this.safeSelect()
      .eq("user_id", userId)
      .single()

    if (error?.code === "PGRST116") return null
    if (error) this.handleDbError(error, "getByUserId")
    if (!data) return null
    return data as unknown as TeacherRow
  }

  async getByEmployeeNumber(
    employeeNumber: string
  ): Promise<TeacherRow | null> {
    logger.info("teachers", "getByEmployeeNumber", { employeeNumber })

    const { data, error } = await this.safeSelect()
      .eq("employee_number", employeeNumber)
      .single()

    if (error?.code === "PGRST116") return null
    if (error) this.handleDbError(error, "getByEmployeeNumber")
    if (!data) return null
    return data as unknown as TeacherRow
  }

  async list(options: ListTeachersOptions = {}): Promise<PaginatedTeachers> {
    const {
      schoolId,
      department,
      employmentStatus,
      isClassTeacher,
      hrVerified,
      limit = DEFAULT_LIMIT,
      offset = DEFAULT_OFFSET,
    } = options

    const safeLimit = Math.min(limit, MAX_LIMIT)

    logger.info("teachers", "list", {
      schoolId,
      department,
      employmentStatus,
      isClassTeacher,
      limit: safeLimit,
      offset,
    })

    let q = this.db.from("teachers").select(SAFE_COLS, { count: "exact" })

    if (schoolId) q = q.eq("school_id", schoolId)
    if (department) q = q.eq("department", department)
    if (employmentStatus) q = q.eq("employment_status", employmentStatus)
    if (isClassTeacher !== undefined)
      q = q.eq("is_class_teacher", isClassTeacher)
    if (hrVerified !== undefined) q = q.eq("hr_verified", hrVerified)

    const { data, count, error } = await q
      .range(offset, offset + safeLimit - 1)
      .order("employee_number", { ascending: true })

    if (error) this.handleDbError(error, "list")

    return {
      data: (data ?? []) as unknown as TeacherRow[],
      count: count ?? 0,
      hasMore: (count ?? 0) > offset + safeLimit,
    }
  }

  // ── Write ─────────────────────────────────────────────────────────

  async create(input: unknown): Promise<TeacherRow> {
    const parsed = TeacherInsertSchema.safeParse(input)
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues
          .map((e: z.ZodIssue) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")
      )
    }

    logger.info("teachers", "create", {
      employee_number: parsed.data.employee_number,
    })

    const { data, error } = await this.db
      .from("teachers")
      .insert(parsed.data as unknown as TeacherInsert)
      .select(SAFE_COLS)
      .single()

    if (error) this.handleDbError(error, "create")
    if (!data) throw new DatabaseError("create — no data returned")
    return data as unknown as TeacherRow
  }

  async update(id: string, input: unknown): Promise<TeacherRow> {
    const parsed = TeacherUpdateSchema.safeParse(input)
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues
          .map((e: z.ZodIssue) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")
      )
    }

    logger.info("teachers", "update", { id })

    const { data, error } = await this.db
      .from("teachers")
      .update(parsed.data as unknown as TeacherUpdate)
      .eq("id", id)
      .select(SAFE_COLS)
      .single()

    if (error?.code === "PGRST116") throw new NotFoundError("Teacher", id)
    if (error) this.handleDbError(error, "update")
    if (!data) throw new NotFoundError("Teacher", id)
    return data as unknown as TeacherRow
  }

  async delete(id: string): Promise<void> {
    logger.info("teachers", "delete", { id })

    const exists = await this.getById(id)
    if (!exists) throw new NotFoundError("Teacher", id)

    const { error } = await this.db.from("teachers").delete().eq("id", id)

    if (error) this.handleDbError(error, "delete")
  }

  // ── Employment status transitions ─────────────────────────────────

  async activate(id: string, startDate: string): Promise<TeacherRow> {
    logger.info("teachers", "activate", { id })
    return this.update(id, {
      employment_status: "active",
      employment_start_date: startDate,
    })
  }

  async terminate(id: string, endDate: string): Promise<TeacherRow> {
    logger.info("teachers", "terminate", { id })
    return this.update(id, {
      employment_status: "terminated",
      employment_end_date: endDate,
    })
  }

  async resign(id: string, endDate: string): Promise<TeacherRow> {
    logger.info("teachers", "resign", { id })
    return this.update(id, {
      employment_status: "resigned",
      employment_end_date: endDate,
    })
  }

  async suspend(id: string): Promise<TeacherRow> {
    logger.info("teachers", "suspend", { id })
    return this.update(id, { employment_status: "suspended" })
  }

  async reinstate(id: string): Promise<TeacherRow> {
    logger.info("teachers", "reinstate", { id })
    return this.update(id, { employment_status: "active" })
  }

  async placeOnLeave(id: string): Promise<TeacherRow> {
    logger.info("teachers", "placeOnLeave", { id })
    return this.update(id, { employment_status: "on_leave" })
  }

  // ── HR verification ───────────────────────────────────────────────

  async verifyHR(id: string): Promise<TeacherRow> {
    logger.info("teachers", "verifyHR", { id })
    return this.update(id, {
      hr_verified: true,
      hr_verificaton_date: new Date().toISOString().split("T")[0],
    })
  }

  // ── Background check ──────────────────────────────────────────────

  async recordBackgroundCheck(
    id: string,
    status: "pending" | "passed" | "failed" | "expired",
    date: string
  ): Promise<TeacherRow> {
    logger.info("teachers", "recordBackgroundCheck", { id, status })
    return this.update(id, {
      background_check_status: status,
      background_check_date: date,
    })
  }

  // ── Class teacher assignment ──────────────────────────────────────

  async assignAsClassTeacher(id: string): Promise<TeacherRow> {
    logger.info("teachers", "assignAsClassTeacher", { id })
    return this.update(id, { is_class_teacher: true })
  }

  async removeAsClassTeacher(id: string): Promise<TeacherRow> {
    logger.info("teachers", "removeAsClassTeacher", { id })
    return this.update(id, { is_class_teacher: false })
  }

  // ── SIS sync ──────────────────────────────────────────────────────

  async syncFromSIS(id: string, sisEmployeeId: string): Promise<TeacherRow> {
    logger.info("teachers", "syncFromSIS", { id, sisEmployeeId })
    return this.update(id, {
      sis_employee_id: sisEmployeeId,
      sis_last_synced_at: new Date().toISOString(),
    })
  }
}
