// src/dal/achievements.repository.ts
import { SupabaseClient, PostgrestError } from '@supabase/supabase-js'
import { Database } from '@/types/supabase'
import { z } from 'zod'
import { DALError, NotFoundError, ValidationError, ConflictError, DatabaseError } from './errors'
import { logger } from '@/lib/logger'

// ── Types ─────────────────────────────────────────────────────────────

type AchievementRow    = Database['public']['Tables']['achievements']['Row']
type AchievementInsert = Database['public']['Tables']['achievements']['Insert']
type AchievementUpdate = Database['public']['Tables']['achievements']['Update']

// ── Schemas ───────────────────────────────────────────────────────────

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/  // YYYY-MM-DD
const YEAR_REGEX = /^\d{4}\/\d{4}$/        // 2024/2025

const AchievementInsertSchema = z.object({
  // Required / non-nullable
  category:   z.enum([
    'academic', 'sports', 'arts', 'leadership',
    'community', 'cbc_competency', 'co_curricular', 'other',
  ]),
  school_id:  z.string().uuid(),
  student_id: z.string().uuid(),
  title:      z.string().min(2).max(200),
  issued_at:  z.string().regex(DATE_REGEX, 'Must be in format YYYY-MM-DD'),

  // Optional / nullable — context
  academic_year:       z.string().regex(YEAR_REGEX, 'Must be in format YYYY/YYYY').nullable().optional(),
  activity_id:         z.string().uuid().nullable().optional(),
  class_id:            z.string().uuid().nullable().optional(),
  term:                z.enum(['term_1', 'term_2', 'term_3']).nullable().optional(),
  description:         z.string().max(1000).nullable().optional(),
  award_type:          z.enum([
    'certificate', 'trophy', 'medal', 'badge', 'commendation', 'other',
  ]).nullable().optional(),

  // Optional / nullable — CBC specific
  cbc_competency_area: z.enum([
    'communication', 'critical_thinking', 'creativity',
    'collaboration', 'citizenship', 'digital_literacy', 'learning_to_learn',
  ]).nullable().optional(),
  competency_level: z.enum([
    'exceeding_expectations', 'meeting_expectations',
    'approaching_expectations', 'below_expectations',
  ]).nullable().optional(),

  // Optional / nullable — arrays
  evidence_urls: z.array(z.string().url()).nullable().optional(),
  skill_tags:    z.array(z.string().max(50)).nullable().optional(),

  // Optional / nullable — visibility
  is_public:              z.boolean().nullable().optional().default(false),
  portfolio_featured:     z.boolean().nullable().optional().default(false),
  shareable_with_parents: z.boolean().nullable().optional().default(true),

  // Optional / nullable — validity
  valid_until: z.string().regex(DATE_REGEX, 'Must be in format YYYY-MM-DD').nullable().optional(),

  // Optional / nullable — issued by
  issued_by: z.string().uuid().nullable().optional(),

  // Verification — system managed
  // verification_status → set via verify()
  // verified_by         → set via verify()
})

const AchievementUpdateSchema = AchievementInsertSchema
  .omit({
    student_id: true,  // always belongs to same student
    school_id:  true,  // never changes
  })
  .partial()

// ── Exported input types ──────────────────────────────────────────────

export type CreateAchievementInput = z.infer<typeof AchievementInsertSchema>
export type UpdateAchievementInput = z.infer<typeof AchievementUpdateSchema>

// ── List options ──────────────────────────────────────────────────────

export interface ListAchievementsOptions {
  schoolId?:            string
  studentId?:           string
  classId?:             string
  category?:            string
  academicYear?:        string
  term?:                string
  isPublic?:            boolean
  portfolioFeatured?:   boolean
  shareableWithParents?: boolean
  verificationStatus?:  string
  issuedBy?:            string
  limit?:               number
  offset?:              number
}

// ── Pagination result ─────────────────────────────────────────────────

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
      case '42501': throw new DALError('UNAUTHORIZED', 'You do not have permission to access this resource')
      default:      throw new DatabaseError(operation, error)
    }
  }

  // ── Query helpers ─────────────────────────────────────────────────

  private safeSelect(cols?: string) {
    return this.db.from('achievements').select(cols ?? SAFE_COLS)
  }

  // ── Read ──────────────────────────────────────────────────────────

  async getById(id: string): Promise<AchievementRow | null> {
    logger.info('achievements', 'getById', { id })

    const { data, error } = await this.safeSelect()
      .eq('id', id)
      .single()

    if (error?.code === 'PGRST116') return null
    if (error) this.handleDbError(error, 'getById')
    if (!data) return null
    return data as unknown as AchievementRow
  }

  async list(options: ListAchievementsOptions = {}): Promise<PaginatedAchievements> {
    const {
      schoolId,
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

    if (schoolId)             q = q.eq('school_id', schoolId)
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

  // Fetches all achievements for a student's portfolio
  async getStudentPortfolio(
    studentId:    string,
    academicYear?: string
  ): Promise<AchievementRow[]> {
    logger.info('achievements', 'getStudentPortfolio', { studentId, academicYear })

    let q = this.safeSelect()
      .eq('student_id', studentId)
      .eq('is_public', true)

    if (academicYear) q = q.eq('academic_year', academicYear)

    const { data, error } = await q
      .order('portfolio_featured', { ascending: false })
      .order('issued_at',          { ascending: false })

    if (error) this.handleDbError(error, 'getStudentPortfolio')
    return (data ?? []) as unknown as AchievementRow[]
  }

  // Fetches achievements shareable with parents
  async getParentViewable(studentId: string): Promise<AchievementRow[]> {
    logger.info('achievements', 'getParentViewable', { studentId })

    const { data, error } = await this.safeSelect()
      .eq('student_id', studentId)
      .eq('shareable_with_parents', true)
      .order('issued_at', { ascending: false })

    if (error) this.handleDbError(error, 'getParentViewable')
    return (data ?? []) as unknown as AchievementRow[]
  }

  // Fetches achievements by CBC competency area for a student
  async getByCBCCompetency(
    studentId:           string,
    cbcCompetencyArea:   string,
    academicYear?:       string
  ): Promise<AchievementRow[]> {
    logger.info('achievements', 'getByCBCCompetency', { studentId, cbcCompetencyArea })

    let q = this.safeSelect()
      .eq('student_id', studentId)
      .eq('cbc_competency_area', cbcCompetencyArea)

    if (academicYear) q = q.eq('academic_year', academicYear)

    const { data, error } = await q
      .order('issued_at', { ascending: false })

    if (error) this.handleDbError(error, 'getByCBCCompetency')
    return (data ?? []) as unknown as AchievementRow[]
  }

  // ── Write ─────────────────────────────────────────────────────────

  async create(input: unknown): Promise<AchievementRow> {
    const parsed = AchievementInsertSchema.safeParse(input)
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues
          .map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`)
          .join(', ')
      )
    }

    logger.info('achievements', 'create', {
      student_id: parsed.data.student_id,
      category:   parsed.data.category,
      title:      parsed.data.title,
    })

    const { data, error } = await this.db
      .from('achievements')
      .insert(parsed.data as unknown as AchievementInsert)
      .select(SAFE_COLS)
      .single()

    if (error) this.handleDbError(error, 'create')
    if (!data) throw new DatabaseError('create — no data returned')
    return data as unknown as AchievementRow
  }

  async update(id: string, input: unknown): Promise<AchievementRow> {
    const parsed = AchievementUpdateSchema.safeParse(input)
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues
          .map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`)
          .join(', ')
      )
    }

    logger.info('achievements', 'update', { id })

    const { data, error } = await this.db
      .from('achievements')
      .update(parsed.data as unknown as AchievementUpdate)
      .eq('id', id)
      .select(SAFE_COLS)
      .single()

    if (error?.code === 'PGRST116') throw new NotFoundError('Achievement', id)
    if (error) this.handleDbError(error, 'update')
    if (!data) throw new NotFoundError('Achievement', id)
    return data as unknown as AchievementRow
  }

  async delete(id: string): Promise<void> {
    logger.info('achievements', 'delete', { id })

    const exists = await this.getById(id)
    if (!exists) throw new NotFoundError('Achievement', id)

    const { error } = await this.db
      .from('achievements')
      .delete()
      .eq('id', id)

    if (error) this.handleDbError(error, 'delete')
  }

  // ── Verification ──────────────────────────────────────────────────

  async verify(id: string, verifiedBy: string): Promise<AchievementRow> {
    logger.info('achievements', 'verify', { id, verifiedBy })
    return this.update(id, {
      verification_status: 'verified',
      verified_by:         verifiedBy,
    })
  }

  async reject(id: string): Promise<AchievementRow> {
    logger.info('achievements', 'reject', { id })
    return this.update(id, {
      verification_status: 'rejected',
      verified_by:         null,
    })
  }

  async pendingVerification(id: string): Promise<AchievementRow> {
    logger.info('achievements', 'pendingVerification', { id })
    return this.update(id, { verification_status: 'pending' })
  }

  // ── Visibility ────────────────────────────────────────────────────

  async makePublic(id: string): Promise<AchievementRow> {
    logger.info('achievements', 'makePublic', { id })
    return this.update(id, { is_public: true })
  }

  async makePrivate(id: string): Promise<AchievementRow> {
    logger.info('achievements', 'makePrivate', { id })
    return this.update(id, { is_public: false })
  }

  async featureInPortfolio(id: string): Promise<AchievementRow> {
    logger.info('achievements', 'featureInPortfolio', { id })
    return this.update(id, { portfolio_featured: true })
  }

  async unfeatureFromPortfolio(id: string): Promise<AchievementRow> {
    logger.info('achievements', 'unfeatureFromPortfolio', { id })
    return this.update(id, { portfolio_featured: false })
  }

  async shareWithParents(id: string): Promise<AchievementRow> {
    logger.info('achievements', 'shareWithParents', { id })
    return this.update(id, { shareable_with_parents: true })
  }

  async unshareWithParents(id: string): Promise<AchievementRow> {
    logger.info('achievements', 'unshareWithParents', { id })
    return this.update(id, { shareable_with_parents: false })
  }

  // ── Evidence ──────────────────────────────────────────────────────

  // Appends new URLs to existing evidence_urls array
  async addEvidence(id: string, urls: string[]): Promise<AchievementRow> {
    logger.info('achievements', 'addEvidence', { id, count: urls.length })

    const existing = await this.getById(id)
    if (!existing) throw new NotFoundError('Achievement', id)

    const merged = [...(existing.evidence_urls ?? []), ...urls]
    return this.update(id, { evidence_urls: merged })
  }

  // Removes specific URLs from evidence_urls array
  async removeEvidence(id: string, urls: string[]): Promise<AchievementRow> {
    logger.info('achievements', 'removeEvidence', { id, count: urls.length })

    const existing = await this.getById(id)
    if (!existing) throw new NotFoundError('Achievement', id)

    const filtered = (existing.evidence_urls ?? []).filter(u => !urls.includes(u))
    return this.update(id, { evidence_urls: filtered })
  }

  // ── Skill tags ────────────────────────────────────────────────────

  async addSkillTags(id: string, tags: string[]): Promise<AchievementRow> {
    logger.info('achievements', 'addSkillTags', { id, tags })

    const existing = await this.getById(id)
    if (!existing) throw new NotFoundError('Achievement', id)

    const merged = [...new Set([...(existing.skill_tags ?? []), ...tags])]
    return this.update(id, { skill_tags: merged })
  }

  async removeSkillTags(id: string, tags: string[]): Promise<AchievementRow> {
    logger.info('achievements', 'removeSkillTags', { id, tags })

    const existing = await this.getById(id)
    if (!existing) throw new NotFoundError('Achievement', id)

    const filtered = (existing.skill_tags ?? []).filter(t => !tags.includes(t))
    return this.update(id, { skill_tags: filtered })
  }
}