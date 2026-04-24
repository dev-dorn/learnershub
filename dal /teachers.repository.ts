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

type TeacherRow    = Database["public"]["Tables"]["teachers"]["Row"]
type TeacherInsert = Database["public"]["Tables"]["teachers"]["Insert"]

// ── Internal input types ──────────────────────────────────────────────

export interface InternalTeacherInput {
  // Injected by service — never from client
  user_id:   string   // from supabase auth.users.id
  school_id: string   // from auth session app_metadata

  // From validated client input
  employee_number:        string
  department?:            string | null
  is_class_teacher?:      boolean | null
  employment_status?:     "active" | "on_leave" | "suspended" | "terminated" | "resigned" | null
  employment_start_date?: string | null
  employment_end_date?:   string | null

  // NOT here — only settable via dedicated update methods:
  // background_check_status, background_check_date → updateBackgroundCheck()
  // hr_verified, hr_verificaton_date               → updateHR()
  // sis_employee_id, sis_last_synced_at            → updateSIS()
}

// Narrow update types per operation domain
// Prevents cross-domain field injection at the type level

export interface InternalTeacherUpdate {
  department?:            string | null
  is_class_teacher?:      boolean | null
  employment_start_date?: string | null
}

export interface InternalEmploymentUpdate {
  employment_status:      "active" | "on_leave" | "suspended" | "terminated" | "resigned"
  employment_end_date?:   string | null
  employment_start_date?: string | null
}

export interface InternalHRUpdate {
  hr_verified:         boolean
  hr_verificaton_date: string   // always set to server time by service
}

export interface InternalBackgroundCheckUpdate {
  background_check_status: "pending" | "passed" | "failed" | "expired"
  background_check_date:   string
}

export interface InternalSISUpdate {
  sis_employee_id:    string
  sis_last_synced_at: string   // always set to server time by service
}

// ── List options ──────────────────────────────────────────────────────

// schoolId is intentionally excluded — always passed as a mandatory
// separate param from session context. NEVER add schoolId here.
export interface ListTeachersOptions {
  department?:       string
  employmentStatus?: string
  isClassTeacher?:   boolean
  hrVerified?:       boolean
  limit?:            number
  offset?:           number
}

// ── Result types ──────────────────────────────────────────────────────

export interface PaginatedTeachers {
  data:    TeacherRow[]
  count:   number
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
  "hr_verificaton_date",   // typo preserved from DB schema
  "created_at",
  "updated_at",
  // sis_employee_id and sis_last_synced_at intentionally excluded —
  // internal sync fields, not returned to clients
].join(", ")

const DEFAULT_LIMIT  = 20
const MAX_LIMIT      = 100
const DEFAULT_OFFSET = 0

// ── Repository ────────────────────────────────────────────────────────

export class TeachersRepository {
  constructor(private db: SupabaseClient<Database>) {}

  // ── Error handling ────────────────────────────────────────────────

  private handleDbError(error: PostgrestError, operation: string): never {
    logger.error("teachers", `PostgREST error during ${operation}`, {
      code:    error.code,
      hint:    error.hint,
      details: error.details,
    })
    switch (error.code) {
      case "PGRST125":

    }

    switch (error.code) {
      case "23505": throw new ConflictError("Teacher", "employee_number")
      case "23503": throw new DALError("FOREIGN_KEY_ERROR", `Related record not found: ${operation}`)
      case "23502": throw new DALError("VALIDATION_ERROR", `Required field missing: ${error.details}`)
      case "23514": throw new DALError("VALIDATION_ERROR", `Value out of allowed range: ${error.details}`)
      case "42501": throw new DALError("UNAUTHORIZED", "RLS policy violation — insufficient permissions")
      default:      throw new DatabaseError(operation, error)
    }
  }

  // ── Query helpers ─────────────────────────────────────────────────

  private safeSelect(cols?: string) {
    return this.db.from("teachers").select(cols ?? SAFE_COLS)
  }

  // ── Read ──────────────────────────────────────────────────────────

  async getById(id: string, schoolId: string): Promise<TeacherRow | null> {
    logger.info("teachers", "getById", { id })

    const { data, error } = await this.safeSelect()
      .eq("id", id)
      .eq("school_id", schoolId)  // ← tenant isolation
      .single()

    if (error?.code === "PGRST116") return null
    if (error) this.handleDbError(error, "getById")
    if (!data) return null
    return data as unknown as TeacherRow
  }

  // Primary lookup after Supabase login —
  // maps auth.users.id to the teacher's profile row
  async getByUserId(userId: string, schoolId: string): Promise<TeacherRow | null> {
    logger.info("teachers", "getByUserId", { userId })

    const { data, error } = await this.safeSelect()
      .eq("user_id", userId)
      .eq("school_id", schoolId)  // ← tenant isolation
      .single()

    if (error?.code === "PGRST116") return null
    if (error) this.handleDbError(error, "getByUserId")
    if (!data) return null
    return data as unknown as TeacherRow
  }

  // employee_number is only unique per school — never query without school_id
  async getByEmployeeNumber(
    employeeNumber: string,
    schoolId:       string
  ): Promise<TeacherRow | null> {
    logger.info("teachers", "getByEmployeeNumber", { employeeNumber })

    const { data, error } = await this.safeSelect()
      .eq("employee_number", employeeNumber)
      .eq("school_id", schoolId)  // ← tenant isolation
      .single()

    if (error?.code === "PGRST116") return null
    if (error) this.handleDbError(error, "getByEmployeeNumber")
    if (!data) return null
    return data as unknown as TeacherRow
  }

  async list(options: ListTeachersOptions, schoolId: string): Promise<PaginatedTeachers> {
    const {
      department,
      employmentStatus,
      isClassTeacher,
      hrVerified,
      limit  = DEFAULT_LIMIT,
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

    let q = this.db
      .from("teachers")
      .select(SAFE_COLS, { count: "exact" })
      .eq("school_id", schoolId)  // ← tenant isolation always applied first

    if (department)       q = q.eq("department", department)
    if (employmentStatus) q = q.eq("employment_status", employmentStatus)
    if (isClassTeacher !== undefined) q = q.eq("is_class_teacher", isClassTeacher)
    if (hrVerified !== undefined)     q = q.eq("hr_verified", hrVerified)

    const { data, count, error } = await q
      .range(offset, offset + safeLimit - 1)
      .order("employee_number", { ascending: true })

    if (error) this.handleDbError(error, "list")

    return {
      data:    (data ?? []) as unknown as TeacherRow[],
      count:   count ?? 0,
      hasMore: (count ?? 0) > offset + safeLimit,
    }
  }

  // ── Write ─────────────────────────────────────────────────────────

  async create(record: InternalTeacherInput): Promise<TeacherRow> {
    logger.info("teachers", "create", {
      employee_number: record.employee_number,
      // user_id logged for auditability — no PII
      user_id: record.user_id,
    })

    const { data, error } = await this.db
      .from("teachers")
      .insert(record as unknown as TeacherInsert)
      .select(SAFE_COLS)
      .single()

    if (error) this.handleDbError(error, "create")
    if (!data) throw new DatabaseError("create — no data returned")
    return data as unknown as TeacherRow
  }

  // General content update — department, is_class_teacher, employment_start_date only
  async update(
    id:       string,
    data:     InternalTeacherUpdate,
    schoolId: string
  ): Promise<TeacherRow> {
    return this._update(id, data, schoolId, "update")
  }

  // Employment status transitions — status + optional dates only
  async updateEmployment(
    id:       string,
    data:     InternalEmploymentUpdate,
    schoolId: string
  ): Promise<TeacherRow> {
    return this._update(id, data, schoolId, "updateEmployment")
  }

  // HR verification — hr_verified + hr_verificaton_date only
  // verified_date always set to server time by service, never from client
  async updateHR(
    id:       string,
    data:     InternalHRUpdate,
    schoolId: string
  ): Promise<TeacherRow> {
    return this._update(id, data, schoolId, "updateHR")
  }

  // Background check — status + date only
  // Only reachable via recordBackgroundCheck() which requires HR_ROLES
  async updateBackgroundCheck(
    id:       string,
    data:     InternalBackgroundCheckUpdate,
    schoolId: string
  ): Promise<TeacherRow> {
    return this._update(id, data, schoolId, "updateBackgroundCheck")
  }

  // SIS sync — sis_employee_id + sis_last_synced_at only
  // Only reachable via syncFromSIS() which requires SIS_ROLES
  async updateSIS(
    id:       string,
    data:     InternalSISUpdate,
    schoolId: string
  ): Promise<TeacherRow> {
    return this._update(id, data, schoolId, "updateSIS")
  }

  // Single internal update — all public update methods route here
  // school_id on every update prevents cross-tenant writes
  private async _update(
    id:        string,
    data:      object,
    schoolId:  string,
    operation: string
  ): Promise<TeacherRow> {
    const { data: row, error } = await this.db
      .from("teachers")
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("school_id", schoolId)  // ← tenant isolation on every write
      .select(SAFE_COLS)
      .single()

    if (error?.code === "PGRST116") throw new NotFoundError("Teacher", id)
    if (error) this.handleDbError(error, operation)
    if (!row) throw new NotFoundError("Teacher", id)
    return row as unknown as TeacherRow
  }

  async delete(id: string, schoolId: string): Promise<void> {
    logger.info("teachers", "delete", { id })

    // Single round-trip — no pre-flight getById
    // school_id filter prevents cross-tenant deletes
    const { data, error } = await this.db
      .from("teachers")
      .delete()
      .eq("id", id)
      .eq("school_id", schoolId)  // ← tenant isolation
      .select("id")

    if (error) this.handleDbError(error, "delete")
    if (!data || data.length === 0) throw new NotFoundError("Teacher", id)
  }
}