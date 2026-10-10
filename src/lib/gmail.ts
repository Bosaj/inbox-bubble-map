import { metaFromHeaders, type MessageMeta } from './headers'

/**
 * Optional Gmail import, entirely in the browser.
 * - Scope: gmail.metadata (headers + labels only, never bodies).
 * - Token stays in memory; nothing is sent anywhere except Google's API.
 * Needs VITE_GOOGLE_CLIENT_ID (a Web OAuth client with this site's origin).
 */
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.metadata'
const API = 'https://gmail.googleapis.com/gmail/v1/users/me'
const HEADERS = ['From', 'Date', 'Subject', 'List-Unsubscribe', 'List-Unsubscribe-Post', 'List-Id', 'Precedence']

export const gmailClientId: string | undefined = import.meta.env.VITE_GOOGLE_CLIENT_ID || undefined

interface TokenResponse {
  access_token?: string
  error?: string
}

interface GoogleOAuth {
  accounts: { oauth2: { initTokenClient: (cfg: { client_id: string; scope: string; callback: (r: TokenResponse) => void; error_callback?: (e: { type: string }) => void }) => { requestAccessToken: () => void } } }
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

export async function requestGmailToken(clientId: string): Promise<string> {
  const google = await loadGis()
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GMAIL_SCOPE,
      callback: (r) => (r.access_token ? resolve(r.access_token) : reject(new Error(r.error ?? 'Access was not granted'))),
      error_callback: (e) => reject(new Error(e.type === 'popup_closed' ? 'Sign-in window was closed' : e.type)),
    })
    client.requestAccessToken()
  })
}

interface GmailMessage {
  id: string
  labelIds?: string[]
  internalDate?: string
  payload?: { headers?: { name: string; value: string }[] }
}

/** Map a Gmail API `format=metadata` message to our shape. */
export function metaFromGmail(msg: GmailMessage): MessageMeta {
  const h: Record<string, string> = {}
  for (const { name, value } of msg.payload?.headers ?? []) {
    const k = name.toLowerCase()
    if (!(k in h)) h[k] = value
  }
  const labels = (msg.labelIds ?? []).map((l) => l.toLowerCase())
  const meta = metaFromHeaders(h, labels)
  if (!meta.date && msg.internalDate) meta.date = Number(msg.internalDate)
  return meta
}

type Fetch = typeof fetch

async function getJson<T>(url: string, token: string, f: Fetch, attempt = 0): Promise<T> {
  const res = await f(url, { headers: { Authorization: `Bearer ${token}` } })
  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    await new Promise((r) => setTimeout(r, 400 * 2 ** attempt))
    return getJson(url, token, f, attempt + 1)
  }
  if (!res.ok) throw new Error(`Gmail API ${res.status}`)
  return res.json() as Promise<T>
}

export interface FetchProgress {
  done: number
  total: number
}

/** Fetch metadata for the newest `limit` messages, `concurrency` requests at a time. */
export async function fetchGmailMetadata(
  token: string,
  { limit = 2000, concurrency = 8, onProgress, signal, fetchImpl = fetch }: { limit?: number; concurrency?: number; onProgress?: (p: FetchProgress) => void; signal?: AbortSignal; fetchImpl?: Fetch } = {},
): Promise<MessageMeta[]> {
  const ids: string[] = []
  let pageToken: string | undefined
  do {
    const url = new URL(`${API}/messages`)
    url.searchParams.set('maxResults', String(Math.min(500, limit - ids.length)))
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const page = await getJson<{ messages?: { id: string }[]; nextPageToken?: string }>(url.toString(), token, fetchImpl)
    for (const m of page.messages ?? []) ids.push(m.id)
    pageToken = page.nextPageToken
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  } while (pageToken && ids.length < limit)

  const out: MessageMeta[] = []
  let next = 0
  let done = 0
  const qs = HEADERS.map((h) => `metadataHeaders=${encodeURIComponent(h)}`).join('&')
  const worker = async () => {
    while (next < ids.length) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const id = ids[next++]!
      const msg = await getJson<GmailMessage>(`${API}/messages/${id}?format=metadata&${qs}`, token, fetchImpl)
      const meta = metaFromGmail(msg)
      if (meta.fromEmail.includes('@')) out.push(meta)
      onProgress?.({ done: ++done, total: ids.length })
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker))
  return out
}
