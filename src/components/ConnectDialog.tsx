import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ExternalLink, Eye, EyeOff, KeyRound, Lock, ShieldCheck, X } from 'lucide-react'
import type { Provider } from '../lib/providers'
import { Button } from './ui'
import { useI18n } from '../i18n'
import { GMAIL_SCOPE } from '../lib/gmail'
import { MS_SCOPES } from '../lib/outlook'

export interface ImapForm {
  host: string
  email: string
  password: string
  mailbox: string
  limit: number
}

interface Props {
  provider: Provider | null
  onClose: () => void
  onImap: (form: ImapForm) => void
  onGoogle?: (limit: number) => void
  onMicrosoft?: (limit: number) => void
  busy: boolean
  error: string | null
}

const LIMITS = [500, 2000, 5000]

export function ConnectDialog({ provider, onClose, onImap, onGoogle, onMicrosoft, busy, error }: Props) {
  const { t, lang } = useI18n()
  const ref = useRef<HTMLDialogElement>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [host, setHost] = useState('')
  const [mailbox, setMailbox] = useState('INBOX')
  const [limit, setLimit] = useState(2000)
  const [appPassword, setAppPassword] = useState(false)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (provider && !d.open) d.showModal()
    if (!provider && d.open) d.close()
    if (provider) {
      setHost(provider.host ?? '')
      setMailbox(provider.mailboxes?.[0]?.value ?? 'INBOX')
      setPassword('')
      setShow(false)
      setAppPassword(false)
    }
  }, [provider])

  if (!provider) return <dialog ref={ref} onClose={onClose} />

  const oauth = provider.id === 'gmail' ? onGoogle : provider.id === 'outlook' ? onMicrosoft : undefined
  const name = t.providerName[provider.id] ?? provider.name
  const steps = t.providerSteps[provider.id]
  const showForm = provider.id !== 'outlook' && (!oauth || appPassword)

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && !busy && onClose()}
      aria-labelledby="connect-title"
      className="m-auto w-[min(520px,calc(100vw-24px))] rounded-[28px] border border-line bg-surface p-0 text-ink shadow-pop backdrop:bg-black/40 backdrop:backdrop-blur-sm"
    >
      <div className="max-h-[88dvh] overflow-y-auto p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-2xl text-[17px] font-bold text-white" style={{ background: provider.color }}>
              {provider.name.charAt(0)}
            </span>
            <div>
              <h2 id="connect-title" className="text-[18px] font-semibold leading-tight">
                {t.connect(name)}
              </h2>
              <p className="text-[13px] text-ink-3">{t.providerHint[provider.id]}</p>
            </div>
          </div>
          <button type="button" aria-label={t.close} onClick={onClose} disabled={busy} className="press grid size-10 place-items-center rounded-xl text-ink-2 hover:bg-surface-2">
            <X size={18} />
          </button>
        </div>

        <label className="mb-4 flex items-center justify-between gap-3 text-[13px] text-ink-2">
          {t.limit}
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="min-h-10 rounded-xl border border-line-strong bg-surface px-2 text-[13px] text-ink">
            {LIMITS.map((l) => (
              <option key={l} value={l}>
                {l.toLocaleString(lang === 'ar' ? 'ar-MA-u-nu-latn' : lang)}
              </option>
            ))}
          </select>
        </label>

        {oauth && !appPassword && (
          <div className="space-y-3">
            <Button variant="primary" className="w-full" disabled={busy} onClick={() => oauth(limit)}>
              <ShieldCheck size={16} /> {t.signInWith(provider.id === 'gmail' ? 'Google' : 'Microsoft')}
            </Button>
            <p className="flex items-start gap-2 text-[12.5px] text-ink-3">
              <Lock size={14} className="mt-0.5 shrink-0" />
              {t.oauthNote(provider.id === 'gmail' ? GMAIL_SCOPE.split('/').pop()! : MS_SCOPES.join(', '))}
            </p>
            {provider.id === 'gmail' && (
              <button type="button" onClick={() => setAppPassword(true)} className="text-[13px] font-medium text-accent hover:underline">
                {t.useAppPassword}
              </button>
            )}
          </div>
        )}

        {provider.id === 'outlook' && !oauth && (
          <div className="space-y-3 rounded-2xl border border-line bg-surface-2 p-4 text-[13.5px] text-ink-2">
            <p>
              <strong className="text-ink">{t.outlookOffTitle}</strong> {t.outlookOff}
            </p>
            <ol className="list-decimal space-y-1 ps-5">
              {t.outlookSteps.map((step, i) => (
                <li key={i}>
                  {step(
                    <a className="font-medium text-accent hover:underline" href="https://www.thunderbird.net" target="_blank" rel="noreferrer">
                      Thunderbird
                    </a>,
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}

        {showForm && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              onImap({ host: host.trim(), email: email.trim(), password, mailbox, limit })
            }}
          >
            {(steps || provider.appPasswordUrl) && (
              <div className="flex items-start gap-2.5 rounded-2xl bg-accent-soft p-3 text-[13px]">
                <KeyRound size={16} className="mt-0.5 shrink-0 text-accent" />
                <p>
                  {steps}{' '}
                  {provider.appPasswordUrl && (
                    <a href={provider.appPasswordUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-accent hover:underline">
                      {t.createOne} <ExternalLink size={12} />
                    </a>
                  )}
                </p>
              </div>
            )}
            <label className="block">
              <span className="mb-1 block text-[12.5px] font-medium text-ink-2">{t.email}</span>
              <input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="min-h-11 w-full rounded-xl border border-line-strong bg-surface-2 px-3 text-[14px] outline-none focus:border-accent"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12.5px] font-medium text-ink-2">{t.appPassword}</span>
              <span className="relative block">
                <input
                  type={show ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="min-h-11 w-full rounded-xl border border-line-strong bg-surface-2 ps-3 pe-11 text-[14px] outline-none focus:border-accent"
                />
                <button type="button" aria-label={show ? t.hidePassword : t.showPassword} onClick={() => setShow((v) => !v)} className="absolute end-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-ink-3 hover:text-ink">
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
            </label>
            <details className="group" open={provider.id === 'other'}>
              <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium text-ink-2 hover:text-ink">
                <ChevronDown size={15} className="transition-transform group-open:rotate-180" /> {t.serverFolder}
              </summary>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-[12.5px] font-medium text-ink-2">{t.imapServer}</span>
                  <input
                    required
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder="imap.example.com"
                    className="min-h-11 w-full rounded-xl border border-line-strong bg-surface-2 px-3 text-[14px] outline-none focus:border-accent"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[12.5px] font-medium text-ink-2">{t.folder}</span>
                  {provider.mailboxes ? (
                    <select value={mailbox} onChange={(e) => setMailbox(e.target.value)} className="min-h-11 w-full rounded-xl border border-line-strong bg-surface-2 px-2 text-[14px]">
                      {provider.mailboxes.map((m) => (
                        <option key={m.value} value={m.value}>
                          {t.folders[m.value] ?? m.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input value={mailbox} onChange={(e) => setMailbox(e.target.value)} className="min-h-11 w-full rounded-xl border border-line-strong bg-surface-2 px-3 text-[14px] outline-none focus:border-accent" />
                  )}
                </label>
              </div>
            </details>
            <p className="flex items-start gap-2 rounded-2xl border border-line p-3 text-[12.5px] text-ink-2">
              <Lock size={14} className="mt-0.5 shrink-0 text-accent" />
              <span>{t.relayNote((x) => <strong className="text-ink">{x}</strong>)}</span>
            </p>
            <Button type="submit" variant="primary" className="w-full" disabled={busy}>
              {busy ? t.connecting : t.connectBuild}
            </Button>
          </form>
        )}

        {error && (
          <p role="alert" className="mt-4 rounded-xl bg-[color-mix(in_srgb,var(--c-bulk)_14%,transparent)] px-3 py-2 text-[13px] text-ink">
            {error}
          </p>
        )}
      </div>
    </dialog>
  )
}
