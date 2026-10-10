import { describe, expect, it } from 'vitest'
import { applyToMessages, cleanSender, demoMailbox, parseMailto, readerDocument } from './mailbox'
import { fetchGmailMetadata, findBodies, fromQuery, gmailMailbox, isRateLimit, metaFromGmail } from './gmail'
import { fromFilter, outlookMailbox } from './outlook'
import { imapMailbox } from './providers'
import { demoMessages } from './demo'
import { pickFolder, validate } from '../../api/imap'
import { allowUnsub, checkUrl, handleUnsub } from '../../api/unsubscribe'
import { STRINGS } from '../i18n'
import type { MessageMeta } from './headers'

type Call = { url: string; method: string; body?: string }
function fakeFetch(handler: (c: Call) => unknown, calls: Call[] = []) {
  return (async (url: string, init: RequestInit = {}) => {
    const c = { url, method: init.method ?? 'GET', body: init.body as string | undefined }
    calls.push(c)
    const out = handler(c)
    if (out instanceof Response) return out
    return new Response(out === undefined ? '' : JSON.stringify(out), { status: 200 })
  }) as unknown as typeof fetch
}

const b64url = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

describe('mailbox helpers', () => {
  const msgs = demoMessages().map((m, i) => ({ ...m, id: `demo-${i}` }))
  const souk = 'news@mail.soukdeals.example'

  it('removes archived mail and flips read state on the loaded headers', () => {
    const before = msgs.filter((m) => m.fromEmail === souk).length
    expect(before).toBeGreaterThan(10)
    expect(applyToMessages(msgs, [souk], 'archive').some((m) => m.fromEmail === souk)).toBe(false)
    const read = applyToMessages(msgs, [souk], 'read').filter((m) => m.fromEmail === souk)
    expect(read.every((m) => m.labels.includes('opened') && !m.labels.includes('unread'))).toBe(true)
    const one = msgs.find((m) => m.fromEmail === souk)!
    expect(applyToMessages(msgs, [souk], 'trash', new Set([one.id!])).length).toBe(msgs.length - 1)
  })

  it('parses mailto unsubscribe links', () => {
    expect(parseMailto('mailto:unsub@list.example?subject=remove%20me')).toEqual({ to: 'unsub@list.example', subject: 'remove me', body: 'unsubscribe' })
    expect(parseMailto('mailto:not-an-address')).toBeNull()
    expect(parseMailto('https://x.example')).toBeNull()
  })

  it('wraps untrusted HTML with a CSP that blocks remote content and scripts', () => {
    const doc = readerDocument({ html: '<meta http-equiv="refresh" content="0;url=https://evil.example"><img src="https://t.example/p.gif"><p>Hi</p>' }, false)
    expect(doc).toContain("default-src 'none'; img-src data: cid:")
    expect(doc).not.toContain('http-equiv="refresh"')
    expect(doc).toContain('<base target="_blank">')
    const text = readerDocument({ text: 'Visit https://a.example/x <now>' }, true)
    expect(text).toContain('&lt;now&gt;')
    expect(text).toContain('<a href="https://a.example/x"')
  })

  it('runs the demo mailbox end to end', async () => {
    let current: MessageMeta[] = msgs
    const box = demoMailbox(() => current)
    const page = await box.list([souk], 5)
    expect(page.items).toHaveLength(5)
    expect(page.total).toBeGreaterThan(5)
    expect((await box.body(page.items[0]!.id)).html).toContain('demo message')
    const progress: number[] = []
    const done = await cleanSender(box, [souk], 'trash', (d) => progress.push(d))
    expect(done).toBe(page.total)
    expect(progress.at(-1)).toBe(done)
    current = applyToMessages(current, [souk], 'trash')
    expect((await box.list([souk])).total).toBe(0)
  })
})

describe('Gmail mailbox', () => {
  it('builds from: queries and maps metadata ids', () => {
    expect(fromQuery(['a@x.com', 'b@y.com'])).toBe('from:(a@x.com OR b@y.com)')
    expect(metaFromGmail({ id: 'm1', payload: { headers: [{ name: 'From', value: 'A <a@x.com>' }] } }).id).toBe('m1')
  })

  it('lists, reads (decoding base64url bodies) and acts with batchModify / trash', async () => {
    const calls: Call[] = []
    const f = fakeFetch((c) => {
      if (c.url.includes('/messages?maxResults')) return { messages: [{ id: 'a' }, { id: 'b' }], resultSizeEstimate: 2 }
      if (c.url.includes('format=metadata')) return { id: 'a', labelIds: ['UNREAD'], internalDate: '1700000000000', snippet: 'Hello', payload: { headers: [{ name: 'Subject', value: 'Deals' }, { name: 'From', value: 'Souk <s@x.com>' }] } }
      if (c.url.includes('format=full'))
        return {
          id: 'a',
          internalDate: '1700000000000',
          payload: {
            mimeType: 'multipart/alternative',
            headers: [{ name: 'Subject', value: 'Deals' }],
            parts: [
              { mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset=UTF-8' }], body: { data: b64url('Salam 👋') } },
              { mimeType: 'text/html', headers: [{ name: 'Content-Type', value: 'text/html; charset=UTF-8' }], body: { data: b64url('<b>Salam</b> é') } },
            ],
          },
        }
      return {}
    }, calls)
    const box = gmailMailbox('tok', 'client', f)
    const page = await box.list(['s@x.com'], 2)
    expect(page.items[0]).toMatchObject({ id: 'a', subject: 'Deals', unread: true, snippet: 'Hello' })
    expect(calls[0]!.url).toContain(encodeURIComponent('from:(s@x.com)'))
    const body = await box.body('a')
    expect(body.html).toBe('<b>Salam</b> é')
    expect(body.text).toBe('Salam 👋')

    calls.length = 0
    expect(await box.act(['a', 'b'], 'archive')).toBe(2)
    expect(calls[0]).toMatchObject({ method: 'POST' })
    expect(JSON.parse(calls[0]!.body!)).toEqual({ ids: ['a', 'b'], removeLabelIds: ['INBOX'] })
    calls.length = 0
    await box.act(['a', 'b'], 'trash')
    expect(calls.map((c) => c.url.split('/messages/')[1])).toEqual(['a/trash', 'b/trash'])
    calls.length = 0
    await box.act(['a'], 'spam')
    expect(JSON.parse(calls[0]!.body!)).toEqual({ ids: ['a'], addLabelIds: ['SPAM'], removeLabelIds: ['INBOX'] })
  })

  it('finds bodies but skips attachments', () => {
    const found = findBodies({ mimeType: 'multipart/mixed', parts: [{ mimeType: 'text/html', filename: 'invoice.html' }, { mimeType: 'text/plain', filename: '' }] })
    expect(found.html).toBeUndefined()
    expect(found.text).toBeDefined()
  })

  it('reports an expired token so the UI can offer to sign in again', async () => {
    const box = gmailMailbox('tok', 'client', fakeFetch(() => new Response('', { status: 401 })))
    await expect(box.list(['a@x.com'])).rejects.toMatchObject({ code: 'expired' })
  })
})

describe('Outlook mailbox', () => {
  it('filters by sender and batches moves to archive / deleted items / junk', async () => {
    expect(fromFilter(["o'brien@x.com"])).toBe("from/emailAddress/address eq 'o''brien@x.com'")
    const calls: Call[] = []
    const f = fakeFetch((c) => (c.url.includes('$batch') ? { responses: JSON.parse(c.body!).requests.map(() => ({ status: 201 })) } : { value: [{ id: '1' }, { id: '2' }] }), calls)
    const box = outlookMailbox(async () => 'tok', f)
    expect(await box.ids(['a@x.com'])).toEqual(['1', '2'])
    expect(await box.act(['1', '2'], 'trash')).toBe(2)
    const batch = JSON.parse(calls.at(-1)!.body!)
    expect(batch.requests[0]).toMatchObject({ method: 'POST', url: '/me/messages/1/move', body: { destinationId: 'deleteditems' } })
    await box.act(['1'], 'read')
    expect(JSON.parse(calls.at(-1)!.body!).requests[0]).toMatchObject({ method: 'PATCH', body: { isRead: true } })
  })
})

describe('IMAP relay actions', () => {
  const auth = { host: 'imap.mail.yahoo.com', email: 'a@b.c', password: 'x' }

  it('validates list, body and act requests', () => {
    expect(validate({ ...auth, action: 'list', emails: ['News@Souk.example'] })).toMatchObject({ action: 'list', emails: ['news@souk.example'], limit: 20 })
    expect(validate({ ...auth, action: 'list', emails: [] })).toMatch(/sender/)
    expect(validate({ ...auth, action: 'list', emails: ['a@b.c) OR (ALL'] })).toMatch(/sender/)
    expect(validate({ ...auth, action: 'body', uid: 0 })).toMatch(/message id/)
    expect(validate({ ...auth, action: 'act', op: 'delete', uids: [1] })).toMatch(/operation/)
    expect(validate({ ...auth, action: 'act', op: 'trash', uids: Array.from({ length: 1001 }, (_, i) => i + 1) })).toMatch(/ids/)
    expect(validate({ ...auth, action: 'act', op: 'trash', uids: [3, 4] })).toMatchObject({ op: 'trash', uids: [3, 4] })
    expect(validate({ ...auth, action: 'rm -rf' })).toMatch(/action/)
  })

  it('finds special-use folders by flag first, then by name', () => {
    const gmail = [
      { path: 'INBOX', name: 'INBOX' },
      { path: '[Gmail]/All Mail', name: 'All Mail', specialUse: '\\All' },
      { path: '[Gmail]/Trash', name: 'Trash', specialUse: '\\Trash' },
      { path: '[Gmail]/Spam', name: 'Spam', specialUse: '\\Junk' },
    ]
    expect(pickFolder(gmail, 'trash')).toBe('[Gmail]/Trash')
    expect(pickFolder(gmail, 'archive')).toBe('[Gmail]/All Mail')
    expect(pickFolder(gmail, 'spam')).toBe('[Gmail]/Spam')
    const plain = [{ path: 'INBOX', name: 'INBOX' }, { path: 'Deleted Items', name: 'Deleted Items' }, { path: 'Archives', name: 'Archives' }]
    expect(pickFolder(plain, 'trash')).toBe('Deleted Items')
    expect(pickFolder(plain, 'archive')).toBe('Archives')
    expect(pickFolder(plain, 'spam')).toBeNull()
  })

  it('sends credentials with each relay call and chunks bulk actions', async () => {
    const calls: Call[] = []
    const f = fakeFetch((c) => {
      const b = JSON.parse(c.body!)
      if (b.action === 'ids') return { ids: Array.from({ length: 1500 }, (_, i) => String(i + 1)) }
      return { done: b.uids.length }
    }, calls)
    const box = imapMailbox({ ...auth, mailbox: 'INBOX' }, f)
    const ids = await box.ids(['news@souk.example'])
    expect(await box.act(ids, 'archive')).toBe(1500)
    expect(calls).toHaveLength(3)
    expect(JSON.parse(calls[1]!.body!)).toMatchObject({ host: auth.host, password: 'x', action: 'act', op: 'archive' })
    expect(JSON.parse(calls[1]!.body!).uids).toHaveLength(1000)
  })

  it('surfaces relay error codes for translation', async () => {
    const box = imapMailbox(auth, fakeFetch(() => new Response(JSON.stringify({ error: 'folder', message: 'x' }), { status: 404 })))
    await expect(box.act(['1'], 'spam')).rejects.toMatchObject({ code: 'folder' })
    expect(STRINGS.ar.errors.folder).toBeTruthy()
  })
})

describe('one-click unsubscribe relay', () => {
  const resolver = async () => [{ address: '93.184.216.34', family: 4 }]
  const req = (body: unknown, headers: Record<string, string> = {}) =>
    new Request('https://app.example/api/unsubscribe', { method: 'POST', body: JSON.stringify(body), headers: { origin: 'https://app.example', host: 'app.example', 'x-forwarded-for': `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, ...headers } })

  it('accepts only public https URLs on the default port', () => {
    expect(checkUrl('https://list.example.com/u?id=1')?.hostname).toBe('list.example.com')
    expect(checkUrl('http://list.example.com/u')).toBeNull()
    expect(checkUrl('https://127.0.0.1/u')).toBeNull()
    expect(checkUrl('https://localhost/u')).toBeNull()
    expect(checkUrl('https://user:pw@list.example.com/u')).toBeNull()
    expect(checkUrl('https://list.example.com:8443/u')).toBeNull()
    expect(checkUrl(42)).toBeNull()
  })

  it('posts the RFC 8058 body to the pinned address and reports the result', async () => {
    let seen: { url: string; address: string } | null = null
    const ok = await handleUnsub(req({ url: 'https://list.example.com/u?id=1' }), {
      resolver,
      poster: async (u, address) => {
        seen = { url: u.toString(), address }
        return 200
      },
    })
    expect(ok.status).toBe(200)
    expect(seen).toEqual({ url: 'https://list.example.com/u?id=1', address: '93.184.216.34' })
    expect((await handleUnsub(req({ url: 'https://list.example.com/u' }), { resolver, poster: async () => 500 })).status).toBe(502)
    expect((await handleUnsub(req({ url: 'https://list.example.com/u' }), { resolver, poster: async () => Promise.reject(new Error('timeout')) })).status).toBe(504)
  })

  it('refuses other origins, private targets and floods', async () => {
    expect((await handleUnsub(req({ url: 'https://list.example.com/u' }, { origin: 'https://evil.example' }), { resolver })).status).toBe(403)
    expect((await handleUnsub(req({ url: 'https://list.example.com/u' }), { resolver: async () => [{ address: '10.0.0.5', family: 4 }] })).status).toBe(400)
    const now = Date.now()
    for (let i = 0; i < 30; i++) expect(allowUnsub('7.7.7.7', now + i)).toBe(true)
    expect(allowUnsub('7.7.7.7', now + 31)).toBe(false)
  })
})

describe('translations', () => {
  it('covers every key in French and Arabic', () => {
    const keys = (o: object): string[] => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? keys(v).map((x) => `${k}.${x}`) : [k]))
    const en = keys(STRINGS.en).sort()
    expect(keys(STRINGS.fr).sort()).toEqual(en)
    expect(keys(STRINGS.ar).sort()).toEqual(en)
    expect(STRINGS.ar.nMessages(2)).toBe('رسالتان')
    expect(STRINGS.ar.nMessages(5)).toBe('5 رسائل')
  })
})

describe('Gmail import under rate limits', () => {
  const ids = Array.from({ length: 450 }, (_, i) => `m${i}`)
  const meta = (id: string) => ({ id, internalDate: '1700000000000', labelIds: ['UNREAD'], payload: { headers: [{ name: 'From', value: `S <s${Number(id.slice(1)) % 7}@x.com>` }] } })
  const limited = () => new Response(JSON.stringify({ error: { errors: [{ reason: 'rateLimitExceeded' }] } }), { status: 403, headers: { 'retry-after': '0.01' } })

  it('backs off on 403 rateLimitExceeded, skips a broken message and streams chunks', async () => {
    let hits = 0
    const f = fakeFetch((c) => {
      if (c.url.includes('/messages?')) return { messages: ids.map((id) => ({ id })) }
      const id = c.url.split('/messages/')[1]!.split('?')[0]!
      hits++
      if (hits % 40 === 0) return limited()
      if (id === 'm7') return new Response(JSON.stringify({ error: { errors: [{ reason: 'notFound' }] } }), { status: 404 })
      return meta(id)
    })
    const chunks: number[] = []
    const out = await fetchGmailMetadata('tok', { limit: 450, perSecond: 5000, fetchImpl: f, onChunk: (m) => chunks.push(m.length), chunkEvery: 0 })
    expect(out).toHaveLength(449)
    expect(chunks[0]).toBeGreaterThanOrEqual(200)
    expect(chunks.reduce((a, b) => a + b, 0)).toBe(449)
  })

  it('stops with a translated rate-limit error when nothing gets through', async () => {
    const f = fakeFetch((c) => (c.url.includes('/messages?') ? { messages: ids.slice(0, 30).map((id) => ({ id })) } : new Response(JSON.stringify({ error: { errors: [{ reason: 'insufficientPermissions' }] } }), { status: 403 })))
    await expect(fetchGmailMetadata('tok', { limit: 30, perSecond: 5000, fetchImpl: f })).rejects.toMatchObject({ status: 403, reason: 'insufficientPermissions' })
    expect(isRateLimit(403, 'userRateLimitExceeded')).toBe(true)
    expect(isRateLimit(403, 'insufficientPermissions')).toBe(false)
    expect(isRateLimit(429)).toBe(true)
    expect(STRINGS.fr.errors.gmailRate).toBeTruthy()
  })
})
