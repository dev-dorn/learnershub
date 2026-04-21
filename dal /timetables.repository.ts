// src/dal/timetables.repository.ts
import { SupabaseClient, PostgrestError } from '@supabase/supabase-js'
import { Database } from '@/types/supabase'
import { z } from 'zod'
import { DALError, NotFoundError, ValidationError, ConflictError, DatabaseError } from './errors'
import { logger } from '@/lib/logger'

// ── Types ─────────────────────────────────────────────────────────────

type TimetableRow    = Database['public']['Tables']['timetables']['Row']
type TimetableInsert = Database['public']['Tables']['timetables']['Insert']
type TimetableUpdate = Database['public']['Tables']['timetables']['Update']

// ── Schemas ───────────────────────────────────────────────────────────

const TIME_REGEX    = /^([01]\d|2[0-3]):([0-5]\d)$/        // HH:MM
const YEAR_REGEX    = /^\d{4}\/\d{4}$/                      // 2024/2025

const TimetableInsertSchema = z.object({
  // Required / non-nullable
  academic_year: z.string().regex(YEAR_REGEX, 'Must be in format YYYY/YYYY e.g. 2024/2025'),
  class_id:      z.string().uuid(),
  day_of_week:   z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']),
  end_time:      z.string().regex(TIME_REGEX, 'Must be in format HH:MM'),
  start_time:    z.string().regex(TIME_REGEX, 'Must be in format HH:MM'),
  subject_id:    z.string().uuid(),
  teacher_id:    z.string().uuid(),
  school_id:     z.string().uuid(),

  // Optional / nullable
  is_active:     z.boolean().nullable().optional().default(true),
  period_name:   z.string().max(50).nullable().optional(),
  room_location: z.string().max(100).nullable().optional(),
  term:          z.enum(['term_1', 'term_2', 'term_3']).nullable().optional(),
}).refine(
  data => data.start_time < data.end_time,
  { message: 'start_time must be before end_time', path: ['start_time'] }
)

const TimetableUpdateSchema = TimetableInsertSchema
  .omit({ school_id: true, class_id: true })  // structural fields never change
  .partial()

// ── Exported input types ──────────────────────────────────────────────

export type CreateTimetableInput = z.infer<typeof TimetableInsertSchema>
export type UpdateTimetableInput = z.infer<typeof TimetableUpdateSchema>

// ── List options ──────────────────────────────────────────────────────

export interface ListTimetablesOptions {
  schoolId?:     string
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

// ── Pagination result ─────────────────────────────────────────────────

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
      case '42501': throw new DALError('UNAUTHORIZED', 'You do not have permission to access this resource')
      default:      throw new DatabaseError(operation, error)
    }
  }

  // ── Query helpers ─────────────────────────────────────────────────

  private safeSelect(cols?: string) {
    return this.db.from('timetables').select(cols ?? SAFE_COLS)
  }

  // ── Read ──────────────────────────────────────────────────────────

  async getById(id: string): Promise<TimetableRow | null> {
    logger.info('timetables', 'getById', { id })

    const { data, error } = await this.safeSelect()
      .eq('id', id)
      .single()

    if (error?.code === 'PGRST116') return null
    if (error) this.handleDbError(error, 'getById')
    if (!data) return null
    return data as unknown as TimetableRow
  }

  async list(options: ListTimetablesOptions = {}): Promise<PaginatedTimetables> {
    const {
      schoolId,
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

    if (schoolId)     q = q.eq('school_id', schoolId)
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

  // Fetches full week schedule for a class, sorted by day then time
  async getWeeklySchedule(
    classId:      string,
    academicYear: string,
    term?:        string
  ): Promise<TimetableRow[]> {
    logger.info('timetables', 'getWeeklySchedule', { classId, academicYear, term })

    let q = this.safeSelect()
      .eq('class_id', classId)
      .eq('academic_year', academicYear)
      .eq('is_active', true)

    if (term) q = q.eq('term', term)

    const { data, error } = await q.order('start_time', { ascending: true })

    if (error) this.handleDbError(error, 'getWeeklySchedule')

    // Sort by day order then start time client-side
    return ((data ?? []) as unknown as TimetableRow[]).sort((a, b) => {
      const dayDiff = (DAY_ORDER[a.day_of_week] ?? 0) - (DAY_ORDER[b.day_of_week] ?? 0)
      if (dayDiff !== 0) return dayDiff
      return a.start_time.localeCompare(b.start_time)
    })
  }

  // Fetches all periods a teacher is assigned to in a given week
  async getTeacherSchedule(
    teacherId:    string,
    academicYear: string,
    term?:        string
  ): Promise<TimetableRow[]> {
    logger.info('timetables', 'getTeacherSchedule', { teacherId, academicYear, term })

    let q = this.safeSelect()
      .eq('teacher_id', teacherId)
      .eq('academic_year', academicYear)
      .eq('is_active', true)

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
    excludeId?:   string   // pass when updating to exclude the current record
  ): Promise<boolean> {
    logger.info('timetables', 'hasTeacherConflict', { teacherId, dayOfWeek, startTime })

    let q = this.safeSelect('id')
      .eq('teacher_id', teacherId)
      .eq('day_of_week', dayOfWeek)
      .eq('start_time', startTime)
      .eq('academic_year', academicYear)
      .eq('is_active', true)

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
    excludeId?:   string
  ): Promise<boolean> {
    logger.info('timetables', 'hasClassConflict', { classId, dayOfWeek, startTime })

    let q = this.safeSelect('id')
      .eq('class_id', classId)
      .eq('day_of_week', dayOfWeek)
      .eq('start_time', startTime)
      .eq('academic_year', academicYear)
      .eq('is_active', true)

    if (excludeId) q = q.neq('id', excludeId)

    const { data, error } = await q
    if (error) this.handleDbError(error, 'hasClassConflict')
    return (data ?? []).length > 0
  }

  // ── Write ─────────────────────────────────────────────────────────

  async create(input: unknown): Promise<TimetableRow> {
    const parsed = TimetableInsertSchema.safeParse(input)
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues
          .map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`)
          .join(', ')
      )
    }

    logger.info('timetables', 'create', {
      class_id:   parsed.data.class_id,
      teacher_id: parsed.data.teacher_id,
      day_of_week: parsed.data.day_of_week,
      start_time: parsed.data.start_time,
    })

    const { data, error } = await this.db
      .from('timetables')
      .insert(parsed.data as unknown as TimetableInsert)
      .select(SAFE_COLS)
      .single()

    if (error) this.handleDbError(error, 'create')
    if (!data) throw new DatabaseError('create — no data returned')
    return data as unknown as TimetableRow
  }

  async update(id: string, input: unknown): Promise<TimetableRow> {
    const parsed = TimetableUpdateSchema.safeParse(input)
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues
          .map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`)
          .join(', ')
      )
    }

    logger.info('timetables', 'update', { id })

    const { data, error } = await this.db
      .from('timetables')
      .update(parsed.data as unknown as TimetableUpdate)
      .eq('id', id)
      .select(SAFE_COLS)
      .single()

    if (error?.code === 'PGRST116') throw new NotFoundError('Timetable', id)
    if (error) this.handleDbError(error, 'update')
    if (!data) throw new NotFoundError('Timetable', id)
    return data as unknown as TimetableRow
  }

  async delete(id: string): Promise<void> {
    logger.info('timetables', 'delete', { id })

    const exists = await this.getById(id)
    if (!exists) throw new NotFoundError('Timetable', id)

    const { error } = await this.db
      .from('timetables')
      .delete()
      .eq('id', id)

    if (error) this.handleDbError(error, 'delete')
  }

  // ── Status ────────────────────────────────────────────────────────

  async activate(id: string): Promise<TimetableRow> {
    logger.info('timetables', 'activate', { id })
    return this.update(id, { is_active: true })
  }

  async deactivate(id: string): Promise<TimetableRow> {
    logger.info('timetables', 'deactivate', { id })
    return this.update(id, { is_active: false })
  }

  // ── Bulk operations ───────────────────────────────────────────────

  // Deactivates all timetable entries for a class in a given academic year
  async deactivateByClass(classId: string, academicYear: string): Promise<void> {
    logger.info('timetables', 'deactivateByClass', { classId, academicYear })

    const { error } = await this.db
      .from('timetables')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('class_id', classId)
      .eq('academic_year', academicYear)

    if (error) this.handleDbError(error, 'deactivateByClass')
  }

  // Deactivates all timetable entries for a teacher — useful when teacher leaves
  async deactivateByTeacher(teacherId: string): Promise<void> {
    logger.info('timetables', 'deactivateByTeacher', { teacherId })

    const { error } = await this.db
      .from('timetables')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('teacher_id', teacherId)

    if (error) this.handleDbError(error, 'deactivateByTeacher')
  }

  // Reassigns all periods from one teacher to another — useful for substitution
  async reassignTeacher(
    fromTeacherId: string,
    toTeacherId:   string,
    academicYear:  string,
    term?:         string
  ): Promise<void> {
    logger.info('timetables', 'reassignTeacher', { fromTeacherId, toTeacherId, academicYear })

    let q = this.db
      .from('timetables')
      .update({ teacher_id: toTeacherId, updated_at: new Date().toISOString() })
      .eq('teacher_id', fromTeacherId)
      .eq('academic_year', academicYear)

    if (term) q = q.eq('term', term)

    const { error } = await q
    if (error) this.handleDbError(error, 'reassignTeacher')
  }
}