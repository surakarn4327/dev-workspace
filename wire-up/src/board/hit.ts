// Pointer hit testing in world coordinates.

import { defOf, pinWorld } from '../parts/index.ts'
import { holeNear } from '../parts/breadboard.ts'
import { unrotVec, wirePath } from './world.ts'
import type { PartInstance, Vec, Wire, World } from './world.ts'

export type Hit =
  | { kind: 'lead'; part: PartInstance; index: number; point: Vec }
  | { kind: 'wireEnd'; wire: Wire; end: 'a' | 'b'; point: Vec }
  | { kind: 'bend'; wire: Wire; index: number; point: Vec }
  | { kind: 'pin'; part: PartInstance; index: number; point: Vec }
  | { kind: 'wire'; wire: Wire }
  | { kind: 'part'; part: PartInstance; local: Vec }
  | { kind: 'hole'; point: Vec }
  | { kind: 'board'; part: PartInstance; local: Vec }
  | { kind: 'none' }

function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function segDist(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  if (l2 === 0) return dist(p, a)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy })
}

export function hitTest(world: World, p: Vec, zoom: number, selectedWire: string | null, skipWires = false): Hit {
  const tol = Math.min(Math.max(7, 8 / zoom), 12)

  // flexible lead tips (probes, battery leads) sit on top of everything
  for (let k = world.parts.length - 1; k >= 0; k--) {
    const part = world.parts[k]
    if (!defOf(part.type).freeLeads || !part.leads) continue
    for (let i = 0; i < part.leads.length; i++) {
      if (dist(part.leads[i], p) <= tol + 3) return { kind: 'lead', part, index: i, point: part.leads[i] }
    }
  }

  const sel = selectedWire ? world.getWire(selectedWire) : undefined
  if (sel) {
    for (const end of ['a', 'b'] as const) if (dist(sel[end], p) <= tol + 2) return { kind: 'wireEnd', wire: sel, end, point: sel[end] }
    for (let i = 0; i < sel.via.length; i++) if (dist(sel.via[i], p) <= tol + 2) return { kind: 'bend', wire: sel, index: i, point: sel.via[i] }
  }

  let bestPin: Hit | null = null
  let bestD = tol
  for (const part of world.parts) {
    const def = defOf(part.type)
    if (def.freeLeads || def.pinLabels.length === 0) continue
    pinWorld(part).forEach((pt, index) => {
      const d = dist(pt, p)
      if (d <= bestD) {
        bestD = d
        bestPin = { kind: 'pin', part, index, point: pt }
      }
    })
  }
  if (bestPin) return bestPin

  for (let k = skipWires ? -1 : world.wires.length - 1; k >= 0; k--) {
    const w = world.wires[k]
    const path = wirePath(w)
    for (let i = 0; i + 1 < path.length; i++) {
      if (segDist(p, path[i], path[i + 1]) <= Math.max(5, 6 / zoom)) return { kind: 'wire', wire: w }
    }
  }

  for (let k = world.parts.length - 1; k >= 0; k--) {
    const part = world.parts[k]
    const def = defOf(part.type)
    if (part.type.startsWith('breadboard')) continue
    const local = unrotVec({ x: p.x - part.x, y: p.y - part.y }, part.rot)
    const b = def.bounds(part)
    if (local.x >= b.x - 2 && local.x <= b.x + b.w + 2 && local.y >= b.y - 2 && local.y <= b.y + b.h + 2) return { kind: 'part', part, local }
  }

  for (let k = world.parts.length - 1; k >= 0; k--) {
    const part = world.parts[k]
    if (!part.type.startsWith('breadboard')) continue
    const hole = holeNear(part, p, tol + 1)
    if (hole) return { kind: 'hole', point: hole }
  }

  for (let k = world.parts.length - 1; k >= 0; k--) {
    const part = world.parts[k]
    if (!part.type.startsWith('breadboard')) continue
    const b = defOf(part.type).bounds(part)
    const local = { x: p.x - part.x, y: p.y - part.y }
    if (local.x >= b.x && local.x <= b.x + b.w && local.y >= b.y && local.y <= b.y + b.h) return { kind: 'board', part, local }
  }
  return { kind: 'none' }
}
