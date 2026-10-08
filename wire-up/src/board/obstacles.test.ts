import { describe, expect, it } from 'vitest'
import { ALL_PARTS, newPart, pinWorld } from '../parts/index.ts'
import { bodyRect, partObstacles, pathHitsRects, segmentHitsRect } from './obstacles.ts'
import { routeVia } from './router.ts'
import { G, World } from './world.ts'
import type { Rot, Vec } from './world.ts'

describe('segmentHitsRect', () => {
  const r = { x0: 0, y0: 0, x1: 100, y1: 40 }
  it('counts a stretch through the inside, not one along the edge or outside', () => {
    expect(segmentHitsRect({ x: -20, y: 20 }, { x: 120, y: 20 }, r)).toBe(true)
    expect(segmentHitsRect({ x: 50, y: -20 }, { x: 50, y: 60 }, r)).toBe(true)
    expect(segmentHitsRect({ x: -20, y: 0 }, { x: 120, y: 0 }, r)).toBe(false)
    expect(segmentHitsRect({ x: -20, y: 60 }, { x: 120, y: 60 }, r)).toBe(false)
    expect(segmentHitsRect({ x: 100, y: 20 }, { x: 160, y: 20 }, r)).toBe(false)
  })
})

describe('routing around parts', () => {
  it('goes around a part standing between the ends', () => {
    const w = new World()
    const r = newPart(w.nextId('p'), 'resistor', 100, 100)
    w.parts.push(r)
    const rects = partObstacles(w)
    const a = { x: 20, y: 100 }
    const b = { x: 240, y: 100 }
    const via = routeVia(a, b, [], rects)
    expect(via.length).toBeGreaterThan(0)
    expect(pathHitsRects([a, ...via, b], rects)).toBe(false)
    // and the straight line really would have gone through it
    expect(pathHitsRects([a, b], rects)).toBe(true)
  })

  it('every pin of every part can be wired out in all four directions without cutting its own part', () => {
    for (const def of ALL_PARTS) {
      if (def.type.startsWith('breadboard')) continue
      for (const rot of [0, 1, 2, 3] as Rot[]) {
        const w = new World()
        const p = newPart(w.nextId('p'), def.type, 400, 400)
        p.rot = rot
        w.parts.push(p)
        const rects = partObstacles(w)
        for (const pin of pinWorld(p)) {
          for (const d of [[10, 0], [-10, 0], [0, 10], [0, -10]]) {
            const target: Vec = { x: pin.x + d[0] * G, y: pin.y + d[1] * G }
            if (rects.some((r) => target.x > r.x0 && target.x < r.x1 && target.y > r.y0 && target.y < r.y1)) continue // a target inside a big part cannot be reached
            const via = routeVia(pin, target, [], rects)
            expect(pathHitsRects([pin, ...via, target], rects), `${def.type} rot ${rot} pin ${pin.x},${pin.y} to ${d}`).toBe(false)
          }
        }
      }
    }
  })

  it('the body rectangle never swallows one of its own pins', () => {
    for (const def of ALL_PARTS) {
      if (def.type.startsWith('breadboard')) continue
      const p = newPart('x', def.type, 0, 0)
      const r = bodyRect(p)
      for (const pin of pinWorld(p)) expect(pin.x > r.x0 && pin.x < r.x1 && pin.y > r.y0 && pin.y < r.y1, `${def.type}`).toBe(false)
    }
  })
})
