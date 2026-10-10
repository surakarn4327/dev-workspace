import { describe, expect, it } from 'vitest'
import { SceneBuilder } from '../lessons/lessons.ts'
import { Simulation } from '../board/simulation.ts'
import { World } from '../board/world.ts'
import { pinWorld } from './index.ts'

/** A 555 blinker: R1 from VCC to DISCH, R2 from DISCH to THRES (tied to TRIG), C from THRES to GND. */
function astable(volts: number, r1: number, r2: number, c: number, source = 'battery'): { sim: Simulation; chipId: string; w: World } {
  const w = new World()
  const b = new SceneBuilder(w)
  const bat = b.place(source, 0, 0, { volts })
  const chip = b.place('ic-ne555', 200, 100)
  const ra = b.place('resistor', 400, 0, { value: r1 })
  const rb = b.place('resistor', 400, 120, { value: r2 })
  const cap = b.place('cap-ceramic', 640, 120, { value: c })
  const [bp, bm] = pinWorld(bat)
  const pin = pinWorld(chip)
  const [a0, a1] = pinWorld(ra)
  const [b0, b1] = pinWorld(rb)
  const [c0, c1] = pinWorld(cap)
  b.wire(bp, pin[7])
  b.wire(bm, pin[0], '#2f6fe0')
  b.wire(pin[3], pin[7], '#f2d21b') // RESET to VCC
  b.wire(pin[7], a0)
  b.wire(a1, pin[6]) // R1 to DISCH
  b.wire(pin[6], b0)
  b.wire(b1, pin[5]) // R2 to THRES
  b.wire(pin[5], pin[1], '#2ea043') // THRES to TRIG
  b.wire(pin[5], c0)
  b.wire(c1, pin[0], '#2f6fe0')
  w.commit()
  return { sim: new Simulation(w), chipId: chip.id, w }
}

/** Run `seconds` in 16 ms frames; returns the OUT voltage seen at every frame. */
function run(s: { sim: Simulation; chipId: string }, seconds: number): number[] {
  const out: number[] = []
  const frames = Math.round(seconds / 0.016)
  for (let i = 0; i < frames; i++) {
    s.sim.step(0.016)
    const nodes = s.sim.net.partPins.get(s.chipId)!
    out.push(s.sim.result!.v[nodes[2]] - s.sim.result!.v[nodes[0]])
  }
  return out
}

describe('NE555 timer', () => {
  it('blinks at the datasheet frequency 1.44 / ((R1 + 2 R2) C)', () => {
    const r1 = 1e4
    const r2 = 1e5
    const c = 1e-6
    const s = astable(9, r1, r2, c)
    const seconds = 6
    const v = run(s, seconds)
    let edges = 0
    for (let i = 1; i < v.length; i++) if (v[i - 1] < 4.5 && v[i] >= 4.5) edges++
    const f = 1.44 / ((r1 + 2 * r2) * c)
    // the first rising edge is the start-up (the capacitor is flat), so cycles are counted between rising edges
    expect(edges).toBeGreaterThan(f * seconds * 0.93)
    expect(edges).toBeLessThan(f * seconds * 1.07 + 1)
    // high output sits one output-stage drop under the supply, low output near ground
    expect(Math.max(...v)).toBeGreaterThan(8.3)
    expect(Math.min(...v)).toBeLessThan(0.6)
  })

  it('does nothing under 4.5 V, like the real chip', () => {
    const v = run(astable(3, 1e4, 1e5, 1e-6), 2)
    // the output pin floats: no stage drives it, so it never swings to the supply
    expect(Math.max(...v)).toBeLessThan(1.5)
  })

  it('burns when the supply is over 18 V, and says why in numbers', () => {
    const s = astable(24, 1e4, 1e5, 1e-6, 'supply')
    s.sim.step(0.016)
    const stress = s.sim.stress.get(s.chipId)!
    expect(stress.ratio).toBeGreaterThan(1)
    expect(stress.reason()).toContain('absolute maximum is 18 V')
  })
})
