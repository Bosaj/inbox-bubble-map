import { forceCollide, forceManyBody, forceRadial, forceSimulation, forceX, forceY, type SimulationNodeDatum } from 'd3-force'
import type { Category, Sender } from './aggregate'

export interface Bubble extends SimulationNodeDatum {
  id: string
  r: number
  ring: number
  sender: Sender
  x: number
  y: number
}

export interface Layout {
  bubbles: Bubble[]
  rings: { radius: number; days: number }[]
  extent: number // half-size of the square that contains everything
  centerR: number
}

const DAY = 86_400_000
// Sector each group drifts towards, so the three groups read as regions of the map.
const SECTOR: Record<Category, number> = { bulk: -Math.PI / 2 - 0.5, automated: Math.PI / 6, people: (5 * Math.PI) / 6 }

/**
 * Deterministic bubble layout: area ∝ message count, distance from "you" ∝ how
 * long ago they last wrote (log scale), grouped loosely by category.
 */
export function computeLayout(senders: Sender[], size: number, now: number = Math.max(0, ...senders.map((s) => s.last))): Layout {
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

  const golden = Math.PI * (3 - Math.sqrt(5))
  const bubbles: Bubble[] = senders.map((s, i) => {
    const ring = ringFor((now - s.last) / DAY)
    const a = SECTOR[s.category] + (i * golden) % 1.6 - 0.8
    return {
      id: s.key,
      sender: s,
      r: Math.max(rMin, rMax * Math.sqrt(s.count / maxCount)),
      ring,
      x: Math.cos(a) * ring,
      y: Math.sin(a) * ring,
    }
  })

  const center: Bubble = { id: '__you', r: centerR, ring: 0, sender: null as unknown as Sender, x: 0, y: 0, fx: 0, fy: 0 }
  const sim = forceSimulation<Bubble>([center, ...bubbles])
    .force('radial', forceRadial<Bubble>((d) => d.ring, 0, 0).strength((d) => (d.id === '__you' ? 0 : 0.55)))
    .force('sx', forceX<Bubble>((d) => (d.id === '__you' ? 0 : Math.cos(SECTOR[d.sender.category]) * d.ring)).strength(0.06))
    .force('sy', forceY<Bubble>((d) => (d.id === '__you' ? 0 : Math.sin(SECTOR[d.sender.category]) * d.ring)).strength(0.06))
    .force('charge', forceManyBody<Bubble>().strength(-1.5))
    .force('collide', forceCollide<Bubble>((d) => d.r + 2).iterations(3))
    .stop()
  for (let i = 0; i < 320; i++) sim.tick()

  let extent = half
  for (const b of bubbles) extent = Math.max(extent, Math.abs(b.x) + b.r + 8, Math.abs(b.y) + b.r + 8)

  const rings = [7, 30, 365].filter((d) => d < maxDays).map((days) => ({ days, radius: ringFor(days) }))
  return { bubbles, rings, extent, centerR }
}
