import { useState } from 'react'
import { ChevronDown, History, LogOut, RefreshCw, ShieldCheck } from 'lucide-react'
import { useI18n } from '../i18n'
import { Popover } from './MapControls'
import { ago } from './ui'

/** Signed-in account: who, when it last synced, sync, load the whole mailbox, log out. */
export function AccountMenu({ email, name, syncedAt, staySignedIn, busy, complete, onSync, onOlder, onLogout }: { email: string; name?: string; syncedAt: number; staySignedIn: boolean; busy: boolean; complete: boolean; onSync: () => void; onOlder: () => void; onLogout: () => void }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const initial = (name || email).trim().charAt(0).toUpperCase()
  const item = 'press flex w-full min-h-10 items-center gap-2.5 rounded-xl px-2.5 text-start text-[13.5px] hover:bg-surface-2 disabled:opacity-50'
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="dialog" aria-label={t.account.menu(email)} className="press inline-flex min-h-9 items-center gap-2 rounded-xl border border-line-strong px-1.5 pe-2 hover:border-ink-3">
        <span className="grid size-7 place-items-center rounded-lg bg-accent text-[13px] font-bold text-accent-ink">{initial}</span>
        <span className="hidden max-w-[160px] truncate text-[13px] font-medium md:inline" dir="ltr">
          {email}
        </span>
        <ChevronDown size={14} className="text-ink-3" />
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} width="w-72">
          <p className="truncate text-[14px] font-semibold">{name || email}</p>
          {name && (
            <p className="truncate text-[12.5px] text-ink-3" dir="ltr">
              {email}
            </p>
          )}
          <p className="mt-1 text-[12px] text-ink-3">{t.account.synced(ago(syncedAt))}</p>
          <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-surface-2 px-2.5 py-2 text-[12px] text-ink-2">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-people" /> {staySignedIn ? t.account.staySignedIn : t.account.tabOnly}
          </p>
          <div className="mt-3 grid gap-0.5">
            <button
              type="button"
              className={item}
              disabled={busy}
              onClick={() => {
                setOpen(false)
                onSync()
              }}
            >
              <RefreshCw size={15} className={`text-accent ${busy ? 'animate-spin' : ''}`} /> {busy ? t.account.syncing : t.account.syncNow}
            </button>
            {!complete && (
              <button
                type="button"
                className={item}
                disabled={busy}
                onClick={() => {
                  setOpen(false)
                  onOlder()
                }}
              >
                <History size={15} className="text-accent" /> {t.account.loadAll}
              </button>
            )}
            <button
              type="button"
              className={item}
              onClick={() => {
                setOpen(false)
                onLogout()
              }}
            >
              <LogOut size={15} className="text-[var(--danger)]" />
              <span>
                <span className="block">{t.account.logout}</span>
                <span className="block text-[11.5px] text-ink-3">{t.account.logoutHint}</span>
              </span>
            </button>
          </div>
        </Popover>
      )}
    </div>
  )
}
