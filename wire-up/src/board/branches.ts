// Branch wires stay joined to the wire they rest on when that wire is reshaped or pulled along by a part: a branch end is
// only a position on the main wire's body, so when the stretch it sits on moves, the end slides with it (its own wire gets
// longer or shorter). See wireJoin.ts for how a rest-on-the-body join is recognised.

import { socketKeys, tapTarget } from './wireJoin.ts'
import { cornerBetween, tidy, unfold } from './wireEdit.ts'
import { wirePath } from './world.ts'
import type { Vec, Wire, World } from './world.ts'

export interface BranchEnd {
  /** The branch wire and which of its ends rests on the main wire. */
  wire: string
  end: 'a' | 'b'
  /** Where that end was when the drag started. */
  at: Vec
}

/** Every branch end resting on the body of `main`, as the wires are now. */
export function branchEndsOf(world: World, main: Wire, sockets: Set<string> = socketKeys(world)): BranchEnd[] {
  const out: BranchEnd[] = []
  for (const w of world.wires) {
    if (w === main) continue
    for (const end of ['a', 'b'] as const) {
      if (tapTarget(world, w, w[end], sockets) === main) out.push({ wire: w.id, end, at: { x: w[end].x, y: w[end].y } })
    }
  }
  return out
}

/** Branch ends of every wire that has any, for a part drag that may reshape several wires. */
export function branchMap(world: World): Map<string, BranchEnd[]> {
  const sockets = socketKeys(world)
  const out = new Map<string, BranchEnd[]>()
  for (const w of world.wires) {
    const ends = branchEndsOf(world, w, sockets)
    if (ends.length > 0) out.set(w.id, ends)
  }
  return out
}

function segments(path: Vec[]): [Vec, Vec][] {
  const out: [Vec, Vec][] = []
  for (let k = 0; k + 1 < path.length; k++) if (path[k].x !== path[k + 1].x || path[k].y !== path[k + 1].y) out.push([path[k], path[k + 1]])
  return out
}

const vertical = (s: [Vec, Vec]): boolean => s[0].x === s[1].x

/**
 * Where the point `at`, which rested on the stretch of `oldPath` it lay on, ends up on `newPath`: on the stretch of the
 * same direction that is nearest across, at the same place along it (held inside the stretch if that got shorter).
 */
export function slideEnd(at: Vec, oldPath: Vec[], newPath: Vec[]): Vec {
  const onOld = segments(oldPath).find(([a, b]) => {
    const cross = (b.x - a.x) * (at.y - a.y) - (b.y - a.y) * (at.x - a.x)
    return Math.abs(cross) <= 0.5 && at.x >= Math.min(a.x, b.x) - 0.5 && at.x <= Math.max(a.x, b.x) + 0.5 && at.y >= Math.min(a.y, b.y) - 0.5 && at.y <= Math.max(a.y, b.y) + 0.5
  })
  if (!onOld) return at
  const vert = vertical(onOld)
  let best: Vec | null = null
  let bestCost = Infinity
  for (const s of segments(newPath)) {
    if (vertical(s) !== vert) continue
    const across = vert ? s[0].x : s[0].y
    const lo = vert ? Math.min(s[0].y, s[1].y) : Math.min(s[0].x, s[1].x)
    const hi = vert ? Math.max(s[0].y, s[1].y) : Math.max(s[0].x, s[1].x)
    const along = Math.min(Math.max(vert ? at.y : at.x, lo), hi)
    const cost = Math.abs(across - (vert ? at.x : at.y)) + Math.abs(along - (vert ? at.y : at.x)) * 0.01
    if (cost < bestCost) {
      bestCost = cost
      best = vert ? { x: across, y: along } : { x: along, y: across }
    }
  }
  if (best) return best
  // no stretch of that direction is left: the nearest place on the new wire at all
  let near: Vec = at
  let nearCost = Infinity
  for (const [a, b] of segments(newPath)) {
    const x = Math.min(Math.max(at.x, Math.min(a.x, b.x)), Math.max(a.x, b.x))
    const y = Math.min(Math.max(at.y, Math.min(a.y, b.y)), Math.max(a.y, b.y))
    const cost = Math.abs(x - at.x) + Math.abs(y - at.y)
    if (cost < nearCost) {
      nearCost = cost
      near = { x, y }
    }
  }
  return near
}

/**
 * Bring the `end` of branch wire `w` to `to` when its first stretch cannot just get longer or shorter: the stretch before
 * the end is kept and the wire turns one corner to reach the new place, so it stays all right angles.
 */
function reattach(w: Wire, end: 'a' | 'b', to: Vec): void {
  const path = wirePath(w)
  const oriented = end === 'b' ? path : [...path].reverse() // far end first, the end being moved last
  const head = oriented.slice(0, -1)
  const near = head[head.length - 1]
  const prev = head[head.length - 2]
  const full = [...head, ...cornerBetween(prev, near, to), to]
  const out = end === 'b' ? full : full.reverse()
  const a = out[0]
  const b = out[out.length - 1]
  const via = tidy([a, ...unfold(a, tidy(out), b), b])
  w.a = a
  w.b = b
  w.via = via
  if (w.taps) {
    const taps = w.taps.filter((t) => via.some((v) => v.x === t.x && v.y === t.y))
    w.taps = taps.length > 0 ? taps : undefined
  }
}

/**
 * Slide the branch ends of a wire that went from `oldPath` to `newPath`. A branch end that only has to move along its own
 * first stretch just gets that stretch longer or shorter; one that has to move sideways to it (the stretch it sat on got
 * shorter than the way to it, or went away) turns one corner to get there.
 */
export function carryBranches(world: World, ends: BranchEnd[], oldPath: Vec[], newPath: Vec[]): void {
  for (const be of ends) {
    const w = world.getWire(be.wire)
    if (!w) continue
    const to = slideEnd(be.at, oldPath, newPath)
    if (to.x === w[be.end].x && to.y === w[be.end].y) continue
    const path = wirePath(w)
    const near = be.end === 'a' ? path[1] : path[path.length - 2]
    // the branch's first stretch keeps its direction when the end moves along it: it just gets longer or shorter
    const keepsDirection = (near.x === be.at.x && to.x === be.at.x) || (near.y === be.at.y && to.y === be.at.y)
    if (keepsDirection) w[be.end] = to
    else reattach(w, be.end, to)
  }
}
