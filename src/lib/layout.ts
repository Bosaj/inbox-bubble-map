import { forceCollide, forceManyBody, forceRadial, forceSimulation, forceX, forceY, type SimulationNodeDatum } from 'd3-force'
import type { Category, Sender } from './aggregate'

export interface Bubble extends SimulationNodeDatum {
  id: string
  r: number
  ring: number
  sender: Sender
  phase: number // per-bubble offset for the idle drift
  x: number
  y: number
}

export interface Scale {
  ringFor: (days: number) => number
  radiusFor: (count: number) => number
  rings: { radius: number; days: number }[]
  centerR: number
  now: number
}

export interface Layout {
  bubbles: Bubble[]
  rings: { radius: number; days: number }[]
  extent: number // half-size of the square that contains everything
  centerR: number
}

export const DAY = 86_400_000
// Sector each group drifts towards, so the three groups read as regions of the map.
export const SECTOR: Record<Category, number> = { bulk: -Math.PI / 2 - 0.5, automated: Math.PI / 6, people: (5 * Math.PI) / 6 }

/** Area ∝ message count, distance from "you" ∝ log(days since last message). */
export function makeScale(senders: Sender[], size: number, now: number = Math.max(0, ...senders.map((s) => s.last))): Scale {
  const half = size / 2
  const centerR = Math.max(22, size * 0.04)
  const inner = centerR + 36
  const outer = half - 24
  const maxDays = Math.max(30, ...senders.map((s) => (now - s.last) / DAY))
  const ringFor = (days: number) => inner + (Math.log1p(Math.max(0, days)) / Math.log1p(maxDays)) * (outer - inner)

  const maxCount = Math.max(1, ...senders.map((s) => s.count))
  const area = Math.PI * (outer ** 2 - inner ** 2) * 0.42 // keep total bubble area comfortably below the disc
  const totalSqrt = senders.reduce((n, s) => n + s.count / maxCount, 0) || 1
  const rMax = Math.min(size * 0.09, Math.sqrt(area / (Math.PI * totalSqrt)))
  const rMin = Math.min(5, rMax)
  const radiusFor = (count: number) => Math.max(rMin, rMax * Math.sqrt(count / maxCount))

  const rings = [7, 30, 365].filter((d) => d < maxDays).map((days) => ({ days, radius: ringFor(days) }))
  return { ringFor, radiusFor, rings, centerR, now }
}

const golden = Math.PI * (3 - Math.sqrt(5))

export function makeBubble(s: Sender, i: number, scale: Scale, emerge = false): Bubble {
  const ring = scale.ringFor((scale.now - s.last) / DAY)
  const a = SECTOR[s.category] + ((i * golden) % 1.6) - 0.8
  const start = emerge ? scale.centerR + 10 + (i % 7) * 4 : ring
  return { id: s.key, sender: s, r: scale.radiusFor(s.count), ring, phase: (i * 2.39996) % (Math.PI * 2), x: Math.cos(a) * start, y: Math.sin(a) * start }
}

export const CENTER_ID = '__you'

/** The forces shared by the static layout and the live map. */
export function applyForces(sim: ReturnType<typeof forceSimulation<Bubble>>, strength = 1) {
  return sim
    .force('radial', forceRadial<Bubble>((d) => d.ring, 0, 0).strength((d) => (d.id === CENTER_ID ? 0 : 0.55 * strength)))
    .force('sx', forceX<Bubble>((d) => (d.id === CENTER_ID ? 0 : Math.cos(SECTOR[d.sender.category]) * d.ring)).strength(0.06 * strength))
    .force('sy', forceY<Bubble>((d) => (d.id === CENTER_ID ? 0 : Math.sin(SECTOR[d.sender.category]) * d.ring)).strength(0.06 * strength))
    .force('charge', forceManyBody<Bubble>().strength(-1.5))
    .force('collide', forceCollide<Bubble>((d) => d.r + 2).iterations(3))
}

export function centerNode(r: number): Bubble {
  return { id: CENTER_ID, r, ring: 0, phase: 0, sender: null as unknown as Sender, x: 0, y: 0, fx: 0, fy: 0 }
}

/** Deterministic settled layout (used for tests, image export and the first frame). */
export function computeLayout(senders: Sender[], size: number, now?: number): Layout {
  const scale = makeScale(senders, size, now)
  const bubbles = senders.map((s, i) => makeBubble(s, i, scale))
  const sim = applyForces(forceSimulation<Bubble>([centerNode(scale.centerR), ...bubbles])).stop()
  for (let i = 0; i < 320; i++) sim.tick()
  let extent = size / 2
  for (const b of bubbles) extent = Math.max(extent, Math.abs(b.x) + b.r + 8, Math.abs(b.y) + b.r + 8)
  return { bubbles, rings: scale.rings, extent, centerR: scale.centerR }
}
