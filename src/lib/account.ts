/**
 * Client for the stay-signed-in Google session (api/google/*). The refresh
 * token never reaches the browser: it lives sealed in an httpOnly cookie, and
 * this module asks the server for short-lived access tokens when needed.
 */
import { AuthExpired } from './mailbox'

export interface GoogleStatus {
  configured: boolean
  signedIn: boolean
  email: string | null
  name: string | null
}

const BASE = '/api/google'

export async function googleStatus(f: typeof fetch = fetch): Promise<GoogleStatus> {
  try {
    const res = await f(`${BASE}/session`, { credentials: 'same-origin' })
    if (!res.ok) return { configured: false, signedIn: false, email: null, name: null }
    return (await res.json()) as GoogleStatus
  } catch {
    return { configured: false, signedIn: false, email: null, name: null }
  }
}

/** Full-page redirect to Google's consent screen (no popup). */
export function startGoogleLogin(hint?: string) {
  location.assign(`${BASE}/login${hint ? `?hint=${encodeURIComponent(hint)}` : ''}`)
}

/** Token source with an in-memory cache; the server refreshes behind the scenes. */
export function serverTokenSource(f: typeof fetch = fetch): (force?: boolean) => Promise<string> {
  let token: string | null = null
  let exp = 0
  let pending: Promise<string> | null = null
  return async (force = false) => {
    if (!force && token && exp - Date.now() > 60_000) return token
    pending ??= (async () => {
      try {
        const res = await f(`${BASE}/session`, { method: 'POST', credentials: 'same-origin' })
        if (res.status === 401) throw new AuthExpired()
        if (!res.ok) throw new Error(`Session ${res.status}`)
        const data = (await res.json()) as { accessToken: string; expiresAt: number }
        token = data.accessToken
        exp = data.expiresAt
        return token
      } finally {
        pending = null
      }
    })()
    return pending
  }
}

/** Revoke Google's grant and clear the session cookie. */
export async function googleLogout(f: typeof fetch = fetch): Promise<void> {
  await f(`${BASE}/session`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => undefined)
}
