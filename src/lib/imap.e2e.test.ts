// @vitest-environment node
/**
 * End-to-end check of the IMAP relay actions against a local GreenMail server.
 * Skipped unless GREENMAIL=1. Start one with:
 *   docker run -d --name greenmail -p 3993:3993 -e GREENMAIL_OPTS="-Dgreenmail.setup.test.all
 *     -Dgreenmail.hostname=0.0.0.0 -Dgreenmail.users=test:secret@local.test -Dgreenmail.users.login=email"
 *     greenmail/standalone:2.1.3
 * Same relay code as production; only the connection (local host, self-signed cert, port 3993) differs.
 */
import { ImapFlow } from 'imapflow'
import { beforeAll, describe, expect, it } from 'vitest'
import { runImap, type RelayRequest } from '../../api/imap'

const on = Boolean(process.env.GREENMAIL)
const client = () =>
  new ImapFlow({ host: '127.0.0.1', servername: 'localhost', port: 3993, secure: true, tls: { rejectUnauthorized: false }, auth: { user: 'test@local.test', pass: 'secret' }, logger: false, disableAutoIdle: true })
const base = { host: 'imap.local.test', email: 'test@local.test', password: 'secret', mailbox: 'INBOX' }
const run = (req: Partial<RelayRequest>) => runImap(client(), { ...base, ...req } as RelayRequest)

function raw(from: string, subject: string, html: string) {
  return [
    `From: "Souk" <${from}>`,
    'To: test@local.test',
    `Subject: ${subject}`,
    'Date: Fri, 09 Oct 2026 10:00:00 +0000',
    'List-Unsubscribe: <https://souk.example/u>',
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="b1"',
    '',
    '--b1',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Salam, plain part',
    '--b1',
    'Content-Type: text/html; charset=utf-8',
    '',
    html,
    '--b1--',
    '',
  ].join('\r\n')
}

describe.skipIf(!on)('IMAP relay against GreenMail', () => {
  beforeAll(async () => {
    const c = client()
    await c.connect()
    for (let i = 0; i < 4; i++) await c.append('INBOX', raw('news@souk.example', `Deal ${i}`, `<p>Offer <b>${i}</b></p>`))
    await c.append('INBOX', raw('friend@people.example', 'Hi', '<p>Hello</p>'))
    await c.logout()
  })

  it('reads headers with uids', async () => {
    const r = (await run({ action: 'headers', limit: 50 })) as { messages: { h: string; uid: number }[] }
    expect(r.messages.length).toBeGreaterThanOrEqual(5)
    expect(r.messages.every((m) => m.uid > 0)).toBe(true)
  })

  it('lists, counts and opens one sender’s mail', async () => {
    const list = (await run({ action: 'list', emails: ['news@souk.example'], limit: 2 })) as { items: { id: string; subject: string; unread: boolean }[]; total: number }
    expect(list.total).toBe(4)
    expect(list.items).toHaveLength(2)
    expect(list.items[0]!.unread).toBe(true)
    const ids = (await run({ action: 'ids', emails: ['news@souk.example'], limit: 100 })) as { ids: string[] }
    expect(ids.ids).toHaveLength(4)
    const body = (await run({ action: 'body', uid: Number(list.items[0]!.id) })) as { html: string; text: string; subject: string }
    expect(body.html).toContain('<b>')
    expect(body.text).toContain('Salam')
    expect(body.subject).toMatch(/^Deal/)
  })

  it('marks read, then moves mail to trash and archive folders', async () => {
    const { ids } = (await run({ action: 'ids', emails: ['news@souk.example'], limit: 100 })) as { ids: string[] }
    const uids = ids.map(Number)
    expect(await run({ action: 'act', op: 'read', uids })).toMatchObject({ done: 4 })
    const after = (await run({ action: 'list', emails: ['news@souk.example'], limit: 10 })) as { items: { unread: boolean }[] }
    expect(after.items.every((x) => !x.unread)).toBe(true)
    const trash = (await run({ action: 'act', op: 'trash', uids: uids.slice(0, 2) })) as { done: number; folder: string }
    expect(trash.done).toBe(2)
    expect(trash.folder).toBeTruthy()
    const archive = (await run({ action: 'act', op: 'archive', uids: uids.slice(2) })) as { done: number; folder: string }
    expect(archive.done).toBe(2)
    const left = (await run({ action: 'list', emails: ['news@souk.example'], limit: 10 })) as { total: number }
    expect(left.total).toBe(0)
    const friend = (await run({ action: 'list', emails: ['friend@people.example'], limit: 10 })) as { total: number }
    expect(friend.total).toBe(1)
  })

  it('refuses a bad password', async () => {
    const bad = new ImapFlow({ host: '127.0.0.1', port: 3993, secure: true, tls: { rejectUnauthorized: false }, auth: { user: 'test@local.test', pass: 'nope' }, logger: false })
    await expect(runImap(bad, { ...base, action: 'headers' } as RelayRequest)).rejects.toMatchObject({ authenticationFailed: true })
  })
})
