// Multi-selection helpers: what a drag box covers, and copying a selection into the same lab.

import { defOf } from '../parts/index.ts'
import { G, rotVec, wirePath } from './world.ts'
import type { PartInstance, Vec, World, Wire } from './world.ts'

export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

export function normBox(a: Vec, b: Vec): Box {
  return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) }
}

/** World-space bounding box of a part: its body (rotated) plus any flexible lead tips. */
export function partBox(p: PartInstance): Box {
  const b = defOf(p.type).bounds(p)
  const corners = [
    { x: b.x, y: b.y },
    { x: b.x + b.w, y: b.y },
    { x: b.x, y: b.y + b.h },
    { x: b.x + b.w, y: b.y + b.h },
  ].map((c) => {
    const r = rotVec(c, p.rot)
    return { x: p.x + r.x, y: p.y + r.y }
  })
  for (const l of p.leads ?? []) corners.push(l)
  return {
    x0: Math.min(...corners.map((c) => c.x)),
    y0: Math.min(...corners.map((c) => c.y)),
    x1: Math.max(...corners.map((c) => c.x)),
    y1: Math.max(...corners.map((c) => c.y)),
  }
}

function inside(inner: Box, outer: Box): boolean {
  return inner.x0 >= outer.x0 && inner.y0 >= outer.y0 && inner.x1 <= outer.x1 && inner.y1 <= outer.y1
}

/** Parts and wires lying entirely inside the box. */
export function itemsInBox(world: World, box: Box): { parts: Set<string>; wires: Set<string> } {
  const parts = new Set<string>()
  const wires = new Set<string>()
  for (const p of world.parts) if (inside(partBox(p), box)) parts.add(p.id)
  for (const w of world.wires) {
    const pts = wirePath(w)
    if (pts.every((v) => v.x >= box.x0 && v.x <= box.x1 && v.y >= box.y0 && v.y <= box.y1)) wires.add(w.id)
  }
  return { parts, wires }
}

export interface Clip {
  parts: PartInstance[]
  wires: Wire[]
}

/** Width of the area a clip covers, rounded up to whole grid steps. */
export function clipWidth(clip: Clip): number {
  let x0 = Infinity
  let x1 = -Infinity
  for (const p of clip.parts) {
    const b = partBox(p)
    x0 = Math.min(x0, b.x0)
    x1 = Math.max(x1, b.x1)
  }
  for (const w of clip.wires) {
    for (const v of wirePath(w)) {
      x0 = Math.min(x0, v.x)
      x1 = Math.max(x1, v.x)
    }
  }
  return x1 > x0 ? Math.ceil((x1 - x0) / G) * G : 0
}

/** A deep copy of the chosen parts and wires. */
export function copyOut(world: World, partIds: Set<string>, wireIds: Set<string>): Clip {
  return {
    parts: world.parts.filter((p) => partIds.has(p.id)).map((p) => structuredClone(p)),
    wires: world.wires.filter((w) => wireIds.has(w.id)).map((w) => structuredClone(w)),
  }
}

/** Put a copy of the clip into the world, shifted by (dx, dy). Returns the new ids. */
export function pasteIn(world: World, clip: Clip, dx: number, dy: number): { parts: Set<string>; wires: Set<string> } {
  const parts = new Set<string>()
  const wires = new Set<string>()
  const shift = (v: Vec): Vec => ({ x: v.x + dx, y: v.y + dy })
  const boards: PartInstance[] = []
  for (const src of clip.parts) {
    const p = structuredClone(src)
    p.id = world.nextId('p')
    p.x += dx
    p.y += dy
    if (p.leads) p.leads = p.leads.map(shift)
    p.state = { heat: 0, failed: false, failMsg: '' }
    if ('pressed' in p.params) p.params.pressed = false
    if (p.type.startsWith('breadboard')) boards.push(p)
    else world.parts.push(p)
    parts.add(p.id)
  }
  world.parts.unshift(...boards) // a board goes under everything, as when placed from the toolbox
  for (const src of clip.wires) {
    const w = world.addWire(shift(src.a), shift(src.b), src.color, src.via.map(shift))
    if (src.taps && src.taps.length > 0) w.taps = src.taps.map(shift)
    wires.add(w.id)
  }
  return { parts, wires }
}
