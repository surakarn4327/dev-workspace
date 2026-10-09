import { describe, expect, it } from 'vitest'
import { SceneBuilder } from '../lessons/lessons.ts'
import { pinWorld } from '../parts/index.ts'
import { Simulation } from './simulation.ts'
import { World } from './world.ts'

// A display with one segment pin fed and its common pin left open used to leave the solver spinning (2800 rounds, no answer, a stuttering game).
describe('seven-segment display with an unwired common', () => {
  for (const type of ['seg7', 'seg7x4']) {
    for (const pinIdx of [0, 3, 6]) {
      it(`${type}: battery + through switch and resistor into pin ${pinIdx + 1}, battery - open`, () => {
        const w = new World()
        const b = new SceneBuilder(w)
        const bat = b.place('battery-4.5', -320, 80, {})
        const sw = b.place('switch', 0, 0, {})
        const r = b.place('resistor', 0, 100, { value: 330, legs: 2 })
        const disp = b.place(type, 300, 100, {})
        b.wire(pinWorld(bat)[0], pinWorld(sw)[0])
        b.wire(pinWorld(sw)[1], pinWorld(r)[0])
        b.wire(pinWorld(r)[1], pinWorld(disp)[pinIdx])
        const sim = new Simulation(w)
        const t0 = performance.now()
        for (let k = 0; k < 10; k++) sim.step(0.016)
        const ms = (performance.now() - t0) / 10
        expect(ms).toBeLessThan(10)
        expect(sim.result?.iterations).toBeLessThan(60)
        expect(sim.result?.converged).toBe(true)
      })
    }
  }
})
