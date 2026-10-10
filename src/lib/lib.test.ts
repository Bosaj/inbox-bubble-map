import { describe, expect, it } from 'vitest'
import { decodeWords, parseFrom, parseListUnsubscribe, rootDomain, parseDate } from './headers'
import { parseEml, parseMbox, MboxParser } from './mbox'
import { aggregate, cleanupScore, summarize, toCsv, gmailSearchUrl } from './aggregate'
import { demoMessages } from './demo'
import { computeLayout } from './layout'
import { fetchGmailMetadata, metaFromGmail } from './gmail'

const MBOX = `From 1790000000000000001@xxx Mon Oct 06 10:00:00 +0000 2026
X-GM-THRID: 1
X-Gmail-Labels: Inbox,Category Promotions,Unread
From: =?UTF-8?B?U291ayBEZWFscw==?= <news@mail.soukdeals.example>
To: me@example.com
Subject: =?UTF-8?Q?Flash_sale_=E2=80=94_60%?=
Date: Mon, 06 Oct 2026 10:00:00 +0000
List-Unsubscribe: <mailto:unsub@soukdeals.example>,
 <https://soukdeals.example/u/123>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
Precedence: bulk

Body line one
From the desk of nobody (not a separator: still inside body? mboxrd escapes it)
>From escaped line

From 1790000000000000002@xxx Tue Oct 07 09:00:00 +0000 2026
X-Gmail-Labels: Inbox,Opened
From: "Salma El Idrissi" <Salma.Idrissi@outlook.com>
Subject: Re: weekend plans
Date: Tue, 7 Oct 2026 09:00:00 +0100 (CET)

Hi!

From 1790000000000000003@xxx Wed Oct 08 08:00:00 +0000 2026
X-Gmail-Labels: Inbox,Category Updates
From: Medina Bank <no-reply@alerts.medinabank.example>
Subject: Your statement is ready
Date: Wed, 08 Oct 2026 08:00:00 +0000

Statement attached.
`

describe('headers', () => {
  it('decodes RFC 2047 words (B and Q, joined)', () => {
    expect(decodeWords('=?UTF-8?B?U291ayBEZWFscw==?=')).toBe('Souk Deals')
    expect(decodeWords('=?UTF-8?Q?Flash_sale_=E2=80=94_60%?=')).toBe('Flash sale — 60%')
    expect(decodeWords('=?ISO-8859-1?Q?caf=E9?= =?ISO-8859-1?Q?_cr=E8me?=')).toBe('café crème')
    expect(decodeWords('plain text')).toBe('plain text')
  })

  it('parses From in all common shapes', () => {
    expect(parseFrom('"Doe, Jane" <Jane@Example.com>')).toEqual({ name: 'Doe, Jane', email: 'jane@example.com' })
    expect(parseFrom('Jane <jane@example.com>')).toEqual({ name: 'Jane', email: 'jane@example.com' })
    expect(parseFrom('jane@example.com (Jane D)')).toEqual({ name: 'Jane D', email: 'jane@example.com' })
    expect(parseFrom('jane@example.com')).toEqual({ name: '', email: 'jane@example.com' })
  })

  it('extracts List-Unsubscribe targets', () => {
    expect(parseListUnsubscribe('<mailto:a@b.c?subject=x>, <https://b.c/u>')).toEqual({ mailto: 'mailto:a@b.c?subject=x', http: 'https://b.c/u' })
    expect(parseListUnsubscribe(undefined)).toEqual({})
  })

  it('collapses mail subdomains but keeps country second levels', () => {
    expect(rootDomain('mail.soukdeals.example')).toBe('soukdeals.example')
    expect(rootDomain('news.shop.co.uk')).toBe('shop.co.uk')
    expect(rootDomain('alerts.bank.co.ma')).toBe('bank.co.ma')
    expect(rootDomain('gmail.com')).toBe('gmail.com')
  })

  it('parses RFC 2822 dates with comments', () => {
    expect(parseDate('Tue, 7 Oct 2026 09:00:00 +0100 (CET)')).toBe(Date.UTC(2026, 9, 7, 8))
    expect(parseDate('garbage')).toBe(0)
  })
})

describe('mbox parser', () => {
  it('reads header blocks, folding and labels, skipping bodies', () => {
    const msgs = parseMbox(MBOX)
    expect(msgs).toHaveLength(3)
    const [souk, salma, bank] = msgs
    expect(souk).toMatchObject({
      fromName: 'Souk Deals',
      fromEmail: 'news@mail.soukdeals.example',
      subject: 'Flash sale — 60%',
      unsubHttp: 'https://soukdeals.example/u/123',
      unsubMailto: 'mailto:unsub@soukdeals.example',
      oneClick: true,
      bulk: true,
    })
    expect(souk!.labels).toEqual(['inbox', 'category promotions', 'unread'])
    expect(salma).toMatchObject({ fromName: 'Salma El Idrissi', fromEmail: 'salma.idrissi@outlook.com', bulk: false })
    expect(bank!.fromEmail).toBe('no-reply@alerts.medinabank.example')
  })

  it('gives the same result however the stream is chunked (CRLF too)', () => {
    const crlf = MBOX.replace(/\n/g, '\r\n')
    const p = new MboxParser()
    for (let i = 0; i < crlf.length; i += 7) p.push(crlf.slice(i, i + 7))
    expect(p.end()).toEqual(parseMbox(MBOX))
  })

  it('parses a single .eml', () => {
    const m = parseEml('From: A <a@x.example>\nSubject: Hi\n\nbody')
    expect(m).toMatchObject({ fromEmail: 'a@x.example', subject: 'Hi' })
  })
})

describe('aggregate', () => {
  it('groups by organisation and categorises', () => {
    const senders = aggregate(parseMbox(MBOX))
    const byKey = Object.fromEntries(senders.map((s) => [s.key, s]))
    expect(byKey['soukdeals.example']).toMatchObject({ label: 'Souk Deals', category: 'bulk', count: 1, unread: 1, gmailCategory: 'promotions' })
    expect(byKey['medinabank.example']).toMatchObject({ category: 'automated' })
    expect(byKey['salma.idrissi@outlook.com']).toMatchObject({ category: 'people', label: 'Salma El Idrissi' })
  })

  it('can group by exact sender address', () => {
    const msgs = demoMessages()
    expect(aggregate(msgs, 'sender').length).toBeGreaterThanOrEqual(aggregate(msgs, 'domain').length)
  })

  it('summarises and ranks cleanup candidates', () => {
    const senders = aggregate(demoMessages())
    const sum = summarize(senders)
    expect(sum.messages).toBe(demoMessages().length)
    expect(sum.senders).toBe(29)
    expect(sum.bulkShare).toBeGreaterThan(0.5)
    const top = [...senders].sort((a, b) => cleanupScore(b) - cleanupScore(a))[0]!
    expect(top.category).toBe('bulk')
    const person = senders.find((s) => s.category === 'people')!
    expect(cleanupScore(person)).toBeLessThan(cleanupScore(top) / 10)
  })

  it('exports CSV and Gmail search links', () => {
    const senders = aggregate(parseMbox(MBOX))
    const csv = toCsv(senders).split('\n')
    expect(csv[0]).toContain('unsubscribe_url')
    expect(csv).toHaveLength(4)
    expect(gmailSearchUrl(senders.find((s) => s.domain === 'soukdeals.example')!)).toBe('https://mail.google.com/mail/u/0/#search/from%3Asoukdeals.example')
  })
})

describe('layout', () => {
  it('places every bubble without overlaps, recent senders closer to the centre', () => {
    const senders = aggregate(demoMessages())
    const { bubbles, rings } = computeLayout(senders, 800)
    expect(bubbles).toHaveLength(senders.length)
    for (let i = 0; i < bubbles.length; i++)
      for (let j = i + 1; j < bubbles.length; j++) {
        const a = bubbles[i]!
        const b = bubbles[j]!
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.r + b.r - 1.5)
      }
    expect(rings.map((r) => r.days)).toEqual([7, 30])
    const biggest = bubbles.reduce((m, b) => (b.r > m.r ? b : m))
    expect(biggest.sender.count).toBe(Math.max(...senders.map((s) => s.count)))
  })
})

describe('gmail', () => {
  const msg = {
    id: '1',
    labelIds: ['INBOX', 'CATEGORY_PROMOTIONS', 'UNREAD'],
    internalDate: String(Date.UTC(2026, 9, 6)),
    payload: { headers: [{ name: 'From', value: 'Souk <news@souk.example>' }, { name: 'List-Unsubscribe', value: '<https://souk.example/u>' }] },
  }

  it('maps metadata responses', () => {
    expect(metaFromGmail(msg)).toMatchObject({ fromEmail: 'news@souk.example', date: Date.UTC(2026, 9, 6), unsubHttp: 'https://souk.example/u', labels: ['inbox', 'category_promotions', 'unread'] })
    expect(aggregate([metaFromGmail(msg)])[0]).toMatchObject({ category: 'bulk', unread: 1, gmailCategory: 'promotions' })
  })

  it('pages ids, fetches metadata with retry, and reports progress', async () => {
    const calls: string[] = []
    let failedOnce = false
    const fake = (async (url: string) => {
      calls.push(url)
      if (url.includes('/messages?')) {
        const page = url.includes('pageToken') ? { messages: [{ id: 'c' }] } : { messages: [{ id: 'a' }, { id: 'b' }], nextPageToken: 'p2' }
        return new Response(JSON.stringify(page))
      }
      if (url.includes('/messages/b') && !failedOnce) {
        failedOnce = true
        return new Response('', { status: 429 })
      }
      return new Response(JSON.stringify({ ...msg, id: url }))
    }) as unknown as typeof fetch
    const progress: number[] = []
    const out = await fetchGmailMetadata('token', { limit: 10, fetchImpl: fake, onProgress: (p) => progress.push(p.done) })
    expect(out).toHaveLength(3)
    expect(progress.at(-1)).toBe(3)
    expect(calls.some((c) => c.includes('metadataHeaders=List-Unsubscribe'))).toBe(true)
  })
})
