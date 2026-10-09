import { describe, expect, it } from 'vitest'
import { moveBend, rememberBend, tidy, undoBend, usableMemo } from './wireEdit.ts'
import type { Vec } from './world.ts'

function orthogonal(path: Vec[]): boolean {
  for (let i = 0; i + 1 < path.length; i++) if (path[i].x !== path[i + 1].x && path[i].y !== path[i + 1].y) return false
  return true
}

describe('moveBend', () => {
  const a = { x: 0, y: 0 }
  const b = { x: 200, y: 100 }

  it('keeps right angles for an L-shaped wire', () => {
    const via = [{ x: 200, y: 0 }]
    const out = moveBend(a, via, b, 0, { x: 120, y: 60 })
    expect(orthogonal([a, ...out, b])).toBe(true)
    expect(out.some((p) => p.x === 120 && p.y === 60)).toBe(true)
  })

  it('keeps right angles for a Z-shaped wire and keeps the ends', () => {
    const via = [
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]
    const out = moveBend(a, via, b, 1, { x: 160, y: 140 })
    expect(orthogonal([a, ...out, b])).toBe(true)
    expect(out.length).toBeGreaterThan(0)
  })

  it('keeps the dragged point as a real corner', () => {
    const via = [{ x: 200, y: 0 }]
    const out = moveBend(a, via, b, 0, { x: 0, y: 100 })
    expect(out).toEqual([{ x: 0, y: 100 }])
  })
})

describe('tidy', () => {
  it('drops duplicate and straight-through points', () => {
    const out = tidy([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
    ])
    expect(out).toEqual([{ x: 40, y: 0 }])
  })
})

describe('pulling a corner back along its own wire', () => {
  // battery + (a) -> up to the bottom edge -> left -> up the long left side -> right along the top -> down into VCC (b)
  const a = { x: 260, y: 200 }
  const via = [
    { x: 260, y: 180 },
    { x: 0, y: 180 },
    { x: 0, y: 0 },
    { x: 140, y: 0 },
  ]
  const b = { x: 140, y: 20 }

  it('lets the long side be dragged to the right again, shrinking the wire', () => {
    for (const x of [20, 60, 100]) {
      const out = moveBend(a, via, b, 1, { x, y: 180 })
      expect(out).toEqual([
        { x: 260, y: 180 },
        { x, y: 180 },
        { x, y: 0 },
        { x: 140, y: 0 },
      ])
    }
  })

  it('and still lets it be dragged out to the left', () => {
    const out = moveBend(a, via, b, 1, { x: -60, y: 180 })
    expect(out).toEqual([
      { x: 260, y: 180 },
      { x: -60, y: 180 },
      { x: -60, y: 0 },
      { x: 140, y: 0 },
    ])
  })

  it('dragging past the far end still keeps a clean path', () => {
    const out = moveBend(a, via, b, 1, { x: 200, y: 180 })
    expect(orthogonalPath([a, ...out, b])).toBe(true)
  })
})

function orthogonalPath(pts: Vec[]): boolean {
  return pts.every((p, k) => k === 0 || p.x === pts[k - 1].x || p.y === pts[k - 1].y)
}

describe('dragging a corner back after letting go', () => {
  const a = { x: -100, y: 0 }
  const via = [
    { x: -100, y: 140 },
    { x: -200, y: 140 },
    { x: -200, y: 0 },
    { x: -140, y: 0 },
  ]
  const b = { x: -140, y: -60 }

  it('gives the wire back exactly as it was, even though the first drag straightened it', () => {
    const away = moveBend(a, via, b, 1, { x: -140, y: 140 }, [])
    expect(away.length).toBeLessThan(via.length) // the first drag dropped corners
    const memo = rememberBend(via, away, 1, { x: -140, y: 140 })
    const again = usableMemo(memo ?? undefined, away, away.findIndex((p) => p.x === -140 && p.y === 140))
    expect(again).not.toBeNull()
    expect(undoBend(again, { x: -200, y: 140 })).toEqual(via)
    expect(undoBend(again, { x: -180, y: 140 })).toBeNull() // anywhere else it is an ordinary drag
  })

  it('is forgotten once the wire is changed some other way, or another corner is picked', () => {
    const away = moveBend(a, via, b, 1, { x: -140, y: 140 }, [])
    const memo = rememberBend(via, away, 1, { x: -140, y: 140 }) ?? undefined
    expect(usableMemo(memo, [...away, { x: 0, y: 0 }], 0)).toBeNull()
    expect(usableMemo(memo, away, 0)).toBeNull()
    expect(rememberBend(via, via, 1, { x: -200, y: 140 })).toBeNull()
  })
})
