/**
 * IMAP relay (Vercel Function, Node runtime).
 *
 * Browsers cannot open IMAP connections, so this function does it for one
 * request at a time: connect over TLS, do one thing, disconnect.
 *
 *   headers  read the newest N messages' headers (builds the map)
 *   list     newest messages from given senders (subject, date, read state)
 *   ids      every message uid from given senders, for a confirmed bulk action
 *   body     one message, parsed (only when the user opens it)
 *   act      mark read/unread, or move to the special-use Archive/Trash/Junk
 *
 * Credentials and mail data are never stored or logged. Nothing is ever
 * expunged: "trash" moves mail to the provider's Trash folder.
 *
 * Abuse guards: only port 993 with TLS, public hostnames only (DNS checked,
 * private / loopback / link-local ranges refused, connection pinned to the
 * checked address), same-origin requests only, small body, per-IP rate limits
 * and a lockout after repeated login failures.
 */
import { ImapFlow, type ListResponse } from 'imapflow'
import PostalMime from 'postal-mime'
import { isIP } from 'node:net'
import { HOSTNAME, isPrivateAddress, resolvePublic, type Resolver } from './_lib/net.js'

export { isPrivateAddress, resolvePublic }

export const HEADER_FIELDS = ['from', 'date', 'subject', 'list-unsubscribe', 'list-unsubscribe-post', 'list-id', 'precedence']
const MAX_BODY = 64 * 1024
const MAX_LIMIT = 5000
const MAX_SOURCE = 4_000_000
const EMAIL = /^[^@\s,()"<>\\]{1,64}@[^@\s,()"<>\\]{1,190}$/

export type Action = 'headers' | 'list' | 'ids' | 'body' | 'act'
export type Op = 'read' | 'unread' | 'archive' | 'trash' | 'spam'
const ACTIONS: Action[] = ['headers', 'list', 'ids', 'body', 'act']
const OPS: Op[] = ['read', 'unread', 'archive', 'trash', 'spam']

export interface RelayRequest {
  host: string
  email: string
  password: string
  limit?: number
  mailbox?: string
  action?: Action
  emails?: string[]
  uid?: number
  uids?: number[]
  op?: Op
}

export interface RelayMessage {
  h: string // raw header block (only the fields above)
  seen: boolean
  date?: number
  uid?: number
}

/* ---------- validation ---------- */

export function validate(body: unknown): RelayRequest | string {
  if (!body || typeof body !== 'object') return 'Invalid request'
  const b = body as Record<string, unknown>
  const host = typeof b.host === 'string' ? b.host.trim().toLowerCase() : ''
  const email = typeof b.email === 'string' ? b.email.trim() : ''
  const password = typeof b.password === 'string' ? b.password : ''
  const action = (b.action ?? 'headers') as Action
  const limit = b.limit === undefined ? (action === 'list' ? 20 : 2000) : Number(b.limit)
  const mailbox = typeof b.mailbox === 'string' && b.mailbox.trim() ? b.mailbox.trim() : 'INBOX'
  if (!HOSTNAME.test(host) || isIP(host)) return 'Enter a valid IMAP server name'
  if (!email || email.length > 254) return 'Enter your email address'
  if (!password || password.length > 256) return 'Enter your app password'
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return `Messages must be between 1 and ${MAX_LIMIT}`
  if (mailbox.length > 200 || /[\r\n\0]/.test(mailbox)) return 'Invalid mailbox name'
  if (!ACTIONS.includes(action)) return 'Unknown action'
  const req: RelayRequest = { host, email, password, limit, mailbox, action }

  if (action === 'list' || action === 'ids') {
    const emails = Array.isArray(b.emails) ? b.emails.filter((e): e is string => typeof e === 'string').map((e) => e.trim().toLowerCase()) : []
    if (!emails.length || emails.length > 20 || !emails.every((e) => EMAIL.test(e))) return 'Invalid sender list'
    req.emails = emails
  }
  if (action === 'body') {
    const uid = Number(b.uid)
    if (!Number.isInteger(uid) || uid < 1) return 'Invalid message id'
    req.uid = uid
  }
  if (action === 'act') {
    const uids = Array.isArray(b.uids) ? b.uids.map(Number) : []
    if (!uids.length || uids.length > 1000 || !uids.every((u) => Number.isInteger(u) && u > 0)) return 'Invalid message ids'
    if (!OPS.includes(b.op as Op)) return 'Unknown operation'
    req.uids = uids
    req.op = b.op as Op
  }
  return req
}

/* ---------- rate limiting (per warm instance; Vercel Firewall adds a global rule) ---------- */

const hits = new Map<string, number[]>()
const actionHits = new Map<string, number[]>()
const failures = new Map<string, number[]>()
const WINDOW = 10 * 60_000

function recent(map: Map<string, number[]>, key: string, now: number): number[] {
  const list = (map.get(key) ?? []).filter((t) => now - t < WINDOW)
  map.set(key, list)
  return list
}

/** Full mailbox reads: 8 per 10 minutes. */
export function allow(ip: string, now = Date.now()): boolean {
  if (recent(failures, ip, now).length >= 3) return false
  const list = recent(hits, ip, now)
  if (list.length >= 8) return false
  list.push(now)
  return true
}

/** Opening and acting on messages: 150 per 10 minutes. */
export function allowAction(ip: string, now = Date.now()): boolean {
  if (recent(failures, ip, now).length >= 3) return false
  const list = recent(actionHits, ip, now)
  if (list.length >= 150) return false
  list.push(now)
  return true
}

function noteFailure(ip: string, now = Date.now()) {
  recent(failures, ip, now).push(now)
}

/* ---------- IMAP ---------- */

export interface Fetcher {
  (req: RelayRequest, address: string): Promise<Record<string, unknown>>
}

class FolderMissing extends Error {}

const FOLDER_NAMES: Record<'archive' | 'trash' | 'spam', { use: string[]; names: RegExp; create?: string }> = {
  archive: { use: ['\\Archive', '\\All'], names: /^(archives?|archiv|archivio|archivo)$/i, create: 'Archive' },
  trash: { use: ['\\Trash'], names: /^(trash|deleted( items| messages)?|bin|corbeille|papierkorb|papelera)$/i, create: 'Trash' },
  spam: { use: ['\\Junk'], names: /^(junk|spam|junk e-?mail|bulk mail|courrier indésirable)$/i },
}

/** Find the special-use folder for an action (RFC 6154), by flag first, then by common names. */
export function pickFolder(folders: Pick<ListResponse, 'path' | 'name' | 'specialUse'>[], op: 'archive' | 'trash' | 'spam'): string | null {
  const spec = FOLDER_NAMES[op]
  for (const use of spec.use) {
    const hit = folders.find((f) => f.specialUse === use)
    if (hit) return hit.path
  }
  return folders.find((f) => spec.names.test(f.name) || spec.names.test(f.path))?.path ?? null
}

function search(emails: string[]) {
  return emails.length === 1 ? { from: emails[0] } : { or: emails.map((from) => ({ from })) }
}

const addr = (a?: { name?: string; address?: string }) => (a?.address ? (a.name ? `${a.name} <${a.address}>` : a.address) : '')

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
  return runImap(client, req)
}

/** Connect, run one relay action, always log out. Exported so tests can point it at a local server. */
export async function runImap(client: ImapFlow, req: RelayRequest): Promise<Record<string, unknown>> {
  await client.connect()
  try {
    const action = req.action ?? 'headers'
    const mailbox = req.mailbox ?? 'INBOX'

    if (action === 'headers') {
      const box = await client.mailboxOpen(mailbox, { readOnly: true })
      const total = box.exists
      const messages: RelayMessage[] = []
      if (total > 0) {
        const start = Math.max(1, total - (req.limit ?? 2000) + 1)
        for await (const msg of client.fetch(`${start}:*`, { uid: true, flags: true, internalDate: true, headers: HEADER_FIELDS })) {
          messages.push({
            h: msg.headers ? msg.headers.toString('utf8') : '',
            seen: msg.flags?.has('\\Seen') ?? false,
            date: msg.internalDate ? new Date(msg.internalDate).getTime() : undefined,
            uid: msg.uid,
          })
        }
      }
      return { messages, total }
    }

    if (action === 'list' || action === 'ids') {
      await client.mailboxOpen(mailbox, { readOnly: true })
      const found = (await client.search(search(req.emails!), { uid: true })) || []
      const uids = [...found].sort((a, b) => b - a)
      if (action === 'ids') return { ids: uids.slice(0, req.limit).map(String) }
      const page = uids.slice(0, req.limit ?? 20)
      const items: { id: string; subject: string; from: string; date: number; unread: boolean }[] = []
      if (page.length) {
        for await (const msg of client.fetch(page.join(','), { uid: true, flags: true, internalDate: true, envelope: true }, { uid: true })) {
          items.push({
            id: String(msg.uid),
            subject: msg.envelope?.subject ?? '',
            from: addr(msg.envelope?.from?.[0]),
            date: msg.internalDate ? new Date(msg.internalDate).getTime() : 0,
            unread: !(msg.flags?.has('\\Seen') ?? false),
          })
        }
      }
      items.sort((a, b) => b.date - a.date)
      return { items, total: uids.length }
    }

    if (action === 'body') {
      await client.mailboxOpen(mailbox, { readOnly: true })
      const msg = await client.fetchOne(String(req.uid), { uid: true, source: { maxLength: MAX_SOURCE }, internalDate: true }, { uid: true })
      if (!msg || !msg.source) throw Object.assign(new Error('Message not found'), { responseText: 'not found' })
      const mail = await PostalMime.parse(msg.source)
      return {
        subject: mail.subject,
        from: addr(mail.from as { name?: string; address?: string }),
        to: (mail.to ?? []).map((t) => addr(t as { name?: string; address?: string })).join(', '),
        date: msg.internalDate ? new Date(msg.internalDate).getTime() : mail.date ? Date.parse(mail.date) : undefined,
        html: mail.html?.slice(0, 1_500_000),
        text: mail.text?.slice(0, 500_000),
      }
    }

    // act
    await client.mailboxOpen(mailbox)
    const range = req.uids!.join(',')
    const op = req.op!
    if (op === 'read' || op === 'unread') {
      if (op === 'read') await client.messageFlagsAdd(range, ['\\Seen'], { uid: true })
      else await client.messageFlagsRemove(range, ['\\Seen'], { uid: true })
      return { done: req.uids!.length }
    }
    const folders = await client.list()
    const current = folders.find((f) => f.path === mailbox)
    if (op === 'archive' && current?.specialUse === '\\All') {
      // Gmail's All Mail: archiving means dropping the Inbox label
      await client.messageFlagsRemove(range, ['\\Inbox'], { uid: true, useLabels: true })
      return { done: req.uids!.length }
    }
    let target = pickFolder(folders, op)
    if (!target) {
      const create = FOLDER_NAMES[op].create
      if (!create) throw new FolderMissing(op)
      await client.mailboxCreate(create).catch(() => undefined)
      target = create
    }
    if (target === mailbox) return { done: 0 }
    await client.messageMove(range, target, { uid: true })
    return { done: req.uids!.length, folder: target }
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
  const allowed = req.action === 'headers' ? allow(ip) : allowAction(ip)
  if (!allowed) return json(429, { error: 'rate', message: 'Too many attempts. Wait 10 minutes and try again.' })

  const address = await resolvePublic(req.host, deps.resolver)
  if (!address) return json(400, { error: 'host', message: `Can't reach a public mail server at ${req.host}.` })

  try {
    const result = await (deps.fetcher ?? imapFetch)(req, address)
    return json(200, req.action === 'headers' ? { ...result, mailbox: req.mailbox } : result)
  } catch (err) {
    if (err instanceof FolderMissing) return json(404, { error: 'folder', message: 'This account has no folder for that action.' })
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
