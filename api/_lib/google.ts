/**
 * Google sign-in that survives reloads: OAuth 2.0 authorization code flow with
 * PKCE. The refresh token is sealed into an httpOnly cookie (see session.ts);
 * the browser only ever receives short-lived access tokens and calls the Gmail
 * API directly. Nothing is stored on the server.
 */
import { createHash, randomBytes } from 'node:crypto'
import { cookie, json, originOf, readCookie, sameOrigin, seal, sessionSecret, SESSION_COOKIE, OAUTH_COOKIE, unseal } from './session.js'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
export const GOOGLE_SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/gmail.modify']
const COOKIE_PATH = '/api/google'
const SESSION_DAYS = 180

export interface GoogleEnv {
  clientId?: string
  clientSecret?: string
  secret: string | null
}

export function googleEnv(env: Record<string, string | undefined> = process.env): GoogleEnv {
  return { clientId: env.GOOGLE_CLIENT_ID || env.VITE_GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, secret: sessionSecret(env) }
}

const configured = (e: GoogleEnv): e is Required<GoogleEnv> & { secret: string } => Boolean(e.clientId && e.clientSecret && e.secret)

export interface Session {
  rt: string // refresh token
  at?: string // cached access token
  exp?: number // access token expiry (epoch ms)
  email: string
  name?: string
}

interface OAuthState {
  state: string
  verifier: string
  ts: number
}

const b64url = (b: Buffer) => b.toString('base64url')
const secure = (request: Request) => originOf(request).startsWith('https:')
const redirect = (to: string, cookies: string[] = []) => {
  const headers = new Headers({ location: to, 'cache-control': 'no-store' })
  for (const c of cookies) headers.append('set-cookie', c)
  return new Response(null, { status: 302, headers })
}
const clear = (request: Request, name: string) => cookie(name, '', { maxAge: 0, path: COOKIE_PATH, secure: secure(request) })

/** GET /api/google/login → redirect to Google's consent screen. */
export function loginHandler(request: Request, env = googleEnv()): Response {
  if (!configured(env)) return json(501, { error: 'not_configured' })
  const url = new URL(request.url)
  const state = b64url(randomBytes(16))
  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const auth = new URL(AUTH_URL)
  auth.searchParams.set('client_id', env.clientId)
  auth.searchParams.set('redirect_uri', `${originOf(request)}${COOKIE_PATH}/callback`)
  auth.searchParams.set('response_type', 'code')
  auth.searchParams.set('scope', GOOGLE_SCOPES.join(' '))
  auth.searchParams.set('access_type', 'offline')
  auth.searchParams.set('include_granted_scopes', 'true')
  // consent is needed to (re)issue a refresh token; select_account lets people switch accounts
  auth.searchParams.set('prompt', url.searchParams.get('consent') === '1' ? 'consent select_account' : 'select_account')
  const hint = url.searchParams.get('hint')
  if (hint && /^[^@\s]+@[^@\s]+$/.test(hint) && hint.length < 255) auth.searchParams.set('login_hint', hint)
  auth.searchParams.set('state', state)
  auth.searchParams.set('code_challenge', challenge)
  auth.searchParams.set('code_challenge_method', 'S256')
  const sealed = seal({ state, verifier, ts: Date.now() } satisfies OAuthState, env.secret)
  return redirect(auth.toString(), [cookie(OAUTH_COOKIE, sealed, { maxAge: 600, path: COOKIE_PATH, secure: secure(request) })])
}

function decodeJwt(token: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

/** GET /api/google/callback → exchange the code, seal the refresh token into a cookie, back to the app. */
export async function callbackHandler(request: Request, env = googleEnv(), f: typeof fetch = fetch): Promise<Response> {
  if (!configured(env)) return json(501, { error: 'not_configured' })
  const url = new URL(request.url)
  const back = (status: string, cookies: string[] = []) => redirect(`/?auth=${status}`, [clear(request, OAUTH_COOKIE), ...cookies])
  if (url.searchParams.get('error')) return back('denied')
  const saved = unseal<OAuthState>(readCookie(request, OAUTH_COOKIE), env.secret)
  const code = url.searchParams.get('code')
  if (!saved || !code || saved.state !== url.searchParams.get('state') || Date.now() - saved.ts > 600_000) return back('failed')

  const res = await f(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env.clientId, client_secret: env.clientSecret, redirect_uri: `${originOf(request)}${COOKIE_PATH}/callback`, grant_type: 'authorization_code', code_verifier: saved.verifier }),
  })
  if (!res.ok) return back('failed')
  const tok = (await res.json()) as { access_token?: string; refresh_token?: string; id_token?: string; expires_in?: number; scope?: string }
  if (!tok.access_token) return back('failed')
  // Google lets people untick Gmail on the consent screen
  if (!(tok.scope ?? '').includes('gmail.modify')) return back('scope')
  const claims = decodeJwt(tok.id_token ?? '')
  const email = typeof claims.email === 'string' ? claims.email : ''
  if (!tok.refresh_token) {
    // already granted earlier without a refresh token: ask once more with consent
    return redirect(`${COOKIE_PATH}/login?consent=1${email ? `&hint=${encodeURIComponent(email)}` : ''}`, [clear(request, OAUTH_COOKIE)])
  }
  const session: Session = { rt: tok.refresh_token, at: tok.access_token, exp: Date.now() + (tok.expires_in ?? 3600) * 1000, email, name: typeof claims.name === 'string' ? claims.name : undefined }
  return back('google', [cookie(SESSION_COOKIE, seal(session, env.secret), { maxAge: SESSION_DAYS * 86_400, path: COOKIE_PATH, secure: secure(request) })])
}

/**
 * /api/google/session
 *   GET    → { configured, signedIn, email, name } (no token)
 *   POST   → { accessToken, expiresAt, email, name }, refreshing when needed
 *   DELETE → revoke at Google and clear the cookie (log out)
 */
export async function sessionHandler(request: Request, env = googleEnv(), f: typeof fetch = fetch): Promise<Response> {
  const isConfigured = configured(env)
  const session = isConfigured ? unseal<Session>(readCookie(request, SESSION_COOKIE), env.secret) : null
  if (request.method === 'GET') return json(200, { configured: isConfigured, signedIn: Boolean(session), email: session?.email ?? null, name: session?.name ?? null })
  if (!isConfigured) return json(501, { error: 'not_configured' })
  if (!sameOrigin(request)) return json(403, { error: 'origin' })

  if (request.method === 'DELETE') {
    if (session) await f(`${REVOKE_URL}?token=${encodeURIComponent(session.rt)}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' } }).catch(() => undefined)
    return json(200, { ok: true }, { 'set-cookie': clear(request, SESSION_COOKIE) })
  }
  if (request.method !== 'POST') return json(405, { error: 'method' })
  if (!session) return json(401, { error: 'expired' })
  if (session.at && session.exp && session.exp - Date.now() > 120_000) return json(200, { accessToken: session.at, expiresAt: session.exp, email: session.email, name: session.name ?? null })

  const res = await f(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.clientId!, client_secret: env.clientSecret!, refresh_token: session.rt, grant_type: 'refresh_token' }),
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    // revoked, expired (7 days in Testing mode) or password changed: sign in again
    if (err.error === 'invalid_grant') return json(401, { error: 'expired' }, { 'set-cookie': clear(request, SESSION_COOKIE) })
    return json(502, { error: 'google' })
  }
  const tok = (await res.json()) as { access_token: string; expires_in?: number }
  const next: Session = { ...session, at: tok.access_token, exp: Date.now() + (tok.expires_in ?? 3600) * 1000 }
  return json(200, { accessToken: next.at, expiresAt: next.exp, email: next.email, name: next.name ?? null }, { 'set-cookie': cookie(SESSION_COOKIE, seal(next, env.secret!), { maxAge: SESSION_DAYS * 86_400, path: COOKIE_PATH, secure: secure(request) }) })
}
