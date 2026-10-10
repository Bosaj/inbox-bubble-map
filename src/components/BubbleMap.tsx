import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { forceSimulation, type Simulation } from 'd3-force'
import { select } from 'd3-selection'
import 'd3-transition'
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom'
import { Maximize2, Minus, Plus } from 'lucide-react'
import type { Sender } from '../lib/aggregate'
import { applyForces, centerNode, CENTER_ID, makeBubble, makeScale, type Bubble } from '../lib/layout'
import { ago, CATEGORY_META, Dot, num, pct } from './ui'

interface Props {
  senders: Sender[]
  selected: string | null
  onSelect: (key: string | null) => void
  matches: Set<string> | null // search hits; null = no search
  popping: Set<string> // keys playing the "cleaned" pop before removal
  svgRef?: React.RefObject<SVGSVGElement | null>
}

const SIZE = 1000
const HALF = SIZE / 2 + 40
const IDLE = 0.025 // simulation never fully cools, so bubbles keep floating

function fitLabel(label: string, r: number, font: number): string {
  const max = Math.floor((r * 1.7) / (font * 0.56))
  if (max < 3) return ''
  return label.length > max ? label.slice(0, Math.max(1, max - 1)).trimEnd() + '…' : label
}

/** Gentle per-bubble wandering, independent of alpha so the map never freezes. */
function driftForce(strength: number) {
  let nodes: Bubble[] = []
  let t = 0
  const force = () => {
    t++
    for (const n of nodes) {
      if (n.id === CENTER_ID || n.fx != null) continue
      n.vx = (n.vx ?? 0) + Math.cos(t * 0.011 + n.phase) * strength
      n.vy = (n.vy ?? 0) + Math.sin(t * 0.008 + n.phase * 1.7) * strength
    }
  }
  force.initialize = (ns: Bubble[]) => {
    nodes = ns
  }
  return force
}

const PARTICLES = Array.from({ length: 10 }, (_, i) => {
  const a = (i / 10) * Math.PI * 2
  return { dx: Math.cos(a), dy: Math.sin(a), delay: (i % 3) * 30 }
})

export function BubbleMap({ senders, selected, onSelect, matches, popping, svgRef: externalRef }: Props) {
  const scale = useMemo(() => makeScale(senders, SIZE), [senders])
  const ownRef = useRef<SVGSVGElement>(null)
  const svgRef = externalRef ?? ownRef
  const wrapRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const tRef = useRef<ZoomTransform>(zoomIdentity)
  const simRef = useRef<Simulation<Bubble, undefined> | null>(null)
  const nodesRef = useRef<Map<string, Bubble>>(new Map())
  const elRef = useRef<Map<string, SVGGElement>>(new Map())
  const lineRef = useRef<Map<string, SVGLineElement>>(new Map())
  const drag = useRef<{ id: string; x: number; y: number; moved: boolean; trail: { x: number; y: number; t: number }[] } | null>(null)
  const [bubbles, setBubbles] = useState<Bubble[]>([])
  const [t, setT] = useState<ZoomTransform>(zoomIdentity)
  const [hover, setHover] = useState<{ s: Sender; x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const reduced = useMemo(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches, [])

  // one simulation for the component's lifetime
  useEffect(() => {
    const sim = applyForces(forceSimulation<Bubble>([]), 0.35)
      .velocityDecay(0.32)
      .alphaTarget(reduced ? 0 : IDLE)
      .on('tick', () => {
        for (const b of nodesRef.current.values()) {
          const el = elRef.current.get(b.id)
          if (el) el.setAttribute('transform', `translate(${b.x.toFixed(1)},${b.y.toFixed(1)})`)
          const line = lineRef.current.get(b.id)
          if (line) {
            line.setAttribute('x2', b.x.toFixed(1))
            line.setAttribute('y2', b.y.toFixed(1))
          }
        }
      })
    if (!reduced) sim.force('drift', driftForce(0.05))
    simRef.current = sim
    const onVis = () => (document.hidden ? sim.stop() : sim.restart())
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      sim.stop()
    }
  }, [reduced])

  // new data: keep existing bubbles where they are, new ones burst out from "You"
  useEffect(() => {
    const prev = nodesRef.current
    const next = new Map<string, Bubble>()
    const list = senders.map((s, i) => {
      const b = makeBubble(s, i, scale, true)
      const old = prev.get(s.key)
      if (old) Object.assign(b, { x: old.x, y: old.y, vx: old.vx, vy: old.vy })
      next.set(s.key, b)
      return b
    })
    nodesRef.current = next
    setBubbles(list)
    const sim = simRef.current
    if (!sim) return
    sim.nodes([centerNode(scale.centerR), ...list])
    if (reduced) {
      for (let i = 0; i < 300; i++) sim.tick()
      sim.alpha(0)
      return
    }
    sim.alpha(prev.size ? 0.5 : 1).restart()
  }, [senders, scale, reduced])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 8])
      .filter((ev: Event & { button?: number; ctrlKey?: boolean }) => !(ev.target as Element).closest?.('[data-bubble]') && (!ev.ctrlKey || ev.type === 'wheel') && !ev.button)
      .on('zoom', (e) => {
        tRef.current = e.transform
        setT(e.transform)
      })
    zoomRef.current = z
    const sel = select(svg)
    sel.call(z).on('dblclick.zoom', null)
    return () => {
      sel.on('.zoom', null)
    }
  }, [svgRef])

  const zoomBy = (k: number) => zoomRef.current && svgRef.current && select(svgRef.current).transition().duration(250).call(zoomRef.current.scaleBy, k)
  const reset = () => zoomRef.current && svgRef.current && select(svgRef.current).transition().duration(350).call(zoomRef.current.transform, zoomIdentity)

  const toSim = (clientX: number, clientY: number) => {
    const svg = svgRef.current!
    const pt = svg.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse())
    const [x, y] = tRef.current.invert([p.x, p.y])
    return { x, y }
  }

  const onDown = (e: ReactPointerEvent<SVGGElement>, b: Bubble) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const node = nodesRef.current.get(b.id)
    if (!node) return
    drag.current = { id: b.id, x: e.clientX, y: e.clientY, moved: false, trail: [] }
    node.fx = node.x
    node.fy = node.y
    simRef.current?.alphaTarget(0.3).restart()
  }

  const onMove = (e: ReactPointerEvent<SVGGElement>, s: Sender) => {
    const rect = wrapRef.current!.getBoundingClientRect()
    setHover({ s, x: e.clientX - rect.left, y: e.clientY - rect.top })
    const d = drag.current
    if (!d || d.id !== s.key) return
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) {
      d.moved = true
      setDragging(true)
    }
    const node = nodesRef.current.get(d.id)
    if (!node || !d.moved) return
    const p = toSim(e.clientX, e.clientY)
    node.fx = p.x
    node.fy = p.y
    d.trail.push({ ...p, t: performance.now() })
    if (d.trail.length > 6) d.trail.shift()
  }

  const onUp = (e: ReactPointerEvent<SVGGElement>, s: Sender) => {
    const d = drag.current
    drag.current = null
    setDragging(false)
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    const node = nodesRef.current.get(s.key)
    if (node) {
      node.fx = null
      node.fy = null
      if (d?.moved && d.trail.length > 1 && !reduced) {
        // fling: keep the release velocity (sim units per ~16 ms tick)
        const a = d.trail[0]!
        const z = d.trail[d.trail.length - 1]!
        const dt = Math.max(16, z.t - a.t)
        node.vx = ((z.x - a.x) / dt) * 16 * 0.9
        node.vy = ((z.y - a.y) / dt) * 16 * 0.9
      }
    }
    simRef.current?.alphaTarget(reduced ? 0 : IDLE).restart()
    if (!d?.moved) onSelect(selected === s.key ? null : s.key)
  }

  const top = useMemo(() => new Set(senders.slice(0, 60).map((s) => s.key)), [senders])

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden" onPointerLeave={() => setHover(null)}>
      <svg
        ref={svgRef}
        viewBox={`${-HALF} ${-HALF} ${HALF * 2} ${HALF * 2}`}
        className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        role="img"
        aria-label={`Bubble map of ${senders.length} senders. Bubble size is message count; distance from the centre is how long ago they last wrote.`}
        onClick={(ev) => ev.target === svgRef.current && onSelect(null)}
      >
        <g transform={t.toString()}>
          {scale.rings.map((ring) => (
            <circle key={ring.days} aria-hidden r={ring.radius} fill="none" stroke="var(--grid)" strokeWidth={1.5 / t.k} strokeDasharray={`${6 / t.k} ${8 / t.k}`} />
          ))}

          <g aria-hidden>
            {bubbles
              .filter((b) => top.has(b.id))
              .map((b) => (
                <line
                  key={b.id}
                  ref={(el) => {
                    if (el) lineRef.current.set(b.id, el)
                    else lineRef.current.delete(b.id)
                  }}
                  x1={0}
                  y1={0}
                  stroke="var(--grid)"
                  strokeWidth={1 / t.k}
                  opacity={matches && !matches.has(b.id) ? 0.2 : 1}
                />
              ))}
          </g>

          <g>
            {bubbles.map((b, i) => {
              const s = b.sender
              const dim = matches ? !matches.has(s.key) : false
              const isSel = selected === s.key
              const isHover = hover?.s.key === s.key
              const isPop = popping.has(s.key)
              const font = Math.max(10, Math.min(16, b.r * 0.3))
              const label = fitLabel(s.label, b.r, font)
              return (
                <g
                  key={b.id}
                  ref={(el) => {
                    if (el) {
                      elRef.current.set(b.id, el)
                      const n = nodesRef.current.get(b.id)
                      if (n) el.setAttribute('transform', `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`)
                    } else elRef.current.delete(b.id)
                  }}
                  style={{ opacity: dim ? 0.16 : 1, transition: 'opacity 200ms ease-out' }}
                >
                  {isPop && (
                    <g aria-hidden pointerEvents="none">
                      {PARTICLES.map((p, k) => (
                        <circle
                          key={k}
                          className="particle"
                          r={Math.max(3, b.r * 0.14)}
                          fill={CATEGORY_META[s.category].color}
                          style={{ '--dx': `${p.dx * b.r * 1.9}px`, '--dy': `${p.dy * b.r * 1.9}px`, animationDelay: `${p.delay}ms` } as React.CSSProperties}
                        />
                      ))}
                    </g>
                  )}
                  <g
                    data-bubble
                    className={`bubble-body ${isPop ? 'bubble-pop' : 'bubble-in'} cursor-pointer`}
                    style={isPop ? undefined : { animationDelay: `${Math.min(i * 10, 700)}ms` }}
                    onPointerDown={(e) => onDown(e, b)}
                    onPointerMove={(e) => onMove(e, s)}
                    onPointerUp={(e) => onUp(e, s)}
                    onPointerCancel={(e) => onUp(e, s)}
                    onPointerLeave={() => setHover(null)}
                  >
                    {isSel && <circle className="halo" r={b.r + 6} fill="none" stroke={CATEGORY_META[s.category].color} strokeWidth={3 / t.k} />}
                    <circle
                      className="bubble-circle"
                      r={b.r}
                      fill={CATEGORY_META[s.category].color}
                      stroke={isSel || isHover ? 'var(--ink)' : 'var(--surface)'}
                      strokeWidth={(isSel ? 3.5 : 2) / t.k}
                    />
                    <ellipse aria-hidden rx={b.r * 0.42} ry={b.r * 0.22} cx={-b.r * 0.3} cy={-b.r * 0.45} fill="#fff" opacity={0.18} transform={`rotate(-30 ${-b.r * 0.3} ${-b.r * 0.45})`} pointerEvents="none" />
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
            {scale.rings.map((ring) => (
              <text key={ring.days} x={ring.radius * 0.7071 + 4 / t.k} y={-ring.radius * 0.7071 - 4 / t.k} fontSize={13 / t.k} fill="var(--ink-3)" fontWeight={500} stroke="var(--bg)" strokeWidth={4 / t.k} paintOrder="stroke" strokeLinejoin="round">
                {ring.days === 7 ? 'last 7 days' : ring.days === 30 ? 'last 30 days' : 'last year'}
              </text>
            ))}
          </g>
          <g aria-hidden pointerEvents="none">
            <circle r={scale.centerR + 10} fill="var(--ink)" opacity={0.08} className="you-ring" />
            <circle r={scale.centerR} fill="var(--ink)" stroke="var(--surface)" strokeWidth={3 / t.k} />
            <text textAnchor="middle" dy={scale.centerR * 0.18} fontSize={scale.centerR * 0.55} fontWeight={700} fill="var(--surface)">
              You
            </text>
          </g>
        </g>
      </svg>

      {hover && !dragging && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 w-64 rounded-xl border border-line bg-surface p-3 text-[13px] shadow-pop"
          style={{ left: Math.max(8, Math.min(hover.x + 14, (wrapRef.current?.clientWidth ?? 0) - 270)), top: Math.max(8, hover.y - 10) }}
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
        Size = messages · Closer to you = wrote more recently<span className="hidden sm:inline"> · Drag bubbles, scroll to zoom</span>
      </p>
    </div>
  )
}
