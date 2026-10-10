/**
 * A live mailbox the user connected (Gmail, Outlook, IMAP) or the demo inbox.
 * It reads one sender's messages on demand and applies actions the user
 * confirmed. Tokens and IMAP credentials live only inside these closures,
 * in this tab's memory.
 */
import type { MessageMeta } from './headers'

export type MailAction = 'read' | 'unread' | 'archive' | 'trash' | 'spam'
export type MailKind = 'gmail' | 'outlook' | 'imap' | 'demo'

export interface MailItem {
  id: string
  subject: string
  from: string
  date: number
  unread: boolean
  snippet?: string
}

export interface MailBody {
  subject?: string
  from?: string
  to?: string
  date?: number
  html?: string
  text?: string
}

export interface MailPage {
  items: MailItem[]
  total: number
}

export interface Mailbox {
  kind: MailKind
  /** Newest messages from any of these addresses. */
  list(emails: string[], limit?: number): Promise<MailPage>
  /** Every message id from these addresses (capped), for bulk actions. */
  ids(emails: string[], cap?: number): Promise<string[]>
  body(id: string): Promise<MailBody>
  act(ids: string[], action: MailAction, onProgress?: (done: number) => void): Promise<number>
  /** Send an unsubscribe email (Gmail only). */
  sendMail?(to: string, subject: string, body: string): Promise<void>
  /** Link to the sender in the provider's web app. */
  webUrl?(emails: string[]): string
  /** Get a fresh token after it expired (must run inside a click handler). */
  reauth?(): Promise<void>
}

/** Thrown when the provider rejects the token; the UI offers "Sign in again". */
export class AuthExpired extends Error {
  code = 'expired'
  constructor() {
    super('Sign-in expired')
  }
}

/** An error the UI can translate (relay error codes such as "auth", "folder"). */
export class MailError extends Error {
  constructor(
    public code: string,
    message = code,
  ) {
    super(message)
  }
}

export const BULK_CAP = 5000

export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/** Run `fn` over `items`, `concurrency` at a time. */
export async function pool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < items.length) await fn(items[next++]!)
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
}

/** Parse `mailto:` into address, subject and body (RFC 6068). */
export function parseMailto(href: string): { to: string; subject: string; body: string } | null {
  if (!/^mailto:/i.test(href)) return null
  const [addr, query = ''] = href.slice(7).split('?')
  const to = decodeURIComponent(addr ?? '').split(',')[0]!.trim()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return null
  const params = new URLSearchParams(query)
  return { to, subject: params.get('subject') || 'unsubscribe', body: params.get('body') || 'unsubscribe' }
}

/**
 * Wrap untrusted email HTML for a sandboxed iframe: no scripts (sandbox),
 * no remote images, fonts, frames or forms (own CSP), links open in a new tab.
 */
export function readerDocument(body: MailBody, dark: boolean): string {
  const csp = "default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'; font-src data:; form-action 'none'"
  const base = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><meta name="referrer" content="no-referrer">`
  const theme = dark ? 'color-scheme: light; background:#fff;' : ''
  if (body.html) {
    const html = body.html.replace(/<meta[^>]+http-equiv[^>]*>/gi, '').replace(/<base[^>]*>/gi, '')
    return `<!doctype html><html><head>${base}<style>html{${theme}}body{margin:12px;font:14px/1.5 system-ui,sans-serif;word-wrap:break-word}img{max-width:100%;height:auto}</style></head><body>${html}</body></html>`
  }
  const text = (body.text ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
  const linked = text.replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u.replace(/"/g, '&quot;')}" rel="noreferrer noopener">${u}</a>`)
  return `<!doctype html><html><head>${base}<style>html{${theme}}body{margin:12px;font:14px/1.55 system-ui,sans-serif;white-space:pre-wrap;word-wrap:break-word;color:#1d1d1b}a{color:#b45309}</style></head><body>${linked}</body></html>`
}

/** Remove what an action took away from the loaded headers, so the map updates. */
export function applyToMessages(messages: MessageMeta[], emails: string[], action: MailAction, ids?: Set<string>): MessageMeta[] {
  const from = new Set(emails.map((e) => e.toLowerCase()))
  const hit = (m: MessageMeta) => (ids ? m.id !== undefined && ids.has(m.id) : from.has(m.fromEmail.toLowerCase()))
  if (action === 'archive' || action === 'trash' || action === 'spam') return messages.filter((m) => !hit(m))
  return messages.map((m) => {
    if (!hit(m)) return m
    const rest = m.labels.filter((l) => l !== 'unread' && l !== 'opened')
    return { ...m, labels: [...rest, action === 'read' ? 'opened' : 'unread'] }
  })
}

/** Count a sender's messages, then apply one action to all of them. */
export async function cleanSender(mb: Mailbox, emails: string[], action: MailAction, onProgress?: (done: number, total: number) => void): Promise<number> {
  const ids = await mb.ids(emails)
  if (!ids.length) return 0
  onProgress?.(0, ids.length)
  return mb.act(ids, action, (d) => onProgress?.(d, ids.length))
}

/* ---------- demo mailbox: generated mail, actions simulated in memory ---------- */

const LOREM = [
  'Here is what is new this week, picked for you.',
  'Your weekly summary is ready. Three stories you might like, and one deal that ends tonight.',
  'We thought you would enjoy these. Tap through to see the full selection.',
]

export function demoMailbox(getMessages: () => MessageMeta[]): Mailbox {
  const gone = new Set<string>()
  const read = new Set<string>()
  const itemsFor = (emails: string[]) => {
    const from = new Set(emails)
    return getMessages()
      .map((m, i) => ({ m, id: m.id ?? `demo-${i}` }))
      .filter(({ m, id }) => from.has(m.fromEmail) && !gone.has(id))
      .sort((a, b) => b.m.date - a.m.date)
  }
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  return {
    kind: 'demo',
    async list(emails, limit = 20) {
      await wait(250)
      const all = itemsFor(emails)
      return {
        total: all.length,
        items: all.slice(0, limit).map(({ m, id }, i) => ({
          id,
          subject: m.subject,
          from: m.fromName ? `${m.fromName} <${m.fromEmail}>` : m.fromEmail,
          date: m.date,
          unread: m.labels.includes('unread') && !read.has(id),
          snippet: LOREM[i % LOREM.length],
        })),
      }
    },
    async ids(emails, cap = BULK_CAP) {
      return itemsFor(emails)
        .slice(0, cap)
        .map(({ id }) => id)
    },
    async body(id) {
      await wait(200)
      const all = getMessages()
      const i = all.findIndex((x, k) => (x.id ?? `demo-${k}`) === id)
      const m = all[i]
      if (!m) return { text: '' }
      return {
        subject: m.subject,
        from: m.fromName ? `${m.fromName} <${m.fromEmail}>` : m.fromEmail,
        to: 'you@example.com',
        date: m.date,
        html: `<div style="max-width:560px;margin:auto"><h2 style="font-family:Georgia,serif">${m.subject.replace(/</g, '&lt;')}</h2><p>${LOREM[i % LOREM.length]}</p><p><img src="https://tracker.example/pixel.gif" alt="(remote image blocked)" width="1" height="1">This is a demo message from <b>${(m.fromName || m.fromEmail).replace(/</g, '&lt;')}</b>. Nothing here is real.</p><p><a href="https://example.com/">View in browser</a></p></div>`,
      }
    },
    async act(ids, action, onProgress) {
      let done = 0
      for (const part of chunk(ids, 50)) {
        await wait(120)
        for (const id of part) {
          if (action === 'read') read.add(id)
          else if (action === 'unread') read.delete(id)
          else gone.add(id)
        }
        done += part.length
        onProgress?.(done)
      }
      return done
    },
    async sendMail() {
      await wait(300)
    },
  }
}
