import { SupabaseClient, PostgrestError } from "@supabase/supabase-js"
import { Database } from "@/types/supabase"
import {
  DALError,
  NotFoundError,
  ConflictError,
  DatabaseError,
} from "./errors"
import { logger } from "@/lib/logger"

// ── Types ─────────────────────────────────────────────────────────────

type ProfileRow    = Database["public"]["Tables"]["profiles"]["Row"]
type ProfileInsert = Database["public"]["Tables"]["profiles"]["Insert"]

// ── Internal input types ──────────────────────────────────────────────

export interface InternalProfileInput {
  // id comes from auth.users.id — always from Supabase auth, never generated here
  id:        string
  full_name: string
  role:      string
  school_id: string   // always from session / onboarding flow

  // Optional
  phone?:      string | null
  avatar_url?: string | null
}

// Narrow update types per operation domain

export interface InternalProfileUpdate {
  full_name?:  string | null
  phone?:      string | null
  avatar_url?: string | null
}

export interface InternalAccountStatusUpdate {
  account_status:        string
  locked_until?:         string | null
  failed_login_attempts?: number
}

export interface InternalLastLoginUpdate {
  last_login_at:         string   // always server time
  failed_login_attempts: number
}

export interface InternalVerificationUpdate {
  verification_status:          string
  verification_code_hash?:      string | null
  verification_code_expires_at?: string | null
}

export interface InternalSISUpdate {
  sis_id:             string
  sis_last_synced_at: string   // always server time
  sis_sync_status:    string
}

// ── List options ──────────────────────────────────────────────────────

// schoolId is intentionally excluded — always passed as a mandatory
// separate param from session context. NEVER add schoolId here.
export interface ListProfilesOptions {
  role?:               string
  accountStatus?:      string
  verificationStatus?: string
  mfaEnabled?:         boolean
  limit?:              number
  offset?:             number
}

// ── Result types ──────────────────────────────────────────────────────

export interface PaginatedProfiles {
  data:    ProfileRow[]
  count:   number
  hasMore: boolean
}

// ── Constants ─────────────────────────────────────────────────────────

// Excludes sensitive security fields — never returned to clients
// verification_code_hash and verification_code_expires_at are internal only
const SAFE_COLS = [
  "id",
  "full_name",
  "role",
  "school_id",
  "phone",
  "avatar_url",
  "account_status",
  "mfa_enabled",
  "last_login_at",
  "failed_login_attempts",
  "locked_until",
  "verification_status",
  "sis_id",
  "sis_last_synced_at",
  "sis_sync_status",
  "created_at",
  "updated_at",
  // NOT here — internal security fields:
  // verification_code_hash
  // verification_code_expires_at
].join(", ")

// Used only by verification flow — needs the hash
const VERIFICATION_COLS = [
  "id",
  "verification_status",
  "verification_code_hash",
  "verification_code_expires_at",
  "school_id",
].join(", ")

const DEFAULT_LIMIT  = 20
const MAX_LIMIT      = 100
const DEFAULT_OFFSET = 0

// ── Repository ────────────────────────────────────────────────────────

export class ProfilesRepository {
  constructor(private db: SupabaseClient<Database>) {}

  // ── Error handling ────────────────────────────────────────────────

  private handleDbError(error: PostgrestError, operation: string): never {
    logger.error("profiles", `PostgREST error during ${operation}`, {
      code:    error.code,
      hint:    error.hint,
      details: error.details,
    })

    switch (error.code) {
      case "23505": throw new ConflictError("Profile", "id")
      case "23503": throw new DALError("FOREIGN_KEY_ERROR", `Related record not found: ${operation}`)
      case "23502": throw new DALError("VALIDATION_ERROR", `Required field missing: ${error.details}`)
      case "23514": throw new DALError("VALIDATION_ERROR", `Value out of allowed range: ${error.details}`)
      case "42501": throw new DALError("UNAUTHORIZED", "RLS policy violation — insufficient permissions")
      default:      throw new DatabaseError(operation, error)
    }
  }

  // ── Query helpers ─────────────────────────────────────────────────

  private safeSelect(cols?: string) {
    return this.db.from("profiles").select(cols ?? SAFE_COLS)
  }

  // ── Read ──────────────────────────────────────────────────────────

  // Primary post-login lookup — id is auth.users.id from Supabase session
  async getById(id: string, schoolId: string): Promise<ProfileRow | null> {
    logger.info("profiles", "getById", { id })

    const { data, error } = await this.safeSelect()
      .eq("id", id)
      .eq("school_id", schoolId)  // ← tenant isolation
      .single()

    if (error?.code === "PGRST116") return null
    if (error) this.handleDbError(error, "getById")
    if (!data) return null
    return data as unknown as ProfileRow
  }

  // Used by auth middleware to load context — no schoolId yet at this point
  // This is the ONE place we query without school_id — only safe because
  // id = auth.users.id which is globally unique and user-owned
  async getByIdForAuth(id: string): Promise<ProfileRow | null> {
    logger.info("profiles", "getByIdForAuth", { id })

    const { data, error } = await this.safeSelect()
      .eq("id", id)
      .single()

    if (error?.code === "PGRST116") return null
    if (error) this.handleDbError(error, "getByIdForAuth")
    if (!data) return null
    return data as unknown as ProfileRow
  }

  // Used by verification flow — returns hash fields not in SAFE_COLS
  async getForVerification(id: string): Promise<ProfileRow | null> {
    logger.info("profiles", "getForVerification", { id })

    const { data, error } = await this.db
      .from("profiles")
      .select(VERIFICATION_COLS)
      .eq("id", id)
      .single()

    if (error?.code === "PGRST116") return null
    if (error) this.handleDbError(error, "getForVerification")
    if (!data) return null
    return data as unknown as ProfileRow
  }

  async list(options: ListProfilesOptions, schoolId: string): Promise<PaginatedProfiles> {
    const {
      role,
      accountStatus,
      verificationStatus,
      mfaEnabled,
      limit  = DEFAULT_LIMIT,
      offset = DEFAULT_OFFSET,
    } = options

    const safeLimit = Math.min(limit, MAX_LIMIT)

    logger.info("profiles", "list", {
      schoolId, role, accountStatus,
      verificationStatus, limit: safeLimit, offset,
    })

    let q = this.db
      .from("profiles")
      .select(SAFE_COLS, { count: "exact" })
      .eq("school_id", schoolId)  // ← tenant isolation always applied first

    if (role)               q = q.eq("role", role)
    if (accountStatus)      q = q.eq("account_status", accountStatus)
    if (verificationStatus) q = q.eq("verification_status", verificationStatus)
    if (mfaEnabled !== undefined) q = q.eq("mfa_enabled", mfaEnabled)

    const { data, count, error } = await q
      .range(offset, offset + safeLimit - 1)
      .order("full_name", { ascending: true })

    if (error) this.handleDbError(error, "list")

    return {
      data:    (data ?? []) as unknown as ProfileRow[],
      count:   count ?? 0,
      hasMore: (count ?? 0) > offset + safeLimit,
    }
  }

  // ── Write ─────────────────────────────────────────────────────────

  // Called once after Supabase auth signup — id must match auth.users.id
  async create(record: InternalProfileInput): Promise<ProfileRow> {
    logger.info("profiles", "create", {
      id:   record.id,
      role: record.role,
    })

    const { data, error } = await this.db
      .from("profiles")
      .insert({
        ...record,
        account_status:      "active",
        verification_status: "pending",
        mfa_enabled:         false,
        failed_login_attempts: 0,
      } as unknown as ProfileInsert)
      .select(SAFE_COLS)
      .single()

    if (error) this.handleDbError(error, "create")
    if (!data) throw new DatabaseError("create — no data returned")
    return data as unknown as ProfileRow
  }

  // General profile update — name, phone, avatar only
  async update(
    id:       string,
    data:     InternalProfileUpdate,
    schoolId: string
  ): Promise<ProfileRow> {
    return this._update(id, data, schoolId, "update")
  }

  // Account status — lock, suspend, activate
  // Only reachable via service methods that require admin role
  async updateAccountStatus(
    id:       string,
    data:     InternalAccountStatusUpdate,
    schoolId: string
  ): Promise<ProfileRow> {
    return this._update(id, data, schoolId, "updateAccountStatus")
  }

  // Login tracking — called by auth flow, not by HTTP handlers
  async updateLastLogin(
    id:   string,
    data: InternalLastLoginUpdate
  ): Promise<void> {
    logger.info("profiles", "updateLastLogin", { id })

    // No schoolId needed — this is called during auth before context is built
    // Safe because id = auth.users.id which is globally unique
    const { error } = await this.db
      .from("profiles")
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq("id", id)

    if (error) this.handleDbError(error, "updateLastLogin")
  }

  // Verification code — set by auth flow, checked by verification flow
  async updateVerification(
    id:       string,
    data:     InternalVerificationUpdate,
    schoolId: string
  ): Promise<ProfileRow> {
    return this._update(id, data, schoolId, "updateVerification")
  }

  // SIS sync — only reachable via syncFromSIS() which requires SIS_ROLES
  async updateSIS(
    id:       string,
    data:     InternalSISUpdate,
    schoolId: string
  ): Promise<ProfileRow> {
    return this._update(id, data, schoolId, "updateSIS")
  }

  // Single internal update — all public update methods route here
  // school_id on every update prevents cross-tenant writes
  private async _update(
    id:        string,
    data:      object,
    schoolId:  string,
    operation: string
  ): Promise<ProfileRow> {
    const { data: row, error } = await this.db
      .from("profiles")
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("school_id", schoolId)  // ← tenant isolation on every write
      .select(SAFE_COLS)
      .single()

    if (error?.code === "PGRST116") throw new NotFoundError("Profile", id)
    if (error) this.handleDbError(error, operation)
    if (!row) throw new NotFoundError("Profile", id)
    return row as unknown as ProfileRow
  }

  async delete(id: string, schoolId: string): Promise<void> {
    logger.info("profiles", "delete", { id })

    const { data, error } = await this.db
      .from("profiles")
      .delete()
      .eq("id", id)
      .eq("school_id", schoolId)  // ← tenant isolation
      .select("id")

    if (error) this.handleDbError(error, "delete")
    if (!data || data.length === 0) throw new NotFoundError("Profile", id)
  }
}