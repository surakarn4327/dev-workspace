// Current in each wire, for the flowing-dots animation. The solver only knows node voltages and element currents, so the
// current in a wire is rebuilt from the currents each part draws at its pins: a wire network that is a tree (no loops, no
// branch wires resting on another wire) has exactly one answer, found by peeling it from the leaves. Anything else is left
// out (no dots) rather than guessed.

import { boardHoles } from '../parts/breadboard.ts'
import { pinWorld } from '../parts/index.ts'
import type { SolveResult } from '../sim/solver.ts'
import type { Element } from '../sim/solver.ts'
import type { Netlist } from './connectivity.ts'
import { socketKeys, tapTarget } from './wireJoin.ts'
import { pointKey } from './world.ts'
import type { World } from './world.ts'

/** (circuit node, current drawn from that node into the element) for every terminal of an element. */
function draws(e: Element, res: SolveResult): [number, number][] {
  const c = res.cur.get(e.id)
  if (!c) return []
  switch (e.kind) {
    case 'Q':
      return [[e.c, c.i], [e.b, c.ib ?? 0], [e.e, -(c.i + (c.ib ?? 0))]]
    case 'G':
      return [[e.y, -c.i], [e.ref ?? 0, c.i]] // the symbol gate pushes c.i out of Y and takes it back from its reference
    case 'C':
      return [[e.y, c.i + (c.ib ?? 0)], [e.vcc, -c.i], [e.gnd, -(c.ib ?? 0)]] // a chip gate: in through VCC, out through GND
    default:
      return [[e.a, c.i], [e.b, -c.i]]
  }
}

/** Signed current in each wire, positive when it flows from the wire's `a` end to its `b` end. Wires with no answer are absent. */
export function computeFlow(world: World, net: Netlist, res: SolveResult): Map<string, number> {
  const out = new Map<string, number>()
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
      for (const [n, i] of draws(e, res)) {
        // several pins can share a node (an input wired straight to +): a chip's supply current belongs to its VCC / GND pin
        const supplyPin = e.kind === 'C' ? (n === e.vcc ? 13 : n === e.gnd ? 6 : -1) : -1
        const pin = supplyPin >= 0 && nodes[supplyPin] === n ? supplyPin : nodes.indexOf(n)
        if (pin >= 0) add(keys[pin], i)
        else if (anyPinAt.has(n)) add(anyPinAt.get(n)!, i)
      }
    }
  }

  // wire networks
  const sockets = socketKeys(world)
  const parent = new Map<string, string>()
  const find = (k: string): string => {
    let r = k
    while ((parent.get(r) ?? r) !== r) r = parent.get(r)!
    return r
  }
  const edges = world.wires.map((w) => ({ w, a: nodeOf(pointKey(w.a)), b: nodeOf(pointKey(w.b)) }))
  for (const e of edges) {
    if (!parent.has(e.a)) parent.set(e.a, e.a)
    if (!parent.has(e.b)) parent.set(e.b, e.b)
    parent.set(find(e.a), find(e.b))
  }
  const groups = new Map<string, typeof edges>()
  for (const e of edges) {
    const r = find(e.a)
    const g = groups.get(r)
    if (g) g.push(e)
    else groups.set(r, [e])
  }
  for (const g of groups.values()) {
    const nodes = new Set<string>()
    let branched = false
    for (const e of g) {
      nodes.add(e.a)
      nodes.add(e.b)
      if ((e.w.taps?.length ?? 0) > 0 || tapTarget(world, e.w, e.w.a, sockets) || tapTarget(world, e.w, e.w.b, sockets)) branched = true
      // a branch wire resting on this one
      for (const o of world.wires) if (o !== e.w && (tapTarget(world, o, o.a, sockets) === e.w || tapTarget(world, o, o.b, sockets) === e.w)) branched = true
    }
    if (branched || g.length !== nodes.size - 1 || g.some((e) => e.a === e.b)) continue // loops or branches: no answer
    // peel leaves: the current into a leaf is what everything beyond it draws
    const left = new Set(g)
    const demand = new Map<string, number>()
    for (const n of nodes) demand.set(n, need.get(n) ?? 0)
    const degree = new Map<string, number>()
    for (const e of g) {
      degree.set(e.a, (degree.get(e.a) ?? 0) + 1)
      degree.set(e.b, (degree.get(e.b) ?? 0) + 1)
    }
    let progress = true
    while (left.size > 0 && progress) {
      progress = false
      for (const e of [...left]) {
        const leaf = degree.get(e.a) === 1 ? e.a : degree.get(e.b) === 1 ? e.b : null
        if (leaf === null) continue
        const parentNode = leaf === e.a ? e.b : e.a
        const into = demand.get(leaf) ?? 0
        out.set(e.w.id, leaf === e.b ? into : -into) // positive = a -> b
        demand.set(parentNode, (demand.get(parentNode) ?? 0) + into)
        degree.set(leaf, 0)
        degree.set(parentNode, (degree.get(parentNode) ?? 1) - 1)
        left.delete(e)
        progress = true
      }
    }
  }
  return out
}
