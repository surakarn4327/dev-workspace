import { describe, expect, it } from 'vitest'
import { SceneBuilder } from '../lessons/lessons.ts'
import { Simulation } from './simulation.ts'
import { World } from './world.ts'

/** 9 V cell -> 10 kohm -> capacitor -> back to the cell: a time constant of R x C (the cell's own 1.5 ohm is lost in it). */
function rc(type: string, farads: number, flip = false): { w: World; sim: Simulation; capId: string } {
  const w = new World()
  const b = new SceneBuilder(w)
  const bat = b.place('battery', -320, 80, { volts: 9 })
  b.place('resistor', 0, 0, { value: 10000, legs: 2 })
  const cap = b.place(type, 160, 100, { value: farads, legs: 1 })
  // the capacitor's pins sit at (160, 120) and, one hole apart; `flip` puts the supply the other way round
  const far = { x: 180, y: 120 }
  b.connect(bat, flip ? far : { x: 0, y: 0 }, flip ? { x: 0, y: 0 } : far)
  b.wire({ x: 80, y: 0 }, { x: 160, y: 120 })
  return { w, sim: new Simulation(w), capId: cap.id }
}

describe('capacitor in a circuit', () => {
  it('starts empty and charges along the RC curve in real time', () => {
    const { sim, capId } = rc('cap-ceramic', 1e-4)
    sim.step(0.016)
    expect(sim.live.get(capId)!.v).toBeLessThan(0.6)
    // one time constant (R x C = 1 s) after the start, minus the first frame: 63 % of 9 V
    for (let k = 0; k < 61; k++) sim.step(0.016)
    const v = sim.live.get(capId)!.v
    expect(v).toBeGreaterThan(9 * 0.6)
    expect(v).toBeLessThan(9 * 0.66)
    // the charging current falls off as it fills
    expect(sim.live.get(capId)!.i).toBeCloseTo((9 - v) / 10000, 4)
    for (let k = 0; k < 600; k++) sim.step(0.016)
    expect(sim.live.get(capId)!.v).toBeGreaterThan(8.95)
  })

  it('keeps its charge when the circuit is edited', () => {
    const { w, sim, capId } = rc('cap-electro', 1e-4)
    for (let k = 0; k < 62; k++) sim.step(0.016)
    const before = sim.live.get(capId)!.v
    w.commit()
    sim.step(0.016)
    expect(sim.live.get(capId)!.v).toBeGreaterThanOrEqual(before)
    expect(sim.live.get(capId)!.v).toBeLessThan(before + 0.2)
  })

  it('burns an electrolytic put in backwards, and says so', () => {
    const { w, sim, capId } = rc('cap-electro', 1e-4, true)
    for (let k = 0; k < 120; k++) sim.step(0.016)
    const cap = w.getPart(capId)!
    expect(cap.state.failed).toBe(true)
    expect(cap.state.failMsg).toMatch(/backwards/)
  })

  it('takes 9 V the right way round without trouble', () => {
    const { w, sim, capId } = rc('cap-electro', 1e-4)
    for (let k = 0; k < 600; k++) sim.step(0.016)
    expect(w.getPart(capId)!.state.failed).toBe(false)
  })

  it('a small capacitor (10 ms time constant) is full within a few frames of real time', () => {
    const { sim, capId } = rc('cap-ceramic', 1e-6)
    for (let k = 0; k < 20; k++) sim.step(0.016)
    expect(Math.abs(sim.live.get(capId)!.i)).toBeLessThan(1e-6)
    expect(sim.live.get(capId)!.v).toBeGreaterThan(8.99)
  })
})
