import { describe, expect, it } from 'vitest'
import { moveBend, tidy } from './wireEdit.ts'
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
