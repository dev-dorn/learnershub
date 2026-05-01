// src/dal/timetables.repository.ts
import { SupabaseClient, PostgrestError } from '@supabase/supabase-js'
import { Database } from '@/types/supabase'
import { DALError, NotFoundError, ConflictError, DatabaseError } from './errors'
import { logger } from '@/lib/logger'

// ── Types ─────────────────────────────────────────────────────────────

type TimetableRow    = Database['public']['Tables']['timetables']['Row']
type TimetableInsert = Database['public']['Tables']['timetables']['Insert']

// ── Internal input types ──────────────────────────────────────────────

export interface InternalTimetableInput {
  // Required
  academic_year: string        // format YYYY/YYYY, validated upstream
  class_id:      string
  day_of_week:   'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'
  end_time:      string        // HH:MM, validated upstream — must be after start_time
  start_time:    string        // HH:MM, validated upstream
  subject_id:    string
  teacher_id:    string
  school_id:     string        // always from session

  // Optional
  is_active?:     boolean | null
  period_name?:   string | null
  room_location?: string | null
  term?:          'term_1' | 'term_2' | 'term_3' | null
}

// Narrow update types per operation domain
// class_id and school_id are structural — they never change after creation

export interface InternalTimetableUpdate {
  academic_year?: string
  day_of_week?:   'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'
  end_time?:      string
  start_time?:    string
  subject_id?:    string
  teacher_id?:    string
  period_name?:   string | null
  room_location?: string | null
  term?:          'term_1' | 'term_2' | 'term_3' | null
}

export interface InternalActiveUpdate {
  is_active: boolean
}

// ── List options ──────────────────────────────────────────────────────

// schoolId is intentionally excluded — always passed as a mandatory
// separate param from session context. NEVER add schoolId here.
export interface ListTimetablesOptions {
  classId?:      string
  teacherId?:    string
  subjectId?:    string
  dayOfWeek?:    string
  academicYear?: string
  term?:         string
  isActive?:     boolean
  limit?:        number
  offset?:       number
}

// ── Result types ──────────────────────────────────────────────────────

export interface PaginatedTimetables {
  data:    TimetableRow[]
  count:   number
  hasMore: boolean
}

// ── Constants ─────────────────────────────────────────────────────────

const SAFE_COLS = [
  'id',
  'academic_year',
  'class_id',
  'day_of_week',
  'end_time',
  'start_time',
  'subject_id',
  'teacher_id',
  'school_id',
  'is_active',
  'period_name',
  'room_location',
  'term',
  'created_at',
  'updated_at',
].join(', ')

const DEFAULT_LIMIT  = 50   // timetables are typically fetched in bulk
const MAX_LIMIT      = 200
const DEFAULT_OFFSET = 0

const DAY_ORDER: Record<string, number> = {
  monday:    1,
  tuesday:   2,
  wednesday: 3,
  thursday:  4,
  friday:    5,
  saturday:  6,
  sunday:    7,
}

// ── Repository ────────────────────────────────────────────────────────

export class TimetablesRepository {
  constructor(private db: SupabaseClient<Database>) {}

  // ── Error handling ────────────────────────────────────────────────

  private handleDbError(error: PostgrestError, operation: string): never {
    logger.error('timetables', `PostgREST error during ${operation}`, {
      code:    error.code,
      hint:    error.hint,
      details: error.details,
    })

    switch (error.code) {
      case '23505': throw new ConflictError('Timetable', 'class, day, start_time and academic_year')
      case '23503': throw new DALError('FOREIGN_KEY_ERROR', `Related record not found: ${operation}`)
      case '23502': throw new DALError('VALIDATION_ERROR', `Required field missing: ${error.details}`)
      case '23514': throw new DALError('VALIDATION_ERROR', `Value out of allowed range: ${error.details}`)
      case '42501': throw new DALError('UNAUTHORIZED', 'RLS policy violation — insufficient permissions')
      default:      throw new DatabaseError(operation, error)
    }
  }

  // ── Query helpers ─────────────────────────────────────────────────

  private safeSelect(cols?: string) {
    return this.db.from('timetables').select(cols ?? SAFE_COLS)
  }

  // ── Read ──────────────────────────────────────────────────────────

  async getById(id: string, schoolId: string): Promise<TimetableRow | null> {
    logger.info('timetables', 'getById', { id })

    const { data, error } = await this.safeSelect()
      .eq('id', id)
      .eq('school_id', schoolId)  // ← tenant isolation
      .single()

    if (error?.code === 'PGRST116') return null
    if (error) this.handleDbError(error, 'getById')
    if (!data) return null
    return data as unknown as TimetableRow
  }

  async list(options: ListTimetablesOptions, schoolId: string): Promise<PaginatedTimetables> {
    const {
      classId,
      teacherId,
      subjectId,
      dayOfWeek,
      academicYear,
      term,
      isActive,
      limit  = DEFAULT_LIMIT,
      offset = DEFAULT_OFFSET,
    } = options

    const safeLimit = Math.min(limit, MAX_LIMIT)

    logger.info('timetables', 'list', {
      schoolId, classId, teacherId,
      subjectId, dayOfWeek, academicYear,
      term, isActive, limit: safeLimit, offset,
    })

    let q = this.db
      .from('timetables')
      .select(SAFE_COLS, { count: 'exact' })
      .eq('school_id', schoolId)  // ← tenant isolation always applied first

    if (classId)      q = q.eq('class_id', classId)
    if (teacherId)    q = q.eq('teacher_id', teacherId)
    if (subjectId)    q = q.eq('subject_id', subjectId)
    if (dayOfWeek)    q = q.eq('day_of_week', dayOfWeek)
    if (academicYear) q = q.eq('academic_year', academicYear)
    if (term)         q = q.eq('term', term)
    if (isActive !== undefined) q = q.eq('is_active', isActive)

    const { data, count, error } = await q
      .range(offset, offset + safeLimit - 1)
      .order('start_time', { ascending: true })

    if (error) this.handleDbError(error, 'list')

    return {
      data:    (data ?? []) as unknown as TimetableRow[],
      count:   count ?? 0,
      hasMore: (count ?? 0) > offset + safeLimit,
    }
  }

  // Full week schedule for a class, sorted by day then time
  async getWeeklySchedule(
    classId:      string,
    academicYear: string,
    schoolId:     string,  // ← tenant isolation
    term?:        string
  ): Promise<TimetableRow[]> {
    logger.info('timetables', 'getWeeklySchedule', { classId, academicYear, term })

    let q = this.safeSelect()
      .eq('class_id',      classId)
      .eq('academic_year', academicYear)
      .eq('school_id',     schoolId)  // ← tenant isolation
      .eq('is_active',     true)

    if (term) q = q.eq('term', term)

    const { data, error } = await q.order('start_time', { ascending: true })

    if (error) this.handleDbError(error, 'getWeeklySchedule')

    return ((data ?? []) as unknown as TimetableRow[]).sort((a, b) => {
      const dayDiff = (DAY_ORDER[a.day_of_week] ?? 0) - (DAY_ORDER[b.day_of_week] ?? 0)
      if (dayDiff !== 0) return dayDiff
      return a.start_time.localeCompare(b.start_time)
    })
  }

  // All periods a teacher is assigned to in a given week
  async getTeacherSchedule(
    teacherId:    string,
    academicYear: string,
    schoolId:     string,  // ← tenant isolation
    term?:        string
  ): Promise<TimetableRow[]> {
    logger.info('timetables', 'getTeacherSchedule', { teacherId, academicYear, term })

    let q = this.safeSelect()
      .eq('teacher_id',    teacherId)
      .eq('academic_year', academicYear)
      .eq('school_id',     schoolId)  // ← tenant isolation
      .eq('is_active',     true)

    if (term) q = q.eq('term', term)

    const { data, error } = await q.order('start_time', { ascending: true })

    if (error) this.handleDbError(error, 'getTeacherSchedule')

    return ((data ?? []) as unknown as TimetableRow[]).sort((a, b) => {
      const dayDiff = (DAY_ORDER[a.day_of_week] ?? 0) - (DAY_ORDER[b.day_of_week] ?? 0)
      if (dayDiff !== 0) return dayDiff
      return a.start_time.localeCompare(b.start_time)
    })
  }

  // Checks if a teacher already has a period at the same time on the same day
  async hasTeacherConflict(
    teacherId:    string,
    dayOfWeek:    string,
    startTime:    string,
    academicYear: string,
    schoolId:     string,  // ← tenant isolation
    excludeId?:   string   // pass when updating to exclude the current record
  ): Promise<boolean> {
    logger.info('timetables', 'hasTeacherConflict', { teacherId, dayOfWeek, startTime })

    let q = this.safeSelect('id')
      .eq('teacher_id',    teacherId)
      .eq('day_of_week',   dayOfWeek)
      .eq('start_time',    startTime)
      .eq('academic_year', academicYear)
      .eq('school_id',     schoolId)  // ← tenant isolation
      .eq('is_active',     true)

    if (excludeId) q = q.neq('id', excludeId)

    const { data, error } = await q
    if (error) this.handleDbError(error, 'hasTeacherConflict')
    return (data ?? []).length > 0
  }

  // Checks if a class already has a period at the same time on the same day
  async hasClassConflict(
    classId:      string,
    dayOfWeek:    string,
    startTime:    string,
    academicYear: string,
    schoolId:     string,  // ← tenant isolation
    excludeId?:   string
  ): Promise<boolean> {
    logger.info('timetables', 'hasClassConflict', { classId, dayOfWeek, startTime })

    let q = this.safeSelect('id')
      .eq('class_id',      classId)
      .eq('day_of_week',   dayOfWeek)
      .eq('start_time',    startTime)
      .eq('academic_year', academicYear)
      .eq('school_id',     schoolId)  // ← tenant isolation
      .eq('is_active',     true)

    if (excludeId) q = q.neq('id', excludeId)

    const { data, error } = await q
    if (error) this.handleDbError(error, 'hasClassConflict')
    return (data ?? []).length > 0
  }

  // ── Write ─────────────────────────────────────────────────────────

  async create(record: InternalTimetableInput): Promise<TimetableRow> {
    logger.info('timetables', 'create', {
      class_id:    record.class_id,
      teacher_id:  record.teacher_id,
      day_of_week: record.day_of_week,
      start_time:  record.start_time,
    })

    const { data, error } = await this.db
      .from('timetables')
      .insert(record as unknown as TimetableInsert)
      .select(SAFE_COLS)
      .single()

    if (error) this.handleDbError(error, 'create')
    if (!data) throw new DatabaseError('create — no data returned')
    return data as unknown as TimetableRow
  }

  // Schedule content update — timing, subject, teacher, room
  async update(
    id:       string,
    data:     InternalTimetableUpdate,
    schoolId: string
  ): Promise<TimetableRow> {
    logger.info('timetables', 'update', { id })
    return this._update(id, data, schoolId, 'update')
  }

  // Active state update — separate from schedule content
  async updateActiveState(
    id:       string,
    data:     InternalActiveUpdate,
    schoolId: string
  ): Promise<TimetableRow> {
    logger.info('timetables', 'updateActiveState', { id, is_active: data.is_active })
    return this._update(id, data, schoolId, 'updateActiveState')
  }

  // Convenience wrappers — route through updateActiveState
  async activate(id: string, schoolId: string): Promise<TimetableRow> {
    return this.updateActiveState(id, { is_active: true }, schoolId)
  }

  async deactivate(id: string, schoolId: string): Promise<TimetableRow> {
    return this.updateActiveState(id, { is_active: false }, schoolId)
  }

  // Single internal update — all public update methods route here
  // school_id on every update prevents cross-tenant writes
  private async _update(
    id:        string,
    data:      object,
    schoolId:  string,
    operation: string
  ): Promise<TimetableRow> {
    const { data: row, error } = await this.db
      .from('timetables')
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq('id',        id)
      .eq('school_id', schoolId)  // ← tenant isolation on every write
      .select(SAFE_COLS)
      .single()

    if (error?.code === 'PGRST116') throw new NotFoundError('Timetable', id)
    if (error) this.handleDbError(error, operation)
    if (!row) throw new NotFoundError('Timetable', id)
    return row as unknown as TimetableRow
  }

  async delete(id: string, schoolId: string): Promise<void> {
    logger.info('timetables', 'delete', { id })

    // Single round-trip — no pre-flight getById
    // school_id filter prevents cross-tenant deletes
    const { data, error } = await this.db
      .from('timetables')
      .delete()
      .eq('id',        id)
      .eq('school_id', schoolId)  // ← tenant isolation
      .select('id')

    if (error) this.handleDbError(error, 'delete')
    if (!data || data.length === 0) throw new NotFoundError('Timetable', id)
  }

  // ── Bulk operations ───────────────────────────────────────────────

  // Deactivates all timetable entries for a class in a given academic year
  async deactivateByClass(
    classId:      string,
    academicYear: string,
    schoolId:     string   // ← tenant isolation
  ): Promise<void> {
    logger.info('timetables', 'deactivateByClass', { classId, academicYear })

    const { error } = await this.db
      .from('timetables')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('class_id',      classId)
      .eq('academic_year', academicYear)
      .eq('school_id',     schoolId)  // ← tenant isolation

    if (error) this.handleDbError(error, 'deactivateByClass')
  }

  // Deactivates all timetable entries for a teacher — when teacher leaves
  async deactivateByTeacher(
    teacherId: string,
    schoolId:  string   // ← tenant isolation
  ): Promise<void> {
    logger.info('timetables', 'deactivateByTeacher', { teacherId })

    const { error } = await this.db
      .from('timetables')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('teacher_id', teacherId)
      .eq('school_id',  schoolId)  // ← tenant isolation

    if (error) this.handleDbError(error, 'deactivateByTeacher')
  }

  // Reassigns all periods from one teacher to another — substitution
  async reassignTeacher(
    fromTeacherId: string,
    toTeacherId:   string,
    academicYear:  string,
    schoolId:      string,  // ← tenant isolation
    term?:         string
  ): Promise<void> {
    logger.info('timetables', 'reassignTeacher', { fromTeacherId, toTeacherId, academicYear })

    let q = this.db
      .from('timetables')
      .update({ teacher_id: toTeacherId, updated_at: new Date().toISOString() })
      .eq('teacher_id',    fromTeacherId)
      .eq('academic_year', academicYear)
      .eq('school_id',     schoolId)  // ← tenant isolation

    if (term) q = q.eq('term', term)

    const { error } = await q
    if (error) this.handleDbError(error, 'reassignTeacher')
  }
}