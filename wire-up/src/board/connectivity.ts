// Turns the drawn workspace (parts, wires, breadboards) into a solver circuit.
// Rule: two things are connected when their end points sit on the same grid point.

import type { Circuit, Element } from '../sim/solver.ts'
import { boardHoles } from '../parts/breadboard.ts'
import { defOf, pinWorld } from '../parts/index.ts'
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
  /** Point keys that have a pin or a wire end on them. */
  usedKeys: Set<string>
  nodeAt(p: Vec): number | undefined
}

export function buildNetlist(world: World): Netlist {
  const uf = new UnionFind()
  const usedKeys = new Set<string>()

  for (const part of world.parts) {
    if (part.type.startsWith('breadboard')) {
      for (const h of boardHoles(part)) uf.union(pointKey(h.pos), h.strip)
    }
  }
  for (const w of world.wires) {
    usedKeys.add(pointKey(w.a))
    usedKeys.add(pointKey(w.b))
    uf.union(pointKey(w.a), pointKey(w.b))
    // corners that were plugged ends stay joined: a wire pulled out of a pin or hole keeps its hold there
    for (const t of w.taps ?? []) {
      usedKeys.add(pointKey(t))
      uf.union(pointKey(t), pointKey(w.a))
    }
  }

  const pinKeys = new Map<string, string[]>()
  for (const part of world.parts) {
    const def = defOf(part.type)
    if (def.pinLabels.length === 0) continue
    const keys = pinWorld(part).map(pointKey)
    pinKeys.set(part.id, keys)
    for (const k of keys) {
      usedKeys.add(k)
      uf.find(k)
    }
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

  const elements: Element[] = []
  const partPins = new Map<string, number[]>()
  for (const part of world.parts) {
    const keys = pinKeys.get(part.id)
    if (!keys) continue
    const nodes = keys.map(nodeFor)
    partPins.set(part.id, nodes)
    defOf(part.type).build(part, {
      pins: nodes,
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
    if (n !== undefined) elements.push({ kind: 'R', id: `tie:${root}`, a: n, b: 0, r: 1e9 })
  }

  return {
    circuit: { nodeCount, elements },
    partPins,
    usedKeys,
    nodeAt(p) {
      const k = pointKey(p)
      if (!uf.has(k)) return undefined
      return nodeOfRoot.get(uf.find(k))
    },
  }
}
