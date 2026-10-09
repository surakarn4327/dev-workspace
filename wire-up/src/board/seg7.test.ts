import { describe, expect, it } from 'vitest'
import { SceneBuilder } from '../lessons/lessons.ts'
import { Simulation } from './simulation.ts'
import { World } from './world.ts'

/** The display at (200, 100): segment A is pin 7 at (260, 100), a COM pin is pin 3 at (240, 220). */
function lab(common: 'cathode' | 'anode', ohms: number | null): { w: World; sim: Simulation; id: string } {
  const w = new World()
  const b = new SceneBuilder(w)
  const bat = b.place('battery', -320, 80, { volts: 5 })
  const disp = b.place('seg7', 200, 100, { common })
  const segA = { x: 260, y: 100 }
  const com = { x: 240, y: 220 }
  const plus = { x: 0, y: 0 }
  if (ohms !== null) b.place('resistor', 0, 0, { value: ohms, legs: 2 })
  // cathode: + -> resistor -> segment A, COM -> -; anode: + -> COM, segment A -> resistor -> -
  if (common === 'cathode') {
    b.connect(bat, plus, com)
    b.wire(ohms !== null ? { x: 80, y: 0 } : plus, segA)
  } else {
    b.connect(bat, com, ohms !== null ? { x: 80, y: 0 } : segA)
    if (ohms !== null) b.wire(plus, segA)
  }
  return { w, sim: new Simulation(w), id: disp.id }
}

describe('seven-segment display', () => {
  it('lights only the segment that has current, with the LED current a resistor gives', () => {
    const { sim, id } = lab('cathode', 330)
    sim.step(0.016)
    const live = sim.live.get(id)!
    expect(live.i_a).toBeGreaterThan(0.008)
    expect(live.i_a).toBeLessThan(0.011)
    expect(Math.abs(live.i_b)).toBeLessThan(1e-6)
    expect(Math.abs(live.i_g)).toBeLessThan(1e-6)
  })

  it('works the other way round with a common anode', () => {
    const { sim, id } = lab('anode', 330)
    sim.step(0.016)
    expect(sim.live.get(id)!.i_a).toBeGreaterThan(0.008)
  })

  it('a segment without a resistor burns the display and says which segment', () => {
    const { w, sim, id } = lab('cathode', null)
    for (let k = 0; k < 120; k++) sim.step(0.016)
    const d = w.getPart(id)!
    expect(d.state.failed).toBe(true)
    expect(d.state.failMsg).toMatch(/Segment A/)
  })
})
