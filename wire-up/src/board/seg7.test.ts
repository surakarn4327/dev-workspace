import { describe, expect, it } from 'vitest'
import { SceneBuilder } from '../lessons/lessons.ts'
import { Simulation } from './simulation.ts'
import { World } from './world.ts'

/** The display at (200, 100): segment A is pin 7 at (260, 100), a COM pin is pin 3 at (240, 260). */
function lab(ohms: number | null): { w: World; sim: Simulation; id: string } {
  const w = new World()
  const b = new SceneBuilder(w)
  const bat = b.place('battery', -320, 80, { volts: 5 })
  const disp = b.place('seg7', 200, 100, {})
  const segA = { x: 260, y: 100 }
  const com = { x: 240, y: 260 }
  const plus = { x: 0, y: 0 }
  if (ohms !== null) b.place('resistor', 0, 0, { value: ohms, legs: 2 })
  // + -> resistor -> segment A, COM -> -
  b.connect(bat, plus, com)
  b.wire(ohms !== null ? { x: 80, y: 0 } : plus, segA)
  return { w, sim: new Simulation(w), id: disp.id }
}

describe('seven-segment display', () => {
  it('lights only the segment that has current, with the LED current a resistor gives', () => {
    const { sim, id } = lab(330)
    sim.step(0.016)
    const live = sim.live.get(id)!
    expect(live.i_0_a).toBeGreaterThan(0.008)
    expect(live.i_0_a).toBeLessThan(0.011)
    expect(Math.abs(live.i_0_b)).toBeLessThan(1e-6)
    expect(Math.abs(live.i_0_g)).toBeLessThan(1e-6)
  })

  it('a segment without a resistor burns the display and says which segment', () => {
    const { w, sim, id } = lab(null)
    for (let k = 0; k < 120; k++) sim.step(0.016)
    const d = w.getPart(id)!
    expect(d.state.failed).toBe(true)
    expect(d.state.failMsg).toMatch(/Segment A/)
  })
})
