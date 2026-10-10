// A meter probe only touches. A tip that rests on a pin, a breadboard hole or a wire is held there; a tip that touches nothing
// is "loose" and goes along when its meter moves.

import { holeNear } from '../parts/breadboard.ts'
import { defOf, pinWorld } from '../parts/index.ts'
import { wirePath } from './world.ts'
import type { PartInstance, Vec, World } from './world.ts'

function onSegment(p: Vec, a: Vec, b: Vec): boolean {
  if (p.x < Math.min(a.x, b.x) || p.x > Math.max(a.x, b.x) || p.y < Math.min(a.y, b.y) || p.y > Math.max(a.y, b.y)) return false
  return (b.x - a.x) * (p.y - a.y) === (b.y - a.y) * (p.x - a.x)
}

/** Does a probe tip at `p` rest on a pin, a hole, or a wire (an end, a corner, or anywhere along it)? */
export function tipTouches(world: World, p: Vec): boolean {
  for (const part of world.parts) {
    if (part.type.startsWith('breadboard')) {
      if (holeNear(part, p, 1)) return true
    } else if (!defOf(part.type).freeLeads && pinWorld(part).some((q) => q.x === p.x && q.y === p.y)) return true
  }
  return world.wires.some((w) => {
    const path = wirePath(w)
    return path.some((q, i) => (i + 1 < path.length ? onSegment(p, q, path[i + 1]) : q.x === p.x && q.y === p.y))
  })
}

/** For each lead of a probe-style part: true when the tip touches nothing, so it travels with the part. */
export function looseLeads(world: World, part: PartInstance): boolean[] {
  return (part.leads ?? []).map((tip) => !tipTouches(world, tip))
}
