import { parseEml } from './mbox'
import type { MessageMeta } from './headers'

export type ProviderId = 'gmail' | 'outlook' | 'yahoo' | 'icloud' | 'gmx' | 'zoho' | 'fastmail' | 'aol' | 'other'

export interface Provider {
  id: ProviderId
  name: string
  hint: string
  color: string // brand-neutral accent for the tile initial
  host?: string // IMAP host for app-password providers
  mailboxes?: { value: string; label: string }[]
  appPasswordUrl?: string
  appPasswordSteps?: string
}

export const PROVIDERS: Provider[] = [
  {
    id: 'gmail',
    name: 'Gmail',
    hint: 'Google sign-in, or an app password',
    color: '#ea4335',
    host: 'imap.gmail.com',
    mailboxes: [
      { value: 'INBOX', label: 'Inbox' },
      { value: '[Gmail]/All Mail', label: 'All Mail (includes archived)' },
    ],
    appPasswordUrl: 'https://myaccount.google.com/apppasswords',
    appPasswordSteps: 'Turn on 2-Step Verification, then create an app password named “Bubble Map”.',
  },
  { id: 'outlook', name: 'Outlook / Hotmail', hint: 'Microsoft sign-in (Outlook.com, Hotmail, Live, Microsoft 365)', color: '#0a64ad' },
  {
    id: 'yahoo',
    name: 'Yahoo Mail',
    hint: 'App password',
    color: '#6001d2',
    host: 'imap.mail.yahoo.com',
    appPasswordUrl: 'https://login.yahoo.com/account/security',
    appPasswordSteps: 'Account security → Generate app password.',
  },
  {
    id: 'icloud',
    name: 'iCloud Mail',
    hint: 'App-specific password',
    color: '#3693f3',
    host: 'imap.mail.me.com',
    appPasswordUrl: 'https://account.apple.com/account/manage',
    appPasswordSteps: 'Sign-In and Security → App-Specific Passwords → +.',
  },
  {
    id: 'gmx',
    name: 'GMX',
    hint: 'Enable IMAP, then your password',
    color: '#1c449b',
    host: 'imap.gmx.com',
    appPasswordSteps: 'In GMX settings, enable “POP3 & IMAP access” first. For gmx.de / gmx.net use imap.gmx.net in “Other”.',
  },
  {
    id: 'zoho',
    name: 'Zoho Mail',
    hint: 'App password',
    color: '#e42527',
    host: 'imap.zoho.com',
    appPasswordUrl: 'https://accounts.zoho.com/home#security/app_password',
    appPasswordSteps: 'Security → App passwords → Generate. EU accounts: imap.zoho.eu in “Other”.',
  },
  {
    id: 'fastmail',
    name: 'Fastmail',
    hint: 'App password',
    color: '#0067b9',
    host: 'imap.fastmail.com',
    appPasswordUrl: 'https://app.fastmail.com/settings/security/apps',
    appPasswordSteps: 'Settings → Privacy & Security → App passwords → New (mail, IMAP).',
  },
  {
    id: 'aol',
    name: 'AOL Mail',
    hint: 'App password',
    color: '#31459b',
    host: 'imap.aol.com',
    appPasswordUrl: 'https://login.aol.com/account/security',
    appPasswordSteps: 'Account security → Generate app password.',
  },
  { id: 'other', name: 'Other (IMAP)', hint: 'Any provider with IMAP over SSL (port 993)', color: '#6b6a64' },
]

export interface ImapOptions {
  host: string
  email: string
  password: string
  limit: number
  mailbox?: string
  signal?: AbortSignal
}

interface RelayMessage {
  h: string
  seen: boolean
  date?: number
}

/** Ask this site's relay function to read message headers over IMAP. */
export async function fetchViaImap(opts: ImapOptions, fetchImpl: typeof fetch = fetch): Promise<MessageMeta[]> {
  const res = await fetchImpl('/api/imap', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ host: opts.host, email: opts.email, password: opts.password, limit: opts.limit, mailbox: opts.mailbox }),
    signal: opts.signal,
  })
  const data = (await res.json().catch(() => ({}))) as { messages?: RelayMessage[]; message?: string }
  if (!res.ok) throw new Error(data.message ?? `The mail relay failed (${res.status}).`)
  return relayToMeta(data.messages ?? [])
}

export function relayToMeta(messages: RelayMessage[]): MessageMeta[] {
  const out: MessageMeta[] = []
  for (const m of messages) {
    const meta = parseEml(m.h.replace(/\r\n/g, '\n').trimEnd() + '\n\n')
    if (!meta) continue
    if (!meta.date && m.date) meta.date = m.date
    meta.labels = m.seen ? ['opened'] : ['unread']
    out.push(meta)
  }
  return out
}
