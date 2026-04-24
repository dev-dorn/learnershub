import { createClient } from "@supabase/supabase-js"
import { TeachersRepository } from "@/dal /teachers.repository"
import { TeachersService } from "@/services/teachers.service"
import { NextResponse } from "next/server"
import { ConflictError, NotFoundError, ValidationError } from "@/dal /errors"

function  getMockContext(){
  return {
    schoolId: "SCHOOl1",
    userId: "00000000-0000-0000-0000-000000000000",
    role: "admin",
  }
}
function createService() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  console.log("🔑 Service Role Key loaded:", !!key) // Should log "true"
  console.log("🔗 URL:", url?.slice(0, 30))

  if (!url || !key) {
    throw new Error("Missing Supabase env vars in Route Handler")
  }

  const supabase = createClient(url, key)
  const repo = new TeachersRepository(supabase)
  return new TeachersService(repo)
}

export async function POST(req: Request){
  try {
    const body = await req.json()

    const service = createService()
    const context = getMockContext()

    const result = await service.create(body, context)

    return NextResponse.json(result, {status: 201})

  }catch (error: unknown) {
    console.error("POST /teachers:", error)

    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    if (error instanceof ConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }

    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(
      { error: "Unknown error" },
      { status: 500 }
    )


  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)

    const service = createService()
    const context = getMockContext()

    const result = await service.list(
      {
        department: searchParams.get("department") || undefined,
        employmentStatus: searchParams.get("employmentStatus") || undefined,
        isClassTeacher: searchParams.get("isClassTeacher")
          ? searchParams.get("isClassTeacher") === "true"
          : undefined,
        hrVerified: searchParams.get("hrVerified")
          ? searchParams.get("hrVerified") === "true"
          : undefined,
        limit: searchParams.get("limit")
          ? Number(searchParams.get("limit"))
          : 20,
        offset: searchParams.get("offset")
          ? Number(searchParams.get("offset"))
          : 0,
      },
      context
    )

    return NextResponse.json(result, { status: 200 })
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unexpected error"

    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}