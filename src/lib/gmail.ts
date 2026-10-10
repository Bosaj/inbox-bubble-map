import { metaFromHeaders, type MessageMeta } from './headers'
import { AuthExpired, BULK_CAP, chunk, pool, type MailBody, type Mailbox } from './mailbox'

/**
 * Gmail, entirely in the browser.
 * - Scope: gmail.modify. Headers build the map; a body is fetched only when the
 *   user opens a message, and labels change only after the user confirms.
 *   Nothing is ever permanently deleted (trash stays recoverable).
 * - The token stays in memory; requests go only to Google's API.
 * Needs VITE_GOOGLE_CLIENT_ID (a Web OAuth client with this site's origin).
 */
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify'
const API = 'https://gmail.googleapis.com/gmail/v1/users/me'
const HEADERS = ['From', 'Date', 'Subject', 'List-Unsubscribe', 'List-Unsubscribe-Post', 'List-Id', 'Precedence']

export const gmailClientId: string | undefined = import.meta.env.VITE_GOOGLE_CLIENT_ID || undefined

interface TokenResponse {
  access_token?: string
  error?: string
}

interface TokenClient {
  requestAccessToken: (o?: { prompt?: string }) => void
}

interface GoogleOAuth {
  accounts: { oauth2: { initTokenClient: (cfg: { client_id: string; scope: string; callback: (r: TokenResponse) => void; error_callback?: (e: { type: string }) => void }) => TokenClient } }
}

function loadGis(): Promise<GoogleOAuth> {
  const w = window as unknown as { google?: GoogleOAuth }
  if (w.google?.accounts?.oauth2) return Promise.resolve(w.google)
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => (w.google ? resolve(w.google) : reject(new Error('Google Identity Services failed to load')))
    s.onerror = () => reject(new Error('Could not reach Google Identity Services'))
    document.head.appendChild(s)
  })
}

export async function requestGmailToken(clientId: string, prompt?: string): Promise<string> {
  const google = await loadGis()
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GMAIL_SCOPE,
      callback: (r) => (r.access_token ? resolve(r.access_token) : reject(new Error(r.error ?? 'Access was not granted'))),
      error_callback: (e) => reject(new Error(e.type === 'popup_closed' ? 'Sign-in window was closed' : e.type)),
    })
    client.requestAccessToken(prompt === undefined ? undefined : { prompt })
  })
}

interface GmailPart {
  mimeType?: string
  filename?: string
  headers?: { name: string; value: string }[]
  body?: { data?: string; attachmentId?: string; size?: number }
  parts?: GmailPart[]
}

interface GmailMessage {
  id: string
  labelIds?: string[]
  internalDate?: string
  snippet?: string
  payload?: GmailPart
}

function headerMap(part?: GmailPart): Record<string, string> {
  const h: Record<string, string> = {}
  for (const { name, value } of part?.headers ?? []) {
    const k = name.toLowerCase()
    if (!(k in h)) h[k] = value
  }
  return h
}

/** Map a Gmail API `format=metadata` message to our shape. */
export function metaFromGmail(msg: GmailMessage): MessageMeta {
  const labels = (msg.labelIds ?? []).map((l) => l.toLowerCase())
  const meta = metaFromHeaders(headerMap(msg.payload), labels)
  if (!meta.date && msg.internalDate) meta.date = Number(msg.internalDate)
  meta.id = msg.id
  return meta
}

type Fetch = typeof fetch

/** A Gmail API error with the HTTP status and Google's reason (e.g. "rateLimitExceeded"). */
export class GmailError extends Error {
  code: string
  constructor(
    public status: number,
    public reason: string,
  ) {
    super(`Gmail API ${status}${reason ? ` (${reason})` : ''}`)
    this.code = isRateLimit(status, reason) ? 'gmailRate' : 'generic'
  }
}

const RATE_REASONS = /rateLimitExceeded|userRateLimitExceeded|quotaExceeded|RESOURCE_EXHAUSTED|concurrentLimitExceeded|backendError/i

/** Gmail signals throttling with 429, and also with 403 + a rate-limit reason. */
export function isRateLimit(status: number, reason = ''): boolean {
  return status === 429 || (status === 403 && RATE_REASONS.test(reason))
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Shared throttle state: every request waits for a token; a rate-limit answer pauses everyone. */
export class Throttle {
  private tokens: number
  private last = Date.now()
  private pausedUntil = 0
  private lastPenalty = 0
  constructor(
    public perSecond: number,
    private burst = perSecond,
  ) {
    this.tokens = burst
  }
  /** `urgent` requests (the user clicked something) skip the queue; their cost slows the background import instead. */
  async take(urgent = false): Promise<void> {
    for (;;) {
      const now = Date.now()
      if (now < this.pausedUntil) {
        await sleep(this.pausedUntil - now)
        continue
      }
      this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.perSecond)
      this.last = now
      if (urgent || this.tokens >= 1) {
        this.tokens -= 1
        return
      }
      await sleep(Math.ceil(((1 - this.tokens) / this.perSecond) * 1000))
    }
  }
  /** Back off after a rate-limit answer and slow down for the rest of the run. */
  penalize(ms: number) {
    const now = Date.now()
    this.pausedUntil = Math.max(this.pausedUntil, now + ms)
    // many workers hit the limit at once: slow down once per burst, not once per failed request
    if (now - this.lastPenalty > 2000) this.perSecond = Math.max(5, this.perSecond * 0.75)
    this.lastPenalty = now
    this.tokens = Math.min(this.tokens, 0)
  }
}

async function call<T>(url: string, token: string, f: Fetch, init: RequestInit = {}, throttle?: Throttle, attempt = 0, urgent = false): Promise<T> {
  await throttle?.take(urgent)
  const res = await f(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers } })
  if (res.status === 401) throw new AuthExpired()
  if (res.ok) {
    const text = await res.text()
    return (text ? JSON.parse(text) : {}) as T
  }
  let reason = ''
  try {
    const body = (await res.json()) as { error?: { status?: string; errors?: { reason?: string }[] } }
    reason = body.error?.errors?.[0]?.reason ?? body.error?.status ?? ''
  } catch {
    /* no JSON body */
  }
  const retryable = isRateLimit(res.status, reason) || res.status >= 500
  if (retryable && attempt < 6) {
    const wait = (Number(res.headers.get('retry-after')) || 0) * 1000 || Math.min(16_000, 500 * 2 ** attempt) + Math.random() * 400
    if (throttle) throttle.penalize(wait)
    else await sleep(wait)
    return call(url, token, f, init, throttle, attempt + 1, urgent)
  }
  throw new GmailError(res.status, reason)
}

export interface FetchProgress {
  done: number
  total: number
}

/**
 * Fetch metadata for the newest `limit` messages.
 * Gmail allows about 50 message reads per second per user, so requests are
 * paced (default 40/s), and a rate-limit answer pauses and slows every worker.
 * `onChunk` streams results so the map can appear before everything arrived.
 * A message that keeps failing is skipped instead of failing the whole import.
 */
export async function fetchGmailMetadata(
  token: string,
  {
    limit = 2000,
    concurrency = 12,
    perSecond = 30,
    throttle: shared,
    onProgress,
    onChunk,
    chunkEvery = 1500,
    signal,
    fetchImpl = fetch,
  }: {
    limit?: number
    concurrency?: number
    perSecond?: number
    /** Share one throttle with the mailbox so clicks during an import stay under Gmail's limit. */
    throttle?: Throttle
    onProgress?: (p: FetchProgress) => void
    onChunk?: (msgs: MessageMeta[], p: FetchProgress) => void
    chunkEvery?: number
    signal?: AbortSignal
    fetchImpl?: Fetch
  } = {},
): Promise<MessageMeta[]> {
  const throttle = shared ?? new Throttle(perSecond)
  const ids: string[] = []
  let pageToken: string | undefined
  do {
    const url = new URL(`${API}/messages`)
    url.searchParams.set('maxResults', String(Math.min(500, limit - ids.length)))
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const page = await call<{ messages?: { id: string }[]; nextPageToken?: string }>(url.toString(), token, fetchImpl, {}, throttle)
    for (const m of page.messages ?? []) ids.push(m.id)
    pageToken = page.nextPageToken
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  } while (pageToken && ids.length < limit)

  const out: MessageMeta[] = []
  let pending: MessageMeta[] = []
  let lastChunk = Date.now()
  let done = 0
  let failed = 0
  let lastError: unknown = null
  const qs = HEADERS.map((h) => `metadataHeaders=${encodeURIComponent(h)}`).join('&')
  let flushed = false
  /** First chunk after 200 messages (the map appears), then at most every `chunkEvery` ms. */
  const flush = (final = false) => {
    if (!onChunk || !pending.length) return
    if (!final && (flushed ? Date.now() - lastChunk < chunkEvery : pending.length < 200)) return
    flushed = true
    onChunk(pending, { done, total: ids.length })
    pending = []
    lastChunk = Date.now()
  }
  await pool(ids, concurrency, async (id) => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    try {
      const msg = await call<GmailMessage>(`${API}/messages/${id}?format=metadata&${qs}`, token, fetchImpl, {}, throttle)
      const meta = metaFromGmail(msg)
      if (meta.fromEmail.includes('@')) {
        out.push(meta)
        pending.push(meta)
      }
    } catch (err) {
      if (err instanceof AuthExpired) throw err
      failed++
      lastError = err
      // nothing works at all (wrong scope, API off): stop instead of skipping everything
      if (failed >= 20 && failed > done / 2) throw err
    }
    done++
    onProgress?.({ done, total: ids.length })
    flush()
  })
  flush(true)
  if (!out.length && lastError) throw lastError
  return out
}

/* ---------- reading and acting ---------- */

export function fromQuery(emails: string[]): string {
  return `from:(${emails.map((e) => e.replace(/[()"\s]/g, '')).join(' OR ')})`
}

function decodeB64Url(data: string): Uint8Array {
  const bin = atob(data.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

function decodeText(bytes: Uint8Array, contentType = ''): string {
  const charset = /charset="?([^";\s]+)"?/i.exec(contentType)?.[1]?.toLowerCase() ?? 'utf-8'
  try {
    return new TextDecoder(charset).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

/** First text/html and text/plain parts that are not attachments. */
export function findBodies(part: GmailPart | undefined, found: { html?: GmailPart; text?: GmailPart } = {}): { html?: GmailPart; text?: GmailPart } {
  if (!part) return found
  const type = (part.mimeType ?? '').toLowerCase()
  if (!part.filename) {
    if (type === 'text/html' && !found.html) found.html = part
    else if (type === 'text/plain' && !found.text) found.text = part
  }
  for (const p of part.parts ?? []) findBodies(p, found)
  return found
}

function base64UrlUtf8(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function gmailMailbox(initialToken: string, clientId: string, fetchImpl: Fetch = fetch, throttle: Throttle = new Throttle(30)): Mailbox {
  let token = initialToken
  const api = <T,>(path: string, init?: RequestInit) => call<T>(`${API}${path}`, token, fetchImpl, init, throttle, 0, true)

  const partText = async (id: string, part: GmailPart): Promise<string> => {
    let data = part.body?.data
    if (!data && part.body?.attachmentId) data = (await api<{ data?: string }>(`/messages/${id}/attachments/${part.body.attachmentId}`)).data
    return data ? decodeText(decodeB64Url(data), headerMap(part)['content-type']) : ''
  }

  const box: Mailbox = {
    kind: 'gmail',
    async list(emails, limit = 20) {
      const page = await api<{ messages?: { id: string }[]; resultSizeEstimate?: number }>(`/messages?maxResults=${limit}&q=${encodeURIComponent(fromQuery(emails))}`)
      const ids = (page.messages ?? []).map((m) => m.id)
      const items = await Promise.all(
        ids.map(async (id) => {
          const m = await api<GmailMessage>(`/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`)
          const h = headerMap(m.payload)
          return { id, subject: h['subject'] ?? '', from: h['from'] ?? '', date: Number(m.internalDate) || Date.parse(h['date'] ?? '') || 0, unread: (m.labelIds ?? []).includes('UNREAD'), snippet: m.snippet }
        }),
      )
      return { items, total: Math.max(items.length, page.resultSizeEstimate ?? 0) }
    },
    async ids(emails, cap = BULK_CAP) {
      const out: string[] = []
      let pageToken: string | undefined
      do {
        const page: { messages?: { id: string }[]; nextPageToken?: string } = await api(`/messages?maxResults=500&q=${encodeURIComponent(fromQuery(emails))}${pageToken ? `&pageToken=${pageToken}` : ''}`)
        for (const m of page.messages ?? []) out.push(m.id)
        pageToken = page.nextPageToken
      } while (pageToken && out.length < cap)
      return out.slice(0, cap)
    },
    async body(id): Promise<MailBody> {
      const m = await api<GmailMessage>(`/messages/${id}?format=full`)
      const h = headerMap(m.payload)
      const { html, text } = findBodies(m.payload)
      return {
        subject: h['subject'],
        from: h['from'],
        to: h['to'],
        date: Number(m.internalDate) || undefined,
        html: html ? await partText(id, html) : undefined,
        text: text ? await partText(id, text) : undefined,
      }
    },
    async act(ids, action, onProgress) {
      let done = 0
      if (action === 'trash') {
        // messages.trash is the documented way to trash; it stays recoverable for 30 days
        await pool(ids, 6, async (id) => {
          await api(`/messages/${id}/trash`, { method: 'POST' })
          onProgress?.(++done)
        })
        return done
      }
      const change = {
        read: { removeLabelIds: ['UNREAD'] },
        unread: { addLabelIds: ['UNREAD'] },
        archive: { removeLabelIds: ['INBOX'] },
        spam: { addLabelIds: ['SPAM'], removeLabelIds: ['INBOX'] },
      }[action]
      for (const part of chunk(ids, 1000)) {
        await api('/messages/batchModify', { method: 'POST', body: JSON.stringify({ ids: part, ...change }) })
        done += part.length
        onProgress?.(done)
      }
      return done
    },
    async sendMail(to, subject, body) {
      const raw = [`To: ${to}`, `Subject: =?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(subject)))}?=`, 'Content-Type: text/plain; charset=UTF-8', 'MIME-Version: 1.0', '', body].join('\r\n')
      await api('/messages/send', { method: 'POST', body: JSON.stringify({ raw: base64UrlUtf8(raw) }) })
    },
    webUrl(emails) {
      return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(fromQuery(emails))}`
    },
    async reauth() {
      token = await requestGmailToken(clientId, '')
    },
  }
  return box
}
