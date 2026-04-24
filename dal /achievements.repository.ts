import { SupabaseClient, PostgrestError } from '@supabase/supabase-js'
import { Database } from '@/types/supabase'
import {
  DALError,
  NotFoundError,
  ConflictError,
  DatabaseError,
} from './errors'
import { logger } from '@/lib/logger'

// ── Types ─────────────────────────────────────────────────────────────

type AchievementRow    = Database['public']['Tables']['achievements']['Row']
type AchievementInsert = Database['public']['Tables']['achievements']['Insert']

// ── Internal input types ──────────────────────────────────────────────

export interface InternalAchievementInput {
  // Required
  category:   'academic' | 'sports' | 'arts' | 'leadership' | 'community' | 'cbc_competency' | 'co_curricular' | 'other'
  school_id:  string        // always from session
  student_id: string
  title:      string
  issued_at:  string
  issued_by:  string        // always from session

  // Context
  academic_year?:       string | null
  activity_id?:         string | null
  class_id?:            string | null
  term?:                'term_1' | 'term_2' | 'term_3' | null
  description?:         string | null
  award_type?:          'certificate' | 'trophy' | 'medal' | 'badge' | 'commendation' | 'other' | null

  // CBC
  cbc_competency_area?: 'communication' | 'critical_thinking' | 'creativity' | 'collaboration' | 'citizenship' | 'digital_literacy' | 'learning_to_learn' | null
  competency_level?:    'exceeding_expectations' | 'meeting_expectations' | 'approaching_expectations' | 'below_expectations' | null

  // Arrays
  evidence_urls?: string[] | null
  skill_tags?:    string[] | null

  // Visibility
  is_public?:              boolean | null
  portfolio_featured?:     boolean | null
  shareable_with_parents?: boolean | null

  // Validity
  valid_until?: string | null
}

// Narrow update types per operation domain

export interface InternalAchievementUpdate {
  category?:             'academic' | 'sports' | 'arts' | 'leadership' | 'community' | 'cbc_competency' | 'co_curricular' | 'other'
  title?:                string
  issued_at?:            string
  academic_year?:        string | null
  activity_id?:          string | null
  class_id?:             string | null
  term?:                 'term_1' | 'term_2' | 'term_3' | null
  description?:          string | null
  award_type?:           'certificate' | 'trophy' | 'medal' | 'badge' | 'commendation' | 'other' | null
  cbc_competency_area?:  'communication' | 'critical_thinking' | 'creativity' | 'collaboration' | 'citizenship' | 'digital_literacy' | 'learning_to_learn' | null
  competency_level?:     'exceeding_expectations' | 'meeting_expectations' | 'approaching_expectations' | 'below_expectations' | null
  valid_until?:          string | null
  managing_teacher_id?:  string | null
}

export interface InternalVerificationUpdate {
  verification_status: 'verified' | 'rejected' | 'pending'
  verified_by:         string | null  // always from session on verify, null on reject
}

export interface InternalVisibilityUpdate {
  is_public?:              boolean
  portfolio_featured?:     boolean
  shareable_with_parents?: boolean
}

export interface InternalArrayUpdate {
  evidence_urls?: string[] | null
  skill_tags?:    string[] | null
}

// ── List options ──────────────────────────────────────────────────────

// schoolId is intentionally excluded — always passed as a mandatory
// separate param from session context. NEVER add schoolId here.
export interface ListAchievementsOptions {
  studentId?:            string
  classId?:              string
  category?:             string
  academicYear?:         string
  term?:                 string
  isPublic?:             boolean
  portfolioFeatured?:    boolean
  shareableWithParents?: boolean
  verificationStatus?:   string
  issuedBy?:             string
  limit?:                number
  offset?:               number
}

// ── Result types ──────────────────────────────────────────────────────

export interface PaginatedAchievements {
  data:    AchievementRow[]
  count:   number
  hasMore: boolean
}

// ── Constants ─────────────────────────────────────────────────────────

const SAFE_COLS = [
  'id',
  'academic_year',
  'activity_id',
  'award_type',
  'category',
  'cbc_competency_area',
  'class_id',
  'competency_level',
  'created_at',
  'description',
  'evidence_urls',
  'is_public',
  'issued_at',
  'issued_by',
  'portfolio_featured',
  'school_id',
  'shareable_with_parents',
  'skill_tags',
  'student_id',
  'term',
  'title',
  'updated_at',
  'valid_until',
  'verification_status',
  'verified_by',
].join(', ')

const DEFAULT_LIMIT  = 20
const MAX_LIMIT      = 100
const DEFAULT_OFFSET = 0

// ── Repository ────────────────────────────────────────────────────────

export class AchievementsRepository {
  constructor(private db: SupabaseClient<Database>) {}

  // ── Error handling ────────────────────────────────────────────────

  private handleDbError(error: PostgrestError, operation: string): never {
    logger.error('achievements', `PostgREST error during ${operation}`, {
      code:    error.code,
      hint:    error.hint,
      details: error.details,
    })

    switch (error.code) {
      case '23505': throw new ConflictError('Achievement', 'student and title')
      case '23503': throw new DALError('FOREIGN_KEY_ERROR', `Related record not found: ${operation}`)
      case '23502': throw new DALError('VALIDATION_ERROR', `Required field missing: ${error.details}`)
      case '23514': throw new DALError('VALIDATION_ERROR', `Value out of allowed range: ${error.details}`)
      case '42501': throw new DALError('UNAUTHORIZED', 'RLS policy violation — insufficient permissions')
      default:      throw new DatabaseError(operation, error)
    }
  }

  // ── Query helpers ─────────────────────────────────────────────────

  private safeSelect(cols?: string) {
    return this.db.from('achievements').select(cols ?? SAFE_COLS)
  }

  // ── Read ──────────────────────────────────────────────────────────

  async getById(id: string, schoolId: string): Promise<AchievementRow | null> {
    logger.info('achievements', 'getById', { id })

    const { data, error } = await this.safeSelect()
      .eq('id', id)
      .eq('school_id', schoolId)  // ← tenant isolation
      .single()

    if (error?.code === 'PGRST116') return null
    if (error) this.handleDbError(error, 'getById')
    if (!data) return null
    return data as unknown as AchievementRow
  }

  async list(options: ListAchievementsOptions, schoolId: string): Promise<PaginatedAchievements> {
    const {
      studentId,
      classId,
      category,
      academicYear,
      term,
      isPublic,
      portfolioFeatured,
      shareableWithParents,
      verificationStatus,
      issuedBy,
      limit  = DEFAULT_LIMIT,
      offset = DEFAULT_OFFSET,
    } = options

    const safeLimit = Math.min(limit, MAX_LIMIT)

    logger.info('achievements', 'list', {
      schoolId, studentId, classId,
      category, academicYear, term,
      limit: safeLimit, offset,
    })

    let q = this.db
      .from('achievements')
      .select(SAFE_COLS, { count: 'exact' })
      .eq('school_id', schoolId)  // ← tenant isolation always applied first

    if (studentId)            q = q.eq('student_id', studentId)
    if (classId)              q = q.eq('class_id', classId)
    if (category)             q = q.eq('category', category)
    if (academicYear)         q = q.eq('academic_year', academicYear)
    if (term)                 q = q.eq('term', term)
    if (issuedBy)             q = q.eq('issued_by', issuedBy)
    if (verificationStatus)   q = q.eq('verification_status', verificationStatus)
    if (isPublic !== undefined)
      q = q.eq('is_public', isPublic)
    if (portfolioFeatured !== undefined)
      q = q.eq('portfolio_featured', portfolioFeatured)
    if (shareableWithParents !== undefined)
      q = q.eq('shareable_with_parents', shareableWithParents)

    const { data, count, error } = await q
      .range(offset, offset + safeLimit - 1)
      .order('issued_at', { ascending: false })

    if (error) this.handleDbError(error, 'list')

    return {
      data:    (data ?? []) as unknown as AchievementRow[],
      count:   count ?? 0,
      hasMore: (count ?? 0) > offset + safeLimit,
    }
  }

  async getStudentPortfolio(
    studentId:     string,
    schoolId:      string,   // ← tenant isolation
    academicYear?: string
  ): Promise<AchievementRow[]> {
    logger.info('achievements', 'getStudentPortfolio', { studentId, academicYear })

    let q = this.safeSelect()
      .eq('student_id', studentId)
      .eq('school_id', schoolId)  // ← tenant isolation
      .eq('is_public', true)

    if (academicYear) q = q.eq('academic_year', academicYear)

    const { data, error } = await q
      .order('portfolio_featured', { ascending: false })
      .order('issued_at',          { ascending: false })

    if (error) this.handleDbError(error, 'getStudentPortfolio')
    return (data ?? []) as unknown as AchievementRow[]
  }

  async getParentViewable(studentId: string, schoolId: string): Promise<AchievementRow[]> {
    logger.info('achievements', 'getParentViewable', { studentId })

    const { data, error } = await this.safeSelect()
      .eq('student_id', studentId)
      .eq('school_id', schoolId)  // ← tenant isolation
      .eq('shareable_with_parents', true)
      .order('issued_at', { ascending: false })

    if (error) this.handleDbError(error, 'getParentViewable')
    return (data ?? []) as unknown as AchievementRow[]
  }

  async getByCBCCompetency(
    studentId:          string,
    schoolId:           string,  // ← tenant isolation
    cbcCompetencyArea:  string,
    academicYear?:      string
  ): Promise<AchievementRow[]> {
    logger.info('achievements', 'getByCBCCompetency', { studentId, cbcCompetencyArea })

    let q = this.safeSelect()
      .eq('student_id', studentId)
      .eq('school_id', schoolId)  // ← tenant isolation
      .eq('cbc_competency_area', cbcCompetencyArea)

    if (academicYear) q = q.eq('academic_year', academicYear)

    const { data, error } = await q.order('issued_at', { ascending: false })

    if (error) this.handleDbError(error, 'getByCBCCompetency')
    return (data ?? []) as unknown as AchievementRow[]
  }

  // ── Write ─────────────────────────────────────────────────────────

  async create(record: InternalAchievementInput): Promise<AchievementRow> {
    logger.info('achievements', 'create', {
      student_id: record.student_id,
      category:   record.category,
      title:      record.title,
    })

    const { data, error } = await this.db
      .from('achievements')
      .insert(record as unknown as AchievementInsert)
      .select(SAFE_COLS)
      .single()

    if (error) this.handleDbError(error, 'create')
    if (!data) throw new DatabaseError('create — no data returned')
    return data as unknown as AchievementRow
  }

  // General content update — no verification or visibility fields
  async update(
    id:       string,
    data:     InternalAchievementUpdate,
    schoolId: string
  ): Promise<AchievementRow> {
    return this._update(id, data, schoolId, 'update')
  }

  // Verification-specific update — verified_by always from session
  async updateVerification(
    id:       string,
    data:     InternalVerificationUpdate,
    schoolId: string
  ): Promise<AchievementRow> {
    return this._update(id, data, schoolId, 'updateVerification')
  }

  // Visibility-specific update
  async updateVisibility(
    id:       string,
    data:     InternalVisibilityUpdate,
    schoolId: string
  ): Promise<AchievementRow> {
    return this._update(id, data, schoolId, 'updateVisibility')
  }

  // Array patch update — evidence and skill tags
  async updateArrayFields(
    id:       string,
    data:     InternalArrayUpdate,
    schoolId: string
  ): Promise<AchievementRow> {
    return this._update(id, data, schoolId, 'updateArrayFields')
  }

  // Single internal update — all public update methods route here
  // school_id on every update prevents cross-tenant writes
  private async _update(
    id:        string,
    data:      object,
    schoolId:  string,
    operation: string
  ): Promise<AchievementRow> {
    const { data: row, error } = await this.db
      .from('achievements')
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('school_id', schoolId)  // ← tenant isolation on every write
      .select(SAFE_COLS)
      .single()

    if (error?.code === 'PGRST116') throw new NotFoundError('Achievement', id)
    if (error) this.handleDbError(error, operation)
    if (!row) throw new NotFoundError('Achievement', id)
    return row as unknown as AchievementRow
  }

  async delete(id: string, schoolId: string): Promise<void> {
    logger.info('achievements', 'delete', { id })

    // Single round-trip — no pre-flight getById
    // school_id filter prevents cross-tenant deletes
    const { data, error } = await this.db
      .from('achievements')
      .delete()
      .eq('id', id)
      .eq('school_id', schoolId)  // ← tenant isolation
      .select('id')

    if (error) this.handleDbError(error, 'delete')
    if (!data || data.length === 0) throw new NotFoundError('Achievement', id)
  }
}