import { describe, expect, it } from 'vitest'
import { SceneBuilder } from '../lessons/lessons.ts'
import { Simulation } from '../board/simulation.ts'
import { World } from '../board/world.ts'
import { defOf, newPart, pinNamesOf, pinWorld } from './index.ts'

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
  const no = pins[n + 2]
  const com = pins[n + 3]
  const nc = pins[n + 4]
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
