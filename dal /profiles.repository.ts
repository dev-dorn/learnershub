// src/dal/profiles.repository.ts
import { SupabaseClient, PostgrestError } from '@supabase/supabase-js'
import { Database } from '@/types/supabase'
import { z } from 'zod'
import { DALError, NotFoundError, ValidationError, ConflictError, DatabaseError } from './errors'
import { logger } from '@/lib/logger'

// ── Types ─────────────────────────────────────────────────────────────

type ProfileRow    = Database['public']['Tables']['profiles']['Row']
type ProfileInsert = Database['public']['Tables']['profiles']['Insert']
type ProfileUpdate = Database['public']['Tables']['profiles']['Update']

// ── Schemas ───────────────────────────────────────────────────────────

const ProfileInsertSchema = z.object({
  // Required / non-nullable
  id:        z.string().uuid(),   // must match Supabase auth.users.id
  full_name: z.string().min(2).max(150),
  role:      z.enum(['admin', 'teacher', 'student', 'parent', 'principal']),
  school_id: z.string().uuid(),

  // Optional / nullable — profile details
  phone:      z.string().nullable().optional(),
  avatar_url: z.string().url().nullable().optional(),
  mfa_enabled: z.boolean().nullable().optional().default(false),

  // Optional / nullable — account status
  account_status: z.enum([
    'active', 'inactive', 'suspended', 'locked', 'pending_verification',
  ]).nullable().optional().default('pending_verification'),

  verification_status: z.enum([
    'unverified', 'verified', 'expired',
  ]).nullable().optional().default('unverified'),

  // Security fields — system managed, never set by caller directly
  // failed_login_attempts → incremented by auth system
  // locked_until          → set by auth system
  // last_login_at         → set by auth system
  // verification_code_hash    → set by auth system
  // verification_code_expires_at → set by auth system

  // SIS — system managed
  // sis_id             → set by SIS sync
  // sis_last_synced_at → set by SIS sync
  // sis_sync_status    → set by SIS sync
})

const ProfileUpdateSchema = ProfileInsertSchema
  .omit({
    id:        true,  // never changes — tied to auth.users
    school_id: true,  // never changes
    role:      true,  // role changes should be explicit via assignRole()
  })
  .partial()

// ── Exported input types ──────────────────────────────────────────────

export type CreateProfileInput = z.infer<typeof ProfileInsertSchema>
export type UpdateProfileInput = z.infer<typeof ProfileUpdateSchema>

// ── List options ──────────────────────────────────────────────────────

export interface ListProfilesOptions {
  schoolId?:      string
  role?:          string
  accountStatus?: string
  search?:        string   // searches full_name
  limit?:         number
  offset?:        number
}

// ── Pagination result ─────────────────────────────────────────────────

export interface PaginatedProfiles {
  data:    ProfileRow[]
  count:   number
  hasMore: boolean
}

// ── Constants ─────────────────────────────────────────────────────────

// Public columns — safe for general use, excludes security-sensitive fields
const SAFE_COLS = [
  'id',
  'full_name',
  'role',
  'school_id',
  'phone',
  'avatar_url',
  'mfa_enabled',
  'account_status',
  'verification_status',
  'last_login_at',
  'sis_id',
  'sis_last_synced_at',
  'sis_sync_status',
  'created_at',
  'updated_at',
].join(', ')

// Security columns — only for auth/admin operations, never returned to client
const SECURITY_COLS = `${SAFE_COLS}, failed_login_attempts, locked_until, verification_code_hash, verification_code_expires_at`

const DEFAULT_LIMIT  = 20
const MAX_LIMIT      = 100
const DEFAULT_OFFSET = 0

const MAX_LOGIN_ATTEMPTS = 5  // lock account after this many failures

// ── Repository ────────────────────────────────────────────────────────

export class ProfilesRepository {
  constructor(private db: SupabaseClient<Database>) {}

  // ── Error handling ────────────────────────────────────────────────

  private handleDbError(error: PostgrestError, operation: string): never {
    logger.error('profiles', `PostgREST error during ${operation}`, {
      code:    error.code,
      hint:    error.hint,
      details: error.details,
    })

    switch (error.code) {
      case '23505': throw new ConflictError('Profile', 'id or phone')
      case '23503': throw new DALError('FOREIGN_KEY_ERROR', `Related record not found: ${operation}`)
      case '23502': throw new DALError('VALIDATION_ERROR', `Required field missing: ${error.details}`)
      case '23514': throw new DALError('VALIDATION_ERROR', `Value out of allowed range: ${error.details}`)
      case '42501': throw new DALError('UNAUTHORIZED', 'You do not have permission to access this resource')
      default:      throw new DatabaseError(operation, error)
    }
  }

  // ── Query helpers ─────────────────────────────────────────────────

  private safeSelect(cols?: string) {
    return this.db.from('profiles').select(cols ?? SAFE_COLS)
  }

  // ── Read ──────────────────────────────────────────────────────────

  async getById(id: string): Promise<ProfileRow | null> {
    logger.info('profiles', 'getById', { id })

    const { data, error } = await this.safeSelect()
      .eq('id', id)
      .single()

    if (error?.code === 'PGRST116') return null
    if (error) this.handleDbError(error, 'getById')
    if (!data) return null
    return data as unknown as ProfileRow
  }

  // Used by auth middleware — includes security fields
  async getByIdWithSecurity(id: string): Promise<ProfileRow | null> {
    logger.info('profiles', 'getByIdWithSecurity', { id })

    const { data, error } = await this.safeSelect(SECURITY_COLS)
      .eq('id', id)
      .single()

    if (error?.code === 'PGRST116') return null
    if (error) this.handleDbError(error, 'getByIdWithSecurity')
    if (!data) return null
    return data as unknown as ProfileRow
  }

  async getByPhone(phone: string): Promise<ProfileRow | null> {
    logger.info('profiles', 'getByPhone')  // no phone in meta — PII

    const { data, error } = await this.safeSelect()
      .eq('phone', phone)
      .single()

    if (error?.code === 'PGRST116') return null
    if (error) this.handleDbError(error, 'getByPhone')
    if (!data) return null
    return data as unknown as ProfileRow
  }

  async list(options: ListProfilesOptions = {}): Promise<PaginatedProfiles> {
    const {
      schoolId,
      role,
      accountStatus,
      search,
      limit  = DEFAULT_LIMIT,
      offset = DEFAULT_OFFSET,
    } = options

    const safeLimit = Math.min(limit, MAX_LIMIT)

    logger.info('profiles', 'list', {
      schoolId, role, accountStatus,
      limit: safeLimit, offset,
      // search omitted — could contain PII
    })

    let q = this.db
      .from('profiles')
      .select(SAFE_COLS, { count: 'exact' })

    if (schoolId)      q = q.eq('school_id', schoolId)
    if (role)          q = q.eq('role', role)
    if (accountStatus) q = q.eq('account_status', accountStatus)
    if (search)        q = q.ilike('full_name', `%${search}%`)

    const { data, count, error } = await q
      .range(offset, offset + safeLimit - 1)
      .order('full_name', { ascending: true })

    if (error) this.handleDbError(error, 'list')

    return {
      data:    (data ?? []) as unknown as ProfileRow[],
      count:   count ?? 0,
      hasMore: (count ?? 0) > offset + safeLimit,
    }
  }

  // ── Write ─────────────────────────────────────────────────────────

  async create(input: unknown): Promise<ProfileRow> {
    const parsed = ProfileInsertSchema.safeParse(input)
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues
          .map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`)
          .join(', ')
      )
    }

    logger.info('profiles', 'create', { role: parsed.data.role })
    // full_name omitted from log — PII

    const { data, error } = await this.db
      .from('profiles')
      .insert(parsed.data as unknown as ProfileInsert)
      .select(SAFE_COLS)
      .single()

    if (error) this.handleDbError(error, 'create')
    if (!data) throw new DatabaseError('create — no data returned')
    return data as unknown as ProfileRow
  }

  async update(id: string, input: unknown): Promise<ProfileRow> {
    const parsed = ProfileUpdateSchema.safeParse(input)
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues
          .map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`)
          .join(', ')
      )
    }

    logger.info('profiles', 'update', { id })

    const { data, error } = await this.db
      .from('profiles')
      .update(parsed.data as unknown as ProfileUpdate)
      .eq('id', id)
      .select(SAFE_COLS)
      .single()

    if (error?.code === 'PGRST116') throw new NotFoundError('Profile', id)
    if (error) this.handleDbError(error, 'update')
    if (!data) throw new NotFoundError('Profile', id)
    return data as unknown as ProfileRow
  }

  async delete(id: string): Promise<void> {
    logger.info('profiles', 'delete', { id })

    const exists = await this.getById(id)
    if (!exists) throw new NotFoundError('Profile', id)

    const { error } = await this.db
      .from('profiles')
      .delete()
      .eq('id', id)

    if (error) this.handleDbError(error, 'delete')
  }

  // ── Account status ────────────────────────────────────────────────

  async activate(id: string): Promise<ProfileRow> {
    logger.info('profiles', 'activate', { id })
    return this.update(id, { account_status: 'active' })
  }

  async suspend(id: string): Promise<ProfileRow> {
    logger.info('profiles', 'suspend', { id })
    return this.update(id, { account_status: 'suspended' })
  }

  async lock(id: string, until: string): Promise<ProfileRow> {
    logger.info('profiles', 'lock', { id })

    const { data, error } = await this.db
      .from('profiles')
      .update({
        account_status: 'locked',
        locked_until:   until,
        updated_at:     new Date().toISOString(),
      })
      .eq('id', id)
      .select(SECURITY_COLS)
      .single()

    if (error?.code === 'PGRST116') throw new NotFoundError('Profile', id)
    if (error) this.handleDbError(error, 'lock')
    if (!data) throw new NotFoundError('Profile', id)
    return data as unknown as ProfileRow
  }

  async unlock(id: string): Promise<ProfileRow> {
    logger.info('profiles', 'unlock', { id })

    const { data, error } = await this.db
      .from('profiles')
      .update({
        account_status:        'active',
        locked_until:          null,
        failed_login_attempts: 0,
        updated_at:            new Date().toISOString(),
      })
      .eq('id', id)
      .select(SECURITY_COLS)
      .single()

    if (error?.code === 'PGRST116') throw new NotFoundError('Profile', id)
    if (error) this.handleDbError(error, 'unlock')
    if (!data) throw new NotFoundError('Profile', id)
    return data as unknown as ProfileRow
  }

  // ── Login tracking ────────────────────────────────────────────────

  async recordLogin(id: string): Promise<void> {
    logger.info('profiles', 'recordLogin', { id })

    const { error } = await this.db
      .from('profiles')
      .update({
        last_login_at:         new Date().toISOString(),
        failed_login_attempts: 0,  // reset on successful login
        updated_at:            new Date().toISOString(),
      })
      .eq('id', id)

    if (error) this.handleDbError(error, 'recordLogin')
  }

  // Increments failed attempts and auto-locks after MAX_LOGIN_ATTEMPTS
  async recordFailedLogin(id: string): Promise<ProfileRow> {
    logger.info('profiles', 'recordFailedLogin', { id })

    const profile = await this.getByIdWithSecurity(id)
    if (!profile) throw new NotFoundError('Profile', id)

    const attempts = (profile.failed_login_attempts ?? 0) + 1
    const shouldLock = attempts >= MAX_LOGIN_ATTEMPTS

    // Lock for 30 minutes after max attempts
    const lockedUntil = shouldLock
      ? new Date(Date.now() + 30 * 60 * 1000).toISOString()
      : null

    const { data, error } = await this.db
      .from('profiles')
      .update({
        failed_login_attempts: attempts,
        account_status:        shouldLock ? 'locked' : profile.account_status,
        locked_until:          lockedUntil,
        updated_at:            new Date().toISOString(),
      })
      .eq('id', id)
      .select(SECURITY_COLS)
      .single()

    if (error) this.handleDbError(error, 'recordFailedLogin')
    if (!data) throw new NotFoundError('Profile', id)

    if (shouldLock) {
      logger.warn('profiles', 'account locked after max failed attempts', { id, attempts })
    }

    return data as unknown as ProfileRow
  }

  // ── Role management ───────────────────────────────────────────────

  // Role changes are explicit and auditable — not part of general update()
  async assignRole(
    id:   string,
    role: 'admin' | 'teacher' | 'student' | 'parent' | 'principal'
  ): Promise<ProfileRow> {
    logger.info('profiles', 'assignRole', { id, role })

    const { data, error } = await this.db
      .from('profiles')
      .update({ role, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select(SAFE_COLS)
      .single()

    if (error?.code === 'PGRST116') throw new NotFoundError('Profile', id)
    if (error) this.handleDbError(error, 'assignRole')
    if (!data) throw new NotFoundError('Profile', id)
    return data as unknown as ProfileRow
  }

  // ── Verification ──────────────────────────────────────────────────

  async setVerificationCode(
    id:        string,
    codeHash:  string,
    expiresAt: string
  ): Promise<void> {
    logger.info('profiles', 'setVerificationCode', { id })

    const { error } = await this.db
      .from('profiles')
      .update({
        verification_code_hash:        codeHash,
        verification_code_expires_at:  expiresAt,
        verification_status:           'unverified',
        updated_at:                    new Date().toISOString(),
      })
      .eq('id', id)

    if (error) this.handleDbError(error, 'setVerificationCode')
  }

  async markVerified(id: string): Promise<ProfileRow> {
    logger.info('profiles', 'markVerified', { id })

    const { data, error } = await this.db
      .from('profiles')
      .update({
        verification_status:           'verified',
        verification_code_hash:        null,  // clear code after use
        verification_code_expires_at:  null,
        account_status:                'active',
        updated_at:                    new Date().toISOString(),
      })
      .eq('id', id)
      .select(SAFE_COLS)
      .single()

    if (error?.code === 'PGRST116') throw new NotFoundError('Profile', id)
    if (error) this.handleDbError(error, 'markVerified')
    if (!data) throw new NotFoundError('Profile', id)
    return data as unknown as ProfileRow
  }

  // ── MFA ───────────────────────────────────────────────────────────

  async enableMFA(id: string): Promise<ProfileRow> {
    logger.info('profiles', 'enableMFA', { id })
    return this.update(id, { mfa_enabled: true })
  }

  async disableMFA(id: string): Promise<ProfileRow> {
    logger.info('profiles', 'disableMFA', { id })
    return this.update(id, { mfa_enabled: false })
  }

  // ── SIS sync ──────────────────────────────────────────────────────

  async syncFromSIS(
    id:            string,
    sisId:         string,
    sisSyncStatus: string
  ): Promise<ProfileRow> {
    logger.info('profiles', 'syncFromSIS', { id, sisId })

    const { data, error } = await this.db
      .from('profiles')
      .update({
        sis_id:             sisId,
        sis_sync_status:    sisSyncStatus,
        sis_last_synced_at: new Date().toISOString(),
        updated_at:         new Date().toISOString(),
      })
      .eq('id', id)
      .select(SAFE_COLS)
      .single()

    if (error?.code === 'PGRST116') throw new NotFoundError('Profile', id)
    if (error) this.handleDbError(error, 'syncFromSIS')
    if (!data) throw new NotFoundError('Profile', id)
    return data as unknown as ProfileRow
  }
}