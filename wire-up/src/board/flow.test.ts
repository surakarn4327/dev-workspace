import { describe, expect, it } from 'vitest'
import { newPart, pinWorld } from '../parts/index.ts'
import { Simulation } from './simulation.ts'
import { World } from './world.ts'

function loop(volts = 9, ohms = 1000) {
  const w = new World()
  const bat = newPart(w.nextId('p'), 'battery', 0, 0)
  bat.params.volts = volts
  const r = newPart(w.nextId('p'), 'resistor', 300, 0)
  r.params.value = ohms
  w.parts.push(bat, r)
  const [plus, minus] = pinWorld(bat)
  const rp = pinWorld(r)
  const out = w.addWire(plus, rp[0], '#ff4a4a') // battery + -> resistor
  const back = w.addWire(rp[1], minus, '#4a7aff') // resistor -> battery -
  const sim = new Simulation(w)
  sim.step(0.016)
  return { w, sim, out, back }
}

describe('wire flow', () => {
  it('flows from the battery + along the wire to the resistor and back into the -', () => {
    const { sim, out, back } = loop()
    const i = 0.009 // 9 V over 1 kohm, a little less through the battery's own resistance
    expect(sim.flow.get(out.id)!).toBeGreaterThan(i * 0.9)
    expect(sim.flow.get(out.id)!).toBeLessThan(i * 1.01)
    expect(sim.flow.get(back.id)!).toBeGreaterThan(i * 0.9)
  })

  it('reverses sign when the wire is drawn the other way round', () => {
    const w = new World()
    const bat = newPart(w.nextId('p'), 'battery', 0, 0)
    const r = newPart(w.nextId('p'), 'resistor', 300, 0)
    w.parts.push(bat, r)
    const [plus, minus] = pinWorld(bat)
    const rp = pinWorld(r)
    const out = w.addWire(rp[0], plus, '#ff4a4a') // drawn from the resistor to the +
    w.addWire(rp[1], minus, '#4a7aff')
    const sim = new Simulation(w)
    sim.step(0.016)
    expect(sim.flow.get(out.id)!).toBeLessThan(0)
  })

  it('has no answer for a wire with a branch resting on it', () => {
    const { w, sim, out } = loop()
    w.addWire({ x: out.a.x + 100, y: out.a.y }, { x: out.a.x + 100, y: out.a.y + 80 }, '#00ff00') // end rests on the middle of `out`
    w.touch()
    sim.step(0.016)
    expect(sim.flow.has(out.id)).toBe(false)
  })
})
