# LearnerHub

A modern, type-safe school management system built with Next.js 15, Supabase, and TypeScript — designed to handle student enrollment, class management, parental consent tracking, and SIS synchronization.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 (App Router), React, Tailwind CSS, shadcn/ui |
| Backend | Next.js API Routes |
| Database | PostgreSQL via Supabase |
| Auth | Supabase Auth |
| Validation | Zod |
| Logging | Custom structured logger |
| Language | TypeScript (end-to-end) |

---

## Architecture

```
PostgreSQL (Supabase)
        ↓
Data Access Layer
(BaseRepository + domain repositories)
        ↓
Next.js API Routes
        ↓
React Client Components
```

Each layer has a single responsibility:

- **Database** — stores and persists all data
- **DAL** — the only layer that talks to the database, exposes typed methods
- **API Routes** — validates requests, calls the DAL, returns responses
- **Client** — renders UI, calls API routes

---

## Project Structure

```
learnerhub/
├── app/                        # Next.js App Router
│   ├── api/                    # API route handlers
│   └── (pages)/                # UI pages
├── components/                 # Reusable React components
├── config/                     # App configuration
├── dal/                        # Data Access Layer
│   ├── base.repository.ts      # Abstract base repository
│   ├── students.repository.ts  # Students DAL
│   └── errors.ts               # DAL error classes
├── hooks/                      # Custom React hooks
├── lib/
│   ├── supabase/               # Supabase client setup
│   ├── logger.ts               # Structured logger
│   └── utils.ts                # Shared utilities (cn, JsonSchema)
├── public/                     # Static assets
└── types/
    └── supabase.ts             # Generated Supabase types
```

---

## Features

- Student enrollment and profile management
- Class assignment and tracking
- Enrollment status transitions (`active`, `graduated`, `transferred_out`, `suspended`, `expelled`, `on_leave`)
- Parental consent recording and tracking
- SIS (Student Information System) sync support
- Structured logging with PII sanitization
- Type-safe database access end-to-end
- Centralized error handling with HTTP status mapping

---

## Data Access Layer

The DAL is built around an abstract `BaseRepository<T>` class that provides common database operations for any table. Each domain (students, classes, etc.) extends the base with table-specific logic.

### Error Classes

| Class | Code | HTTP Status |
|---|---|---|
| `NotFoundError` | `NOT_FOUND` | 404 |
| `ValidationError` | `VALIDATION_ERROR` | 400 |
| `ConflictError` | `CONFLICT` | 409 |
| `UnauthorizedError` | `UNAUTHORIZED` | 401 |
| `DatabaseError` | `DATABASE_ERROR` | 500 |

### Students Repository

The `StudentsRepository` exposes the following methods:

#### Read
| Method | Description |
|---|---|
| `getById(id)` | Fetch a student by their UUID |
| `getByUserId(userId)` | Fetch a student by their auth user ID |
| `getByAdmissionNumber(number)` | Fetch a student by admission number |
| `list(options)` | List students with optional filters and pagination |
| `count(options)` | Count students matching filters |

#### Write
| Method | Description |
|---|---|
| `create(input)` | Enroll a new student |
| `update(id, input)` | Update student details |
| `delete(id)` | Remove a student record |

#### Status Transitions
| Method | Description |
|---|---|
| `graduate(id, date)` | Mark student as graduated |
| `transfer(id, date)` | Mark student as transferred out |
| `suspend(id)` | Suspend a student |
| `reinstate(id)` | Reinstate a suspended student to active |

#### Other
| Method | Description |
|---|---|
| `assignToClass(id, classId)` | Assign student to a class |
| `removeFromClass(id)` | Remove student from their current class |
| `recordParentalConsent(id, given)` | Record parental consent decision |

---

## Getting Started

### Prerequisites

- Node.js 18+
- A Supabase project with PostgreSQL database
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/learnerhub.git
cd learnerhub

# Install dependencies
npm install
```

### Environment Variables

Create a `.env.local` file in the root of the project:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### Generate Supabase Types

```bash
npx supabase gen types typescript --project-id your_project_id > src/types/supabase.ts
```

### Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Logging

All DAL operations produce structured JSON logs with automatic PII sanitization. Sensitive fields (`password`, `email`, `phone`, `token`, `jwt`, `authorization`) are stripped before any log is written.

```json
{
  "timestamp": "2026-04-19T10:00:00.000Z",
  "level": "info",
  "context": "students",
  "message": "create",
  "meta": { "admission_number": "ADM-001" }
}
```

In development, logs are output with colour-coded prefixes. In production, logs are output as plain JSON for ingestion by log aggregators (Datadog, CloudWatch, Logtail, etc.).

---

## Error Handling

All errors thrown by the DAL extend the base `DALError` class. The `toHttpStatus()` utility maps DAL error codes to HTTP status codes for use in API route handlers:

```ts
import { toHttpStatus, DALError } from '@/dal/errors'

try {
  const student = await studentsRepo.getById(id)
} catch (err) {
  if (err instanceof DALError) {
    return Response.json({ error: err.message }, { status: toHttpStatus(err) })
  }
}
```

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes (`git commit -m 'add your feature'`)
4. Push to the branch (`git push origin feature/your-feature`)
5. Open a Pull Request

---

## License

MIT