import { describe, expect, it } from 'vitest'
import { Simulation } from '../board/simulation.ts'
import { World } from '../board/world.ts'
import { SceneBuilder } from '../lessons/lessons.ts'
import { buildBench } from './bench.ts'

describe('test circuit for the frame meter', () => {
  it('makes about the asked number of parts and every LED lights without burning anything', () => {
    const w = new World()
    const made = buildBench(new SceneBuilder(w), 100)
    expect(made).toBe(w.parts.length)
    expect(made).toBeGreaterThan(90)
    expect(made).toBeLessThan(110)
    const sim = new Simulation(w)
    sim.step(0.016)
    expect(sim.result?.converged).toBe(true)
    const leds = w.parts.filter((p) => p.type === 'led')
    expect(leds.length).toBeGreaterThan(40)
    for (const led of leds) {
      expect(led.state.failed).toBe(false)
      expect(sim.live.get(led.id)?.i ?? 0).toBeGreaterThan(0.001)
    }
    expect(w.parts.every((p) => !p.state.failed && p.state.heat < 0.02)).toBe(true)
  })
})
