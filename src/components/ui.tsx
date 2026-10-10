import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { Category } from '../lib/aggregate'

export const CATEGORY_META: Record<Category, { label: string; hint: string; color: string }> = {
  bulk: { label: 'Newsletters & promos', hint: 'Mailing lists you can usually unsubscribe from', color: 'var(--c-bulk)' },
  automated: { label: 'Automated', hint: 'Receipts, alerts and notifications', color: 'var(--c-automated)' },
  people: { label: 'People', hint: 'Real humans writing to you', color: 'var(--c-people)' },
}

export function Dot({ category, size = 10 }: { category: Category; size?: number }) {
  return <span aria-hidden className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: CATEGORY_META[category].color }} />
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost'; size?: 'md' | 'sm' }

export function Button({ variant = 'secondary', size = 'md', className = '', children, ...rest }: BtnProps) {
  const v = {
    primary: 'bg-accent text-accent-ink hover:bg-accent-hover shadow-card',
    secondary: 'bg-surface text-ink border border-line-strong hover:border-ink-3 shadow-card',
    ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
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

const nf = new Intl.NumberFormat('en-US')
export const num = (n: number) => nf.format(n)
export const pct = (n: number) => `${Math.round(n * 100)}%`

export function ago(t: number, now = Date.now()): string {
  if (!t) return '—'
  const d = Math.max(0, Math.round((now - t) / 86_400_000))
  if (d === 0) return 'today'
  if (d === 1) return 'yesterday'
  if (d < 30) return `${d} days ago`
  if (d < 365) return `${Math.round(d / 30)} mo ago`
  return `${(d / 365).toFixed(1).replace('.0', '')} yr ago`
}

export const dateFmt = (t: number) => (t ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
