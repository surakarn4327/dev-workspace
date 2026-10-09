// Branch wires: a wire whose end rests on the body of another wire (not on a pin, a hole or the other wire's own end)
// is joined to it. Electrically the two are one conductor, the branch is drawn in the main wire's colour, and when the
// part the branch was pulled from is deleted the branch goes with it. Nothing is stored: it is all worked out from where
// the wire ends lie, so moving an end away simply undoes the join.

import { boardHoles } from '../parts/breadboard.ts'
import { defOf, pinWorld } from '../parts/index.ts'
import { pointKey, wirePath } from './world.ts'
import type { PartInstance, Vec, World, Wire } from './world.ts'

/** Is `p` on the path of `w`, including its corners? */
export function onPath(p: Vec, w: Wire): boolean {
  const path = wirePath(w)
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]
    const b = path[i + 1]
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    if (Math.abs(cross) > 0.5) continue
    if (p.x >= Math.min(a.x, b.x) - 0.5 && p.x <= Math.max(a.x, b.x) + 0.5 && p.y >= Math.min(a.y, b.y) - 0.5 && p.y <= Math.max(a.y, b.y) + 0.5) return true
  }
  return false
}

/** Part pins and breadboard holes: a wire end on one of these plugs in there instead of tapping a wire that passes over it. */
export function socketKeys(world: World): Set<string> {
  const out = new Set<string>()
  for (const part of world.parts) {
    if (part.type.startsWith('breadboard')) for (const h of boardHoles(part)) out.add(pointKey(h.pos))
    else if (defOf(part.type).pinLabels.length > 0) for (const v of pinWorld(part)) out.add(pointKey(v))
  }
  return out
}

/** The wire whose body `end` of `w` rests on, if any (a tap, not an end-to-end meeting and not a plug). */
export function tapTarget(world: World, w: Wire, end: Vec, sockets: Set<string>): Wire | undefined {
  if (sockets.has(pointKey(end))) return undefined
  const key = pointKey(end)
  return world.wires.find((v) => v !== w && pointKey(v.a) !== key && pointKey(v.b) !== key && onPath(end, v))
}

/** Ends of `w` that rest on another wire (they get no metal pin: the branch just merges into the main wire). */
export function tapEnds(world: World, w: Wire, sockets: Set<string>): Vec[] {
  return [w.a, w.b].filter((e) => tapTarget(world, w, e, sockets) !== undefined)
}

/** For a branch wire: the main wire it rests on (checking both ends, `b` first, since that is the end you drop). */
export function mainOf(world: World, w: Wire, sockets: Set<string>): Wire | undefined {
  return tapTarget(world, w, w.b, sockets) ?? tapTarget(world, w, w.a, sockets)
}

/** Colour every wire is drawn in: a branch takes the colour of the wire it rests on (followed to the end of the chain). */
export function effectiveColors(world: World, sockets: Set<string> = socketKeys(world)): Map<string, string> {
  const out = new Map<string, string>()
  for (const w of world.wires) {
    let cur = w
    const seen = new Set<string>([w.id])
    for (;;) {
      const m = mainOf(world, cur, sockets)
      if (!m || seen.has(m.id)) break
      seen.add(m.id)
      cur = m
    }
    out.set(w.id, cur.color)
  }
  return out
}

/** The wire whose own colour decides how `w` is drawn (itself unless it is a branch). */
export function rootWire(world: World, w: Wire): Wire {
  const sockets = socketKeys(world)
  let cur = w
  const seen = new Set<string>([w.id])
  for (;;) {
    const m = mainOf(world, cur, sockets)
    if (!m || seen.has(m.id)) return cur
    seen.add(m.id)
    cur = m
  }
}

/**
 * Branch wires that go when these parts are deleted: wires resting on another wire whose other end is plugged into
 * one of the parts (a breadboard counts through its holes).
 */
export function branchesOfParts(world: World, parts: PartInstance[]): Set<string> {
  const keys = new Set<string>()
  for (const part of parts) {
    if (part.type.startsWith('breadboard')) for (const h of boardHoles(part)) keys.add(pointKey(h.pos))
    else for (const v of pinWorld(part)) keys.add(pointKey(v))
  }
  const sockets = socketKeys(world)
  const out = new Set<string>()
  for (const w of world.wires) {
    const onB = tapTarget(world, w, w.b, sockets) !== undefined
    const onA = tapTarget(world, w, w.a, sockets) !== undefined
    if (onB === onA) continue // not a branch, or tapping a wire at both ends (no single origin)
    if (keys.has(pointKey(onB ? w.a : w.b))) out.add(w.id)
  }
  return out
}

/**
 * Does a pasted group (parts + wires) sit on something outside it? A pin on a foreign wire end, a wire end on a foreign wire
 * end, or a wire end on a foreign pin would all join silently, so the group is held apart (red) until it is moved clear.
 */
export function groupCollides(world: World, partIds: Set<string>, wireIds: Set<string>): boolean {
  const foreign = new Set<string>()
  for (const w of world.wires) if (!wireIds.has(w.id)) for (const v of [w.a, w.b, ...(w.taps ?? [])]) foreign.add(pointKey(v))
  const foreignPins = new Set<string>()
  for (const p of world.parts) {
    if (partIds.has(p.id) || p.type.startsWith('breadboard') || defOf(p.type).pinLabels.length === 0) continue
    for (const v of pinWorld(p)) foreignPins.add(pointKey(v))
  }
  for (const id of partIds) {
    const p = world.getPart(id)
    if (!p || p.type.startsWith('breadboard') || defOf(p.type).pinLabels.length === 0) continue
    if (pinWorld(p).some((v) => foreign.has(pointKey(v)))) return true
  }
  for (const id of wireIds) {
    const w = world.getWire(id)
    if (w && [w.a, w.b, ...(w.taps ?? [])].some((v) => foreign.has(pointKey(v)) || foreignPins.has(pointKey(v)))) return true
  }
  // a wire end resting on the body of a wire of the other side joins it too (the branch rule), whichever side the end belongs to:
  // a pasted circuit laid over the original used to pick up such joins, and dragging it away then stretched a wire between the two
  const sockets = socketKeys(world)
  const restsOn = (w: Wire, other: Wire): boolean =>
    [w.a, w.b].some((end) => !sockets.has(pointKey(end)) && pointKey(other.a) !== pointKey(end) && pointKey(other.b) !== pointKey(end) && onPath(end, other))
  const group = world.wires.filter((w) => wireIds.has(w.id))
  const others = world.wires.filter((w) => !wireIds.has(w.id))
  for (const g of group) for (const o of others) if (restsOn(g, o) || restsOn(o, g)) return true
  return false
}
