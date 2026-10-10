// Parts a wire may not run through. Wires cross the breadboard freely (that is where they plug in), but never the body
// of a part: the router goes around them and reshaping a wire by hand refuses a shape that would cut through one.

import { defOf, pinWorld } from '../parts/index.ts'
import { rotVec } from './world.ts'
import type { PartInstance, Vec, World } from './world.ts'

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** The body of a part in world coordinates, trimmed so that none of its own pins lies strictly inside. */
export function bodyRect(p: PartInstance): Rect {
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
  const r: Rect = {
    x0: Math.min(...corners.map((c) => c.x)),
    y0: Math.min(...corners.map((c) => c.y)),
    x1: Math.max(...corners.map((c) => c.x)),
    y1: Math.max(...corners.map((c) => c.y)),
  }
  // a pin must be reachable: pull the nearest side back to a pin that sits inside the box
  for (const pin of pinWorld(p)) {
    if (pin.x <= r.x0 || pin.x >= r.x1 || pin.y <= r.y0 || pin.y >= r.y1) continue
    const d = [pin.x - r.x0, r.x1 - pin.x, pin.y - r.y0, r.y1 - pin.y]
    const side = d.indexOf(Math.min(...d))
    if (side === 0) r.x0 = pin.x
    else if (side === 1) r.x1 = pin.x
    else if (side === 2) r.y0 = pin.y
    else r.y1 = pin.y
  }
  return r
}

/** A pin a wire must leave or enter straight along (dx, dy): one unit step out of the part, in world space. */
export interface Lead extends Vec {
  dx: number
  dy: number
  /** How many grid units the wire must run straight out of the pin before it may bend (default 1). */
  len?: number
}

/** A direction in the part's own frame, and the straight run in grid units. */
interface LeadDir extends Vec {
  len?: number
}

/**
 * Which way wires must leave each kind of part, in the part's own frame (rotation applied on top). Add a category or
 * type here when the rule should cover it, and list it in CLAUDE.md:
 *   bench supply (type 'supply')    -> down
 *   batteries (types 'battery*')    -> up
 *   74HC chips (types 'ic-*')       -> out of the package: top row up, bottom row down
 *   relay module (type 'relay-module') -> screw terminals (NC/COM/NO) up, 3 grid straight; header pins down (the printed side), 2 grid straight
 *   switches (category 'switch')    -> out to the side (left leg left, right leg right), except the push button (type 'button'), which keeps free routing
 */
function leadDirs(p: PartInstance): LeadDir[] | null {
  const def = defOf(p.type)
  const up = { x: 0, y: -1 }
  const down = { x: 0, y: 1 }
  const left = { x: -1, y: 0 }
  const right = { x: 1, y: 0 }
  if (p.type === 'supply') return def.pins(p).map(() => down)
  if (p.type === 'relay-module') {
    // pins: the header (GND, IN1..INn, VCC) first, then three screw terminals per channel: total = (c + 2) + 3c
    const total = def.pins(p).length
    const header = (total - 2) / 4 + 2
    return def.pins(p).map((_, i) => (i < header ? { ...down, len: 2 } : { ...up, len: 3 }))
  }
  if (p.type.startsWith('battery')) return def.pins(p).map(() => up)
  if (p.type.startsWith('ic-') || p.type.startsWith('seg7')) return def.pins(p).map((v) => (v.y === 0 ? up : down))
  if (def.category === 'switch' && p.type !== 'button') {
    const pins = def.pins(p)
    const mid = pins.reduce((s, v) => s + v.x, 0) / pins.length
    return pins.map((v) => (v.x > mid ? right : left))
  }
  return null
}

/** Pins a wire must leave or enter straight along their direction (see `leadDirs`); follows the part's rotation. */
export function leadPins(world: World): Lead[] {
  const out: Lead[] = []
  for (const p of world.parts) {
    const dirs = leadDirs(p)
    if (!dirs) continue
    const pins = pinWorld(p)
    pins.forEach((v, i) => {
      const d = rotVec(dirs[i], p.rot)
      out.push({ x: v.x, y: v.y, dx: d.x, dy: d.y, len: dirs[i].len })
    })
  }
  return out
}

/**
 * The relay module is covered edge to edge: no wire may lie over any of it, not even the strip with the screw terminals or the
 * strip with the header. The only openings are the straight columns a wire takes out of its own pin (up from a terminal, down
 * from a header pin), so the board is cut into pieces that touch those columns (touching an edge does not count as a hit).
 */
function moduleRects(p: PartInstance): Rect[] {
  const b = defOf(p.type).bounds(p)
  const pins = defOf(p.type).pins(p).map((v) => ({ x: v.x * 20, y: v.y * 20 }))
  const top = Math.min(...pins.map((v) => v.y))
  const bottom = Math.max(...pins.map((v) => v.y))
  const xs = (y: number): number[] => [b.x, ...pins.filter((v) => v.y === y).map((v) => v.x), b.x + b.w].sort((m, n) => m - n)
  const local: Rect[] = [{ x0: b.x, y0: top, x1: b.x + b.w, y1: bottom }]
  const strip = (y: number, y0: number, y1: number): void => {
    const cuts = xs(y)
    for (let i = 0; i + 1 < cuts.length; i++) if (cuts[i + 1] > cuts[i]) local.push({ x0: cuts[i], y0, x1: cuts[i + 1], y1 })
  }
  strip(top, b.y, top)
  strip(bottom, bottom, b.y + b.h)
  return local.map((r) => {
    const corners = [
      { x: r.x0, y: r.y0 },
      { x: r.x1, y: r.y0 },
      { x: r.x0, y: r.y1 },
      { x: r.x1, y: r.y1 },
    ].map((c) => {
      const v = rotVec(c, p.rot)
      return { x: p.x + v.x, y: p.y + v.y }
    })
    return {
      x0: Math.min(...corners.map((c) => c.x)),
      y0: Math.min(...corners.map((c) => c.y)),
      x1: Math.max(...corners.map((c) => c.x)),
      y1: Math.max(...corners.map((c) => c.y)),
    }
  })
}

export function partObstacles(world: World): Rect[] {
  return world.parts.filter((p) => !p.type.startsWith('breadboard')).flatMap((p) => (p.type === 'relay-module' ? moduleRects(p) : [bodyRect(p)]))
}

/** Does the straight stretch a -> b pass through the inside of the rectangle? Touching the edge does not count. */
export function segmentHitsRect(a: Vec, b: Vec, r: Rect): boolean {
  const minX = Math.min(a.x, b.x)
  const maxX = Math.max(a.x, b.x)
  const minY = Math.min(a.y, b.y)
  const maxY = Math.max(a.y, b.y)
  if (a.y === b.y) return a.y > r.y0 && a.y < r.y1 && Math.min(maxX, r.x1) > Math.max(minX, r.x0)
  if (a.x === b.x) return a.x > r.x0 && a.x < r.x1 && Math.min(maxY, r.y1) > Math.max(minY, r.y0)
  return maxX > r.x0 && minX < r.x1 && maxY > r.y0 && minY < r.y1 // legacy diagonal: bounding box is close enough
}

/** Does any stretch of the path run through one of the rectangles? */
export function pathHitsRects(path: Vec[], rects: Rect[]): boolean {
  for (let i = 0; i + 1 < path.length; i++) for (const r of rects) if (segmentHitsRect(path[i], path[i + 1], r)) return true
  return false
}

export function pathHitsParts(world: World, path: Vec[]): boolean {
  return pathHitsRects(path, partObstacles(world))
}

/** Is the point strictly inside one of the rectangles? */
export function insideRects(p: Vec, rects: Rect[]): boolean {
  return rects.some((r) => p.x > r.x0 && p.x < r.x1 && p.y > r.y0 && p.y < r.y1)
}
