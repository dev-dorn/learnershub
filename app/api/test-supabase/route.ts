// app/api/test-supabase/route.ts
import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY! // or ANON_KEY for testing
  )

  // Simple health check - no auth, no RLS
  const { data, error } = await supabase
    .from("teachers") // or any table you have
    .select("id")
    .limit(1)

  if (error) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true, data })
}
