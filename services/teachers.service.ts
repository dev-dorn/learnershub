import { z } from "zod"
import { logger } from "@/lib/logger"
import { requireRole } from "@/lib/rbac"

import { Database } from "@/types/supabase"
import {
  ListTeachersOptions,
  PaginatedTeachers,
  TeachersRepository,
} from "@/dal /teachers.repository"
import { ValidationError } from "@/dal /errors"

type TeacherRow = Database["public"]["Tables"]["teachers"]["Row"]

// ── Schemas ───────────────────────────────────────────────────────────

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

const TeacherCreateSchema = z.object({
  // Required
  employee_number: z.string().min(2).max(50),

  // Optional
  department:       z.string().max(100).nullable().optional(),
  is_class_teacher: z.boolean().nullable().optional(),

  employment_status: z
    .enum(["active", "on_leave", "suspended", "terminated", "resigned"])
    .nullable()
    .optional(),

  employment_start_date: z
    .string()
    .regex(DATE_REGEX, "Must be in format YYYY-MM-DD")
    .nullable()
    .optional(),
  employment_end_date: z
    .string()
    .regex(DATE_REGEX, "Must be in format YYYY-MM-DD")
    .nullable()
    .optional(),

  // background_check and hr_verified excluded from create —
  // these are set via dedicated service methods only
  // school_id excluded — always injected from session
})

const TeacherUpdateSchema = z.object({
  department:       z.string().max(100).nullable().optional(),
  is_class_teacher: z.boolean().nullable().optional(),
  employment_start_date: z
    .string()
    .regex(DATE_REGEX, "Must be in format YYYY-MM-DD")
    .nullable()
    .optional(),
})

const BackgroundCheckSchema = z.object({
  status: z.enum(["pending", "passed", "failed", "expired"]),
  date:   z.string().regex(DATE_REGEX, "Must be in format YYYY-MM-DD"),
})

const EmploymentDateSchema = z.object({
  date: z.string().regex(DATE_REGEX, "Must be in format YYYY-MM-DD"),
})

export type CreateTeacherInput = z.infer<typeof TeacherCreateSchema>
export type UpdateTeacherInput = z.infer<typeof TeacherUpdateSchema>

// ── Context ───────────────────────────────────────────────────────────

export interface TeacherContext {
  schoolId: string  // from auth session — never from client
  userId:   string  // from auth session — never from client
  role:     string  // from auth session — never from client
}

// ── Constants ─────────────────────────────────────────────────────────

// TODO: move to src/lib/rbac.ts once roles are finalized
const WRITE_ROLES  = ["admin", "principal"] as const  // HR data — no teachers
const HR_ROLES     = ["admin", "principal"] as const
const SIS_ROLES    = ["admin"] as const               // SIS sync — admin only

// ── Service ───────────────────────────────────────────────────────────

export class TeachersService {
  constructor(private repo: TeachersRepository) {}

  // ── Read ──────────────────────────────────────────────────────────

  async getById(id: string, context: TeacherContext): Promise<TeacherRow | null> {
    return this.repo.getById(id, context.schoolId)
  }

  async getByUserId(userId: string, context: TeacherContext): Promise<TeacherRow | null> {
    return this.repo.getByUserId(userId, context.schoolId)
  }

  async getByEmployeeNumber(
    employeeNumber: string,
    context:        TeacherContext
  ): Promise<TeacherRow | null> {
    return this.repo.getByEmployeeNumber(employeeNumber, context.schoolId)
  }

  async list(options: ListTeachersOptions, context: TeacherContext): Promise<PaginatedTeachers> {
    return this.repo.list(options, context.schoolId)
  }

  // ── Write ─────────────────────────────────────────────────────────

  async create(input: unknown, context: TeacherContext): Promise<TeacherRow> {
    requireRole(context.role, WRITE_ROLES, "create teachers")

    const parsed = TeacherCreateSchema.safeParse(input)
    if (!parsed.success)
      throw new ValidationError(
        parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")
      )

    return this.repo.create({
      ...parsed.data,
      user_id: context.userId,
      school_id: context.schoolId,  // ← always from session
    })
  }

  async update(id: string, input: unknown, context: TeacherContext): Promise<TeacherRow> {
    requireRole(context.role, WRITE_ROLES, "update teachers")

    const parsed = TeacherUpdateSchema.safeParse(input)
    if (!parsed.success)
      throw new ValidationError(
        parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")
      )

    return this.repo.update(id, parsed.data, context.schoolId)
  }

  async delete(id: string, context: TeacherContext): Promise<void> {
    requireRole(context.role, WRITE_ROLES, "delete teachers")
    return this.repo.delete(id, context.schoolId)
  }

  // ── Employment status transitions ─────────────────────────────────

  async activate(id: string, input: unknown, context: TeacherContext): Promise<TeacherRow> {
    requireRole(context.role, HR_ROLES, "activate teachers")

    const parsed = EmploymentDateSchema.safeParse(input)
    if (!parsed.success)
      throw new ValidationError(
        parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")
      )

    logger.info("teachers", "activate", { id, activatedBy: context.userId })

    return this.repo.updateEmployment(id, {
      employment_status:    "active",
      employment_start_date: parsed.data.date,
    }, context.schoolId)
  }

  async terminate(id: string, input: unknown, context: TeacherContext): Promise<TeacherRow> {
    requireRole(context.role, HR_ROLES, "terminate teachers")

    const parsed = EmploymentDateSchema.safeParse(input)
    if (!parsed.success)
      throw new ValidationError(
        parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")
      )

    logger.info("teachers", "terminate", { id, terminatedBy: context.userId })

    return this.repo.updateEmployment(id, {
      employment_status:  "terminated",
      employment_end_date: parsed.data.date,
    }, context.schoolId)
  }

  async resign(id: string, input: unknown, context: TeacherContext): Promise<TeacherRow> {
    requireRole(context.role, HR_ROLES, "resign teachers")

    const parsed = EmploymentDateSchema.safeParse(input)
    if (!parsed.success)
      throw new ValidationError(
        parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")
      )

    logger.info("teachers", "resign", { id, recordedBy: context.userId })

    return this.repo.updateEmployment(id, {
      employment_status:  "resigned",
      employment_end_date: parsed.data.date,
    }, context.schoolId)
  }

  async suspend(id: string, context: TeacherContext): Promise<TeacherRow> {
    requireRole(context.role, HR_ROLES, "suspend teachers")
    logger.info("teachers", "suspend", { id, suspendedBy: context.userId })
    return this.repo.updateEmployment(id, { employment_status: "suspended" }, context.schoolId)
  }

  async reinstate(id: string, context: TeacherContext): Promise<TeacherRow> {
    requireRole(context.role, HR_ROLES, "reinstate teachers")
    logger.info("teachers", "reinstate", { id, reinstatedBy: context.userId })
    return this.repo.updateEmployment(id, { employment_status: "active" }, context.schoolId)
  }

  async placeOnLeave(id: string, context: TeacherContext): Promise<TeacherRow> {
    requireRole(context.role, HR_ROLES, "place teachers on leave")
    logger.info("teachers", "placeOnLeave", { id, recordedBy: context.userId })
    return this.repo.updateEmployment(id, { employment_status: "on_leave" }, context.schoolId)
  }

  // ── HR verification ───────────────────────────────────────────────

  async verifyHR(id: string, context: TeacherContext): Promise<TeacherRow> {
    requireRole(context.role, HR_ROLES, "verify teachers")

    logger.info("teachers", "verifyHR", { id, verifiedBy: context.userId })

    return this.repo.updateHR(id, {
      hr_verified:         true,
      hr_verificaton_date: new Date().toISOString().split("T")[0],  // ← always server time
    }, context.schoolId)
  }

  // ── Background check ──────────────────────────────────────────────

  async recordBackgroundCheck(
    id:      string,
    input:   unknown,
    context: TeacherContext
  ): Promise<TeacherRow> {
    requireRole(context.role, HR_ROLES, "record background checks")

    const parsed = BackgroundCheckSchema.safeParse(input)
    if (!parsed.success)
      throw new ValidationError(
        parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")
      )

    logger.info("teachers", "recordBackgroundCheck", {
      id,
      status:     parsed.data.status,
      recordedBy: context.userId,
    })

    return this.repo.updateBackgroundCheck(id, {
      background_check_status: parsed.data.status,
      background_check_date:   parsed.data.date,
    }, context.schoolId)
  }

  // ── Class teacher assignment ──────────────────────────────────────

  async assignAsClassTeacher(id: string, context: TeacherContext): Promise<TeacherRow> {
    requireRole(context.role, WRITE_ROLES, "assign class teachers")
    return this.repo.update(id, { is_class_teacher: true }, context.schoolId)
  }

  async removeAsClassTeacher(id: string, context: TeacherContext): Promise<TeacherRow> {
    requireRole(context.role, WRITE_ROLES, "remove class teachers")
    return this.repo.update(id, { is_class_teacher: false }, context.schoolId)
  }

  // ── SIS sync ──────────────────────────────────────────────────────
  // Internal — called by SIS integration layer, not by HTTP handlers directly

  async syncFromSIS(
    id:           string,
    sisEmployeeId: string,
    context:      TeacherContext
  ): Promise<TeacherRow> {
    requireRole(context.role, SIS_ROLES, "sync from SIS")

    logger.info("teachers", "syncFromSIS", { id, sisEmployeeId })

    return this.repo.updateSIS(id, {
      sis_employee_id:    sisEmployeeId,
      sis_last_synced_at: new Date().toISOString(),  // ← always server time
    }, context.schoolId)
  }
}