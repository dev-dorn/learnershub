# School Management System — Auth & Roles Architecture

## Overview

This document captures the architectural decisions made during Phase 1 of the school management system backend, covering user creation, roles, profile management, and row-level security (RLS).

---

## Phase 1 — Auth & Roles

### User Creation Flow

Users are **never self-registered**. All accounts are created by an admin or super admin. The flow is:

```
Admin fills form
  → POST /api/users (service role)
    → supabase.auth.admin.inviteUserByEmail()
      → handle_new_user() trigger fires
        → profile row created (status = pending)
          → user receives email invite
            → user sets password
              → status updated to active
```

This ensures all user data is official and controlled. No open sign-up exists.

---

### Roles

Roles are defined as a PostgreSQL enum:

```sql
create type public.user_role as enum (
  'super_admin',
  'admin',
  'teacher',
  'student',
  'parent'
);
```

**Why an enum and not a text check constraint?**
Enums are enforced at the type level in PostgreSQL — invalid values are rejected before they reach any constraint check. They also make queries cleaner and catch typos at insert time.

---

### Role Definitions

| Role | Scope | Notes |
|------|-------|-------|
| `super_admin` | All schools | Platform-level access. Not tied to any school. |
| `admin` | One school | Manages users, data, and settings within their school. |
| `teacher` | One school | Can view school profiles. Can update their own profile. |
| `student` | One school | Read-only. Cannot edit their own profile. |
| `parent` | One school | Can edit their own profile (contact info only). |

---

### Account Status Flow

```
pending → active → suspended → terminated
                ↘ pending_approval
```

| Status | Meaning |
|--------|---------|
| `pending` | Created but invite not accepted yet |
| `active` | Confirmed and using the system |
| `pending_approval` | Awaiting admin approval |
| `suspended` | Temporarily blocked |
| `terminated` | Soft deleted — record kept for audit trail |

**Decision:** Admins and super admins are set to `active` immediately on creation. All other roles start as `pending` until they accept their invite.

**Decision:** Hard deletes are never allowed on profiles — not even for admins. The audit trail is sacred. Use `account_status = 'terminated'` instead.

---

### The `profiles` Table

The `profiles` table extends `auth.users` with application-level data:

```
auth.users (Supabase managed)
    ↓ 1:1
public.profiles (application managed)
```

**Key design decisions:**

- `id` is a foreign key to `auth.users(id)` with `on delete cascade` — deleting an auth user cleans up the profile automatically.
- `school_id` is required for everyone **except** `super_admin`, enforced via a check constraint rather than a `NOT NULL` column constraint — this allows `super_admin` to have a null `school_id` while everyone else is still enforced at the database level.
- `role` uses the `user_role` enum for type safety.
- `updated_at` is auto-managed by a trigger — never set manually.
- Sensitive security fields (`failed_login_attempts`, `locked_until`, `verification_code_hash`) are on the profile but only writable by service role or admin.

**Check constraint for school_id:**
```sql
check (role = 'super_admin' or school_id is not null)
```

This is enforced at the database level on every insert and update.

---

### The `handle_new_user()` Trigger

Fires automatically after every insert into `auth.users`. Reads metadata passed during user creation and creates the corresponding profile row.

**Metadata expected:**

```json
{
  "full_name": "Jane Doe",
  "role": "teacher",
  "school_id": "uuid-of-school"
}
```

**Fallback behavior:**
- If `role` is not provided → defaults to `student`
- If `school_id` is not provided and role is not `super_admin` → falls back to the first school in the database (ordered by `created_at`)
- If role is `super_admin` → `school_id` is set to `null`

---

### Helper Functions

Two helper functions are used throughout RLS policies to avoid redundant subqueries:

```sql
public.get_my_role()       -- returns the role of the currently authenticated user
public.get_my_school_id()  -- returns the school_id of the currently authenticated user
```

Both are `security definer` and `stable` — they run with elevated privileges but are read-only and safe to use in RLS policies.

**Why not use `auth.jwt() ->> 'role'`?**
JWT claims are not automatically populated from the profiles table. Using a direct query against `profiles` is more reliable and always reflects the current state of the database, not a potentially stale token.

---

### Row Level Security (RLS)

RLS is enabled on `public.profiles`. All access goes through policies — no implicit access exists.

**Policy summary:**

| Policy | Command | Who |
|--------|---------|-----|
| Service role full access | ALL | Service role (backend API) |
| Super admin full access | ALL | super_admin |
| Users view own profile | SELECT | Any authenticated user |
| Admins view school profiles | SELECT | admin (scoped to their school) |
| Teachers view school profiles | SELECT | teacher (scoped to their school) |
| Users update own profile | UPDATE | teacher, parent (safe fields only) |
| Admins update any profile | UPDATE | admin (scoped to their school) |
| Service role insert | INSERT | Service role only |

**No DELETE policy exists** — hard deletes are blocked for everyone except service role. Use `account_status = 'terminated'` for soft deletes.

**Why no student UPDATE policy?**
Students represent official academic records. Their profile data must only be changed by an admin to ensure data integrity. Students are read-only consumers of their own records.

**What can teachers and parents update on their own profile?**
Only safe personal fields: `full_name`, `phone`, `avatar_url`. The following are protected and cannot be changed by the user themselves:

- `role`
- `school_id`
- `account_status`
- `verification_status`
- `sis_id`

This is enforced both at the RLS `with check` level (database) and at the API route level (application).

---

### JWT Custom Claims Hook

A `custom_access_token_hook` function injects `user_role` and `school_id` into the JWT on every sign-in and token refresh. This allows client-side code to read role and school without an extra database round-trip.

Configured in: **Supabase Dashboard → Auth → Hooks**

---

### Indexes

```sql
idx_profiles_role_status      -- (role, account_status) for filtered user lists
idx_profiles_verification     -- (verification_status, account_status) for approval flows
idx_profiles_locked           -- (locked_until) partial index for security checks
idx_profiles_school           -- (school_id) for school-scoped queries
```

---

## What Comes Next — Phase 2

With the auth and roles foundation solid, Phase 2 will build:

1. `teachers` table — linked to profiles, with subject and class assignments
2. `students` table — linked to profiles, with enrollment data
3. `parents` table — linked to profiles, with parent ↔ student relationships
4. School-scoped RLS on all new tables using `get_my_school_id()`

---

## Conventions

- All tables live in the `public` schema
- All timestamps use `timestamptz` (timezone-aware)
- Soft deletes only — no hard deletes on any user-facing table
- Service role is used exclusively by the backend API — never exposed to the client
- RLS is enabled on every table — no exceptions