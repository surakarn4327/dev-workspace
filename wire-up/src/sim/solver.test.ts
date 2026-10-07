import { describe, expect, it } from 'vitest'
import { BJT, ledIs, LED_COLORS, LED_N, LED_RS } from './models.ts'
import { solve } from './solver.ts'
import type { Circuit } from './solver.ts'

const near = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol)

describe('linear circuits', () => {
  it('resistor divider gives 3 V from 9 V', () => {
    const c: Circuit = {
      nodeCount: 3,
      elements: [
        { kind: 'V', id: 'v', a: 1, b: 0, v: 9 },
        { kind: 'R', id: 'r1', a: 1, b: 2, r: 10000 },
        { kind: 'R', id: 'r2', a: 2, b: 0, r: 5000 },
      ],
    }
    const r = solve(c)
    expect(r.converged).toBe(true)
    near(r.v[2], 3, 1e-6)
    near(r.cur.get('r1')!.i, 9 / 15000, 1e-9)
    // source current flows out of + (negative a->b)
    near(r.cur.get('v')!.i, -9 / 15000, 1e-9)
  })

  it('battery internal resistance sags under load', () => {
    const c: Circuit = {
      nodeCount: 2,
      elements: [
        { kind: 'B', id: 'b', a: 1, b: 0, v: 9, r: 1.5 },
        { kind: 'R', id: 'r', a: 1, b: 0, r: 13.5 },
      ],
    }
    const r = solve(c)
    near(r.v[1], 8.1, 1e-6)
    near(r.cur.get('b')!.i, -0.6, 1e-6)
  })

  it('constant-current limit clamps a bench supply', () => {
    const c: Circuit = {
      nodeCount: 2,
      elements: [
        { kind: 'V', id: 'v', a: 1, b: 0, v: 12, iLimit: 0.1 },
        { kind: 'R', id: 'r', a: 1, b: 0, r: 10 },
      ],
    }
    const r = solve(c)
    expect(r.ccIds.has('v')).toBe(true)
    near(r.v[1], 1, 1e-6)
    near(r.cur.get('r')!.i, 0.1, 1e-9)
  })

  it('floating nodes do not break the solve', () => {
    const r = solve({ nodeCount: 4, elements: [{ kind: 'R', id: 'r', a: 1, b: 2, r: 100 }] })
    expect(r.converged).toBe(true)
    expect(Number.isFinite(r.v[3])).toBe(true)
  })
})

describe('semiconductors', () => {
  const red = LED_COLORS.red
  const ledCircuit = (rOhm: number, vs: number): Circuit => ({
    nodeCount: 5,
    elements: [
      { kind: 'V', id: 'v', a: 1, b: 0, v: vs },
      { kind: 'R', id: 'r', a: 1, b: 2, r: rOhm },
      { kind: 'R', id: 'rs', a: 2, b: 3, r: LED_RS },
      { kind: 'D', id: 'd', a: 3, b: 0, is: ledIs(red.vf10), n: LED_N },
    ],
  })

  it('red LED on 9 V with 470 ohm draws about 15 mA', () => {
    const r = solve(ledCircuit(470, 9))
    expect(r.converged).toBe(true)
    const i = r.cur.get('d')!.i
    near(i, 0.0148, 0.0008)
    near(r.v[3], 1.93, 0.08)
  })

  it('red LED forward drop is its datasheet value at 10 mA', () => {
    const r = solve(ledCircuit(710, 9))
    near(r.cur.get('d')!.i, 0.01, 0.0006)
  })

  it('LED straight on 9 V converges and draws far above its rating', () => {
    const r = solve(ledCircuit(0.001, 9))
    expect(r.converged).toBe(true)
    expect(r.cur.get('d')!.i).toBeGreaterThan(0.5)
  })

  it('a reversed diode blocks', () => {
    const r = solve({
      nodeCount: 3,
      elements: [
        { kind: 'V', id: 'v', a: 1, b: 0, v: 9 },
        { kind: 'D', id: 'd', a: 0, b: 2, is: 1e-8, n: 1.8 },
        { kind: 'R', id: 'r', a: 2, b: 1, r: 1000 },
      ],
    })
    expect(Math.abs(r.cur.get('r')!.i)).toBeLessThan(1e-7)
  })

  const npn = (rb: number, rc: number): Circuit => ({
    nodeCount: 4,
    elements: [
      { kind: 'V', id: 'v', a: 1, b: 0, v: 9 },
      { kind: 'R', id: 'rb', a: 1, b: 2, r: rb },
      { kind: 'R', id: 'rc', a: 1, b: 3, r: rc },
      { kind: 'Q', id: 'q', c: 3, b: 2, e: 0, pol: 1, is: BJT.is, bf: BJT.bf, br: BJT.br },
    ],
  })

  it('NPN in the active region: Ic = hFE x Ib', () => {
    const r = solve(npn(1e6, 1000))
    expect(r.converged).toBe(true)
    const q = r.cur.get('q')!
    near(q.ib!, (9 - 0.65) / 1e6, 1.5e-6)
    near(q.i / q.ib!, BJT.bf, 8)
  })

  it('NPN saturates when the collector resistor limits the current', () => {
    const r = solve(npn(10000, 470))
    const q = r.cur.get('q')!
    expect(r.v[3]).toBeLessThan(0.3)
    near(q.i, 9 / 470, 0.003)
  })

  it('PNP high-side switch conducts when the base is pulled low', () => {
    const r = solve({
      nodeCount: 4,
      elements: [
        { kind: 'V', id: 'v', a: 1, b: 0, v: 9 },
        { kind: 'R', id: 'rb', a: 2, b: 0, r: 10000 },
        { kind: 'R', id: 'rc', a: 3, b: 0, r: 470 },
        { kind: 'Q', id: 'q', c: 3, b: 2, e: 1, pol: -1, is: BJT.is, bf: BJT.bf, br: BJT.br },
      ],
    })
    expect(r.converged).toBe(true)
    expect(r.v[3]).toBeGreaterThan(8)
  })
})
