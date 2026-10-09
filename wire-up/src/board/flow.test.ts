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

  it('cuts a wire at a branch and gives each stretch its own current', () => {
    // 9 V -> main wire -> R1, and a branch off the middle of the main wire -> R2 -> back: two 1 kohm loads in parallel
    const w = new World()
    const bat = newPart(w.nextId('p'), 'battery', 0, 0)
    bat.params.volts = 9
    const r1 = newPart(w.nextId('p'), 'resistor', 400, 0)
    const r2 = newPart(w.nextId('p'), 'resistor', 400, 200)
    w.parts.push(bat, r1, r2)
    const [plus, minus] = pinWorld(bat)
    const p1 = pinWorld(r1)
    const p2 = pinWorld(r2)
    const main = w.addWire(plus, p1[0], '#ff4a4a')
    w.addWire({ x: 200, y: plus.y }, p2[0], '#2ea043') // its first end rests on the middle of the main wire
    w.addWire(p1[1], minus, '#4a7aff')
    w.addWire(p2[1], minus, '#4a7aff')
    const sim = new Simulation(w)
    sim.step(0.016)
    const parts = sim.flowParts.filter((q) => q.wire === main.id)
    expect(parts.length).toBe(2)
    expect(parts[0].i).toBeGreaterThan(0.017) // both loads before the junction
    expect(parts[1].i).toBeGreaterThan(0.0085) // only R1 after it
    expect(parts[1].i).toBeLessThan(parts[0].i * 0.55)
    expect(sim.flow.has(main.id)).toBe(false) // no single number for a cut wire
  })
})
