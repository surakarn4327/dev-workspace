// Current in each wire, for the flowing-dots animation. The solver only knows node voltages and element currents, so the
// current in a wire is rebuilt from the currents each part draws at its pins. Wires are given a resistance in proportion to
// their length, which is what makes the answer unique even where they form loops (the circuit's own results are untouched).
// A wire with plugged corners (it passes through a pin or hole and carries on) is cut there like at a branch.

import { boardHoles } from '../parts/breadboard.ts'
import { pinWorld } from '../parts/index.ts'
import { gauss } from '../sim/solver.ts'
import type { SolveResult } from '../sim/solver.ts'
import type { Element } from '../sim/solver.ts'
import type { Netlist } from './connectivity.ts'
import { socketKeys, tapTarget } from './wireJoin.ts'
import { pointKey, wirePath } from './world.ts'
import type { Vec, World } from './world.ts'

/** (circuit node, current drawn from that node into the element, the part pin it is, when the element says) for every terminal of an element. */
function draws(e: Element, res: SolveResult): [number, number, number?][] {
  const c = res.cur.get(e.id)
  if (!c) return []
  switch (e.kind) {
    case 'Q':
      return [[e.c, c.i], [e.b, c.ib ?? 0], [e.e, -(c.i + (c.ib ?? 0))]]
    case 'G':
      return [[e.y, -c.i], [e.ref ?? 0, c.i]] // the symbol gate pushes c.i out of Y and takes it back from its reference
    case 'C':
      return [[e.y, c.i + (c.ib ?? 0)], [e.vcc, -c.i], [e.gnd, -(c.ib ?? 0)]] // a chip gate: in through VCC, out through GND
    case 'R':
    case 'D':
      return [[e.a, c.i, e.pinA], [e.b, -c.i, e.pinB]]
    default:
      return [[e.a, c.i], [e.b, -c.i]]
  }
}

/** Signed current in each wire, positive when it flows from the wire's `a` end to its `b` end. Wires with no answer are absent. */
export interface FlowResult {
  /** Signed current of each wire that has no junction on it (+ = a -> b). */
  byWire: Map<string, number>
  /** Every stretch of wire with its own current, for the dots (a wire with branches is several stretches). */
  parts: { wire: string; path: Vec[]; i: number }[]
}

export function computeFlow(world: World, net: Netlist, res: SolveResult): FlowResult {
  const out: FlowResult = { byWire: new Map(), parts: [] }
  if (world.wires.length === 0) return out

  // a breadboard strip is one node
  const hub = new Map<string, string>()
  for (const part of world.parts) if (part.type.startsWith('breadboard')) for (const h of boardHoles(part)) hub.set(pointKey(h.pos), h.strip)
  const nodeOf = (key: string): string => hub.get(key) ?? key

  // what each part draws at each pin
  const byPart = new Map<string, Element[]>()
  for (const e of net.circuit.elements) {
    const k = e.id.indexOf(':')
    if (k < 0) continue
    const id = e.id.slice(0, k)
    const list = byPart.get(id)
    if (list) list.push(e)
    else byPart.set(id, [e])
  }
  const need = new Map<string, number>()
  const add = (node: string, i: number) => need.set(node, (need.get(node) ?? 0) + i)
  const anyPinAt = new Map<number, string>() // a reference node has no pin of the gate: charge it to a pin on that net
  const isSource = (t: string) => t.startsWith('battery') || t === 'supply'
  // the negative pin of a source first, so the gate's return current lands on the source and not on a part that shares the node
  for (const sourcePass of [true, false]) {
    for (const part of world.parts) {
      if (isSource(part.type) !== sourcePass) continue
      const nodes = net.partPins.get(part.id)
      if (!nodes) continue
      const keys = pinWorld(part).map((v) => nodeOf(pointKey(v)))
      const order = sourcePass ? [1, 0] : keys.map((_, i) => i)
      for (const i of order) if (nodes[i] !== undefined && !anyPinAt.has(nodes[i])) anyPinAt.set(nodes[i], keys[i])
    }
  }
  for (const part of world.parts) {
    const nodes = net.partPins.get(part.id)
    if (!nodes || world.isolated.has(part.id)) continue
    const keys = pinWorld(part).map((v) => nodeOf(pointKey(v)))
    for (const e of byPart.get(part.id) ?? []) {
      for (const [n, i, hint] of draws(e, res)) {
        // several pins can share a node (an input wired straight to +): a chip's supply current belongs to its VCC / GND pin
        const supplyPin = e.kind === 'C' ? (n === e.vcc ? 13 : n === e.gnd ? 6 : -1) : -1
        const pin = hint !== undefined && nodes[hint] === n ? hint : supplyPin >= 0 && nodes[supplyPin] === n ? supplyPin : nodes.indexOf(n)
        if (pin >= 0) add(keys[pin], i)
        else if (anyPinAt.has(n)) add(anyPinAt.get(n)!, i)
      }
    }
  }

  // wire networks. A wire a branch rests on is cut into pieces at the junctions, so every piece has one current. Loops are solved too (below).
  const sockets = socketKeys(world)
  const junctions = new Map<string, Vec[]>()
  for (const o of world.wires) {
    for (const end of [o.a, o.b]) {
      const main = tapTarget(world, o, end, sockets)
      if (main) junctions.set(main.id, [...(junctions.get(main.id) ?? []), end])
    }
  }
  interface Piece {
    wire: string
    index: number
    path: Vec[]
    a: string
    b: string
    whole: boolean
  }
  const pieces: Piece[] = []
  for (const w of world.wires) {
    const path = wirePath(w)
    const length = totalLength(path)
    // cut where another wire rests on this one, and where this wire is plugged in on the way
    const cuts = [...(junctions.get(w.id) ?? []), ...(w.taps ?? [])]
      .map((j) => alongPath(path, j))
      .filter((d): d is number => d !== null)
      .sort((p, q) => p - q)
    const marks = [0, ...cuts.filter((d, i) => d > 0 && d < length && (i === 0 || d !== cuts[i - 1])), length]
    for (let m = 0; m + 1 < marks.length; m++) {
      const piece = slicePath(path, marks[m], marks[m + 1])
      pieces.push({
        wire: w.id,
        index: m,
        path: piece,
        a: nodeOf(pointKey(piece[0])),
        b: nodeOf(pointKey(piece[piece.length - 1])),
        whole: marks.length === 2,
      })
    }
  }
  const parent = new Map<string, string>()
  const find = (k: string): string => {
    let r = k
    while ((parent.get(r) ?? r) !== r) r = parent.get(r)!
    return r
  }
  for (const e of pieces) {
    if (!parent.has(e.a)) parent.set(e.a, e.a)
    if (!parent.has(e.b)) parent.set(e.b, e.b)
    parent.set(find(e.a), find(e.b))
  }
  const groups = new Map<string, Piece[]>()
  for (const e of pieces) {
    const r = find(e.a)
    const g = groups.get(r)
    if (g) g.push(e)
    else groups.set(r, [e])
  }
  for (const g of groups.values()) {
    const nodes = [...new Set(g.flatMap((e) => [e.a, e.b]))]
    const demand = nodes.map((n) => need.get(n) ?? 0)
    if (nodes.length < 2 || demand.every((d) => Math.abs(d) < 1e-12)) continue
    // A real wire is not a perfect conductor: its resistance grows with its length. Where wires form a loop that is what decides
    // how the current divides, so the answer is not a guess. The network of wires is solved on its own (the circuit's own results
    // never change): each stretch gets a resistance in proportion to its length, the current each part draws is injected at its
    // pins, and Kirchhoff's current law gives the potential of every junction and so the current in every stretch.
    const index = new Map(nodes.map((n, i) => [n, i]))
    const m = nodes.length - 1 // the first junction is the reference (potential 0), its row and column are left out
    const L = new Float64Array(m * m)
    const z = new Float64Array(m)
    const conductance = (e: Piece): number => 1 / Math.max(totalLength(e.path), 1)
    for (const e of g) {
      if (e.a === e.b) continue
      const i = index.get(e.a)! - 1
      const j = index.get(e.b)! - 1
      const c = conductance(e)
      if (i >= 0) L[i * m + i] += c
      if (j >= 0) L[j * m + j] += c
      if (i >= 0 && j >= 0) {
        L[i * m + j] -= c
        L[j * m + i] -= c
      }
    }
    // current arriving at a junction from the wires is what the parts there draw: (L V)_n = -draw_n
    for (let k = 1; k < nodes.length; k++) z[k - 1] = -demand[k]
    if (!gauss(L, z, m)) continue
    const potential = (n: string): number => {
      const k = index.get(n)!
      return k === 0 ? 0 : z[k - 1]
    }
    for (const e of g) {
      if (e.a === e.b) continue
      const signed = (potential(e.a) - potential(e.b)) * conductance(e) // positive = along the piece, start -> end
      if (e.whole) out.byWire.set(e.wire, signed)
      out.parts.push({ wire: e.wire, path: e.path, i: signed })
    }
  }
  return out
}

function segLen(a: Vec, b: Vec): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function totalLength(path: Vec[]): number {
  let t = 0
  for (let k = 0; k + 1 < path.length; k++) t += segLen(path[k], path[k + 1])
  return t
}

/** Distance along the path to the point `p` lying on it, or null if it does not. */
function alongPath(path: Vec[], p: Vec): number | null {
  let t = 0
  for (let k = 0; k + 1 < path.length; k++) {
    const a = path[k]
    const b = path[k + 1]
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    const within = p.x >= Math.min(a.x, b.x) - 0.5 && p.x <= Math.max(a.x, b.x) + 0.5 && p.y >= Math.min(a.y, b.y) - 0.5 && p.y <= Math.max(a.y, b.y) + 0.5
    if (Math.abs(cross) <= 0.5 && within) return t + segLen(a, p)
    t += segLen(a, b)
  }
  return null
}

/** The stretch of `path` between two distances along it, with the corners in between. */
function slicePath(path: Vec[], from: number, to: number): Vec[] {
  const pointAt = (d: number): Vec => {
    let t = 0
    for (let k = 0; k + 1 < path.length; k++) {
      const len = segLen(path[k], path[k + 1])
      if (d <= t + len + 1e-9) {
        const u = len === 0 ? 0 : Math.min(Math.max((d - t) / len, 0), 1)
        return { x: Math.round(path[k].x + (path[k + 1].x - path[k].x) * u), y: Math.round(path[k].y + (path[k + 1].y - path[k].y) * u) }
      }
      t += len
    }
    return path[path.length - 1]
  }
  const out: Vec[] = [pointAt(from)]
  let t = 0
  for (let k = 0; k + 1 < path.length; k++) {
    t += segLen(path[k], path[k + 1])
    if (t > from + 1e-9 && t < to - 1e-9) out.push(path[k + 1])
  }
  out.push(pointAt(to))
  return out
}
