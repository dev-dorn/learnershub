import { z } from "zod"
import { logger } from "@/lib/logger"

import { Database } from "@/types/supabase"
import {
  AttendanceRepository,
  AttendanceSummary,
  ClassAttendanceSummary,
  ListAttendanceOptions,
  PaginatedAttendance,
} from "@/dal /attendance.repository"
import { DALError, ValidationError } from "@/dal /errors"

type AttendanceRow = Database["public"]["Tables"]["attendance"]["Row"]

// ── Schemas ───────────────────────────────────────────────────────────

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

const AttendanceInsertSchema = z.object({
  class_id: z.string().uuid(),
  date: z.string().regex(DATE_REGEX, "Must be in format YYYY-MM-DD"),
  status: z.enum(["present", "absent", "late", "excused", "holiday"]),
  student_id: z.string().uuid(),
  notes: z.string().max(500).nullable().optional(),
  session_type: z.enum(["morning", "afternoon", "full_day"]).default("full_day"),
})

const AttendanceUpdateSchema = z.object({
  status: z.enum(["present", "absent", "late", "excused", "holiday"]).optional(),
  notes: z.string().max(500).nullable().optional(),
  session_type: z.enum(["morning", "afternoon", "full_day"]).optional(),
})

export type CreateAttendanceInput = z.infer<typeof AttendanceInsertSchema>
export type UpdateAttendanceInput = z.infer<typeof AttendanceUpdateSchema>

// ── Context ───────────────────────────────────────────────────────────

export interface AttendanceContext {
  schoolId: string
  userId: string
  role: string
}

// ── Constants ─────────────────────────────────────────────────────────

const ALLOWED_ROLES = ["teacher", "admin", "principal"] as const
type AllowedRole = (typeof ALLOWED_ROLES)[number]
const MAX_BULK = 500

// ── Service ───────────────────────────────────────────────────────────

export class AttendanceService {
  constructor(private repo: AttendanceRepository) {}

  private requireWriteRole(role: string): void {
    if (!ALLOWED_ROLES.includes(role as AllowedRole)) {
      throw new DALError("UNAUTHORIZED", `Only ${ALLOWED_ROLES.join(", ")} can record attendance`)
    }
  }

  private parseInsert(input: unknown): CreateAttendanceInput {
    const parsed = AttendanceInsertSchema.safeParse(input)
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")
      )
    }
    return parsed.data
  }

  private parseUpdate(input: unknown): UpdateAttendanceInput {
    const parsed = AttendanceUpdateSchema.safeParse(input)
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")
      )
    }
    return parsed.data
  }

  // ── Read ──────────────────────────────────────────────────────────

  async getById(id: string, context: AttendanceContext): Promise<AttendanceRow | null> {
    return this.repo.getById(id, context.schoolId)
  }

  async getByStudentAndDate(
    studentId: string,
    date: string,
    context: AttendanceContext,
    sessionType?: string
  ): Promise<AttendanceRow | null> {
    return this.repo.getByStudentAndDate(studentId, date, context.schoolId, sessionType)
  }

  async getClassRegister(
    classId: string,
    date: string,
    context: AttendanceContext,
    sessionType?: string
  ): Promise<AttendanceRow[]> {
    return this.repo.getClassRegister(classId, date, context.schoolId, sessionType)
  }

  async list(options: ListAttendanceOptions, context: AttendanceContext): Promise<PaginatedAttendance> {
    return this.repo.list(options, context.schoolId)
  }

  async getStudentSummary(
    studentId: string,
    classId: string,
    dateFrom: string,
    dateTo: string,
    context: AttendanceContext
  ): Promise<AttendanceSummary> {
    return this.repo.getStudentSummary(studentId, classId, dateFrom, dateTo, context.schoolId)
  }

  async getClassDailySummary(
    classId: string,
    date: string,
    context: AttendanceContext,
    sessionType?: string
  ): Promise<ClassAttendanceSummary> {
    return this.repo.getClassDailySummary(classId, date, context.schoolId, sessionType)
  }

  // ── Write ─────────────────────────────────────────────────────────

  async create(input: unknown, context: AttendanceContext): Promise<AttendanceRow> {
    this.requireWriteRole(context.role)
    const parsed = this.parseInsert(input)

    return this.repo.create({
      ...parsed,
      school_id: context.schoolId,
      recorded_by: context.userId,
    })
  }

  async update(id: string, input: unknown, context: AttendanceContext): Promise<AttendanceRow> {
    this.requireWriteRole(context.role)
    const parsed = this.parseUpdate(input)

    return this.repo.update(id, { ...parsed, recorded_by: context.userId }, context.schoolId)
  }

  async delete(id: string, context: AttendanceContext): Promise<void> {
    this.requireWriteRole(context.role)
    return this.repo.delete(id, context.schoolId)
  }

  // ── Status helpers ────────────────────────────────────────────────

  async markPresent(id: string, context: AttendanceContext, notes?: string): Promise<AttendanceRow> {
    return this.update(id, { status: "present", ...(notes && { notes }) }, context)
  }

  async markAbsent(id: string, context: AttendanceContext, notes?: string): Promise<AttendanceRow> {
    return this.update(id, { status: "absent", ...(notes && { notes }) }, context)
  }

  async markLate(id: string, context: AttendanceContext, notes?: string): Promise<AttendanceRow> {
    return this.update(id, { status: "late", ...(notes && { notes }) }, context)
  }

  async markExcused(id: string, context: AttendanceContext, notes?: string): Promise<AttendanceRow> {
    return this.update(id, { status: "excused", ...(notes && { notes }) }, context)
  }

  // ── Bulk operations ───────────────────────────────────────────────

  async bulkRecord(records: unknown[], context: AttendanceContext): Promise<AttendanceRow[]> {
    this.requireWriteRole(context.role)

    if (records.length > MAX_BULK)
      throw new ValidationError(`bulkRecord: max ${MAX_BULK} records per call`)

    const parsed = z.array(AttendanceInsertSchema).safeParse(records)
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((e) => `[${e.path.join(".")}]: ${e.message}`).join(", ")
      )
    }

    const internal = parsed.data.map((r) => ({
      ...r,
      school_id: context.schoolId,
      recorded_by: context.userId,
    }))

    return this.repo.bulkUpsert(internal)
  }

  async markAllAbsent(
    classId: string,
    date: string,
    context: AttendanceContext,
    sessionType: string = "full_day"
  ): Promise<void> {
    this.requireWriteRole(context.role)
    logger.info("attendance", "markAllAbsent", { classId, date, sessionType })

    const [recordedIds, activeStudentIds] = await Promise.all([
      this.repo.getExistingStudentIds(classId, date, context.schoolId, sessionType),
      this.repo.getActiveStudentIds(classId, context.schoolId),
    ])

    const unrecorded = activeStudentIds.filter((id) => !recordedIds.has(id))
    if (unrecorded.length === 0) return

    await this.repo.bulkUpsert(
      unrecorded.map((studentId) => ({
        student_id: studentId,
        class_id: classId,
        school_id: context.schoolId,
        recorded_by: context.userId,
        date,
        session_type: sessionType as "morning" | "afternoon" | "full_day",
        status: "absent" as const,
      }))
    )
  }
}