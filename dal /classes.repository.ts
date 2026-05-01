// src/dal/classes.repository.ts
import { SupabaseClient, PostgrestError } from '@supabase/supabase-js'
import { Database } from '@/types/supabase'
import { DALError, NotFoundError, ConflictError, DatabaseError } from './errors'
import { logger } from '@/lib/logger'

// ── Types ─────────────────────────────────────────────────────────────

type ClassRow    = Database['public']['Tables']['classes']['Row']
type ClassInsert = Database['public']['Tables']['classes']['Insert']

// ── Internal input types ──────────────────────────────────────────────

export interface InternalClassInput {
  // Injected by service — never from client
  school_id: string   // from session context

  // From validated client input
  name:          string
  grade_level:   string
  academic_year: string   // YYYY/YYYY

  // Optional
  capacity?:         number | null
  class_teacher_id?: string | null
  is_active?:        boolean | null
}

// Narrow update types per operation domain

export interface InternalClassUpdate {
  name?:          string | null
  grade_level?:   string | null
  academic_year?: string | null
  capacity?:      number | null
}

export interface InternalClassTeacherUpdate {
  class_teacher_id: string | null
}

export interface InternalClassStatusUpdate {
  is_active:  boolean
  updated_at: string   // always server time
}

export interface InternalClassSISUpdate {
  sis_class_id:       string
  sis_last_synced_at: string   // always server time
}

// ── List options ──────────────────────────────────────────────────────

// schoolId intentionally excluded — always passed as separate mandatory param
export interface ListClassesOptions {
  academicYear?: string
  gradeLevel?:   string
  isActive?:     boolean
  teacherId?:    string
  limit?:        number
  offset?:       number
}

// ── Result types ──────────────────────────────────────────────────────

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
  // NOT here — internal sync fields:
  // sis_class_id
  // sis_last_synced_at
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
      case '42501': throw new DALError('UNAUTHORIZED', 'RLS policy violation — insufficient permissions')
      default:      throw new DatabaseError(operation, error)
    }
  }

  // ── Query helpers ─────────────────────────────────────────────────

  private safeSelect(cols?: string) {
    return this.db.from('classes').select(cols ?? SAFE_COLS)
  }

  // ── Read ──────────────────────────────────────────────────────────

  async getById(id: string, schoolId: string): Promise<ClassRow | null> {
    logger.info('classes', 'getById', { id })

    const { data, error } = await this.safeSelect()
      .eq('id', id)
      .eq('school_id', schoolId)   // ← tenant isolation
      .single()

    if (error?.code === 'PGRST116') return null
    if (error) this.handleDbError(error, 'getById')
    if (!data) return null
    return data as unknown as ClassRow
  }

  // name is only unique per school — never query without schoolId
  async getByName(
    name:     string,
    schoolId: string
  ): Promise<ClassRow | null> {
    logger.info('classes', 'getByName', { name, schoolId })

    const { data, error } = await this.safeSelect()
      .eq('name', name)
      .eq('school_id', schoolId)   // ← tenant isolation
      .single()

    if (error?.code === 'PGRST116') return null
    if (error) this.handleDbError(error, 'getByName')
    if (!data) return null
    return data as unknown as ClassRow
  }

  async getByTeacherAndYear(
    teacherId:    string,
    academicYear: string,
    schoolId:     string
  ): Promise<ClassRow[]> {
    logger.info('classes', 'getByTeacherAndYear', { teacherId, academicYear })

    const { data, error } = await this.safeSelect()
      .eq('class_teacher_id', teacherId)
      .eq('academic_year', academicYear)
      .eq('school_id', schoolId)   // ← tenant isolation
      .eq('is_active', true)

    if (error) this.handleDbError(error, 'getByTeacherAndYear')
    return (data ?? []) as unknown as ClassRow[]
  }

  async list(
    options:  ListClassesOptions,
    schoolId: string   // ← always from session, never from client
  ): Promise<PaginatedClasses> {
    const {
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
      .select(SAFE_COLS, { count: 'exact' })
      .eq('school_id', schoolId)   // ← tenant isolation always applied first

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

  // Called by createClassAction — school_id always injected by Server Action
  async create(record: InternalClassInput): Promise<ClassRow> {
    logger.info('classes', 'create', {
      name:          record.name,
      grade_level:   record.grade_level,
      academic_year: record.academic_year,
    })

    const { data, error } = await this.db
      .from('classes')
      .insert({
        ...record,
        is_active: record.is_active ?? true,
      } as unknown as ClassInsert)
      .select(SAFE_COLS)
      .single()

    if (error) this.handleDbError(error, 'create')
    if (!data) throw new DatabaseError('create — no data returned')
    return data as unknown as ClassRow
  }

  // General content update — name, grade_level, academic_year, capacity
  async update(
    id:       string,
    data:     InternalClassUpdate,
    schoolId: string
  ): Promise<ClassRow> {
    return this._update(id, data, schoolId, 'update')
  }

  // Teacher assignment — class_teacher_id only
  async updateTeacher(
    id:       string,
    data:     InternalClassTeacherUpdate,
    schoolId: string
  ): Promise<ClassRow> {
    return this._update(id, data, schoolId, 'updateTeacher')
  }

  // Status — is_active only
  async updateStatus(
    id:       string,
    data:     InternalClassStatusUpdate,
    schoolId: string
  ): Promise<void> {
    logger.info('classes', 'updateStatus', { id, is_active: data.is_active })

    const { error } = await this.db
      .from('classes')
      .update(data)
      .eq('id', id)
      .eq('school_id', schoolId)   // ← tenant isolation
      .select('id')
      .single()

    if (error?.code === 'PGRST116') throw new NotFoundError('Class', id)
    if (error) this.handleDbError(error, 'updateStatus')
  }

  // SIS sync — sis fields only
  async updateSIS(
    id:       string,
    data:     InternalClassSISUpdate,
    schoolId: string
  ): Promise<ClassRow> {
    return this._update(id, data, schoolId, 'updateSIS')
  }

  // Single internal update — all public update methods route here
  private async _update(
    id:        string,
    data:      object,
    schoolId:  string,
    operation: string
  ): Promise<ClassRow> {
    const { data: row, error } = await this.db
      .from('classes')
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('school_id', schoolId)   // ← tenant isolation on every write
      .select(SAFE_COLS)
      .single()

    if (error?.code === 'PGRST116') throw new NotFoundError('Class', id)
    if (error) this.handleDbError(error, operation)
    if (!row) throw new NotFoundError('Class', id)
    return row as unknown as ClassRow
  }

  // Single round-trip delete — no pre-flight getById needed
  async delete(id: string, schoolId: string): Promise<void> {
    logger.info('classes', 'delete', { id })

    const { data, error } = await this.db
      .from('classes')
      .delete()
      .eq('id', id)
      .eq('school_id', schoolId)   // ← tenant isolation
      .select('id')

    if (error) this.handleDbError(error, 'delete')
    if (!data || data.length === 0) throw new NotFoundError('Class', id)
  }

  // ── Status transitions ────────────────────────────────────────────

  async activate(id: string, schoolId: string): Promise<void> {
    logger.info('classes', 'activate', { id })
    return this.updateStatus(id, {
      is_active:  true,
      updated_at: new Date().toISOString(),
    }, schoolId)
  }

  async deactivate(id: string, schoolId: string): Promise<void> {
    logger.info('classes', 'deactivate', { id })
    return this.updateStatus(id, {
      is_active:  false,
      updated_at: new Date().toISOString(),
    }, schoolId)
  }

  // ── Teacher assignment ────────────────────────────────────────────

  async assignTeacher(
    id:        string,
    teacherId: string,
    schoolId:  string
  ): Promise<ClassRow> {
    logger.info('classes', 'assignTeacher', { id, teacherId })
    return this.updateTeacher(id, { class_teacher_id: teacherId }, schoolId)
  }

  async removeTeacher(id: string, schoolId: string): Promise<ClassRow> {
    logger.info('classes', 'removeTeacher', { id })
    return this.updateTeacher(id, { class_teacher_id: null }, schoolId)
  }

  // ── SIS sync ──────────────────────────────────────────────────────

  async syncFromSIS(
    id:         string,
    sisClassId: string,
    schoolId:   string
  ): Promise<ClassRow> {
    logger.info('classes', 'syncFromSIS', { id, sisClassId })
    return this.updateSIS(id, {
      sis_class_id:       sisClassId,
      sis_last_synced_at: new Date().toISOString(),
    }, schoolId)
  }
}