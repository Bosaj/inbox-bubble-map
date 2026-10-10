import { useCallback, useEffect, useState } from 'react'
import { Archive, BellOff, Check, ExternalLink, Inbox, Loader2, Mail, MailCheck, MailOpen, OctagonAlert, RefreshCw, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react'
import type { Sender } from '../lib/aggregate'
import { AuthExpired, MailError, parseMailto, readerDocument, type MailAction, type MailItem, type Mailbox, type MailBody } from '../lib/mailbox'
import { useI18n, type Strings } from '../i18n'
import { ago, Button, CloseButton, dateTimeFmt, LinkButton, Modal, num } from './ui'

export type BulkAction = Exclude<MailAction, 'unread'>
export const BULK_ACTIONS: BulkAction[] = ['read', 'archive', 'trash', 'spam']

/** Called after the provider confirmed an action, so the map can update. */
export type OnApplied = (action: MailAction, emails: string[], count: number, ids?: string[]) => void

export function errorText(err: unknown, t: Strings): string {
  if (err instanceof AuthExpired) return t.errors.expired!
  if (err instanceof MailError) return t.errors[err.code] ?? err.message
  const msg = (err as Error)?.message
  return msg && !/^(Gmail API|Microsoft Graph) \d+$/.test(msg) ? msg : t.errors.generic!
}

const ICON: Record<MailAction, typeof Mail> = { read: MailCheck, unread: Mail, archive: Archive, trash: Trash2, spam: OctagonAlert }

function isDark() {
  const forced = document.documentElement.dataset.theme
  return forced ? forced === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches
}

/** Error line with a "Sign in again" button when the token expired. */
function ErrorLine({ error, mailbox, onRetry }: { error: unknown; mailbox: Mailbox; onRetry: () => void }) {
  const { t } = useI18n()
  return (
    <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] px-3 py-2 text-[13px]">
      <span className="flex-1">{t.failed(errorText(error, t))}</span>
      {error instanceof AuthExpired && mailbox.reauth && (
        <Button
          size="sm"
          onClick={async () => {
            await mailbox.reauth!()
            onRetry()
          }}
        >
          <RefreshCw size={14} /> {t.signInAgain}
        </Button>
      )}
    </div>
  )
}

/* ---------- confirmation ---------- */

export function ConfirmAction({
  open,
  title,
  body,
  note,
  confirmLabel,
  danger,
  busy,
  progress,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  body: string
  note?: string
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  progress?: string | null
  onConfirm: () => void
  onClose: () => void
}) {
  const { t } = useI18n()
  return (
    <Modal open={open} onClose={() => !busy && onClose()} label={title}>
      <div className="p-6">
        <h2 className="text-[18px] font-semibold leading-snug">{title}</h2>
        <p className="mt-2 text-[14px] text-ink-2">{body}</p>
        {note && <p className="mt-2 text-[12.5px] text-ink-3">{note}</p>}
        {progress && (
          <p role="status" className="tabular mt-3 flex items-center gap-2 text-[13px] text-ink-2">
            <Loader2 size={14} className="animate-spin" /> {progress}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t.cancel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy} autoFocus>
            {busy && <Loader2 size={15} className="animate-spin" />} {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/* ---------- reader ---------- */

function Reader({ mailbox, item, onClose, onApplied, emails }: { mailbox: Mailbox; item: MailItem; onClose: () => void; onApplied: (action: MailAction, item: MailItem) => void; emails: string[] }) {
  const { t } = useI18n()
  const [body, setBody] = useState<MailBody | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState<MailAction | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let live = true
    setBody(null)
    setError(null)
    mailbox.body(item.id).then(
      (b) => live && setBody(b),
      (e) => live && setError(e),
    )
    return () => {
      live = false
    }
  }, [mailbox, item.id, nonce])

  const run = async (action: MailAction) => {
    setBusy(action)
    setError(null)
    try {
      await mailbox.act([item.id], action)
      onApplied(action, item)
      if (action !== 'read' && action !== 'unread') onClose()
    } catch (e) {
      setError(e)
    } finally {
      setBusy(null)
    }
  }

  const empty = body && !body.html && !(body.text ?? '').trim()
  const actions: MailAction[] = [item.unread ? 'read' : 'unread', 'archive', 'trash', 'spam']
  return (
    <div className="flex max-h-[92dvh] flex-col">
      <header className="flex items-start gap-3 border-b border-line p-5">
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-semibold leading-snug">
            <bdi>{body?.subject || item.subject || t.noSubject}</bdi>
          </h2>
          <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12.5px]">
            <dt className="text-ink-3">{t.from}</dt>
            <dd className="truncate">
              <bdi>{body?.from ?? item.from}</bdi>
            </dd>
            {body?.to && (
              <>
                <dt className="text-ink-3">{t.to}</dt>
                <dd className="truncate">
                  <bdi>{body.to}</bdi>
                </dd>
              </>
            )}
            <dt className="text-ink-3">{t.date}</dt>
            <dd className="tabular">{dateTimeFmt(body?.date ?? item.date)}</dd>
          </dl>
        </div>
        <CloseButton label={t.close} onClick={onClose} />
      </header>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-5 py-2.5">
        {actions.map((a) => {
          const Icon = ICON[a]
          return (
            <Button key={a} size="sm" variant={a === 'trash' ? 'secondary' : 'ghost'} onClick={() => run(a)} disabled={busy !== null}>
              {busy === a ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />} {t.one[a]}
            </Button>
          )
        })}
        {mailbox.webUrl && (
          <a href={mailbox.webUrl(emails)} target="_blank" rel="noreferrer noopener" className="ms-auto inline-flex min-h-9 items-center gap-1 px-2 text-[12.5px] font-medium text-accent hover:underline">
            {mailbox.kind === 'gmail' ? t.openInGmail : t.open} <ExternalLink size={12} />
          </a>
        )}
      </div>
      {error ? (
        <div className="p-5">
          <ErrorLine error={error} mailbox={mailbox} onRetry={() => setNonce((n) => n + 1)} />
        </div>
      ) : null}
      <div className="min-h-[50dvh] flex-1 overflow-hidden bg-white">
        {!body && !error && (
          <p className="flex items-center justify-center gap-2 p-10 text-[13px] text-neutral-500">
            <Loader2 size={15} className="animate-spin" /> {t.loadingMail}
          </p>
        )}
        {empty && <p className="p-10 text-center text-[13px] text-neutral-500">{t.noContent}</p>}
        {body && !empty && (
          <iframe
            title={t.reader}
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            srcDoc={readerDocument(body, isDark())}
            className="block h-[60dvh] w-full border-0"
          />
        )}
      </div>
      <p className="flex items-center gap-1.5 border-t border-line px-5 py-2.5 text-[11.5px] text-ink-3">
        <ShieldCheck size={13} className="shrink-0 text-people" /> {t.imagesBlocked}
      </p>
    </div>
  )
}

/* ---------- messages from one sender + bulk actions ---------- */

export function MailSection({ sender, mailbox, onApplied }: { sender: Sender; mailbox: Mailbox | null; onApplied: OnApplied }) {
  const { t } = useI18n()
  const [items, setItems] = useState<MailItem[] | null>(null)
  const [total, setTotal] = useState(0)
  const [limit, setLimit] = useState(10)
  const [error, setError] = useState<unknown>(null)
  const [open, setOpen] = useState<MailItem | null>(null)
  const [confirm, setConfirm] = useState<{ action: BulkAction; ids: string[] | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const emails = sender.emails

  useEffect(() => {
    if (!mailbox) return
    let live = true
    setError(null)
    mailbox.list(emails, limit).then(
      (page) => {
        if (!live) return
        setItems(page.items)
        setTotal(page.total)
      },
      (e) => live && setError(e),
    )
    return () => {
      live = false
    }
    // emails change with the sender key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mailbox, sender.key, limit, nonce])

  const ask = useCallback(
    async (action: BulkAction) => {
      if (!mailbox) return
      setConfirm({ action, ids: null })
      setProgress(t.counting)
      setError(null)
      try {
        const ids = await mailbox.ids(emails)
        setConfirm({ action, ids })
      } catch (e) {
        setConfirm(null)
        setError(e)
      } finally {
        setProgress(null)
      }
    },
    [mailbox, emails, t.counting],
  )

  if (!mailbox) {
    return (
      <section className="mt-6 rounded-2xl border border-dashed border-line-strong p-4 text-[13px] text-ink-3">
        <p className="flex items-start gap-2">
          <Inbox size={16} className="mt-0.5 shrink-0" /> {t.mailConnectHint}
        </p>
      </section>
    )
  }

  const runBulk = async () => {
    if (!confirm?.ids) return
    const { action, ids } = confirm
    setBusy(true)
    try {
      const done = await mailbox.act(ids, action, (d) => setProgress(t.working(num(d), num(ids.length))))
      setConfirm(null)
      onApplied(action, emails, done)
      if (action === 'read') setItems((list) => list?.map((x) => ({ ...x, unread: false })) ?? null)
      else setItems([])
    } catch (e) {
      setConfirm(null)
      setError(e)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const unread = items?.filter((x) => x.unread).length ?? 0
  return (
    <section className="mt-6" aria-labelledby="mail-title">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 id="mail-title" className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">
          {t.mailTitle}
        </h3>
        {items && <span className="tabular text-[12px] text-ink-3">{t.mailTotal(num(total))}</span>}
      </div>
      {mailbox.kind === 'demo' && <p className="mb-2 text-[12px] text-ink-3">{t.mailDemoNote}</p>}

      <div className="mb-3 flex flex-wrap gap-1.5">
        {BULK_ACTIONS.map((a) => {
          const Icon = ICON[a]
          return (
            <Button key={a} size="sm" variant="secondary" disabled={!items?.length || busy || (a === 'read' && !unread && total <= (items?.length ?? 0))} onClick={() => ask(a)} className="whitespace-nowrap">
              <Icon size={14} className={a === 'trash' || a === 'spam' ? 'text-[var(--danger)]' : 'text-accent'} /> {t.bulk[a]}
            </Button>
          )
        })}
      </div>

      {error ? <ErrorLine error={error} mailbox={mailbox} onRetry={() => setNonce((n) => n + 1)} /> : null}

      {!items && !error && (
        <p className="flex items-center gap-2 py-3 text-[13px] text-ink-3">
          <Loader2 size={14} className="animate-spin" /> {t.mailLoading}
        </p>
      )}
      {items && items.length === 0 && <p className="rounded-xl bg-surface-2 px-3 py-3 text-[13px] text-ink-3">{t.mailEmpty}</p>}
      {items && items.length > 0 && (
        <ul className="-mx-2">
          {items.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => setOpen(m)} className="press flex w-full items-start gap-2.5 rounded-xl px-2 py-2 text-start hover:bg-surface-2">
                <span className="mt-1.5 grid size-2 shrink-0 place-items-center">{m.unread && <span className="size-2 rounded-full bg-accent" aria-label={t.unreadDot} />}</span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-[13.5px] ${m.unread ? 'font-semibold' : ''}`} dir="auto">
                    {m.subject || t.noSubject}
                  </span>
                  {m.snippet && (
                    <span className="block truncate text-[12px] text-ink-3" dir="auto">
                      {m.snippet}
                    </span>
                  )}
                </span>
                <span className="tabular shrink-0 text-[11.5px] text-ink-3">{ago(m.date)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {items && total > items.length && (
        <Button size="sm" variant="ghost" className="mt-1 w-full" onClick={() => setLimit((l) => l + 20)}>
          <MailOpen size={14} /> {t.mailMore}
        </Button>
      )}

      <Modal open={open !== null} onClose={() => setOpen(null)} label={t.reader} wide>
        {open && (
          <Reader
            mailbox={mailbox}
            item={open}
            emails={emails}
            onClose={() => setOpen(null)}
            onApplied={(action, item) => {
              onApplied(action, emails, 1, [item.id])
              if (action === 'read' || action === 'unread') {
                setItems((list) => list?.map((x) => (x.id === item.id ? { ...x, unread: action === 'unread' } : x)) ?? null)
                setOpen((o) => (o ? { ...o, unread: action === 'unread' } : o))
              } else {
                setItems((list) => list?.filter((x) => x.id !== item.id) ?? null)
                setTotal((n) => Math.max(0, n - 1))
              }
            }}
          />
        )}
      </Modal>

      <ConfirmAction
        open={confirm !== null}
        title={confirm ? t.confirmTitle[confirm.action] : ''}
        body={confirm?.ids ? t.confirmBody(confirm.action, num(confirm.ids.length), sender.label) : t.counting}
        note={confirm && confirm.action !== 'read' ? t.confirmPopNote : undefined}
        confirmLabel={confirm ? t.bulk[confirm.action] : ''}
        danger={confirm?.action === 'trash' || confirm?.action === 'spam'}
        busy={busy || !confirm?.ids}
        progress={progress}
        onConfirm={runBulk}
        onClose={() => setConfirm(null)}
      />
    </section>
  )
}

/* ---------- unsubscribe ---------- */

type UnsubState = 'idle' | 'busy' | 'done' | 'mailed' | 'failed'

export function UnsubscribeActions({ sender: s, mailbox }: { sender: Sender; mailbox: Mailbox | null }) {
  const { t } = useI18n()
  const [state, setState] = useState<UnsubState>('idle')
  const [ask, setAsk] = useState<'oneclick' | 'mail' | null>(null)
  const mailto = s.unsubMailto ? parseMailto(s.unsubMailto) : null
  const canOneClick = Boolean(s.oneClick && s.unsubHttp?.startsWith('https://'))
  const canMail = Boolean(mailto && mailbox?.sendMail)
  let host = ''
  try {
    host = s.unsubHttp ? new URL(s.unsubHttp).hostname : ''
  } catch {
    /* malformed header */
  }

  const oneClick = async () => {
    setState('busy')
    try {
      if (mailbox?.kind === 'demo') await new Promise((r) => setTimeout(r, 500))
      else {
        const res = await fetch('/api/unsubscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: s.unsubHttp }) })
        if (!res.ok) throw new Error('refused')
      }
      setState('done')
    } catch {
      setState('failed')
    } finally {
      setAsk(null)
    }
  }

  const sendMail = async () => {
    if (!mailto || !mailbox?.sendMail) return
    setState('busy')
    try {
      await mailbox.sendMail(mailto.to, mailto.subject, mailto.body)
      setState('mailed')
    } catch {
      setState('failed')
    } finally {
      setAsk(null)
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {canOneClick && state !== 'done' && (
          <Button size="sm" variant="primary" className="min-h-10 rounded-xl" disabled={state === 'busy'} onClick={() => setAsk('oneclick')}>
            {state === 'busy' ? <Loader2 size={14} className="animate-spin" /> : <BellOff size={14} />} {t.unsubOneClick}
          </Button>
        )}
        {!canOneClick && canMail && state !== 'mailed' && (
          <Button size="sm" variant="primary" className="min-h-10 rounded-xl" disabled={state === 'busy'} onClick={() => setAsk('mail')}>
            {state === 'busy' ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} {t.unsubSendEmail}
          </Button>
        )}
        {s.unsubHttp && (!canOneClick || state === 'failed') && (
          <LinkButton href={s.unsubHttp} variant={canMail ? 'secondary' : 'primary'}>
            {t.unsubscribe} <ExternalLink size={14} />
          </LinkButton>
        )}
        {s.unsubMailto && !canMail && (
          <LinkButton href={s.unsubMailto}>
            <Mail size={14} /> {t.unsubByEmail}
          </LinkButton>
        )}
      </div>
      {(state === 'done' || state === 'mailed') && (
        <p role="status" className="enter mt-2 flex items-center gap-2 rounded-xl bg-[color-mix(in_srgb,var(--c-people)_14%,transparent)] px-3 py-2 text-[13px]">
          <Check size={15} className="shrink-0 text-people" /> {state === 'done' ? t.unsubDone : t.unsubMailSent}
        </p>
      )}
      {state === 'failed' && (
        <p role="alert" className="enter mt-2 flex items-center gap-2 rounded-xl bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] px-3 py-2 text-[13px]">
          <ShieldAlert size={15} className="shrink-0 text-[var(--danger)]" /> {t.unsubFailed}
        </p>
      )}
      <ConfirmAction
        open={ask !== null}
        title={t.unsubConfirmTitle}
        body={ask === 'oneclick' ? t.unsubConfirmOneClick(host) : t.unsubConfirmMail(mailto?.to ?? '')}
        confirmLabel={ask === 'oneclick' ? t.unsubOneClick : t.unsubSendEmail}
        busy={state === 'busy'}
        onConfirm={ask === 'oneclick' ? oneClick : sendMail}
        onClose={() => setAsk(null)}
      />
    </>
  )
}
