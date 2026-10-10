import { domainOf, rootDomain, type MessageMeta } from './headers'

/** Three groups only: the bubble map is an all-pairs chart, and only three hues stay distinguishable for every reader. */
export type Category = 'bulk' | 'automated' | 'people'
export const CATEGORIES: Category[] = ['bulk', 'automated', 'people']

export type GroupBy = 'domain' | 'sender'

export interface Sender {
  key: string
  label: string // display name (brand or person)
  domain: string
  emails: string[]
  count: number
  unread: number
  first: number
  last: number
  category: Category
  unsubHttp?: string
  unsubMailto?: string
  oneClick: boolean
  subjects: string[] // up to 3 recent subjects
  gmailCategory?: string // most common Gmail tab, e.g. "promotions"
  months: Record<string, number> // "2026-10" → messages that month
}

const AUTOMATED_LOCAL = /^(no-?reply|do-?not-?reply|donotreply|notifications?|notify|alerts?|mailer-daemon|postmaster|bounce|updates?|info|support|service|security|accounts?|billing|receipts?|orders?|team|hello|news|newsletter|marketing|digest)([._+-].*)?$/
const FREEMAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.fr', 'hotmail.com', 'hotmail.fr', 'outlook.com', 'outlook.fr', 'live.com', 'live.fr', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'aol.com', 'gmx.com', 'menara.ma'])

function categorize(m: MessageMeta): Category {
  if (m.unsubHttp || m.unsubMailto || m.listId || m.bulk) return 'bulk'
  if (m.labels.some((l) => l === 'category promotions' || l === 'category_promotions' || l === 'category forums' || l === 'category_forums')) return 'bulk'
  const local = m.fromEmail.split('@')[0] ?? ''
  if (AUTOMATED_LOCAL.test(local)) return 'automated'
  if (m.labels.some((l) => l === 'category updates' || l === 'category_updates' || l === 'category social' || l === 'category_social')) return 'automated'
  return 'people'
}

function gmailTab(labels: string[]): string | undefined {
  for (const l of labels) {
    const m = /^category[ _](\w+)$/.exec(l)
    if (m) return m[1]
  }
  return undefined
}

function prettyBrand(domain: string): string {
  const root = rootDomain(domain).split('.')[0] ?? domain
  return root.charAt(0).toUpperCase() + root.slice(1)
}

const RANK: Record<Category, number> = { bulk: 2, automated: 1, people: 0 }

export function monthKey(t: number): string {
  const d = new Date(t)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Last `n` month keys ending at `ref`, oldest first. */
export function lastMonths(ref: number, n = 12): string[] {
  const d = new Date(ref)
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) out.push(monthKey(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)))
  return out
}

/** Average messages per week over the sender's active span (min 4 weeks). */
export function perWeek(s: Sender): number {
  if (!s.first || !s.last) return 0
  const weeks = Math.max(4, (s.last - s.first) / (7 * 86_400_000))
  return s.count / weeks
}

export interface Insights {
  listShare: number
  neverOpened: Sender[] // ≥ 10 messages, ≥ 90 % unread, not people
  top5Share: number
  listPerWeek: number
  cleanupPerYear: number // messages a year from senders in the cleanup list
}

export function insights(senders: Sender[], cleanup: Set<string> = new Set()): Insights {
  const total = senders.reduce((n, s) => n + s.count, 0) || 1
  const lists = senders.filter((s) => s.category === 'bulk')
  const sorted = [...senders].sort((a, b) => b.count - a.count)
  return {
    listShare: lists.reduce((n, s) => n + s.count, 0) / total,
    neverOpened: senders.filter((s) => s.category !== 'people' && s.count >= 10 && s.unread / s.count >= 0.9).sort((a, b) => b.count - a.count),
    top5Share: sorted.slice(0, 5).reduce((n, s) => n + s.count, 0) / total,
    listPerWeek: lists.reduce((n, s) => n + perWeek(s), 0),
    cleanupPerYear: Math.round(senders.filter((s) => cleanup.has(s.key)).reduce((n, s) => n + perWeek(s), 0) * 52),
  }
}

/** Keep only messages newer than `days` before the newest message (exports can be old). */
export function inRange<T extends { date: number }>(messages: T[], days: number | null): T[] {
  if (!days) return messages
  const newest = messages.reduce((m, x) => Math.max(m, x.date), 0)
  const from = newest - days * 86_400_000
  return messages.filter((m) => m.date >= from)
}

/**
 * Group messages by organisation (root domain) or by exact sender address.
 * Personal freemail addresses (gmail.com …) are always grouped per person.
 */
export function aggregate(messages: MessageMeta[], groupBy: GroupBy = 'domain'): Sender[] {
  const map = new Map<string, Sender & { tabs: Map<string, number>; cats: Record<Category, number> }>()
  for (const m of messages) {
    const domain = domainOf(m.fromEmail)
    const root = rootDomain(domain)
    const personal = FREEMAIL.has(root)
    const key = groupBy === 'sender' || personal ? m.fromEmail : root
    let s = map.get(key)
    if (!s) {
      s = {
        key,
        label: '',
        domain: personal ? domain : root,
        emails: [],
        count: 0,
        unread: 0,
        first: Infinity,
        last: 0,
        category: 'people',
        oneClick: false,
        subjects: [],
        months: {},
        tabs: new Map(),
        cats: { bulk: 0, automated: 0, people: 0 },
      }
      map.set(key, s)
    }
    s.count++
    if (m.labels.includes('unread')) s.unread++
    if (m.date) {
      const mk = monthKey(m.date)
      s.months[mk] = (s.months[mk] ?? 0) + 1
      s.first = Math.min(s.first, m.date)
      if (m.date >= s.last) {
        s.last = m.date
        if (m.fromName) s.label = m.fromName
        if (m.subject) s.subjects = [m.subject, ...s.subjects.filter((x) => x !== m.subject)].slice(0, 3)
      }
    } else if (m.subject && s.subjects.length < 3 && !s.subjects.includes(m.subject)) s.subjects.push(m.subject)
    if (!s.label && m.fromName) s.label = m.fromName
    if (!s.emails.includes(m.fromEmail) && s.emails.length < 20) s.emails.push(m.fromEmail)
    if (m.unsubHttp && !s.unsubHttp) s.unsubHttp = m.unsubHttp
    if (m.unsubMailto && !s.unsubMailto) s.unsubMailto = m.unsubMailto
    if (m.oneClick) s.oneClick = true
    s.cats[categorize(m)]++
    const tab = gmailTab(m.labels)
    if (tab) s.tabs.set(tab, (s.tabs.get(tab) ?? 0) + 1)
  }

  return [...map.values()]
    .map(({ tabs, cats, ...s }) => {
      // the dominant category wins; ties go to the more "cleanable" one
      const category = (Object.keys(cats) as Category[]).sort((a, b) => cats[b] - cats[a] || RANK[b] - RANK[a])[0]!
      const gmailCategory = [...tabs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
      const isOrg = s.key === s.domain && !FREEMAIL.has(s.domain)
      const label = s.label || (isOrg ? prettyBrand(s.domain) : s.emails[0]!)
      return { ...s, label, category, gmailCategory, first: s.first === Infinity ? 0 : s.first }
    })
    .sort((a, b) => b.count - a.count)
}

/** Higher = better cleanup candidate: lots of mail, mostly unread, unsubscribable. */
export function cleanupScore(s: Sender): number {
  const unreadRatio = s.count ? s.unread / s.count : 0
  const unsub = s.unsubHttp || s.unsubMailto ? 1 : 0.4
  const cat = s.category === 'bulk' ? 1 : s.category === 'automated' ? 0.6 : 0.1
  return s.count * (0.4 + unreadRatio) * unsub * cat
}

export interface Summary {
  messages: number
  senders: number
  bulkShare: number // share of messages from bulk senders
  unsubscribable: number // senders with a List-Unsubscribe link
  unread: number
  from: number
  to: number
}

export function summarize(senders: Sender[]): Summary {
  let messages = 0
  let bulk = 0
  let unread = 0
  let from = Infinity
  let to = 0
  for (const s of senders) {
    messages += s.count
    unread += s.unread
    if (s.category === 'bulk') bulk += s.count
    if (s.first) from = Math.min(from, s.first)
    to = Math.max(to, s.last)
  }
  return {
    messages,
    senders: senders.length,
    bulkShare: messages ? bulk / messages : 0,
    unsubscribable: senders.filter((s) => s.unsubHttp || s.unsubMailto).length,
    unread,
    from: from === Infinity ? 0 : from,
    to,
  }
}

export function gmailSearchUrl(s: Sender): string {
  const q = s.key.includes('@') ? `from:${s.key}` : `from:${s.domain}`
  return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(q)}`
}

export function toCsv(senders: Sender[]): string {
  const esc = (v: string | number) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const rows = [['sender', 'domain', 'category', 'messages', 'unread', 'last_seen', 'unsubscribe_url', 'unsubscribe_mailto', 'gmail_search']]
  for (const s of senders) {
    rows.push([s.label, s.domain, s.category, String(s.count), String(s.unread), s.last ? new Date(s.last).toISOString().slice(0, 10) : '', s.unsubHttp ?? '', s.unsubMailto ?? '', gmailSearchUrl(s)])
  }
  return rows.map((r) => r.map(esc).join(',')).join('\n')
}

const xmlEsc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

/** Gmail filters file (Settings → Filters → Import): skip the inbox and mark read. */
export function toGmailFilters(senders: Sender[], label = 'Newsletters'): string {
  const entries = senders
    .map((s) => {
      const from = s.key.includes('@') ? s.key : s.domain
      return `  <entry>
    <category term='filter'></category>
    <title>Mail Filter</title>
    <content></content>
    <apps:property name='from' value='${xmlEsc(from)}'/>
    <apps:property name='label' value='${xmlEsc(label)}'/>
    <apps:property name='shouldArchive' value='true'/>
    <apps:property name='shouldMarkAsRead' value='true'/>
    <apps:property name='sizeOperator' value='s_sl'/>
    <apps:property name='sizeUnit' value='s_smb'/>
  </entry>`
    })
    .join('\n')
  return `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns='http://www.w3.org/2005/Atom' xmlns:apps='http://schemas.google.com/apps/2006'>
  <title>Mail Filters</title>
${entries}
</feed>
`
}

const sieveEsc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

/** Sieve script (Fastmail, Proton, Posteo, Dovecot/cPanel…): file into a folder and mark read. */
export function toSieve(senders: Sender[], folder = 'Newsletters'): string {
  const domains = senders.filter((s) => !s.key.includes('@')).map((s) => `"${sieveEsc(s.domain)}"`)
  const addresses = senders.filter((s) => s.key.includes('@')).map((s) => `"${sieveEsc(s.key)}"`)
  const tests: string[] = []
  if (domains.length) tests.push(`address :domain :is "from" [${domains.join(', ')}]`)
  if (addresses.length) tests.push(`address :is "from" [${addresses.join(', ')}]`)
  if (!tests.length) return '# No senders selected\n'
  return `require ["fileinto", "imap4flags"];

# Generated by Inbox Bubble Map: ${senders.length} sender(s)
if anyof (
  ${tests.join(',\n  ')}
) {
  addflag "\\\\Seen";
  fileinto "${sieveEsc(folder)}";
  stop;
}
`
}
