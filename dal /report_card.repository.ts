// src/dal/report_cards.repository.ts
import { SupabaseClient, PostgrestError } from '@supabase/supabase-js'
import { Database } from '@/types/supabase'
import { z } from 'zod'
import { DALError, NotFoundError, ValidationError, ConflictError, DatabaseError } from './errors'
import { logger } from '@/lib/logger'

// ── Types ─────────────────────────────────────────────────────────────

type ReportCardRow    = Database['public']['Tables']['report_cards']['Row']
type ReportCardInsert = Database['public']['Tables']['report_cards']['Insert']
type ReportCardUpdate = Database['public']['Tables']['report_cards']['Update']

// ── Schemas ───────────────────────────────────────────────────────────

const YEAR_REGEX = /^\d{4}\/\d{4}$/  // 2024/2025

const ReportCardInsertSchema = z.object({
  // Required / non-nullable
  academic_year: z.string().regex(YEAR_REGEX, 'Must be in format YYYY/YYYY e.g. 2024/2025'),
  class_id:      z.string().uuid(),
  student_id:    z.string().uuid(),
  school_id:     z.string().uuid(),
  term:          z.enum(['term_1', 'term_2', 'term_3']),

  // Optional / nullable — computed fields, set by system
  average_score:      z.number().min(0).max(100).nullable().optional(),
  total_score:        z.number().min(0).nullable().optional(),
  out_of:             z.number().min(0).nullable().optional(),
  position_in_class:  z.number().int().positive().nullable().optional(),

  // Optional / nullable — comments
  teacher_comment:    z.string().max(1000).nullable().optional(),
  principal_comment:  z.string().max(1000).nullable().optional(),

  // Optional / nullable — publishing
  is_published: z.boolean().nullable().optional().default(false),
  published_at: z.string().nullable().optional(),
  created_by:   z.string().uuid().nullable().optional(),
})

const ReportCardUpdateSchema = ReportCardInsertSchema
  .omit({
    student_id: true,  // always belongs to same student
    class_id:   true,  // always belongs to same class
    school_id:  true,  // never changes
  })
  .partial()

// ── Exported input types ──────────────────────────────────────────────

export type CreateReportCardInput = z.infer<typeof ReportCardInsertSchema>
export type UpdateReportCardInput = z.infer<typeof ReportCardUpdateSchema>

// ── List options ──────────────────────────────────────────────────────

export interface ListReportCardsOptions {
  schoolId?:     string
  studentId?:    string
  classId?:      string
  academicYear?: string
  term?:         string
  isPublished?:  boolean
  createdBy?:    string
  limit?:        number
  offset?:       number
}

// ── Pagination result ─────────────────────────────────────────────────

export interface PaginatedReportCards {
  data:    ReportCardRow[]
  count:   number
  hasMore: boolean
}

// ── Class ranking result ──────────────────────────────────────────────

export interface ClassRanking {
  studentId:        string
  reportCardId:     string
  averageScore:     number | null
  totalScore:       number | null
  positionInClass:  number | null
}

// ── Constants ─────────────────────────────────────────────────────────

const SAFE_COLS = [
  'id',
  'academic_year',
  'average_score',
  'class_id',
  'created_at',
  'created_by',
  'is_published',
  'out_of',
  'position_in_class',
  'principal_comment',
  'published_at',
  'school_id',
  'student_id',
  'teacher_comment',
  'term',
  'total_score',
  'updated_at',
].join(', ')

const DEFAULT_LIMIT  = 50
const MAX_LIMIT      = 200
const DEFAULT_OFFSET = 0

// ── Repository ────────────────────────────────────────────────────────

export class ReportCardsRepository {
  constructor(private db: SupabaseClient<Database>) {}

  // ── Error handling ────────────────────────────────────────────────

  private handleDbError(error: PostgrestError, operation: string): never {
    logger.error('report_cards', `PostgREST error during ${operation}`, {
      code:    error.code,
      hint:    error.hint,
      details: error.details,
    })

    switch (error.code) {
      case '23505': throw new ConflictError('ReportCard', 'student, class, term and academic_year')
      case '23503': throw new DALError('FOREIGN_KEY_ERROR', `Related record not found: ${operation}`)
      case '23502': throw new DALError('VALIDATION_ERROR', `Required field missing: ${error.details}`)
      case '23514': throw new DALError('VALIDATION_ERROR', `Value out of allowed range: ${error.details}`)
      case '42501': throw new DALError('UNAUTHORIZED', 'You do not have permission to access this resource')
      default:      throw new DatabaseError(operation, error)
    }
  }

  // ── Query helpers ─────────────────────────────────────────────────

  private safeSelect(cols?: string) {
    return this.db.from('report_cards').select(cols ?? SAFE_COLS)
  }

  // ── Read ──────────────────────────────────────────────────────────

  async getById(id: string): Promise<ReportCardRow | null> {
    logger.info('report_cards', 'getById', { id })

    const { data, error } = await this.safeSelect()
      .eq('id', id)
      .single()

    if (error?.code === 'PGRST116') return null
    if (error) this.handleDbError(error, 'getById')
    if (!data) return null
    return data as unknown as ReportCardRow
  }

  // Fetches a specific student's report card for a term
  async getByStudentAndTerm(
    studentId:    string,
    academicYear: string,
    term:         string
  ): Promise<ReportCardRow | null> {
    logger.info('report_cards', 'getByStudentAndTerm', { studentId, academicYear, term })

    const { data, error } = await this.safeSelect()
      .eq('student_id', studentId)
      .eq('academic_year', academicYear)
      .eq('term', term)
      .single()

    if (error?.code === 'PGRST116') return null
    if (error) this.handleDbError(error, 'getByStudentAndTerm')
    if (!data) return null
    return data as unknown as ReportCardRow
  }

  // Fetches all report cards for a student across all terms in a year
  async getStudentHistory(
    studentId:    string,
    academicYear: string
  ): Promise<ReportCardRow[]> {
    logger.info('report_cards', 'getStudentHistory', { studentId, academicYear })

    const { data, error } = await this.safeSelect()
      .eq('student_id', studentId)
      .eq('academic_year', academicYear)
      .order('term', { ascending: true })

    if (error) this.handleDbError(error, 'getStudentHistory')
    return (data ?? []) as unknown as ReportCardRow[]
  }

  async list(options: ListReportCardsOptions = {}): Promise<PaginatedReportCards> {
    const {
      schoolId,
      studentId,
      classId,
      academicYear,
      term,
      isPublished,
      createdBy,
      limit  = DEFAULT_LIMIT,
      offset = DEFAULT_OFFSET,
    } = options

    const safeLimit = Math.min(limit, MAX_LIMIT)

    logger.info('report_cards', 'list', {
      schoolId, studentId, classId,
      academicYear, term, isPublished,
      limit: safeLimit, offset,
    })

    let q = this.db
      .from('report_cards')
      .select(SAFE_COLS, { count: 'exact' })

    if (schoolId)     q = q.eq('school_id', schoolId)
    if (studentId)    q = q.eq('student_id', studentId)
    if (classId)      q = q.eq('class_id', classId)
    if (academicYear) q = q.eq('academic_year', academicYear)
    if (term)         q = q.eq('term', term)
    if (createdBy)    q = q.eq('created_by', createdBy)
    if (isPublished !== undefined) q = q.eq('is_published', isPublished)

    const { data, count, error } = await q
      .range(offset, offset + safeLimit - 1)
      .order('academic_year', { ascending: false })
      .order('term',          { ascending: true })

    if (error) this.handleDbError(error, 'list')

    return {
      data:    (data ?? []) as unknown as ReportCardRow[],
      count:   count ?? 0,
      hasMore: (count ?? 0) > offset + safeLimit,
    }
  }

  // Returns class ranking for a term sorted by average score
  async getClassRankings(
    classId:      string,
    academicYear: string,
    term:         string
  ): Promise<ClassRanking[]> {
    logger.info('report_cards', 'getClassRankings', { classId, academicYear, term })

    const { data, error } = await this.safeSelect(
      'id, student_id, average_score, total_score, position_in_class'
    )
      .eq('class_id', classId)
      .eq('academic_year', academicYear)
      .eq('term', term)
      .order('position_in_class', { ascending: true })

    if (error) this.handleDbError(error, 'getClassRankings')

    return ((data ?? []) as unknown as ReportCardRow[]).map(r => ({
      studentId:       r.student_id,
      reportCardId:    r.id,
      averageScore:    r.average_score,
      totalScore:      r.total_score,
      positionInClass: r.position_in_class,
    }))
  }

  // ── Write ─────────────────────────────────────────────────────────

  async create(input: unknown): Promise<ReportCardRow> {
    const parsed = ReportCardInsertSchema.safeParse(input)
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues
          .map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`)
          .join(', ')
      )
    }

    logger.info('report_cards', 'create', {
      student_id:   parsed.data.student_id,
      class_id:     parsed.data.class_id,
      term:         parsed.data.term,
      academic_year: parsed.data.academic_year,
    })

    const { data, error } = await this.db
      .from('report_cards')
      .insert(parsed.data as unknown as ReportCardInsert)
      .select(SAFE_COLS)
      .single()

    if (error) this.handleDbError(error, 'create')
    if (!data) throw new DatabaseError('create — no data returned')
    return data as unknown as ReportCardRow
  }

  async update(id: string, input: unknown): Promise<ReportCardRow> {
    const parsed = ReportCardUpdateSchema.safeParse(input)
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues
          .map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`)
          .join(', ')
      )
    }

    logger.info('report_cards', 'update', { id })

    const { data, error } = await this.db
      .from('report_cards')
      .update(parsed.data as unknown as ReportCardUpdate)
      .eq('id', id)
      .select(SAFE_COLS)
      .single()

    if (error?.code === 'PGRST116') throw new NotFoundError('ReportCard', id)
    if (error) this.handleDbError(error, 'update')
    if (!data) throw new NotFoundError('ReportCard', id)
    return data as unknown as ReportCardRow
  }

  async delete(id: string): Promise<void> {
    logger.info('report_cards', 'delete', { id })

    const exists = await this.getById(id)
    if (!exists) throw new NotFoundError('ReportCard', id)

    const { error } = await this.db
      .from('report_cards')
      .delete()
      .eq('id', id)

    if (error) this.handleDbError(error, 'delete')
  }

  // ── Scores — computed fields set by system ────────────────────────

  async updateScores(
    id:           string,
    totalScore:   number,
    outOf:        number,
    averageScore: number
  ): Promise<ReportCardRow> {
    logger.info('report_cards', 'updateScores', { id, totalScore, outOf, averageScore })
    return this.update(id, {
      total_score:   totalScore,
      out_of:        outOf,
      average_score: averageScore,
    })
  }

  async updatePosition(id: string, position: number): Promise<ReportCardRow> {
    logger.info('report_cards', 'updatePosition', { id, position })
    return this.update(id, { position_in_class: position })
  }

  // ── Comments ──────────────────────────────────────────────────────

  async addTeacherComment(id: string, comment: string): Promise<ReportCardRow> {
    logger.info('report_cards', 'addTeacherComment', { id })
    return this.update(id, { teacher_comment: comment })
  }

  async addPrincipalComment(id: string, comment: string): Promise<ReportCardRow> {
    logger.info('report_cards', 'addPrincipalComment', { id })
    return this.update(id, { principal_comment: comment })
  }

  // ── Publishing ────────────────────────────────────────────────────

  async publish(id: string): Promise<ReportCardRow> {
    logger.info('report_cards', 'publish', { id })
    return this.update(id, {
      is_published: true,
      published_at: new Date().toISOString(),
    })
  }

  async unpublish(id: string): Promise<ReportCardRow> {
    logger.info('report_cards', 'unpublish', { id })
    return this.update(id, {
      is_published: false,
      published_at: null,
    })
  }

  // Publishes all report cards for a class in a term at once
  async bulkPublish(
    classId:      string,
    academicYear: string,
    term:         string
  ): Promise<void> {
    logger.info('report_cards', 'bulkPublish', { classId, academicYear, term })

    const { error } = await this.db
      .from('report_cards')
      .update({
        is_published: true,
        published_at: new Date().toISOString(),
        updated_at:   new Date().toISOString(),
      })
      .eq('class_id', classId)
      .eq('academic_year', academicYear)
      .eq('term', term)
      .eq('is_published', false)  // only publish unpublished cards

    if (error) this.handleDbError(error, 'bulkPublish')
  }

  // Computes and updates class positions based on average score
  async computeClassPositions(
    classId:      string,
    academicYear: string,
    term:         string
  ): Promise<void> {
    logger.info('report_cards', 'computeClassPositions', { classId, academicYear, term })

    const { data, error } = await this.safeSelect('id, average_score')
      .eq('class_id', classId)
      .eq('academic_year', academicYear)
      .eq('term', term)

    if (error) this.handleDbError(error, 'computeClassPositions — fetch')

    // Sort by average score descending, assign positions
    const sorted = ((data ?? []) as unknown as ReportCardRow[])
      .sort((a, b) => (b.average_score ?? 0) - (a.average_score ?? 0))

    // Update each record with its computed position
    await Promise.all(
      sorted.map((card, index) =>
        this.db
          .from('report_cards')
          .update({ position_in_class: index + 1, updated_at: new Date().toISOString() })
          .eq('id', card.id)
      )
    )
  }
}