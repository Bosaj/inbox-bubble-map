/**
 * GET /api/logo?d=example.com: company icon proxy.
 *
 * The browser only ever talks to this site, so the list of who emails you is
 * never revealed to an icon service tied to your IP. Icons come from fixed,
 * public icon services (no fetch to the sender's own server, so no SSRF), are
 * size-limited, type-checked and cached at the CDN for 30 days.
 */
import { isPublicHostname } from './_lib/net.js'

const MAX_BYTES = 200_000
const SOURCES = [(d: string) => `https://icons.duckduckgo.com/ip3/${d}.ico`, (d: string) => `https://www.google.com/s2/favicons?domain=${d}&sz=128`]
const IMAGE = /^image\/(png|x-icon|vnd\.microsoft\.icon|svg\+xml|jpeg|webp|gif)/

type Fetch = typeof fetch

export function cleanDomain(raw: string | null): string | null {
  if (!raw) return null
  const d = raw.trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '')
  return isPublicHostname(d) && d.length <= 120 ? d : null
}

async function tryFetch(url: string, f: Fetch): Promise<{ body: ArrayBuffer; type: string } | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 4000)
  try {
    const res = await f(url, { signal: ctrl.signal, redirect: 'follow' })
    const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim()
    if (!res.ok || !IMAGE.test(type)) return null
    const body = await res.arrayBuffer()
    // Google answers unknown domains with a tiny default globe; skip images that small
    if (body.byteLength < 120 || body.byteLength > MAX_BYTES) return null
    return { body, type }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function handleLogo(request: Request, f: Fetch = fetch): Promise<Response> {
  const domain = cleanDomain(new URL(request.url).searchParams.get('d'))
  if (!domain) return new Response('Bad domain', { status: 400, headers: { 'cache-control': 'public, max-age=86400' } })
  for (const source of SOURCES) {
    const hit = await tryFetch(source(domain), f)
    if (hit) {
      return new Response(hit.body, {
        headers: {
          'content-type': hit.type,
          'cache-control': 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800',
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        },
      })
    }
  }
  // negative result is cached too, so unknown senders don't hit the sources again
  return new Response(null, { status: 404, headers: { 'cache-control': 'public, max-age=86400, s-maxage=604800' } })
}

export function GET(request: Request): Promise<Response> {
  return handleLogo(request)
}
