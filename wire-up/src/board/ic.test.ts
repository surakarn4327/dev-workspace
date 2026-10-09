import { describe, expect, it } from 'vitest'
import { SceneBuilder } from '../lessons/lessons.ts'
import { pinWorld } from '../parts/index.ts'
import { Simulation } from './simulation.ts'
import { World } from './world.ts'

/**
 * Battery -> VCC (pin 14) and GND (pin 7) of a 74HC chip, a switch from + to input 1A, input 1B wired straight to +,
 * output 1Y (or 1Y of the inverter) -> 330 ohm -> LED -> battery -. All free wires.
 */
function build(type: string, volts = 4.5, swapSupply = false) {
  const w = new World()
  const b = new SceneBuilder(w)
  const bat = b.place('battery', -400, 200, { volts })
  const chip = b.place(type, 0, 0)
  const sw = b.place('switch', -200, 200)
  const r = b.place('resistor', 300, 200, { value: 330, legs: 2 })
  const led = b.place('led', 460, 200, { color: 'green' })
  const [plus, minus] = pinWorld(bat)
  const pins = pinWorld(chip)
  const pin = (k: number) => pins[k - 1]
  const s = pinWorld(sw)
  const rp = pinWorld(r)
  const lp = pinWorld(led)
  b.wire(swapSupply ? minus : plus, pin(14))
  const vccWire = w.wires[w.wires.length - 1]
  b.wire(swapSupply ? plus : minus, pin(7))
  b.wire(plus, s[0])
  b.wire(s[1], pin(1))
  const inWire = w.wires[w.wires.length - 1]
  const inverter = type === 'ic-74hc04'
  if (!inverter) b.wire(plus, pin(2))
  b.wire(pin(inverter ? 2 : 3), rp[0])
  b.wire(rp[1], lp[0])
  b.wire(lp[1], minus)
  return { w, chip, sw, led, vccWire, inWire, sim: new Simulation(w) }
}

function flip(t: ReturnType<typeof build>, on: boolean): void {
  t.sw.params.on = on
  t.w.touch()
  for (let k = 0; k < 5; k++) t.sim.step(0.016)
}

describe('74HC chips (DIP-14)', () => {
  it('74HC08: the LED follows A AND B, powered from pin 14', () => {
    const t = build('ic-74hc08')
    flip(t, false)
    expect(t.sim.result!.converged).toBe(true)
    expect(t.sim.live.get(t.led.id)!.i).toBeLessThan(0.0005)
    flip(t, true)
    expect(t.sim.live.get(t.led.id)!.i).toBeGreaterThan(0.004)
    // the LED current comes in through VCC
    expect(t.sim.live.get(t.chip.id)!.i).toBeGreaterThan(0.004)
    expect(t.chip.state.failed).toBe(false)
  })

  it('the flowing dots run from the battery into VCC, not along the input wire', () => {
    const t = build('ic-74hc08')
    flip(t, true)
    const iv = t.sim.flow.get(t.vccWire.id) ?? 0
    expect(iv).toBeGreaterThan(0.004) // + terminal -> pin 14
    expect(Math.abs(t.sim.flow.get(t.inWire.id) ?? 0)).toBeLessThan(1e-5) // an input draws no current
  })

  it('74HC04: the LED is on while the input is low', () => {
    const t = build('ic-74hc04')
    flip(t, false)
    expect(t.sim.live.get(t.led.id)!.i).toBeGreaterThan(0.004)
    flip(t, true)
    expect(t.sim.live.get(t.led.id)!.i).toBeLessThan(0.0005)
  })

  it('does nothing when only GND (or only VCC) is wired, even with a path back through the load', () => {
    for (const missing of [7, 14]) {
      const w = new World()
      const b = new SceneBuilder(w)
      const bat = b.place('battery', -400, 200, { volts: 4.5 })
      const chip = b.place('ic-74hc08', 0, 0)
      const r = b.place('resistor', 300, 200, { value: 330, legs: 2 })
      const led = b.place('led', 460, 200, { color: 'green' })
      const [plus, minus] = pinWorld(bat)
      const p = pinWorld(chip)
      const rp = pinWorld(r)
      const lp = pinWorld(led)
      if (missing !== 14) b.wire(plus, p[13])
      if (missing !== 7) b.wire(minus, p[6])
      b.wire(plus, p[0])
      b.wire(plus, p[1])
      b.wire(p[2], rp[0])
      b.wire(rp[1], lp[0])
      b.wire(lp[1], minus)
      const sim = new Simulation(w)
      for (let k = 0; k < 5; k++) sim.step(0.016)
      expect(sim.live.get(led.id)!.i).toBeLessThan(0.0005)
    }
  })

  it('does nothing without its supply wired', () => {
    const w = new World()
    const b = new SceneBuilder(w)
    b.place('ic-74hc08', 0, 0)
    const sim = new Simulation(w)
    sim.step(0.016)
    expect(sim.result!.converged).toBe(true)
  })

  it('burns on a 9 V supply, with the reason in volts', () => {
    const t = build('ic-74hc08', 9)
    for (let k = 0; k < 300; k++) t.sim.step(0.016)
    expect(t.chip.state.failed).toBe(true)
    expect(t.chip.state.failMsg).toMatch(/at most 7 V/)
  })

  it('burns when VCC and GND are swapped', () => {
    const t = build('ic-74hc08', 4.5, true)
    for (let k = 0; k < 300; k++) t.sim.step(0.016)
    expect(t.chip.state.failed).toBe(true)
    expect(t.chip.state.failMsg).toMatch(/swapped/)
  })
})

describe('wires on a chip', () => {
  it('leave the top row upwards and the bottom row downwards, following rotation', async () => {
    const { leadPins } = await import('./obstacles.ts')
    const w = new World()
    const b = new SceneBuilder(w)
    const chip = b.place('ic-74hc08', 0, 0)
    const pins = pinWorld(chip)
    const leads = leadPins(w)
    const at = (k: number) => leads.find((l) => l.x === pins[k - 1].x && l.y === pins[k - 1].y)!
    expect([at(14).dx, at(14).dy]).toEqual([0, -1])
    expect([at(1).dx, at(1).dy]).toEqual([0, 1])
    chip.rot = 1
    const turned = leadPins(w).find((l) => l.x === pinWorld(chip)[13].x && l.y === pinWorld(chip)[13].y)!
    expect([turned.dx, turned.dy]).toEqual([1, 0])
  })
})

describe('74HC inputs', () => {
  /** 74HC08 powered from a battery of `volts`; input 1A to + through a switch (or left alone), 1B tied to +; Y -> 330 ohm -> LED. */
  function rig(volts: number, input: 'floating' | 'plus' | 'minus' | 'nine') {
    const w = new World()
    const b = new SceneBuilder(w)
    const bat = b.place('battery', -400, 200, { volts })
    const big = b.place('battery', -400, 400, { volts: 9 })
    const chip = b.place('ic-74hc08', 0, 0)
    const r = b.place('resistor', 300, 200, { value: 330, legs: 2 })
    const led = b.place('led', 460, 200, { color: 'green' })
    const [plus, minus] = pinWorld(bat)
    const [nine] = pinWorld(big)
    const [, nineMinus] = pinWorld(big)
    const p = pinWorld(chip)
    const rp = pinWorld(r)
    const lp = pinWorld(led)
    b.wire(plus, p[13])
    b.wire(minus, p[6])
    b.wire(plus, p[1])
    if (input === 'plus') b.wire(plus, p[0])
    if (input === 'minus') b.wire(minus, p[0])
    if (input === 'nine') {
      b.wire(nine, p[0])
      b.wire(nineMinus, minus) // common ground, so the 9 V really is 9 V above the chip's GND
    }
    b.wire(p[2], rp[0])
    b.wire(rp[1], lp[0])
    b.wire(lp[1], minus)
    return { w, chip, led, sim: new Simulation(w) }
  }

  it('a floating input wanders: the LED flickers on and off, then settles once the pin is tied low', () => {
    const t = rig(4.5, 'floating')
    const lit: boolean[] = []
    for (let k = 0; k < 600; k++) {
      t.sim.step(0.05) // 30 s
      if (k % 10 === 0) lit.push((t.sim.live.get(t.led.id)!.i ?? 0) > 0.004)
    }
    expect(lit.some((x) => x)).toBe(true)
    expect(lit.some((x) => !x)).toBe(true)
    expect(t.chip.state.failed).toBe(false) // wandering is harmless, only unreliable
    const tied = rig(4.5, 'minus')
    for (let k = 0; k < 100; k++) tied.sim.step(0.05)
    expect(tied.sim.live.get(tied.led.id)!.i).toBeLessThan(0.0005)
  })

  it('a tied input stays steady', () => {
    const t = rig(4.5, 'plus')
    const seen = new Set<boolean>()
    for (let k = 0; k < 200; k++) {
      t.sim.step(0.05)
      seen.add((t.sim.live.get(t.led.id)!.i ?? 0) > 0.004)
    }
    expect([...seen]).toEqual([true])
  })

  it('an input driven far above the supply burns through its protection diode, with the numbers', () => {
    const t = rig(3, 'nine')
    for (let k = 0; k < 300; k++) t.sim.step(0.016)
    expect(t.chip.state.failed).toBe(true)
    expect(t.chip.state.failMsg).toMatch(/protection diode/)
    expect(t.chip.state.failMsg).toMatch(/pin 1 was driven/)
  })

  it('an input inside the supply does not trouble the diodes', () => {
    const t = rig(4.5, 'plus')
    for (let k = 0; k < 100; k++) t.sim.step(0.016)
    expect(t.chip.state.failed).toBe(false)
  })
})
