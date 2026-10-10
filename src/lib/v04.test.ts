import { describe, expect, it } from 'vitest'
import { aggregate, inRange, insights, lastMonths, monthKey, toGmailFilters, toSieve } from './aggregate'
import { demoMessages } from './demo'
import { relayToMeta, fetchViaImap, PROVIDERS } from './providers'
import { fetchOutlookMetadata, metaFromGraph } from './outlook'
import { allow, handle, isPrivateAddress, resolvePublic, validate } from '../../api/imap'

describe('activity, range and insights', () => {
  const msgs = demoMessages()
  it('counts messages per month', () => {
    const s = aggregate(msgs)[0]!
    expect(Object.values(s.months).reduce((a, b) => a + b, 0)).toBe(s.count)
    expect(monthKey(Date.UTC(2026, 0, 31))).toBe('2026-01')
    expect(lastMonths(Date.UTC(2026, 9, 10), 3)).toEqual(['2026-08', '2026-09', '2026-10'])
  })

  it('filters by range relative to the newest message', () => {
    const r30 = inRange(msgs, 30)
    expect(r30.length).toBeLessThan(msgs.length)
    const newest = Math.max(...msgs.map((m) => m.date))
    expect(r30.every((m) => m.date >= newest - 30 * 86_400_000)).toBe(true)
    expect(inRange(msgs, null)).toBe(msgs)
  })

  it('computes insights and the yearly saving of a cleanup list', () => {
    const senders = aggregate(msgs)
    const none = insights(senders)
    expect(none.listShare).toBeGreaterThan(0.5)
    expect(none.neverOpened.every((s) => s.category !== 'people' && s.unread / s.count >= 0.9)).toBe(true)
    expect(none.cleanupPerYear).toBe(0)
    const withList = insights(senders, new Set([senders[0]!.key]))
    expect(withList.cleanupPerYear).toBeGreaterThan(50)
  })
})

describe('filter exports', () => {
  const senders = aggregate(demoMessages()).slice(0, 2)
  const person = aggregate(demoMessages()).find((s) => s.key.includes('@'))!

  it('writes an importable Gmail filters feed', () => {
    const xml = toGmailFilters([...senders, person])
    expect(xml).toContain("xmlns:apps='http://schemas.google.com/apps/2006'")
    expect(xml.match(/<entry>/g)).toHaveLength(3)
    expect(xml).toContain(`value='${senders[0]!.domain}'`)
    expect(xml).toContain("name='shouldArchive' value='true'")
    expect(new DOMParser().parseFromString(xml, 'application/xml').querySelector('parsererror')).toBeNull()
  })

  it('writes a Sieve script with domain and address tests', () => {
    const sieve = toSieve([...senders, person])
    expect(sieve).toContain('require ["fileinto", "imap4flags"];')
    expect(sieve).toContain(`address :domain :is "from" ["${senders[0]!.domain}"`)
    expect(sieve).toContain(`address :is "from" ["${person.key}"]`)
    expect(sieve).toContain(String.raw`addflag "\\Seen";`)
    expect(toSieve([])).toBe('# No senders selected\n')
  })
})

describe('IMAP relay', () => {
  it('validates requests', () => {
    expect(validate({ host: 'imap.mail.yahoo.com', email: 'a@b.c', password: 'x' })).toMatchObject({ host: 'imap.mail.yahoo.com', limit: 2000, mailbox: 'INBOX' })
    expect(validate({ host: '127.0.0.1', email: 'a@b.c', password: 'x' })).toMatch(/server name/)
    expect(validate({ host: 'localhost', email: 'a@b.c', password: 'x' })).toMatch(/server name/)
    expect(validate({ host: 'imap.x.com', email: '', password: 'x' })).toMatch(/email/)
    expect(validate({ host: 'imap.x.com', email: 'a@b.c', password: 'x', limit: 99999 })).toMatch(/between/)
    expect(validate({ host: 'imap.x.com', email: 'a@b.c', password: 'x', mailbox: 'IN\r\nBOX' })).toMatch(/mailbox/)
  })

  it('refuses private, loopback and link-local addresses', () => {
    for (const a of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '172.20.0.1', '192.168.1.1', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1'])
      expect(isPrivateAddress(a), a).toBe(true)
    for (const a of ['142.250.1.108', '87.248.100.215', '2a00:1450:4001::6d']) expect(isPrivateAddress(a), a).toBe(false)
  })

  it('only resolves hosts whose every address is public', async () => {
    expect(await resolvePublic('ok.test', async () => [{ address: '142.250.1.108', family: 4 }])).toBe('142.250.1.108')
    expect(await resolvePublic('rebind.test', async () => [{ address: '142.250.1.108', family: 4 }, { address: '10.0.0.5', family: 4 }])).toBeNull()
    expect(
      await resolvePublic('nx.test', async () => {
        throw new Error('ENOTFOUND')
      }),
    ).toBeNull()
  })

  it('rate-limits per IP', () => {
    const now = 1_000_000
    for (let i = 0; i < 8; i++) expect(allow('9.9.9.9', now + i)).toBe(true)
    expect(allow('9.9.9.9', now + 9)).toBe(false)
    expect(allow('9.9.9.9', now + 11 * 60_000)).toBe(true)
  })

  let ipSeq = 0
  const req = (body: unknown, headers: Record<string, string> = {}) =>
    new Request('https://app.example/api/imap', {
      method: 'POST',
      headers: { origin: 'https://app.example', host: 'app.example', 'x-forwarded-for': `203.0.113.${++ipSeq}`, ...headers },
      body: JSON.stringify(body),
    })
  const resolver = async () => [{ address: '142.250.1.108', family: 4 }]
  const good = { host: 'imap.gmail.com', email: 'me@gmail.com', password: 'abcd efgh ijkl mnop', limit: 10 }

  it('returns headers from the fetcher and pins the checked address', async () => {
    let pinned = ''
    const res = await handle(req(good), {
      resolver,
      fetcher: async (r, address) => {
        pinned = address
        expect(r.host).toBe('imap.gmail.com')
        return { total: 1, messages: [{ h: 'From: A <a@x.example>\r\nSubject: Hi\r\n', seen: false, date: 1 }] }
      },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(pinned).toBe('142.250.1.108')
    expect((await res.json()).messages).toHaveLength(1)
  })

  it('rejects cross-origin calls, bad input, private hosts and failed logins', async () => {
    expect((await handle(req(good, { origin: 'https://evil.example' }), { resolver })).status).toBe(403)
    expect((await handle(req(good, { origin: 'null' }), { resolver })).status).toBe(403)
    expect((await handle(req({ ...good, host: 'not a host' }), { resolver })).status).toBe(400)
    expect((await handle(req(good), { resolver: async () => [{ address: '10.0.0.1', family: 4 }] })).status).toBe(400)
    const auth = await handle(req(good), {
      resolver,
      fetcher: async () => {
        throw Object.assign(new Error('x'), { authenticationFailed: true })
      },
    })
    expect(auth.status).toBe(401)
    expect(await auth.text()).not.toContain(good.password)
  })
})

describe('provider clients', () => {
  it('turns relay headers into messages with read state', () => {
    const [m] = relayToMeta([{ h: 'From: "Souk" <news@souk.example>\r\nList-Unsubscribe: <https://souk.example/u>\r\nDate: Tue, 7 Oct 2026 09:00:00 +0000\r\n', seen: false }])
    expect(m).toMatchObject({ fromEmail: 'news@souk.example', unsubHttp: 'https://souk.example/u', labels: ['unread'] })
    expect(PROVIDERS.find((p) => p.id === 'yahoo')?.host).toBe('imap.mail.yahoo.com')
  })

  it('surfaces relay errors', async () => {
    const f = (async () => new Response(JSON.stringify({ message: 'The server refused the login.' }), { status: 401 })) as unknown as typeof fetch
    await expect(fetchViaImap({ host: 'imap.x.com', email: 'a@b.c', password: 'p', limit: 5 }, f)).rejects.toThrow('refused the login')
  })

  it('maps Microsoft Graph messages', () => {
    const m = metaFromGraph({
      subject: 'Deals',
      receivedDateTime: '2026-10-06T10:00:00Z',
      isRead: false,
      inferenceClassification: 'other',
      from: { emailAddress: { name: 'Souk', address: 'news@souk.example' } },
      internetMessageHeaders: [{ name: 'List-Unsubscribe', value: '<mailto:u@souk.example>' }],
    })!
    expect(m).toMatchObject({ fromName: 'Souk', fromEmail: 'news@souk.example', date: Date.UTC(2026, 9, 6, 10), unsubMailto: 'mailto:u@souk.example' })
    expect(m.labels).toEqual(['unread', 'category updates'])
    expect(metaFromGraph({})).toBeNull()
  })

  it('pages Graph results and falls back when headers are refused', async () => {
    const calls: string[] = []
    const f = (async (url: string) => {
      calls.push(url)
      if (url.includes('internetMessageHeaders')) return new Response('', { status: 403 })
      const page = url.includes('skip')
        ? { value: [{ from: { emailAddress: { address: 'c@x.example' } } }] }
        : { value: [{ from: { emailAddress: { address: 'a@x.example' } } }, { from: { emailAddress: { address: 'b@x.example' } } }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/messages?$skip=2' }
      return new Response(JSON.stringify(page))
    }) as unknown as typeof fetch
    const out = await fetchOutlookMetadata('t', { limit: 10, fetchImpl: f })
    expect(out.map((m) => m.fromEmail)).toEqual(['a@x.example', 'b@x.example', 'c@x.example'])
    expect(calls[0]).toContain('internetMessageHeaders')
    expect(calls[1]).not.toContain('internetMessageHeaders')
  })
})
