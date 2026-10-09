// Manual wire shaping: drag one corner and the wire keeps its right angles.

import { G, snap } from './world.ts'
import type { Vec } from './world.ts'

function same(a: Vec, b: Vec): boolean {
  return a.x === b.x && a.y === b.y
}

/** Is `p` on the straight horizontal or vertical segment from `a` to `b` (ends included)? */
function onSegment(p: Vec, a: Vec, b: Vec): boolean {
  if (a.x === b.x) return p.x === a.x && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y)
  if (a.y === b.y) return p.y === a.y && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x)
  return false
}

function collinear(a: Vec, b: Vec, c: Vec): boolean {
  return (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)
}

/**
 * New bend points after dragging bend `index` of a wire a -> via -> b to `pos`.
 * The dragged point stays a real corner (one segment vertical, the other horizontal) and every
 * segment stays horizontal or vertical; extra corners are added next to it where needed.
 */
export function moveBend(a: Vec, via: Vec[], b: Vec, index: number, pos: Vec, keep: Vec[] = []): Vec[] {
  const pts = [a, ...via, b]
  const i = index + 1
  const prev = pts[i - 1]
  const old = pts[i]

  // which way the segment arrives at pos: straight from an aligned neighbour, else by the old direction of that segment
  let primary: boolean
  if (prev.x === pos.x && prev.y !== pos.y) primary = true
  else if (prev.y === pos.y && prev.x !== pos.x) primary = false
  else primary = prev.y === old.y

  // Arrive at pos with the primary direction, else the other; each candidate has its loops cut out and must still have a
  // corner where it was dropped. A fold that only crosses the old place of a neighbouring corner is cut out and the corner
  // stays where it was dropped: that is what lets a corner be pulled back along its own wire (shrinking it).
  const settle = (t: Vec[]): Vec[] | null => {
    const v = tidy([a, ...unfold(a, t.slice(1, -1), b), b], keep)
    return v.some((p) => same(p, pos)) ? v : null
  }
  const direct = settle(bendPath(pts, i, pos, primary)) ?? settle(bendPath(pts, i, pos, !primary))
  if (direct) return direct
  // otherwise the wire may simply straighten, dropping the detour corner next to this one that it grew earlier: the
  // simplest of those shapes (so a corner dragged away and then back gives the original wire again)
  const without: Vec[][] = []
  if (i >= 2) without.push([...pts.slice(0, i - 1), ...pts.slice(i)])
  if (i + 2 < pts.length) without.push([...pts.slice(0, i + 1), ...pts.slice(i + 2)])
  let best: Vec[] | null = null
  for (const w of without) {
    const at = w.findIndex((p) => same(p, old))
    for (const arrives of [primary, !primary]) {
      const v = settle(bendPath(w, at, pos, arrives))
      if (v && (best === null || v.length < best.length)) best = v
    }
  }
  if (best) return best
  // the drop lands on a straight part of the wire (or on an end): the corner just melts into it
  const first = bendPath(pts, i, pos, primary)
  const out = foldCount(first) === 0 ? first : bendPath(pts, i, pos, !primary)
  return tidy([a, ...unfold(a, (foldCount(out) > foldCount(first) ? first : out).slice(1, -1), b), b], keep)
}

/** The path with corner `i` put at `pos`, arriving vertically or horizontally; the leaving segment is perpendicular. */
function bendPath(pts: Vec[], i: number, pos: Vec, arrivesVertical: boolean): Vec[] {
  const prev = pts[i - 1]
  const next = pts[i + 1]
  const out: Vec[] = pts.slice(0, i)
  if (arrivesVertical) {
    if (prev.x !== pos.x) out.push({ x: pos.x, y: prev.y })
  } else if (prev.y !== pos.y) out.push({ x: prev.x, y: pos.y })
  out.push({ x: pos.x, y: pos.y })
  if (arrivesVertical) {
    if (next.y !== pos.y) out.push({ x: next.x, y: pos.y })
  } else if (next.x !== pos.x) {
    out.push({ x: pos.x, y: next.y })
  }
  out.push(...pts.slice(i + 1))
  return out
}

/** How many places a path turns straight back on itself (three points on one line with the middle one outside the others). */
function foldCount(path: Vec[]): number {
  const pts = path.filter((p, k) => k === 0 || !same(p, path[k - 1]))
  let n = 0
  for (let k = 1; k + 1 < pts.length; k++) {
    const p = pts[k - 1]
    const q = pts[k]
    const r = pts[k + 1]
    if (p.x === q.x && q.x === r.x && (q.y - p.y) * (r.y - q.y) < 0) n++
    else if (p.y === q.y && q.y === r.y && (q.x - p.x) * (r.x - q.x) < 0) n++
  }
  return n
}

/** Interior bend points of a path with duplicates and straight-through points removed. */
export function tidy(path: Vec[], keep: Vec[] = []): Vec[] {
  let pts = path.filter((p, k) => k === 0 || !same(p, path[k - 1]))
  let changed = true
  while (changed) {
    changed = false
    for (let k = 1; k + 1 < pts.length; k++) {
      if (collinear(pts[k - 1], pts[k], pts[k + 1]) && !keep.some((t) => same(t, pts[k]))) {
        pts = [...pts.slice(0, k), ...pts.slice(k + 1)]
        changed = true
        break
      }
    }
  }
  return pts.slice(1, -1).map((p) => ({ x: p.x, y: p.y }))
}

/** Grid point in the middle of a wire that has no bends, where the "bend it" handle sits (null if too short). */
export function straightMid(a: Vec, b: Vec): Vec | null {
  if (Math.hypot(a.x - b.x, a.y - b.y) < 2 * G) return null
  const m = { x: snap((a.x + b.x) / 2), y: snap((a.y + b.y) / 2) }
  if (same(m, a) || same(m, b)) return null
  return m
}

export interface WireShape {
  a: Vec
  b: Vec
  via: Vec[]
  taps: Vec[]
}

/** Corner (0 or 1 point) joining `pivot` to `x` with right angles; it carries on straight out of the previous segment. */
export function cornerBetween(prev: Vec | undefined, pivot: Vec, x: Vec): Vec[] {
  if (same(pivot, x)) return []
  let verticalFirst: boolean
  if (prev && prev.x === pivot.x && prev.y !== pivot.y) verticalFirst = true
  else if (prev && prev.y === pivot.y && prev.x !== pivot.x) verticalFirst = false
  else verticalFirst = Math.abs(x.y - pivot.y) >= Math.abs(x.x - pivot.x)
  const corner = verticalFirst ? { x: pivot.x, y: x.y } : { x: x.x, y: pivot.y }
  return same(corner, pivot) || same(corner, x) ? [] : [corner]
}

/**
 * The wire after dragging its end `end` to `to`, starting from the shape it had when the drag began.
 * The old end stays where it is and becomes a corner; the wire grows out from it to `to`, and everything before it is
 * left exactly as it was. `plugOld`: the old end is plugged into something, so that corner is also a tap that keeps
 * its hold. (A free end is treated the same way, just without the hold.)
 */
function dragEndRaw(base: WireShape, end: 'a' | 'b', to: Vec, plugOld: boolean): WireShape {
  if (end === 'a') {
    const flipped = dragEndRaw({ a: base.b, b: base.a, via: [...base.via].reverse(), taps: base.taps }, 'b', to, plugOld)
    return { a: flipped.b, b: flipped.a, via: [...flipped.via].reverse(), taps: flipped.taps }
  }
  // dragged back along the wire itself: the wire shortens instead of doubling over (a plugged end comes unplugged)
  const pts = [base.a, ...base.via, base.b]
  for (let j = pts.length - 2; j >= 0; j--) {
    if (!onSegment(to, pts[j], pts[j + 1])) continue
    if (same(to, base.b) || same(to, base.a)) return base // never shrink a wire to nothing
    const keep = same(to, pts[j]) ? pts.slice(1, j) : pts.slice(1, j + 1)
    return { a: base.a, b: to, via: keep, taps: base.taps.filter((t) => keep.some((v) => same(v, t))) }
  }
  // dragged along the line of the last stretch but past its far end: that stretch is pulled in completely and the wire
  // carries on from where it began, instead of doubling back over itself
  const lastPt = pts[pts.length - 2]
  const endPt = pts[pts.length - 1]
  const onLine = (lastPt.x === endPt.x && lastPt.y !== endPt.y && to.x === endPt.x) || (lastPt.y === endPt.y && lastPt.x !== endPt.x && to.y === endPt.y)
  if (onLine) {
    const vertical = lastPt.x === endPt.x
    const toward = Math.sign(vertical ? lastPt.y - endPt.y : lastPt.x - endPt.x)
    const reach = (vertical ? to.y - endPt.y : to.x - endPt.x) * toward
    const stretch = vertical ? Math.abs(lastPt.y - endPt.y) : Math.abs(lastPt.x - endPt.x)
    if (reach > stretch) return { a: base.a, b: to, via: base.via.map((v) => ({ ...v })), taps: base.taps.filter((t) => base.via.some((v) => same(v, t))) }
  }
  const full = [base.a, ...base.via]
  const pivot = base.b
  const prev = full[full.length - 1]
  const corner = cornerBetween(prev, pivot, to)
  // the new leg would head back along the old last stretch (turning off part-way along it, or past its start):
  // the wire would double back over itself, so that stretch is shortened or pulled in and the leg starts there
  if (corner.length === 1 && !same(corner[0], pivot)) {
    const vertical = prev.x === pivot.x && prev.y !== pivot.y
    const horizontal = prev.y === pivot.y && prev.x !== pivot.x
    const into = vertical ? Math.sign(pivot.y - prev.y) : horizontal ? Math.sign(pivot.x - prev.x) : 0
    const out = vertical ? Math.sign(corner[0].y - pivot.y) : horizontal ? Math.sign(corner[0].x - pivot.x) : 0
    if (into * out < 0) {
      const keep = [...base.via, corner[0]]
      return { a: base.a, b: to, via: keep, taps: base.taps.filter((t) => keep.some((v) => same(v, t))) }
    }
  }
  const taps = plugOld ? [...base.taps, base.b] : base.taps
  return { a: base.a, b: to, via: [...base.via, base.b, ...corner], taps }
}

/**
 * Corners of the path a -> via -> b once every place where it runs over itself is cut out: a turn straight back
 * (p -> q -> r on one line with q outside them becomes p -> r), and two stretches lying along the same line over some length
 * (the whole loop between them becomes one straight stretch from where the first begins to where the second ends).
 * The ends a and b are never removed.
 */
export function unfold(a: Vec, via: Vec[], b: Vec): Vec[] {
  const dedupe = (path: Vec[]): Vec[] => {
    const out: Vec[] = [path[0]]
    for (let k = 1; k < path.length; k++) {
      if (same(path[k], out[out.length - 1])) {
        if (k === path.length - 1 && out.length > 1) out.pop() // the end sits on the corner before it: the end stays
        else continue
      }
      out.push(path[k])
    }
    return out
  }
  let pts = dedupe([a, ...via, b])
  let changed = true
  while (changed) {
    changed = false
    for (let k = 1; k + 1 < pts.length; k++) {
      const p = pts[k - 1]
      const q = pts[k]
      const r = pts[k + 1]
      const backV = p.x === q.x && q.x === r.x && (q.y - p.y) * (r.y - q.y) < 0
      const backH = p.y === q.y && q.y === r.y && (q.x - p.x) * (r.x - q.x) < 0
      if (backV || backH) {
        pts = dedupe([...pts.slice(0, k), ...pts.slice(k + 1)])
        changed = true
        break
      }
    }
    if (changed) continue
    // two stretches on one line that overlap: p_i .. p_(j+1) both lie on that line, so the loop between them is one stretch
    for (let i = 0; i + 1 < pts.length && !changed; i++) {
      for (let j = i + 2; j + 1 < pts.length; j++) {
        const [p, q] = [pts[i], pts[i + 1]]
        const [r, s] = [pts[j], pts[j + 1]]
        const v = p.x === q.x && r.x === s.x && p.x === r.x && Math.min(Math.max(p.y, q.y), Math.max(r.y, s.y)) > Math.max(Math.min(p.y, q.y), Math.min(r.y, s.y))
        const h = p.y === q.y && r.y === s.y && p.y === r.y && Math.min(Math.max(p.x, q.x), Math.max(r.x, s.x)) > Math.max(Math.min(p.x, q.x), Math.min(r.x, s.x))
        if (v || h) {
          pts = dedupe([...pts.slice(0, i + 1), ...pts.slice(j + 1)])
          changed = true
          break
        }
      }
    }
  }
  return pts.slice(1, -1).map((p) => ({ x: p.x, y: p.y }))
}

function finish(shape: WireShape): WireShape {
  const via = unfold(shape.a, shape.via, shape.b)
  return { a: shape.a, b: shape.b, via, taps: shape.taps.filter((t) => via.some((v) => same(v, t))) }
}

/** The wire after dragging its end `end` to `to` (see `dragEndRaw`), with any place where it doubles back cut out. */
export function dragEnd(base: WireShape, end: 'a' | 'b', to: Vec, plugOld: boolean): WireShape {
  return finish(dragEndRaw(base, end, to, plugOld))
}

/** Do two stretches of the path a -> via -> b lie along the same line over some length (the wire running over itself)? */
export function wireOverlaps(a: Vec, via: Vec[], b: Vec): boolean {
  const pts = [a, ...via, b]
  const segs: [Vec, Vec][] = []
  for (let i = 0; i + 1 < pts.length; i++) if (!same(pts[i], pts[i + 1])) segs.push([pts[i], pts[i + 1]])
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const [p, q] = segs[i]
      const [r, s] = segs[j]
      if (p.x === q.x && r.x === s.x && p.x === r.x) {
        if (Math.min(Math.max(p.y, q.y), Math.max(r.y, s.y)) > Math.max(Math.min(p.y, q.y), Math.min(r.y, s.y))) return true
      } else if (p.y === q.y && r.y === s.y && p.y === r.y) {
        if (Math.min(Math.max(p.x, q.x), Math.max(r.x, s.x)) > Math.max(Math.min(p.x, q.x), Math.min(r.x, s.x))) return true
      }
    }
  }
  return false
}

/**
 * What a corner drag changed, kept so that the next drag of the same corner can undo it exactly: dragging a corner away
 * can straighten the wire (dropping corners it no longer needs) and the wire alone cannot know it ever had them.
 */
export interface BendMemo {
  /** The corners before the drag and after it. */
  before: Vec[]
  after: Vec[]
  /** Where the dragged corner was before the drag, and where it was dropped. */
  oldCorner: Vec
  dropped: Vec
}

function sameVia(a: Vec[], b: Vec[]): boolean {
  return a.length === b.length && a.every((p, k) => same(p, b[k]))
}

/** Remember a finished corner drag (null if it changed nothing). */
export function rememberBend(before: Vec[], after: Vec[], index: number, dropped: Vec): BendMemo | null {
  if (sameVia(before, after) || !before[index]) return null
  return { before: before.map((p) => ({ ...p })), after: after.map((p) => ({ ...p })), oldCorner: { ...before[index] }, dropped: { ...dropped } }
}

/** The memo, if the corner now being dragged is the one it was about and the wire is still as that drag left it. */
export function usableMemo(memo: BendMemo | undefined, via: Vec[], index: number): BendMemo | null {
  if (!memo || !sameVia(memo.after, via) || !via[index] || !same(via[index], memo.dropped)) return null
  return memo
}

/** The corners from before the remembered drag when the corner is brought back to where it started, else null. */
export function undoBend(memo: BendMemo | null, pos: Vec): Vec[] | null {
  return memo && same(pos, memo.oldCorner) ? memo.before.map((p) => ({ ...p })) : null
}
