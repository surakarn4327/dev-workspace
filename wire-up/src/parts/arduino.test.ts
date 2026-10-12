import { describe, expect, it } from 'vitest'
import { SceneBuilder } from '../lessons/lessons.ts'
import { Simulation } from '../board/simulation.ts'
import { World } from '../board/world.ts'
import { G } from '../board/world.ts'
import { insideRects, leadPins, partObstacles, pathHitsRects } from '../board/obstacles.ts'
import { defOf, isRuntimeState, newPart, pinNamesOf, pinWorld } from './index.ts'
import { padOf, UNO_PINS } from './arduino.ts'

const GND = 3
const V5 = 22
const V33 = 21
const RESET = 20

function scene(usb = true) {
  const w = new World()
  const b = new SceneBuilder(w)
  const uno = b.place('arduino-uno', 400, 100, { usb })
  return { w, b, uno, pins: pinWorld(uno) }
}

function run(sim: Simulation, seconds = 0.2): void {
  for (let i = 0; i < Math.round(seconds / 0.016); i++) sim.step(0.016)
}

function volts(sim: Simulation, part: { id: string }, pin: number): number {
  return sim.result!.v[sim.net.partPins.get(part.id)![pin]]
}

describe('Arduino Uno', () => {
  it('has the 32 header pins in the official order, on whole grid steps, 2 rows 19 grid apart', () => {
    const p = newPart('t', 'arduino-uno', 0, 0)
    const pins = defOf('arduino-uno').pins(p)
    expect(pins.length).toBe(32)
    expect(pinNamesOf(p)).toEqual(UNO_PINS)
    for (const v of pins) {
      expect(Number.isInteger(v.x) && Number.isInteger(v.y)).toBe(true)
      expect(v.y === 1 || v.y === 20).toBe(true)
    }
    const at = (name: string) => pins[UNO_PINS.indexOf(name)]
    expect(at('D13')).toEqual({ x: 11, y: 1 })
    expect(at('D8')).toEqual({ x: 16, y: 1 })
    expect(at('D7')).toEqual({ x: 18, y: 1 })
    expect(at('D0')).toEqual({ x: 25, y: 1 })
    expect(at('5V')).toEqual({ x: 15, y: 20 })
    expect(at('VIN')).toEqual({ x: 18, y: 20 })
    expect(at('A0')).toEqual({ x: 20, y: 20 })
    expect(at('A5')).toEqual({ x: 25, y: 20 })
    expect(padOf(13)).toBe(4)
    expect(padOf(0)).toBe(17)
    expect(padOf(14)).toBe(26)
    expect(padOf(19)).toBe(31)
  })

  it('USB plugged: 5V is 5 V, 3V3 is 3.3 V, the ON lamp is lit; unplugged: all dark', () => {
    const on = scene(true)
    const load = on.b.place('resistor', 800, 100, { value: 1000 })
    on.b.wire(on.pins[V5], pinWorld(load)[0])
    on.b.wire(on.pins[GND], pinWorld(load)[1], '#2f6fe0')
    on.w.commit()
    const sim = new Simulation(on.w)
    run(sim)
    expect(volts(sim, on.uno, V5)).toBeGreaterThan(4.9)
    expect(volts(sim, on.uno, V5)).toBeLessThan(5.01)
    expect(volts(sim, on.uno, V33)).toBeGreaterThan(3.2)
    expect(sim.live.get(on.uno.id)!.pw).toBe(1)
    const off = scene(false)
    const sim2 = new Simulation(off.w)
    run(sim2)
    expect(sim2.live.get(off.uno.id)!.pw).toBe(0)
    expect(sim2.live.get(off.uno.id)!.usb).toBe(0)
  })

  it('the three GND pins are one net', () => {
    const s = scene()
    const load = s.b.place('resistor', 800, 100, { value: 330 })
    s.b.wire(s.pins[V5], pinWorld(load)[0])
    s.b.wire(s.pins[23], pinWorld(load)[1], '#2f6fe0') // the second GND, on the power header
    s.w.commit()
    const sim = new Simulation(s.w)
    run(sim)
    const i = sim.live.get(load.id)!.i
    expect(i).toBeGreaterThan(0.0145)
    expect(Math.abs(volts(sim, s.uno, GND) - volts(sim, s.uno, 24))).toBeLessThan(1e-3)
  })

  it('an output pad gives 5 V behind 25 ohm, low gives 0 V, an input gives nothing', () => {
    const s = scene()
    const load = s.b.place('resistor', 800, 100, { value: 330 })
    s.b.wire(s.pins[padOf(8)], pinWorld(load)[0])
    s.b.wire(s.pins[GND], pinWorld(load)[1], '#2f6fe0')
    s.w.commit()
    const sim = new Simulation(s.w)
    run(sim)
    expect(volts(sim, s.uno, padOf(8))).toBeLessThan(0.05) // an input: the resistor pulls it to 0
    sim.setPad(s.uno.id, padOf(8), 1)
    run(sim)
    // 5 V across 25 + 330 ohm: the pin sits at 5 * 330 / 355 = 4.64 V (the rail sags a little behind its 0.5 ohm)
    expect(volts(sim, s.uno, padOf(8))).toBeGreaterThan(4.5)
    expect(volts(sim, s.uno, padOf(8))).toBeLessThan(4.7)
    sim.setPad(s.uno.id, padOf(8), 0)
    run(sim)
    expect(volts(sim, s.uno, padOf(8))).toBeLessThan(0.05)
  })

  it('a PWM duty puts that share of the supply on the pad (resistive load)', () => {
    const s = scene()
    const load = s.b.place('resistor', 800, 100, { value: 1000 })
    s.b.wire(s.pins[padOf(9)], pinWorld(load)[0])
    s.b.wire(s.pins[GND], pinWorld(load)[1], '#2f6fe0')
    s.w.commit()
    const sim = new Simulation(s.w)
    sim.setPad(s.uno.id, padOf(9), 0.5)
    run(sim)
    const v = volts(sim, s.uno, padOf(9))
    expect(v).toBeGreaterThan(2.3)
    expect(v).toBeLessThan(2.55)
  })

  it('the pull-up is 30 kohm to 5 V', () => {
    const s = scene()
    const load = s.b.place('resistor', 800, 100, { value: 100000 })
    s.b.wire(s.pins[padOf(2)], pinWorld(load)[0])
    s.b.wire(s.pins[GND], pinWorld(load)[1], '#2f6fe0')
    s.w.commit()
    const sim = new Simulation(s.w)
    sim.setPad(s.uno.id, padOf(2), -2)
    run(sim)
    // 5 V divided 30 k : 100 k = 3.85 V
    expect(volts(sim, s.uno, padOf(2))).toBeGreaterThan(3.75)
    expect(volts(sim, s.uno, padOf(2))).toBeLessThan(3.95)
  })

  it('the L lamp on D13 lights when the pin drives high, and the board itself carries that current', () => {
    const s = scene()
    s.w.commit()
    const sim = new Simulation(s.w)
    run(sim)
    expect(sim.live.get(s.uno.id)!.l).toBe(0)
    sim.setPad(s.uno.id, padOf(13), 1)
    run(sim)
    expect(sim.live.get(s.uno.id)!.l).toBe(1)
  })

  it('RESET reads high until the button is held down', () => {
    const s = scene()
    const load = s.b.place('resistor', 800, 100, { value: 100000 })
    s.b.wire(s.pins[RESET], pinWorld(load)[0])
    s.b.wire(s.pins[GND], pinWorld(load)[1], '#2f6fe0')
    s.w.commit()
    const sim = new Simulation(s.w)
    run(sim)
    expect(volts(sim, s.uno, RESET)).toBeGreaterThan(4)
    defOf('arduino-uno').press!(s.uno, true)
    s.w.touch()
    run(sim)
    expect(volts(sim, s.uno, RESET)).toBeLessThan(0.1)
  })

  it('a pin shorted to ground while it drives high burns, with the numbers in the message', () => {
    const s = scene()
    s.b.wire(s.pins[padOf(8)], s.pins[GND], '#2f6fe0')
    s.w.commit()
    const sim = new Simulation(s.w)
    sim.setPad(s.uno.id, padOf(8), 1)
    for (let i = 0; i < 200 && !s.uno.state.failed; i++) sim.step(0.016)
    expect(s.uno.state.failed).toBe(true)
    expect(s.uno.state.failMsg).toContain('D8')
    expect(s.uno.state.failMsg).toContain('40')
  })

  it('5V shorted to GND over-draws the USB port and burns', () => {
    const s = scene()
    s.b.wire(s.pins[V5], s.pins[GND], '#2f6fe0')
    s.w.commit()
    const sim = new Simulation(s.w)
    for (let i = 0; i < 400 && !s.uno.state.failed; i++) sim.step(0.016)
    expect(s.uno.state.failed).toBe(true)
    expect(s.uno.state.failMsg).toContain('5V pin')
    expect(s.uno.state.failMsg).toContain('USB')
  })

  it('a click on the socket (or the plug) flips the USB plug without an undo step; a click on the board does nothing', () => {
    const p = newPart('t', 'arduino-uno', 0, 0)
    const def = defOf('arduino-uno')
    expect(isRuntimeState(p, 'usb')).toBe(true)
    expect(def.clickZone!(p, { x: 20, y: 100 })).toBe(true)
    expect(def.click!(p, { x: 20, y: 100 })).toBe(true)
    expect(p.params.usb).toBe(false)
    expect(def.clickZone!(p, { x: -200, y: 100 })).toBe(false) // the plug is gone: no cable to click
    expect(def.click!(p, { x: -200, y: 100 })).toBe(false)
    expect(def.click!(p, { x: 20, y: 100 })).toBe(true)
    expect(p.params.usb).toBe(true)
    expect(def.clickZone!(p, { x: -200, y: 100 })).toBe(true)
    expect(def.click!(p, { x: 300, y: 250 })).toBe(false)
  })

  it('wires leave the top header up and the bottom header down, 2 grid straight', () => {
    const s = scene()
    s.w.commit()
    const leads = leadPins(s.w)
    expect(leads.length).toBe(32)
    for (const [i, l] of leads.entries()) {
      expect(l.dx).toBe(0)
      expect(l.dy).toBe(i < 18 ? -1 : 1)
      expect(l.len).toBe(2)
    }
  })

  it('no wire may lie over the board, but the column straight out of every pin is open', () => {
    const s = scene()
    s.w.commit()
    const rects = partObstacles(s.w)
    for (const [i, pin] of s.pins.entries()) {
      const out = i < 18 ? -1 : 1
      expect(pathHitsRects([pin, { x: pin.x, y: pin.y + out * 3 * G }], rects), `pin ${UNO_PINS[i]}`).toBe(false)
    }
    const across = [{ x: s.pins[0].x, y: s.pins[0].y + 5 * G }, { x: s.pins[17].x, y: s.pins[0].y + 5 * G }]
    expect(pathHitsRects(across, rects)).toBe(true)
    expect(insideRects({ x: s.uno.x + 100, y: s.uno.y + 200 }, rects)).toBe(true)
  })
})
