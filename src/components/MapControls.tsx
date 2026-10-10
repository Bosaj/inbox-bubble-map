import type { ReactNode } from 'react'
import { BoxSelect, Check, CircleCheckBig, ListPlus, MousePointer2, PinOff, Sparkles, X } from 'lucide-react'
import type { Category } from '../lib/aggregate'
import { activeFilterCount, NO_FILTERS, type ColorBy, type Filters, type LayoutMode, type SelectPreset } from '../lib/display'
import { CATEGORY_META, Dot } from './ui'

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

export const COLOR_OPTIONS: { id: ColorBy; label: string; hint: string }[] = [
  { id: 'type', label: 'Type', hint: 'Newsletters, automated, people' },
  { id: 'unread', label: 'Unread rate', hint: 'Darker = more mail you never open' },
  { id: 'recency', label: 'Last seen', hint: 'Darker = wrote more recently' },
  { id: 'unsub', label: 'Can unsubscribe', hint: 'Orange = has an unsubscribe link' },
]

export const LAYOUT_OPTIONS: { id: LayoutMode; label: string; hint: string }[] = [
  { id: 'orbit', label: 'Orbit', hint: 'Distance from you = how recent' },
  { id: 'clusters', label: 'Clusters', hint: 'One group per type' },
  { id: 'free', label: 'Free', hint: 'Arrange everything yourself' },
]

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
  return (
    <Popover onClose={p.onClose}>
      <Seg label="Colour by" value={p.colorBy} options={COLOR_OPTIONS} onChange={p.onColorBy} />
      <Seg label="Layout" value={p.layout} options={LAYOUT_OPTIONS} onChange={p.onLayout} />
      <label className="mb-3 flex cursor-pointer items-start justify-between gap-3 rounded-xl px-2.5 py-2 hover:bg-surface-2">
        <span>
          <span className="block text-[13.5px] font-medium">Company logos</span>
          <span className="block text-[12px] text-ink-3">Fetched through this site, so icon services never see who emails you</span>
        </span>
        <input type="checkbox" checked={p.logos} onChange={(e) => p.onLogos(e.target.checked)} className="mt-1 size-4 accent-[var(--accent)]" />
      </label>
      <button
        type="button"
        disabled={!p.pinned}
        onClick={p.onUnpinAll}
        className="press inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-line text-[13px] font-medium hover:border-ink-3 disabled:opacity-45"
      >
        <PinOff size={15} /> Unpin all{p.pinned ? ` (${p.pinned})` : ''}
      </button>
      <p className="mt-2 text-[11.5px] text-ink-3">Drag a bubble to pin it anywhere. Double-click to release it.</p>
    </Popover>
  )
}

export function FiltersMenu({ filters, onChange, tabs, onClose }: { filters: Filters; onChange: (f: Filters) => void; tabs: string[]; onClose: () => void }) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch })
  return (
    <Popover onClose={onClose}>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[14px] font-semibold">Filters</p>
        <button type="button" onClick={() => onChange(NO_FILTERS)} disabled={!activeFilterCount(filters)} className="text-[12.5px] font-medium text-accent disabled:opacity-40">
          Reset
        </button>
      </div>
      <label className="mb-3 flex cursor-pointer items-center justify-between gap-3 rounded-xl px-2.5 py-2 hover:bg-surface-2">
        <span className="text-[13.5px] font-medium">Only senders I can unsubscribe from</span>
        <input type="checkbox" checked={filters.unsubOnly} onChange={(e) => set({ unsubOnly: e.target.checked })} className="size-4 accent-[var(--accent)]" />
      </label>
      <label className="mb-3 block px-2.5">
        <span className="mb-1 flex justify-between text-[13px] font-medium">
          Unread at least <span className="tabular text-ink-2">{filters.minUnread}%</span>
        </span>
        <input type="range" min={0} max={100} step={5} value={filters.minUnread} onChange={(e) => set({ minUnread: Number(e.target.value) })} className="w-full accent-[var(--accent)]" />
      </label>
      <label className="mb-3 block px-2.5">
        <span className="mb-1 flex justify-between text-[13px] font-medium">
          At least <span className="tabular text-ink-2">{filters.minCount} messages</span>
        </span>
        <input type="range" min={1} max={100} value={filters.minCount} onChange={(e) => set({ minCount: Number(e.target.value) })} className="w-full accent-[var(--accent)]" />
      </label>
      <div className="mb-3 px-2.5">
        <p className="mb-1.5 text-[13px] font-medium">Last wrote within</p>
        <div className="flex flex-wrap gap-1.5">
          {[null, 7, 30, 90, 365].map((d) => (
            <button
              key={String(d)}
              type="button"
              aria-pressed={filters.lastSeenDays === d}
              onClick={() => set({ lastSeenDays: d })}
              className={`press min-h-8 rounded-lg border px-2.5 text-[12.5px] font-medium ${filters.lastSeenDays === d ? 'border-accent bg-accent-soft text-ink' : 'border-line text-ink-2'}`}
            >
              {d === null ? 'Any time' : d === 365 ? '1 year' : `${d} days`}
            </button>
          ))}
        </div>
      </div>
      {tabs.length > 0 && (
        <div className="px-2.5">
          <p className="mb-1.5 text-[13px] font-medium">Gmail tab</p>
          <div className="flex flex-wrap gap-1.5">
            {[null, ...tabs].map((tab) => (
              <button
                key={String(tab)}
                type="button"
                aria-pressed={filters.tab === tab}
                onClick={() => set({ tab })}
                className={`press min-h-8 rounded-lg border px-2.5 text-[12.5px] font-medium capitalize ${filters.tab === tab ? 'border-accent bg-accent-soft text-ink' : 'border-line text-ink-2'}`}
              >
                {tab ?? 'All tabs'}
              </button>
            ))}
          </div>
        </div>
      )}
    </Popover>
  )
}

export function SelectMenu({ tool, onTool, onPreset, onClear, count, onClose }: { tool: 'pan' | 'select'; onTool: (t: 'pan' | 'select') => void; onPreset: (p: SelectPreset) => void; onClear: () => void; count: number; onClose: () => void }) {
  const presets: { id: SelectPreset; label: string; icon: ReactNode }[] = [
    ...(['bulk', 'automated', 'people'] as Category[]).map((c) => ({ id: c as SelectPreset, label: `All ${CATEGORY_META[c].label.toLowerCase()}`, icon: <Dot category={c} /> })),
    { id: 'unsub', label: 'All with an unsubscribe link', icon: <ListPlus size={14} className="text-accent" /> },
    { id: 'never-opened', label: 'All you never open', icon: <Sparkles size={14} className="text-accent" /> },
  ]
  return (
    <Popover onClose={onClose} width="w-72">
      <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">Tool</p>
      <div role="radiogroup" aria-label="Map tool" className="mb-4 grid grid-cols-2 gap-1.5">
        {(
          [
            ['pan', 'Move & pan', <MousePointer2 key="p" size={15} />],
            ['select', 'Lasso select', <BoxSelect key="s" size={15} />],
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
      <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">Select</p>
      <div className="grid gap-0.5">
        {presets.map((p) => (
          <button key={p.id} type="button" onClick={() => onPreset(p.id)} className="press flex min-h-9 items-center gap-2.5 rounded-xl px-2.5 text-start text-[13.5px] hover:bg-surface-2">
            {p.icon} {p.label}
          </button>
        ))}
      </div>
      {count > 0 && (
        <button type="button" onClick={onClear} className="press mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-xl px-2.5 text-[13px] font-medium text-accent hover:bg-surface-2">
          <X size={14} /> Clear selection ({count})
        </button>
      )}
      <p className="mt-2 text-[11.5px] text-ink-3">Tip: Shift-click bubbles, or Shift-drag on empty space to lasso. Drag any selected bubble to move the whole group.</p>
    </Popover>
  )
}

/** Legend for the current colour mode: categorical chips or a sequential bar. */
export function Legend({ colorBy }: { colorBy: ColorBy }) {
  if (colorBy === 'type')
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {(['bulk', 'automated', 'people'] as Category[]).map((c) => (
          <span key={c} className="inline-flex items-center gap-1.5">
            <Dot category={c} size={9} /> {CATEGORY_META[c].label}
          </span>
        ))}
      </div>
    )
  if (colorBy === 'unsub')
    return (
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ background: 'var(--c-bulk)' }} /> Has unsubscribe link
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ background: 'var(--c-none)' }} /> No link
        </span>
      </div>
    )
  const [lo, hi, a, b] = colorBy === 'unread' ? ['var(--seq-lo)', 'var(--seq-hi)', '0% unread', '100%'] : ['var(--seq2-lo)', 'var(--seq2-hi)', 'oldest', 'today']
  return (
    <div className="flex items-center gap-2">
      <span>{a}</span>
      <span className="h-2 w-28 rounded-full" style={{ background: `linear-gradient(90deg, ${lo}, ${hi})` }} />
      <span>{b}</span>
    </div>
  )
}

export function GroupBar({ count, onCleanup, onPop, onClear }: { count: number; onCleanup: () => void; onPop: () => void; onClear: () => void }) {
  return (
    <div role="toolbar" aria-label="Selected bubbles" className="glass enter absolute inset-x-0 bottom-16 z-20 mx-auto flex w-fit max-w-[calc(100%-24px)] items-center gap-1 rounded-2xl border border-line p-1.5 text-[13px]">
      <span className="tabular px-2.5 font-semibold">{count} selected</span>
      <button type="button" onClick={onCleanup} className="press inline-flex min-h-9 items-center gap-1.5 rounded-xl px-3 font-medium hover:bg-surface-2">
        <ListPlus size={15} className="text-accent" /> Add to cleanup
      </button>
      <button type="button" onClick={onPop} className="press inline-flex min-h-9 items-center gap-1.5 rounded-xl px-3 font-medium hover:bg-surface-2">
        <CircleCheckBig size={15} className="text-accent" /> Pop all
      </button>
      <button type="button" aria-label="Clear selection" onClick={onClear} className="press grid size-9 place-items-center rounded-xl text-ink-3 hover:bg-surface-2 hover:text-ink">
        <X size={15} />
      </button>
    </div>
  )
}
