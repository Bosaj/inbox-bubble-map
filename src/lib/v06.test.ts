import { describe, expect, it } from 'vitest'
import { aggregate } from './aggregate'
import { demoMessages } from './demo'
import { activeFilterCount, fillFor, initials, logoDomain, NO_FILTERS, passes, recencyOf, selectPreset, seq } from './display'
import { cleanDomain, handleLogo } from '../../api/logo'
import { isPrivateAddress } from '../../api/imap'

const senders = aggregate(demoMessages())
const now = Math.max(...senders.map((s) => s.last))
const ctx = { now, maxDays: 365 }

describe('colour classes', () => {
  it('maps every mode to a colour expression', () => {
    const s = senders[0]!
    expect(fillFor(s, 'type', ctx)).toBe('var(--c-bulk)')
    expect(fillFor(s, 'unread', ctx)).toMatch(/^color-mix\(in oklab, var\(--seq-hi\) \d+%, var\(--seq-lo\)\)$/)
    expect(fillFor(s, 'recency', ctx)).toContain('--seq2-hi')
    expect(fillFor(s, 'unsub', ctx)).toBe('var(--c-bulk)')
    const person = senders.find((x) => x.category === 'people')!
    expect(fillFor(person, 'unsub', ctx)).toBe('var(--c-none)')
  })

  it('sequential mix is clamped and monotonic', () => {
    expect(seq(-1)).toContain(' 0%')
    expect(seq(2)).toContain(' 100%')
    const fresh = { ...senders[0]!, last: now }
    const old = { ...senders[0]!, last: now - 300 * 86_400_000 }
    expect(recencyOf(fresh, now, 365)).toBe(1)
    expect(recencyOf(old, now, 365)).toBeLessThan(0.1)
  })
})

describe('logos and monograms', () => {
  it('only asks for logos of real company domains', () => {
    expect(logoDomain({ ...senders[0]!, domain: 'github.com', category: 'automated' })).toBe('github.com')
    expect(logoDomain({ ...senders[0]!, domain: 'soukdeals.example' })).toBeNull()
    expect(logoDomain({ ...senders[0]!, domain: 'gmail.com', category: 'automated' })).toBeNull()
    expect(logoDomain({ ...senders[0]!, domain: 'github.com', category: 'people' })).toBeNull()
  })

  it('builds initials in any script', () => {
    expect(initials('Souk Deals')).toBe('SD')
    expect(initials('PixelPost')).toBe('PI')
    expect(initials('سلمى الإدريسي')).toBe('سا')
    expect(initials('!!!')).toBe('?')
  })
})

describe('filters and selection presets', () => {
  it('filters by unsubscribe link, unread rate, volume, recency and tab', () => {
    expect(activeFilterCount(NO_FILTERS)).toBe(0)
    const f = { ...NO_FILTERS, unsubOnly: true, minUnread: 80, minCount: 30 }
    expect(activeFilterCount(f)).toBe(3)
    const kept = senders.filter((s) => passes(s, f, now))
    expect(kept.length).toBeGreaterThan(0)
    expect(kept.every((s) => (s.unsubHttp || s.unsubMailto) && s.unread / s.count >= 0.8 && s.count >= 30)).toBe(true)
    expect(senders.filter((s) => passes(s, { ...NO_FILTERS, lastSeenDays: 7 }, now)).every((s) => now - s.last <= 7 * 86_400_000)).toBe(true)
    expect(senders.filter((s) => passes(s, { ...NO_FILTERS, tab: 'social' }, now)).every((s) => s.gmailCategory === 'social')).toBe(true)
  })

  it('selects groups by type and behaviour', () => {
    expect(selectPreset(senders, 'people').size).toBe(senders.filter((s) => s.category === 'people').length)
    expect([...selectPreset(senders, 'unsub')].every((k) => senders.find((s) => s.key === k)!.unsubHttp)).toBe(true)
    expect(selectPreset(senders, 'never-opened').size).toBeGreaterThan(0)
  })
})

describe('logo proxy', () => {
  const png = new Uint8Array(400).fill(7)
  it('validates domains', () => {
    expect(cleanDomain('WWW.GitHub.com.')).toBe('github.com')
    expect(cleanDomain('127.0.0.1')).toBeNull()
    expect(cleanDomain('localhost')).toBeNull()
    expect(cleanDomain('a b.com')).toBeNull()
    expect(isPrivateAddress('10.0.0.1')).toBe(true)
  })

  it('proxies the first good icon with long CDN caching and never contacts the domain itself', async () => {
    const calls: string[] = []
    const f = (async (url: string) => {
      calls.push(url)
      if (url.includes('duckduckgo')) return new Response('', { status: 404, headers: { 'content-type': 'image/png' } })
      return new Response(png, { headers: { 'content-type': 'image/png' } })
    }) as unknown as typeof fetch
    const res = await handleLogo(new Request('https://app/api/logo?d=github.com'), f)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('s-maxage=2592000')
    expect(calls.every((u) => u.startsWith('https://icons.duckduckgo.com/') || u.startsWith('https://www.google.com/s2/favicons'))).toBe(true)
  })

  it('rejects non-images, tiny placeholders and bad input', async () => {
    const html = (async () => new Response('<html>', { headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch
    expect((await handleLogo(new Request('https://app/api/logo?d=github.com'), html)).status).toBe(404)
    const tiny = (async () => new Response(new Uint8Array(50), { headers: { 'content-type': 'image/png' } })) as unknown as typeof fetch
    expect((await handleLogo(new Request('https://app/api/logo?d=github.com'), tiny)).status).toBe(404)
    expect((await handleLogo(new Request('https://app/api/logo?d=../../etc'), tiny)).status).toBe(400)
  })
})
