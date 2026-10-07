// Manual wire shaping: drag one corner and the wire keeps its right angles.

import type { Vec } from './world.ts'

function same(a: Vec, b: Vec): boolean {
  return a.x === b.x && a.y === b.y
}

function collinear(a: Vec, b: Vec, c: Vec): boolean {
  return (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)
}

/**
 * New bend points after dragging bend `index` of a wire a -> via -> b to `pos`.
 * The dragged point stays a real corner (one segment vertical, the other horizontal) and every
 * segment stays horizontal or vertical; extra corners are added next to it where needed.
 */
export function moveBend(a: Vec, via: Vec[], b: Vec, index: number, pos: Vec): Vec[] {
  const pts = [a, ...via, b]
  const i = index + 1
  const prev = pts[i - 1]
  const next = pts[i + 1]
  const old = pts[i]
  const out: Vec[] = pts.slice(0, i)

  // segment arriving at pos
  let arrivesVertical: boolean
  if (prev.x === pos.x && prev.y !== pos.y) arrivesVertical = true
  else if (prev.y === pos.y && prev.x !== pos.x) arrivesVertical = false
  else {
    // not aligned: the old direction of that segment decides which way it leaves the previous point
    const wasHorizontal = prev.y === old.y
    arrivesVertical = wasHorizontal
    out.push(wasHorizontal ? { x: pos.x, y: prev.y } : { x: prev.x, y: pos.y })
  }
  out.push({ x: pos.x, y: pos.y })

  // segment leaving pos is perpendicular to the one arriving
  if (arrivesVertical) {
    if (next.y !== pos.y) out.push({ x: next.x, y: pos.y })
  } else if (next.x !== pos.x) {
    out.push({ x: pos.x, y: next.y })
  }
  out.push(...pts.slice(i + 1))
  return tidy(out)
}

/** Interior bend points of a path with duplicates and straight-through points removed. */
export function tidy(path: Vec[]): Vec[] {
  let pts = path.filter((p, k) => k === 0 || !same(p, path[k - 1]))
  let changed = true
  while (changed) {
    changed = false
    for (let k = 1; k + 1 < pts.length; k++) {
      if (collinear(pts[k - 1], pts[k], pts[k + 1])) {
        pts = [...pts.slice(0, k), ...pts.slice(k + 1)]
        changed = true
        break
      }
    }
  }
  return pts.slice(1, -1).map((p) => ({ x: p.x, y: p.y }))
}
