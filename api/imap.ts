/**
 * IMAP header relay (Vercel Function, Node runtime).
 *
 * Browsers cannot open IMAP connections, so this function does it for one
 * request: connect over TLS, read the newest N messages' *headers* (never
 * bodies), return them, disconnect. Credentials and mail data are never
 * stored or logged.
 *
 * Abuse guards: only port 993 with TLS, public hostnames only (DNS checked,
 * private / loopback / link-local ranges refused, connection pinned to the
 * checked address), same-origin requests only, small body, per-IP rate limit
 * and a lockout after repeated login failures.
 */
import { ImapFlow } from 'imapflow'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export const HEADER_FIELDS = ['from', 'date', 'subject', 'list-unsubscribe', 'list-unsubscribe-post', 'list-id', 'precedence']
const MAX_BODY = 4096
const MAX_LIMIT = 5000

export interface RelayRequest {
  host: string
  email: string
  password: string
  limit?: number
  mailbox?: string
}

export interface RelayMessage {
  h: string // raw header block (only the fields above)
  seen: boolean
  date?: number
}

/* ---------- validation ---------- */

const HOSTNAME = /^(?=.{4,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i

export function validate(body: unknown): RelayRequest | string {
  if (!body || typeof body !== 'object') return 'Invalid request'
  const b = body as Record<string, unknown>
  const host = typeof b.host === 'string' ? b.host.trim().toLowerCase() : ''
  const email = typeof b.email === 'string' ? b.email.trim() : ''
  const password = typeof b.password === 'string' ? b.password : ''
  const limit = b.limit === undefined ? 2000 : Number(b.limit)
  const mailbox = typeof b.mailbox === 'string' && b.mailbox.trim() ? b.mailbox.trim() : 'INBOX'
  if (!HOSTNAME.test(host) || isIP(host)) return 'Enter a valid IMAP server name'
  if (!email || email.length > 254) return 'Enter your email address'
  if (!password || password.length > 256) return 'Enter your app password'
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return `Messages must be between 1 and ${MAX_LIMIT}`
  if (mailbox.length > 200 || /[\r\n\0]/.test(mailbox)) return 'Invalid mailbox name'
  return { host, email, password, limit, mailbox }
}

/** True for addresses a public IMAP server can't have (SSRF guard). */
export function isPrivateAddress(addr: string): boolean {
  if (isIP(addr) === 4) {
    const [a, b] = addr.split('.').map(Number) as [number, number]
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    )
  }
  const v6 = addr.toLowerCase()
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7))
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb') || v6.startsWith('ff')
}

type Resolver = (host: string) => Promise<{ address: string; family: number }[]>
const defaultResolver: Resolver = (host) => lookup(host, { all: true, verbatim: true })

export async function resolvePublic(host: string, resolve: Resolver = defaultResolver): Promise<string | null> {
  try {
    const addrs = await resolve(host)
    if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) return null
    return addrs[0]!.address
  } catch {
    return null
  }
}

/* ---------- rate limiting (per warm instance; Vercel Firewall adds a global rule) ---------- */

const hits = new Map<string, number[]>()
const failures = new Map<string, number[]>()
const WINDOW = 10 * 60_000

function recent(map: Map<string, number[]>, key: string, now: number): number[] {
  const list = (map.get(key) ?? []).filter((t) => now - t < WINDOW)
  map.set(key, list)
  return list
}

export function allow(ip: string, now = Date.now()): boolean {
  if (recent(failures, ip, now).length >= 3) return false
  const list = recent(hits, ip, now)
  if (list.length >= 8) return false
  list.push(now)
  return true
}

function noteFailure(ip: string, now = Date.now()) {
  recent(failures, ip, now).push(now)
}

/* ---------- IMAP ---------- */

export interface Fetcher {
  (req: RelayRequest, address: string): Promise<{ messages: RelayMessage[]; total: number }>
}

export const imapFetch: Fetcher = async (req, address) => {
  const client = new ImapFlow({
    host: address, // pinned to the address we checked
    servername: req.host, // SNI + certificate check against the real name
    port: 993,
    secure: true,
    auth: { user: req.email, pass: req.password },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 12_000,
    greetingTimeout: 12_000,
    socketTimeout: 40_000,
    clientInfo: { name: 'Inbox Bubble Map' },
  })
  await client.connect()
  try {
    const box = await client.mailboxOpen(req.mailbox ?? 'INBOX', { readOnly: true })
    const total = box.exists
    const messages: RelayMessage[] = []
    if (total > 0) {
      const start = Math.max(1, total - (req.limit ?? 2000) + 1)
      for await (const msg of client.fetch(`${start}:*`, { flags: true, internalDate: true, headers: HEADER_FIELDS })) {
        messages.push({
          h: msg.headers ? msg.headers.toString('utf8') : '',
          seen: msg.flags?.has('\\Seen') ?? false,
          date: msg.internalDate ? new Date(msg.internalDate).getTime() : undefined,
        })
      }
    }
    return { messages, total }
  } finally {
    await client.logout().catch(() => client.close())
  }
}

/* ---------- HTTP ---------- */

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  })

export async function handle(request: Request, deps: { fetcher?: Fetcher; resolver?: Resolver } = {}): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'method' })
  const origin = request.headers.get('origin')
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  let originHost = ''
  try {
    originHost = origin ? new URL(origin).host : ''
  } catch {
    /* "null" or malformed origin */
  }
  if (!originHost || !host || originHost !== host) return json(403, { error: 'origin', message: 'Requests must come from the app itself.' })
  const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0]!.trim() || 'unknown'
  if (!allow(ip)) return json(429, { error: 'rate', message: 'Too many attempts. Wait 10 minutes and try again.' })

  const raw = await request.text()
  if (raw.length > MAX_BODY) return json(413, { error: 'size' })
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return json(400, { error: 'invalid', message: 'Invalid request' })
  }
  const req = validate(body)
  if (typeof req === 'string') return json(400, { error: 'invalid', message: req })

  const address = await resolvePublic(req.host, deps.resolver)
  if (!address) return json(400, { error: 'host', message: `Can't reach a public mail server at ${req.host}.` })

  try {
    const { messages, total } = await (deps.fetcher ?? imapFetch)(req, address)
    return json(200, { messages, total, mailbox: req.mailbox })
  } catch (err) {
    const e = err as { authenticationFailed?: boolean; responseText?: string; code?: string; message?: string }
    if (e.authenticationFailed || /auth|login|credential|password/i.test(e.responseText ?? '')) {
      noteFailure(ip)
      return json(401, { error: 'auth', message: 'The server refused the login. Check the address and use an app password, not your normal password.' })
    }
    if (/mailbox|nonexistent|not found/i.test(e.responseText ?? e.message ?? '')) return json(404, { error: 'mailbox', message: `Mailbox "${req.mailbox}" was not found.` })
    return json(502, { error: 'connect', message: `Couldn't talk to ${req.host}. Check the server name and try again.` })
  }
}

export function POST(request: Request): Promise<Response> {
  return handle(request)
}
