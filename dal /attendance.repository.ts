import { SupabaseClient, PostgrestError } from "@supabase/supabase-js"
import { Database } from "@/types/supabase"
import {
  DALError,
  NotFoundError,
  ConflictError,
  DatabaseError,
} from "./errors"
import { logger } from "@/lib/logger"

type AttendanceRow = Database["public"]["Tables"]["attendance"]["Row"]
type AttendanceInsert = Database["public"]["Tables"]["attendance"]["Insert"]

export interface ListAttendanceOptions {
  classId?: string
  studentId?: string
  status?: string
  sessionType?: string
  dateFrom?: string
  dateTo?: string
  limit?: number
  offset?: number
}

export interface PaginatedAttendance {
  data: AttendanceRow[]
  count: number
  hasMore: boolean
}

export interface AttendanceSummary {
  studentId: string
  classId: string
  dateFrom: string
  dateTo: string
  total: number
  present: number
  absent: number
  late: number
  excused: number
  holiday: number
  attendanceRate: number
}

export interface ClassAttendanceSummary {
  classId: string
  date: string
  sessionType: string
  total: number
  present: number
  absent: number
  late: number
  excused: number
  attendanceRate: number
}

export interface InternalAttendanceInput {
  class_id: string
  date: string
  status: "present" | "absent" | "late" | "excused" | "holiday"
  student_id: string
  notes?: string | null
  session_type: "morning" | "afternoon" | "full_day"
  school_id: string
  recorded_by: string
}

export interface InternalAttendanceUpdate {
  status?: "present" | "absent" | "late" | "excused" | "holiday"
  notes?: string | null
  session_type?: "morning" | "afternoon" | "full_day"
  recorded_by: string
}

const SAFE_COLS = [
  "id",
  "class_id",
  "date",
  "notes",
  "recorded_by",
  "school_id",
  "session_type",
  "status",
  "student_id",
  "created_at",
  "updated_at",
].join(", ")

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 500
const DEFAULT_OFFSET = 0

export class AttendanceRepository {
  constructor(private db: SupabaseClient<Database>) {}

  private handleDbError(error: PostgrestError, operation: string): never {
    logger.error("attendance", `PostgREST error during ${operation}`, {
      code: error.code,
      hint: error.hint,
      details: error.details,
    })

    switch (error.code) {
      case "23505":
        throw new ConflictError("Attendance", "student, class, date and session_type")
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

  private safeSelect(cols?: string) {
    return this.db.from("attendance").select(cols ?? SAFE_COLS)
  }

  // ── Read ──────────────────────────────────────────────────────────

  async getById(id: string, schoolId: string): Promise<AttendanceRow | null> {
    logger.info("attendance", "getById", { id })

    const { data, error } = await this.safeSelect()
      .eq("id", id)
      .eq("school_id", schoolId)
      .single()

    if (error?.code === "PGRST116") return null
    if (error) this.handleDbError(error, "getById")
    if (!data) return null
    return data as unknown as AttendanceRow
  }

  async getByStudentAndDate(
    studentId: string,
    date: string,
    schoolId: string,
    sessionType: string = "full_day"
  ): Promise<AttendanceRow | null> {
    logger.info("attendance", "getByStudentAndDate", { studentId, date, sessionType })

    const { data, error } = await this.safeSelect()
      .eq("student_id", studentId)
      .eq("date", date)
      .eq("session_type", sessionType)
      .eq("school_id", schoolId)
      .single()

    if (error?.code === "PGRST116") return null
    if (error) this.handleDbError(error, "getByStudentAndDate")
    if (!data) return null
    return data as unknown as AttendanceRow
  }

  async getClassRegister(
    classId: string,
    date: string,
    schoolId: string,
    sessionType: string = "full_day"
  ): Promise<AttendanceRow[]> {
    logger.info("attendance", "getClassRegister", { classId, date, sessionType })

    const { data, error } = await this.safeSelect()
      .eq("class_id", classId)
      .eq("date", date)
      .eq("session_type", sessionType)
      .eq("school_id", schoolId)
      .order("student_id", { ascending: true })

    if (error) this.handleDbError(error, "getClassRegister")
    return (data ?? []) as unknown as AttendanceRow[]
  }

  async list(options: ListAttendanceOptions, schoolId: string): Promise<PaginatedAttendance> {
    const {
      classId,
      studentId,
      status,
      sessionType,
      dateFrom,
      dateTo,
      limit = DEFAULT_LIMIT,
      offset = DEFAULT_OFFSET,
    } = options

    const safeLimit = Math.min(limit, MAX_LIMIT)

    logger.info("attendance", "list", { classId, studentId, status, sessionType, dateFrom, dateTo, limit: safeLimit, offset })

    let q = this.db
      .from("attendance")
      .select(SAFE_COLS, { count: "exact" })
      .eq("school_id", schoolId)

    if (classId) q = q.eq("class_id", classId)
    if (studentId) q = q.eq("student_id", studentId)
    if (status) q = q.eq("status", status)
    if (sessionType) q = q.eq("session_type", sessionType)
    if (dateFrom) q = q.gte("date", dateFrom)
    if (dateTo) q = q.lte("date", dateTo)

    const { data, count, error } = await q
      .range(offset, offset + safeLimit - 1)
      .order("date", { ascending: false })
      .order("student_id", { ascending: true })

    if (error) this.handleDbError(error, "list")

    return {
      data: (data ?? []) as unknown as AttendanceRow[],
      count: count ?? 0,
      hasMore: (count ?? 0) > offset + safeLimit,
    }
  }

  // ── Summaries ─────────────────────────────────────────────────────

  async getStudentSummary(
    studentId: string,
    classId: string,
    dateFrom: string,
    dateTo: string,
    schoolId: string
  ): Promise<AttendanceSummary> {
    logger.info("attendance", "getStudentSummary", { studentId, classId, dateFrom, dateTo })

    const { data, error } = await (
      this.db
        .rpc("get_student_attendance_summary", {
          p_student_id: studentId,
          p_class_id: classId,
          p_date_from: dateFrom,
          p_date_to: dateTo,
          p_school_id: schoolId,
        })
        .single() as any
    )

    if (error) this.handleDbError(error, "getStudentSummary")
    if (!data) throw new DatabaseError("getStudentSummary — no data returned")

    return {
      studentId,
      classId,
      dateFrom,
      dateTo,
      ...(data as unknown as Omit<AttendanceSummary, "studentId" | "classId" | "dateFrom" | "dateTo">),
    }
  }

  async getClassDailySummary(
    classId: string,
    date: string,
    schoolId: string,
    sessionType: string = "full_day"
  ): Promise<ClassAttendanceSummary> {
    logger.info("attendance", "getClassDailySummary", { classId, date, sessionType })

    const { data, error } = await (
      this.db
        .rpc("get_class_daily_attendance_summary", {
          p_class_id: classId,
          p_date: date,
          p_school_id: schoolId,
          p_session_type: sessionType,
        })
        .single() as any
    )

    if (error) this.handleDbError(error, "getClassDailySummary")
    if (!data) throw new DatabaseError("getClassDailySummary — no data returned")

    return {
      classId,
      date,
      sessionType,
      ...(data as unknown as Omit<ClassAttendanceSummary, "classId" | "date" | "sessionType">),
    }
  }

  // ── Write ─────────────────────────────────────────────────────────

  async create(record: InternalAttendanceInput): Promise<AttendanceRow> {
    logger.info("attendance", "create", {
      student_id: record.student_id,
      class_id: record.class_id,
      date: record.date,
      status: record.status,
      session_type: record.session_type,
    })

    const { data, error } = await this.db
      .from("attendance")
      .insert(record as unknown as AttendanceInsert)
      .select(SAFE_COLS)
      .single()

    if (error) this.handleDbError(error, "create")
    if (!data) throw new DatabaseError("create — no data returned")
    return data as unknown as AttendanceRow
  }

  async update(
    id: string,
    data: InternalAttendanceUpdate,
    schoolId: string
  ): Promise<AttendanceRow> {
    logger.info("attendance", "update", { id })

    const { data: row, error } = await this.db
      .from("attendance")
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("school_id", schoolId)
      .select(SAFE_COLS)
      .single()

    if (error?.code === "PGRST116") throw new NotFoundError("Attendance", id)
    if (error) this.handleDbError(error, "update")
    if (!row) throw new NotFoundError("Attendance", id)
    return row as unknown as AttendanceRow
  }

  async delete(id: string, schoolId: string): Promise<void> {
    logger.info("attendance", "delete", { id })

    const { data, error } = await this.db
      .from("attendance")
      .delete()
      .eq("id", id)
      .eq("school_id", schoolId)
      .select("id")

    if (error) this.handleDbError(error, "delete")
    if (!data || data.length === 0) throw new NotFoundError("Attendance", id)
  }

  async bulkUpsert(records: InternalAttendanceInput[]): Promise<AttendanceRow[]> {
    logger.info("attendance", "bulkUpsert", { count: records.length })

    const { data, error } = await this.db
      .from("attendance")
      .upsert(records as unknown as AttendanceInsert[], {
        onConflict: "student_id, class_id, date, session_type",
        ignoreDuplicates: false,
      })
      .select(SAFE_COLS)

    if (error) this.handleDbError(error, "bulkUpsert")
    return (data ?? []) as unknown as AttendanceRow[]
  }

  async getExistingStudentIds(
    classId: string,
    date: string,
    schoolId: string,
    sessionType: string
  ): Promise<Set<string>> {
    const { data } = await this.safeSelect("student_id")
      .eq("class_id", classId)
      .eq("date", date)
      .eq("session_type", sessionType)
      .eq("school_id", schoolId)

    return new Set(
      ((data ?? []) as unknown as AttendanceRow[]).map((r) => r.student_id)
    )
  }

  async getActiveStudentIds(classId: string, schoolId: string): Promise<string[]> {
    const { data, error } = await this.db
      .from("students")
      .select("id")
      .eq("current_class_id", classId)
      .eq("school_id", schoolId)
      .eq("enrollment_status", "active")

    if (error) this.handleDbError(error, "getActiveStudentIds")
    return ((data ?? []) as { id: string }[]).map((s) => s.id)
  }
}