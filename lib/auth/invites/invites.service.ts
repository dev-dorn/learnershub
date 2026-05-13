// src/lib/auth/invites/invites.service.ts
import { SupabaseClient } from '@supabase/supabase-js'
import { Database } from '@/types/supabase'
import {
  signInviteToken,
  verifyInviteToken,
  hashInviteToken,
  InvitePayload,
} from '@/lib/auth/tokens'
import { logger } from '@/lib/logger'
import { DALError, NotFoundError } from "@/dal "

// ── Types ─────────────────────────────────────────────────────────────

type InvitationRow    = Database['public']['Tables']['invitations']['Row']
type InvitationInsert = Database['public']['Tables']['invitations']['Insert']

export interface CreateInviteInput {
  email:     string
  studentId: string
  schoolId:  string
  invitedBy: string
  ttlMs?:    number
}

export interface VerifiedInvite {
  invitation: InvitationRow
  payload:    InvitePayload
}

export interface RevokeInviteInput {
  invitationId: string
  schoolId:     string
  revokedBy:    string
}

export type InviteStatus = 'pending' | 'accepted' | 'expired' | 'revoked'

export interface ListInvitesOptions {
  status?:    InviteStatus
  studentId?: string
  invitedBy?: string
  limit?:     number
  offset?:    number
}

export interface PaginatedInvitations {
  data:    InvitationRow[]
  count:   number
  hasMore: boolean
}

export interface InviteStats {
  total:    number
  pending:  number
  accepted: number
  expired:  number
  revoked:  number
}

// ── Helper ────────────────────────────────────────────────────────────

// Safely extracts message from unknown error shape
// Fixes TS2339 — error typed as never in narrowed branches
function extractMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return 'Unknown error'
}

// ── Constants ─────────────────────────────────────────────────────────

const DEFAULT_TTL_MS      = 1000 * 60 * 60 * 72
const MAX_INVITES_PER_DAY = 5
const MAX_LIMIT           = 100
const DEFAULT_LIMIT       = 20
const DEFAULT_OFFSET      = 0

// ── Service ───────────────────────────────────────────────────────────

export class InvitesService {
  constructor(private db: SupabaseClient<Database>) {}

  // ── Create ────────────────────────────────────────────────────────

  async createInvite(input: CreateInviteInput): Promise<{
    token:      string
    invitation: InvitationRow
    reused:     boolean
  }> {
    const normalizedEmail = input.email.toLowerCase().trim()

    logger.info('invites.service', 'createInvite', {
      studentId: input.studentId,
      schoolId:  input.schoolId,
      invitedBy: input.invitedBy,
    })

    await this.assertStudentBelongsToSchool(input.studentId, input.schoolId)
    await this.assertRateLimit(input.studentId, input.schoolId)

    const existing = await this.findPendingByEmailAndStudent(
      normalizedEmail,
      input.studentId
    )

    if (existing) {
      logger.info('invites.service', 'reusing existing pending invite', {
        invitationId: existing.id,
        studentId:    input.studentId,
      })

      const remainingTtl = new Date(existing.expires_at).getTime() - Date.now()

      if (remainingTtl <= 0) {
        await this.markExpired(existing.id)
        return this.createInvite(input)
      }

      const token = signInviteToken({
        email:     normalizedEmail,
        studentId: input.studentId,
        schoolId:  input.schoolId,
        invitedBy: input.invitedBy,
        ttlMs:     remainingTtl,
      })

      return { token, invitation: existing, reused: true }
    }

    const ttlMs     = input.ttlMs ?? DEFAULT_TTL_MS
    const token     = signInviteToken({
      email:     normalizedEmail,
      studentId: input.studentId,
      schoolId:  input.schoolId,
      invitedBy: input.invitedBy,
      ttlMs,
    })

    const tokenHash = hashInviteToken(token)
    const expiresAt = new Date(Date.now() + ttlMs).toISOString()

    const { data, error } = await this.db
      .from('invitations')
      .insert({
        token_hash: tokenHash,
        email:      normalizedEmail,
        student_id: input.studentId,
        school_id:  input.schoolId,
        invited_by: input.invitedBy,   // string — validated upstream
        status:     'pending',
        expires_at: expiresAt,
      } as unknown as InvitationInsert)
      .select('*')
      .single()

    if (error) {
      if (error.code === '23505') {
        logger.warn('invites.service', 'race condition on invite creation — retrying', {
          studentId: input.studentId,
        })
        return this.createInvite(input)
      }

      logger.error('invites.service', 'failed to persist invitation', {
        code: error.code,
        hint: error.hint,
      })
      throw new DALError(
        'DATABASE_ERROR',
        `Failed to create invitation: ${extractMessage(error)}`
      )
    }

    if (!data) {
      throw new DALError('DATABASE_ERROR', 'Invitation created but no data returned')
    }

    logger.info('invites.service', 'invitation created', {
      invitationId: data.id,
      studentId:    input.studentId,
      expiresAt,
    })

    return {
      token,
      invitation: data as unknown as InvitationRow,
      reused:     false,
    }
  }

  // ── Verify ────────────────────────────────────────────────────────

  async verifyInvite(token: string): Promise<VerifiedInvite> {
    logger.info('invites.service', 'verifyInvite')

    let payload: InvitePayload
    try {
      payload = verifyInviteToken(token)
    } catch (err) {
      logger.warn('invites.service', 'token verification failed', {
        reason: extractMessage(err),
      })
      throw new DALError('INVALID_TOKEN', 'This invitation link is invalid or has expired')
    }

    const tokenHash = hashInviteToken(token)

    const { data: invitation, error } = await this.db
      .from('invitations')
      .select('*')
      .eq('token_hash', tokenHash)
      .single()

    if (error?.code === 'PGRST116' || !invitation) {
      logger.warn('invites.service', 'invitation not found by token hash')
      throw new DALError('INVALID_TOKEN', 'This invitation link is invalid or has expired')
    }

    if (error) {
      throw new DALError(
        'DATABASE_ERROR',
        `Failed to look up invitation: ${extractMessage(error)}`
      )
    }

    const inv = invitation as unknown as InvitationRow

    if (inv.status !== 'pending') {
      logger.warn('invites.service', 'invitation not pending', {
        invitationId: inv.id,
        status:       inv.status,
      })

      const messages: Record<string, string> = {
        accepted: 'This invitation has already been used',
        expired:  'This invitation has expired — please request a new one',
        revoked:  'This invitation has been cancelled — please contact your school',
      }

      throw new DALError(
        'INVALID_TOKEN',
        messages[inv.status] ?? 'This invitation is no longer valid'
      )
    }

    if (new Date(inv.expires_at) < new Date()) {
      logger.warn('invites.service', 'invitation expired at DB level', {
        invitationId: inv.id,
        expiresAt:    inv.expires_at,
      })
      await this.markExpired(inv.id)
      throw new DALError(
        'INVALID_TOKEN',
        'This invitation has expired — please request a new one'
      )
    }

    if (inv.email.toLowerCase() !== payload.email.toLowerCase()) {
      logger.warn('invites.service', 'email mismatch — possible token swap attempt', {
        invitationId: inv.id,
      })
      throw new DALError('INVALID_TOKEN', 'This invitation link is invalid or has expired')
    }

    if (inv.school_id !== payload.schoolId) {
      logger.warn('invites.service', 'school_id mismatch — possible cross-tenant attempt', {
        invitationId: inv.id,
      })
      throw new DALError('INVALID_TOKEN', 'This invitation link is invalid or has expired')
    }

    logger.info('invites.service', 'invitation verified successfully', {
      invitationId: inv.id,
      studentId:    inv.student_id,
    })

    return { invitation: inv, payload }
  }

  // ── Accept ────────────────────────────────────────────────────────

  async acceptInvite(invitationId: string): Promise<InvitationRow> {
    logger.info('invites.service', 'acceptInvite', { invitationId })

    const { data, error } = await this.db
      .from('invitations')
      .update({ status: 'accepted' })
      .eq('id', invitationId)
      .eq('status', 'pending')
      .select('*')
      .single()

    if (error?.code === 'PGRST116' || !data) {
      throw new DALError('INVALID_TOKEN', 'Invitation not found or already accepted')
    }

    if (error) {
      throw new DALError(
        'DATABASE_ERROR',
        `Failed to accept invitation: ${extractMessage(error)}`
      )
    }

    logger.info('invites.service', 'invitation accepted', { invitationId })
    return data as unknown as InvitationRow
  }

  // ── Revoke ────────────────────────────────────────────────────────

  async revokeInvite(input: RevokeInviteInput): Promise<InvitationRow> {
    logger.info('invites.service', 'revokeInvite', {
      invitationId: input.invitationId,
      revokedBy:    input.revokedBy,
    })

    const { data, error } = await this.db
      .from('invitations')
      .update({
        status:     'revoked',
        revoked_by: input.revokedBy,
      } as unknown as InvitationInsert)
      .eq('id', input.invitationId)
      .eq('school_id', input.schoolId)
      .eq('status', 'pending')
      .select('*')
      .single()

    if (error?.code === 'PGRST116' || !data) {
      throw new NotFoundError('Invitation', input.invitationId)
    }

    if (error) {
      throw new DALError(
        'DATABASE_ERROR',
        `Failed to revoke invitation: ${extractMessage(error)}`
      )
    }

    logger.info('invites.service', 'invitation revoked', {
      invitationId: input.invitationId,
      revokedBy:    input.revokedBy,
    })

    return data as unknown as InvitationRow
  }

  // ── Read ──────────────────────────────────────────────────────────

  async getById(id: string, schoolId: string): Promise<InvitationRow | null> {
    logger.info('invites.service', 'getById', { id })

    const { data, error } = await this.db
      .from('invitations')
      .select('*')
      .eq('id', id)
      .eq('school_id', schoolId)
      .single()

    if (error?.code === 'PGRST116') return null
    if (error) throw new DALError('DATABASE_ERROR', `Failed to fetch invitation: ${extractMessage(error)}`)
    if (!data) return null
    return data as unknown as InvitationRow
  }

  async list(
    schoolId: string,
    options:  ListInvitesOptions = {}
  ): Promise<PaginatedInvitations> {
    const {
      status,
      studentId,
      invitedBy,
      limit  = DEFAULT_LIMIT,
      offset = DEFAULT_OFFSET,
    } = options

    const safeLimit = Math.min(limit, MAX_LIMIT)

    logger.info('invites.service', 'list', {
      schoolId, status, studentId,
      limit: safeLimit, offset,
    })

    let q = this.db
      .from('invitations')
      .select('*', { count: 'exact' })
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false })

    if (status)    q = q.eq('status', status)
    if (studentId) q = q.eq('student_id', studentId)
    if (invitedBy) q = q.eq('invited_by', invitedBy)

    const { data, count, error } = await q
      .range(offset, offset + safeLimit - 1)

    if (error) {
      throw new DALError('DATABASE_ERROR', `Failed to list invitations: ${extractMessage(error)}`)
    }

    return {
      data:    (data ?? []) as unknown as InvitationRow[],
      count:   count ?? 0,
      hasMore: (count ?? 0) > offset + safeLimit,
    }
  }

  async getStats(schoolId: string): Promise<InviteStats> {
    logger.info('invites.service', 'getStats', { schoolId })

    const { data, error } = await this.db
      .from('invitations')
      .select('status')
      .eq('school_id', schoolId)

    if (error) {
      throw new DALError('DATABASE_ERROR', `Failed to fetch invite stats: ${extractMessage(error)}`)
    }

    const rows = (data ?? []) as { status: string }[]

    return {
      total:    rows.length,
      pending:  rows.filter(r => r.status === 'pending').length,
      accepted: rows.filter(r => r.status === 'accepted').length,
      expired:  rows.filter(r => r.status === 'expired').length,
      revoked:  rows.filter(r => r.status === 'revoked').length,
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────

  async cleanupExpired(schoolId?: string): Promise<number> {
    logger.info('invites.service', 'cleanupExpired', { schoolId })

    const { data, error } = await this.db
      .rpc('cleanup_expired_invitations', {
        p_school_id: schoolId ?? null,   // null = clean all schools
      } as unknown as Record<string, unknown>)  // ← fixes TS2322 on RPC params

    if (error) {
      logger.error('invites.service', 'cleanup failed', {
        code: error.code,
        hint: error.hint,
      })
      throw new DALError('DATABASE_ERROR', `Cleanup failed: ${extractMessage(error)}`)
    }

    const affected = (data as number) ?? 0
    logger.info('invites.service', 'cleanup complete', { affected })
    return affected
  }

  // ── Private helpers ───────────────────────────────────────────────

  private async assertStudentBelongsToSchool(
    studentId: string,
    schoolId:  string
  ): Promise<void> {
    const { data, error } = await this.db
      .from('students')
      .select('id')
      .eq('id', studentId)
      .eq('school_id', schoolId)
      .single()

    if (error?.code === 'PGRST116' || !data) {
      throw new DALError('NOT_FOUND', 'Student not found in this school')
    }

    if (error) {
      throw new DALError('DATABASE_ERROR', `Failed to verify student: ${extractMessage(error)}`)
    }
  }

  private async assertRateLimit(
    studentId: string,
    schoolId:  string
  ): Promise<void> {
    const since = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString()

    const { count, error } = await this.db
      .from('invitations')
      .select('*', { count: 'exact', head: true })
      .eq('student_id', studentId)
      .eq('school_id', schoolId)
      .gte('created_at', since)

    if (error) {
      logger.warn('invites.service', 'rate limit check failed', {
        code: error.code,
      })
      return  // don't block on rate limit check failure
    }

    if ((count ?? 0) >= MAX_INVITES_PER_DAY) {
      logger.warn('invites.service', 'rate limit exceeded', {
        studentId,
        count,
        limit: MAX_INVITES_PER_DAY,
      })
      throw new DALError(
        'RATE_LIMITED',
        `Maximum of ${MAX_INVITES_PER_DAY} invitations per student per day exceeded`
      )
    }
  }

  private async findPendingByEmailAndStudent(
    email:     string,
    studentId: string
  ): Promise<InvitationRow | null> {
    const { data, error } = await this.db
      .from('invitations')
      .select('*')
      .eq('email', email)
      .eq('student_id', studentId)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (error?.code === 'PGRST116') return null
    if (error) return null
    return data as unknown as InvitationRow
  }

  private async markExpired(invitationId: string): Promise<void> {
    const { error } = await this.db
      .from('invitations')
      .update({ status: 'expired' })
      .eq('id', invitationId)
      .eq('status', 'pending')

    if (error) {
      logger.warn('invites.service', 'failed to mark invitation expired', {
        invitationId,
        code: error.code,
      })
    }
  }
}