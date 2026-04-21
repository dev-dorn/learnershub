import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { z } from 'zod'
import { Json } from '@/types/supabase'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
export const JsonSchema: z.ZodType<Json> = z.lazy(() =>
z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(JsonSchema),
  z.record(z.string(), JsonSchema),
])
)