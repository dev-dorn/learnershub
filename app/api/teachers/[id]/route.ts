// app/api/teachers/[id]/route.ts
import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"  // ← Standard client
import { Database } from "@/types/supabase"

import { TeachersService, TeacherContext } from "@/services/teachers.service"
import { TeachersRepository } from "@/dal /teachers.repository"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // ✅ Use standard client - no cookies adapter needed
  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  try {
    // Get user from Authorization header (Bearer token)
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const repo = new TeachersRepository(supabase)
    const service = new TeachersService(repo)

    const context: TeacherContext = {
      userId: user.id,
      schoolId: user.app_metadata?.school_id,
      role: user.app_metadata?.role || "teacher",
    }

    if (!context.schoolId) {
      return NextResponse.json({ error: "No school context found" }, { status: 403 })
    }

    const teacher = await service.getById(id, context)
    if (!teacher) {
      return NextResponse.json({ error: "Teacher not found" }, { status: 404 })
    }

    return NextResponse.json(teacher, { status: 200 })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unexpected error"
    console.error("Route handler error:", error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}