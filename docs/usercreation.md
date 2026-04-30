# LearnerHub — Authentication & User Creation Architecture

> **Audience:** Senior engineering team building a production-grade multi-tenant SaaS platform  
> **Stack:** Next.js App Router · TypeScript · Supabase Auth · Supabase Postgres · Server Actions · RLS

---

## Table of Contents

1. [High-Level Architecture](#1-high-level-architecture)
2. [Database and Auth Separation Strategy](#2-database-and-auth-separation-strategy)
3. [Role and Permission Model](#3-role-and-permission-model)
4. [User Creation Flows by Role](#4-user-creation-flows-by-role)
5. [Parent Invitation Flow](#5-parent-invitation-flow)
6. [Server Action Architecture](#6-server-action-architecture)
7. [RLS Architecture](#7-rls-architecture)
8. [Security Hardening Checklist](#8-security-hardening-checklist)
9. [Scalability Considerations](#9-scalability-considerations)
10. [Recommended Folder Structure](#10-recommended-folder-structure)
11. [TypeScript Patterns](#11-typescript-patterns)
12. [Pseudo-code for Critical Flows](#12-pseudo-code-for-critical-flows)
13. [Common Mistakes to Avoid](#13-common-mistakes-to-avoid)
14. [Final Architecture Summary](#14-final-architecture-summary)

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                             │
│  Browser / Mobile  →  Next.js App Router (React Server + Client)│
└──────────────────────────────┬──────────────────────────────────┘
                               │  HTTPS only
┌──────────────────────────────▼──────────────────────────────────┐
│                      NEXT.JS MIDDLEWARE                         │
│  • Session validation (anon key)                                │
│  • Route protection by role                                     │
│  • Rate limiting (per IP + per user)                            │
│  • CSRF protection                                              │
└──────────────────────────────┬──────────────────────────────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         │                     │                     │
┌────────▼────────┐  ┌─────────▼────────┐  ┌────────▼────────┐
│  SERVER ACTIONS │  │   API ROUTES     │  │  SERVER COMPS   │
│  (privileged)   │  │  (webhooks/pub)  │  │  (data fetch)   │
│  service_role   │  │  anon/auth key   │  │  auth key       │
└────────┬────────┘  └──────────────────┘  └─────────────────┘
         │
┌────────▼────────────────────────────────────────────────────────┐
│                      DATA ACCESS LAYER                          │
│  BaseRepository → domain repositories → error handling         │
└────────┬────────────────────────────────────────────────────────┘
         │
┌────────▼────────┐         ┌──────────────────────────────────┐
│  Supabase Auth  │         │       Supabase Postgres          │
│  auth.users     │◄───────►│  profiles · students · teachers  │
│  sessions       │         │  parents · audit_logs · invites  │
│  magic links    │         │  RLS policies on every table     │
└─────────────────┘         └──────────────────────────────────┘
```

### Supabase Client Usage

| Client | Key Used | Where Used | Can Bypass RLS |
|---|---|---|---|
| `createBrowserClient()` | anon key | Client components, login forms | No |
| `createServerClient()` | anon key + session cookie | Server components, middleware | No (respects RLS) |
| `createAdminClient()` | service_role key | Server Actions only — auth.admin ops | Yes — use sparingly |

> **Rule:** `createAdminClient()` is only ever used for `auth.admin.*` operations. All data queries use the authenticated session client, letting RLS enforce access.

---

## 2. Database and Auth Separation Strategy

### Why separate auth.users from profiles

Supabase Auth manages `auth.users` — you do not own this table. It contains credentials, sessions, and MFA state. Your application data lives in `public.profiles` which you fully control.

```
auth.users (Supabase-owned)          public.profiles (you own)
─────────────────────────            ─────────────────────────
id (uuid)              ──────────►  id (uuid, FK → auth.users.id)
email                               full_name
encrypted_password                  role
email_confirmed_at                  school_id (tenant)
user_metadata (jsonb)               account_status
created_at                          verification_status
                                    failed_login_attempts
                                    mfa_enabled
                                    ...security fields
```

### Separation rules

- Never store PII in `user_metadata` beyond what is needed for the invitation flow
- Never store passwords, tokens, or credentials in `public.*` tables
- `public.profiles.id` is always equal to `auth.users.id` — this is the join key
- Role is stored in `public.profiles.role`, not in `user_metadata` — `user_metadata` is client-writable and must never be trusted for authorization

### Transactional consistency

Supabase does not provide cross-service transactions between `auth.users` and `public.*`. Use the rollback pattern:

```
1. Create auth.users record         → if fails, stop
2. Create public.profiles record    → if fails, delete auth.users record
3. Create domain record (student)   → if fails, delete auth.users + profile
```

For production, move this logic into a Postgres function called via RPC with `security definer` to get atomicity at the DB level.

---

## 3. Role and Permission Model

### Roles

```
admin      → full school management, creates teachers and students
principal  → same as admin but cannot create other admins
teacher    → manages classes, attendance, results, activities
student    → read-only access to own data
parent     → read-only access to linked student's data
```

### Permission matrix

| Resource | admin | principal | teacher | student | parent |
|---|---|---|---|---|---|
| Create users | ✅ | ✅ | ❌ | ❌ | ❌ |
| Manage classes | ✅ | ✅ | own only | ❌ | ❌ |
| Record attendance | ✅ | ✅ | own class | ❌ | ❌ |
| Post results | ✅ | ✅ | own subject | ❌ | ❌ |
| View results | ✅ | ✅ | own class | own only | linked student |
| View report cards | ✅ | ✅ | own class | own only | linked student |
| Publish announcements | ✅ | ✅ | ❌ | ❌ | ❌ |
| View announcements | ✅ | ✅ | ✅ | ✅ | ✅ |

### RBAC enforcement layers (defense in depth)

```
Layer 1: Middleware      → blocks unauthenticated routes
Layer 2: Server Action   → requireRole() guard before any logic
Layer 3: DAL             → school_id always injected from session
Layer 4: RLS             → DB-level enforcement, last line of defense
```

All four layers must pass. A bypass at layer 2 is still caught by layer 4.

### Preventing privilege escalation

- `role` is never accepted from client input — always read from `public.profiles` via authenticated session
- `school_id` is never accepted from client input — always from session
- `user_metadata` is never used for authorization decisions
- Role changes go through `assignRole()` which is a dedicated, audited function
- Admins can only manage users within their own `school_id`

---

## 4. User Creation Flows by Role

### Admin creates Teacher

```
Admin submits form
        │
        ▼
Server Action: createTeacherAction()
        │
        ├─ 1. getSchoolContext()         → schoolId, userId, role from session
        ├─ 2. requireRole(['admin','principal'])
        ├─ 3. validateInput(TeacherSchema)
        ├─ 4. adminClient.auth.admin.createUser()
        │         email_confirm: true
        │         temporaryPassword: generated
        │
        ├─ 5. profilesRepo.create()      → id = auth.users.id
        ├─ 6. teachersRepo.create()      → user_id = auth.users.id
        │
        ├─ 7. auditLog('teacher_created', { by: userId, teacherId })
        ├─ 8. sendWelcomeEmail(email, temporaryPassword)
        │
        └─ on any step 5-8 failure → adminClient.auth.admin.deleteUser()
```

### Admin creates Student

```
Admin submits form
        │
        ▼
Server Action: createStudentAction()
        │
        ├─ 1. getSchoolContext()
        ├─ 2. requireRole(['admin','principal'])
        ├─ 3. validateInput(StudentSchema)
        ├─ 4. check admission_number uniqueness within school
        │
        ├─ 5. adminClient.auth.admin.createUser()
        ├─ 6. profilesRepo.create()
        ├─ 7. studentsRepo.create()
        │
        ├─ 8. auditLog('student_created', { by: userId, studentId })
        └─ 9. sendCredentialsEmail()
```

### Password generation

```ts
// Never send plain passwords — generate a secure temporary one
import { randomBytes } from 'crypto'

export function generateTemporaryPassword(): string {
  // 16 chars: uppercase + lowercase + digits + symbols
  return randomBytes(16).toString('base64url').slice(0, 16)
}
```

Users are forced to change password on first login via a `require_password_change` flag in `profiles`.

---

## 5. Parent Invitation Flow

### Flow diagram

```
Admin sends invite
        │
        ▼
Server Action: inviteParentAction(email, studentId)
        │
        ├─ 1. getSchoolContext()
        ├─ 2. requireRole(['admin','principal'])
        ├─ 3. Check student exists in same school
        ├─ 4. Check no existing active invite for this email+student
        │
        ├─ 5. Generate signed invitation token (JWT, 72hr expiry)
        ├─ 6. Store in invitations table:
        │       { token_hash, email, student_id, school_id,
        │         expires_at, status: 'pending' }
        │
        ├─ 7. Send invitation email with link:
        │       /auth/parent-register?token=<signed_token>
        │
        └─ 8. auditLog('parent_invited', { studentId, by: userId })

Parent clicks link
        │
        ▼
Page: /auth/parent-register?token=...
        │
Server Action: completeParentRegistrationAction(token, password, fullName)
        │
        ├─ 1. Verify token signature (HMAC-SHA256)
        ├─ 2. Look up invitation by token_hash
        ├─ 3. Check status = 'pending' and expires_at > now()
        ├─ 4. Check email matches token payload (prevents token swapping)
        │
        ├─ 5. adminClient.auth.admin.createUser()
        │       email_confirm: true  (already verified via invite)
        │       password: parent-chosen
        │
        ├─ 6. profilesRepo.create()  role = 'parent'
        ├─ 7. studentParentLinksRepo.create()
        ├─ 8. Mark invitation status = 'accepted'
        │
        └─ 9. auditLog('parent_registered', { studentId, parentId })
```

### Invitations table

```sql
create table invitations (
  id           uuid primary key default gen_random_uuid(),
  token_hash   text not null unique,        -- SHA-256 of the signed token
  email        text not null,
  student_id   uuid not null references students(id),
  school_id    uuid not null references schools(id),
  invited_by   uuid not null references profiles(id),
  status       text not null default 'pending',  -- pending, accepted, expired, revoked
  expires_at   timestamptz not null,
  accepted_at  timestamptz,
  created_at   timestamptz default now(),

  constraint valid_status check (status in ('pending','accepted','expired','revoked'))
);

create index idx_invitations_token_hash on invitations(token_hash);
create index idx_invitations_email      on invitations(email);
create index idx_invitations_student    on invitations(student_id);
```

### Idempotency

Before creating a new invitation:

```ts
// Check for an existing pending invite for the same email + student
const existing = await db
  .from('invitations')
  .select('id, expires_at, status')
  .eq('email', email)
  .eq('student_id', studentId)
  .eq('status', 'pending')
  .gt('expires_at', new Date().toISOString())
  .single()

if (existing) {
  // Resend the same invite rather than creating a duplicate
  await resendInvitationEmail(existing.id)
  return { success: true, reused: true }
}
```

---

## 6. Server Action Architecture

### Boundaries

```
Client Component
    │  calls
    ▼
'use server' action          ← trust boundary
    │
    ├─ 1. Auth check         getSchoolContext() — who is calling
    ├─ 2. Role check         requireRole() — are they allowed
    ├─ 3. Input validation   Zod schema — is the input safe
    ├─ 4. Business logic     domain-specific checks
    ├─ 5. DAL operations     repositories — never raw DB calls
    ├─ 6. Audit log          record what happened
    └─ 7. Return safe DTO    never return raw DB rows to client
```

### Never trust the client — what this means in practice

```ts
// ❌ WRONG — trusting client-provided school_id
export async function createStudentAction(input: { school_id: string, ... }) {
  await studentsRepo.create({ school_id: input.school_id, ... })
}

// ✅ CORRECT — school_id always from session
export async function createStudentAction(input: CreateStudentInput) {
  const { schoolId, userId, role } = await getSchoolContext(supabase)
  await studentsRepo.create({ ...input, school_id: schoolId })
}
```

### getSchoolContext

```ts
// src/lib/supabase/context.ts
export async function getSchoolContext(
  supabase: SupabaseClient
): Promise<SchoolContext> {
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    throw new DALError('UNAUTHORIZED', 'Not authenticated')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('school_id, role, account_status')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    throw new DALError('UNAUTHORIZED', 'Profile not found')
  }

  if (profile.account_status !== 'active') {
    throw new DALError('UNAUTHORIZED', `Account is ${profile.account_status}`)
  }

  return {
    userId:   user.id,
    schoolId: profile.school_id,
    role:     profile.role,
  }
}
```

### Rate limiting Server Actions

```ts
// src/lib/rate-limit.ts
import { headers } from 'next/headers'

const store = new Map<string, { count: number; reset: number }>()

export function rateLimit(key: string, limit: number, windowMs: number): void {
  const now    = Date.now()
  const record = store.get(key)

  if (!record || now > record.reset) {
    store.set(key, { count: 1, reset: now + windowMs })
    return
  }

  if (record.count >= limit) {
    throw new DALError('RATE_LIMITED', 'Too many requests — try again later')
  }

  record.count++
}

// Usage in Server Action
export async function inviteParentAction(input: InviteParentInput) {
  const headersList = headers()
  const ip = headersList.get('x-forwarded-for') ?? 'unknown'
  rateLimit(`invite:${ip}`, 10, 60_000)  // 10 invites per minute per IP
  // ...
}
```

> For production, replace the in-memory store with Redis (Upstash) for distributed rate limiting.

---

## 7. RLS Architecture

### Strategy

RLS is the last line of defense. Even if the application layer has a bug, RLS prevents data leaks at the database level.

### Core patterns

```sql
-- ── Pattern 1: School isolation ────────────────────────────────────
-- Every table with school_id gets this policy
create policy "school_isolation" on students
  for all
  using (
    school_id = (
      select school_id from profiles
      where id = auth.uid()
    )
  );

-- ── Pattern 2: Role-based write access ────────────────────────────
create policy "teacher_can_record_attendance" on attendance
  for insert
  with check (
    exists (
      select 1 from profiles
      where id    = auth.uid()
      and   role  in ('teacher', 'admin', 'principal')
      and   school_id = attendance.school_id
    )
  );

-- ── Pattern 3: Own-record read access ─────────────────────────────
create policy "student_reads_own_results" on results
  for select
  using (
    student_id = (
      select id from students
      where user_id = auth.uid()
    )
  );

-- ── Pattern 4: Parent reads linked student data ───────────────────
create policy "parent_reads_linked_student_results" on results
  for select
  using (
    exists (
      select 1 from student_parent_links
      where student_id = results.student_id
      and   parent_id  = auth.uid()
    )
  );

-- ── Pattern 5: Profiles — users read own, admins read school ──────
create policy "profile_self_read" on profiles
  for select
  using (id = auth.uid());

create policy "admin_reads_school_profiles" on profiles
  for select
  using (
    school_id = (
      select school_id from profiles
      where id   = auth.uid()
      and   role in ('admin', 'principal')
    )
  );
```

### RLS helper function

```sql
-- Avoids repeating the profile lookup in every policy
create or replace function auth_school_id()
returns uuid
language sql
security definer
stable
as $$
  select school_id from public.profiles where id = auth.uid()
$$;

create or replace function auth_role()
returns text
language sql
security definer
stable
as $$
  select role from public.profiles where id = auth.uid()
$$;

-- Now policies are cleaner
create policy "school_isolation" on students
  for all
  using (school_id = auth_school_id());
```

### Tables requiring RLS

Every table must have `enable row level security` and at least one policy. No exceptions.

```sql
alter table profiles                  enable row level security;
alter table students                  enable row level security;
alter table teachers                  enable row level security;
alter table classes                   enable row level security;
alter table attendance                enable row level security;
alter table results                   enable row level security;
alter table report_cards              enable row level security;
alter table timetables                enable row level security;
alter table announcements             enable row level security;
alter table activities                enable row level security;
alter table activity_participants     enable row level security;
alter table achievements              enable row level security;
alter table invitations               enable row level security;
alter table audit_logs                enable row level security;
```

---

## 8. Security Hardening Checklist

### Authentication

- [ ] Supabase Auth email confirmation enabled for self-registered users
- [ ] Admin-created users have `email_confirm: true` (bypass confirmation)
- [ ] Temporary passwords are cryptographically random (16+ chars)
- [ ] Force password change on first login via `require_password_change` flag
- [ ] MFA available for admin and principal roles
- [ ] Session timeout configured (recommended: 1hr access, 7day refresh)
- [ ] Refresh token rotation enabled in Supabase Auth settings

### Authorization

- [ ] `role` is never read from `user_metadata` — always from `profiles`
- [ ] `school_id` is never accepted from client input
- [ ] `requireRole()` called at the start of every write Server Action
- [ ] RLS enabled on every table with at least one policy
- [ ] `service_role` client never used in client components or API routes
- [ ] `service_role` key only in server-side environment variables

### Input validation

- [ ] Zod schema validation on every Server Action input
- [ ] UUIDs validated as `z.string().uuid()` before DB queries
- [ ] Date strings validated with regex before DB queries
- [ ] Free-text fields have max length constraints in Zod and DB
- [ ] Email fields normalized to lowercase before storage

### Invitation flow

- [ ] Tokens are signed JWTs (HMAC-SHA256), not guessable UUIDs
- [ ] Token hash stored in DB — not the raw token
- [ ] Invitation expires in 72 hours
- [ ] Invitation can only be accepted once (`status = 'pending'` check)
- [ ] Email in token payload verified against invitation record
- [ ] Invitation is scoped to a specific student and school

### Audit and monitoring

- [ ] Every privileged action writes to `audit_logs`
- [ ] Failed login attempts tracked in `profiles.failed_login_attempts`
- [ ] Account auto-lock after 5 failed attempts
- [ ] Auth events forwarded to logging service (Datadog, Logtail, etc.)
- [ ] Alerts on: bulk user creation, mass invitations, role changes

### Infrastructure

- [ ] `SUPABASE_SERVICE_ROLE_KEY` only in server-side env vars
- [ ] `NEXT_PUBLIC_*` variables contain no secrets
- [ ] All API routes and Server Actions behind HTTPS
- [ ] CORS restricted to known origins
- [ ] CSP headers configured in Next.js middleware

---

## 9. Scalability Considerations

### Multi-tenancy

The system is multi-tenant by `school_id`. Every query is scoped to `school_id` from the session. RLS enforces this at the DB level. Adding a new school requires no schema changes — just a new row in `schools`.

### Database indexing strategy

```sql
-- Tenant isolation — every table needs this
create index idx_students_school_id    on students(school_id);
create index idx_teachers_school_id    on teachers(school_id);
create index idx_attendance_school_id  on attendance(school_id);
create index idx_results_school_id     on results(school_id);

-- Common lookup patterns
create index idx_students_user_id      on students(user_id);
create index idx_teachers_user_id      on teachers(user_id);
create index idx_profiles_school_role  on profiles(school_id, role);
create index idx_attendance_class_date on attendance(class_id, date, session_type);
create index idx_results_student_term  on results(student_id, academic_year, term);
create index idx_invitations_token     on invitations(token_hash);
create index idx_invitations_status    on invitations(status, expires_at);
```

### Moving summaries to the database

JavaScript-computed summaries (attendance rates, result averages, class positions) should move to Postgres functions as load grows:

```sql
create or replace function get_student_attendance_summary(
  p_student_id uuid,
  p_class_id   uuid,
  p_date_from  date,
  p_date_to    date,
  p_school_id  uuid
)
returns table (
  total int, present int, absent int,
  late int, excused int, attendance_rate numeric
)
language sql security definer stable as $$
  select
    count(*)::int,
    count(*) filter (where status = 'present')::int,
    count(*) filter (where status = 'absent')::int,
    count(*) filter (where status = 'late')::int,
    count(*) filter (where status = 'excused')::int,
    round(
      count(*) filter (where status in ('present','late'))::numeric
      / nullif(count(*), 0) * 100, 2
    )
  from attendance
  where student_id = p_student_id
    and class_id   = p_class_id
    and date between p_date_from and p_date_to
    and school_id  = p_school_id
$$;
```

### Invitation cleanup job

Expired invitations accumulate over time. Run a Supabase Edge Function on a schedule:

```ts
// supabase/functions/cleanup-invitations/index.ts
Deno.serve(async () => {
  const supabase = createClient(...)
  await supabase
    .from('invitations')
    .update({ status: 'expired' })
    .eq('status', 'pending')
    .lt('expires_at', new Date().toISOString())

  return new Response('ok')
})
```

---

## 10. Recommended Folder Structure

```
src/
├── app/
│   ├── (auth)/
│   │   ├── login/
│   │   ├── parent-register/        ← invitation acceptance page
│   │   └── first-login/            ← forced password change
│   ├── (dashboard)/
│   │   ├── admin/
│   │   ├── teacher/
│   │   ├── student/
│   │   └── parent/
│   └── api/
│       └── webhooks/               ← Supabase auth webhooks
│
├── actions/                        ← all Server Actions ('use server')
│   ├── users/
│   │   ├── create-student.action.ts
│   │   ├── create-teacher.action.ts
│   │   ├── create-admin.action.ts
│   │   ├── invite-parent.action.ts
│   │   └── complete-parent-setup.action.ts
│   ├── attendance/
│   │   ├── record-attendance.action.ts
│   │   └── bulk-record.action.ts
│   └── results/
│       ├── post-result.action.ts
│       └── bulk-post.action.ts
│
├── dal/                            ← Data Access Layer
│   ├── base.repository.ts
│   ├── errors.ts
│   ├── guards.ts                   ← requireRole, requireSameSchool
│   ├── students.repository.ts
│   ├── teachers.repository.ts
│   ├── profiles.repository.ts
│   ├── attendance.repository.ts
│   ├── results.repository.ts
│   ├── invitations.repository.ts
│   ├── audit-logs.repository.ts
│   └── index.ts
│
├── lib/
│   ├── supabase/
│   │   ├── client.ts               ← browser client (anon key)
│   │   ├── server.ts               ← server client (session cookie)
│   │   ├── admin.ts                ← service_role client
│   │   ├── context.ts              ← getSchoolContext()
│   │   └── middleware.ts           ← session refresh
│   ├── auth/
│   │   ├── tokens.ts               ← invitation token sign/verify
│   │   ├── password.ts             ← temporary password generation
│   │   └── session.ts              ← session helpers
│   ├── logger.ts
│   ├── rate-limit.ts
│   └── utils.ts
│
├── middleware.ts                   ← route protection, session refresh
│
└── types/
    └── supabase.ts                 ← generated types
```

---

## 11. TypeScript Patterns

### Context type

```ts
// src/lib/supabase/context.ts
export interface SchoolContext {
  userId:   string
  schoolId: string
  role:     'admin' | 'principal' | 'teacher' | 'student' | 'parent'
}
```

### Server Action wrapper

```ts
// src/lib/actions/safe-action.ts
// Wraps every Server Action with consistent error handling
type ActionResult<T> =
  | { success: true;  data: T }
  | { success: false; error: string; code: string }

export async function safeAction<T>(
  fn: () => Promise<T>
): Promise<ActionResult<T>> {
  try {
    const data = await fn()
    return { success: true, data }
  } catch (err) {
    if (err instanceof DALError) {
      return { success: false, error: err.message, code: err.code }
    }
    logger.error('safeAction', 'unhandled error', { err })
    return { success: false, error: 'Internal server error', code: 'INTERNAL' }
  }
}

// Usage
export async function createStudentAction(input: CreateStudentInput) {
  return safeAction(async () => {
    const context = await getSchoolContext(supabase)
    requireRole(context.role, ['admin', 'principal'])
    // ...
  })
}
```

### Invitation token

```ts
// src/lib/auth/tokens.ts
import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

const SECRET = process.env.INVITATION_SECRET!  // min 32 chars

export function signInvitationToken(payload: {
  email:     string
  studentId: string
  schoolId:  string
  expiresAt: number
}): string {
  const data      = JSON.stringify(payload)
  const encoded   = Buffer.from(data).toString('base64url')
  const signature = createHmac('sha256', SECRET).update(encoded).digest('base64url')
  return `${encoded}.${signature}`
}

export function verifyInvitationToken(token: string): {
  email: string; studentId: string; schoolId: string; expiresAt: number
} {
  const [encoded, signature] = token.split('.')
  if (!encoded || !signature) throw new Error('Invalid token format')

  const expected = createHmac('sha256', SECRET).update(encoded).digest('base64url')
  const sigBuf   = Buffer.from(signature, 'base64url')
  const expBuf   = Buffer.from(expected,  'base64url')

  // Timing-safe comparison prevents timing attacks
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw new Error('Invalid token signature')
  }

  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString())

  if (Date.now() > payload.expiresAt) {
    throw new Error('Token expired')
  }

  return payload
}

export function hashToken(token: string): string {
  return createHmac('sha256', SECRET).update(token).digest('hex')
}
```

### Audit logging

```ts
// src/dal/audit-logs.repository.ts
export type AuditAction =
  | 'student_created'   | 'teacher_created'  | 'admin_created'
  | 'parent_invited'    | 'parent_registered'
  | 'role_assigned'     | 'account_locked'   | 'account_unlocked'
  | 'attendance_recorded' | 'result_posted'  | 'report_card_published'

export async function auditLog(
  db:       SupabaseClient<Database>,
  action:   AuditAction,
  context:  SchoolContext,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  await db.from('audit_logs').insert({
    action,
    performed_by: context.userId,
    school_id:    context.schoolId,
    metadata,
    created_at:   new Date().toISOString(),
  })
}
```

---

## 12. Pseudo-code for Critical Flows

### Complete parent registration

```
FUNCTION completeParentRegistration(token, password, fullName, phone):

  // 1. Verify token
  payload = verifyInvitationToken(token)       // throws if invalid/expired
  tokenHash = hashToken(token)

  // 2. Look up invitation
  invite = db.invitations.findBy(tokenHash)
  assert invite.status == 'pending'
  assert invite.expires_at > now()
  assert invite.email == payload.email          // prevent token swapping

  // 3. Check student still exists in school
  student = db.students.findBy(invite.student_id, invite.school_id)
  assert student != null

  // 4. Check email not already registered
  existing = auth.getUserByEmail(invite.email)
  assert existing == null

  // 5. Create auth user (service_role)
  authUser = auth.admin.createUser(
    email:         invite.email,
    password:      password,
    email_confirm: true
  )

  TRY:
    // 6. Create profile
    db.profiles.create(
      id:        authUser.id,
      full_name: fullName,
      role:      'parent',
      school_id: invite.school_id,
      phone:     phone,
      account_status:      'active',
      verification_status: 'verified'
    )

    // 7. Link parent to student
    db.student_parent_links.create(
      parent_id:  authUser.id,
      student_id: invite.student_id,
      school_id:  invite.school_id
    )

    // 8. Mark invitation accepted
    db.invitations.update(invite.id,
      status:      'accepted',
      accepted_at: now()
    )

    // 9. Audit log
    auditLog('parent_registered', { parentId: authUser.id, studentId: invite.student_id })

  CATCH error:
    // Rollback auth user
    auth.admin.deleteUser(authUser.id)
    throw error

  RETURN { success: true }
```

### Session middleware

```
MIDDLEWARE(request):

  // 1. Refresh session cookie
  session = supabase.auth.getSession()
  IF session.error OR !session.user:
    IF route is protected:
      redirect('/login')
    RETURN

  // 2. Get user role from profile
  profile = db.profiles.select('role, account_status')
             .where(id = session.user.id)
             .single()

  IF !profile OR profile.account_status != 'active':
    clearSession()
    redirect('/login?reason=account_inactive')

  // 3. Check route permission
  requiredRole = getRouteRole(request.pathname)
  IF !hasRole(profile.role, requiredRole):
    redirect('/unauthorized')

  // 4. Inject role into request headers for Server Components
  request.headers.set('x-user-role', profile.role)
  request.headers.set('x-school-id', profile.school_id)
  // Note: these are for convenience only — never trusted for authorization
  // All Server Actions re-verify from the DB

  RETURN NEXT(request)
```

---

## 13. Common Mistakes to Avoid

**1. Reading role from `user_metadata`**
Supabase `user_metadata` is client-writable. A user can set `{ role: 'admin' }` in their own metadata. Always read role from `public.profiles`.

**2. Accepting `school_id` from the client**
Any input field named `school_id` in a Server Action is a multi-tenant leak waiting to happen. Always inject from session.

**3. Using `service_role` in API routes**
API routes can be called directly. `service_role` bypasses RLS. Only use it in Server Actions for `auth.admin` operations.

**4. Not rolling back auth users**
If profile creation fails after auth user creation, you get an orphaned auth user with no profile. Always wrap in try/catch with rollback.

**5. Storing the raw invitation token**
Store the hash of the token, not the token itself. If your database is compromised, raw tokens are immediately usable. Hashes are not.

**6. Trusting `x-forwarded-for` for rate limiting without validation**
Headers can be spoofed. Use Vercel's `x-real-ip` or your CDN's verified IP header.

**7. RLS policies that are too permissive**
`using (true)` is not a policy — it allows everything. Every policy must have a meaningful condition.

**8. Not testing RLS**
Write integration tests that connect as a student user and verify they cannot read another student's data. RLS bugs are silent — queries just return empty results.

**9. Forgetting `security definer` on helper functions**
If your RLS helper function runs with invoker permissions and the invoker doesn't have access to `profiles`, the policy silently fails.

**10. Single-layer authorization**
Relying only on middleware for auth. Middleware can be misconfigured. Always have role checks in Server Actions AND RLS in the DB.

---

## 14. Final Architecture Summary

```
┌─────────────────────────────────────────────────────────────┐
│                    TRUST HIERARCHY                           │
│                                                             │
│  CLIENT            → trust nothing from here                │
│  MIDDLEWARE        → session validation + route guards      │
│  SERVER ACTIONS    → role checks + input validation + audit │
│  DAL               → school_id injection + typed queries    │
│  RLS               → DB-level enforcement — final safety    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                   CLIENT USAGE                              │
│                                                             │
│  anon key          → login page, public routes              │
│  auth session key  → all authenticated queries              │
│  service_role      → Server Actions only, auth.admin ops    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│               USER CREATION RESPONSIBILITY                  │
│                                                             │
│  Admin/Principal   → creates Teachers via Server Action     │
│  Admin/Principal   → creates Students via Server Action     │
│  Admin/Principal   → invites Parents via signed token       │
│  Parent            → self-completes via invitation link     │
│  Nobody            → self-registers (no public signup)      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│               DATA SEPARATION                               │
│                                                             │
│  auth.users        → credentials, sessions (Supabase-owned) │
│  public.profiles   → role, school_id, account status       │
│  domain tables     → students, teachers (user_id FK)        │
│  audit_logs        → immutable record of all changes        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│              MULTI-TENANT READINESS                         │
│                                                             │
│  school_id on every table                                   │
│  RLS scopes every query to school_id                        │
│  getSchoolContext() injects school_id from session          │
│  No cross-school data access possible at any layer          │
└─────────────────────────────────────────────────────────────┘
```

### Non-negotiable production requirements

| Requirement | Implementation |
|---|---|
| No public self-registration | No signup page — admin creates all users |
| Role never from client | Always from `profiles` via authenticated session |
| school_id never from client | Always from `getSchoolContext()` |
| service_role never in browser | Server Actions only, never `NEXT_PUBLIC_` |
| Every write is audited | `auditLog()` called in every Server Action |
| Invitation tokens are signed | HMAC-SHA256, 72hr expiry, single-use |
| RLS on every table | No exceptions — DB enforces what app should enforce |
| Rollback on partial failure | auth.admin.deleteUser on downstream failure |
| Forced password change | `require_password_change` flag in profiles |
| Account lockout | After 5 failed login attempts, 30min lockout |