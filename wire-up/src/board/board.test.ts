import { describe, expect, it } from 'vitest'
import { newPart } from '../parts/index.ts'
import { G, World } from './world.ts'
import { Simulation } from './simulation.ts'
import { SceneBuilder } from '../lessons/lessons.ts'
import { validateWorldData } from './world.ts'
import { KNOWN_TYPES } from '../parts/index.ts'

function hole(col: number, row: number) {
  return { x: (col - 1) * G, y: row * G }
}

function ledLoop(withResistor: boolean): World {
  const w = new World()
  const b = new SceneBuilder(w)
  b.board()
  const bat = b.place('battery', -320, 80, { volts: 9 })
  bat.leads = [hole(5, 5), hole(10, 5)]
  if (withResistor) b.place('resistor', hole(5, 6).x, hole(5, 6).y, { value: 470, spread: 4 })
  else b.wire(hole(5, 6), hole(9, 6))
  b.place('led', hole(9, 6).x, hole(9, 6).y, { color: 'red' })
  return w
}

describe('breadboard connectivity', () => {
  it('lights an LED through a resistor, wired via board columns', () => {
    const w = ledLoop(true)
    const sim = new Simulation(w)
    sim.step(0.016)
    const led = w.parts.find((p) => p.type === 'led')!
    const i = sim.live.get(led.id)!.i
    expect(i).toBeGreaterThan(0.013)
    expect(i).toBeLessThan(0.017)
    expect(sim.result!.converged).toBe(true)
  })

  it('works with free wires on the canvas, no breadboard at all', () => {
    const w = new World()
    const b = new SceneBuilder(w)
    const bat = b.place('battery', -320, 80, { volts: 9 })
    b.place('resistor', 0, 0, { value: 470, spread: 4 })
    b.place('led', 160, 100, { color: 'green' })
    bat.leads = [{ x: 0, y: 0 }, { x: 180, y: 100 }]
    b.wire({ x: 80, y: 0 }, { x: 160, y: 100 })
    const sim = new Simulation(w)
    sim.step(0.016)
    const led = w.parts.find((p) => p.type === 'led')!
    expect(sim.live.get(led.id)!.i).toBeGreaterThan(0.01)
  })

  it('burns the LED when the resistor is missing, and explains why', () => {
    const w = ledLoop(false)
    const sim = new Simulation(w)
    for (let k = 0; k < 120; k++) sim.step(0.016)
    const led = w.parts.find((p) => p.type === 'led')!
    expect(led.state.failed).toBe(true)
    expect(led.state.failMsg).toMatch(/LED carried/)
    expect(led.state.failMsg).toMatch(/30(\.0+)? mA/)
    // the dead LED is an open circuit
    expect(sim.live.get(led.id)!.i).toBeCloseTo(0, 6)
    // replacing restores the part
    sim.replace(led.id)
    expect(led.state.failed).toBe(false)
  })

  it('a resistor over its power rating burns open', () => {
    const w = new World()
    const b = new SceneBuilder(w)
    b.board()
    const bat = b.place('battery', -320, 80, { volts: 9 })
    bat.leads = [hole(5, 5), hole(9, 5)]
    b.place('resistor', hole(5, 6).x, hole(5, 6).y, { value: 10, spread: 4 })
    const sim = new Simulation(w)
    for (let k = 0; k < 200; k++) sim.step(0.016)
    const r = w.parts.find((p) => p.type === 'resistor')!
    expect(r.state.failed).toBe(true)
  })

  it('multimeter reads the divider voltage in volts mode', () => {
    const w = new World()
    const b = new SceneBuilder(w)
    b.board()
    const bat = b.place('battery', -320, 80, { volts: 9 })
    bat.leads = [hole(5, 1), hole(5, 2)]
    // battery + to rail row 0? use rails: + rail row 0, - rail row 1
    bat.leads = [hole(1, 0), hole(1, 1)]
    b.place('resistor', hole(5, 3).x, hole(5, 3).y, { value: 10000, spread: 4 })
    b.place('resistor', hole(9, 3).x, hole(9, 3).y, { value: 5000, spread: 4 })
    b.wire(hole(5, 4), hole(5, 0)) // R1 left -> + rail
    b.wire(hole(13, 4), hole(13, 1)) // R2 right -> - rail
    const m = b.place('meter', 640, 40, { mode: 'V' })
    m.leads = [hole(9, 5), hole(13, 5)]
    const sim = new Simulation(w)
    sim.step(0.016)
    const v = sim.live.get(m.id)!.v
    expect(v).toBeGreaterThan(2.9)
    expect(v).toBeLessThan(3.1)
  })

  it('an ammeter across the battery blows its fuse', () => {
    const w = new World()
    const b = new SceneBuilder(w)
    b.board()
    const bat = b.place('battery', -320, 80, { volts: 9 })
    bat.leads = [hole(1, 0), hole(1, 1)]
    const m = b.place('meter', 640, 40, { mode: 'A' })
    m.leads = [hole(3, 0), hole(3, 1)]
    const sim = new Simulation(w)
    for (let k = 0; k < 30; k++) sim.step(0.016)
    expect(m.state.failed).toBe(true)
    expect(m.state.failMsg).toMatch(/fuse/i)
  })
})

describe('save format', () => {
  it('round-trips and rejects junk', () => {
    const w = ledLoop(true)
    const json = JSON.parse(JSON.stringify(w.serialize()))
    const ok = validateWorldData(json, KNOWN_TYPES)
    expect(typeof ok).not.toBe('string')
    expect(validateWorldData({ version: 1, counter: 1, parts: [{ id: 'x', type: 'nope', x: 0, y: 0, rot: 0, params: {} }], wires: [] }, KNOWN_TYPES)).toMatch(/Unknown part/)
    expect(validateWorldData({ version: 9 }, KNOWN_TYPES)).toMatch(/version/)
    const p = newPart('p1', 'resistor', 20, 20)
    expect(p.x).toBe(20)
  })
})
