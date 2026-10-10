import type { ReactNode } from 'react'
import { Archive, BoxSelect, Check, CircleCheckBig, ListPlus, MailCheck, MousePointer2, PinOff, Sparkles, Trash2, X } from 'lucide-react'
import type { Category } from '../lib/aggregate'
import { activeFilterCount, NO_FILTERS, type ColorBy, type Filters, type LayoutMode, type SelectPreset } from '../lib/display'
import { Dot } from './ui'
import { useI18n } from '../i18n'
import type { BulkAction } from './MailUI'

export function Popover({ children, onClose, width = 'w-80' }: { children: ReactNode; onClose: () => void; width?: string }) {
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} aria-hidden />
      <div role="dialog" className={`glass enter absolute end-0 top-12 z-40 ${width} rounded-[22px] border border-line p-4`}>
        {children}
      </div>
    </>
  )
}

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string; hint?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="mb-4">
      <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">{label}</p>
      <div role="radiogroup" aria-label={label} className="grid gap-1">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            onClick={() => onChange(o.id)}
            className={`press flex items-start gap-2.5 rounded-xl px-2.5 py-2 text-start ${value === o.id ? 'bg-accent-soft' : 'hover:bg-surface-2'}`}
          >
            <span className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border ${value === o.id ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong'}`}>{value === o.id && <Check size={10} strokeWidth={3} />}</span>
            <span>
              <span className="block text-[13.5px] font-medium">{o.label}</span>
              {o.hint && <span className="block text-[12px] text-ink-3">{o.hint}</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

export const COLOR_IDS: ColorBy[] = ['type', 'unread', 'recency', 'unsub']
export const LAYOUT_IDS: LayoutMode[] = ['orbit', 'clusters', 'free']

export function DisplayMenu(p: {
  colorBy: ColorBy
  onColorBy: (v: ColorBy) => void
  layout: LayoutMode
  onLayout: (v: LayoutMode) => void
  logos: boolean
  onLogos: (v: boolean) => void
  pinned: number
  onUnpinAll: () => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const colorOptions = COLOR_IDS.map((id) => ({ id, label: t.colorOptions[id]![0], hint: t.colorOptions[id]![1] }))
  const layoutOptions = LAYOUT_IDS.map((id) => ({ id, label: t.layoutOptions[id]![0], hint: t.layoutOptions[id]![1] }))
  return (
    <Popover onClose={p.onClose}>
      <Seg label={t.colorBy} value={p.colorBy} options={colorOptions} onChange={p.onColorBy} />
      <Seg label={t.layout} value={p.layout} options={layoutOptions} onChange={p.onLayout} />
      <label className="mb-3 flex cursor-pointer items-start justify-between gap-3 rounded-xl px-2.5 py-2 hover:bg-surface-2">
        <span>
          <span className="block text-[13.5px] font-medium">{t.logos}</span>
          <span className="block text-[12px] text-ink-3">{t.logosHint}</span>
        </span>
        <input type="checkbox" checked={p.logos} onChange={(e) => p.onLogos(e.target.checked)} className="mt-1 size-4 accent-[var(--accent)]" />
      </label>
      <button
        type="button"
        disabled={!p.pinned}
        onClick={p.onUnpinAll}
        className="press inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-line text-[13px] font-medium hover:border-ink-3 disabled:opacity-45"
      >
        <PinOff size={15} /> {t.unpinAll(p.pinned)}
      </button>
      <p className="mt-2 text-[11.5px] text-ink-3">{t.pinTip}</p>
    </Popover>
  )
}

export function FiltersMenu({ filters, onChange, tabs, onClose }: { filters: Filters; onChange: (f: Filters) => void; tabs: string[]; onClose: () => void }) {
  const { t } = useI18n()
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch })
  return (
    <Popover onClose={onClose}>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[14px] font-semibold">{t.filters}</p>
        <button type="button" onClick={() => onChange(NO_FILTERS)} disabled={!activeFilterCount(filters)} className="text-[12.5px] font-medium text-accent disabled:opacity-40">
          {t.reset}
        </button>
      </div>
      <label className="mb-3 flex cursor-pointer items-center justify-between gap-3 rounded-xl px-2.5 py-2 hover:bg-surface-2">
        <span className="text-[13.5px] font-medium">{t.unsubOnly}</span>
        <input type="checkbox" checked={filters.unsubOnly} onChange={(e) => set({ unsubOnly: e.target.checked })} className="size-4 accent-[var(--accent)]" />
      </label>
      <label className="mb-3 block px-2.5">
        <span className="mb-1 flex justify-between text-[13px] font-medium">
          {t.unreadAtLeast} <span className="tabular text-ink-2">{filters.minUnread}%</span>
        </span>
        <input type="range" min={0} max={100} step={5} value={filters.minUnread} onChange={(e) => set({ minUnread: Number(e.target.value) })} className="w-full accent-[var(--accent)]" />
      </label>
      <label className="mb-3 block px-2.5">
        <span className="mb-1 flex justify-between text-[13px] font-medium">
          {t.atLeast} <span className="tabular text-ink-2">{t.nMessages(filters.minCount)}</span>
        </span>
        <input type="range" min={1} max={100} value={filters.minCount} onChange={(e) => set({ minCount: Number(e.target.value) })} className="w-full accent-[var(--accent)]" />
      </label>
      <div className="mb-3 px-2.5">
        <p className="mb-1.5 text-[13px] font-medium">{t.lastWrote}</p>
        <div className="flex flex-wrap gap-1.5">
          {[null, 7, 30, 90, 365].map((d) => (
            <button
              key={String(d)}
              type="button"
              aria-pressed={filters.lastSeenDays === d}
              onClick={() => set({ lastSeenDays: d })}
              className={`press min-h-8 rounded-lg border px-2.5 text-[12.5px] font-medium ${filters.lastSeenDays === d ? 'border-accent bg-accent-soft text-ink' : 'border-line text-ink-2'}`}
            >
              {d === null ? t.anyTime : t.days(d)}
            </button>
          ))}
        </div>
      </div>
      {tabs.length > 0 && (
        <div className="px-2.5">
          <p className="mb-1.5 text-[13px] font-medium">{t.gmailTab}</p>
          <div className="flex flex-wrap gap-1.5">
            {[null, ...tabs].map((tab) => (
              <button
                key={String(tab)}
                type="button"
                aria-pressed={filters.tab === tab}
                onClick={() => set({ tab })}
                className={`press min-h-8 rounded-lg border px-2.5 text-[12.5px] font-medium capitalize ${filters.tab === tab ? 'border-accent bg-accent-soft text-ink' : 'border-line text-ink-2'}`}
              >
                {tab ?? t.allTabs}
              </button>
            ))}
          </div>
        </div>
      )}
    </Popover>
  )
}

export function SelectMenu({ tool, onTool, onPreset, onClear, count, onClose }: { tool: 'pan' | 'select'; onTool: (t: 'pan' | 'select') => void; onPreset: (p: SelectPreset) => void; onClear: () => void; count: number; onClose: () => void }) {
  const { t } = useI18n()
  const presets: { id: SelectPreset; label: string; icon: ReactNode }[] = [
    ...(['bulk', 'automated', 'people'] as Category[]).map((c) => ({ id: c as SelectPreset, label: t.allOf(t.cat[c].label), icon: <Dot category={c} /> })),
    { id: 'unsub', label: t.allUnsub, icon: <ListPlus size={14} className="text-accent" /> },
    { id: 'never-opened', label: t.allNever, icon: <Sparkles size={14} className="text-accent" /> },
  ]
  return (
    <Popover onClose={onClose} width="w-72">
      <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">{t.tool}</p>
      <div role="radiogroup" aria-label={t.mapTool} className="mb-4 grid grid-cols-2 gap-1.5">
        {(
          [
            ['pan', t.pan, <MousePointer2 key="p" size={15} />],
            ['select', t.lasso, <BoxSelect key="s" size={15} />],
          ] as const
        ).map(([id, label, icon]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={tool === id}
            onClick={() => onTool(id)}
            className={`press inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border text-[13px] font-medium ${tool === id ? 'border-accent bg-accent-soft' : 'border-line hover:border-ink-3'}`}
          >
            {icon} {label}
          </button>
        ))}
      </div>
      <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">{t.select}</p>
      <div className="grid gap-0.5">
        {presets.map((p) => (
          <button key={p.id} type="button" onClick={() => onPreset(p.id)} className="press flex min-h-9 items-center gap-2.5 rounded-xl px-2.5 text-start text-[13.5px] hover:bg-surface-2">
            {p.icon} {p.label}
          </button>
        ))}
      </div>
      {count > 0 && (
        <button type="button" onClick={onClear} className="press mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-xl px-2.5 text-[13px] font-medium text-accent hover:bg-surface-2">
          <X size={14} /> {t.clearSel(count)}
        </button>
      )}
      <p className="mt-2 text-[11.5px] text-ink-3">{t.selTip}</p>
    </Popover>
  )
}

/** Legend for the current colour mode: categorical chips or a sequential bar. */
export function Legend({ colorBy }: { colorBy: ColorBy }) {
  const { t } = useI18n()
  if (colorBy === 'type')
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {(['bulk', 'automated', 'people'] as Category[]).map((c) => (
          <span key={c} className="inline-flex items-center gap-1.5">
            <Dot category={c} size={9} /> {t.cat[c].label}
          </span>
        ))}
      </div>
    )
  if (colorBy === 'unsub')
    return (
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ background: 'var(--c-bulk)' }} /> {t.hasLink}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ background: 'var(--c-none)' }} /> {t.noLink}
        </span>
      </div>
    )
  const [lo, hi, a, b] = colorBy === 'unread' ? ['var(--seq-lo)', 'var(--seq-hi)', t.unread0, '100%'] : ['var(--seq2-lo)', 'var(--seq2-hi)', t.oldest, t.today]
  return (
    <div dir="ltr" className="flex items-center gap-2">
      <span>{a}</span>
      <span className="h-2 w-28 rounded-full" style={{ background: `linear-gradient(to right, ${lo}, ${hi})` }} />
      <span>{b}</span>
    </div>
  )
}

export function GroupBar({ count, onCleanup, onPop, onClear, onMail }: { count: number; onCleanup: () => void; onPop: () => void; onClear: () => void; onMail?: (action: BulkAction) => void }) {
  const { t } = useI18n()
  const item = 'press inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-xl px-3 font-medium hover:bg-surface-2'
  return (
    <div role="toolbar" aria-label={t.selectedBar} className="glass enter absolute inset-x-0 bottom-16 z-20 mx-auto flex w-fit max-w-[calc(100%-24px)] items-center gap-1 overflow-x-auto rounded-2xl border border-line p-1.5 text-[13px] [scrollbar-width:none]">
      <span className="tabular shrink-0 px-2.5 font-semibold">{t.selected(count)}</span>
      <button type="button" onClick={onCleanup} className={item}>
        <ListPlus size={15} className="text-accent" /> {t.addCleanup}
      </button>
      {onMail ? (
        <>
          <button type="button" onClick={() => onMail('read')} className={item}>
            <MailCheck size={15} className="text-accent" /> {t.bulk.read}
          </button>
          <button type="button" onClick={() => onMail('archive')} className={item}>
            <Archive size={15} className="text-accent" /> {t.bulk.archive}
          </button>
          <button type="button" onClick={() => onMail('trash')} className={item}>
            <Trash2 size={15} className="text-[var(--danger)]" /> {t.bulk.trash}
          </button>
        </>
      ) : (
        <button type="button" onClick={onPop} className={item}>
          <CircleCheckBig size={15} className="text-accent" /> {t.popAll}
        </button>
      )}
      <button type="button" aria-label={t.clearSelection} onClick={onClear} className="press grid size-9 shrink-0 place-items-center rounded-xl text-ink-3 hover:bg-surface-2 hover:text-ink">
        <X size={15} />
      </button>
    </div>
  )
}
