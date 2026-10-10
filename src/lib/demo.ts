import type { MessageMeta } from './headers'

/** Fictional senders only — the demo must never look like anyone's real inbox. */
const BULK = [
  ['Souk Deals', 'news@mail.soukdeals.example', 'promotions'],
  ['Atlas Airways', 'offers@atlasairways.example', 'promotions'],
  ['PixelPost Weekly', 'digest@pixelpost.example', 'updates'],
  ['CodeCraft Digest', 'hello@codecraft.example', 'updates'],
  ['Medina Fashion', 'newsletter@medinafashion.example', 'promotions'],
  ['Sahara Streaming', 'picks@sahara-stream.example', 'promotions'],
  ['Daily Dev Brief', 'brief@dailydev.example', 'updates'],
  ['Argan Beauty', 'club@arganbeauty.example', 'promotions'],
  ['Kasbah Books', 'stories@kasbahbooks.example', 'promotions'],
  ['Startup Radar', 'radar@startupradar.example', 'updates'],
  ['Mint Grocery', 'save@mintgrocery.example', 'promotions'],
  ['Open Source Forum', 'forum@osf.example', 'forums'],
  ['Travel Hacks', 'go@travelhacks.example', 'promotions'],
  ['Design Notes', 'notes@designnotes.example', 'updates'],
  ['Gadget Hub', 'deals@gadgethub.example', 'promotions'],
] as const

const AUTOMATED = [
  ['Medina Bank', 'no-reply@alerts.medinabank.example', 'updates'],
  ['ParcelGo', 'notifications@parcelgo.example', 'updates'],
  ['CloudBox', 'noreply@cloudbox.example', 'updates'],
  ['RideNow', 'receipts@ridenow.example', 'updates'],
  ['GitForge', 'notifications@gitforge.example', 'updates'],
  ['Calendar', 'calendar-notification@calendar.example', 'updates'],
  ['Social Circle', 'notify@socialcircle.example', 'social'],
  ['TelecomPlus', 'billing@telecomplus.example', 'updates'],
] as const

const PEOPLE = [
  ['Yassine B.', 'yassine.b@gmail.com'],
  ['Salma El Idrissi', 'salma.idrissi@outlook.com'],
  ['Prof. Amrani', 'amrani@univ.example'],
  ['Karim', 'karim.dev@proton.me'],
  ['Hiking Club Oujda', 'club.hiking.oujda@gmail.com'],
  ['Nadia (HR)', 'nadia@company.example'],
] as const

const SUBJECTS: Record<string, string[]> = {
  promotions: ['Weekend flash sale — up to 60% off', 'Your exclusive member offer', 'New arrivals you will love', 'Last chance: free delivery ends tonight', 'We miss you! Here is 15% off'],
  updates: ['This week in tech', 'Your weekly digest', '5 things you missed', 'Release notes and community picks'],
  forums: ['[osf] Re: build fails on Windows', '[osf] Weekly roundup'],
  social: ['You have 3 new connections', 'Someone mentioned you'],
  people: ['Re: weekend plans', 'Notes from today', 'Quick question', 'Photos from the trip', 'Re: project update'],
  bank: ['Your statement is ready', 'Card payment alert'],
}

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
}

export function demoMessages(now = Date.UTC(2026, 9, 10)): MessageMeta[] {
  const r = rng(42)
  const out: MessageMeta[] = []
  const day = 86_400_000
  const add = (name: string, email: string, n: number, opts: { tab?: string; unsub?: boolean; unreadP: number; spanDays: number; quietDays?: number; subjects: string[] }) => {
    for (let i = 0; i < n; i++) {
      const date = now - (opts.quietDays ?? 0) * day - Math.floor(r() ** 1.6 * opts.spanDays * day)
      const labels = [opts.tab ? `category ${opts.tab}` : 'category personal', r() < opts.unreadP ? 'unread' : 'opened', 'inbox']
      const host = email.split('@')[1]
      out.push({
        fromName: name,
        fromEmail: email,
        date,
        subject: opts.subjects[Math.floor(r() * opts.subjects.length)]!,
        unsubHttp: opts.unsub ? `https://${host}/unsubscribe?u=demo` : undefined,
        unsubMailto: opts.unsub ? `mailto:unsubscribe@${host}` : undefined,
        oneClick: Boolean(opts.unsub && r() < 0.7),
        listId: opts.unsub ? `<list.${host}>` : undefined,
        bulk: Boolean(opts.unsub),
        labels,
      })
    }
  }
  // days since each sender last wrote, so the demo shows the whole recency range
  const BULK_QUIET = [0, 0, 1, 2, 4, 9, 0, 21, 40, 3, 75, 130, 12, 220, 6]
  const AUTO_QUIET = [0, 1, 0, 14, 0, 2, 35, 18]
  const PEOPLE_QUIET = [0, 3, 26, 60, 9, 150]
  BULK.forEach(([name, email, tab], i) => {
    const n = Math.round(260 / (i + 1.4) + r() * 25)
    add(name, email, n, { tab, unsub: true, unreadP: 0.55 + r() * 0.4, spanDays: 360, quietDays: BULK_QUIET[i], subjects: SUBJECTS[tab]! })
  })
  AUTOMATED.forEach(([name, email, tab], i) => {
    const n = Math.round(110 / (i + 1.2) + r() * 12)
    add(name, email, n, { tab, unreadP: 0.25 + r() * 0.4, spanDays: 300, quietDays: AUTO_QUIET[i], subjects: name === 'Medina Bank' ? SUBJECTS.bank! : SUBJECTS[tab]! })
  })
  PEOPLE.forEach(([name, email], i) => {
    const n = Math.round(48 / (i + 1) + r() * 6)
    add(name, email, n, { unreadP: 0.05, spanDays: 200, quietDays: PEOPLE_QUIET[i], subjects: SUBJECTS.people! })
  })
  return out
}
