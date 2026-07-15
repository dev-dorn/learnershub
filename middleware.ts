// src/middleware.ts
import { NextResponse, type NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"

// ── Public routes (no session required) ──────────────────────────────

const PUBLIC_PATHS = [
  "/login",
  "/first-login",
  "/parent-register",
  "/forgot-password",
  "/auth/callback",
]
const SUPERADMIN_PATHS = ['/platform']
const SCHOOL_PATHS = ['/dashboard']

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/platform/:path*",
    "/login",
    "/first-login",
    "/parent-register",
    "/forgot-password",
    "/auth/:path*",
  ],
}

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request })

  // ── 1. Create Supabase client ─────────────────────────────────────
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  // ── 2. Refresh session ────────────────────────────────────────────
  let user
  try {
    const { data } = await supabase.auth.getUser()
    user = data?.user
  } catch {
    // Supabase down or network error — fail closed for protected routes
    const pathname = request.nextUrl.pathname
    if (!PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
      const loginUrl = new URL("/login", request.url)
      loginUrl.searchParams.set("error", "service_unavailable")
      return NextResponse.redirect(loginUrl)
    }
    return response
  }

  const pathname = request.nextUrl.pathname

  // ── 3. No user — redirect to login unless public ──────────────────
  if (!user) {
    if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
      return response
    }
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("redirectTo", pathname)
    return NextResponse.redirect(loginUrl)
  }

  // ── 4. Fetch trusted profile from DB ─────────────────────────────
  // NEVER trust user_metadata for role or school_id
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, school_id, account_status, require_password_change, is_superadmin")
    .eq("id", user.id)
    .single()

  if (profileError || !profile) {
    // Profile missing — force logout
    const logoutUrl = new URL("/login", request.url)
    logoutUrl.searchParams.set("error", "profile_not_found")
    response.cookies.delete("sb-access-token")
    response.cookies.delete("sb-refresh-token")
    return NextResponse.redirect(logoutUrl)
  }

  // ── 5. Enforce account status ─────────────────────────────────────
  if (profile.account_status !== "active") {
    const logoutUrl = new URL("/login", request.url)
    logoutUrl.searchParams.set("error", `account_${profile.account_status}`)
    return NextResponse.redirect(logoutUrl)
  }
  if (pathname.startsWith('/platform')) {
    if (!profile.is_superadmin){
      return NextResponse.redirect(pathname)
    }
  }

  // ── 6. Force password change on first login ───────────────────────
  const mustChangePassword = profile.require_password_change ?? false

  if (mustChangePassword && pathname !== "/first-login") {
    return NextResponse.redirect(new URL("/first-login", request.url))
  }

  if (!mustChangePassword && pathname === "/first-login") {
    return NextResponse.redirect(
      new URL(`/dashboard/${profile.role}`, request.url)
    )
  }

  // ── 7. Redirect logged-in users away from auth pages ─────────────
  if (["/login", "/parent-register", "/forgot-password"].includes(pathname)) {
    return NextResponse.redirect(
      new URL(`/dashboard/${profile.role}`, request.url)
    )
  }

  // ── 8. Role-based dashboard routing ──────────────────────────────
  if (pathname.startsWith("/dashboard")) {
    const segments = pathname.split("/").filter(Boolean)
    const routeRole = segments[1] // /dashboard/{role}/...

    const validRoles = ["admin", "principal", "teacher", "student", "parent"]

    if (!routeRole || !validRoles.includes(routeRole)) {
      return NextResponse.redirect(
        new URL(`/dashboard/${profile.role}`, request.url)
      )
    }

    const allowedAccess: Record<string, string[]> = {
      admin: ["admin", "principal"],
      principal: ["admin", "principal"],
      teacher: ["teacher"],
      student: ["student"],
      parent: ["parent"],
    }

    if (!allowedAccess[profile.role]?.includes(routeRole)) {
      return NextResponse.redirect(
        new URL(`/dashboard/${profile.role}`, request.url)
      )
    }
  }

  // ── 9. Inject trusted headers for Server Components ───────────────
  // Convenience only — Server Actions must always re-verify from DB
  response.headers.set("x-user-id", user.id)
  response.headers.set("x-user-role", profile.role)
  response.headers.set("x-school-id", profile.school_id ?? "")

  return response
}
