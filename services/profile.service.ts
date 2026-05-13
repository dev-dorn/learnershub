// src/services/profiles.service.ts
import { z } from "zod"
import { logger } from "@/lib/logger"
import { Database } from "@/types/supabase"

import {
  DALError,
  ListProfilesOptions,
  ProfilesRepository,
  requireRole,
  ValidationError,
} from "@/dal "
import { PaginatedProfiles } from "@/dal /profiles.repository"

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"]

// ── Schemas ───────────────────────────────────────────────────────────

const ProfileCreateSchema = z.object({
  full_name: z.string().min(2).max(200),
  role: z.enum(["admin", "principal", "teacher", "student", "parent"]),
  phone: z.string().max(20).nullable().optional(),
  avatar_url: z.string().url().nullable().optional(),
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
  schoolId: string
  userId: string
  role: string
}

// ── Constants ─────────────────────────────────────────────────────────

const ADMIN_ROLES = ["admin", "principal"] as const
const SIS_ROLES = ["admin"] as const

// ── Service ───────────────────────────────────────────────────────────

export class ProfilesService {
  constructor(private repo: ProfilesRepository) {}

  // ── Auth flow ─────────────────────────────────────────────────────

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

    // school_id is string | null — throw if missing
    if (!profile.school_id) {
      logger.warn("profiles.service", "profile has no school_id", { userId })
      throw new DALError("UNAUTHORIZED", "Profile is not linked to a school")
    }

    return {
      schoolId: profile.school_id, // guaranteed string
      userId: profile.id,
      role: profile.role,
    }
  }

  async recordLogin(userId: string): Promise<void> {
    await this.repo.updateLastLogin(userId, {
      last_login_at: new Date().toISOString(),
      failed_login_attempts: 0,
    })
  }

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

    // Always update attempt count
    await this.repo.updateLastLogin(userId, {
      last_login_at: new Date().toISOString(),
      failed_login_attempts: attempts,
    })

    // Lock account if threshold reached
    if (shouldLock) {
      logger.warn("profiles", "locking account after max failed attempts", {
        userId,
        attempts,
      })

      await this.repo.updateAccountStatus(
        userId,
        {
          account_status: "locked",
          failed_login_attempts: attempts,
          locked_until: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        },
        "" // no schoolId during auth flow — called before context exists
      )
    }
  }

  // ── Read ──────────────────────────────────────────────────────────

  async getById(
    id: string,
    context: ProfileContext
  ): Promise<ProfileRow | null> {
    return this.repo.getById(id, context.schoolId)
  }

  async getMe(context: ProfileContext): Promise<ProfileRow | null> {
    return this.repo.getById(context.userId, context.schoolId)
  }

  async list(
    options: ListProfilesOptions,
    context: ProfileContext
  ): Promise<PaginatedProfiles> {
    requireRole(context.role as never, [...ADMIN_ROLES])
    return this.repo.list(options, context.schoolId)
  }

  // ── Write ─────────────────────────────────────────────────────────

  async create(
    input: unknown,
    userId: string,
    context: ProfileContext
  ): Promise<ProfileRow> {
    requireRole(context.role as never, [...ADMIN_ROLES])

    const parsed = ProfileCreateSchema.safeParse(input)
    if (!parsed.success)
      throw new ValidationError(
        parsed.error.issues
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")
      )

    return this.repo.create({
      ...parsed.data,
      id: userId,
      school_id: context.schoolId,
    })
  }

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

  async update(
    id: string,
    input: unknown,
    context: ProfileContext
  ): Promise<ProfileRow> {
    requireRole(context.role as never, [...ADMIN_ROLES])

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
    requireRole(context.role as never, [...ADMIN_ROLES])

    if (id === context.userId)
      throw new DALError("VALIDATION_ERROR", "Cannot delete your own profile")

    return this.repo.delete(id, context.schoolId)
  }

  // ── Account management ────────────────────────────────────────────

  async suspendAccount(
    id: string,
    context: ProfileContext
  ): Promise<ProfileRow> {
    requireRole(context.role as never, [...ADMIN_ROLES])

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
    requireRole(context.role as never, [...ADMIN_ROLES])

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
    requireRole(context.role as never, [...ADMIN_ROLES])

    logger.info("profiles", "unlockAccount", {
      id,
      unlockedBy: context.userId,
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

  // ── Verification ──────────────────────────────────────────────────

  async markVerified(id: string, context: ProfileContext): Promise<ProfileRow> {
    requireRole(context.role as never, [...ADMIN_ROLES])

    logger.info("profiles", "markVerified", {
      id,
      verifiedBy: context.userId,
    })

    return this.repo.updateVerification(
      id,
      {
        verification_status: "verified",
        verification_code_hash: null,
        verification_code_expires_at: null,
      },
      context.schoolId
    )
  }

  // ── SIS sync ──────────────────────────────────────────────────────

  async syncFromSIS(
    id: string,
    sisId: string,
    context: ProfileContext
  ): Promise<ProfileRow> {
    requireRole(context.role as never, [...SIS_ROLES])

    logger.info("profiles", "syncFromSIS", { id, sisId })

    return this.repo.updateSIS(
      id,
      {
        sis_id: sisId,
        sis_last_synced_at: new Date().toISOString(),
        sis_sync_status: "synced",
      },
      context.schoolId
    )
  }
}
