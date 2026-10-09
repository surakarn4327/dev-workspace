// What travels along when a part is dragged: wire ends plugged into its pins follow it, and moving a breadboard
// carries everything sitting on it (parts with a pin in a hole, wire ends in holes, probe tips in holes).

import { boardHoles } from '../parts/breadboard.ts'
import { defOf, pinWorld } from '../parts/index.ts'
import { branchMap, carryBranches, moveBranchEnd } from './branches.ts'
import type { BranchEnd } from './branches.ts'
import { tidy, unfold } from './wireEdit.ts'
import { pointKey } from './world.ts'
import type { PartInstance, Vec, Wire, World } from './world.ts'

interface PartSnap {
  x: number
  y: number
  leads: Vec[] | null
}

export interface FollowPlan {
  /** Parts that move bodily with the dragged one (parts standing on a dragged breadboard). */
  carried: PartInstance[]
  /** Probe-style parts that stay put: only the lead tips lying on the dragged breadboard travel. */
  partial: PartInstance[]
  /** Keys of the points that travel, as they were before the drag started. */
  moving: Set<string>
  parts: Map<string, PartSnap>
  wires: Wire[]
  /** Ids of wires that move as a whole (selected wires of a group drag). */
  whole: Set<string>
  /** Wires that must stay put even if an end lies on a travelling point (they belong to the other side of a held paste). */
  skip?: Set<string>
  /** Branch wires resting on each wire, as they were when the drag started: they slide with the stretch they sit on. */
  branches?: Map<string, BranchEnd[]>
}

function clonePoint(v: Vec): Vec {
  return { x: v.x, y: v.y }
}

function cloneWireShape(w: Wire): Wire {
  const out: Wire = { id: w.id, a: clonePoint(w.a), b: clonePoint(w.b), via: w.via.map(clonePoint), color: w.color }
  if (w.taps) out.taps = w.taps.map(clonePoint)
  return out
}

/** Work out, before a drag starts, which parts and wire points will travel with `dragged`. */
export function planFollow(world: World, dragged: PartInstance): FollowPlan {
  const moving = new Set<string>()
  const carried: PartInstance[] = []
  const partial: PartInstance[] = []
  if (dragged.type.startsWith('breadboard')) {
    const holes = new Set(boardHoles(dragged).map((h) => pointKey(h.pos)))
    for (const p of world.parts) {
      if (p === dragged || p.type.startsWith('breadboard')) continue
      const onBoard = pinWorld(p).some((v) => holes.has(pointKey(v)))
      if (!onBoard) continue
      if (defOf(p.type).freeLeads) partial.push(p)
      else carried.push(p)
    }
    for (const k of holes) moving.add(k)
    for (const p of carried) for (const v of pinWorld(p)) moving.add(pointKey(v))
  } else {
    for (const v of pinWorld(dragged)) moving.add(pointKey(v))
  }
  const parts = new Map<string, PartSnap>()
  for (const p of [...carried, ...partial]) parts.set(p.id, { x: p.x, y: p.y, leads: p.leads ? p.leads.map(clonePoint) : null })
  return { carried, partial, moving, parts, wires: world.wires.map(cloneWireShape), whole: new Set(), skip: skipSet(world, [dragged.id]), branches: branchMap(world) }
}

/**
 * Like `planFollow`, for a whole selection: every selected part moves bodily (a selected breadboard also carries what
 * stands on it), selected wires move as they are, and other wires plugged into any of it follow with their ends.
 */
export function planGroup(world: World, partIds: Set<string>, wireIds: Set<string>): FollowPlan {
  const carried: PartInstance[] = []
  const partial: PartInstance[] = []
  const moving = new Set<string>()
  for (const id of partIds) {
    const p = world.getPart(id)
    if (p) carried.push(p)
  }
  for (const board of [...carried].filter((p) => p.type.startsWith('breadboard'))) {
    const holes = new Set(boardHoles(board).map((h) => pointKey(h.pos)))
    for (const k of holes) moving.add(k)
    for (const p of world.parts) {
      if (p.type.startsWith('breadboard') || carried.includes(p) || partial.includes(p)) continue
      if (!pinWorld(p).some((v) => holes.has(pointKey(v)))) continue
      if (defOf(p.type).freeLeads) partial.push(p)
      else carried.push(p)
    }
  }
  for (const p of carried) if (!p.type.startsWith('breadboard')) for (const v of pinWorld(p)) moving.add(pointKey(v))
  const whole = new Set<string>()
  for (const id of wireIds) {
    const w = world.getWire(id)
    if (!w) continue
    whole.add(id)
    for (const v of [w.a, w.b, ...w.via, ...(w.taps ?? [])]) moving.add(pointKey(v))
  }
  const parts = new Map<string, PartSnap>()
  for (const p of [...carried, ...partial]) parts.set(p.id, { x: p.x, y: p.y, leads: p.leads ? p.leads.map(clonePoint) : null })
  return { carried, partial, moving, parts, wires: world.wires.map(cloneWireShape), whole, skip: skipSet(world, [...carried.map((p) => p.id), ...wireIds]), branches: branchMap(world) }
}

/**
 * A held (red) paste is cut off from the circuit, so wires of the other side must not follow it, and a held wire must not be
 * dragged along by something it merely lies on. Wires whose hold state differs from the dragged items' are skipped.
 */
function skipSet(world: World, draggedIds: string[]): Set<string> {
  const held = draggedIds.some((id) => world.isolated.has(id))
  const out = new Set<string>()
  for (const w of world.wires) if (world.isolated.has(w.id) !== held) out.add(w.id)
  return out
}

function same(a: Vec, b: Vec): boolean {
  return a.x === b.x && a.y === b.y
}

/** The wire as it was, with its travelling ends and plugs moved by (dx, dy) and its corners repaired to right angles. */
function followWire(w: Wire, moving: Set<string>, dx: number, dy: number): Pick<Wire, 'a' | 'b' | 'via' | 'taps'> {
  const taps = w.taps ?? []
  const pts = [w.a, ...w.via, w.b]
  const last = pts.length - 1
  const flags = pts.map((v, i) => (i === 0 || i === last || taps.some((t) => same(t, v))) && moving.has(pointKey(v)))
  const shift = (v: Vec): Vec => ({ x: v.x + dx, y: v.y + dy })
  if (!flags.some(Boolean)) return { a: clonePoint(w.a), b: clonePoint(w.b), via: w.via.map(clonePoint), taps: taps.map(clonePoint) }
  if (flags[0] && flags[last]) {
    // both ends travel: the whole wire moves as it is
    return { a: shift(w.a), b: shift(w.b), via: w.via.map(shift), taps: taps.filter((t) => w.via.some((v) => same(v, t))).map(shift) }
  }
  const q = pts.map((v, i) => (flags[i] ? shift(v) : clonePoint(v)))
  // Rubber band: the corner next to a travelling end slides along with it (a vertical last stretch keeps its x and follows
  // the end sideways, a horizontal one follows it up or down) instead of the wire growing an extra corner to stay straight.
  for (const e of [0, last]) {
    const n = e === 0 ? 1 : last - 1
    const m = e === 0 ? 2 : last - 2
    if (!flags[e] || n < 1 || n > last - 1 || m < 0 || m > last) continue
    if (flags[n] || taps.some((t) => same(t, pts[n]))) continue
    if (pts[e].x === pts[n].x && pts[m].y === pts[n].y && dx !== 0) q[n] = { x: pts[n].x + dx, y: pts[n].y }
    else if (pts[e].y === pts[n].y && pts[m].x === pts[n].x && dy !== 0) q[n] = { x: pts[n].x, y: pts[n].y + dy }
  }
  // rubber band: a travelling end drags the corner next to it along, so the wire gets shorter instead of growing a new corner
  for (let i = 0; i < last; i++) {
    if (q[i].x === q[i + 1].x || q[i].y === q[i + 1].y) continue
    const moved = flags[i] ? i : flags[i + 1] ? i + 1 : -1
    const other = moved === i ? i + 1 : i
    if (moved < 0 || flags[other] || other === 0 || other === last || taps.some((t) => same(t, pts[other]))) continue
    if (pts[i].x === pts[i + 1].x) q[other].x = q[moved].x
    else q[other].y = q[moved].y
  }
  const out: Vec[] = [q[0]]
  for (let i = 0; i < last; i++) {
    if (q[i].x !== q[i + 1].x && q[i].y !== q[i + 1].y) {
      // a stretch that is no longer straight keeps leaving its fixed end in the direction it used to run
      const vertical = pts[i].x === pts[i + 1].x
      out.push(vertical ? { x: q[i].x, y: q[i + 1].y } : { x: q[i + 1].x, y: q[i].y })
    }
    out.push(q[i + 1])
  }
  const newTaps = taps.map((t) => (moving.has(pointKey(t)) ? shift(t) : clonePoint(t)))
  // the shifted end may bring the wire back over itself: cut such loops out, then drop corners that no longer turn
  const via = tidy([q[0], ...unfold(q[0], tidy(out, newTaps), q[last]), q[last]], newTaps)
  // a tap that no longer sits on a corner (it landed on an end or was folded away) has nothing left to hold
  return { a: q[0], b: q[last], via, taps: newTaps.filter((t) => via.some((v) => same(v, t))) }
}

/** Put everything in `plan` where it belongs when the dragged part has moved by (dx, dy) from where it started. */
export function applyFollow(world: World, plan: FollowPlan, dx: number, dy: number): void {
  for (const p of plan.carried) {
    const s = plan.parts.get(p.id)
    if (!s) continue
    p.x = s.x + dx
    p.y = s.y + dy
    if (s.leads) p.leads = s.leads.map((l) => ({ x: l.x + dx, y: l.y + dy }))
  }
  for (const p of plan.partial) {
    const s = plan.parts.get(p.id)
    if (s?.leads) p.leads = s.leads.map((l) => (plan.moving.has(pointKey(l)) ? { x: l.x + dx, y: l.y + dy } : clonePoint(l)))
  }
  const moved: [Wire, Wire][] = []
  const wholeMoved: Wire[] = []
  for (const base of plan.wires) {
    const w = world.getWire(base.id)
    if (!w || plan.skip?.has(base.id)) continue
    if (plan.whole.has(base.id)) {
      const shift = (v: Vec): Vec => ({ x: v.x + dx, y: v.y + dy })
      w.a = shift(base.a)
      w.b = shift(base.b)
      w.via = base.via.map(shift)
      w.taps = base.taps && base.taps.length > 0 ? base.taps.map(shift) : undefined
      wholeMoved.push(base)
      continue
    }
    const next = followWire(base, plan.moving, dx, dy)
    w.a = next.a
    w.b = next.b
    w.via = next.via
    w.taps = next.taps && next.taps.length > 0 ? next.taps : undefined
    moved.push([base, w])
  }
  // a wire that moved bodily takes the branches resting on it along: their ends shift by the same step
  for (const base of wholeMoved) {
    for (const e of plan.branches?.get(base.id) ?? []) {
      if (plan.whole.has(e.wire) || plan.skip?.has(e.wire)) continue
      moveBranchEnd(world, e, { x: e.at.x + dx, y: e.at.y + dy })
    }
  }
  // branch wires follow the stretches of the wires they rest on (after every wire has its new shape, so none is overwritten)
  for (const [base, w] of moved) {
    const ends = plan.branches?.get(base.id)
    // branches that move as a whole themselves (or are held apart) already have their place
    const free = ends?.filter((e) => !plan.whole.has(e.wire) && !plan.skip?.has(e.wire))
    if (free && free.length > 0) carryBranches(world, free, [base.a, ...base.via, base.b], [w.a, ...w.via, w.b])
  }
}
