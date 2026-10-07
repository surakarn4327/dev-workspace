// Builds the intended solution of every mission and checks that its steps tick in the real simulation.

import { describe, expect, it } from 'vitest'
import { Simulation } from '../board/simulation.ts'
import { World } from '../board/world.ts'
import type { PartInstance } from '../board/world.ts'
import { LESSONS, makeCtx, SceneBuilder } from './lessons.ts'

function start(id: string) {
  const lesson = LESSONS.find((l) => l.id === id)!
  const world = new World()
  const b = new SceneBuilder(world)
  lesson.setup(b)
  const sim = new Simulation(world)
  const memo: Record<string, number | boolean> = {}
  const run = (seconds = 0.3) => {
    for (let t = 0; t < seconds; t += 0.016) sim.step(0.016)
  }
  const results = (): boolean[] => {
    const ctx = makeCtx(world, sim, memo)
    return lesson.steps.map((s) => s.check(ctx))
  }
  const get = (type: string, n = 0): PartInstance => world.parts.filter((p) => p.type === type)[n]
  return { lesson, world, b, sim, run, results, get, memo }
}

describe('missions can be completed', () => {
  it('1. first light', () => {
    const s = start('first-light')
    expect(s.results()).toEqual([false, false, false])
    s.b.place('resistor', s.b.hole(5, 6).x, s.b.hole(5, 6).y, { value: 330, spread: 4 })
    s.b.place('led', s.b.hole(9, 5).x, s.b.hole(9, 5).y, { color: 'red' })
    s.run()
    expect(s.results()).toEqual([true, true, false])
    s.b.connect(s.get('battery'), s.b.hole(5, 4), s.b.hole(10, 4))
    s.world.commit()
    s.run()
    expect(s.results()).toEqual([true, true, true])
  })

  it('2. smoke test', () => {
    const s = start('too-much')
    const led = s.get('led')
    led.x = s.b.hole(7, 5).x
    led.y = s.b.hole(7, 5).y
    s.b.connect(s.get('battery'), s.b.hole(7, 4), s.b.hole(8, 4))
    s.world.commit()
    s.run(1.5)
    expect(led.state.failed).toBe(true)
    expect(s.results()[0]).toBe(true)
    s.sim.replace(led.id)
    s.b.connect(s.get('battery'), s.b.hole(3, 4), s.b.hole(8, 4))
    s.b.place('resistor', s.b.hole(3, 6).x, s.b.hole(3, 6).y, { value: 470, spread: 4 })
    s.world.commit()
    s.run()
    // step 1 stays ticked in the app (steps latch); only 2 and 3 are re-evaluated here
    expect(s.results().slice(1)).toEqual([true, true])
  })

  it('3. pick the resistor', () => {
    const s = start('pick-resistor')
    const led = s.get('led')
    const r = s.get('resistor')
    r.x = s.b.hole(3, 6).x
    r.y = s.b.hole(3, 6).y
    r.params.value = 1000
    led.x = s.b.hole(7, 5).x
    led.y = s.b.hole(7, 5).y
    s.b.connect(s.get('battery'), s.b.hole(3, 4), s.b.hole(8, 4))
    s.world.commit()
    s.run()
    expect(s.results()[0]).toBe(true)
    expect(s.results()[1]).toBe(false) // 1k: about 7 mA
    r.params.value = 680
    s.world.commit()
    s.run()
    expect(s.results()).toEqual([true, true, true])
  })

  it('4. switch it', () => {
    const s = start('switch-it')
    const sw = s.get('switch')
    sw.x = s.b.hole(3, 6).x
    sw.y = s.b.hole(3, 6).y
    sw.params.on = true
    const r = s.get('resistor')
    r.x = s.b.hole(5, 5).x
    r.y = s.b.hole(5, 5).y
    const led = s.get('led')
    led.x = s.b.hole(9, 6).x
    led.y = s.b.hole(9, 6).y
    s.b.connect(s.get('battery'), s.b.hole(3, 4), s.b.hole(10, 4))
    s.world.commit()
    s.run()
    expect(s.results()).toEqual([true, false])
    sw.params.on = false
    s.world.commit()
    s.run()
    expect(s.results()[1]).toBe(true)
  })

  it('5. voltage divider', () => {
    const s = start('divider')
    const [r1, r2] = [s.get('resistor', 0), s.get('resistor', 1)]
    r1.x = s.b.hole(3, 6).x
    r1.y = s.b.hole(3, 6).y
    r2.x = s.b.hole(7, 5).x
    r2.y = s.b.hole(7, 5).y
    r2.params.legs = 2
    r1.params.legs = 2
    s.b.connect(s.get('battery'), s.b.hole(3, 4), s.b.hole(11, 4))
    s.get('meter').leads = [s.b.hole(7, 4), s.b.hole(11, 3)]
    s.world.commit()
    s.run()
    expect(s.results()).toEqual([true, true, true])
  })

  it('6. current in series', () => {
    const s = start('ammeter')
    s.b.connect(s.get('battery'), s.b.hole(5, 5), s.b.hole(15, 1))
    s.world.commit()
    s.run()
    expect(s.results()).toEqual([true, false])
    // remove the jumper and put the meter in its place
    s.world.wires = s.world.wires.filter((w) => w.color !== '#f2d21b')
    s.get('meter').leads = [s.b.hole(9, 5), s.b.hole(10, 5)]
    s.world.commit()
    s.run()
    expect(s.get('meter').state.failed).toBe(false)
    expect(s.results()).toEqual([true, true])
  })

  it('6b. the ammeter across the battery blows the fuse (the trap in the story)', () => {
    const s = start('ammeter')
    s.get('meter').leads = [s.b.hole(1, 0), s.b.hole(1, 1)]
    s.b.connect(s.get('battery'), s.b.hole(2, 0), s.b.hole(2, 1))
    s.world.commit()
    s.run(0.5)
    expect(s.get('meter').state.failed).toBe(true)
  })

  it('7. transistor switch', () => {
    const s = start('transistor')
    const q = s.get('bc547')
    q.x = s.b.hole(10, 6).x
    q.y = s.b.hole(10, 6).y
    const led = s.get('led')
    led.x = s.b.hole(9, 5).x
    led.y = s.b.hole(9, 5).y
    s.b.place('resistor', s.b.hole(6, 4).x, s.b.hole(6, 4).y, { value: 470, spread: 3 })
    s.b.wire(s.b.hole(6, 3), s.b.hole(6, 0))
    s.b.wire(s.b.hole(12, 5), s.b.hole(12, 1))
    s.b.place('resistor', s.b.hole(11, 5).x, s.b.hole(11, 5).y, { value: 10000, spread: 4 })
    const btn = s.get('button')
    btn.x = s.b.hole(15, 3).x
    btn.y = s.b.hole(15, 3).y
    s.b.wire(s.b.hole(18, 4), s.b.hole(18, 0))
    s.b.connect(s.get('battery'), s.b.hole(1, 0), s.b.hole(1, 1))
    s.world.commit()
    s.run()
    const r = s.results()
    expect(r.slice(0, 2)).toEqual([true, true])
    expect(r[2]).toBe(false) // button not pressed: LED off
    btn.params.pressed = true
    s.world.touch()
    s.run()
    expect(s.results()).toEqual([true, true, true])
  })

  it('8. light sensor', () => {
    const s = start('light-sensor')
    const ldr = s.get('ldr')
    ldr.x = s.b.hole(3, 6).x
    ldr.y = s.b.hole(3, 6).y
    ldr.params.lux = 5
    const r = s.get('resistor')
    r.x = s.b.hole(5, 5).x
    r.y = s.b.hole(5, 5).y
    s.b.connect(s.get('battery'), s.b.hole(3, 4), s.b.hole(9, 4))
    s.get('meter').leads = [s.b.hole(5, 4), s.b.hole(9, 3)]
    s.world.commit()
    s.run()
    expect(s.results()).toEqual([true, true, false])
    ldr.params.lux = 5000
    s.world.commit()
    s.run()
    expect(s.results()).toEqual([true, true, true])
  })

  it('9. one-way street', () => {
    const s = start('diode')
    const r = s.get('resistor')
    r.x = s.b.hole(3, 6).x
    r.y = s.b.hole(3, 6).y
    const led = s.get('led')
    led.x = s.b.hole(7, 5).x
    led.y = s.b.hole(7, 5).y
    const d = s.get('diode')
    d.x = s.b.hole(8, 6).x
    d.y = s.b.hole(8, 6).y
    s.b.connect(s.get('battery'), s.b.hole(3, 4), s.b.hole(12, 4))
    s.world.commit()
    s.run()
    expect(s.results()).toEqual([true, false])
    d.rot = 2
    d.x = s.b.hole(12, 6).x
    s.world.commit()
    s.run()
    expect(s.results()[1]).toBe(true)
  })
})
