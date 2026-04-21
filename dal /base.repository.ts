// src/dal/base.repository.ts
import { SupabaseClient, PostgrestError } from "@supabase/supabase-js"
import { Database } from "@/types/supabase"
import { logger } from "@/lib/logger"
import { ConflictError, DALError, DatabaseError } from "./errors"

export type TableName = keyof Database["public"]["Tables"]
export type TableRow<T extends TableName> =
  Database["public"]["Tables"][T]["Row"]
export type TableInsert<T extends TableName> =
  Database["public"]["Tables"][T]["Insert"]
export type TableUpdate<T extends TableName> =
  Database["public"]["Tables"][T]["Update"]

const POSTGRES_CODES = {
  UNIQUE_VIOLATION: "23505",
  NOT_NULL_VIOLATION: "23502",
  FOREIGN_KEY: "23503",
  CHECK_VIOLATION: "23514",
} as const

export abstract class BaseRepository<T extends TableName> {
  protected readonly db: SupabaseClient<Database>
  protected readonly table: T
  protected readonly safeColumns: string
  protected readonly primaryKey: string

  constructor(
    db: SupabaseClient<Database>,
    table: T,
    safeColumns: string,
    primaryKey = "id"
  ) {
    this.db = db
    this.table = table
    this.safeColumns = safeColumns
    this.primaryKey = primaryKey
  }

  // ── Error handling ────────────────────────────────────────────────

  protected handleDbError(error: PostgrestError, operation: string): never {
    logger.error(this.table as string, `PostgREST error during ${operation}`, {
      code: error.code,
      hint: error.hint,
      details: error.details,
    })

    switch (error.code) {
      case POSTGRES_CODES.UNIQUE_VIOLATION:
        throw new ConflictError(this.table as string, error.details ?? "field")
      case POSTGRES_CODES.FOREIGN_KEY:
        throw new DALError(
          "FOREIGN_KEY_ERROR",
          `Related record not found: ${operation}`
        )
      case POSTGRES_CODES.NOT_NULL_VIOLATION:
        throw new DALError(
          "VALIDATION_ERROR",
          `Required field missing: ${error.details}`
        )
      case POSTGRES_CODES.CHECK_VIOLATION:
        throw new DALError(
          "VALIDATION_ERROR",
          `Value out of allowed range: ${error.details}`
        )
      default:
        throw new DatabaseError(operation, error)
    }
  }

  // ── Query helpers ─────────────────────────────────────────────────

  protected safeSelect(cols?: string) {
    return this.db.from(this.table).select(cols ?? this.safeColumns)
  }

  protected async findById(id: string): Promise<TableRow<T> | null> {
    const { data, error } = await this.safeSelect()
      .eq(this.primaryKey as never, id)
      .single()

    if (error?.code === "PGRST116") return null
    if (error) this.handleDbError(error, "findById")

    return data as unknown as TableRow<T> // ← unknown bridge
  }

  protected async findAll(limit = 100, offset = 0): Promise<TableRow<T>[]> {
    const { data, error } = await this.safeSelect()
      .range(offset, offset + limit - 1)
      .order("created_at" as never, { ascending: false })

    if (error) this.handleDbError(error, "findAll")

    return (data ?? []) as unknown as TableRow<T>[] // ← unknown bridge
  }

  protected async deleteById(id: string): Promise<void> {
    const { error } = await this.db
      .from(this.table)
      .delete()
      .eq(this.primaryKey as never, id)

    if (error) this.handleDbError(error, "deleteById")
  }

  // ── Audit helper ──────────────────────────────────────────────────

  protected log(
    level: "info" | "warn" | "error",
    operation: string,
    meta?: Record<string, unknown>
  ) {
    logger[level](this.table as string, operation, meta)
  }
}
