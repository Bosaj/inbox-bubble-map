import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { forceManyBody, forceRadial, forceSimulation, forceX, forceY, type Simulation } from 'd3-force'
import { select } from 'd3-selection'
import 'd3-transition'
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom'
import { Maximize2, Minus, Plus } from 'lucide-react'
import type { Sender } from '../lib/aggregate'
import { applyForces, centerNode, CENTER_ID, makeBubble, makeScale, SECTOR, type Bubble } from '../lib/layout'
import { CATEGORY_VAR, CLUSTER, fillFor, initials, logoDomain, type ColorBy, type LayoutMode } from '../lib/display'
import { ago, Dot, num, pct } from './ui'
import { useI18n } from '../i18n'

interface Props {
  senders: Sender[]
  selected: string | null
  onSelect: (key: string | null) => void
  matches: Set<string> | null
  popping: Set<string>
  svgRef?: React.RefObject<SVGSVGElement | null>
  colorBy: ColorBy
  layout: LayoutMode
  logos: boolean
  multi: Set<string>
  onMulti: (next: Set<string>) => void
  tool: 'pan' | 'select'
  unpinToken: number
  onPinned?: (count: number) => void
}

const SIZE = 1000
const HALF = SIZE / 2 + 40
const IDLE = 0.025

function fitLabel(label: string, width: number, font: number): string {
  const max = Math.floor(width / (font * 0.55))
  if (max < 3) return ''
  return label.length > max ? label.slice(0, Math.max(1, max - 1)).trimEnd() + '…' : label
}

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

/** Positional forces for each layout mode; collide/charge/drift stay the same. */
function applyLayout(sim: Simulation<Bubble, undefined>, mode: LayoutMode) {
  if (mode === 'orbit') {
    applyForces(sim, 0.35)
    return
  }
  sim.force('radial', mode === 'clusters' ? null : forceRadial<Bubble>(0, 0, 0).strength(0))
  sim.force('charge', forceManyBody<Bubble>().strength(-1.5))
  if (mode === 'clusters') {
    sim.force('sx', forceX<Bubble>((d) => (d.id === CENTER_ID ? 0 : CLUSTER[d.sender.category].x)).strength((d) => (d.id === CENTER_ID ? 0 : 0.07)))
    sim.force('sy', forceY<Bubble>((d) => (d.id === CENTER_ID ? 0 : CLUSTER[d.sender.category].y)).strength((d) => (d.id === CENTER_ID ? 0 : 0.07)))
  } else {
    sim.force('sx', forceX<Bubble>(0).strength(0.003))
    sim.force('sy', forceY<Bubble>(0).strength(0.003))
  }
}

const PARTICLES = Array.from({ length: 10 }, (_, i) => {
  const a = (i / 10) * Math.PI * 2
  return { dx: Math.cos(a), dy: Math.sin(a), delay: (i % 3) * 30 }
})

type Drag = { ids: string[]; offsets: Map<string, { x: number; y: number }>; startX: number; startY: number; moved: boolean; grab: string }

export function BubbleMap(props: Props) {
  const { senders, selected, onSelect, matches, popping, svgRef: externalRef, colorBy, layout, logos, multi, onMulti, tool, unpinToken, onPinned } = props
  const { t: tx } = useI18n()
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
  const pinnedRef = useRef<Set<string>>(new Set())
  const drag = useRef<Drag | null>(null)
  const lasso = useRef<{ x0: number; y0: number; additive: boolean } | null>(null)
  const toolRef = useRef(tool)
  toolRef.current = tool
  const multiRef = useRef(multi)
  multiRef.current = multi
  const [bubbles, setBubbles] = useState<Bubble[]>([])
  const [t, setT] = useState<ZoomTransform>(zoomIdentity)
  const [hover, setHover] = useState<{ s: Sender; x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [pinVersion, setPinVersion] = useState(0)
  const [failed, setFailed] = useState<Set<string>>(new Set())
  const reduced = useMemo(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches, [])
  const colorCtx = useMemo(() => ({ now: scale.now, maxDays: Math.max(30, ...senders.map((s) => (scale.now - s.last) / 86_400_000)) }), [scale.now, senders])

  const notifyPins = () => {
    setPinVersion((v) => v + 1)
    onPinned?.(pinnedRef.current.size)
  }

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

  // new data: keep positions and pins, new bubbles burst out from "You"
  useEffect(() => {
    const prev = nodesRef.current
    const next = new Map<string, Bubble>()
    const list = senders.map((s, i) => {
      const b = makeBubble(s, i, scale, true)
      const old = prev.get(s.key)
      if (old) Object.assign(b, { x: old.x, y: old.y, vx: old.vx, vy: old.vy, fx: old.fx, fy: old.fy })
      next.set(s.key, b)
      return b
    })
    for (const id of [...pinnedRef.current]) if (!next.has(id)) pinnedRef.current.delete(id)
    nodesRef.current = next
    setBubbles(list)
    const sim = simRef.current
    if (!sim) return
    sim.nodes([centerNode(scale.centerR), ...list])
    applyLayout(sim, layout)
    if (reduced) {
      for (let i = 0; i < 300; i++) sim.tick()
      sim.alpha(0)
      return
    }
    sim.alpha(prev.size ? 0.5 : 1).restart()
  }, [senders, scale, reduced]) // eslint-disable-line react-hooks/exhaustive-deps

  // layout mode switch
  useEffect(() => {
    const sim = simRef.current
    if (!sim) return
    applyLayout(sim, layout)
    if (reduced) {
      for (let i = 0; i < 300; i++) sim.tick()
      return
    }
    sim.alpha(0.7).restart()
  }, [layout, reduced])

  // "unpin all"
  useEffect(() => {
    if (!unpinToken) return
    for (const id of pinnedRef.current) {
      const n = nodesRef.current.get(id)
      if (n) n.fx = n.fy = null
    }
    pinnedRef.current.clear()
    notifyPins()
    simRef.current?.alpha(0.6).restart()
  }, [unpinToken]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.4, 8])
      .filter((ev: Event & { button?: number; ctrlKey?: boolean; shiftKey?: boolean }) => {
        if (ev.type === 'wheel') return true
        if ((ev.target as Element).closest?.('[data-bubble]')) return false
        if (toolRef.current === 'select' || ev.shiftKey) return false
        return !ev.ctrlKey && !ev.button
      })
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

  /* ---------- bubble pointer handling: click, Shift-click, drag (single or group), pin on drop ---------- */

  const onDown = (e: ReactPointerEvent<SVGGElement>, b: Bubble) => {
    e.stopPropagation()
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      const next = new Set(multiRef.current)
      if (next.has(b.id)) next.delete(b.id)
      else next.add(b.id)
      onMulti(next)
      return
    }
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const group = multiRef.current.has(b.id) && multiRef.current.size > 1 ? [...multiRef.current] : [b.id]
    const grabbed = nodesRef.current.get(b.id)
    if (!grabbed) return
    const offsets = new Map<string, { x: number; y: number }>()
    for (const id of group) {
      const n = nodesRef.current.get(id)
      if (!n) continue
      offsets.set(id, { x: n.x - grabbed.x, y: n.y - grabbed.y })
    }
    drag.current = { ids: [...offsets.keys()], offsets, startX: e.clientX, startY: e.clientY, moved: false, grab: b.id }
  }

  const onMove = (e: ReactPointerEvent<SVGGElement>, s: Sender) => {
    const rectBox = wrapRef.current!.getBoundingClientRect()
    setHover({ s, x: e.clientX - rectBox.left, y: e.clientY - rectBox.top })
    const d = drag.current
    if (!d) return
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 4) {
      d.moved = true
      setDragging(true)
      simRef.current?.alphaTarget(0.3).restart()
    }
    if (!d.moved) return
    const p = toSim(e.clientX, e.clientY)
    for (const id of d.ids) {
      const n = nodesRef.current.get(id)
      const off = d.offsets.get(id)!
      if (n) {
        n.fx = p.x + off.x
        n.fy = p.y + off.y
      }
    }
  }

  const onUp = (e: ReactPointerEvent<SVGGElement>, s: Sender) => {
    const d = drag.current
    drag.current = null
    setDragging(false)
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (!d) return
    if (d.moved) {
      // stay where dropped: the bubbles are now pinned
      for (const id of d.ids) pinnedRef.current.add(id)
      notifyPins()
      simRef.current?.alphaTarget(reduced ? 0 : IDLE).restart()
      return
    }
    if (multiRef.current.size) onMulti(new Set())
    onSelect(selected === s.key ? null : s.key)
  }

  const unpin = (id: string) => {
    const n = nodesRef.current.get(id)
    if (n) n.fx = n.fy = null
    pinnedRef.current.delete(id)
    notifyPins()
    simRef.current?.alpha(0.4).restart()
  }

  /* ---------- lasso on empty space (select tool, or Shift-drag) ---------- */

  const onSvgDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if ((e.target as Element).closest('[data-bubble]')) return
    if (tool !== 'select' && !e.shiftKey) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = toSim(e.clientX, e.clientY)
    lasso.current = { x0: p.x, y0: p.y, additive: e.shiftKey }
    setRect({ x: p.x, y: p.y, w: 0, h: 0 })
  }
  const onSvgMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const l = lasso.current
    if (!l) return
    const p = toSim(e.clientX, e.clientY)
    setRect({ x: Math.min(l.x0, p.x), y: Math.min(l.y0, p.y), w: Math.abs(p.x - l.x0), h: Math.abs(p.y - l.y0) })
  }
  const onSvgUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const l = lasso.current
    lasso.current = null
    if (!l || !rect) return setRect(null)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    const inside = [...nodesRef.current.values()].filter((n) => n.x >= rect.x && n.x <= rect.x + rect.w && n.y >= rect.y && n.y <= rect.y + rect.h).map((n) => n.id)
    if (rect.w > 4 || rect.h > 4) onMulti(new Set([...(l.additive ? multi : []), ...inside]))
    setRect(null)
  }

  const top = useMemo(() => new Set(senders.slice(0, 60).map((s) => s.key)), [senders])
  void pinVersion

  return (
    <div ref={wrapRef} className="dots relative h-full w-full overflow-hidden" onPointerLeave={() => setHover(null)}>
      <svg
        ref={svgRef}
        viewBox={`${-HALF} ${-HALF} ${HALF * 2} ${HALF * 2}`}
        className={`h-full w-full touch-none select-none ${tool === 'select' ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}
        role="img"
        aria-label={tx.mapAria(senders.length, layout === 'orbit')}
        onClick={(ev) => ev.target === svgRef.current && !rect && onSelect(null)}
        onPointerDown={onSvgDown}
        onPointerMove={onSvgMove}
        onPointerUp={onSvgUp}
      >
        <defs>
          <radialGradient id="gloss" cx="34%" cy="28%" r="70%">
            <stop offset="0" stopColor="#fff" stopOpacity="0.62" />
            <stop offset="0.38" stopColor="#fff" stopOpacity="0.12" />
            <stop offset="0.7" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.22" />
          </radialGradient>
          <radialGradient id="bshadow" cx="50%" cy="50%" r="50%">
            <stop offset="0.55" stopColor="#000" stopOpacity="0.28" />
            <stop offset="1" stopColor="#000" stopOpacity="0" />
          </radialGradient>
          <clipPath id="plate-clip" clipPathUnits="objectBoundingBox">
            <circle cx="0.5" cy="0.5" r="0.5" />
          </clipPath>
        </defs>
        <g transform={t.toString()}>
          {layout === 'orbit' &&
            scale.rings.map((ring) => (
              <circle key={ring.days} aria-hidden r={ring.radius} fill="none" stroke="var(--grid)" strokeWidth={1.5 / t.k} strokeDasharray={`${6 / t.k} ${8 / t.k}`} />
            ))}
          <g aria-hidden>
            {layout === 'orbit' &&
              bubbles
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
              const inMulti = multi.has(s.key)
              const isHover = hover?.s.key === s.key
              const isPop = popping.has(s.key)
              const pinned = pinnedRef.current.has(s.key)
              const fill = fillFor(s, colorBy, colorCtx)
              const showPlate = b.r >= 14
              const pr = b.r * 0.6
              const domain = logos ? logoDomain(s) : null
              const useLogo = Boolean(domain && !failed.has(domain!))
              const nameFont = Math.max(9, Math.min(14, (b.r - pr) * 0.62))
              const name = b.r >= 30 ? fitLabel(s.label, b.r * 1.5, nameFont) : ''
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
                          fill={fill}
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
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      if (pinned) unpin(s.key)
                    }}
                  >
                    <circle aria-hidden r={b.r * 1.08} cx={b.r * 0.1} cy={b.r * 0.18} fill="url(#bshadow)" pointerEvents="none" />
                    {isSel && <circle className="halo" r={b.r + 7} fill="none" stroke={fill} strokeWidth={3 / t.k} />}
                    {inMulti && <circle className="ants" r={b.r + 5} fill="none" stroke="var(--accent)" strokeWidth={2.5 / t.k} strokeDasharray={`${7 / t.k} ${5 / t.k}`} />}
                    <circle className="bubble-circle" r={b.r} style={{ fill }} stroke={isSel || isHover ? 'var(--ink)' : 'rgb(255 255 255 / 0.35)'} strokeWidth={(isSel ? 3 : 1.2) / t.k} />
                    <circle aria-hidden r={b.r} fill="url(#gloss)" pointerEvents="none" />
                    {showPlate && (
                      <g pointerEvents="none">
                        <circle r={pr} fill="var(--plate)" stroke="rgb(0 0 0 / 0.08)" strokeWidth={1 / t.k} />
                        {useLogo ? (
                          <image
                            href={`/api/logo?d=${encodeURIComponent(domain!)}`}
                            x={-pr * 0.72}
                            y={-pr * 0.72}
                            width={pr * 1.44}
                            height={pr * 1.44}
                            preserveAspectRatio="xMidYMid meet"
                            clipPath="url(#plate-clip)"
                            onError={() => setFailed((f) => new Set(f).add(domain!))}
                          />
                        ) : (
                          <text textAnchor="middle" dy={pr * 0.34} fontSize={pr * 0.95} fontWeight={700} style={{ fill: colorBy === 'type' ? CATEGORY_VAR[s.category] : 'var(--ink-2)' }} letterSpacing="-0.02em">
                            {initials(s.label)}
                          </text>
                        )}
                      </g>
                    )}
                    {name && (
                      <text
                        textAnchor="middle"
                        y={pr + (b.r - pr) / 2 + nameFont * 0.36}
                        fontSize={nameFont}
                        fontWeight={600}
                        fill="#fff"
                        stroke="rgb(0 0 0 / 0.35)"
                        strokeWidth={2.4}
                        paintOrder="stroke"
                        pointerEvents="none"
                      >
                        {name}
                      </text>
                    )}
                    {pinned && (
                      <g transform={`translate(${b.r * 0.72} ${-b.r * 0.72})`} pointerEvents="none" aria-hidden>
                        <circle r={8 / Math.sqrt(t.k)} fill="var(--ink)" stroke="var(--plate)" strokeWidth={1.5 / t.k} />
                        <circle r={2.6 / Math.sqrt(t.k)} fill="var(--plate)" />
                      </g>
                    )}
                  </g>
                </g>
              )
            })}
          </g>

          {layout === 'clusters' &&
            (Object.keys(CLUSTER) as (keyof typeof CLUSTER)[]).map((c) => (
              <text
                key={c}
                x={CLUSTER[c].x}
                y={CLUSTER[c].y - 235}
                textAnchor="middle"
                className="font-display"
                fontSize={32 / Math.sqrt(t.k)}
                fill="var(--ink)"
                fontStyle="italic"
                stroke="var(--bg)"
                strokeWidth={6 / t.k}
                paintOrder="stroke"
                strokeLinejoin="round"
                pointerEvents="none"
                aria-hidden
              >
                {tx.cat[c].label}
              </text>
            ))}

          {rect && <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth={1.5 / t.k} strokeDasharray={`${5 / t.k} ${4 / t.k}`} rx={6 / t.k} />}

          {layout === 'orbit' && (
            <g aria-hidden pointerEvents="none">
              {scale.rings.map((ring) => (
                <text key={ring.days} x={ring.radius * 0.7071 + 4 / t.k} y={-ring.radius * 0.7071 - 4 / t.k} fontSize={13 / t.k} fill="var(--ink-3)" fontWeight={500} stroke="var(--bg)" strokeWidth={4 / t.k} paintOrder="stroke" strokeLinejoin="round">
                  {ring.days === 7 ? 'last 7 days' : ring.days === 30 ? 'last 30 days' : 'last year'}
                </text>
              ))}
            </g>
          )}
          {layout === 'orbit' && (
            <g aria-hidden pointerEvents="none">
              <circle r={scale.centerR + 10} fill="var(--ink)" opacity={0.08} className="you-ring" />
              <circle r={scale.centerR} fill="var(--ink)" stroke="var(--plate)" strokeWidth={3 / t.k} />
              <text textAnchor="middle" dy={scale.centerR * 0.2} fontSize={scale.centerR * 0.62} className="font-display" fontStyle="italic" fill="var(--bg)">
                You
              </text>
            </g>
          )}
        </g>
      </svg>

      {hover && !dragging && (
        <div
          role="tooltip"
          className="glass pointer-events-none absolute z-10 w-64 rounded-2xl border border-line p-3 text-[13px]"
          style={{ left: Math.max(8, Math.min(hover.x + 14, (wrapRef.current?.clientWidth ?? 0) - 270)), top: Math.max(8, hover.y - 10) }}
        >
          <div className="flex items-center gap-2">
            <Dot category={hover.s.category} />
            <p className="truncate font-semibold">{hover.s.label}</p>
          </div>
          <p className="truncate text-[12px] text-ink-3">{hover.s.domain}</p>
          <dl className="tabular mt-2 grid grid-cols-3 gap-2">
            <div>
              <dt className="text-[11px] text-ink-3">{tx.tipMessages}</dt>
              <dd className="font-semibold">{num(hover.s.count)}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-ink-3">{tx.tipUnread}</dt>
              <dd className="font-semibold">{pct(hover.s.count ? hover.s.unread / hover.s.count : 0)}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-ink-3">{tx.tipLast}</dt>
              <dd className="font-semibold">{ago(hover.s.last)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-[12px] text-ink-2">
            {hover.s.unsubHttp || hover.s.unsubMailto ? tx.tipHasLink : tx.cat[hover.s.category].label}
            {pinnedRef.current.has(hover.s.key) && tx.tipPinned}
          </p>
        </div>
      )}

      <div className="glass absolute bottom-3 end-3 flex flex-col overflow-hidden rounded-2xl border border-line">
        <button type="button" aria-label={tx.zoomIn} title={tx.zoomIn} onClick={() => zoomBy(1.4)} className="press grid size-10 place-items-center text-ink-2 hover:bg-surface-2 hover:text-ink">
          <Plus size={17} />
        </button>
        <button type="button" aria-label={tx.zoomOut} title={tx.zoomOut} onClick={() => zoomBy(1 / 1.4)} className="press grid size-10 place-items-center border-y border-line text-ink-2 hover:bg-surface-2 hover:text-ink">
          <Minus size={17} />
        </button>
        <button type="button" aria-label={tx.resetView} title={tx.resetView} onClick={reset} className="press grid size-10 place-items-center text-ink-2 hover:bg-surface-2 hover:text-ink">
          <Maximize2 size={15} />
        </button>
      </div>
    </div>
  )
}

export { SECTOR }
