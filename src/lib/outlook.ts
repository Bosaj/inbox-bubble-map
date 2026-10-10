import { metaFromHeaders, type MessageMeta } from './headers'
import type { FetchProgress } from './gmail'

/**
 * Optional Outlook / Hotmail / Microsoft 365 import, entirely in the browser.
 * - MSAL popup sign-in, loaded only when the user clicks.
 * - Delegated scope Mail.ReadBasic: no bodies, no attachments.
 * Needs VITE_MS_CLIENT_ID (an Entra ID "Single-page application" registration
 * whose redirect URI is <origin>/redirect.html).
 */
export const msClientId: string | undefined = import.meta.env.VITE_MS_CLIENT_ID || undefined
export const MS_SCOPES = ['Mail.ReadBasic']
const GRAPH = 'https://graph.microsoft.com/v1.0/me/messages'

export async function requestOutlookToken(clientId: string): Promise<string> {
  const { createStandardPublicClientApplication } = await import('@azure/msal-browser')
  const pca = await createStandardPublicClientApplication({
    auth: { clientId, authority: 'https://login.microsoftonline.com/common', redirectUri: `${location.origin}/redirect.html` },
    cache: { cacheLocation: 'sessionStorage' },
  })
  const account = pca.getAllAccounts()[0]
  if (account) {
    try {
      return (await pca.acquireTokenSilent({ scopes: MS_SCOPES, account })).accessToken
    } catch {
      /* fall through to the popup */
    }
  }
  const result = await pca.loginPopup({ scopes: MS_SCOPES, prompt: 'select_account' })
  return result.accessToken
}

interface GraphMessage {
  subject?: string
  receivedDateTime?: string
  isRead?: boolean
  inferenceClassification?: 'focused' | 'other'
  from?: { emailAddress?: { name?: string; address?: string } }
  internetMessageHeaders?: { name: string; value: string }[]
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
  return metaFromHeaders(h, labels)
}

type Fetch = typeof fetch

async function getJson<T>(url: string, token: string, f: Fetch, attempt = 0): Promise<T> {
  const res = await f(url, { headers: { Authorization: `Bearer ${token}` } })
  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    const retry = Number(res.headers.get('retry-after')) || 2 ** attempt
    await new Promise((r) => setTimeout(r, retry * 400))
    return getJson(url, token, f, attempt + 1)
  }
  if (!res.ok) throw Object.assign(new Error(`Microsoft Graph ${res.status}`), { status: res.status })
  return res.json() as Promise<T>
}

/** Newest `limit` messages across the mailbox. Retries without headers if the tenant refuses them. */
export async function fetchOutlookMetadata(
  token: string,
  { limit = 2000, onProgress, fetchImpl = fetch }: { limit?: number; onProgress?: (p: FetchProgress) => void; fetchImpl?: Fetch } = {},
): Promise<MessageMeta[]> {
  const fields = ['from', 'subject', 'receivedDateTime', 'isRead', 'inferenceClassification']
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
      page = await getJson(url, token, fetchImpl)
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
