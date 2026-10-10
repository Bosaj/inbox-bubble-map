/** Header-level helpers shared by the mbox parser and the Gmail API client. */

export interface MessageMeta {
  fromName: string
  fromEmail: string
  date: number // epoch ms, 0 if unknown
  subject: string
  unsubHttp?: string
  unsubMailto?: string
  oneClick: boolean
  listId?: string
  bulk: boolean // Precedence: bulk/list/junk or List-Id present
  labels: string[] // Gmail labels / categories, lower-case ("category promotions", "unread", …)
}

/** Decode RFC 2047 encoded-words: =?UTF-8?B?…?= and =?ISO-8859-1?Q?…?= */
export function decodeWords(input: string): string {
  // adjacent encoded words separated only by whitespace are joined
  const joined = input.replace(/\?=\s+=\?/g, '?==?')
  return joined.replace(/=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/g, (_, charset: string, enc: string, text: string) => {
    try {
      let bytes: Uint8Array
      if (enc.toUpperCase() === 'B') {
        const bin = atob(text)
        bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
      } else {
        const s = text.replace(/_/g, ' ')
        const out: number[] = []
        for (let i = 0; i < s.length; i++) {
          if (s[i] === '=' && /^[0-9a-fA-F]{2}$/.test(s.slice(i + 1, i + 3))) {
            out.push(parseInt(s.slice(i + 1, i + 3), 16))
            i += 2
          } else out.push(s.charCodeAt(i))
        }
        bytes = Uint8Array.from(out)
      }
      return new TextDecoder(normalizeCharset(charset)).decode(bytes)
    } catch {
      return text
    }
  })
}

function normalizeCharset(c: string): string {
  const s = c.toLowerCase().split('*')[0]!
  if (s === 'utf8') return 'utf-8'
  try {
    new TextDecoder(s)
    return s
  } catch {
    return 'utf-8'
  }
}

/** Parse a From header: `"Name" <a@b.c>`, `Name <a@b.c>`, `a@b.c (Name)` or `a@b.c`. */
export function parseFrom(raw: string): { name: string; email: string } {
  const value = decodeWords(raw).trim()
  const angle = /^(.*?)<\s*([^<>\s]+@[^<>\s]+)\s*>/.exec(value)
  if (angle) {
    const name = angle[1]!.trim().replace(/^"|"$/g, '').replace(/\\"/g, '"').trim()
    return { name, email: angle[2]!.toLowerCase() }
  }
  const paren = /^([^\s()]+@[^\s()]+)\s*\((.*)\)$/.exec(value)
  if (paren) return { name: paren[2]!.trim(), email: paren[1]!.toLowerCase() }
  const bare = /([^\s<>"]+@[^\s<>"]+)/.exec(value)
  return { name: '', email: (bare?.[1] ?? value).toLowerCase() }
}

export function domainOf(email: string): string {
  const at = email.lastIndexOf('@')
  return at === -1 ? email : email.slice(at + 1).replace(/[>.]+$/, '')
}

/** Collapse mail subdomains so news.brand.com and mail.brand.com group as brand.com. */
export function rootDomain(domain: string): string {
  const parts = domain.split('.').filter(Boolean)
  if (parts.length <= 2) return domain
  const sld = parts[parts.length - 2]!
  const tld = parts[parts.length - 1]!
  // co.uk, com.au, co.ma, gov.ma …
  if (sld.length <= 3 && tld.length === 2 && ['co', 'com', 'org', 'net', 'gov', 'ac', 'edu'].includes(sld)) return parts.slice(-3).join('.')
  return parts.slice(-2).join('.')
}

export function parseListUnsubscribe(raw: string | undefined): { http?: string; mailto?: string } {
  if (!raw) return {}
  const out: { http?: string; mailto?: string } = {}
  for (const m of raw.matchAll(/<\s*([^>]+?)\s*>/g)) {
    const url = m[1]!
    if (/^https?:/i.test(url) && !out.http) out.http = url
    else if (/^mailto:/i.test(url) && !out.mailto) out.mailto = url
  }
  return out
}

export function parseDate(raw: string | undefined): number {
  if (!raw) return 0
  const cleaned = raw.replace(/\s*\([^)]*\)\s*$/, '').trim()
  const t = Date.parse(cleaned)
  return Number.isFinite(t) ? t : 0
}

/** Build MessageMeta from a header map (keys lower-case). */
export function metaFromHeaders(h: Record<string, string>, labels: string[] = []): MessageMeta {
  const from = parseFrom(h['from'] ?? '')
  const unsub = parseListUnsubscribe(h['list-unsubscribe'])
  const precedence = (h['precedence'] ?? '').toLowerCase()
  return {
    fromName: from.name,
    fromEmail: from.email,
    date: parseDate(h['date']),
    subject: decodeWords(h['subject'] ?? '').trim(),
    unsubHttp: unsub.http,
    unsubMailto: unsub.mailto,
    oneClick: /one-click/i.test(h['list-unsubscribe-post'] ?? ''),
    listId: h['list-id'] ? decodeWords(h['list-id']).trim() : undefined,
    bulk: /bulk|list|junk/.test(precedence) || Boolean(h['list-id']),
    labels: labels.length ? labels : (h['x-gmail-labels'] ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  }
}
