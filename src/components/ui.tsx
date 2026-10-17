import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { X } from 'lucide-react'
import type { Category } from '../lib/aggregate'
import { LOCALE, type Lang } from '../i18n'

/** Category colours. Labels live in the string tables (t.cat). */
export const CATEGORY_META: Record<Category, { color: string }> = {
  bulk: { color: 'var(--c-bulk)' },
  automated: { color: 'var(--c-automated)' },
  people: { color: 'var(--c-people)' },
}

export function Dot({ category, size = 10 }: { category: Category; size?: number }) {
  return <span aria-hidden className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: CATEGORY_META[category].color }} />
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'md' | 'sm' }

export function Button({ variant = 'secondary', size = 'md', className = '', children, ...rest }: BtnProps) {
  const v = {
    primary: 'bg-accent text-accent-ink hover:bg-accent-hover shadow-card',
    secondary: 'bg-surface text-ink border border-line-strong hover:border-ink-3 shadow-card',
    ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
    danger: 'bg-[var(--danger)] text-white hover:brightness-110 shadow-card',
  }[variant]
  const s = size === 'md' ? 'min-h-11 px-4 text-[14px] rounded-xl gap-2' : 'min-h-9 px-3 text-[13px] rounded-lg gap-1.5'
  return (
    <button type="button" className={`press inline-flex items-center justify-center font-medium disabled:pointer-events-none disabled:opacity-50 ${v} ${s} ${className}`} {...rest}>
      {children}
    </button>
  )
}

export function LinkButton({ href, children, variant = 'secondary', className = '' }: { href: string; children: ReactNode; variant?: 'primary' | 'secondary'; className?: string }) {
  const v = variant === 'primary' ? 'bg-accent text-accent-ink hover:bg-accent-hover' : 'bg-surface text-ink border border-line-strong hover:border-ink-3'
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className={`press inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl px-3.5 text-[13.5px] font-medium ${v} ${className}`}>
      {children}
    </a>
  )
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[12px] text-ink-3">{label}</p>
      <p className="tabular truncate text-[18px] font-semibold leading-tight">{value}</p>
      {sub && <p className="truncate text-[12px] text-ink-3">{sub}</p>}
    </div>
  )
}

/** Modal built on <dialog>: focus trap, Escape and backdrop click close it. */
export function Modal({ open, onClose, label, children, wide = false }: { open: boolean; onClose: () => void; label: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label={label}
      className={`m-auto ${wide ? 'w-[min(760px,calc(100vw-16px))]' : 'w-[min(460px,calc(100vw-24px))]'} rounded-[28px] border border-line bg-surface p-0 text-ink shadow-pop backdrop:bg-black/40 backdrop:backdrop-blur-sm`}
    >
      {open && children}
    </dialog>
  )
}

export function CloseButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="press grid size-10 shrink-0 place-items-center rounded-xl text-ink-2 hover:bg-surface-2">
      <X size={18} />
    </button>
  )
}

/* ---------- locale-aware formatting (follows the language switcher) ---------- */

let locale = LOCALE.en
let nf = new Intl.NumberFormat(locale)
let pf = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 })
let rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })

export function setLocale(lang: Lang) {
  if (LOCALE[lang] === locale) return
  locale = LOCALE[lang]
  nf = new Intl.NumberFormat(locale)
  pf = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 })
  rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
}

export const currentLocale = () => locale
/** "12 minutes" / "12 minutes" / "12 دقيقة" with the right plural. */
export const minutes = (n: number) => new Intl.NumberFormat(locale, { style: 'unit', unit: 'minute', unitDisplay: 'long' }).format(Math.max(1, Math.round(n)))
export const num = (n: number) => nf.format(n)
export const pct = (n: number) => pf.format(n)

export function ago(t: number, now = Date.now()): string {
  if (!t) return '—'
  const d = Math.max(0, Math.round((now - t) / 86_400_000))
  if (d < 30) return rtf.format(-d, 'day')
  if (d < 365) return rtf.format(-Math.round(d / 30), 'month')
  return rtf.format(-Math.round(d / 365), 'year')
}

export const dateFmt = (t: number) => (t ? new Date(t).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
export const dateTimeFmt = (t: number) => (t ? new Date(t).toLocaleString(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')
