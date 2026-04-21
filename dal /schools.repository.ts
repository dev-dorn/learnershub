// src/dal/schools.repository.ts
import { SupabaseClient, PostgrestError } from "@supabase/supabase-js"
import { Database, Json } from "@/types/supabase"
import { z } from "zod"
import {
  DALError,
  NotFoundError,
  ValidationError,
  ConflictError,
  DatabaseError,
} from "./errors"
import { logger } from "@/lib/logger"

// ── Types ─────────────────────────────────────────────────────────────

type SchoolRow = Database["public"]["Tables"]["schools"]["Row"]
type SchoolInsert = Database["public"]["Tables"]["schools"]["Insert"]
type SchoolUpdate = Database["public"]["Tables"]["schools"]["Update"]

// ── Schemas ───────────────────────────────────────────────────────────

const SchoolCreateSchema = z.object({
  // Required
  name: z.string().min(2).max(150),
  code: z
    .string()
    .min(3)
    .max(20)
    .regex(/^[A-Z0-9-]+$/, "Code must be uppercase alphanumeric with hyphens"),

  // Optional
  address: z.string().max(300).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  timezone: z.string().default("Africa/Nairobi"),
  logo_url: z.string().url().optional(),
  is_active: z.boolean().default(true),
})

const SchoolUpdateSchema = SchoolCreateSchema.partial()

// ── Exported input types ──────────────────────────────────────────────

export type CreateSchoolInput = z.infer<typeof SchoolCreateSchema>
export type UpdateSchoolInput = z.infer<typeof SchoolUpdateSchema>

// ── List options ──────────────────────────────────────────────────────

export interface ListSchoolsOptions {
  isActive?: boolean
  search?: string
  limit?: number
  offset?: number
}

// ── Pagination result ─────────────────────────────────────────────────

export interface PaginatedSchools {
  data: SchoolRow[]
  count: number
  hasMore: boolean
}

// ── Constants ─────────────────────────────────────────────────────────

// SAFE_COLS — for public/general views, excludes large JSON blobs
const SAFE_COLS = [
  "id",
  "name",
  "code",
  "address",
  "email",
  "phone",
  "timezone",
  "logo_url",
  "is_active",
  "created_at",
  "updated_at",
].join(", ")

// ADMIN_COLS — for admin views, includes settings and academic calendar
const ADMIN_COLS = `${SAFE_COLS}, settings, academic_calendar`

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
const DEFAULT_OFFSET = 0

// ── Repository ────────────────────────────────────────────────────────

export class SchoolsRepository {
  constructor(private db: SupabaseClient<Database>) {}

  // ── Error handling ────────────────────────────────────────────────

  private handleDbError(error: PostgrestError, operation: string): never {
    logger.error("schools", `PostgREST error during ${operation}`, {
      code: error.code,
      hint: error.hint,
      details: error.details,
    })

    switch (error.code) {
      case "23505":
        throw new ConflictError("School", "code")
      case "23503":
        throw new DALError(
          "FOREIGN_KEY_ERROR",
          `Related record not found: ${operation}`
        )
      case "23502":
        throw new DALError(
          "VALIDATION_ERROR",
          `Required field missing: ${error.details}`
        )
      case "23514":
        throw new DALError(
          "VALIDATION_ERROR",
          `Value out of allowed range: ${error.details}`
        )
      case "42501":
        throw new DALError(
          "UNAUTHORIZED",
          "Insufficient permissions to modify school data"
        )
      default:
        throw new DatabaseError(operation, error)
    }
  }

  // ── Query helpers ─────────────────────────────────────────────────

  private baseSelect(cols = SAFE_COLS) {
    return this.db.from("schools").select(cols)
  }

  // ── Read ──────────────────────────────────────────────────────────

  async getById(id: string, includeConfig = false): Promise<SchoolRow | null> {
    logger.info("schools", "getById", { id, includeConfig })

    const { data, error } = await this.baseSelect(
      includeConfig ? ADMIN_COLS : SAFE_COLS
    )
      .eq("id", id)
      .single()

    if (error?.code === "PGRST116") return null
    if (error) this.handleDbError(error, "getById")
    if (!data) return null
    return data as unknown as SchoolRow
  }

  async getByCode(code: string): Promise<SchoolRow | null> {
    logger.info("schools", "getByCode", { code })

    const { data, error } = await this.baseSelect().eq("code", code).single()

    if (error?.code === "PGRST116") return null
    if (error) this.handleDbError(error, "getByCode")
    if (!data) return null
    return data as unknown as SchoolRow
  }

  async list(options: ListSchoolsOptions = {}): Promise<PaginatedSchools> {
    const {
      isActive,
      search,
      limit = DEFAULT_LIMIT,
      offset = DEFAULT_OFFSET,
    } = options

    const safeLimit = Math.min(limit, MAX_LIMIT)

    logger.info("schools", "list", {
      isActive,
      search,
      limit: safeLimit,
      offset,
    })

    let q = this.db
      .from("schools")
      .select(SAFE_COLS, { count: "exact" })
      .order("created_at", { ascending: false })

    if (isActive !== undefined) q = q.eq("is_active", isActive)
    if (search) {
      q = q.or(`name.ilike.%${search}%,code.ilike.%${search}%`)
    }

    const { data, count, error } = await q.range(offset, offset + safeLimit - 1)

    if (error) this.handleDbError(error, "list")

    return {
      data: (data ?? []) as unknown as SchoolRow[],
      count: count ?? 0,
      hasMore: (count ?? 0) > offset + safeLimit,
    }
  }

  // ── Write ─────────────────────────────────────────────────────────

  async create(input: unknown): Promise<SchoolRow> {
    const parsed = SchoolCreateSchema.safeParse(input)
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues
          .map((e: z.ZodIssue) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")
      )
    }

    logger.info("schools", "create", {
      name: parsed.data.name,
      code: parsed.data.code,
    })

    const { data, error } = await this.db
      .from("schools")
      .insert(parsed.data as unknown as SchoolInsert)
      .select(SAFE_COLS)
      .single()

    if (error) this.handleDbError(error, "create")
    if (!data) throw new DatabaseError("create — no data returned")
    return data as unknown as SchoolRow
  }

  async update(id: string, input: unknown): Promise<SchoolRow> {
    const parsed = SchoolUpdateSchema.safeParse(input)
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues
          .map((e: z.ZodIssue) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")
      )
    }

    logger.info("schools", "update", { id })

    const { data, error } = await this.db
      .from("schools")
      .update(parsed.data as unknown as SchoolUpdate)
      .eq("id", id)
      .select(SAFE_COLS)
      .single()

    if (error?.code === "PGRST116") throw new NotFoundError("School", id)
    if (error) this.handleDbError(error, "update")
    if (!data) throw new NotFoundError("School", id)
    return data as unknown as SchoolRow
  }

  /**
   * Soft delete via is_active flag.
   * Preserves referential integrity for students, teachers, and financial records.
   * Hard deletes require SUPABASE_SERVICE_ROLE_KEY via admin scripts.
   */
  async deactivate(id: string): Promise<void> {
    logger.info("schools", "deactivate", { id })

    const { error } = await this.db
      .from("schools")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id")
      .single()

    if (error?.code === "PGRST116") throw new NotFoundError("School", id)
    if (error) this.handleDbError(error, "deactivate")
  }

  async activate(id: string): Promise<void> {
    logger.info("schools", "activate", { id })

    const { error } = await this.db
      .from("schools")
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id")
      .single()

    if (error?.code === "PGRST116") throw new NotFoundError("School", id)
    if (error) this.handleDbError(error, "activate")
  }

  // ── Admin operations ──────────────────────────────────────────────

  /**
   * Safely merges JSON config without overwriting unrelated keys.
   * Tries RPC first, falls back to manual merge if RPC not deployed.
   */
  async updateSettings(
    id: string,
    partialSettings: Record<string, unknown>
  ): Promise<SchoolRow> {
    logger.info("schools", "updateSettings", { id })

    const { data: rpcData, error: rpcError } = await (this.db as SupabaseClient)
      .rpc("merge_school_settings", {
        p_school_id: id,
        p_settings: partialSettings,
      })
      .select(ADMIN_COLS)
      .single()

    // RPC not deployed — fall back to manual merge
    if (rpcError?.code === "PGRST116" || rpcError?.code === "42883") {
      logger.warn(
        "schools",
        "updateSettings — RPC not found, falling back to manual merge",
        { id }
      )

      const { data: existing, error: fetchError } = await this.db
        .from("schools")
        .select("settings")
        .eq("id", id)
        .single()

      if (fetchError?.code === "PGRST116") throw new NotFoundError("School", id)
      if (fetchError)
        this.handleDbError(fetchError, "updateSettings — fetch existing")

      const merged = {
        ...((existing?.settings as Record<string, unknown>) ?? {}),
        ...partialSettings,
      }

      const { data: updated, error: updateError } = await this.db
        .from("schools")
        .update({ settings: merged as unknown as Json, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select(ADMIN_COLS)
        .single()

      if (updateError)
        this.handleDbError(updateError, "updateSettings — manual merge")
      if (!updated) throw new NotFoundError("School", id)
      return updated as unknown as SchoolRow
    }

    if (rpcError) this.handleDbError(rpcError, "updateSettings")
    if (!rpcData) throw new NotFoundError("School", id)
    return rpcData as unknown as SchoolRow
  }
}
