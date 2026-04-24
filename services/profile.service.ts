import { z } from "zod"
import { logger } from "@/lib/logger"
import { requireRole } from "@/lib/rbac"

import { Database } from "@/types/supabase"
import { DALError, ValidationError } from "@/dal /errors"
import {
  ListProfilesOptions,
  PaginatedProfiles,
  ProfilesRepository,
} from "@/dal /profiles.repository"

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"]

// ── Schemas ───────────────────────────────────────────────────────────

const ProfileCreateSchema = z.object({
  full_name: z.string().min(2).max(200),
  role: z.enum(["admin", "principal", "teacher", "student", "parent"]),
  phone: z.string().max(20).nullable().optional(),
  avatar_url: z.string().url().nullable().optional(),
  // id, school_id injected from session — never from client
  // role should come from the onboarding/invite flow, not free-form client input
})

const ProfileUpdateSchema = z.object({
  full_name: z.string().min(2).max(200).optional(),
  phone: z.string().max(20).nullable().optional(),
  avatar_url: z.string().url().nullable().optional(),
})

export type CreateProfileInput = z.infer<typeof ProfileCreateSchema>
export type UpdateProfileInput = z.infer<typeof ProfileUpdateSchema>

// ── Context ───────────────────────────────────────────────────────────

export interface ProfileContext {
  schoolId: string // from auth session app_metadata
  userId: string // from auth session (auth.users.id)
  role: string // from profiles.role via getByIdForAuth
}

// ── Constants ─────────────────────────────────────────────────────────

const ADMIN_ROLES = ["admin", "principal"] as const
const SIS_ROLES = ["admin"] as const

// ── Service ───────────────────────────────────────────────────────────

export class ProfilesService {
  constructor(private repo: ProfilesRepository) {}

  // ── Auth flow — called by middleware, not HTTP handlers ───────────

  // Called by middleware on every request to build context
  // Uses getByIdForAuth — the one query without school_id
  async loadSessionContext(userId: string): Promise<ProfileContext> {
    const profile = await this.repo.getByIdForAuth(userId)

    if (!profile)
      throw new DALError("UNAUTHORIZED", "No profile found for this user")

    if (profile.account_status === "suspended")
      throw new DALError("UNAUTHORIZED", "Account is suspended")

    if (profile.account_status === "locked") {
      if (profile.locked_until && new Date(profile.locked_until) > new Date())
        throw new DALError(
          "UNAUTHORIZED",
          `Account locked until ${profile.locked_until}`
        )
    }

    return {
      schoolId: profile.school_id,
      userId: profile.id,
      role: profile.role,
    }
  }

  // Called after successful Supabase login
  async recordLogin(userId: string): Promise<void> {
    await this.repo.updateLastLogin(userId, {
      last_login_at: new Date().toISOString(),
      failed_login_attempts: 0, // reset on success
    })
  }

  // Called after failed login attempt
  async recordFailedLogin(
    userId: string,
    currentAttempts: number
  ): Promise<void> {
    const attempts = currentAttempts + 1
    const shouldLock = attempts >= 5

    logger.info("profiles", "recordFailedLogin", {
      userId,
      attempts,
      shouldLock,
    })

    await this.repo.updateAccountStatus(
      userId,
      {
        account_status: shouldLock ? "locked" : "active",
        failed_login_attempts: attempts,
        locked_until: shouldLock
          ? new Date(Date.now() + 30 * 60 * 1000).toISOString() // 30 min lockout
          : null,
        // No schoolId needed — called during auth before context exists
      } as any,
      ""
    )
  }

  // ── Read ──────────────────────────────────────────────────────────

  async getById(
    id: string,
    context: ProfileContext
  ): Promise<ProfileRow | null> {
    return this.repo.getById(id, context.schoolId)
  }

  // Current user's own profile
  async getMe(context: ProfileContext): Promise<ProfileRow | null> {
    return this.repo.getById(context.userId, context.schoolId)
  }

  async list(
    options: ListProfilesOptions,
    context: ProfileContext
  ): Promise<PaginatedProfiles> {
    requireRole(context.role, ADMIN_ROLES, "list profiles")
    return this.repo.list(options, context.schoolId)
  }

  // ── Write ─────────────────────────────────────────────────────────

  // Called once during onboarding after Supabase signup
  // id must be the auth.users.id from the Supabase session
  async create(
    input: unknown,
    userId: string, // from Supabase auth — not from request body
    context: ProfileContext
  ): Promise<ProfileRow> {
    requireRole(context.role, ADMIN_ROLES, "create profiles")

    const parsed = ProfileCreateSchema.safeParse(input)
    if (!parsed.success)
      throw new ValidationError(
        parsed.error.issues
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")
      )

    return this.repo.create({
      ...parsed.data,
      id: userId, // ← from Supabase auth.users.id
      school_id: context.schoolId, // ← always from session
    })
  }

  // User updating their own profile
  async updateMe(input: unknown, context: ProfileContext): Promise<ProfileRow> {
    const parsed = ProfileUpdateSchema.safeParse(input)
    if (!parsed.success)
      throw new ValidationError(
        parsed.error.issues
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")
      )

    return this.repo.update(context.userId, parsed.data, context.schoolId)
  }

  // Admin updating any profile
  async update(
    id: string,
    input: unknown,
    context: ProfileContext
  ): Promise<ProfileRow> {
    requireRole(context.role, ADMIN_ROLES, "update profiles")

    const parsed = ProfileUpdateSchema.safeParse(input)
    if (!parsed.success)
      throw new ValidationError(
        parsed.error.issues
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")
      )

    return this.repo.update(id, parsed.data, context.schoolId)
  }

  async delete(id: string, context: ProfileContext): Promise<void> {
    requireRole(context.role, ADMIN_ROLES, "delete profiles")

    // Prevent self-deletion
    if (id === context.userId)
      throw new DALError("VALIDATION_ERROR", "Cannot delete your own profile")

    return this.repo.delete(id, context.schoolId)
  }

  // ── Account management — admin only ──────────────────────────────

  async suspendAccount(
    id: string,
    context: ProfileContext
  ): Promise<ProfileRow> {
    requireRole(context.role, ADMIN_ROLES, "suspend accounts")

    if (id === context.userId)
      throw new DALError("VALIDATION_ERROR", "Cannot suspend your own account")

    logger.info("profiles", "suspendAccount", {
      id,
      suspendedBy: context.userId,
    })

    return this.repo.updateAccountStatus(
      id,
      {
        account_status: "suspended",
        locked_until: null,
      },
      context.schoolId
    )
  }

  async activateAccount(
    id: string,
    context: ProfileContext
  ): Promise<ProfileRow> {
    requireRole(context.role, ADMIN_ROLES, "activate accounts")

    logger.info("profiles", "activateAccount", {
      id,
      activatedBy: context.userId,
    })

    return this.repo.updateAccountStatus(
      id,
      {
        account_status: "active",
        locked_until: null,
        failed_login_attempts: 0,
      },
      context.schoolId
    )
  }

  async unlockAccount(
    id: string,
    context: ProfileContext
  ): Promise<ProfileRow> {
    requireRole(context.role, ADMIN_ROLES, "unlock accounts")

    logger.info("profiles", "unlockAccount", { id, unlockedBy: context.userId })

    return this.repo.updateAccountStatus(
      id,
      {
        account_status: "active",
        locked_until: null,
        failed_login_attempts: 0,
      },
      context.schoolId
    )
  }

  // ── Verification ──────────────────────────────────────────────────

  async markVerified(id: string, context: ProfileContext): Promise<ProfileRow> {
    requireRole(context.role, ADMIN_ROLES, "verify profiles")

    logger.info("profiles", "markVerified", { id, verifiedBy: context.userId })

    return this.repo.updateVerification(
      id,
      {
        verification_status: "verified",
        verification_code_hash: null, // clear code after verification
        verification_code_expires_at: null,
      },
      context.schoolId
    )
  }

  // ── SIS sync — admin only ─────────────────────────────────────────

  async syncFromSIS(
    id: string,
    sisId: string,
    context: ProfileContext
  ): Promise<ProfileRow> {
    requireRole(context.role, SIS_ROLES, "sync profiles from SIS")

    logger.info("profiles", "syncFromSIS", { id, sisId })

    return this.repo.updateSIS(
      id,
      {
        sis_id: sisId,
        sis_last_synced_at: new Date().toISOString(), // ← always server time
        sis_sync_status: "synced",
      },
      context.schoolId
    )
  }
}
