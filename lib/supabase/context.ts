// src/lib/supabase/context.ts
import { SupabaseClient } from '@supabase/supabase-js'
import { Database } from '@/types/supabase'
import { logger } from '@/lib/logger'
import { DALError } from "@/dal /errors"

// ── Types ─────────────────────────────────────────────────────────────

export type UserRole =
  | 'admin'
  | 'principal'
  | 'teacher'
  | 'student'
  | 'parent'

export interface SchoolContext {
  userId:   string
  schoolId: string
  role:     UserRole
}

export interface FullContext extends SchoolContext {
  email:         string
  fullName:      string
  accountStatus: string
  mfaEnabled:    boolean
}

// ── Core function ─────────────────────────────────────────────────────

export async function getSchoolContext(
  supabase: SupabaseClient<Database>
): Promise<SchoolContext> {

  // ── Step 1: Verify session ──────────────────────────────────────
  // getUser() makes a network call to verify the JWT with Supabase Auth
  // Never use getSession() for authorization — it reads from cookie only
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    logger.warn('context', 'unauthenticated request', {
      error: authError?.message,
    })
    throw new DALError('UNAUTHORIZED', 'Not authenticated')
  }

  // ── Step 2: Fetch profile from DB ─────────────────────────────
  // Role and school_id always come from the DB — never from user_metadata
  // user_metadata is client-writable and must never be trusted
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('school_id, role, account_status')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    logger.warn('context', 'profile not found', { userId: user.id })
    throw new DALError('UNAUTHORIZED', 'Profile not found')
  }

  // ── Step 3: Check account status ─────────────────────────────
  if (profile.account_status !== 'active') {
    logger.warn('context', 'inactive account attempted access', {
      userId: user.id,
      status: profile.account_status,
    })
    throw new DALError(
      'UNAUTHORIZED',
      `Account is ${profile.account_status} — contact your administrator`
    )
  }

  return {
    userId:   user.id,
    schoolId: profile.school_id,
    role:     profile.role as UserRole,
  }
}

// ── Extended context — use when you need more than just the basics ────

export async function getFullContext(
  supabase: SupabaseClient<Database>
): Promise<FullContext> {
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    throw new DALError('UNAUTHORIZED', 'Not authenticated')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('school_id, role, account_status, full_name, mfa_enabled')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    throw new DALError('UNAUTHORIZED', 'Profile not found')
  }

  if (profile.account_status !== 'active') {
    throw new DALError(
      'UNAUTHORIZED',
      `Account is ${profile.account_status}`
    )
  }

  return {
    userId:        user.id,
    schoolId:      profile.school_id,
    role:          profile.role as UserRole,
    email:         user.email ?? '',
    fullName:      profile.full_name,
    accountStatus: profile.account_status,
    mfaEnabled:    profile.mfa_enabled ?? false,
  }
}

// ── Role-specific helpers ─────────────────────────────────────────────

// Use when you need to verify the caller is a specific role
// before doing anything else in a Server Action
export async function requireAdmin(
  supabase: SupabaseClient<Database>
): Promise<SchoolContext> {
  const context = await getSchoolContext(supabase)
  if (!['admin', 'principal'].includes(context.role)) {
    throw new DALError('UNAUTHORIZED', 'Only admins and principals can perform this action')
  }
  return context
}

export async function requireTeacher(
  supabase: SupabaseClient<Database>
): Promise<SchoolContext> {
  const context = await getSchoolContext(supabase)
  if (!['admin', 'principal', 'teacher'].includes(context.role)) {
    throw new DALError('UNAUTHORIZED', 'Only teachers and admins can perform this action')
  }
  return context
}

// ── Student context — returns both school context and student record id
export async function getStudentContext(
  supabase: SupabaseClient<Database>
): Promise<SchoolContext & { studentId: string }> {
  const context = await getSchoolContext(supabase)

  if (context.role !== 'student') {
    throw new DALError('UNAUTHORIZED', 'Only students can access this resource')
  }

  const { data: student, error } = await supabase
    .from('students')
    .select('id')
    .eq('user_id', context.userId)
    .eq('school_id', context.schoolId)
    .single()

  if (error || !student) {
    throw new DALError('NOT_FOUND', 'Student record not found')
  }

  return { ...context, studentId: student.id }
}

// ── Parent context — returns school context and linked student ids
export async function getParentContext(
  supabase: SupabaseClient<Database>
): Promise<SchoolContext & { studentIds: string[] }> {
  const context = await getSchoolContext(supabase)

  if (context.role !== 'parent') {
    throw new DALError('UNAUTHORIZED', 'Only parents can access this resource')
  }

  // Fetch all students linked to this parent
  const { data: links, error } = await supabase
    .from('parent_student')
    .select('student_id')
    .eq('parent_id', context.userId)
    .eq('school_id', context.schoolId)

  if (error) {
    throw new DALError('DATABASE_ERROR', 'Failed to fetch parent-student links')
  }

  return {
    ...context,
    studentIds: (links ?? []).map(l => l.student_id),
  }
}