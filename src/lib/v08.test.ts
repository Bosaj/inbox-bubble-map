// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { seal, unseal, SESSION_COOKIE, OAUTH_COOKIE } from '../../api/_lib/session'
import { callbackHandler, loginHandler, sessionHandler, type GoogleEnv } from '../../api/_lib/google'
import { applyChanges, foldHistory } from './gmail'
import { accountId, deleteAccount, loadAccount, saveAccount } from './store'
import type { MessageMeta } from './headers'

const env: GoogleEnv = { clientId: 'cid.apps.googleusercontent.com', clientSecret: 'shh', secret: 'test-secret' }
const ORIGIN = 'https://app.example'
const getCookie = (res: Response, name: string) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))?.split(';')[0]!.split('=').slice(1).join('=')

describe('sealed session cookies', () => {
  it('round-trips and rejects tampering or the wrong key', () => {
    const token = seal({ rt: 'r1', email: 'a@b.c' }, 'k1')
    expect(unseal(token, 'k1')).toEqual({ rt: 'r1', email: 'a@b.c' })
    expect(unseal(token, 'k2')).toBeNull()
    expect(unseal(token.slice(0, -2) + 'AA', 'k1')).toBeNull()
    expect(unseal(undefined, 'k1')).toBeNull()
  })
})

describe('Google sign-in (code flow + PKCE)', () => {
  it('redirects to Google with PKCE, offline access and a sealed state cookie', () => {
    const res = loginHandler(new Request(`${ORIGIN}/api/google/login?hint=me@gmail.com`), env)
    expect(res.status).toBe(302)
    const url = new URL(res.headers.get('location')!)
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/google/callback`)
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('scope')).toContain('gmail.modify')
    expect(url.searchParams.get('login_hint')).toBe('me@gmail.com')
    const cookie = res.headers.getSetCookie()[0]!
    expect(cookie).toMatch(/HttpOnly/)
    expect(cookie).toMatch(/Secure/)
    expect(cookie).toMatch(/SameSite=Lax/)
    const saved = unseal<{ state: string; verifier: string }>(getCookie(res, OAUTH_COOKIE), env.secret!)
    expect(saved?.state).toBe(url.searchParams.get('state'))
    expect(loginHandler(new Request(`${ORIGIN}/api/google/login`), { secret: null }).status).toBe(501)
  })

  it('exchanges the code, checks state and scope, and seals the refresh token', async () => {
    const login = loginHandler(new Request(`${ORIGIN}/api/google/login`), env)
    const state = new URL(login.headers.get('location')!).searchParams.get('state')!
    const oauthCookie = `${OAUTH_COOKIE}=${getCookie(login, OAUTH_COOKIE)}`
    const idToken = `x.${Buffer.from(JSON.stringify({ email: 'me@gmail.com', name: 'Me' })).toString('base64url')}.y`
    let posted = ''
    const google = (async (_u: string, init: RequestInit) => {
      posted = String(init.body)
      return new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', id_token: idToken, expires_in: 3600, scope: 'openid email https://www.googleapis.com/auth/gmail.modify' }))
    }) as unknown as typeof fetch
    const res = await callbackHandler(new Request(`${ORIGIN}/api/google/callback?code=c1&state=${state}`, { headers: { cookie: oauthCookie } }), env, google)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/?auth=google')
    expect(posted).toContain('code_verifier=')
    const session = unseal<{ rt: string; email: string }>(getCookie(res, SESSION_COOKIE), env.secret!)
    expect(session).toMatchObject({ rt: 'rt', email: 'me@gmail.com' })

    const wrongState = await callbackHandler(new Request(`${ORIGIN}/api/google/callback?code=c1&state=nope`, { headers: { cookie: oauthCookie } }), env, google)
    expect(wrongState.headers.get('location')).toBe('/?auth=failed')
    const noGmail = (async () => new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', scope: 'openid email' }))) as unknown as typeof fetch
    expect((await callbackHandler(new Request(`${ORIGIN}/api/google/callback?code=c1&state=${state}`, { headers: { cookie: oauthCookie } }), env, noGmail)).headers.get('location')).toBe('/?auth=scope')
    expect((await callbackHandler(new Request(`${ORIGIN}/api/google/callback?error=access_denied`), env, google)).headers.get('location')).toBe('/?auth=denied')
  })

  it('serves fresh access tokens, refreshes when stale, and logs out', async () => {
    const stale = `${SESSION_COOKIE}=${seal({ rt: 'rt', at: 'old', exp: Date.now() + 10_000, email: 'me@gmail.com' }, env.secret!)}`
    const headers = { cookie: stale, origin: ORIGIN, host: 'app.example' }
    const status = await sessionHandler(new Request(`${ORIGIN}/api/google/session`, { headers: { cookie: stale } }), env)
    expect(await status.json()).toEqual({ configured: true, signedIn: true, email: 'me@gmail.com', name: null })

    const refresh = (async () => new Response(JSON.stringify({ access_token: 'new', expires_in: 3600 }))) as unknown as typeof fetch
    const res = await sessionHandler(new Request(`${ORIGIN}/api/google/session`, { method: 'POST', headers }), env, refresh)
    expect((await res.json()).accessToken).toBe('new')
    expect(getCookie(res, SESSION_COOKIE)).toBeTruthy()

    const revoked = (async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })) as unknown as typeof fetch
    const gone = await sessionHandler(new Request(`${ORIGIN}/api/google/session`, { method: 'POST', headers }), env, revoked)
    expect(gone.status).toBe(401)
    expect(gone.headers.getSetCookie()[0]).toMatch(/Max-Age=0/)

    expect((await sessionHandler(new Request(`${ORIGIN}/api/google/session`, { method: 'POST', headers: { cookie: stale, origin: 'https://evil.example', host: 'app.example' } }), env)).status).toBe(403)

    let revokedToken = ''
    const revoke = (async (u: string) => {
      revokedToken = new URL(u).searchParams.get('token') ?? ''
      return new Response('{}')
    }) as unknown as typeof fetch
    const out = await sessionHandler(new Request(`${ORIGIN}/api/google/session`, { method: 'DELETE', headers }), env, revoke)
    expect(out.status).toBe(200)
    expect(revokedToken).toBe('rt')
    expect(out.headers.getSetCookie()[0]).toMatch(/Max-Age=0/)
  })
})

describe('incremental Gmail sync', () => {
  const m = (id: string, labels: string[]): MessageMeta => ({ id, fromName: 'S', fromEmail: 's@x.com', date: 1, subject: id, oneClick: false, bulk: false, labels })

  it('folds history into adds, removals and label changes', () => {
    const ch = foldHistory(
      [
        { messagesAdded: [{ message: { id: 'n1', labelIds: ['INBOX', 'UNREAD'] } }, { message: { id: 's1', labelIds: ['SENT'] } }] },
        { labelsRemoved: [{ message: { id: 'a' }, labelIds: ['UNREAD'] }] },
        { labelsAdded: [{ message: { id: 'b' }, labelIds: ['TRASH'] }] },
        { messagesDeleted: [{ message: { id: 'c' } }] },
        { labelsRemoved: [{ message: { id: 'd', labelIds: ['INBOX'] }, labelIds: ['SPAM'] }] },
      ],
      '99',
    )
    expect(ch.added.sort()).toEqual(['d', 'n1'])
    expect(ch.removed.sort()).toEqual(['b', 'c'])
    expect(ch.labels.get('a')).toEqual({ add: [], remove: ['UNREAD'] })
    expect(ch.historyId).toBe('99')
  })

  it('applies changes to cached headers', () => {
    const cached = [m('a', ['inbox', 'unread']), m('b', ['inbox', 'opened']), m('c', ['inbox', 'opened'])]
    const ch = foldHistory([{ labelsRemoved: [{ message: { id: 'a' }, labelIds: ['UNREAD'] }] }, { labelsAdded: [{ message: { id: 'b' }, labelIds: ['SPAM'] }] }], '5')
    const next = applyChanges(cached, ch, [m('n', ['inbox', 'unread'])])
    expect(next.map((x) => x.id)).toEqual(['n', 'a', 'c'])
    expect(next.find((x) => x.id === 'a')!.labels).toEqual(['inbox', 'opened'])
  })
})

describe('on-device cache', () => {
  it('saves, loads and forgets an account (memory fallback without IndexedDB)', async () => {
    const id = accountId('gmail', 'Me@Gmail.com')
    expect(id).toBe('gmail:me@gmail.com')
    await saveAccount({ id, kind: 'gmail', email: 'me@gmail.com', historyId: '7', limit: 2000, messages: [], syncedAt: 1 })
    expect((await loadAccount(id))?.historyId).toBe('7')
    await deleteAccount(id)
    expect(await loadAccount(id)).toBeNull()
  })
})

describe('whole-mailbox listing', () => {
  it('pages through every received message id when the limit is infinite', async () => {
    const urls: string[] = []
    const f = (async (url: string) => {
      urls.push(url)
      const page = Number(new URL(url).searchParams.get('pageToken') ?? 0)
      return new Response(JSON.stringify({ messages: Array.from({ length: 500 }, (_, i) => ({ id: `p${page}-${i}` })), nextPageToken: page < 2 ? String(page + 1) : undefined }))
    }) as unknown as typeof fetch
    const { listGmailIds, RECEIVED } = await import('./gmail')
    const ids = await listGmailIds('tok', Number.POSITIVE_INFINITY, { fetchImpl: f })
    expect(ids).toHaveLength(1500)
    expect(urls).toHaveLength(3)
    expect(new URL(urls[0]!).searchParams.get('q')).toBe(RECEIVED)
  })
})
