import { cookies } from "next/headers"
import type { Database } from "@/types/supabase"
import {
  CookieMethodsServer,
  createServerClient,
  createServerClient as createSSRClient,
  parseCookieHeader,
  serializeCookieHeader,
} from "@supabase/ssr"

export async function createServerSupabaseClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          // Explicitly return the correct type with required value
          const allCookies = cookieStore.getAll()
          return allCookies
            .filter(
              (cookie): cookie is { name: string; value: string } =>
                cookie.value !== undefined
            )
            .map(({ name, value }) => ({ name, value }))
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options)
          })
        },
      },
    }
  )
}

export function createMiddlewareClient(request: Request, response: Response) {
  return createSSRClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return parseCookieHeader(request.headers.get("Cookie") ?? "").map(
            ({ name, value }) => ({
              name,
              value: value ?? "", // ⬅️ ensure string, never undefined
            })
          )
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.headers.append(
              "Set-Cookie",
              serializeCookieHeader(name, value, options)
            )
          })
        },
      } satisfies CookieMethodsServer, // 👈 optional but helps catch mismatches
    }
  )
}