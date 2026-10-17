import { metaFromHeaders, type MessageMeta } from './headers'
import type { FetchProgress } from './gmail'
import { AuthExpired, BULK_CAP, chunk, type MailAction, type Mailbox } from './mailbox'

/**
 * Outlook / Hotmail / Microsoft 365, entirely in the browser.
 * - MSAL popup sign-in, loaded only when the user clicks.
 * - Delegated scope Mail.ReadWrite: headers build the map, a body is read only
 *   when the user opens a message, and mail moves only after a confirmation.
 * Needs VITE_MS_CLIENT_ID (an Entra ID "Single-page application" registration
 * whose redirect URI is <origin>/redirect.html).
 */
export const msClientId: string | undefined = import.meta.env.VITE_MS_CLIENT_ID || undefined
export const MS_SCOPES = ['Mail.ReadWrite']
const ME = 'https://graph.microsoft.com/v1.0/me'
const GRAPH = `${ME}/messages`

export type TokenSource = () => Promise<string>

export interface OutlookSession {
  token: string
  getToken: TokenSource
  email: string
  name?: string
}

type Pca = Awaited<ReturnType<typeof import('@azure/msal-browser').createStandardPublicClientApplication>>
let pcaPromise: Promise<Pca> | null = null

/** One MSAL instance; its cache lives in localStorage so the sign-in survives reloads. */
function getPca(clientId: string): Promise<Pca> {
  pcaPromise ??= import('@azure/msal-browser').then(({ createStandardPublicClientApplication }) =>
    createStandardPublicClientApplication({
      auth: { clientId, authority: 'https://login.microsoftonline.com/common', redirectUri: `${location.origin}/redirect.html` },
      cache: { cacheLocation: 'localStorage' },
    }),
  )
  return pcaPromise
}

function sessionFor(pca: Pca, account: NonNullable<ReturnType<Pca['getAllAccounts']>[number]>, token: string): OutlookSession {
  const getToken: TokenSource = async () => {
    try {
      return (await pca.acquireTokenSilent({ scopes: MS_SCOPES, account })).accessToken
    } catch {
      throw new AuthExpired()
    }
  }
  return { token, getToken, email: account.username, name: account.name || undefined }
}

/** Silent resume from MSAL's cache (no popup), or null when a sign-in is needed. */
export async function resumeOutlook(clientId: string): Promise<OutlookSession | null> {
  const pca = await getPca(clientId)
  const account = pca.getAllAccounts()[0]
  if (!account) return null
  try {
    const token = (await pca.acquireTokenSilent({ scopes: MS_SCOPES, account })).accessToken
    return sessionFor(pca, account, token)
  } catch {
    return null
  }
}

/** Sign in with a popup (or silently when MSAL still has a session). */
export async function requestOutlookToken(clientId: string): Promise<OutlookSession> {
  const resumed = await resumeOutlook(clientId)
  if (resumed) return resumed
  const pca = await getPca(clientId)
  const result = await pca.loginPopup({ scopes: MS_SCOPES, prompt: 'select_account' })
  if (!result.account) throw new AuthExpired()
  return sessionFor(pca, result.account, result.accessToken)
}

/** Forget the Microsoft session in this browser (MSAL cache). */
export async function outlookLogout(clientId: string): Promise<void> {
  const pca = await getPca(clientId)
  await pca.clearCache().catch(() => undefined)
}

interface GraphMessage {
  id?: string
  subject?: string
  receivedDateTime?: string
  isRead?: boolean
  bodyPreview?: string
  inferenceClassification?: 'focused' | 'other'
  from?: { emailAddress?: { name?: string; address?: string } }
  toRecipients?: { emailAddress?: { name?: string; address?: string } }[]
  internetMessageHeaders?: { name: string; value: string }[]
  body?: { contentType?: 'html' | 'text'; content?: string }
}

/** Map a Graph message to our shape. */
export function metaFromGraph(m: GraphMessage): MessageMeta | null {
  const address = m.from?.emailAddress?.address
  if (!address) return null
  const h: Record<string, string> = {}
  for (const { name, value } of m.internetMessageHeaders ?? []) {
    const k = name.toLowerCase()
    if (!(k in h)) h[k] = value
  }
  const name = m.from?.emailAddress?.name
  h['from'] = name && name !== address ? `"${name.replace(/"/g, '')}" <${address}>` : address
  if (m.subject !== undefined) h['subject'] = m.subject
  if (m.receivedDateTime) h['date'] = new Date(m.receivedDateTime).toUTCString()
  const labels = [m.isRead ? 'opened' : 'unread']
  // Outlook's "Other" tab is where bulk and automated mail lands
  if (m.inferenceClassification === 'other') labels.push('category updates')
  const meta = metaFromHeaders(h, labels)
  if (m.id) meta.id = m.id
  return meta
}

type Fetch = typeof fetch

async function call<T>(url: string, token: string, f: Fetch, init: RequestInit = {}, attempt = 0): Promise<T> {
  const res = await f(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers } })
  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    const retry = Number(res.headers.get('retry-after')) || 2 ** attempt
    await new Promise((r) => setTimeout(r, retry * 400))
    return call(url, token, f, init, attempt + 1)
  }
  if (res.status === 401) throw new AuthExpired()
  if (!res.ok) throw Object.assign(new Error(`Microsoft Graph ${res.status}`), { status: res.status })
  const text = await res.text()
  return (text ? JSON.parse(text) : {}) as T
}

/** Newest `limit` messages across the mailbox. Retries without headers if the tenant refuses them. */
export async function fetchOutlookMetadata(
  token: string,
  { limit = 2000, onProgress, fetchImpl = fetch }: { limit?: number; onProgress?: (p: FetchProgress) => void; fetchImpl?: Fetch } = {},
): Promise<MessageMeta[]> {
  const fields = ['id', 'from', 'subject', 'receivedDateTime', 'isRead', 'inferenceClassification']
  let withHeaders = true
  const out: MessageMeta[] = []
  const firstUrl = (headers: boolean) => {
    const u = new URL(GRAPH)
    u.searchParams.set('$top', String(Math.min(250, limit)))
    u.searchParams.set('$select', (headers ? [...fields, 'internetMessageHeaders'] : fields).join(','))
    u.searchParams.set('$orderby', 'receivedDateTime desc')
    return u.toString()
  }
  let url: string | undefined = firstUrl(true)
  while (url && out.length < limit) {
    let page: { value?: GraphMessage[]; '@odata.nextLink'?: string }
    try {
      page = await call(url, token, fetchImpl)
    } catch (err) {
      if (withHeaders && out.length === 0 && [400, 403].includes((err as { status?: number }).status ?? 0)) {
        withHeaders = false
        url = firstUrl(false)
        continue
      }
      throw err
    }
    for (const m of page.value ?? []) {
      const meta = metaFromGraph(m)
      if (meta) out.push(meta)
      if (out.length >= limit) break
    }
    onProgress?.({ done: out.length, total: limit })
    url = page['@odata.nextLink']
  }
  return out
}

/* ---------- reading and acting ---------- */

export function fromFilter(emails: string[]): string {
  return emails.map((e) => `from/emailAddress/address eq '${e.replace(/'/g, "''")}'`).join(' or ')
}

const fmtAddr = (a?: { name?: string; address?: string }) => (a?.address ? (a.name && a.name !== a.address ? `${a.name} <${a.address}>` : a.address) : '')

/** Graph JSON batching: up to 20 requests per call. */
function batchRequests(ids: string[], action: MailAction) {
  return ids.map((id, i) =>
    action === 'read' || action === 'unread'
      ? { id: String(i), method: 'PATCH', url: `/me/messages/${id}`, headers: { 'content-type': 'application/json' }, body: { isRead: action === 'read' } }
      : { id: String(i), method: 'POST', url: `/me/messages/${id}/move`, headers: { 'content-type': 'application/json' }, body: { destinationId: { archive: 'archive', trash: 'deleteditems', spam: 'junkemail' }[action] } },
  )
}

export function outlookMailbox(getToken: TokenSource, fetchImpl: Fetch = fetch): Mailbox {
  const api = async <T,>(url: string, init?: RequestInit) => call<T>(url.startsWith('http') ? url : `${ME}${url}`, await getToken(), fetchImpl, init)
  return {
    kind: 'outlook',
    async list(emails, limit = 20) {
      const u = new URL(GRAPH)
      u.searchParams.set('$filter', fromFilter(emails))
      u.searchParams.set('$select', 'id,subject,from,receivedDateTime,isRead,bodyPreview')
      u.searchParams.set('$top', String(limit))
      u.searchParams.set('$count', 'true')
      const page = await api<{ value?: GraphMessage[]; '@odata.count'?: number }>(u.toString(), { headers: { ConsistencyLevel: 'eventual' } })
      const items = (page.value ?? [])
        .map((m) => ({ id: m.id!, subject: m.subject ?? '', from: fmtAddr(m.from?.emailAddress), date: Date.parse(m.receivedDateTime ?? '') || 0, unread: !m.isRead, snippet: m.bodyPreview }))
        .sort((a, b) => b.date - a.date)
      return { items, total: Math.max(items.length, page['@odata.count'] ?? 0) }
    },
    async ids(emails, cap = BULK_CAP) {
      const out: string[] = []
      const u = new URL(GRAPH)
      u.searchParams.set('$filter', fromFilter(emails))
      u.searchParams.set('$select', 'id')
      u.searchParams.set('$top', '1000')
      let next: string | undefined = u.toString()
      while (next && out.length < cap) {
        const page: { value?: { id: string }[]; '@odata.nextLink'?: string } = await api(next)
        for (const m of page.value ?? []) out.push(m.id)
        next = page['@odata.nextLink']
      }
      return out.slice(0, cap)
    },
    async body(id) {
      const m = await api<GraphMessage>(`/messages/${id}?$select=subject,from,toRecipients,receivedDateTime,body`, { headers: { Prefer: 'outlook.body-content-type="html"' } })
      const html = m.body?.contentType === 'html' ? m.body.content : undefined
      return {
        subject: m.subject,
        from: fmtAddr(m.from?.emailAddress),
        to: (m.toRecipients ?? []).map((r) => fmtAddr(r.emailAddress)).join(', '),
        date: Date.parse(m.receivedDateTime ?? '') || undefined,
        html,
        text: html ? undefined : m.body?.content,
      }
    },
    async act(ids, action, onProgress) {
      let done = 0
      for (const part of chunk(ids, 20)) {
        const res = await api<{ responses?: { status: number }[] }>('https://graph.microsoft.com/v1.0/$batch', { method: 'POST', body: JSON.stringify({ requests: batchRequests(part, action) }) })
        done += (res.responses ?? []).filter((r) => r.status < 300).length
        onProgress?.(done)
      }
      return done
    },
    webUrl(emails) {
      return `https://outlook.live.com/mail/0/search?q=${encodeURIComponent(`from:${emails[0] ?? ''}`)}`
    },
  }
}
