// src/dal/results.repository.ts
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

type ResultRow = Database["public"]["Tables"]["results"]["Row"]
type ResultInsert = Database["public"]["Tables"]["results"]["Insert"]
type ResultUpdate = Database["public"]["Tables"]["results"]["Update"]

// ── Schemas ───────────────────────────────────────────────────────────

const YEAR_REGEX = /^\d{4}\/\d{4}$/ // 2024/2025

const ResultInsertSchema = z.object({
  // Required / non-nullable
  academic_year: z
    .string()
    .regex(YEAR_REGEX, "Must be in format YYYY/YYYY e.g. 2024/2025"),
  class_subject_id: z.string().uuid(),
  student_id: z.string().uuid(),
  school_id: z.string().uuid(),
  term: z.enum(["term_1", "term_2", "term_3"]),

  // Optional / nullable
  score: z.number().min(0).max(100).nullable().optional(),
  grade: z.string().max(5).nullable().optional(), // e.g. 'A', 'B+', 'EE'
  remarks: z.string().max(500).nullable().optional(),
  posted_by: z.string().uuid().nullable().optional(),
  posted_at: z.string().nullable().optional(),
})

const ResultUpdateSchema = ResultInsertSchema.omit({
  student_id: true, // result always belongs to same student
  class_subject_id: true, // result always belongs to same subject
  school_id: true,
}).partial()

// ── Exported input types ──────────────────────────────────────────────

export type CreateResultInput = z.infer<typeof ResultInsertSchema>
export type UpdateResultInput = z.infer<typeof ResultUpdateSchema>

// ── List options ──────────────────────────────────────────────────────

export interface ListResultsOptions {
  schoolId?: string
  studentId?: string
  classSubjectId?: string
  academicYear?: string
  term?: string
  postedBy?: string
  limit?: number
  offset?: number
}

// ── Pagination result ─────────────────────────────────────────────────

export interface PaginatedResults {
  data: ResultRow[]
  count: number
  hasMore: boolean
}

// ── Summary types ─────────────────────────────────────────────────────

export interface StudentTermSummary {
  studentId: string
  academicYear: string
  term: string
  results: ResultRow[]
  average: number | null
  totalSubjects: number
  graded: number // subjects with a score
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

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const DEFAULT_OFFSET = 0

// ── Repository ────────────────────────────────────────────────────────

export class ResultsRepository {
  constructor(private db: SupabaseClient<Database>) {}

  // ── Error handling ────────────────────────────────────────────────

  private handleDbError(error: PostgrestError, operation: string): never {
    logger.error("results", `PostgREST error during ${operation}`, {
      code: error.code,
      hint: error.hint,
      details: error.details,
    })

    switch (error.code) {
      case "23505":
        throw new ConflictError(
          "Result",
          "student, class_subject, term and academic_year"
        )
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
    return this.db.from("results").select(cols ?? SAFE_COLS)
  }

  // ── Read ──────────────────────────────────────────────────────────

  async getById(id: string): Promise<ResultRow | null> {
    logger.info("results", "getById", { id })

    const { data, error } = await this.safeSelect().eq("id", id).single()

    if (error?.code === "PGRST116") return null
    if (error) this.handleDbError(error, "getById")
    if (!data) return null
    return data as unknown as ResultRow
  }

  async list(options: ListResultsOptions = {}): Promise<PaginatedResults> {
    const {
      schoolId,
      studentId,
      classSubjectId,
      academicYear,
      term,
      postedBy,
      limit = DEFAULT_LIMIT,
      offset = DEFAULT_OFFSET,
    } = options

    const safeLimit = Math.min(limit, MAX_LIMIT)

    logger.info("results", "list", {
      schoolId,
      studentId,
      classSubjectId,
      academicYear,
      term,
      limit: safeLimit,
      offset,
    })

    let q = this.db.from("results").select(SAFE_COLS, { count: "exact" })

    if (schoolId) q = q.eq("school_id", schoolId)
    if (studentId) q = q.eq("student_id", studentId)
    if (classSubjectId) q = q.eq("class_subject_id", classSubjectId)
    if (academicYear) q = q.eq("academic_year", academicYear)
    if (term) q = q.eq("term", term)
    if (postedBy) q = q.eq("posted_by", postedBy)

    const { data, count, error } = await q
      .range(offset, offset + safeLimit - 1)
      .order("academic_year", { ascending: false })
      .order("term", { ascending: true })

    if (error) this.handleDbError(error, "list")

    return {
      data: (data ?? []) as unknown as ResultRow[],
      count: count ?? 0,
      hasMore: (count ?? 0) > offset + safeLimit,
    }
  }

  // Fetches all results for a student in a term and computes summary
  async getStudentTermSummary(
    studentId: string,
    academicYear: string,
    term: string
  ): Promise<StudentTermSummary> {
    logger.info("results", "getStudentTermSummary", {
      studentId,
      academicYear,
      term,
    })

    const { data, error } = await this.safeSelect()
      .eq("student_id", studentId)
      .eq("academic_year", academicYear)
      .eq("term", term)

    if (error) this.handleDbError(error, "getStudentTermSummary")

    const results = (data ?? []) as unknown as ResultRow[]
    const graded = results.filter((r) => r.score !== null)
    const average =
      graded.length > 0
        ? graded.reduce((sum, r) => sum + (r.score ?? 0), 0) / graded.length
        : null

    return {
      studentId,
      academicYear,
      term,
      results,
      average: average !== null ? Math.round(average * 100) / 100 : null,
      totalSubjects: results.length,
      graded: graded.length,
    }
  }

  // Fetches all results for a student across all terms in an academic year
  async getStudentYearResults(
    studentId: string,
    academicYear: string
  ): Promise<ResultRow[]> {
    logger.info("results", "getStudentYearResults", { studentId, academicYear })

    const { data, error } = await this.safeSelect()
      .eq("student_id", studentId)
      .eq("academic_year", academicYear)
      .order("term", { ascending: true })

    if (error) this.handleDbError(error, "getStudentYearResults")
    return (data ?? []) as unknown as ResultRow[]
  }

  // Fetches all results for a subject across all students in a term
  async getSubjectResults(
    classSubjectId: string,
    academicYear: string,
    term: string
  ): Promise<ResultRow[]> {
    logger.info("results", "getSubjectResults", {
      classSubjectId,
      academicYear,
      term,
    })

    const { data, error } = await this.safeSelect()
      .eq("class_subject_id", classSubjectId)
      .eq("academic_year", academicYear)
      .eq("term", term)
      .order("score", { ascending: false })

    if (error) this.handleDbError(error, "getSubjectResults")
    return (data ?? []) as unknown as ResultRow[]
  }

  // ── Write ─────────────────────────────────────────────────────────

  async create(input: unknown): Promise<ResultRow> {
    const parsed = ResultInsertSchema.safeParse(input)
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues
          .map((e: z.ZodIssue) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")
      )
    }

    logger.info("results", "create", {
      student_id: parsed.data.student_id,
      class_subject_id: parsed.data.class_subject_id,
      term: parsed.data.term,
    })

    const { data, error } = await this.db
      .from("results")
      .insert(parsed.data as unknown as ResultInsert)
      .select(SAFE_COLS)
      .single()

    if (error) this.handleDbError(error, "create")
    if (!data) throw new DatabaseError("create — no data returned")
    return data as unknown as ResultRow
  }

  async update(id: string, input: unknown): Promise<ResultRow> {
    const parsed = ResultUpdateSchema.safeParse(input)
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues
          .map((e: z.ZodIssue) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")
      )
    }

    logger.info("results", "update", { id })

    const { data, error } = await this.db
      .from("results")
      .update(parsed.data as unknown as ResultUpdate)
      .eq("id", id)
      .select(SAFE_COLS)
      .single()

    if (error?.code === "PGRST116") throw new NotFoundError("Result", id)
    if (error) this.handleDbError(error, "update")
    if (!data) throw new NotFoundError("Result", id)
    return data as unknown as ResultRow
  }

  async delete(id: string): Promise<void> {
    logger.info("results", "delete", { id })

    const exists = await this.getById(id)
    if (!exists) throw new NotFoundError("Result", id)

    const { error } = await this.db.from("results").delete().eq("id", id)

    if (error) this.handleDbError(error, "delete")
  }

  // ── Posting ───────────────────────────────────────────────────────

  // Marks a result as officially posted by a teacher
  async post(id: string, postedBy: string): Promise<ResultRow> {
    logger.info("results", "post", { id, postedBy })
    return this.update(id, {
      posted_by: postedBy,
      posted_at: new Date().toISOString(),
    })
  }

  // Retracts a posted result — clears posted_by and posted_at
  async retract(id: string): Promise<ResultRow> {
    logger.info("results", "retract", { id })
    return this.update(id, {
      posted_by: null,
      posted_at: null,
    })
  }

  // ── Bulk operations ───────────────────────────────────────────────

  // Upserts multiple results at once — used for bulk score entry
  async bulkUpsert(inputs: unknown[]): Promise<ResultRow[]> {
    logger.info("results", "bulkUpsert", { count: inputs.length })

    const parsed = z.array(ResultInsertSchema).safeParse(inputs)
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues
          .map((e: z.ZodIssue) => `[${e.path.join(".")}]: ${e.message}`)
          .join(", ")
      )
    }

    const { data, error } = await this.db
      .from("results")
      .upsert(parsed.data as unknown as ResultInsert[], {
        onConflict: "student_id, class_subject_id, term, academic_year",
        ignoreDuplicates: false, // update on conflict
      })
      .select(SAFE_COLS)

    if (error) this.handleDbError(error, "bulkUpsert")
    return (data ?? []) as unknown as ResultRow[]
  }

  // Posts all results for a subject in a term at once
  async bulkPost(
    classSubjectId: string,
    academicYear: string,
    term: string,
    postedBy: string
  ): Promise<void> {
    logger.info("results", "bulkPost", {
      classSubjectId,
      academicYear,
      term,
      postedBy,
    })

    const { error } = await this.db
      .from("results")
      .update({
        posted_by: postedBy,
        posted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("class_subject_id", classSubjectId)
      .eq("academic_year", academicYear)
      .eq("term", term)
      .is("posted_at", null) // only post unposted results

    if (error) this.handleDbError(error, "bulkPost")
  }
}
