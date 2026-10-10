import { describe, expect, it } from 'vitest'
import { SceneBuilder } from '../lessons/lessons.ts'
import { Simulation } from '../board/simulation.ts'
import { World } from '../board/world.ts'
import { defOf, newPart, pinNamesOf, pinWorld } from './index.ts'
import { leadPins } from '../board/obstacles.ts'
import { routeVia } from '../board/router.ts'
import { G } from '../board/world.ts'

/**
 * A relay module on 5 V: the load battery (9 V) feeds the NO load and the NC load of channel 1 through COM. `drive` is the
 * voltage put on IN1 by a bench supply (its minus on GND), or null to leave IN1 unwired.
 */
function circuit(drive: number | null, trigger: 'low' | 'high', channels = 1) {
  const w = new World()
  const b = new SceneBuilder(w)
  const mod = b.place('relay-module', 400, 100, { channels, trigger })
  const sup = b.place('battery', 0, 0, { volts: 5 })
  const loadBat = b.place('battery', 0, 300, { volts: 9 })
  const rNo = b.place('resistor', 800, 0, { value: 1000 })
  const rNc = b.place('resistor', 800, 200, { value: 1000 })
  const pins = pinWorld(mod)
  const n = channels
  const gnd = pins[0]
  const in1 = pins[1]
  const vcc = pins[n + 1]
  const nc = pins[n + 2]
  const com = pins[n + 3]
  const no = pins[n + 4]
  const [sp, sm] = pinWorld(sup)
  const [lp, lm] = pinWorld(loadBat)
  const [n0, n1] = pinWorld(rNo)
  const [m0, m1] = pinWorld(rNc)
  b.wire(sp, vcc)
  b.wire(sm, gnd, '#2f6fe0')
  b.wire(lp, com)
  b.wire(no, n0)
  b.wire(n1, lm, '#2f6fe0')
  b.wire(nc, m0)
  b.wire(m1, lm, '#2f6fe0')
  let driver: ReturnType<typeof b.place> | null = null
  if (drive !== null) {
    driver = b.place('supply', 0, 600, { volts: drive, limit: 0.5 })
    const [dp, dm] = pinWorld(driver)
    b.wire(dp, in1)
    b.wire(dm, gnd, '#2f6fe0')
  }
  w.commit()
  const sim = new Simulation(w)
  return { sim, mod, noNode: () => sim.net.partPins.get(rNo.id)![0], ncNode: () => sim.net.partPins.get(rNc.id)![0] }
}

function run(sim: Simulation, seconds = 0.3): void {
  for (let i = 0; i < Math.round(seconds / 0.016); i++) sim.step(0.016)
}

describe('relay module', () => {
  it('LOW trigger: IN pulled to GND pulls the relay in, COM goes to NO', () => {
    const s = circuit(0, 'low')
    run(s.sim)
    const v = s.sim.result!.v
    expect(v[s.noNode()]).toBeGreaterThan(8.5)
    expect(v[s.ncNode()]).toBeLessThan(0.5)
    expect(s.sim.live.get(s.mod.id)!.on0).toBe(1)
  })

  it('LOW trigger: IN left open (or high) keeps COM on NC', () => {
    for (const drive of [null, 5]) {
      const s = circuit(drive, 'low')
      run(s.sim)
      const v = s.sim.result!.v
      expect(v[s.ncNode()]).toBeGreaterThan(8.5)
      expect(v[s.noNode()]).toBeLessThan(0.5)
    }
  })

  it('HIGH trigger: IN driven high pulls it in, IN at 0 V does not', () => {
    const on = circuit(5, 'high')
    run(on.sim)
    expect(on.sim.result!.v[on.noNode()]).toBeGreaterThan(8.5)
    const off = circuit(0, 'high')
    run(off.sim)
    expect(off.sim.result!.v[off.ncNode()]).toBeGreaterThan(8.5)
  })

  it('has 2 + 4 n pins named for the channels, and the pins stay inside the box', () => {
    for (const n of [1, 2, 4, 8]) {
      const p = newPart('t', 'relay-module', 0, 0)
      p.params.channels = n
      const def = defOf('relay-module')
      const pins = def.pins(p)
      expect(pins.length).toBe(2 + 4 * n)
      expect(pinNamesOf(p).length).toBe(pins.length)
      const b = def.bounds(p)
      for (const v of pins) {
        expect(v.x * 20).toBeGreaterThanOrEqual(b.x)
        expect(v.x * 20).toBeLessThanOrEqual(b.x + b.w)
        expect(v.y * 20).toBeLessThanOrEqual(b.y + b.h)
      }
      expect(pinNamesOf(p).slice(n + 2, n + 5)).toEqual(n === 1 ? ['NC', 'COM', 'NO'] : ['NC1', 'COM1', 'NO1'])
    }
  })

  it('burns when the supply goes over twice the coil rating', () => {
    const w = new World()
    const b = new SceneBuilder(w)
    const mod = b.place('relay-module', 400, 100, { channels: 1, trigger: 'low' })
    const supply = b.place('supply', 0, 0, { volts: 15, limit: 1 })
    const pins = pinWorld(mod)
    const [sp, sm] = pinWorld(supply)
    b.wire(sp, pins[2])
    b.wire(sm, pins[0], '#2f6fe0')
    w.commit()
    const sim = new Simulation(w)
    sim.step(0.016)
    const stress = sim.stress.get(mod.id)!
    expect(stress.ratio).toBeGreaterThan(1)
    expect(stress.reason()).toContain('burn out above')
  })
})

describe('relay module, whole board', () => {
  it('every pin is on its own grid point, for every channel count', () => {
    for (const n of [1, 2, 4, 8]) {
      const p = newPart('t', 'relay-module', 0, 0)
      p.params.channels = n
      const pins = defOf('relay-module').pins(p)
      const keys = new Set(pins.map((v) => `${v.x},${v.y}`))
      expect(keys.size, `${n} channels`).toBe(pins.length)
      for (const v of pins) {
        expect(Number.isInteger(v.x) && Number.isInteger(v.y)).toBe(true)
      }
      // the header (GND, IN1..INn, VCC) sits in one row, the screw terminals in another
      const names = pinNamesOf(p)
      expect(names[0]).toBe('GND')
      expect(names[n + 1]).toBe('VCC')
      expect(new Set(pins.slice(0, n + 2).map((v) => v.y)).size).toBe(1)
      expect(new Set(pins.slice(n + 2).map((v) => v.y)).size).toBe(1)
    }
  })

  it('each channel of a four channel board switches on its own input', () => {
    const w = new World()
    const b = new SceneBuilder(w)
    const mod = b.place('relay-module', 400, 100, { channels: 4, trigger: 'low' })
    const sup = b.place('battery', 0, 0, { volts: 5 })
    const pins = pinWorld(mod)
    const [sp, sm] = pinWorld(sup)
    const n = 4
    b.wire(sp, pins[n + 1])
    b.wire(sm, pins[0], '#2f6fe0')
    b.wire(pins[2], pins[0], '#2ea043') // IN2 to GND: channel 2 only
    w.commit()
    const sim = new Simulation(w)
    run(sim, 0.3)
    const live = sim.live.get(mod.id)!
    expect([live.on0, live.on1, live.on2, live.on3]).toEqual([0, 1, 0, 0])
    expect(live.on).toBe(1)
  })


  /** A module on a 5 V battery with only the wires named: vcc, gnd, and IN1 tied to GND. */
  function powered(wires: { vcc: boolean; gnd: boolean; in1ToGnd?: boolean }, channels = 1) {
    const w = new World()
    const b = new SceneBuilder(w)
    const mod = b.place('relay-module', 400, 100, { channels, trigger: 'low' })
    const sup = b.place('battery', 0, 0, { volts: 5 })
    const pins = pinWorld(mod)
    const [sp, sm] = pinWorld(sup)
    if (wires.vcc) b.wire(sp, pins[channels + 1])
    if (wires.gnd) b.wire(sm, pins[0], '#2f6fe0')
    if (wires.in1ToGnd) b.wire(pins[1], pins[0], '#2ea043')
    w.commit()
    const sim = new Simulation(w)
    run(sim, 0.3)
    return { sim, live: sim.live.get(mod.id)!, supplyA: Math.abs(sim.live.get(sup.id)?.i ?? 0) }
  }

  it('green power LED needs both VCC and GND, and the board then draws current', () => {
    const none = powered({ vcc: false, gnd: false })
    const vccOnly = powered({ vcc: true, gnd: false })
    const gndOnly = powered({ vcc: false, gnd: true })
    const both = powered({ vcc: true, gnd: true })
    for (const s of [none, vccOnly, gndOnly]) {
      expect(s.live.pw).toBe(0)
      expect(s.supplyA).toBeLessThan(1e-6)
    }
    expect(both.live.pw).toBe(1)
    expect(both.supplyA).toBeGreaterThan(0.003) // the power LED branch: 5 V over 1.2 k
    expect(both.live.on).toBe(0)
  })

  it('pulling in a relay adds the coil current on top of the power LED', () => {
    const idle = powered({ vcc: true, gnd: true })
    const on = powered({ vcc: true, gnd: true, in1ToGnd: true })
    expect(on.live.on).toBe(1)
    expect(on.supplyA).toBeGreaterThan(idle.supplyA + 0.05)
  })

  it('every channel of a multi channel board shares one power LED state with the supply', () => {
    for (const n of [2, 4, 8]) {
      expect(powered({ vcc: true, gnd: false }, n).live.pw).toBe(0)
      expect(powered({ vcc: true, gnd: true }, n).live.pw).toBe(1)
    }
  })

  it('wires enter the screw terminals from the front (3 grid straight) and the header from the printed side (2 grid straight)', () => {
    for (const n of [1, 2]) {
      const w = new World()
      const b = new SceneBuilder(w)
      const mod = b.place('relay-module', 400, 100, { channels: n, trigger: 'low' })
      const pins = pinWorld(mod)
      const leads = leadPins(w)
      const terminals = pins.slice(n + 2)
      const header = pins.slice(0, n + 2)
      for (const t of terminals) {
        const l = leads.find((d) => d.x === t.x && d.y === t.y)!
        expect([l.dx, l.dy, l.len]).toEqual([0, -1, 3])
        // a target far to the lower right: the first bend may not come before 3 grid units
        const via = routeVia(t, { x: t.x + 400, y: t.y + 300 }, [], [], leads)
        expect(via[0].x).toBe(t.x)
        expect(t.y - via[0].y).toBeGreaterThanOrEqual(3 * G)
      }
      for (const h of header) {
        const l = leads.find((d) => d.x === h.x && d.y === h.y)!
        expect([l.dx, l.dy, l.len]).toEqual([0, 1, 2])
        const via = routeVia(h, { x: h.x + 400, y: h.y - 300 }, [], [], leads)
        expect(via[0].x).toBe(h.x)
        expect(via[0].y - h.y).toBeGreaterThanOrEqual(2 * G)
      }
    }
  })

  it('the sprite and the hit box agree on the width', () => {
    for (const n of [1, 2, 4, 8]) {
      const p = newPart('t', 'relay-module', 0, 0)
      p.params.channels = n
      expect(defOf('relay-module').bounds(p).w).toBe((60 * n + 20) * 2)
    }
  })
})
