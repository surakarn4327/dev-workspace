import { describe, expect, it } from 'vitest'
import { SceneBuilder } from '../lessons/lessons.ts'
import { pinWorld } from '../parts/index.ts'
import { Simulation } from './simulation.ts'
import { World } from './world.ts'
import type { PartInstance } from './world.ts'

/** 9 V battery -> rocker switch on input A of a gate, gate output Y -> 330 ohm -> LED -> back to battery -. All free wires, no board. */
function build(type: string, strayBatteryFirst = false) {
  const w = new World()
  const b = new SceneBuilder(w)
  if (strayBatteryFirst) b.place('battery', -400, 600, { volts: 9 }) // an unrelated battery placed before the one in use
  const bat = b.place('battery', -400, 0, { volts: 9 })
  const gate = b.place(type, 200, 0)
  const sw = b.place('switch', 40, 200)
  const r = b.place('resistor', 360, 0, { value: 330, spread: 4 })
  const led = b.place('led', 360, 200, { color: 'green' })
  const [plus, minus] = pinWorld(bat)
  const g = pinWorld(gate)
  const s = pinWorld(sw)
  const rp = pinWorld(r)
  const lp = pinWorld(led)
  // switch: battery + -> switch -> gate input A; gate B (when present) tied to battery +? keep B low for AND-like tests via minus
  b.wire(plus, s[0])
  b.wire(s[1], g[0])
  if (g.length === 3) b.wire(minus, g[1])
  b.wire(g[g.length - 1], rp[0])
  b.wire(rp[1], lp[0])
  b.wire(lp[1], minus)
  return { w, gate, sw, led, sim: new Simulation(w), minus, plus }
}

function flip(w: World, sw: PartInstance, on: boolean): void {
  sw.params.on = on
  w.touch() // what a click on the switch does
}

describe('logic gates in a real circuit', () => {
  it('an inverter lights the LED when its input is low and turns it off when high', () => {
    const t = build('gate-not')
    flip(t.w, t.sw, false)
    t.sim.step(0.016)
    const lit = t.sim.live.get(t.led.id)!.i
    expect(t.sim.result!.converged).toBe(true)
    expect(lit).toBeGreaterThan(0.005)
    expect(t.sim.live.get(t.gate.id)!.high).toBe(1)
    flip(t.w, t.sw, true)
    t.sim.step(0.016)
    expect(t.sim.live.get(t.led.id)!.i).toBeLessThan(0.0005)
    expect(t.sim.live.get(t.gate.id)!.high).toBe(0)
  })

  it('an AND gate with B low never lights; a NAND with B low always does', () => {
    const and = build('gate-and')
    flip(and.w, and.sw, true)
    and.sim.step(0.016)
    expect(and.sim.live.get(and.led.id)!.i).toBeLessThan(0.0005)
    const nand = build('gate-nand')
    flip(nand.w, nand.sw, true)
    nand.sim.step(0.016)
    expect(nand.sim.live.get(nand.led.id)!.i).toBeGreaterThan(0.005)
  })

  it('a gate works off the battery in its own circuit, not the first battery on the board', () => {
    const t = build('gate-not', true)
    flip(t.w, t.sw, false)
    for (let k = 0; k < 10; k++) t.sim.step(0.016)
    expect(t.sim.live.get(t.led.id)!.i).toBeGreaterThan(0.005)
  })

  it('a gate never burns, even with a 9 V input', () => {
    const t = build('gate-not')
    flip(t.w, t.sw, true)
    for (let k = 0; k < 300; k++) t.sim.step(0.016)
    expect(t.gate.state.failed).toBe(false)
  })
})
