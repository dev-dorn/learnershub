// src/dal/classes.repository.ts
import { SupabaseClient, PostgrestError } from '@supabase/supabase-js'
import { Database } from '@/types/supabase'
import { z } from 'zod'
import { DALError, NotFoundError, ValidationError, ConflictError, DatabaseError } from './errors'
import { logger } from '@/lib/logger'

// ── Types ─────────────────────────────────────────────────────────────

type ClassRow    = Database['public']['Tables']['classes']['Row']
type ClassInsert = Database['public']['Tables']['classes']['Insert']
type ClassUpdate = Database['public']['Tables']['classes']['Update']

// ── Schemas ───────────────────────────────────────────────────────────

const ClassCreateSchema = z.object({
  // Required / non-nullable
  name:          z.string().min(1).max(100),
  grade_level:   z.string().min(1).max(50),
  academic_year: z.string().regex(/^\d{4}\/\d{4}$/, 'Must be in format YYYY/YYYY e.g. 2024/2025'),
  school_id:     z.string().uuid(),

  // Optional / nullable
  capacity:         z.coerce.number().int().positive().nullable().optional(),
  class_teacher_id: z.string().uuid().nullable().optional(),
  is_active:        z.boolean().nullable().optional().default(true),
})

const ClassUpdateSchema = ClassCreateSchema
  .omit({ school_id: true })  // school should never change after creation
  .partial()

// ── Exported input types ──────────────────────────────────────────────

export type CreateClassInput = z.infer<typeof ClassCreateSchema>
export type UpdateClassInput = z.infer<typeof ClassUpdateSchema>

// ── List options ──────────────────────────────────────────────────────

export interface ListClassesOptions {
  schoolId?:     string
  academicYear?: string
  gradeLevel?:   string
  isActive?:     boolean
  teacherId?:    string
  limit?:        number
  offset?:       number
}

// ── Pagination result ─────────────────────────────────────────────────

export interface PaginatedClasses {
  data:    ClassRow[]
  count:   number
  hasMore: boolean
}

// ── Constants ─────────────────────────────────────────────────────────

const SAFE_COLS = [
  'id',
  'name',
  'grade_level',
  'academic_year',
  'capacity',
  'class_teacher_id',
  'is_active',
  'school_id',
  'created_at',
  'updated_at',
].join(', ')

const DEFAULT_LIMIT  = 20
const MAX_LIMIT      = 100
const DEFAULT_OFFSET = 0

// ── Repository ────────────────────────────────────────────────────────

export class ClassesRepository {
  constructor(private db: SupabaseClient<Database>) {}

  // ── Error handling ────────────────────────────────────────────────

  private handleDbError(error: PostgrestError, operation: string): never {
    logger.error('classes', `PostgREST error during ${operation}`, {
      code:    error.code,
      hint:    error.hint,
      details: error.details,
    })

    switch (error.code) {
      case '23505': throw new ConflictError('Class', 'name and academic year')
      case '23503': throw new DALError('FOREIGN_KEY_ERROR', 'Referenced school or teacher does not exist')
      case '23502': throw new DALError('VALIDATION_ERROR', `Required field missing: ${error.details}`)
      case '23514': throw new DALError('VALIDATION_ERROR', `Value out of allowed range: ${error.details}`)
      case '42501': throw new DALError('UNAUTHORIZED', 'You do not have permission to access this resource')
      default:      throw new DatabaseError(operation, error)
    }
  }

  // ── Query helpers ─────────────────────────────────────────────────

  private safeSelect(cols?: string) {
    return this.db.from('classes').select(cols ?? SAFE_COLS)
  }

  // ── Read ──────────────────────────────────────────────────────────

  async getById(id: string): Promise<ClassRow | null> {
    logger.info('classes', 'getById', { id })

    const { data, error } = await this.safeSelect()
      .eq('id', id)
      .single()

    if (error?.code === 'PGRST116') return null
    if (error) this.handleDbError(error, 'getById')
    if (!data) return null
    return data as unknown as ClassRow
  }

  async getByName(name: string, schoolId: string): Promise<ClassRow | null> {
    logger.info('classes', 'getByName', { name, schoolId })

    const { data, error } = await this.safeSelect()
      .eq('name', name)
      .eq('school_id', schoolId)
      .single()

    if (error?.code === 'PGRST116') return null
    if (error) this.handleDbError(error, 'getByName')
    if (!data) return null
    return data as unknown as ClassRow
  }

  async getByTeacherAndYear(
    teacherId:    string,
    academicYear: string
  ): Promise<ClassRow[]> {
    logger.info('classes', 'getByTeacherAndYear', { teacherId, academicYear })

    const { data, error } = await this.safeSelect()
      .eq('class_teacher_id', teacherId)
      .eq('academic_year', academicYear)
      .eq('is_active', true)

    if (error) this.handleDbError(error, 'getByTeacherAndYear')
    return (data ?? []) as unknown as ClassRow[]
  }

  async list(options: ListClassesOptions = {}): Promise<PaginatedClasses> {
    const {
      schoolId,
      academicYear,
      gradeLevel,
      isActive,
      teacherId,
      limit  = DEFAULT_LIMIT,
      offset = DEFAULT_OFFSET,
    } = options

    const safeLimit = Math.min(limit, MAX_LIMIT)

    logger.info('classes', 'list', {
      schoolId, academicYear, gradeLevel,
      isActive, limit: safeLimit, offset,
    })

    let q = this.db
      .from('classes')
      .select(SAFE_COLS, { count: 'exact' })  // count alongside data in one query

    if (schoolId)              q = q.eq('school_id', schoolId)
    if (academicYear)          q = q.eq('academic_year', academicYear)
    if (gradeLevel)            q = q.eq('grade_level', gradeLevel)
    if (teacherId)             q = q.eq('class_teacher_id', teacherId)
    if (isActive !== undefined) q = q.eq('is_active', isActive)

    const { data, count, error } = await q
      .range(offset, offset + safeLimit - 1)
      .order('grade_level', { ascending: true })
      .order('name',        { ascending: true })

    if (error) this.handleDbError(error, 'list')

    return {
      data:    (data ?? []) as unknown as ClassRow[],
      count:   count ?? 0,
      hasMore: (count ?? 0) > offset + safeLimit,
    }
  }

  // ── Write ─────────────────────────────────────────────────────────

  async create(input: unknown): Promise<ClassRow> {
    const parsed = ClassCreateSchema.safeParse(input)
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues
          .map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`)
          .join(', ')
      )
    }

    logger.info('classes', 'create', {
      name:          parsed.data.name,
      grade_level:   parsed.data.grade_level,
      academic_year: parsed.data.academic_year,
    })

    const { data, error } = await this.db
      .from('classes')
      .insert(parsed.data as unknown as ClassInsert)
      .select(SAFE_COLS)
      .single()

    if (error) this.handleDbError(error, 'create')
    if (!data) throw new DatabaseError('create — no data returned')
    return data as unknown as ClassRow
  }

  async update(id: string, input: unknown): Promise<ClassRow> {
    const parsed = ClassUpdateSchema.safeParse(input)
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues
          .map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`)
          .join(', ')
      )
    }

    logger.info('classes', 'update', { id })

    const { data, error } = await this.db
      .from('classes')
      .update(parsed.data as unknown as ClassUpdate)
      .eq('id', id)
      .select(SAFE_COLS)
      .single()

    if (error?.code === 'PGRST116') throw new NotFoundError('Class', id)
    if (error) this.handleDbError(error, 'update')
    if (!data) throw new NotFoundError('Class', id)
    return data as unknown as ClassRow
  }

  /**
   * Soft delete via is_active flag.
   * Preserves historical data and avoids RLS cascade breaks.
   * Hard delete should be handled via admin scripts with SUPABASE_SERVICE_ROLE_KEY.
   */
  async deactivate(id: string): Promise<void> {
    logger.info('classes', 'deactivate', { id })

    const { error } = await this.db
      .from('classes')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id')
      .single()

    if (error?.code === 'PGRST116') throw new NotFoundError('Class', id)
    if (error) this.handleDbError(error, 'deactivate')
  }

  async activate(id: string): Promise<void> {
    logger.info('classes', 'activate', { id })

    const { error } = await this.db
      .from('classes')
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id')
      .single()

    if (error?.code === 'PGRST116') throw new NotFoundError('Class', id)
    if (error) this.handleDbError(error, 'activate')
  }

  // ── Teacher assignment ────────────────────────────────────────────

  async assignTeacher(id: string, teacherId: string): Promise<ClassRow> {
    logger.info('classes', 'assignTeacher', { id, teacherId })
    return this.update(id, { class_teacher_id: teacherId })
  }

  async removeTeacher(id: string): Promise<ClassRow> {
    logger.info('classes', 'removeTeacher', { id })
    return this.update(id, { class_teacher_id: null })
  }

  // ── SIS sync ──────────────────────────────────────────────────────

  async syncFromSIS(id: string, sisClassId: string): Promise<ClassRow> {
    logger.info('classes', 'syncFromSIS', { id, sisClassId })
    return this.update(id, {
      sis_class_id:       sisClassId,
      sis_last_synced_at: new Date().toISOString() as unknown as Date,
    })
  }
}