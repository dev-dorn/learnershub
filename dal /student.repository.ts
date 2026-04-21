import { Database } from "@/types/supabase"
import { z } from "zod";
import { JsonSchema } from "@/lib/utils"
import { BaseRepository } from "@/dal /base.repository"
import { SupabaseClient } from "@supabase/supabase-js"
import { DALError, NotFoundError, ValidationError } from "./errors"
type StudentRow = Database['public']['Tables']['students']['Row'];
type StudentInsert = Database['public']['Tables']['students']['Insert'];
type StudentUpdate = Database['public']['Tables']['students']['Update'];
// -- schema
const StudentInsertSchema = z.object({
  // Required / non-nullable
  user_id: z.string().uuid(),
  admission_number: z.string().min(3).max(50),
  date_of_birth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be in format YYYY-MM-DD"),
  school_id: z.string().uuid(),

  // Optional / nullable
  gender: z
    .enum(["male", "female", "other", "prefer_not_to_say"])
    .nullable()
    .optional(),

  current_class_id: z.string().uuid().nullable().optional(),

  enrollment_status: z
    .enum([
      "active",
      "graduated",
      "transferred_out",
      "suspended",
      "expelled",
      "on_leave",
    ])
    .default("active"),

  enrollment_date: z.string().nullable().optional(),
  graduation_date: z.string().nullable().optional(),
  transfer_date: z.string().nullable().optional(),

  parent_verified: z.boolean().nullable().optional(),
  requires_parental_consent: z.boolean().nullable().optional(),
  parental_consent_given: z.boolean().nullable().optional(),
  parental_consent_date: z.string().nullable().optional(),

  privacy_settings: JsonSchema.nullable().optional(),
})

const StudentUpdateSchema = StudentInsertSchema
  .omit({user_id: true, school_id: true,})
  .partial();

export type CreateStudentInput = z.infer<typeof StudentInsertSchema>;
export type UpdateStudentInput = z.infer<typeof StudentUpdateSchema>;

export interface ListStudentsOptions {
  status?: StudentRow['enrollment_status'];
  classId?: string;
  schoolId?: string;
  limit?: number;
  offset?: number;

}
const SAFE_COLS = [
  'user_id',
  'admission_number',
  'date_of_birth',
  'gender',
  'current_class_id',
  'enrollment_status',
  'enrollment_date',
  'graduation_date',
  'transfer_date',
  'parent_verified',
  'sis_verified',
  'requires_parental_consent',
  'parental_consent_given',
  'parental_consent_date',
  'sis_student_id',
  'sis_last_synced_at',
  'created_at',
  'updated_at',
  'school_id',
].join(', ');

const  DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DEFAULT_OFFSET = 0;

export class StudentsRepository extends BaseRepository<"students"> {
  constructor(db: SupabaseClient<Database>) {
    super(db, "students", SAFE_COLS)
  }
  async getById(id: string): Promise<StudentRow | null> {
    this.log("info", "getById", { id })

    const { data, error } = await this.safeSelect().eq("id", id).single()

    if (error?.code === "PGRST116") return null
    if (error) this.handleDbError(error, "getById")
    return data as unknown as StudentRow
  }
  async getByUserId(userId: string): Promise<StudentRow | null> {
    this.log("info", "getByUserId", { userId })

    const { data, error } = await this.safeSelect()
      .eq("user_id", userId)
      .single()

    if (error?.code === "PGRST116") return null
    if (error) this.handleDbError(error, "getByUserId")
    return data as unknown as StudentRow
  }
  async getByAdmissionNumber(
    admissionNumber: string
  ): Promise<StudentRow | null> {
    this.log("info", "getByAdmissionNumber", { admissionNumber })

    const { data, error } = await this.safeSelect()
      .eq("admission_number", admissionNumber)
      .single()

    if (error?.code === "PGRST116") return null
    if (error) this.handleDbError(error, "getByAdmissionNumber")
    return data as unknown as StudentRow
  }
  async list(options: ListStudentsOptions = {}): Promise<StudentRow[]> {
    const {
      status,
      classId,
      schoolId,
      limit = DEFAULT_LIMIT,
      offset = DEFAULT_OFFSET,
    } = options

    // Cap limit to prevent abuse
    const safeLimit = Math.min(limit, MAX_LIMIT)

    this.log("info", "list", {
      status,
      classId,
      schoolId,
      limit: safeLimit,
      offset,
    })

    let q = this.safeSelect()

    if (status) q = q.eq("enrollment_status", status)
    if (classId) q = q.eq("current_class_id", classId)
    if (schoolId) q = q.eq("school_id", schoolId)

    const { data, error } = await q
      .range(offset, offset + safeLimit - 1)
      .order("admission_number", { ascending: true })

    if (error) this.handleDbError(error, "list")
    return (data ?? []) as unknown as StudentRow[]
  }
  async count(
    options: Pick<ListStudentsOptions, "status" | "classId" | "schoolId"> = {}
  ): Promise<number> {
    this.log("info", "count", options)

    let q = this.db.from("students").select("*", { count: "exact", head: true }) // head:true returns no rows, just count

    if (options.status) q = q.eq("enrollment_status", options.status)
    if (options.classId) q = q.eq("current_class_id", options.classId)
    if (options.schoolId) q = q.eq("school_id", options.schoolId)

    const { count, error } = await q
    if (error) this.handleDbError(error, "count")
    return count ?? 0
  }
  async create(id: string, input: unknown): Promise<StudentRow> {
    const parsed = StudentInsertSchema.safeParse(input)
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues
          .map((e) => `${e.path.join("")}: ${e.message}`)
          .join(", ")
      )
    }
    this.log("info", "create", {
      admission_number: parsed.data.admission_number,
    })

    const { data, error } = await this.db
      .from("students")
      .insert(parsed.data as unknown as StudentInsert)
      .select(SAFE_COLS)
      .single()
    if (error) this.handleDbError(error, "create")
    return data as unknown as StudentRow
  }
  async update(id: string, input: unknown): Promise<StudentRow> {
    const parsed = StudentUpdateSchema.safeParse(input)
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues
          .map((e: z.ZodIssue) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")
      )
    }

    this.log("info", "update", { id })

    const { data, error } = await this.db
      .from("students")
      .update(parsed.data as unknown as StudentUpdate)
      .eq("id", id)
      .select(SAFE_COLS)
      .single()

    if (error?.code === "PGRST116") throw new NotFoundError("Student", id)
    if (error) this.handleDbError(error, "update")
    return data as unknown as StudentRow // ← TS2355 fix — always returns
  }

  async delete(id: string): Promise<void> {
    this.log("info", "delete", { id })

    const exists = await this.getById(id)
    if (!exists) throw new NotFoundError("Student", id)

    const { error } = await this.db.from("students").delete().eq("id", id)

    if (error) this.handleDbError(error, "delete")
  }
  async graduate(id: string, graduationDate: string): Promise<StudentRow> {
    this.log('info', 'graduate', { id })
    return this.update(id, {
      enrollment_status: 'graduated',
      graduation_date:   graduationDate,  // e.g. '2025-06-30'
    })
  }

  async transfer(id: string, transferDate: string): Promise<StudentRow> {
    this.log('info', 'transfer', { id })
    return this.update(id, {
      enrollment_status: 'transferred_out',
      transfer_date:     transferDate,
    })
  }

  async suspend(id: string): Promise<StudentRow> {
    this.log('info', 'suspend', { id })
    return this.update(id, { enrollment_status: 'suspended' })
  }

  async reinstate(id: string): Promise<StudentRow> {
    this.log('info', 'reinstate', { id })
    return this.update(id, { enrollment_status: 'active' })
  }

  async recordParentalConsent(id: string, given: boolean): Promise<StudentRow> {
    this.log('info', 'recordParentalConsent', { id, given })
    return this.update(id, {
      parental_consent_given: given,
      parental_consent_date:  new Date().toISOString().split('T')[0],  // 'YYYY-MM-DD'
    })
  }
}





