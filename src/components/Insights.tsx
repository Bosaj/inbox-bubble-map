import { BellOff, Mailbox, PieChart, Sparkles } from 'lucide-react'
import type { Insights as Data, Sender } from '../lib/aggregate'
import { num, pct } from './ui'

function Tile({ icon, value, label, onClick }: { icon: React.ReactNode; value: string; label: string; onClick?: () => void }) {
  const body = (
    <>
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">{icon}</span>
      <span className="min-w-0">
        <span className="tabular block text-[17px] font-semibold leading-tight">{value}</span>
        <span className="block text-[12px] leading-snug text-ink-3">{label}</span>
      </span>
    </>
  )
  return onClick ? (
    <button type="button" onClick={onClick} className="press flex items-start gap-2.5 rounded-2xl border border-line bg-surface-2 p-3 text-start hover:border-ink-3">
      {body}
    </button>
  ) : (
    <div className="flex items-start gap-2.5 rounded-2xl border border-line bg-surface-2 p-3">{body}</div>
  )
}

export function Insights({ data, cleaned, onSelect }: { data: Data; cleaned: number; onSelect: (s: Sender) => void }) {
  const worst = data.neverOpened[0]
  return (
    <section aria-label="Inbox insights" className="enter mb-5 grid grid-cols-2 gap-2">
      <Tile icon={<PieChart size={16} />} value={pct(data.listShare)} label="of your mail comes from mailing lists" />
      <Tile icon={<Mailbox size={16} />} value={`${num(Math.round(data.listPerWeek))}/wk`} label="list emails arriving each week" />
      <Tile
        icon={<BellOff size={16} />}
        value={num(data.neverOpened.length)}
        label={worst ? `senders you never open, like ${worst.label}` : 'senders you never open'}
        onClick={worst ? () => onSelect(worst) : undefined}
      />
      <Tile icon={<Sparkles size={16} />} value={data.cleanupPerYear ? `−${num(data.cleanupPerYear)}` : pct(data.top5Share)} label={data.cleanupPerYear ? `emails a year once your cleanup list is done${cleaned ? ` · ${cleaned} popped` : ''}` : 'of all mail comes from your top 5 senders'} />
    </section>
  )
}
