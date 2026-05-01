// src/dal/results.repository.ts
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

type ResultRow    = Database["public"]["Tables"]["results"]["Row"]
type ResultInsert = Database["public"]["Tables"]["results"]["Insert"]

// ── Internal input types ──────────────────────────────────────────────

export interface InternalResultInput {
  // Required
  academic_year:    string        // validated upstream — format YYYY/YYYY
  class_subject_id: string
  school_id:        string        // always from session
  student_id:       string
  term:             "term_1" | "term_2" | "term_3"

  // Optional
  score?:     number | null       // 0–100, validated upstream
  grade?:     string | null       // e.g. 'A', 'B+', 'EE' — max 5 chars
  remarks?:   string | null       // max 500 chars
  posted_by?: string | null       // always from session when posting
  posted_at?: string | null
}

// Narrow update types per operation domain
// Prevents cross-domain field injection at the type level

export interface InternalResultUpdate {
  academic_year?: string
  score?:         number | null
  grade?:         string | null
  remarks?:       string | null
}

export interface InternalPostUpdate {
  posted_by: string       // always from session
  posted_at: string
}

export interface InternalRetractUpdate {
  posted_by: null
  posted_at: null
}

// ── List options ──────────────────────────────────────────────────────

// schoolId is intentionally excluded — always passed as a mandatory
// separate param from session context. NEVER add schoolId here.
export interface ListResultsOptions {
  studentId?:      string
  classSubjectId?: string
  academicYear?:   string
  term?:           string
  postedBy?:       string
  limit?:          number
  offset?:         number
}

// ── Result types ──────────────────────────────────────────────────────

export interface PaginatedResults {
  data:    ResultRow[]
  count:   number
  hasMore: boolean
}

export interface StudentTermSummary {
  studentId:     string
  academicYear:  string
  term:          string
  results:       ResultRow[]
  average:       number | null
  totalSubjects: number
  graded:        number           // subjects with a score
}

// ── Constants ─────────────────────────────────────────────────────────

const SAFE_COLS = [
  "id",
  "academic_year",
  "class_subject_id",
  "grade",
  "posted_at",
  "posted_by",
  "remarks",
  "school_id",
  "score",
  "student_id",
  "term",
  "updated_at",
].join(", ")

const DEFAULT_LIMIT  = 50
const MAX_LIMIT      = 200
const DEFAULT_OFFSET = 0

// ── Repository ────────────────────────────────────────────────────────

export class ResultsRepository {
  constructor(private db: SupabaseClient<Database>) {}

  // ── Error handling ────────────────────────────────────────────────

  private handleDbError(error: PostgrestError, operation: string): never {
    logger.error("results", `PostgREST error during ${operation}`, {
      code:    error.code,
      hint:    error.hint,
      details: error.details,
    })

    switch (error.code) {
      case "23505":
        throw new ConflictError("Result", "student, class_subject, term and academic_year")
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
    return this.db.from("results").select(cols ?? SAFE_COLS)
  }

  // ── Read ──────────────────────────────────────────────────────────

  async getById(id: string, schoolId: string): Promise<ResultRow | null> {
    logger.info("results", "getById", { id })

    const { data, error } = await this.safeSelect()
      .eq("id", id)
      .eq("school_id", schoolId)  // ← tenant isolation
      .single()

    if (error?.code === "PGRST116") return null
    if (error) this.handleDbError(error, "getById")
    if (!data) return null
    return data as unknown as ResultRow
  }

  async list(options: ListResultsOptions, schoolId: string): Promise<PaginatedResults> {
    const {
      studentId,
      classSubjectId,
      academicYear,
      term,
      postedBy,
      limit  = DEFAULT_LIMIT,
      offset = DEFAULT_OFFSET,
    } = options

    const safeLimit = Math.min(limit, MAX_LIMIT)

    logger.info("results", "list", {
      schoolId, studentId, classSubjectId,
      academicYear, term, limit: safeLimit, offset,
    })

    let q = this.db
      .from("results")
      .select(SAFE_COLS, { count: "exact" })
      .eq("school_id", schoolId)  // ← tenant isolation always applied first

    if (studentId)      q = q.eq("student_id", studentId)
    if (classSubjectId) q = q.eq("class_subject_id", classSubjectId)
    if (academicYear)   q = q.eq("academic_year", academicYear)
    if (term)           q = q.eq("term", term)
    if (postedBy)       q = q.eq("posted_by", postedBy)

    const { data, count, error } = await q
      .range(offset, offset + safeLimit - 1)
      .order("academic_year", { ascending: false })
      .order("term",          { ascending: true  })

    if (error) this.handleDbError(error, "list")

    return {
      data:    (data ?? []) as unknown as ResultRow[],
      count:   count ?? 0,
      hasMore: (count ?? 0) > offset + safeLimit,
    }
  }

  // All results for a student in a term — computes summary in-process
  async getStudentTermSummary(
    studentId:    string,
    academicYear: string,
    term:         string,
    schoolId:     string   // ← tenant isolation
  ): Promise<StudentTermSummary> {
    logger.info("results", "getStudentTermSummary", { studentId, academicYear, term })

    const { data, error } = await this.safeSelect()
      .eq("student_id",   studentId)
      .eq("academic_year", academicYear)
      .eq("term",          term)
      .eq("school_id",     schoolId)  // ← tenant isolation

    if (error) this.handleDbError(error, "getStudentTermSummary")

    const results = (data ?? []) as unknown as ResultRow[]
    const graded  = results.filter((r) => r.score !== null)
    const sum     = graded.reduce((acc, r) => acc + (r.score ?? 0), 0)
    const average = graded.length > 0
      ? Math.round((sum / graded.length) * 100) / 100
      : null

    return {
      studentId,
      academicYear,
      term,
      results,
      average,
      totalSubjects: results.length,
      graded:        graded.length,
    }
  }

  // All results for a student across all terms in a year
  async getStudentYearResults(
    studentId:    string,
    academicYear: string,
    schoolId:     string   // ← tenant isolation
  ): Promise<ResultRow[]> {
    logger.info("results", "getStudentYearResults", { studentId, academicYear })

    const { data, error } = await this.safeSelect()
      .eq("student_id",    studentId)
      .eq("academic_year", academicYear)
      .eq("school_id",     schoolId)  // ← tenant isolation
      .order("term",       { ascending: true })

    if (error) this.handleDbError(error, "getStudentYearResults")
    return (data ?? []) as unknown as ResultRow[]
  }

  // All results for a subject across all students in a term
  async getSubjectResults(
    classSubjectId: string,
    academicYear:   string,
    term:           string,
    schoolId:       string  // ← tenant isolation
  ): Promise<ResultRow[]> {
    logger.info("results", "getSubjectResults", { classSubjectId, academicYear, term })

    const { data, error } = await this.safeSelect()
      .eq("class_subject_id", classSubjectId)
      .eq("academic_year",    academicYear)
      .eq("term",             term)
      .eq("school_id",        schoolId)  // ← tenant isolation
      .order("score",         { ascending: false })

    if (error) this.handleDbError(error, "getSubjectResults")
    return (data ?? []) as unknown as ResultRow[]
  }

  // ── Write ─────────────────────────────────────────────────────────

  async create(record: InternalResultInput): Promise<ResultRow> {
    logger.info("results", "create", {
      student_id:       record.student_id,
      class_subject_id: record.class_subject_id,
      term:             record.term,
    })

    const { data, error } = await this.db
      .from("results")
      .insert(record as unknown as ResultInsert)
      .select(SAFE_COLS)
      .single()

    if (error) this.handleDbError(error, "create")
    if (!data) throw new DatabaseError("create — no data returned")
    return data as unknown as ResultRow
  }

  // Content update — score, grade, remarks only
  async update(
    id:       string,
    data:     InternalResultUpdate,
    schoolId: string
  ): Promise<ResultRow> {
    logger.info("results", "update", { id })
    return this._update(id, data, schoolId, "update")
  }

  // Post a result — posted_by always from session
  async post(
    id:       string,
    postedBy: string,
    schoolId: string
  ): Promise<ResultRow> {
    logger.info("results", "post", { id, postedBy })
    const data: InternalPostUpdate = {
      posted_by: postedBy,
      posted_at: new Date().toISOString(),
    }
    return this._update(id, data, schoolId, "post")
  }

  // Retract a posted result — clears posted_by and posted_at
  async retract(id: string, schoolId: string): Promise<ResultRow> {
    logger.info("results", "retract", { id })
    const data: InternalRetractUpdate = { posted_by: null, posted_at: null }
    return this._update(id, data, schoolId, "retract")
  }

  // Single internal update — all public update methods route here
  // school_id on every update prevents cross-tenant writes
  private async _update(
    id:        string,
    data:      object,
    schoolId:  string,
    operation: string
  ): Promise<ResultRow> {
    const { data: row, error } = await this.db
      .from("results")
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq("id",        id)
      .eq("school_id", schoolId)  // ← tenant isolation on every write
      .select(SAFE_COLS)
      .single()

    if (error?.code === "PGRST116") throw new NotFoundError("Result", id)
    if (error) this.handleDbError(error, operation)
    if (!row) throw new NotFoundError("Result", id)
    return row as unknown as ResultRow
  }

  async delete(id: string, schoolId: string): Promise<void> {
    logger.info("results", "delete", { id })

    // Single round-trip — no pre-flight getById
    // school_id filter prevents cross-tenant deletes
    const { data, error } = await this.db
      .from("results")
      .delete()
      .eq("id",        id)
      .eq("school_id", schoolId)  // ← tenant isolation
      .select("id")

    if (error) this.handleDbError(error, "delete")
    if (!data || data.length === 0) throw new NotFoundError("Result", id)
  }

  // ── Bulk operations ───────────────────────────────────────────────

  // Upserts multiple results — used for bulk score entry
  // Validation happens upstream in the Server Action
  async bulkUpsert(records: InternalResultInput[], schoolId: string): Promise<ResultRow[]> {
    logger.info("results", "bulkUpsert", { count: records.length })

    // Reject the batch if any record has a mismatched school_id
    if (records.some((r) => r.school_id !== schoolId)) {
      throw new DALError("VALIDATION_ERROR", "All records must belong to the same school")
    }

    const { data, error } = await this.db
      .from("results")
      .upsert(records as unknown as ResultInsert[], {
        onConflict:       "student_id, class_subject_id, term, academic_year",
        ignoreDuplicates: false,  // update on conflict
      })
      .select(SAFE_COLS)

    if (error) this.handleDbError(error, "bulkUpsert")
    return (data ?? []) as unknown as ResultRow[]
  }

  // Posts all unposted results for a subject in a term at once
  async bulkPost(
    classSubjectId: string,
    academicYear:   string,
    term:           string,
    postedBy:       string,  // always from session
    schoolId:       string   // ← tenant isolation
  ): Promise<void> {
    logger.info("results", "bulkPost", { classSubjectId, academicYear, term, postedBy })

    const { error } = await this.db
      .from("results")
      .update({
        posted_by:  postedBy,
        posted_at:  new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("class_subject_id", classSubjectId)
      .eq("academic_year",    academicYear)
      .eq("term",             term)
      .eq("school_id",        schoolId)  // ← tenant isolation
      .is("posted_at",        null)      // only post unposted results

    if (error) this.handleDbError(error, "bulkPost")
  }
}