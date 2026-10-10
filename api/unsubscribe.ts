/**
 * POST /api/unsubscribe: one-click unsubscribe relay (RFC 8058).
 *
 * The browser can't make this request itself (CORS), so the relay sends the
 * standard `List-Unsubscribe=One-Click` POST to the https URL taken from the
 * user's own List-Unsubscribe header. It sends nothing else: no cookies, no
 * referrer, no user data, and it does not follow redirects.
 *
 * Abuse guards: same-origin only, https on port 443 only, public hostnames
 * only (DNS checked, private ranges refused, the connection pinned to the
 * checked address), small body, 8-second timeout, per-IP rate limit. URLs are
 * not logged.
 */
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { isPublicHostname, resolvePublic, type Resolver } from './_lib/net.js'

const MAX_BODY = 4096
const WINDOW = 10 * 60_000
const hits = new Map<string, number[]>()

export function allowUnsub(ip: string, now = Date.now()): boolean {
  const list = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW)
  hits.set(ip, list)
  if (list.length >= 30) return false
  list.push(now)
  return true
}

/** The URL if it is a plain public https address (no credentials, default port). */
export function checkUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null
  const host = u.hostname.toLowerCase()
  if (isIP(host) || !isPublicHostname(host)) return null
  return u
}

export type Poster = (url: URL, address: string) => Promise<number>

/** POST the one-click body over TLS to the pinned address, with SNI and certificate checks for the real host. */
export const postOneClick: Poster = (url, address) =>
  new Promise((resolve, reject) => {
    const body = 'List-Unsubscribe=One-Click'
    const req = httpsRequest(
      {
        host: url.hostname,
        servername: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method: 'POST',
        // pin the connection to the address we checked; newer Node asks for `all` results
        lookup: ((_h: string, o: { all?: boolean }, cb: (err: Error | null, a: unknown, f?: number) => void) =>
          o?.all ? cb(null, [{ address, family: isIP(address) || 4 }]) : cb(null, address, isIP(address) || 4)) as never,
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body), 'user-agent': 'InboxBubbleMap-Unsubscribe/1.0 (RFC 8058)' },
        timeout: 8000,
      },
      (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      },
    )
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.end(body)
  })

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })

export async function handleUnsub(request: Request, deps: { poster?: Poster; resolver?: Resolver } = {}): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'method' })
  const origin = request.headers.get('origin')
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  let originHost = ''
  try {
    originHost = origin ? new URL(origin).host : ''
  } catch {
    /* "null" or malformed origin */
  }
  if (!originHost || !host || originHost !== host) return json(403, { error: 'origin' })
  const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0]!.trim() || 'unknown'
  if (!allowUnsub(ip)) return json(429, { error: 'rate' })

  const raw = await request.text()
  if (raw.length > MAX_BODY) return json(413, { error: 'size' })
  let url: URL | null = null
  try {
    url = checkUrl((JSON.parse(raw) as { url?: unknown }).url)
  } catch {
    /* invalid JSON */
  }
  if (!url) return json(400, { error: 'url' })
  const address = await resolvePublic(url.hostname, deps.resolver)
  if (!address) return json(400, { error: 'url' })

  try {
    const status = await (deps.poster ?? postOneClick)(url, address)
    // RFC 8058 senders answer 2xx; a redirect is not followed, but the request was delivered
    if (status >= 200 && status < 400) return json(200, { ok: true, status })
    return json(502, { error: 'refused', status })
  } catch {
    return json(504, { error: 'unreachable' })
  }
}

export function POST(request: Request): Promise<Response> {
  return handleUnsub(request)
}
