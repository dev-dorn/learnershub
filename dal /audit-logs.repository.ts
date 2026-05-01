// src/dal/audit-logs.repository.ts
import { SupabaseClient, PostgrestError } from '@supabase/supabase-js'
import { Database, Json } from "@/types/supabase"
import { DatabaseError } from './errors'
import { logger } from '@/lib/logger'

// ── Types ─────────────────────────────────────────────────────────────

type AuditLogRow    = Database['public']['Tables']['audit_logs']['Row']
type AuditLogInsert = Database['public']['Tables']['audit_logs']['Insert']

// ── Action constants ──────────────────────────────────────────────────
// Strongly typed action names — prevents typos across the codebase

export const AUDIT_ACTIONS = {
  // User management
  USER_CREATED:             'user.created',
  USER_UPDATED:             'user.updated',
  USER_DELETED:             'user.deleted',
  USER_SUSPENDED:           'user.suspended',
  USER_ACTIVATED:           'user.activated',
  USER_LOCKED:              'user.locked',
  USER_UNLOCKED:            'user.unlocked',

  // Auth events
  LOGIN_SUCCESS:            'auth.login_success',
  LOGIN_FAILED:             'auth.login_failed',
  LOGOUT:                   'auth.logout',
  PASSWORD_CHANGED:         'auth.password_changed',
  PASSWORD_RESET_REQUESTED: 'auth.password_reset_requested',
  MFA_ENABLED:              'auth.mfa_enabled',
  MFA_DISABLED:             'auth.mfa_disabled',

  // Role management
  ROLE_ASSIGNED:            'role.assigned',
  ROLE_CHANGED:             'role.changed',

  // Invitation flow
  PARENT_INVITED:           'invitation.parent_invited',
  INVITATION_ACCEPTED:      'invitation.accepted',
  INVITATION_REVOKED:       'invitation.revoked',
  INVITATION_EXPIRED:       'invitation.expired',

  // Students
  STUDENT_CREATED:          'student.created',
  STUDENT_UPDATED:          'student.updated',
  STUDENT_DELETED:          'student.deleted',
  STUDENT_ENROLLED:         'student.enrolled',
  STUDENT_GRADUATED:        'student.graduated',
  STUDENT_TRANSFERRED:      'student.transferred',
  STUDENT_SUSPENDED:        'student.suspended',

  // Teachers
  TEACHER_CREATED:          'teacher.created',
  TEACHER_UPDATED:          'teacher.updated',
  TEACHER_TERMINATED:       'teacher.terminated',

  // Attendance
  ATTENDANCE_RECORDED:      'attendance.recorded',
  ATTENDANCE_UPDATED:       'attendance.updated',
  ATTENDANCE_BULK_RECORDED: 'attendance.bulk_recorded',

  // Results
  RESULT_POSTED:            'result.posted',
  RESULT_UPDATED:           'result.updated',
  RESULT_RETRACTED:         'result.retracted',
  RESULT_BULK_POSTED:       'result.bulk_posted',

  // Report cards
  REPORT_CARD_CREATED:      'report_card.created',
  REPORT_CARD_PUBLISHED:    'report_card.published',
  REPORT_CARD_UNPUBLISHED:  'report_card.unpublished',
  REPORT_CARD_BULK_PUBLISHED: 'report_card.bulk_published',

  // Announcements
  ANNOUNCEMENT_PUBLISHED:   'announcement.published',
  ANNOUNCEMENT_UNPUBLISHED: 'announcement.unpublished',
  ANNOUNCEMENT_DELETED:     'announcement.deleted',

  // Activities
  ACTIVITY_CREATED:         'activity.created',
  ACTIVITY_PUBLISHED:       'activity.published',
  ACTIVITY_CANCELLED:       'activity.cancelled',

  // School settings
  SCHOOL_SETTINGS_UPDATED:  'school.settings_updated',
  SCHOOL_DEACTIVATED:       'school.deactivated',

  // Security events
  SUSPICIOUS_ACCESS:        'security.suspicious_access',
  RATE_LIMIT_HIT:           'security.rate_limit_hit',
  UNAUTHORIZED_ATTEMPT:     'security.unauthorized_attempt',
} as const

export type AuditAction = typeof AUDIT_ACTIONS[keyof typeof AUDIT_ACTIONS]

// ── Resource types ────────────────────────────────────────────────────

export const RESOURCE_TYPES = {
  USER:                 'user',
  PROFILE:              'profile',
  STUDENT:              'student',
  TEACHER:              'teacher',
  CLASS:                'class',
  SCHOOL:               'school',
  ATTENDANCE:           'attendance',
  RESULT:               'result',
  REPORT_CARD:          'report_card',
  ANNOUNCEMENT:         'announcement',
  ACTIVITY:             'activity',
  ACTIVITY_PARTICIPANT: 'activity_participant',
  ACHIEVEMENT:          'achievement',
  TIMETABLE:            'timetable',
  INVITATION:           'invitation',
  SESSION:              'session',
} as const

export type ResourceType = typeof RESOURCE_TYPES[keyof typeof RESOURCE_TYPES]

// ── Input types ───────────────────────────────────────────────────────

export interface AuditLogInput {
  // Who did it — from session context
  actorUserId?:   string
  actorRole?:     string
  actorIp?:       string
  actorUserAgent?: string
  sessionId?:     string

  // What they did
  action:         AuditAction
  resourceType:   ResourceType
  resourceId?:    string

  // What changed
  resourceBefore?: Record<string, unknown>
  resourceAfter?:  Record<string, unknown>

  // Risk assessment
  deviceFingerprint?: string
  riskScore?:         number
  isSuspicious?:      boolean
  suspiciousReasons?: string[]
}

// ── List options ──────────────────────────────────────────────────────

export interface ListAuditLogsOptions {
  actorUserId?:  string
  action?:       AuditAction
  resourceType?: ResourceType
  resourceId?:   string
  isSuspicious?: boolean
  dateFrom?:     string
  dateTo?:       string
  limit?:        number
  offset?:       number
}

export interface PaginatedAuditLogs {
  data:    AuditLogRow[]
  count:   number
  hasMore: boolean
}

// ── Constants ─────────────────────────────────────────────────────────

const DEFAULT_LIMIT  = 50
const MAX_LIMIT      = 200
const DEFAULT_OFFSET = 0

// ── Repository ────────────────────────────────────────────────────────

export class AuditLogsRepository {
  constructor(private db: SupabaseClient<Database>) {}

  // ── Error handling ────────────────────────────────────────────────

  private handleDbError(error: PostgrestError, operation: string): never {
    logger.error('audit_logs', `PostgREST error during ${operation}`, {
      code:    error.code,
      hint:    error.hint,
      details: error.details,
    })
    throw new DatabaseError(operation, error)
  }

  // ── Write — insert only, never update or delete ───────────────────

  async log(input: AuditLogInput): Promise<void> {
    const record: AuditLogInsert = {
      actor_user_id:      input.actorUserId    ?? null,
      actor_role:         input.actorRole      ?? null,
      actor_ip:           input.actorIp        ?? null,
      actor_user_agent:   input.actorUserAgent ?? null,
      session_id:         input.sessionId      ?? null,
      action:             input.action,
      resource_type:      input.resourceType,
      resource_id:        input.resourceId     ?? null,
      resource_before:    (input.resourceBefore as unknown as Json) ?? null,
      resource_after:     (input.resourceAfter  as unknown as Json) ?? null,
      device_fingerprint: input.deviceFingerprint ?? null,
      risk_score:         input.riskScore      ?? 0,
      is_suspicious:      input.isSuspicious   ?? false,
      suspicious_reasons: input.suspiciousReasons ?? null,
    }

    const { error } = await this.db
      .from('audit_logs')
      .insert(record)

    if (error) {
      // Never throw from audit logging — a failed audit log should
      // not block the actual operation. Log the error instead.
      logger.error('audit_logs', 'failed to write audit log', {
        code:   error.code,
        action: input.action,
      })
    }
  }

  // ── Convenience wrappers ──────────────────────────────────────────

  // Standard action log — most common usage
  async logAction(
    action:       AuditAction,
    resourceType: ResourceType,
    context: {
      actorUserId: string
      actorRole:   string
      actorIp?:    string
      sessionId?:  string
    },
    meta: {
      resourceId?:     string
      resourceBefore?: Record<string, unknown>
      resourceAfter?:  Record<string, unknown>
    } = {}
  ): Promise<void> {
    await this.log({
      action,
      resourceType,
      actorUserId:    context.actorUserId,
      actorRole:      context.actorRole,
      actorIp:        context.actorIp,
      sessionId:      context.sessionId,
      resourceId:     meta.resourceId,
      resourceBefore: meta.resourceBefore,
      resourceAfter:  meta.resourceAfter,
    })
  }

  // Security event log — for suspicious activity
  async logSuspicious(
    action:           AuditAction,
    resourceType:     ResourceType,
    actorUserId:      string,
    suspiciousReasons: string[],
    riskScore:        number,
    meta:             Record<string, unknown> = {}
  ): Promise<void> {
    logger.warn('audit_logs', 'suspicious activity detected', {
      action,
      actorUserId,
      suspiciousReasons,
      riskScore,
    })

    await this.log({
      action,
      resourceType,
      actorUserId,
      isSuspicious:      true,
      suspiciousReasons,
      riskScore,
      resourceId: meta.resourceId as string | undefined,
    })
  }

  // Auth event log — login, logout, password changes
  async logAuthEvent(
    action:      AuditAction,
    userId:      string,
    ip?:         string,
    userAgent?:  string,
    sessionId?:  string,
    failed?:     boolean
  ): Promise<void> {
    await this.log({
      action,
      resourceType:  RESOURCE_TYPES.SESSION,
      actorUserId:   userId,
      actorIp:       ip,
      actorUserAgent: userAgent,
      sessionId,
      isSuspicious:  failed ?? false,
      riskScore:     failed ? 25 : 0,
      suspiciousReasons: failed ? ['failed_auth_attempt'] : undefined,
    })
  }

  // ── Read ──────────────────────────────────────────────────────────
  // Audit logs are read-only — no update or delete methods

  async getById(id: string): Promise<AuditLogRow | null> {
    logger.info('audit_logs', 'getById', { id })

    const { data, error } = await this.db
      .from('audit_logs')
      .select('*')
      .eq('id', id)
      .single()

    if (error?.code === 'PGRST116') return null
    if (error) this.handleDbError(error, 'getById')
    if (!data) return null
    return data as unknown as AuditLogRow
  }

  async list(options: ListAuditLogsOptions = {}): Promise<PaginatedAuditLogs> {
    const {
      actorUserId,
      action,
      resourceType,
      resourceId,
      isSuspicious,
      dateFrom,
      dateTo,
      limit  = DEFAULT_LIMIT,
      offset = DEFAULT_OFFSET,
    } = options

    const safeLimit = Math.min(limit, MAX_LIMIT)

    logger.info('audit_logs', 'list', {
      actorUserId, action, resourceType,
      isSuspicious, limit: safeLimit, offset,
    })

    let q = this.db
      .from('audit_logs')
      .select('*', { count: 'exact' })

    if (actorUserId)  q = q.eq('actor_user_id', actorUserId)
    if (action)       q = q.eq('action', action)
    if (resourceType) q = q.eq('resource_type', resourceType)
    if (resourceId)   q = q.eq('resource_id', resourceId)
    if (dateFrom)     q = q.gte('created_at', dateFrom)
    if (dateTo)       q = q.lte('created_at', dateTo)
    if (isSuspicious !== undefined) q = q.eq('is_suspicious', isSuspicious)

    const { data, count, error } = await q
      .range(offset, offset + safeLimit - 1)
      .order('created_at', { ascending: false })

    if (error) this.handleDbError(error, 'list')

    return {
      data:    (data ?? []) as unknown as AuditLogRow[],
      count:   count ?? 0,
      hasMore: (count ?? 0) > offset + safeLimit,
    }
  }

  // Fetches all suspicious logs — for security dashboard
  async getSuspicious(
    dateFrom?: string,
    dateTo?:   string
  ): Promise<AuditLogRow[]> {
    logger.info('audit_logs', 'getSuspicious', { dateFrom, dateTo })

    let q = this.db
      .from('audit_logs')
      .select('*')
      .eq('is_suspicious', true)
      .order('risk_score',  { ascending: false })
      .order('created_at',  { ascending: false })

    if (dateFrom) q = q.gte('created_at', dateFrom)
    if (dateTo)   q = q.lte('created_at', dateTo)

    const { data, error } = await q.limit(MAX_LIMIT)

    if (error) this.handleDbError(error, 'getSuspicious')
    return (data ?? []) as unknown as AuditLogRow[]
  }

  // Fetches all logs for a specific resource — full history of changes
  async getResourceHistory(
    resourceType: ResourceType,
    resourceId:   string
  ): Promise<AuditLogRow[]> {
    logger.info('audit_logs', 'getResourceHistory', { resourceType, resourceId })

    const { data, error } = await this.db
      .from('audit_logs')
      .select('*')
      .eq('resource_type', resourceType)
      .eq('resource_id', resourceId)
      .order('created_at', { ascending: false })

    if (error) this.handleDbError(error, 'getResourceHistory')
    return (data ?? []) as unknown as AuditLogRow[]
  }

  // Fetches all logs for a specific actor — what has this user done
  async getActorHistory(
    actorUserId: string,
    limit = DEFAULT_LIMIT
  ): Promise<AuditLogRow[]> {
    logger.info('audit_logs', 'getActorHistory', { actorUserId })

    const { data, error } = await this.db
      .from('audit_logs')
      .select('*')
      .eq('actor_user_id', actorUserId)
      .order('created_at', { ascending: false })
      .limit(Math.min(limit, MAX_LIMIT))

    if (error) this.handleDbError(error, 'getActorHistory')
    return (data ?? []) as unknown as AuditLogRow[]
  }
}