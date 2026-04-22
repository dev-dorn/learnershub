// src/dal/announcements.repository.ts
import { SupabaseClient, PostgrestError } from "@supabase/supabase-js"
import { Database } from "@/types/supabase"
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

type AnnouncementRow = Database["public"]["Tables"]["announcements"]["Row"]
type AnnouncementInsert =
  Database["public"]["Tables"]["announcements"]["Insert"]
type AnnouncementUpdate =
  Database["public"]["Tables"]["announcements"]["Update"]

// ── Schemas ───────────────────────────────────────────────────────────

const AnnouncementInsertSchema = z
  .object({
    // Required / non-nullable
    audience: z.enum([
      "all",
      "students",
      "teachers",
      "parents",
      "specific_class",
    ]),
    body: z.string().min(1).max(5000),
    school_id: z.string().uuid(),
    title: z.string().min(2).max(200),

    // Optional / nullable
    expires_at: z.string().nullable().optional(),
    is_pinned: z.boolean().nullable().optional().default(false),
    posted_by: z.string().uuid().nullable().optional(),
    priority: z
      .enum(["low", "normal", "high", "urgent"])
      .nullable()
      .optional()
      .default("normal"),
    target_class_id: z.string().uuid().nullable().optional(),

    // Publishing — system managed
    // is_published → set via publish()
    // published_at → set via publish()
  })
  .refine(
    (data) =>
      data.audience !== "specific_class" || data.target_class_id !== null,
    {
      message: "target_class_id is required when audience is specific_class",
      path: ["target_class_id"],
    }
  )

const AnnouncementUpdateSchema = AnnouncementInsertSchema.omit({
  school_id: true,
}) // never changes after creation
  .partial()

// ── Exported input types ──────────────────────────────────────────────

export type CreateAnnouncementInput = z.infer<typeof AnnouncementInsertSchema>
export type UpdateAnnouncementInput = z.infer<typeof AnnouncementUpdateSchema>

// ── List options ──────────────────────────────────────────────────────

export interface ListAnnouncementsOptions {
  schoolId?: string
  audience?: string
  targetClassId?: string
  priority?: string
  isPublished?: boolean
  isPinned?: boolean
  postedBy?: string
  active?: boolean // filters out expired announcements
  limit?: number
  offset?: number
}

// ── Pagination result ─────────────────────────────────────────────────

export interface PaginatedAnnouncements {
  data: AnnouncementRow[]
  count: number
  hasMore: boolean
}

// ── Constants ─────────────────────────────────────────────────────────

const SAFE_COLS = [
  "id",
  "audience",
  "body",
  "created_at",
  "expires_at",
  "is_pinned",
  "is_published",
  "posted_by",
  "priority",
  "published_at",
  "school_id",
  "target_class_id",
  "title",
  "updated_at",
].join(", ")

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
const DEFAULT_OFFSET = 0

// ── Repository ────────────────────────────────────────────────────────

export class AnnouncementsRepository {
  constructor(private db: SupabaseClient<Database>) {}

  // ── Error handling ────────────────────────────────────────────────

  private handleDbError(error: PostgrestError, operation: string): never {
    logger.error("announcements", `PostgREST error during ${operation}`, {
      code: error.code,
      hint: error.hint,
      details: error.details,
    })

    switch (error.code) {
      case "23505":
        throw new ConflictError("Announcement", "title and school")
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
          "You do not have permission to access this resource"
        )
      default:
        throw new DatabaseError(operation, error)
    }
  }

  // ── Query helpers ─────────────────────────────────────────────────

  private safeSelect(cols?: string) {
    return this.db.from("announcements").select(cols ?? SAFE_COLS)
  }

  private now(): string {
    return new Date().toISOString()
  }

  // ── Read ──────────────────────────────────────────────────────────

  async getById(id: string): Promise<AnnouncementRow | null> {
    logger.info("announcements", "getById", { id })

    const { data, error } = await this.safeSelect().eq("id", id).single()

    if (error?.code === "PGRST116") return null
    if (error) this.handleDbError(error, "getById")
    if (!data) return null
    return data as unknown as AnnouncementRow
  }

  async list(
    options: ListAnnouncementsOptions = {}
  ): Promise<PaginatedAnnouncements> {
    const {
      schoolId,
      audience,
      targetClassId,
      priority,
      isPublished,
      isPinned,
      postedBy,
      active,
      limit = DEFAULT_LIMIT,
      offset = DEFAULT_OFFSET,
    } = options

    const safeLimit = Math.min(limit, MAX_LIMIT)

    logger.info("announcements", "list", {
      schoolId,
      audience,
      priority,
      isPublished,
      isPinned,
      limit: safeLimit,
      offset,
    })

    let q = this.db.from("announcements").select(SAFE_COLS, { count: "exact" })

    if (schoolId) q = q.eq("school_id", schoolId)
    if (audience) q = q.eq("audience", audience)
    if (targetClassId) q = q.eq("target_class_id", targetClassId)
    if (priority) q = q.eq("priority", priority)
    if (postedBy) q = q.eq("posted_by", postedBy)
    if (isPublished !== undefined) q = q.eq("is_published", isPublished)
    if (isPinned !== undefined) q = q.eq("is_pinned", isPinned)

    // Active = not expired
    if (active) {
      q = q.or(`expires_at.is.null,expires_at.gt.${this.now()}`)
    }

    const { data, count, error } = await q
      .range(offset, offset + safeLimit - 1)
      .order("is_pinned", { ascending: false }) // pinned first
      .order("published_at", { ascending: false }) // then newest

    if (error) this.handleDbError(error, "list")

    return {
      data: (data ?? []) as unknown as AnnouncementRow[],
      count: count ?? 0,
      hasMore: (count ?? 0) > offset + safeLimit,
    }
  }

  // Fetches active announcements visible to a specific audience
  async getActiveForAudience(
    schoolId: string,
    audience: "students" | "teachers" | "parents",
    classId?: string
  ): Promise<AnnouncementRow[]> {
    logger.info("announcements", "getActiveForAudience", { schoolId, audience })

    // Build audience filter — show 'all' + specific audience + specific class if provided
    let audienceFilter = `audience.eq.all,audience.eq.${audience}`
    if (classId) {
      audienceFilter += `,and(audience.eq.specific_class,target_class_id.eq.${classId})`
    }

    const { data, error } = await this.safeSelect()
      .eq("school_id", schoolId)
      .eq("is_published", true)
      .or(`expires_at.is.null,expires_at.gt.${this.now()}`)
      .or(audienceFilter)
      .order("is_pinned", { ascending: false })
      .order("published_at", { ascending: false })

    if (error) this.handleDbError(error, "getActiveForAudience")
    return (data ?? []) as unknown as AnnouncementRow[]
  }

  // Fetches urgent and high priority active announcements
  async getUrgent(schoolId: string): Promise<AnnouncementRow[]> {
    logger.info("announcements", "getUrgent", { schoolId })

    const { data, error } = await this.safeSelect()
      .eq("school_id", schoolId)
      .eq("is_published", true)
      .in("priority", ["urgent", "high"])
      .or(`expires_at.is.null,expires_at.gt.${this.now()}`)
      .order("priority", { ascending: false })
      .order("published_at", { ascending: false })

    if (error) this.handleDbError(error, "getUrgent")
    return (data ?? []) as unknown as AnnouncementRow[]
  }

  // Fetches pinned announcements for a school
  async getPinned(schoolId: string): Promise<AnnouncementRow[]> {
    logger.info("announcements", "getPinned", { schoolId })

    const { data, error } = await this.safeSelect()
      .eq("school_id", schoolId)
      .eq("is_published", true)
      .eq("is_pinned", true)
      .or(`expires_at.is.null,expires_at.gt.${this.now()}`)
      .order("published_at", { ascending: false })

    if (error) this.handleDbError(error, "getPinned")
    return (data ?? []) as unknown as AnnouncementRow[]
  }

  // ── Write ─────────────────────────────────────────────────────────

  async create(input: unknown): Promise<AnnouncementRow> {
    const parsed = AnnouncementInsertSchema.safeParse(input)
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues
          .map((e: z.ZodIssue) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")
      )
    }

    logger.info("announcements", "create", {
      title: parsed.data.title,
      audience: parsed.data.audience,
      priority: parsed.data.priority,
    })

    const { data, error } = await this.db
      .from("announcements")
      .insert(parsed.data as unknown as AnnouncementInsert)
      .select(SAFE_COLS)
      .single()

    if (error) this.handleDbError(error, "create")
    if (!data) throw new DatabaseError("create — no data returned")
    return data as unknown as AnnouncementRow
  }

  async update(id: string, input: unknown): Promise<AnnouncementRow> {
    const parsed = AnnouncementUpdateSchema.safeParse(input)
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues
          .map((e: z.ZodIssue) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")
      )
    }

    logger.info("announcements", "update", { id })

    const { data, error } = await this.db
      .from("announcements")
      .update(parsed.data as unknown as AnnouncementUpdate)
      .eq("id", id)
      .select(SAFE_COLS)
      .single()

    if (error?.code === "PGRST116") throw new NotFoundError("Announcement", id)
    if (error) this.handleDbError(error, "update")
    if (!data) throw new NotFoundError("Announcement", id)
    return data as unknown as AnnouncementRow
  }

  async delete(id: string): Promise<void> {
    logger.info("announcements", "delete", { id })

    const exists = await this.getById(id)
    if (!exists) throw new NotFoundError("Announcement", id)

    const { error } = await this.db.from("announcements").delete().eq("id", id)

    if (error) this.handleDbError(error, "delete")
  }

  // ── Publishing ────────────────────────────────────────────────────

  async publish(id: string, postedBy: string): Promise<AnnouncementRow> {
    logger.info("announcements", "publish", { id, postedBy })
    return this.update(id, {
      is_published: true,
      published_at: this.now(),
      posted_by: postedBy,
    })
  }

  async unpublish(id: string): Promise<AnnouncementRow> {
    logger.info("announcements", "unpublish", { id })
    return this.update(id, {
      is_published: false,
      published_at: null,
    })
  }

  // ── Pinning ───────────────────────────────────────────────────────

  async pin(id: string): Promise<AnnouncementRow> {
    logger.info("announcements", "pin", { id })
    return this.update(id, { is_pinned: true })
  }

  async unpin(id: string): Promise<AnnouncementRow> {
    logger.info("announcements", "unpin", { id })
    return this.update(id, { is_pinned: false })
  }

  // ── Priority ──────────────────────────────────────────────────────

  async setPriority(
    id: string,
    priority: "low" | "normal" | "high" | "urgent"
  ): Promise<AnnouncementRow> {
    logger.info("announcements", "setPriority", { id, priority })
    return this.update(id, { priority })
  }

  // ── Expiry ────────────────────────────────────────────────────────

  async setExpiry(id: string, expiresAt: string): Promise<AnnouncementRow> {
    logger.info("announcements", "setExpiry", { id, expiresAt })
    return this.update(id, { expires_at: expiresAt })
  }

  async clearExpiry(id: string): Promise<AnnouncementRow> {
    logger.info("announcements", "clearExpiry", { id })
    return this.update(id, { expires_at: null })
  }

  // Removes all expired announcements for a school — run as a scheduled job
  async purgeExpired(schoolId: string): Promise<void> {
    logger.info("announcements", "purgeExpired", { schoolId })

    const { error } = await this.db
      .from("announcements")
      .delete()
      .eq("school_id", schoolId)
      .lt("expires_at", this.now())
      .not("expires_at", "is", null)

    if (error) this.handleDbError(error, "purgeExpired")
  }
}
