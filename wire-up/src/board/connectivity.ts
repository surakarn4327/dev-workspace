// Turns the drawn workspace (parts, wires, breadboards) into a solver circuit.
// Rule: two things are connected when their end points sit on the same grid point; a wire end resting on the body of
// another wire (not on a pin or hole) joins that wire too.

import type { Circuit, Element } from '../sim/solver.ts'
import { boardHoles } from '../parts/breadboard.ts'
import { defOf, pinWorld } from '../parts/index.ts'
import { socketKeys, tapTarget } from './wireJoin.ts'
import { pointKey } from './world.ts'
import type { Vec, World } from './world.ts'

class UnionFind {
  private parent = new Map<string, string>()

  find(k: string): string {
    let p = this.parent.get(k)
    if (p === undefined) {
      this.parent.set(k, k)
      return k
    }
    let root = k
    while (p !== root) {
      root = p
      p = this.parent.get(root) ?? root
    }
    // path compression
    let cur = k
    while (cur !== root) {
      const next = this.parent.get(cur) ?? root
      this.parent.set(cur, root)
      cur = next
    }
    return root
  }

  union(a: string, b: string): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }

  has(k: string): boolean {
    return this.parent.has(k)
  }
}

export interface Netlist {
  circuit: Circuit
  /** Node number of each pin, by part id. */
  partPins: Map<string, number[]>
  /** Reference node of each logic gate (the negative of a source in its own circuit, else ground), by part id. */
  partRef: Map<string, number>
  /** Point keys that have a pin or a wire end on them. */
  usedKeys: Set<string>
  /** True if some part (a chip with a floating input) changes with time, so the netlist must be rebuilt every so often. */
  animated: boolean
  nodeAt(p: Vec): number | undefined
}

/**
 * A circuit that shares nothing with the reference gets this weak tie to ground, so its voltages are defined. Too weak (1 Gohm)
 * and Newton wanders along that nearly free common-mode direction: a board with several separate circuits took 70-280 rounds
 * to settle after a switch flip; 10 Mohm keeps it at 3-15 and leaks only 0.5 uA from a 4.5 V cell.
 */
const FLOAT_TIE = 1e7

export function buildNetlist(world: World, time = 0): Netlist {
  let animated = false
  const uf = new UnionFind()
  // a point's key; items of an isolated paste group get their own namespace so they join each other but nothing else
  const keyOf = (p: Vec, owner: string): string => {
    const group = world.isolated.get(owner)
    return group === undefined ? pointKey(p) : `${pointKey(p)}#${group}`
  }
  const usedKeys = new Set<string>()

  for (const part of world.parts) {
    if (part.type.startsWith('breadboard')) {
      for (const h of boardHoles(part)) uf.union(pointKey(h.pos), h.strip)
    }
  }
  for (const w of world.wires) {
    usedKeys.add(pointKey(w.a))
    usedKeys.add(pointKey(w.b))
    uf.union(keyOf(w.a, w.id), keyOf(w.b, w.id))
    // corners that were plugged ends stay joined: a wire pulled out of a pin or hole keeps its hold there
    for (const t of w.taps ?? []) {
      usedKeys.add(pointKey(t))
      uf.union(keyOf(t, w.id), keyOf(w.a, w.id))
    }
  }

  // a wire end resting on the body of another wire taps it: one conductor
  const sockets = socketKeys(world)
  for (const w of world.wires) {
    for (const end of [w.a, w.b]) {
      const main = tapTarget(world, w, end, sockets)
      if (main && world.isolated.get(w.id) === world.isolated.get(main.id)) uf.union(keyOf(end, w.id), keyOf(main.a, main.id))
    }
  }

  // Bare metal a meter probe can touch: part pins, breadboard holes and the metal caps at the ends of jumper wires. A wire resting
  // on the middle of another one (a branch) and a plugged corner are covered (soldered and sleeved): a probe there touches
  // insulation and reads nothing.
  const exposed = new Set<string>(sockets)
  for (const w of world.wires) {
    for (const end of [w.a, w.b]) if (tapTarget(world, w, end, sockets) === undefined) exposed.add(pointKey(end))
  }

  const pinKeys = new Map<string, string[]>()
  for (const part of world.parts) {
    const def = defOf(part.type)
    if (def.pinLabels.length === 0) continue
    const plain = pinWorld(part).map(pointKey)
    // an isolated part (placed with a pin on a wire end, shown red) is not joined to anything until it is moved away
    let keys = world.isolated.has(part.id) ? plain.map((k) => `${k}#${world.isolated.get(part.id)}`) : plain
    // a probe tip on covered metal touches nothing: it gets a node of its own
    if (def.freeLeads) keys = keys.map((k, i) => (exposed.has(plain[i]) ? k : `${k}#probe:${part.id}:${i}`))
    pinKeys.set(part.id, keys)
    for (const k of keys) uf.find(k)
    for (const k of plain) usedKeys.add(k)
  }

  // Reference node: negative terminal of the first live source, else anything.
  let groundRoot: string | undefined
  const sourceNegRoots: string[] = []
  for (const part of world.parts) {
    if ((part.type.startsWith('battery') || part.type === 'supply') && !part.state.failed) {
      const keys = pinKeys.get(part.id)
      if (!keys) continue
      const root = uf.find(keys[1])
      sourceNegRoots.push(root)
      groundRoot ??= root
    }
  }
  if (groundRoot === undefined) {
    const first = [...pinKeys.values()][0]
    if (first) groundRoot = uf.find(first[0])
  }

  const nodeOfRoot = new Map<string, number>()
  if (groundRoot !== undefined) nodeOfRoot.set(groundRoot, 0)
  let nodeCount = 1
  const nodeFor = (key: string): number => {
    const root = uf.find(key)
    let n = nodeOfRoot.get(root)
    if (n === undefined) {
      n = nodeCount++
      nodeOfRoot.set(root, n)
    }
    return n
  }

  // how many part pins share each net: a pin alone on its net (a chip's GND with nothing wired to it) is not connected
  const pinsOnNet = new Map<string, number>()
  for (const keys of pinKeys.values()) for (const k of keys) pinsOnNet.set(uf.find(k), (pinsOnNet.get(uf.find(k)) ?? 0) + 1)

  const elements: Element[] = []
  const partPins = new Map<string, number[]>()
  const partRef = new Map<string, number>()
  for (const part of world.parts) {
    const keys = pinKeys.get(part.id)
    if (keys) partPins.set(part.id, keys.map(nodeFor))
  }

  // A logic gate has no ground pin, so it measures against the negative of a source in its own circuit. "Own circuit" =
  // nodes joined through the other parts (a resistor, an LED, a switch...); a source and a gate do not join anything.
  const island = new Map<number, number>()
  const islandOf = (n: number): number => {
    let r = n
    while (island.has(r) && island.get(r) !== r) r = island.get(r)!
    return r
  }
  const isSource = (t: string) => t.startsWith('battery') || t === 'supply'
  for (const part of world.parts) {
    const pins = partPins.get(part.id)
    if (!pins || pins.length < 2 || isSource(part.type) || part.type.startsWith('gate-')) continue
    for (let i = 1; i < pins.length; i++) {
      const a = islandOf(pins[0])
      const b = islandOf(pins[i])
      if (a !== b) island.set(a, b)
      else if (!island.has(a)) island.set(a, a)
    }
  }
  const sourceNegs = world.parts.flatMap((p) => {
    const pins = partPins.get(p.id)
    return pins && isSource(p.type) && !p.state.failed ? [pins[1]] : []
  })
  for (const part of world.parts) {
    if (!part.type.startsWith('gate-')) continue
    const pins = partPins.get(part.id)
    if (!pins) continue
    const mine = new Set(pins.map(islandOf))
    partRef.set(part.id, sourceNegs.find((n) => mine.has(islandOf(n))) ?? 0)
  }

  for (const part of world.parts) {
    const nodes = partPins.get(part.id)
    if (!nodes) continue
    defOf(part.type).build(part, {
      pins: nodes,
      ref: partRef.get(part.id) ?? 0,
      wired: (pin) => (pinsOnNet.get(uf.find(pinKeys.get(part.id)![pin])) ?? 0) > 1,
      time,
      animate: () => {
        animated = true
      },
      newNode: () => nodeCount++,
      add: (e) => elements.push(e),
      id: (s) => `${part.id}:${s}`,
    })
  }

  // Sources floating away from the reference island get a weak tie so their voltages are defined.
  const tied = new Set<string>()
  if (groundRoot !== undefined) tied.add(uf.find(groundRoot))
  for (const root of sourceNegRoots) {
    if (tied.has(root)) continue
    tied.add(root)
    const n = nodeOfRoot.get(root)
    if (n !== undefined) elements.push({ kind: 'R', id: `tie:${root}`, a: n, b: 0, r: FLOAT_TIE })
  }

  return {
    circuit: { nodeCount, elements },
    partPins,
    partRef,
    animated,
    usedKeys,
    nodeAt(p) {
      const k = pointKey(p)
      if (!uf.has(k)) return undefined
      return nodeOfRoot.get(uf.find(k))
    },
  }
}
