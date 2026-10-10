import { ArrowLeft, Check, CircleCheckBig, ListChecks, Plus, Search, Sparkles } from 'lucide-react'
import { gmailSearchUrl, lastMonths, perWeek, type Sender } from '../lib/aggregate'
import type { Mailbox } from '../lib/mailbox'
import { useI18n } from '../i18n'
import { MailSection, UnsubscribeActions, type OnApplied } from './MailUI'
import { ago, Button, CATEGORY_META, currentLocale, dateFmt, Dot, LinkButton, num, pct, Stat } from './ui'

interface DetailProps {
  sender: Sender
  inCleanup: boolean
  onToggleCleanup: () => void
  onCleaned: () => void
  onBack: () => void
  refTime: number
  mailbox: Mailbox | null
  onApplied: OnApplied
}

/** 12-month activity bars: single series, baseline-anchored, hover for exact counts. */
function Activity({ s, refTime }: { s: Sender; refTime: number }) {
  const { t } = useI18n()
  const month = new Intl.DateTimeFormat(currentLocale(), { month: 'short', timeZone: 'UTC' })
  const months = lastMonths(refTime, 12)
  const values = months.map((m) => s.months[m] ?? 0)
  const max = Math.max(1, ...values)
  const W = 300
  const H = 72
  const gap = 2
  const bw = (W - gap * 11) / 12
  const rate = perWeek(s)
  return (
    <figure className="mt-5">
      <figcaption className="mb-2 flex items-baseline justify-between text-[12px] text-ink-3">
        <span className="font-semibold uppercase tracking-wide">{t.last12}</span>
        <span className="tabular">≈ {rate >= 1 ? t.perWeek(rate.toFixed(1)) : t.perMonth((rate * 4.33).toFixed(1))}</span>
      </figcaption>
      {/* SVG keeps its own coordinates, so bars run oldest → newest left to right in every language */}
      <svg viewBox={`0 0 ${W} ${H + 16}`} className="w-full" role="img" aria-label={t.monthAria(months.map((m, i) => `${m} ${values[i]}`).join(', '))}>
        <line x1={0} x2={W} y1={H} y2={H} stroke="var(--grid)" />
        {values.map((v, i) => {
          const h = v ? Math.max(6, (v / max) * (H - 4)) : 0
          const x = i * (bw + gap)
          const label = month.format(new Date(`${months[i]}-01T00:00:00Z`))
          return (
            <g key={months[i]}>
              <title>{t.monthBar(label, v)}</title>
              <rect x={x} y={0} width={bw} height={H} fill="transparent" />
              {h > 0 && <path d={`M${x},${H} v${-(h - 4)} q0,-4 4,-4 h${bw - 8} q4,0 4,4 v${h - 4} z`} fill="var(--accent)" opacity={0.85} />}
              {(i === 0 || i === 11 || i === 6) && (
                <text x={x + bw / 2} y={H + 13} textAnchor="middle" fontSize={10} fill="var(--ink-3)">
                  {label}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </figure>
  )
}

export function SenderDetail({ sender: s, inCleanup, onToggleCleanup, onCleaned, onBack, refTime, mailbox, onApplied }: DetailProps) {
  const { t } = useI18n()
  const unreadRatio = s.count ? s.unread / s.count : 0
  const oneClick = Boolean(s.oneClick && s.unsubHttp)
  return (
    <div className="enter">
      <button type="button" onClick={onBack} className="press -ms-2 mb-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-ink-2 hover:bg-surface-2 hover:text-ink">
        <ArrowLeft size={15} className="rtl:rotate-180" /> {t.allSenders}
      </button>
      <div className="flex items-start gap-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl text-[18px] font-bold text-[var(--bubble-text)]" style={{ background: CATEGORY_META[s.category].color }}>
          {s.label.trim().charAt(0).toUpperCase() || '?'}
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-[18px] font-semibold leading-tight" dir="auto">
            {s.label}
          </h2>
          <p className="truncate text-[13px] text-ink-3" dir="ltr">
            {s.key.includes('@') ? s.key : s.domain}
          </p>
          <p className="mt-1 inline-flex items-center gap-1.5 text-[12.5px] text-ink-2">
            <Dot category={s.category} size={8} /> {t.cat[s.category].label}
            {s.gmailCategory && <span className="text-ink-3">· {t.gmailTabIs(s.gmailCategory)}</span>}
          </p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3 rounded-2xl border border-line bg-surface-2 p-3.5">
        <Stat label={t.statMessages} value={num(s.count)} />
        <Stat label={t.statUnread} value={pct(unreadRatio)} sub={t.nMsgs(num(s.unread))} />
        <Stat label={t.statLast} value={ago(s.last)} sub={dateFmt(s.last)} />
      </div>
      {unreadRatio >= 0.8 && s.count >= 5 && (
        <p className="mt-3 flex items-center gap-2 rounded-xl bg-accent-soft px-3 py-2 text-[13px] text-ink">
          <Sparkles size={15} className="shrink-0 text-accent" /> {t.nudge(pct(unreadRatio))}
        </p>
      )}

      <div className="mt-5">
        <UnsubscribeActions key={s.key} sender={s} mailbox={mailbox} />
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {!mailbox && (
          <LinkButton href={gmailSearchUrl(s)}>
            <Search size={14} /> {t.findInGmail}
          </LinkButton>
        )}
        <Button size="sm" variant={inCleanup ? 'primary' : 'secondary'} onClick={onToggleCleanup} className="min-h-10 rounded-xl" aria-pressed={inCleanup}>
          {inCleanup ? <Check size={14} /> : <Plus size={14} />} {inCleanup ? t.inCleanupList : t.addToCleanup}
        </Button>
      </div>
      <Button size="sm" variant="ghost" onClick={onCleaned} className="mt-2 min-h-10 w-full rounded-xl border border-dashed border-line-strong">
        <CircleCheckBig size={15} className="text-people" /> {t.doneUnsub}
      </Button>
      <p className="mt-2 text-[12px] text-ink-3">{oneClick ? t.unsubNoteOneClick : s.unsubHttp || s.unsubMailto ? t.unsubNoteLink : t.unsubNoteNone}</p>

      <MailSection key={s.key} sender={s} mailbox={mailbox} onApplied={onApplied} />

      <Activity s={s} refTime={refTime} />

      {s.subjects.length > 0 && !mailbox && (
        <section className="mt-6">
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-3">{t.recentSubjects}</h3>
          <ul className="space-y-1.5">
            {s.subjects.map((sub) => (
              <li key={sub} className="truncate rounded-lg bg-surface-2 px-3 py-2 text-[13px]" dir="auto">
                {sub}
              </li>
            ))}
          </ul>
        </section>
      )}

      {s.emails.length > 1 && (
        <section className="mt-6">
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-3">{t.addresses(s.emails.length)}</h3>
          <ul className="space-y-1 text-[13px] text-ink-2" dir="ltr">
            {s.emails.map((e) => (
              <li key={e} className="truncate text-start">
                {e}
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="mt-6 text-[12px] text-ink-3">{t.firstSeen(dateFmt(s.first))}</p>
    </div>
  )
}

interface ListProps {
  title: string
  icon: React.ReactNode
  senders: Sender[]
  empty: React.ReactNode
  onSelect: (key: string) => void
  cleanup: Set<string>
  onToggleCleanup: (key: string) => void
}

export function SenderList({ title, icon, senders, empty, onSelect, cleanup, onToggleCleanup }: ListProps) {
  const { t } = useI18n()
  return (
    <div className="enter">
      <h2 className="mb-3 flex items-center gap-2 text-[14px] font-semibold">
        {icon} {title}
      </h2>
      {senders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong p-5 text-center text-[13px] text-ink-3">{empty}</div>
      ) : (
        <ul className="-mx-2">
          {senders.map((s) => {
            const marked = cleanup.has(s.key)
            return (
              <li key={s.key} className="group flex items-center gap-1 rounded-xl px-2 hover:bg-surface-2">
                <button type="button" onClick={() => onSelect(s.key)} className="flex min-h-12 min-w-0 flex-1 items-center gap-3 text-start">
                  <Dot category={s.category} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium" dir="auto">
                      {s.label}
                    </span>
                    <span className="block truncate text-[12px] text-ink-3">{t.rowMeta(num(s.count), pct(s.count ? s.unread / s.count : 0), ago(s.last))}</span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={marked ? t.removeFromCleanupAria(s.label) : t.addToCleanupAria(s.label)}
                  aria-pressed={marked}
                  title={marked ? t.inCleanupList : t.addToCleanup}
                  onClick={() => onToggleCleanup(s.key)}
                  className={`press grid size-10 shrink-0 place-items-center rounded-lg ${marked ? 'bg-accent text-accent-ink' : 'text-ink-3 hover:bg-surface hover:text-ink'}`}
                >
                  {marked ? <Check size={16} /> : <Plus size={16} />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export const CleanupIcon = ListChecks
