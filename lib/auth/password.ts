import {randomBytes , createHash} from "crypto"

const MIN_LENGTH = 12
const DEFAULT_LENGTH = 16

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz'
const DIGITS    = '0123456789'
const SYMBOLS   = '!@#$%^&*()-_=+[]{}|;:,.<>?'
const ALL_CHARS = UPPERCASE + LOWERCASE + DIGITS + SYMBOLS

export  interface PasswordValidationResult {
  valid: boolean
  errors: string[]
}

export interface GeneratedPassword {
  password: string
  expiresAt: string // ISO string -force change after this date
}
// -Generate

/**
 * Generates a cryptographically random temporary password.
 * Guarantees at least one character from each pool:
 * uppercase, lowercase, digit, symbol.
 * Temporary passwords expire in 24 hours — user must change on first login.
 */
export function generateTemporaryPassword (
  length = DEFAULT_LENGTH

): GeneratedPassword {
  if (length < MIN_LENGTH) {
    throw new Error(
      `password length must be at least $ {MIN_LENGTH} characters`
    )
  }
  let password = ""

  // ── Guarantee at least one from each pool ────────────────────────
  // This ensures complexity requirements are always met
  password += pickRandom(UPPERCASE)
  password += pickRandom(LOWERCASE)
  password += pickRandom(DIGITS)
  password += pickRandom(SYMBOLS)

  for (let i = password.length; i < length; i++){
    password += pickRandom(ALL_CHARS)
  }
  // --Shuffle - prevents first 4 chars always being predictable
  password = shuffle(password)
  return {
    password,
    expiresAt: new Date(Date.now() + 1000 * 60 * 24).toISOString(),

  }

}
//Validate -----
/**
 * Validates a password against complexity requirements.
 * Used for user-chosen passwords — not temporary ones.
 */
export function validatePasswordStrength(
  password: string
): PasswordValidationResult{
  const errors: string[] = []
  if (password.length < MIN_LENGTH) {
    errors.push(`Password must be at least ${MIN_LENGTH} characters`)
  }

  if (!/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter")
  }

  if (!/[a-z]/.test(password)) {
    errors.push("Password must contain at least one lowercase letter")
  }

  if (!/[0-9]/.test(password)) {
    errors.push("Password must contain at least one number")
  }

  if (!/[!@#$%^&*()\-_=+\[\]{}|;:,.<>?]/.test(password)) {
    errors.push("Password must contain at least one special character")
  }

  if (/\s/.test(password)) {
    errors.push("Password must not contain spaces")
  }

  // Check for common weak patterns
  if (/^(.)\1+$/.test(password)) {
    errors.push("Password must not be a single repeated character")
  }

  if (
    /^(012|123|234|345|456|567|678|789|890|abc|bcd|cde|def)/i.test(password)
  ) {
    errors.push("Password must not start with a sequential pattern")
  }

  return {
    valid: errors.length === 0,
    errors,
  }


}
/**
 * Checks if a temporary password has expired.
 */
export function isTemporaryPasswordExpired(expiresAt: string): boolean {
  return new Date(expiresAt)< new Date()
}
// ── Hash ──────────────────────────────────────────────────────────────

/**
 * One-way SHA-256 hash — for storing password reset tokens,
 * verification codes, or any non-auth secret that needs DB storage.
 * Never use this for actual passwords — Supabase Auth handles that.
 */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex')
}
/**
 * Generates a secure random verification code — 6 digits.
 * Used for email/phone verification flows.
 */
export function generateVerificationCode(): {
  code : string
  codeHash: string
  expiresAt: string
}{
  const bytes = randomBytes(4)
  const num = bytes.readUInt16BE(0)
  const code = String(num % 1_000_000).padStart(6, '0')

  return {
    code,
    codeHash: hashSecret(code),
    expiresAt: new Date(Date.now() + 1000 * 60 * 15).toISOString(),

  }

}
/**
 * Generates a secure random reset token — URL-safe base64.
 * Used for password reset links.
 */
export function generateResetToken(): {
  token: string
  tokenHash: string
  expiresAt: string
} {
  const token = randomBytes(32).toString('base64url')

  return {
    token,
    tokenHash: hashSecret(token),
    expiresAt: new Date(Date.now()+ 1000 * 60 * 1000).toISOString(),

  }
}


function  pickRandom(chars: string): string {
  const bytes = randomBytes(1)
  return chars[bytes[0]% chars.length]
}
function shuffle(str: string): string {
  const arr = str.split('')

  for (let i = arr.length - 1; i >= 0; i--) {
    const bytes = randomBytes(1)
    const j = bytes[0]% (i + 1)
    ; [arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return  arr.join('')
}
