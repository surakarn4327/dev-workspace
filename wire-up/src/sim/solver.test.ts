import { describe, expect, it } from 'vitest'
import { BJT, eiaCode, ledIs, LED_COLORS, LED_N, LED_RS } from './models.ts'
import { advance, solve, transientStep } from './solver.ts'
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

describe('logic gates', () => {
  const GATE_BASE = { vh: 5, vth: 1.4, w: 0.12, rout: 60 }

  /** Drive inputs with ideal sources (0 V / 5 V), put a 10 k load on Y and read Y. */
  function out(fn: 'not' | 'and' | 'or' | 'nand' | 'nor' | 'xor' | 'xnor', a: number, b?: number): number {
    const elements: Circuit['elements'] = [
      { kind: 'V', id: 'va', a: 1, b: 0, v: a },
      { kind: 'R', id: 'load', a: 3, b: 0, r: 10000 },
      { kind: 'G', id: 'g', fn, a: 1, b: b === undefined ? undefined : 2, y: 3, ...GATE_BASE },
    ]
    if (b !== undefined) elements.push({ kind: 'V', id: 'vb', a: 2, b: 0, v: b })
    const r = solve({ nodeCount: 4, elements })
    expect(r.converged).toBe(true)
    return r.v[3]
  }

  const HIGH = 5 * (10000 / 10060)
  const truth: Record<string, number[]> = {
    // outputs for (A,B) = 00, 01, 10, 11
    and: [0, 0, 0, 1],
    or: [0, 1, 1, 1],
    nand: [1, 1, 1, 0],
    nor: [1, 0, 0, 0],
    xor: [0, 1, 1, 0],
    xnor: [1, 0, 0, 1],
  }

  for (const [fn, table] of Object.entries(truth)) {
    it(`${fn} follows its truth table`, () => {
      ;[[0, 0], [0, 5], [5, 0], [5, 5]].forEach(([a, b], k) => {
        const v = out(fn as 'and', a, b)
        near(v, table[k] ? HIGH : 0, 0.02)
      })
    })
  }

  it('not inverts', () => {
    near(out('not', 0), HIGH, 0.02)
    near(out('not', 5), 0, 0.02)
  })

  it('switches around 1.4 V and a 3 V input counts as high', () => {
    near(out('not', 0.8), HIGH, 0.05)
    near(out('not', 2.0), 0, 0.05)
    near(out('not', 3), 0, 0.02)
  })

  it('a high output into a short carries 5 V / 60 ohm', () => {
    const r = solve({
      nodeCount: 3,
      elements: [
        { kind: 'V', id: 'va', a: 1, b: 0, v: 0 },
        { kind: 'G', id: 'g', fn: 'not', a: 1, y: 2, ...GATE_BASE },
        { kind: 'R', id: 'short', a: 2, b: 0, r: 0.001 },
      ],
    })
    expect(r.converged).toBe(true)
    near(r.cur.get('g')!.i, 5 / 60, 1e-3)
  })

  it('a chain of three inverters inverts once overall', () => {
    const r = solve({
      nodeCount: 5,
      elements: [
        { kind: 'V', id: 'va', a: 1, b: 0, v: 5 },
        { kind: 'G', id: 'g1', fn: 'not', a: 1, y: 2, ...GATE_BASE },
        { kind: 'G', id: 'g2', fn: 'not', a: 2, y: 3, ...GATE_BASE },
        { kind: 'G', id: 'g3', fn: 'not', a: 3, y: 4, ...GATE_BASE },
        { kind: 'R', id: 'load', a: 4, b: 0, r: 10000 },
      ],
    })
    expect(r.converged).toBe(true)
    near(r.v[4], 0, 0.02)
  })
})

describe('capacitors', () => {
  // 5 V -> 1 kohm -> node 2 -> 100 uF -> ground: tau = 0.1 s
  const rc = (): Circuit => ({
    nodeCount: 3,
    elements: [
      { kind: 'V', id: 'v', a: 1, b: 0, v: 5 },
      { kind: 'R', id: 'r', a: 1, b: 2, r: 1000 },
      { kind: 'K', id: 'c', a: 2, b: 0, c: 100e-6 },
    ],
  })

  it('is an open circuit in a plain DC solve', () => {
    const r = solve(rc())
    near(r.v[2], 5, 1e-6)
    near(r.cur.get('c')!.i, 0, 1e-12)
  })

  it('charges along 1 - e^(-t/RC): 63.2 % after one time constant, full after five', () => {
    const c = rc()
    const charge = new Map<string, number>()
    let t = 0
    let res = advance(c, charge, 0.1)
    t += 0.1
    near(res.v[2], 5 * (1 - Math.exp(-1)), 0.05)
    for (let k = 0; k < 4; k++) {
      res = advance(c, charge, 0.1)
      t += 0.1
    }
    near(res.v[2], 5 * (1 - Math.exp(-t / 0.1)), 0.05)
    expect(res.v[2]).toBeGreaterThan(4.9)
  })

  it('gives the same answer in one big frame and in many small ones', () => {
    const a = new Map<string, number>()
    const b = new Map<string, number>()
    const one = advance(rc(), a, 0.25)
    let many = one
    for (let k = 0; k < 250; k++) many = advance(rc(), b, 0.001)
    near(one.v[2], many.v[2], 0.05)
  })

  it('discharges through a resistor: V0 e^(-t/RC)', () => {
    // 100 uF holding 4 V across 1 kohm, no source
    const c: Circuit = {
      nodeCount: 2,
      elements: [
        { kind: 'R', id: 'r', a: 1, b: 0, r: 1000 },
        { kind: 'K', id: 'c', a: 1, b: 0, c: 100e-6 },
      ],
    }
    const charge = new Map([['c', 4]])
    const res = advance(c, charge, 0.2)
    near(res.v[1], 4 * Math.exp(-2), 0.05)
  })

  it('draws a current that dies away: i = V/R e^(-t/RC)', () => {
    const c = rc()
    const charge = new Map<string, number>()
    const res = advance(c, charge, 0.1)
    near(res.cur.get('r')!.i, (5 / 1000) * Math.exp(-1), 2e-4)
  })

  it('blinks an LED from an RC and a threshold: the LED lights only as the cap charges past its knee', () => {
    // 5 V -> 220 ohm -> LED -> cap to ground; LED current falls toward zero as the cap fills
    const c: Circuit = {
      nodeCount: 4,
      elements: [
        { kind: 'V', id: 'v', a: 1, b: 0, v: 5 },
        { kind: 'R', id: 'r', a: 1, b: 2, r: 220 },
        { kind: 'D', id: 'd', a: 2, b: 3, is: ledIs(LED_COLORS.red.vf10), n: LED_N },
        { kind: 'K', id: 'c', a: 3, b: 0, c: 1000e-6 },
      ],
    }
    const charge = new Map<string, number>()
    const early = advance(c, charge, 0.02).cur.get('d')!.i
    let late = early
    for (let k = 0; k < 100; k++) late = advance(c, charge, 0.1).cur.get('d')!.i
    expect(early).toBeGreaterThan(0.01)
    expect(late).toBeLessThan(1e-4)
  })

  it('picks a step from the fastest RC', () => {
    near(transientStep(rc()), 0.0025, 1e-9)
    expect(transientStep({ nodeCount: 2, elements: [{ kind: 'R', id: 'r', a: 1, b: 0, r: 5 }] })).toBe(Infinity)
  })
})

describe('capacitor markings', () => {
  it('prints the EIA code of a ceramic capacitor', () => {
    expect(eiaCode(1e-9)).toBe('102')
    expect(eiaCode(4.7e-9)).toBe('472')
    expect(eiaCode(1e-8)).toBe('103')
    expect(eiaCode(2.2e-8)).toBe('223')
    expect(eiaCode(1e-7)).toBe('104')
    expect(eiaCode(3.3e-7)).toBe('334')
    expect(eiaCode(1e-6)).toBe('105')
    expect(eiaCode(47e-12)).toBe('47')
  })
})
