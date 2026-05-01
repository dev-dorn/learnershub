
import { createHmac, createHash, timingSafeEqual } from 'crypto'

// ── Config ────────────────────────────────────────────────────────────

const ISSUER   = 'learnerhub'
const AUDIENCE = 'invite'

export const DEFAULT_INVITE_TTL_MS = 1000 * 60 * 60 * 72   // 72 hours
export const MAX_INVITE_TTL_MS     = 1000 * 60 * 60 * 24 * 7  // 7 days

// ── Secret — memoized after first validation ──────────────────────────

let _secret: string | null = null

function getSecret(): string {
  if (_secret) return _secret
  const secret = process.env.INVITATION_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('INVITATION_SECRET must be at least 32 characters')
  }
  _secret = secret
  return _secret
}

// ── Typed errors ──────────────────────────────────────────────────────

export class TokenError extends Error {
  constructor(
    public code: 'INVALID_FORMAT' | 'INVALID_SIGNATURE' | 'EXPIRED' | 'INVALID_CLAIMS',
    message: string
  ) {
    super(message)
    this.name = 'TokenError'
  }
}

// ── Types ─────────────────────────────────────────────────────────────

export type InvitePayload = {
  email:     string
  studentId: string
  schoolId:  string
  invitedBy: string
  iat:       number
  expiresAt: number
  iss:       string
  aud:       string
}

// ── Helpers ───────────────────────────────────────────────────────────

function encode(data: object): string {
  return Buffer.from(JSON.stringify(data), 'utf8').toString('base64url')
}

function decode<T>(encoded: string): T {
  try {
    const json = Buffer.from(encoded, 'base64url').toString('utf8')
    return JSON.parse(json)
  } catch {
    throw new TokenError('INVALID_FORMAT', 'Invalid token encoding')
  }
}

function safeCompare(a: string, b: string): boolean {
  const bufA   = Buffer.from(a, 'base64url')
  const bufB   = Buffer.from(b, 'base64url')
  const maxLen = Math.max(bufA.length, bufB.length)

  // Always compare equal-length buffers — no length leak
  const paddedA = Buffer.concat([bufA, Buffer.alloc(maxLen - bufA.length)])
  const paddedB = Buffer.concat([bufB, Buffer.alloc(maxLen - bufB.length)])

  return timingSafeEqual(paddedA, paddedB)
}

// ── Sign ──────────────────────────────────────────────────────────────

export function signInviteToken(input: {
  email:     string
  studentId: string
  schoolId:  string
  invitedBy: string
  ttlMs?:    number
}): string {
  const secret = getSecret()
  const now    = Date.now()
  const ttl    = input.ttlMs ?? DEFAULT_INVITE_TTL_MS

  if (ttl <= 0) {
    throw new TokenError('INVALID_CLAIMS', 'Token TTL must be greater than 0')
  }
  if (ttl > MAX_INVITE_TTL_MS) {
    throw new TokenError('INVALID_CLAIMS', `Token TTL cannot exceed ${MAX_INVITE_TTL_MS}ms`)
  }

  const payload: InvitePayload = {
    email:     input.email.toLowerCase().trim(),
    studentId: input.studentId,
    schoolId:  input.schoolId,
    invitedBy: input.invitedBy,
    iat:       now,
    expiresAt: now + ttl,
    iss:       ISSUER,
    aud:       AUDIENCE,
  }

  const encoded   = encode(payload)
  const signature = createHmac('sha256', secret)
    .update(encoded)
    .digest('base64url')

  return `${encoded}.${signature}`
}

// ── Verify ────────────────────────────────────────────────────────────

export function verifyInviteToken(token: string): InvitePayload {
  const secret = getSecret()
  const parts  = token.split('.')

  if (parts.length !== 2) {
    throw new TokenError('INVALID_FORMAT', 'Invalid token format')
  }

  const [encoded, signature] = parts

  if (!encoded || !signature) {
    throw new TokenError('INVALID_FORMAT', 'Invalid token structure')
  }

  // ── Signature check — constant time ──────────────────────────────
  const expected = createHmac('sha256', secret)
    .update(encoded)
    .digest('base64url')

  if (!safeCompare(signature, expected)) {
    throw new TokenError('INVALID_SIGNATURE', 'Invalid token signature')
  }

  // ── Decode ────────────────────────────────────────────────────────
  const payload = decode<InvitePayload>(encoded)

  // ── Structural validation ─────────────────────────────────────────
  if (
    typeof payload.email     !== 'string' || payload.email.trim().length     === 0 ||
    typeof payload.studentId !== 'string' || payload.studentId.trim().length === 0 ||
    typeof payload.schoolId  !== 'string' || payload.schoolId.trim().length  === 0 ||
    typeof payload.invitedBy !== 'string' || payload.invitedBy.trim().length === 0
  ) {
    throw new TokenError('INVALID_CLAIMS', 'Invalid token payload — missing required fields')
  }

  if (typeof payload.iat !== 'number' || typeof payload.expiresAt !== 'number') {
    throw new TokenError('INVALID_CLAIMS', 'Invalid token time fields')
  }

  // ── Claims validation ─────────────────────────────────────────────
  if (payload.iss !== ISSUER) {
    throw new TokenError('INVALID_CLAIMS', 'Invalid token issuer')
  }

  if (payload.aud !== AUDIENCE) {
    throw new TokenError('INVALID_CLAIMS', 'Invalid token audience')
  }

  // ── Time validation ───────────────────────────────────────────────
  const now = Date.now()

  if (payload.iat > now + 5000) {  // 5s clock skew tolerance
    throw new TokenError('INVALID_CLAIMS', 'Token issued in the future')
  }

  if (now > payload.expiresAt) {
    throw new TokenError('EXPIRED', 'Token expired')
  }

  if (payload.expiresAt <= payload.iat) {
    throw new TokenError('INVALID_CLAIMS', 'Invalid token time range')
  }

  if (payload.expiresAt - payload.iat > MAX_INVITE_TTL_MS) {
    throw new TokenError('INVALID_CLAIMS', 'Token TTL exceeds maximum allowed')
  }

  return payload
}

// ── Hash — one-way SHA-256 for DB storage ─────────────────────────────
// Uses SHA-256 not HMAC — one-way so DB compromise
// cannot be used to regenerate tokens

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}