import { useEffect, useMemo, useRef, useState } from 'react'
import { select } from 'd3-selection'
import 'd3-transition'
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom'
import { Maximize2, Minus, Plus } from 'lucide-react'
import type { Sender } from '../lib/aggregate'
import { computeLayout } from '../lib/layout'
import { ago, CATEGORY_META, Dot, num, pct } from './ui'

interface Props {
  senders: Sender[]
  selected: string | null
  onSelect: (key: string | null) => void
  matches: Set<string> | null // search hits; null = no search
  layoutKey: string // changes when the set/grouping changes, so bubbles re-pop
}

const SIZE = 1000

function fitLabel(label: string, r: number, font: number): string {
  const max = Math.floor((r * 1.7) / (font * 0.56))
  if (max < 3) return ''
  return label.length > max ? label.slice(0, Math.max(1, max - 1)).trimEnd() + '…' : label
}

export function BubbleMap({ senders, selected, onSelect, matches, layoutKey }: Props) {
  const layout = useMemo(() => computeLayout(senders, SIZE), [senders])
  const svgRef = useRef<SVGSVGElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const [t, setT] = useState<ZoomTransform>(zoomIdentity)
  const [hover, setHover] = useState<{ s: Sender; x: number; y: number } | null>(null)

  useEffect(() => {
    if (!svgRef.current) return
    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.6, 8])
      .on('zoom', (e) => setT(e.transform))
    zoomRef.current = z
    const sel = select(svgRef.current)
    sel.call(z).on('dblclick.zoom', null)
    return () => {
      sel.on('.zoom', null)
    }
  }, [])

  const zoomBy = (k: number) => zoomRef.current && svgRef.current && select(svgRef.current).transition().duration(250).call(zoomRef.current.scaleBy, k)
  const reset = () => zoomRef.current && svgRef.current && select(svgRef.current).transition().duration(350).call(zoomRef.current.transform, zoomIdentity)

  const e = layout.extent
  const top = new Set(senders.slice(0, 60).map((s) => s.key))

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden" onPointerLeave={() => setHover(null)}>
      <svg
        ref={svgRef}
        viewBox={`${-e} ${-e} ${e * 2} ${e * 2}`}
        className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        role="img"
        aria-label={`Bubble map of ${senders.length} senders. Bubble size is message count; distance from the centre is how long ago they last wrote.`}
        onClick={(ev) => ev.target === svgRef.current && onSelect(null)}
      >
        <g transform={t.toString()}>
          {layout.rings.map((ring) => (
            <circle key={ring.days} aria-hidden r={ring.radius} fill="none" stroke="var(--grid)" strokeWidth={1.5 / t.k} strokeDasharray={`${6 / t.k} ${8 / t.k}`} />
          ))}

          <g aria-hidden>
            {layout.bubbles
              .filter((b) => top.has(b.id))
              .map((b) => (
                <line key={b.id} x1={0} y1={0} x2={b.x} y2={b.y} stroke="var(--grid)" strokeWidth={1 / t.k} opacity={matches && !matches.has(b.id) ? 0.2 : 1} />
              ))}
          </g>

          <g key={layoutKey}>
            {layout.bubbles.map((b, i) => {
              const s = b.sender
              const dim = matches ? !matches.has(s.key) : false
              const isSel = selected === s.key
              const isHover = hover?.s.key === s.key
              const font = Math.max(10, Math.min(16, b.r * 0.3))
              const label = fitLabel(s.label, b.r, font)
              return (
                <g key={b.id} className="bubble" style={{ transform: `translate(${b.x}px, ${b.y}px)`, opacity: dim ? 0.16 : 1 }}>
                  <g
                    className="bubble-in cursor-pointer"
                    style={{ animationDelay: `${Math.min(i * 8, 600)}ms` }}
                    onClick={(ev) => {
                      ev.stopPropagation()
                      onSelect(isSel ? null : s.key)
                    }}
                    onPointerMove={(ev) => {
                      const rect = wrapRef.current!.getBoundingClientRect()
                      setHover({ s, x: ev.clientX - rect.left, y: ev.clientY - rect.top })
                    }}
                    onPointerLeave={() => setHover(null)}
                  >
                    <circle
                      className="bubble-circle"
                      r={b.r}
                      fill={CATEGORY_META[s.category].color}
                      stroke={isSel || isHover ? 'var(--ink)' : 'var(--surface)'}
                      strokeWidth={(isSel ? 3.5 : 2) / t.k}
                    />
                    {label && (
                      <text textAnchor="middle" dy={b.r >= 30 ? -font * 0.15 : font * 0.35} fontSize={font} fontWeight={600} fill="var(--bubble-text)" pointerEvents="none">
                        {label}
                      </text>
                    )}
                    {label && b.r >= 30 && (
                      <text textAnchor="middle" dy={font * 1.05} fontSize={font * 0.78} fill="var(--bubble-text)" opacity={0.75} pointerEvents="none" className="tabular">
                        {num(s.count)}
                      </text>
                    )}
                  </g>
                </g>
              )
            })}
          </g>

          <g aria-hidden pointerEvents="none">
            {layout.rings.map((ring) => (
              <text key={ring.days} x={ring.radius * 0.7071 + 4 / t.k} y={-ring.radius * 0.7071 - 4 / t.k} fontSize={13 / t.k} fill="var(--ink-3)" fontWeight={500} stroke="var(--bg)" strokeWidth={4 / t.k} paintOrder="stroke" strokeLinejoin="round">
                {ring.days === 7 ? 'last 7 days' : ring.days === 30 ? 'last 30 days' : 'last year'}
              </text>
            ))}
          </g>
          <g aria-hidden pointerEvents="none">
            <circle r={layout.centerR} fill="var(--ink)" stroke="var(--surface)" strokeWidth={3 / t.k} />
            <text textAnchor="middle" dy={layout.centerR * 0.18} fontSize={layout.centerR * 0.55} fontWeight={700} fill="var(--surface)">
              You
            </text>
          </g>
        </g>
      </svg>

      {hover && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 w-64 rounded-xl border border-line bg-surface p-3 text-[13px] shadow-pop"
          style={{ left: Math.min(hover.x + 14, (wrapRef.current?.clientWidth ?? 0) - 270), top: Math.max(8, hover.y - 10) }}
        >
          <div className="flex items-center gap-2">
            <Dot category={hover.s.category} />
            <p className="truncate font-semibold">{hover.s.label}</p>
          </div>
          <p className="truncate text-[12px] text-ink-3">{hover.s.domain}</p>
          <dl className="tabular mt-2 grid grid-cols-3 gap-2">
            <div>
              <dt className="text-[11px] text-ink-3">Messages</dt>
              <dd className="font-semibold">{num(hover.s.count)}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-ink-3">Unread</dt>
              <dd className="font-semibold">{pct(hover.s.count ? hover.s.unread / hover.s.count : 0)}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-ink-3">Last</dt>
              <dd className="font-semibold">{ago(hover.s.last)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-[12px] text-ink-2">{hover.s.unsubHttp || hover.s.unsubMailto ? '✓ Has an unsubscribe link' : CATEGORY_META[hover.s.category].label}</p>
        </div>
      )}

      <div className="absolute bottom-3 end-3 flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoomBy(1.4)} className="press grid size-10 place-items-center text-ink-2 hover:bg-surface-2 hover:text-ink">
          <Plus size={17} />
        </button>
        <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoomBy(1 / 1.4)} className="press grid size-10 place-items-center border-y border-line text-ink-2 hover:bg-surface-2 hover:text-ink">
          <Minus size={17} />
        </button>
        <button type="button" aria-label="Reset view" title="Reset view" onClick={reset} className="press grid size-10 place-items-center text-ink-2 hover:bg-surface-2 hover:text-ink">
          <Maximize2 size={15} />
        </button>
      </div>

      <p className="pointer-events-none absolute bottom-3 start-3 max-w-[60%] rounded-lg bg-surface/80 px-2.5 py-1.5 text-[11.5px] text-ink-3 backdrop-blur">
        Size = messages · Closer to you = wrote more recently<span className="hidden sm:inline"> · Scroll to zoom, drag to pan</span>
      </p>
    </div>
  )
}
