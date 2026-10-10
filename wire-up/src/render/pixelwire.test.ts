import { describe, expect, it } from 'vitest'
import { PX } from './pixel.ts'
import { cableShape, junctionShape } from './pixelwire.ts'

/** Independent version of what a cable covers: the art pixels along the line (Bresenham) and the four next to each. */
function oracle(pts: { x: number; y: number }[]): Set<string> {
  const out = new Set<string>()
  const add = (x: number, y: number): void => {
    out.add(`${x},${y}`)
  }
  for (let i = 0; i + 1 < pts.length; i++) {
    let x = Math.round(pts[i].x / PX)
    let y = Math.round(pts[i].y / PX)
    const ex = Math.round(pts[i + 1].x / PX)
    const ey = Math.round(pts[i + 1].y / PX)
    const dx = Math.abs(ex - x)
    const dy = -Math.abs(ey - y)
    const sx = x < ex ? 1 : -1
    const sy = y < ey ? 1 : -1
    let err = dx + dy
    for (;;) {
      for (const [ax, ay] of [[x, y], [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) add(ax, ay)
      if (x === ex && y === ey) break
      const e2 = 2 * err
      if (e2 >= dy) {
        err += dy
        x += sx
      }
      if (e2 <= dx) {
        err += dx
        y += sy
      }
    }
  }
  return out
}

const cells = (shape: ReturnType<typeof cableShape>): Set<string> => new Set(shape.bodyCells.map(([x, y]) => `${x + shape.ox},${y + shape.oy}`))

describe('cable shapes', () => {
  const wires = [
    [{ x: 0, y: 0 }, { x: 0, y: 20 }],
    [{ x: 100, y: 40 }, { x: 100, y: 80 }, { x: 160, y: 80 }, { x: 160, y: 20 }],
    [{ x: -60, y: -20 }, { x: -20, y: -20 }, { x: -20, y: 60 }],
    [{ x: 3, y: 7 }, { x: 41, y: 7 }, { x: 41, y: 33 }], // off the 20 px grid
  ]

  it('cover exactly the art pixels the cable is made of, wherever they are put down', () => {
    for (const pts of wires) expect(cells(cableShape(pts))).toEqual(oracle(pts))
  })

  it('are the same shape, put down somewhere else, when the cable only moved', () => {
    for (const pts of wires) {
      const a = cableShape(pts)
      for (const [mx, my] of [[20, 0], [0, -40], [340, 220], [-1000, 60], [7, 3]]) {
        const moved = pts.map((p) => ({ x: p.x + mx, y: p.y + my }))
        const b = cableShape(moved)
        expect(cells(b)).toEqual(oracle(moved))
        if (mx % PX === 0 && my % PX === 0) {
          expect(Object.getPrototypeOf(b)).toBe(Object.getPrototypeOf(a)) // the very same saved shape, not a new one
          expect(b.ox - a.ox).toBe(mx / PX)
          expect(b.oy - a.oy).toBe(my / PX)
        }
      }
    }
  })

  it('put a junction dot down at the place given', () => {
    const a = junctionShape({ x: 100, y: 60 })
    const b = junctionShape({ x: 240, y: -20 })
    expect(Object.getPrototypeOf(a)).toBe(Object.getPrototypeOf(b))
    expect(new Set(a.bodyCells.map(([x, y]) => `${x + a.ox},${y + a.oy}`)).has(`${100 / PX},${60 / PX}`)).toBe(true)
    expect(a.bodyCells.length).toBe(21) // 5 x 5 without its four corners
  })
})
