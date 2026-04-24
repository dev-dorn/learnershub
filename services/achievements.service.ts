import { z } from 'zod'
import { logger } from '@/lib/logger'
import { requireRole } from '@/lib/rbac'

import { Database } from '@/types/supabase'
import { NotFoundError, ValidationError } from "@/dal /errors"
import {
  AchievementsRepository,
  ListAchievementsOptions,
  PaginatedAchievements,
} from "@/dal /achievements.repository"

type AchievementRow = Database['public']['Tables']['achievements']['Row']

// ── Schemas ───────────────────────────────────────────────────────────

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/
const YEAR_REGEX = /^\d{4}\/\d{4}$/

const AchievementCreateSchema = z.object({
  // Required
  category: z.enum([
    'academic', 'sports', 'arts', 'leadership',
    'community', 'cbc_competency', 'co_curricular', 'other',
  ]),
  student_id: z.string().uuid(),
  title:      z.string().min(2).max(200),
  issued_at:  z.string().regex(DATE_REGEX, 'Must be in format YYYY-MM-DD'),

  // Context
  academic_year: z.string().regex(YEAR_REGEX, 'Must be in format YYYY/YYYY').nullable().optional(),
  activity_id:   z.string().uuid().nullable().optional(),
  class_id:      z.string().uuid().nullable().optional(),
  term:          z.enum(['term_1', 'term_2', 'term_3']).nullable().optional(),
  description:   z.string().max(1000).nullable().optional(),
  award_type:    z.enum([
    'certificate', 'trophy', 'medal', 'badge', 'commendation', 'other',
  ]).nullable().optional(),

  // CBC
  cbc_competency_area: z.enum([
    'communication', 'critical_thinking', 'creativity',
    'collaboration', 'citizenship', 'digital_literacy', 'learning_to_learn',
  ]).nullable().optional(),
  competency_level: z.enum([
    'exceeding_expectations', 'meeting_expectations',
    'approaching_expectations', 'below_expectations',
  ]).nullable().optional(),

  // Arrays — with size bounds
  evidence_urls: z.array(z.string().url()).max(50).nullable().optional(),
  skill_tags:    z.array(z.string().max(50)).max(100).nullable().optional(),

  // Visibility
  is_public:              z.boolean().nullable().optional().default(false),
  portfolio_featured:     z.boolean().nullable().optional().default(false),
  shareable_with_parents: z.boolean().nullable().optional().default(true),

  // Validity
  valid_until: z.string().regex(DATE_REGEX, 'Must be in format YYYY-MM-DD').nullable().optional(),

  // issued_by and school_id are NOT here — always injected from session
})

const AchievementUpdateSchema = AchievementCreateSchema.omit({
  student_id: true,  // never changes
  // verification fields excluded — use verify()/reject() only
}).partial()

const EvidenceSchema = z.object({
  urls: z.array(z.string().url()).min(1).max(50),
})

const SkillTagsSchema = z.object({
  tags: z.array(z.string().max(50)).min(1).max(100),
})

export type CreateAchievementInput = z.infer<typeof AchievementCreateSchema>
export type UpdateAchievementInput = z.infer<typeof AchievementUpdateSchema>

// ── Context ───────────────────────────────────────────────────────────

export interface AchievementContext {
  schoolId: string  // from auth session — never from client
  userId:   string  // from auth session — never from client
  role:     string  // from auth session — never from client
}

// ── Constants ─────────────────────────────────────────────────────────

// TODO: move to src/lib/rbac.ts once roles are finalized
const WRITE_ROLES  = ['teacher', 'admin', 'principal'] as const
const VERIFY_ROLES = ['admin', 'principal'] as const   // stricter — verification is privileged
const MAX_EVIDENCE = 50
const MAX_TAGS     = 100

// ── Service ───────────────────────────────────────────────────────────

export class AchievementsService {
  constructor(private repo: AchievementsRepository) {}

  // ── Read ──────────────────────────────────────────────────────────

  async getById(id: string, context: AchievementContext): Promise<AchievementRow | null> {
    return this.repo.getById(id, context.schoolId)
  }

  async list(
    options: ListAchievementsOptions,
    context: AchievementContext
  ): Promise<PaginatedAchievements> {
    return this.repo.list(options, context.schoolId)
  }

  async getStudentPortfolio(
    studentId:     string,
    context:       AchievementContext,
    academicYear?: string
  ): Promise<AchievementRow[]> {
    return this.repo.getStudentPortfolio(studentId, context.schoolId, academicYear)
  }

  async getParentViewable(studentId: string, context: AchievementContext): Promise<AchievementRow[]> {
    return this.repo.getParentViewable(studentId, context.schoolId)
  }

  async getByCBCCompetency(
    studentId:         string,
    cbcCompetencyArea: string,
    context:           AchievementContext,
    academicYear?:     string
  ): Promise<AchievementRow[]> {
    return this.repo.getByCBCCompetency(studentId, context.schoolId, cbcCompetencyArea, academicYear)
  }

  // ── Write ─────────────────────────────────────────────────────────

  async create(input: unknown, context: AchievementContext): Promise<AchievementRow> {
    requireRole(context.role, WRITE_ROLES, 'create achievements')

    const parsed = AchievementCreateSchema.safeParse(input)
    if (!parsed.success)
      throw new ValidationError(
        parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')
      )

    return this.repo.create({
      ...parsed.data,
      school_id: context.schoolId,  // ← always from session
      issued_by: context.userId,    // ← always from session, never from client
    })
  }

  async update(id: string, input: unknown, context: AchievementContext): Promise<AchievementRow> {
    requireRole(context.role, WRITE_ROLES, 'update achievements')

    const parsed = AchievementUpdateSchema.safeParse(input)
    if (!parsed.success)
      throw new ValidationError(
        parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')
      )

    return this.repo.update(id, parsed.data, context.schoolId)
  }

  async delete(id: string, context: AchievementContext): Promise<void> {
    requireRole(context.role, WRITE_ROLES, 'delete achievements')
    return this.repo.delete(id, context.schoolId)
  }

  // ── Verification ──────────────────────────────────────────────────

  async verify(id: string, context: AchievementContext): Promise<AchievementRow> {
    requireRole(context.role, VERIFY_ROLES, 'verify achievements')

    logger.info('achievements', 'verify', {
      id,
      verifiedBy: context.userId,  // audit trail in logs
    })

    return this.repo.updateVerification(id, {
      verification_status: 'verified',
      verified_by:         context.userId,  // ← always from session, never from client
    }, context.schoolId)
  }

  async reject(id: string, context: AchievementContext): Promise<AchievementRow> {
    requireRole(context.role, VERIFY_ROLES, 'reject achievements')

    logger.info('achievements', 'reject', {
      id,
      rejectedBy: context.userId,
    })

    return this.repo.updateVerification(id, {
      verification_status: 'rejected',
      verified_by:         null,
    }, context.schoolId)
  }

  async pendingVerification(id: string, context: AchievementContext): Promise<AchievementRow> {
    requireRole(context.role, WRITE_ROLES, 'set achievement to pending')
    return this.repo.updateVerification(id, {
      verification_status: 'pending',
      verified_by:         null,
    }, context.schoolId)
  }

  // ── Visibility ────────────────────────────────────────────────────

  async makePublic(id: string, context: AchievementContext): Promise<AchievementRow> {
    requireRole(context.role, WRITE_ROLES, 'change achievement visibility')
    return this.repo.updateVisibility(id, { is_public: true }, context.schoolId)
  }

  async makePrivate(id: string, context: AchievementContext): Promise<AchievementRow> {
    requireRole(context.role, WRITE_ROLES, 'change achievement visibility')
    return this.repo.updateVisibility(id, { is_public: false }, context.schoolId)
  }

  async featureInPortfolio(id: string, context: AchievementContext): Promise<AchievementRow> {
    requireRole(context.role, WRITE_ROLES, 'feature achievement in portfolio')
    return this.repo.updateVisibility(id, { portfolio_featured: true }, context.schoolId)
  }

  async unfeatureFromPortfolio(id: string, context: AchievementContext): Promise<AchievementRow> {
    requireRole(context.role, WRITE_ROLES, 'unfeature achievement from portfolio')
    return this.repo.updateVisibility(id, { portfolio_featured: false }, context.schoolId)
  }

  async shareWithParents(id: string, context: AchievementContext): Promise<AchievementRow> {
    requireRole(context.role, WRITE_ROLES, 'share achievement with parents')
    return this.repo.updateVisibility(id, { shareable_with_parents: true }, context.schoolId)
  }

  async unshareWithParents(id: string, context: AchievementContext): Promise<AchievementRow> {
    requireRole(context.role, WRITE_ROLES, 'unshare achievement with parents')
    return this.repo.updateVisibility(id, { shareable_with_parents: false }, context.schoolId)
  }

  // ── Evidence ──────────────────────────────────────────────────────
  // Read-modify-write — susceptible to concurrent update loss.
  // TODO: replace with Postgres array append RPC when concurrency becomes an issue.

  async addEvidence(
    id:      string,
    input:   unknown,
    context: AchievementContext
  ): Promise<AchievementRow> {
    requireRole(context.role, WRITE_ROLES, 'add evidence')

    const parsed = EvidenceSchema.safeParse(input)
    if (!parsed.success)
      throw new ValidationError(
        parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')
      )

    const existing = await this.repo.getById(id, context.schoolId)
    if (!existing) throw new NotFoundError('Achievement', id)

    const merged = [...new Set([...(existing.evidence_urls ?? []), ...parsed.data.urls])]
    if (merged.length > MAX_EVIDENCE)
      throw new ValidationError(`evidence_urls: max ${MAX_EVIDENCE} URLs per achievement`)

    return this.repo.updateArrayFields(id, { evidence_urls: merged }, context.schoolId)
  }

  async removeEvidence(
    id:      string,
    input:   unknown,
    context: AchievementContext
  ): Promise<AchievementRow> {
    requireRole(context.role, WRITE_ROLES, 'remove evidence')

    const parsed = EvidenceSchema.safeParse(input)
    if (!parsed.success)
      throw new ValidationError(
        parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')
      )

    const existing = await this.repo.getById(id, context.schoolId)
    if (!existing) throw new NotFoundError('Achievement', id)

    const filtered = (existing.evidence_urls ?? []).filter((u) => !parsed.data.urls.includes(u))
    return this.repo.updateArrayFields(id, { evidence_urls: filtered }, context.schoolId)
  }

  // ── Skill tags ────────────────────────────────────────────────────

  async addSkillTags(
    id:      string,
    input:   unknown,
    context: AchievementContext
  ): Promise<AchievementRow> {
    requireRole(context.role, WRITE_ROLES, 'add skill tags')

    const parsed = SkillTagsSchema.safeParse(input)
    if (!parsed.success)
      throw new ValidationError(
        parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')
      )

    const existing = await this.repo.getById(id, context.schoolId)
    if (!existing) throw new NotFoundError('Achievement', id)

    const merged = [...new Set([...(existing.skill_tags ?? []), ...parsed.data.tags])]
    if (merged.length > MAX_TAGS)
      throw new ValidationError(`skill_tags: max ${MAX_TAGS} tags per achievement`)

    return this.repo.updateArrayFields(id, { skill_tags: merged }, context.schoolId)
  }

  async removeSkillTags(
    id:      string,
    input:   unknown,
    context: AchievementContext
  ): Promise<AchievementRow> {
    requireRole(context.role, WRITE_ROLES, 'remove skill tags')

    const parsed = SkillTagsSchema.safeParse(input)
    if (!parsed.success)
      throw new ValidationError(
        parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')
      )

    const existing = await this.repo.getById(id, context.schoolId)
    if (!existing) throw new NotFoundError('Achievement', id)

    const filtered = (existing.skill_tags ?? []).filter((t) => !parsed.data.tags.includes(t))
    return this.repo.updateArrayFields(id, { skill_tags: filtered }, context.schoolId)
  }
}