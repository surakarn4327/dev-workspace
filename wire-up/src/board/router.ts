// Grid wire router: right-angle paths that never run along another wire.
// A* over grid nodes with a direction in the state, so bends cost extra and crossings are straight-through only.

import { G, wirePath } from './world.ts'
import type { Vec, Wire } from './world.ts'

const DIRS: [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
]

const TURN_COST = 3
const CROSS_COST = 8
const MARGIN = 10

function nk(x: number, y: number): string {
  return `${x},${y}`
}

function ek(x1: number, y1: number, x2: number, y2: number): string {
  return x1 < x2 || (x1 === x2 && y1 < y2) ? `${x1},${y1}|${x2},${y2}` : `${x2},${y2}|${x1},${y1}`
}

interface Occupancy {
  edges: Set<string>
  /** Ends and bends of other wires: a path may not touch these (it would look like a junction). */
  blocked: Set<string>
  /** Interior nodes of other wires: a path may cross there, straight only. */
  through: Set<string>
}

function occupancy(others: Wire[]): Occupancy {
  const occ: Occupancy = { edges: new Set(), blocked: new Set(), through: new Set() }
  for (const w of others) {
    const pts = wirePath(w).map((p) => ({ x: Math.round(p.x / G), y: Math.round(p.y / G) }))
    for (const p of pts) occ.blocked.add(nk(p.x, p.y))
    for (let i = 0; i + 1 < pts.length; i++) {
      const p = pts[i]
      const q = pts[i + 1]
      if (p.x !== q.x && p.y !== q.y) continue // legacy diagonal wire: ignored
      const dx = Math.sign(q.x - p.x)
      const dy = Math.sign(q.y - p.y)
      let x = p.x
      let y = p.y
      while (x !== q.x || y !== q.y) {
        const nx = x + dx
        const ny = y + dy
        occ.edges.add(ek(x, y, nx, ny))
        if (nx !== q.x || ny !== q.y) occ.through.add(nk(nx, ny))
        x = nx
        y = ny
      }
    }
  }
  for (const k of occ.blocked) occ.through.delete(k)
  return occ
}

interface Item {
  f: number
  g: number
  x: number
  y: number
  d: number
}

class Heap {
  private a: Item[] = []

  get size(): number {
    return this.a.length
  }

  push(it: Item): void {
    const a = this.a
    a.push(it)
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p].f <= a[i].f) break
      ;[a[p], a[i]] = [a[i], a[p]]
      i = p
    }
  }

  pop(): Item {
    const a = this.a
    const top = a[0]
    const last = a.pop()!
    if (a.length > 0) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < a.length && a[l].f < a[m].f) m = l
        if (r < a.length && a[r].f < a[m].f) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i], a[m]]
        i = m
      }
    }
    return top
  }
}

function lShape(a: Vec, b: Vec): Vec[] {
  if (a.x === b.x || a.y === b.y) return []
  return [{ x: b.x, y: a.y }]
}

/** Bend points for a wire from a to b that stays off the other wires. */
export function routeVia(a: Vec, b: Vec, others: Wire[]): Vec[] {
  const sx = Math.round(a.x / G)
  const sy = Math.round(a.y / G)
  const ex = Math.round(b.x / G)
  const ey = Math.round(b.y / G)
  if (sx === ex && sy === ey) return []
  const occ = occupancy(others)
  const minX = Math.min(sx, ex) - MARGIN
  const maxX = Math.max(sx, ex) + MARGIN
  const minY = Math.min(sy, ey) - MARGIN
  const maxY = Math.max(sy, ey) + MARGIN

  const best = new Map<string, number>()
  const prev = new Map<string, string>()
  const heap = new Heap()
  const sk = (x: number, y: number, d: number) => `${x},${y},${d}`
  const h = (x: number, y: number) => Math.abs(x - ex) + Math.abs(y - ey)
  for (let d = 0; d < 4; d++) {
    best.set(sk(sx, sy, d), 0)
    heap.push({ f: h(sx, sy), g: 0, x: sx, y: sy, d })
  }
  let goal: string | null = null
  while (heap.size > 0) {
    const cur = heap.pop()
    const ck = sk(cur.x, cur.y, cur.d)
    if (cur.g > (best.get(ck) ?? Infinity)) continue
    if (cur.x === ex && cur.y === ey) {
      goal = ck
      break
    }
    const onThrough = occ.through.has(nk(cur.x, cur.y))
    for (let nd = 0; nd < 4; nd++) {
      const turn = nd !== cur.d
      if (turn && onThrough) continue // may only cross another wire straight
      const nx = cur.x + DIRS[nd][0]
      const ny = cur.y + DIRS[nd][1]
      if (nx < minX || nx > maxX || ny < minY || ny > maxY) continue
      if (occ.edges.has(ek(cur.x, cur.y, nx, ny))) continue
      const isGoal = nx === ex && ny === ey
      const key = nk(nx, ny)
      if (!isGoal && occ.blocked.has(key)) continue
      let g = cur.g + 1
      // the start node has no incoming direction, so its first move is free
      if (turn && !(cur.x === sx && cur.y === sy && cur.g === 0)) g += TURN_COST
      if (occ.through.has(key)) g += CROSS_COST
      const nkk = sk(nx, ny, nd)
      if (g < (best.get(nkk) ?? Infinity)) {
        best.set(nkk, g)
        prev.set(nkk, ck)
        heap.push({ f: g + h(nx, ny), g, x: nx, y: ny, d: nd })
      }
    }
  }
  if (!goal) return lShape(a, b)

  const cells: Vec[] = []
  let k: string | undefined = goal
  while (k) {
    const [x, y] = k.split(',').map(Number)
    cells.push({ x: x * G, y: y * G })
    k = prev.get(k)
  }
  cells.reverse()
  // keep only the bends
  const via: Vec[] = []
  for (let i = 1; i + 1 < cells.length; i++) {
    const p = cells[i - 1]
    const q = cells[i]
    const r = cells[i + 1]
    if ((q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x) !== 0) via.push(q)
  }
  return via
}
