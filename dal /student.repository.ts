// src/dal/students.repository.ts
import { SupabaseClient, PostgrestError } from "@supabase/supabase-js"
import { Database, Json } from "@/types/supabase"
import {
  DALError,
  NotFoundError,
  ConflictError,
  DatabaseError,
} from "./errors"
import { logger } from "@/lib/logger"

// ── Types ─────────────────────────────────────────────────────────────

type StudentRow    = Database["public"]["Tables"]["students"]["Row"]
type StudentInsert = Database["public"]["Tables"]["students"]["Insert"]

// ── Internal input types ──────────────────────────────────────────────

export interface InternalStudentInput {
  // Injected by service — never from client
  user_id:   string   // from auth.users.id
  school_id: string   // from session context

  // From validated client input
  admission_number: string
  date_of_birth:    string   // YYYY-MM-DD

  // Optional
  gender?:           "male" | "female" | "other" | "prefer_not_to_say" | null
  current_class_id?: string | null
  enrollment_status?: | "active" | "graduated" | "transferred_out"
    | "suspended" | "expelled" | "on_leave"
  enrollment_date?:  string | null

  // NOT here — only settable via dedicated methods:
  // graduation_date    → graduate()
  // transfer_date      → transfer()
  // enrollment_status  → graduate(), transfer(), suspend(), reinstate()
  // parental_consent_* → recordParentalConsent()
  // sis_*              → syncFromSIS()
  // privacy_settings   → updatePrivacySettings()
}

// Narrow update types per operation domain

export interface InternalStudentUpdate {
  admission_number?:  string | null
  date_of_birth?:     string | null
  gender?:            "male" | "female" | "other" | "prefer_not_to_say" | null
  current_class_id?:  string | null
  enrollment_date?:   string | null
  requires_parental_consent?: boolean | null
  parent_verified?:   boolean | null
}

export interface InternalStudentEnrollmentUpdate {
  enrollment_status: "active" | "graduated" | "transferred_out"
    | "suspended" | "expelled" | "on_leave"
  graduation_date?:  string | null
  transfer_date?:    string | null
}

export interface InternalConsentUpdate {
  parental_consent_given: boolean
  parental_consent_date:  string   // always server time
}

export interface InternalStudentSISUpdate {
  sis_student_id:    string
  sis_last_synced_at: string   // always server time
  sis_verified?:     boolean
}

export interface InternalPrivacyUpdate {
  privacy_settings: Json | null
}

// ── List options ──────────────────────────────────────────────────────

// schoolId intentionally excluded — always passed as separate mandatory param
// from session context. NEVER add schoolId here.
export interface ListStudentsOptions {
  status?:  StudentRow["enrollment_status"]
  classId?: string
  limit?:   number
  offset?:  number
}

// ── Result types ──────────────────────────────────────────────────────

export interface PaginatedStudents {
  data:    StudentRow[]
  count:   number
  hasMore: boolean
}

// ── Constants ─────────────────────────────────────────────────────────

const SAFE_COLS = [
  "id",
  "user_id",
  "admission_number",
  "date_of_birth",
  "gender",
  "current_class_id",
  "enrollment_status",
  "enrollment_date",
  "graduation_date",
  "transfer_date",
  "parent_verified",
  "requires_parental_consent",
  "parental_consent_given",
  "parental_consent_date",
  "school_id",
  "created_at",
  "updated_at",
  // NOT here — internal sync fields never returned to clients:
  // sis_student_id
  // sis_last_synced_at
  // sis_verified
  // privacy_settings — returned only via getPrivacySettings()
].join(", ")

const DEFAULT_LIMIT  = 20
const MAX_LIMIT      = 100
const DEFAULT_OFFSET = 0

// ── Repository ────────────────────────────────────────────────────────

export class StudentsRepository {
  constructor(private db: SupabaseClient<Database>) {}

  // ── Error handling ────────────────────────────────────────────────

  private handleDbError(error: PostgrestError, operation: string): never {
    logger.error("students", `PostgREST error during ${operation}`, {
      code:    error.code,
      hint:    error.hint,
      details: error.details,
    })

    switch (error.code) {
      case "23505": throw new ConflictError("Student", "admission_number")
      case "23503": throw new DALError("FOREIGN_KEY_ERROR", `Related record not found: ${operation}`)
      case "23502": throw new DALError("VALIDATION_ERROR", `Required field missing: ${error.details}`)
      case "23514": throw new DALError("VALIDATION_ERROR", `Value out of allowed range: ${error.details}`)
      case "42501": throw new DALError("UNAUTHORIZED", "RLS policy violation — insufficient permissions")
      default:      throw new DatabaseError(operation, error)
    }
  }

  // ── Query helpers ─────────────────────────────────────────────────

  private safeSelect(cols?: string) {
    return this.db.from("students").select(cols ?? SAFE_COLS)
  }

  // ── Read ──────────────────────────────────────────────────────────

  async getById(id: string, schoolId: string): Promise<StudentRow | null> {
    logger.info("students", "getById", { id })

    const { data, error } = await this.safeSelect()
      .eq("id", id)
      .eq("school_id", schoolId)   // ← tenant isolation
      .single()

    if (error?.code === "PGRST116") return null
    if (error) this.handleDbError(error, "getById")
    if (!data) return null
    return data as unknown as StudentRow
  }

  // Primary post-login lookup — maps auth.users.id to student record
  async getByUserId(userId: string, schoolId: string): Promise<StudentRow | null> {
    logger.info("students", "getByUserId", { userId })

    const { data, error } = await this.safeSelect()
      .eq("user_id", userId)
      .eq("school_id", schoolId)   // ← tenant isolation
      .single()

    if (error?.code === "PGRST116") return null
    if (error) this.handleDbError(error, "getByUserId")
    if (!data) return null
    return data as unknown as StudentRow
  }

  // admission_number is only unique per school — never query without schoolId
  async getByAdmissionNumber(
    admissionNumber: string,
    schoolId:        string
  ): Promise<StudentRow | null> {
    logger.info("students", "getByAdmissionNumber", { admissionNumber })

    const { data, error } = await this.safeSelect()
      .eq("admission_number", admissionNumber)
      .eq("school_id", schoolId)   // ← tenant isolation
      .single()

    if (error?.code === "PGRST116") return null
    if (error) this.handleDbError(error, "getByAdmissionNumber")
    if (!data) return null
    return data as unknown as StudentRow
  }

  async list(
    options:  ListStudentsOptions,
    schoolId: string   // ← always from session, never from client
  ): Promise<PaginatedStudents> {
    const {
      status,
      classId,
      limit  = DEFAULT_LIMIT,
      offset = DEFAULT_OFFSET,
    } = options

    const safeLimit = Math.min(limit, MAX_LIMIT)

    logger.info("students", "list", {
      schoolId, status, classId,
      limit: safeLimit, offset,
    })

    let q = this.db
      .from("students")
      .select(SAFE_COLS, { count: "exact" })
      .eq("school_id", schoolId)   // ← tenant isolation always applied first

    if (status)  q = q.eq("enrollment_status", status)
    if (classId) q = q.eq("current_class_id", classId)

    const { data, count, error } = await q
      .range(offset, offset + safeLimit - 1)
      .order("admission_number", { ascending: true })

    if (error) this.handleDbError(error, "list")

    return {
      data:    (data ?? []) as unknown as StudentRow[],
      count:   count ?? 0,
      hasMore: (count ?? 0) > offset + safeLimit,
    }
  }

  async count(
    schoolId: string,
    options: Pick<ListStudentsOptions, "status" | "classId"> = {}
  ): Promise<number> {
    logger.info("students", "count", { schoolId, ...options })

    let q = this.db
      .from("students")
      .select("*", { count: "exact", head: true })
      .eq("school_id", schoolId)   // ← tenant isolation

    if (options.status)  q = q.eq("enrollment_status", options.status)
    if (options.classId) q = q.eq("current_class_id", options.classId)

    const { count, error } = await q
    if (error) this.handleDbError(error, "count")
    return count ?? 0
  }

  // Privacy settings — separate query, not in SAFE_COLS
  async getPrivacySettings(
    id:       string,
    schoolId: string
  ): Promise<Json | null> {
    logger.info("students", "getPrivacySettings", { id })

    const { data, error } = await this.db
      .from("students")
      .select("privacy_settings")
      .eq("id", id)
      .eq("school_id", schoolId)
      .single()

    if (error?.code === "PGRST116") return null
    if (error) this.handleDbError(error, "getPrivacySettings")
    return (data?.privacy_settings as Json) ?? null
  }

  // ── Write ─────────────────────────────────────────────────────────

  // Called by createStudentAction — input is pre-validated upstream
  // school_id and user_id always injected by the Server Action
  async create(record: InternalStudentInput): Promise<StudentRow> {
    logger.info("students", "create", {
      admission_number: record.admission_number,
      user_id:          record.user_id,
    })

    const { data, error } = await this.db
      .from("students")
      .insert({
        ...record,
        enrollment_status: record.enrollment_status ?? "active",
      } as unknown as StudentInsert)
      .select(SAFE_COLS)
      .single()

    if (error) this.handleDbError(error, "create")
    if (!data) throw new DatabaseError("create — no data returned")
    return data as unknown as StudentRow
  }

  // General content update — profile fields only
  async update(
    id:       string,
    data:     InternalStudentUpdate,
    schoolId: string
  ): Promise<StudentRow> {
    return this._update(id, data, schoolId, "update")
  }

  // Enrollment status transitions — status + dates only
  async updateEnrollment(
    id:       string,
    data:     InternalStudentEnrollmentUpdate,
    schoolId: string
  ): Promise<StudentRow> {
    return this._update(id, data, schoolId, "updateEnrollment")
  }

  // Parental consent — consent fields only
  // parental_consent_date always set to server time
  async updateConsent(
    id:       string,
    data:     InternalConsentUpdate,
    schoolId: string
  ): Promise<StudentRow> {
    return this._update(id, data, schoolId, "updateConsent")
  }

  // Privacy settings — jsonb field only
  async updatePrivacySettings(
    id:       string,
    data:     InternalPrivacyUpdate,
    schoolId: string
  ): Promise<StudentRow> {
    return this._update(id, data, schoolId, "updatePrivacySettings")
  }

  // SIS sync — only reachable via syncFromSIS() which requires SIS_ROLES
  async updateSIS(
    id:       string,
    data:     InternalStudentSISUpdate,
    schoolId: string
  ): Promise<StudentRow> {
    return this._update(id, data, schoolId, "updateSIS")
  }

  // Single internal update — all public update methods route here
  // school_id on every update prevents cross-tenant writes
  private async _update(
    id:        string,
    data:      object,
    schoolId:  string,
    operation: string
  ): Promise<StudentRow> {
    const { data: row, error } = await this.db
      .from("students")
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("school_id", schoolId)   // ← tenant isolation on every write
      .select(SAFE_COLS)
      .single()

    if (error?.code === "PGRST116") throw new NotFoundError("Student", id)
    if (error) this.handleDbError(error, operation)
    if (!row) throw new NotFoundError("Student", id)
    return row as unknown as StudentRow
  }

  // Single round-trip delete — no pre-flight getById needed
  // school_id filter prevents cross-tenant deletes
  async delete(id: string, schoolId: string): Promise<void> {
    logger.info("students", "delete", { id })

    const { data, error } = await this.db
      .from("students")
      .delete()
      .eq("id", id)
      .eq("school_id", schoolId)   // ← tenant isolation
      .select("id")

    if (error) this.handleDbError(error, "delete")
    if (!data || data.length === 0) throw new NotFoundError("Student", id)
  }

  // ── Enrollment transitions ────────────────────────────────────────

  async graduate(
    id:             string,
    graduationDate: string,
    schoolId:       string
  ): Promise<StudentRow> {
    logger.info("students", "graduate", { id })
    return this.updateEnrollment(id, {
      enrollment_status: "graduated",
      graduation_date:   graduationDate,
    }, schoolId)
  }

  async transfer(
    id:           string,
    transferDate: string,
    schoolId:     string
  ): Promise<StudentRow> {
    logger.info("students", "transfer", { id })
    return this.updateEnrollment(id, {
      enrollment_status: "transferred_out",
      transfer_date:     transferDate,
    }, schoolId)
  }

  async suspend(id: string, schoolId: string): Promise<StudentRow> {
    logger.info("students", "suspend", { id })
    return this.updateEnrollment(id, {
      enrollment_status: "suspended",
    }, schoolId)
  }

  async reinstate(id: string, schoolId: string): Promise<StudentRow> {
    logger.info("students", "reinstate", { id })
    return this.updateEnrollment(id, {
      enrollment_status: "active",
    }, schoolId)
  }

  async expel(id: string, schoolId: string): Promise<StudentRow> {
    logger.info("students", "expel", { id })
    return this.updateEnrollment(id, {
      enrollment_status: "expelled",
    }, schoolId)
  }

  // ── Consent ───────────────────────────────────────────────────────

  async recordParentalConsent(
    id:       string,
    given:    boolean,
    schoolId: string
  ): Promise<StudentRow> {
    logger.info("students", "recordParentalConsent", { id, given })
    return this.updateConsent(id, {
      parental_consent_given: given,
      parental_consent_date:  new Date().toISOString().split("T")[0],
    }, schoolId)
  }

  // ── Class assignment ──────────────────────────────────────────────

  async assignToClass(
    id:       string,
    classId:  string,
    schoolId: string
  ): Promise<StudentRow> {
    logger.info("students", "assignToClass", { id, classId })
    return this.update(id, { current_class_id: classId }, schoolId)
  }

  async removeFromClass(id: string, schoolId: string): Promise<StudentRow> {
    logger.info("students", "removeFromClass", { id })
    return this.update(id, { current_class_id: null }, schoolId)
  }

  // ── SIS sync ──────────────────────────────────────────────────────

  async syncFromSIS(
    id:            string,
    sisStudentId:  string,
    schoolId:      string
  ): Promise<StudentRow> {
    logger.info("students", "syncFromSIS", { id, sisStudentId })
    return this.updateSIS(id, {
      sis_student_id:     sisStudentId,
      sis_last_synced_at: new Date().toISOString(),
      sis_verified:       true,
    }, schoolId)
  }
}



