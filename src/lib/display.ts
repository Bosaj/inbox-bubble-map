import type { Category, Sender } from './aggregate'

export type ColorBy = 'type' | 'unread' | 'recency' | 'unsub'
export type LayoutMode = 'orbit' | 'clusters' | 'free'

export const CATEGORY_VAR: Record<Category, string> = { bulk: 'var(--c-bulk)', automated: 'var(--c-automated)', people: 'var(--c-people)' }

const DAY = 86_400_000

/** Sequential colour: one hue, light → dark (or dark → light in dark mode), mixed in OKLab. */
export function seq(p: number, lo = 'var(--seq-lo)', hi = 'var(--seq-hi)'): string {
  const pct = Math.round(Math.max(0, Math.min(1, p)) * 100)
  return `color-mix(in oklab, ${hi} ${pct}%, ${lo})`
}

/** 0 = oldest sender in view, 1 = wrote today (log scale, same as the orbit distance). */
export function recencyOf(s: Sender, now: number, maxDays: number): number {
  const days = Math.max(0, (now - s.last) / DAY)
  return 1 - Math.log1p(days) / Math.log1p(Math.max(1, maxDays))
}

export function fillFor(s: Sender, by: ColorBy, ctx: { now: number; maxDays: number }): string {
  switch (by) {
    case 'unread':
      return seq(s.count ? s.unread / s.count : 0)
    case 'recency':
      return seq(recencyOf(s, ctx.now, ctx.maxDays), 'var(--seq2-lo)', 'var(--seq2-hi)')
    case 'unsub':
      return s.unsubHttp || s.unsubMailto ? 'var(--c-bulk)' : 'var(--c-none)'
    default:
      return CATEGORY_VAR[s.category]
  }
}

const FREEMAIL = /^(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|me|proton|protonmail|aol|gmx|menara)\./
const RESERVED_TLD = /\.(example|test|invalid|localhost|local)$/

/** Domain to fetch a company logo for, or null (people, personal mail, fictional demo domains). */
export function logoDomain(s: Sender): string | null {
  if (s.category === 'people') return null
  const d = s.domain.toLowerCase()
  if (FREEMAIL.test(d) || RESERVED_TLD.test(d) || !d.includes('.')) return null
  return d
}

export function initials(label: string): string {
  const words = label
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase()
  return (words[0]![0]! + words[1]![0]!).toUpperCase()
}

export interface Filters {
  unsubOnly: boolean
  minUnread: number // %
  minCount: number
  lastSeenDays: number | null
  tab: string | null
}

export const NO_FILTERS: Filters = { unsubOnly: false, minUnread: 0, minCount: 1, lastSeenDays: null, tab: null }

export function activeFilterCount(f: Filters): number {
  return Number(f.unsubOnly) + Number(f.minUnread > 0) + Number(f.minCount > 1) + Number(f.lastSeenDays !== null) + Number(f.tab !== null)
}

export function passes(s: Sender, f: Filters, now: number): boolean {
  if (f.unsubOnly && !s.unsubHttp && !s.unsubMailto) return false
  if (f.minUnread > 0 && (s.count ? (s.unread / s.count) * 100 : 0) < f.minUnread) return false
  if (s.count < f.minCount) return false
  if (f.lastSeenDays !== null && now - s.last > f.lastSeenDays * DAY) return false
  if (f.tab !== null && s.gmailCategory !== f.tab) return false
  return true
}

export type SelectPreset = Category | 'unsub' | 'never-opened'

export function selectPreset(senders: Sender[], preset: SelectPreset): Set<string> {
  return new Set(
    senders
      .filter((s) =>
        preset === 'unsub' ? Boolean(s.unsubHttp || s.unsubMailto) : preset === 'never-opened' ? s.category !== 'people' && s.count >= 5 && s.unread / s.count >= 0.9 : s.category === preset,
      )
      .map((s) => s.key),
  )
}

/** Cluster anchors for the "Clusters" layout (sim units, centre = 0,0). */
export const CLUSTER: Record<Category, { x: number; y: number }> = {
  bulk: { x: -250, y: -90 },
  automated: { x: 250, y: -90 },
  people: { x: 0, y: 270 },
}
