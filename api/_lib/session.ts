/**
 * Stateless sessions: data is sealed with AES-256-GCM into an httpOnly cookie.
 * The server stores nothing; the key is derived (HKDF) from SESSION_SECRET, or
 * from GOOGLE_CLIENT_SECRET when no separate secret is set.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

export const SESSION_COOKIE = 'ibm_session'
export const OAUTH_COOKIE = 'ibm_oauth'

function key(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'inbox-bubble-map', 'session-v1', 32))
}

export function sessionSecret(env: Record<string, string | undefined> = process.env): string | null {
  return env.SESSION_SECRET || env.GOOGLE_CLIENT_SECRET || null
}

export function seal(data: unknown, secret: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv)
  const body = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url')
}

export function unseal<T>(token: string | undefined, secret: string): T | null {
  if (!token) return null
  try {
    const raw = Buffer.from(token, 'base64url')
    if (raw.length < 29) return null
    const decipher = createDecipheriv('aes-256-gcm', key(secret), raw.subarray(0, 12))
    decipher.setAuthTag(raw.subarray(12, 28))
    const text = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie') ?? ''
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return undefined
}

export function cookie(name: string, value: string, opts: { maxAge: number; path?: string; secure: boolean }): string {
  return [`${name}=${value}`, `Path=${opts.path ?? '/'}`, `Max-Age=${opts.maxAge}`, 'HttpOnly', 'SameSite=Lax', opts.secure ? 'Secure' : ''].filter(Boolean).join('; ')
}

/** Origin of the deployment as the browser sees it (Vercel sets x-forwarded-*). */
export function originOf(request: Request): string {
  const u = new URL(request.url)
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? u.host
  const proto = request.headers.get('x-forwarded-proto') ?? u.protocol.replace(':', '')
  return `${proto}://${host}`
}

/** Same-origin check for state-changing requests (CSRF guard on top of SameSite=Lax). */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return false
  try {
    return new URL(origin).host === new URL(originOf(request)).host
  } catch {
    return false
  }
}

export const json = (status: number, data: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers } })
