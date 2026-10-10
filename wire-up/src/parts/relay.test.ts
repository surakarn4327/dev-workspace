import { describe, expect, it } from 'vitest'
import { SceneBuilder } from '../lessons/lessons.ts'
import { Simulation } from '../board/simulation.ts'
import { World } from '../board/world.ts'
import { pinWorld } from './index.ts'

/** A battery drives the coil through a switch-free path of `coilVolts`; a second battery lights a resistor through COM-NO and another through COM-NC. */
function circuit(coilVolts: number): { sim: Simulation; relayId: string; noNode: () => number; ncNode: () => number } {
  const w = new World()
  const b = new SceneBuilder(w)
  const coilBat = b.place('battery', 0, 0, { volts: coilVolts })
  const loadBat = b.place('battery', 0, 300, { volts: 9 })
  const relay = b.place('relay-5v', 300, 100)
  const rNo = b.place('resistor', 600, 0, { value: 1000 })
  const rNc = b.place('resistor', 600, 200, { value: 1000 })
  const [cp, cm] = pinWorld(coilBat)
  const [lp, lm] = pinWorld(loadBat)
  const [c1, c2, com, nc, no] = pinWorld(relay)
  const [n0, n1] = pinWorld(rNo)
  const [m0, m1] = pinWorld(rNc)
  b.wire(cp, c1)
  b.wire(cm, c2, '#2f6fe0')
  b.wire(lp, com)
  b.wire(no, n0)
  b.wire(n1, lm, '#2f6fe0')
  b.wire(nc, m0)
  b.wire(m1, lm, '#2f6fe0')
  w.commit()
  const sim = new Simulation(w)
  return { sim, relayId: relay.id, noNode: () => sim.net.partPins.get(rNo.id)![0], ncNode: () => sim.net.partPins.get(rNc.id)![0] }
}

function run(sim: Simulation, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / 0.016); i++) sim.step(0.016)
}

describe('5 V relay', () => {
  it('pulls in on 5 V and sends COM to NO', () => {
    const s = circuit(4.5)
    run(s.sim, 0.2)
    const v = s.sim.result!.v
    expect(v[s.noNode()]).toBeGreaterThan(8.5) // 9 V reaches the NO load
    expect(v[s.ncNode()]).toBeLessThan(0.5)
    expect(s.sim.live.get(s.relayId)!.on).toBe(1)
  })

  it('stays on NC under the pull-in voltage (3.75 V)', () => {
    const s = circuit(3)
    run(s.sim, 0.2)
    const v = s.sim.result!.v
    expect(v[s.ncNode()]).toBeGreaterThan(8.5)
    expect(v[s.noNode()]).toBeLessThan(0.5)
  })

  it('burns when the coil gets over twice its rating, and says why in numbers', () => {
    const w = new World()
    const b = new SceneBuilder(w)
    const supply = b.place('supply', 0, 0, { volts: 15, limit: 1 })
    const relay = b.place('relay-5v', 300, 100)
    const [sp, sm] = pinWorld(supply)
    const [c1, c2] = pinWorld(relay)
    b.wire(sp, c1)
    b.wire(sm, c2, '#2f6fe0')
    w.commit()
    const sim = new Simulation(w)
    sim.step(0.016)
    const stress = sim.stress.get(relay.id)!
    expect(stress.ratio).toBeGreaterThan(1)
    expect(stress.reason()).toContain('coil')
  })
})
