// Wires that cut through the body of a part (a part dropped on a wire, an old file) are sent round it again.

import { downPins, partObstacles, pathHitsRects } from './obstacles.ts'
import { routeVia } from './router.ts'
import { socketKeys, tapTarget } from './wireJoin.ts'
import { wirePath } from './world.ts'
import type { Vec, World } from './world.ts'

/**
 * Re-route every wire that runs through a part. Wires with plugged corners (`taps`) and wires other wires branch off are
 * left alone, because moving them would cut those joints. Returns how many wires changed.
 */
/** Does an end of this wire sit on a down pin (a supply post) without coming in straight from below? */
function leavesSideways(pts: Vec[], downs: Vec[]): boolean {
  const ends: [Vec, Vec][] = [[pts[0], pts[1]], [pts[pts.length - 1], pts[pts.length - 2]]]
  return ends.some(([e, next]) => downs.some((d) => d.x === e.x && d.y === e.y) && !(next.x === e.x && next.y > e.y))
}

export function untangle(world: World): number {
  const rects = partObstacles(world)
  if (rects.length === 0) return 0
  const downs = downPins(world)
  const sockets = socketKeys(world)
  const carrying = new Set<string>()
  for (const w of world.wires) {
    for (const end of [w.a, w.b]) {
      const main = tapTarget(world, w, end, sockets)
      if (main) carrying.add(main.id)
    }
  }
  let changed = 0
  for (const w of world.wires) {
    if ((w.taps?.length ?? 0) > 0 || carrying.has(w.id)) continue
    const path = wirePath(w)
    if (!pathHitsRects(path, rects) && !leavesSideways(path, downs)) continue
    const via = routeVia(w.a, w.b, world.wires.filter((x) => x !== w), rects, downs)
    if (pathHitsRects([w.a, ...via, w.b], rects)) continue // no way round: leave it
    w.via = via
    changed++
  }
  return changed
}
