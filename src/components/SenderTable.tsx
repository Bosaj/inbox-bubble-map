import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Check, ExternalLink } from 'lucide-react'
import type { Sender } from '../lib/aggregate'
import { ago, CATEGORY_META, Dot, num, pct } from './ui'

type Col = 'label' | 'category' | 'count' | 'unread' | 'last'

const COLS: { id: Col; label: string; numeric?: boolean }[] = [
  { id: 'label', label: 'Sender' },
  { id: 'category', label: 'Type' },
  { id: 'count', label: 'Messages', numeric: true },
  { id: 'unread', label: 'Unread', numeric: true },
  { id: 'last', label: 'Last seen', numeric: true },
]

const value = (s: Sender, c: Col): string | number =>
  c === 'label' ? s.label.toLowerCase() : c === 'category' ? s.category : c === 'unread' ? (s.count ? s.unread / s.count : 0) : s[c]

export function SenderTable({ senders, selected, onSelect, cleanup }: { senders: Sender[]; selected: string | null; onSelect: (k: string) => void; cleanup: Set<string> }) {
  const [sort, setSort] = useState<{ col: Col; dir: 1 | -1 }>({ col: 'count', dir: -1 })
  const rows = useMemo(
    () =>
      [...senders].sort((a, b) => {
        const x = value(a, sort.col)
        const y = value(b, sort.col)
        return (x < y ? -1 : x > y ? 1 : 0) * sort.dir
      }),
    [senders, sort],
  )

  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-[13.5px]">
        <caption className="sr-only">All senders, sortable</caption>
        <thead className="sticky top-0 z-[1] bg-surface">
          <tr>
            {COLS.map((c) => {
              const active = sort.col === c.id
              return (
                <th key={c.id} scope="col" aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} className={`border-b border-line px-4 py-2.5 font-medium text-ink-3 ${c.numeric ? 'text-end' : 'text-start'}`}>
                  <button
                    type="button"
                    onClick={() => setSort((s) => ({ col: c.id, dir: s.col === c.id ? ((-s.dir) as 1 | -1) : c.numeric ? -1 : 1 }))}
                    className={`inline-flex min-h-8 items-center gap-1 hover:text-ink ${active ? 'text-ink' : ''}`}
                  >
                    {c.label}
                    {active && (sort.dir === 1 ? <ArrowUp size={13} /> : <ArrowDown size={13} />)}
                  </button>
                </th>
              )
            })}
            <th scope="col" className="border-b border-line px-4 py-2.5 text-start font-medium text-ink-3">
              Unsubscribe
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.key} onClick={() => onSelect(s.key)} className={`cursor-pointer hover:bg-surface-2 ${selected === s.key ? 'bg-accent-soft' : ''}`}>
              <td className="max-w-[260px] border-b border-line px-4 py-2.5">
                <div className="flex items-center gap-2">
                  {cleanup.has(s.key) && <Check size={14} className="shrink-0 text-accent" aria-label="In cleanup list" />}
                  <span className="truncate font-medium">{s.label}</span>
                </div>
                <div className="truncate text-[12px] text-ink-3">{s.key.includes('@') ? s.key : s.domain}</div>
              </td>
              <td className="whitespace-nowrap border-b border-line px-4 py-2.5">
                <span className="inline-flex items-center gap-1.5 text-ink-2">
                  <Dot category={s.category} size={8} />
                  {CATEGORY_META[s.category].label}
                </span>
              </td>
              <td className="tabular border-b border-line px-4 py-2.5 text-end font-semibold">{num(s.count)}</td>
              <td className="tabular border-b border-line px-4 py-2.5 text-end">{pct(s.count ? s.unread / s.count : 0)}</td>
              <td className="whitespace-nowrap border-b border-line px-4 py-2.5 text-end text-ink-2">{ago(s.last)}</td>
              <td className="border-b border-line px-4 py-2.5">
                {s.unsubHttp ? (
                  <a href={s.unsubHttp} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
                    Open <ExternalLink size={12} />
                  </a>
                ) : s.unsubMailto ? (
                  <a href={s.unsubMailto} onClick={(e) => e.stopPropagation()} className="font-medium text-accent hover:underline">
                    Email
                  </a>
                ) : (
                  <span className="text-ink-3">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
