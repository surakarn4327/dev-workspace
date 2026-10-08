import { describe, expect, it } from 'vitest'
import { gateGeometry, GATE_PIN_UNITS } from './art.ts'
import type { GateShape } from './art.ts'

const SHAPES: GateShape[] = ['not', 'and', 'or', 'nand', 'nor', 'xor', 'xnor']

describe('gate symbols', () => {
  it.each(SHAPES)('%s body is centred horizontally in the disc', (shape) => {
    const { polys, circles } = gateGeometry(shape)
    const legs = shape === 'not' ? 2 : 3
    let lo = Infinity
    let hi = -Infinity
    for (const poly of polys.slice(0, polys.length - legs)) for (const [x] of poly) (lo = Math.min(lo, x)), (hi = Math.max(hi, x))
    for (const [x, , r] of circles) (lo = Math.min(lo, x - r)), (hi = Math.max(hi, x + r))
    expect((lo + hi) / 2).toBeCloseTo(0, 6)
  })

  it.each(SHAPES)('%s legs still end on the pins', (shape) => {
    const { polys } = gateGeometry(shape)
    const ends = polys.flatMap((p) => [p[0], p[p.length - 1]])
    expect(ends.some(([x, y]) => x === GATE_PIN_UNITS.inX && y !== undefined)).toBe(true)
    expect(ends.some(([x, y]) => x === GATE_PIN_UNITS.outX && y === 0)).toBe(true)
  })
})
