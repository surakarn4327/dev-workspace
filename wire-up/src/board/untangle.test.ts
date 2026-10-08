import { describe, expect, it } from 'vitest'
import { newPart, pinWorld } from '../parts/index.ts'
import { partObstacles, pathHitsRects } from './obstacles.ts'
import { untangle } from './untangle.ts'
import { World, wirePath } from './world.ts'

describe('untangle', () => {
  it('leaves a wire that runs through a part exactly where it is', () => {
    const w = new World()
    w.parts.push(newPart(w.nextId('p'), 'battery', 200, 100))
    const wire = w.addWire({ x: 100, y: 160 }, { x: 400, y: 160 }, '#ff4a4a')
    const rects = partObstacles(w)
    const before = JSON.stringify(wire)
    expect(pathHitsRects(wirePath(wire), rects)).toBe(true)
    expect(untangle(w)).toBe(0)
    expect(JSON.stringify(wire)).toBe(before)
  })

  it('still re-routes a wire that leaves a battery terminal sideways', () => {
    const w = new World()
    const bat = newPart(w.nextId('p'), 'battery', 200, 200)
    w.parts.push(bat)
    const [pin] = pinWorld(bat)
    const wire = w.addWire(pin, { x: pin.x - 200, y: pin.y }, '#ff4a4a') // straight out to the left
    expect(untangle(w)).toBe(1)
    expect(wirePath(wire)[1].y).toBeLessThan(pin.y) // now steps up first
  })

  it('leaves a clear wire exactly as it is', () => {
    const w = new World()
    w.parts.push(newPart(w.nextId('p'), 'battery', 200, 100))
    const wire = w.addWire({ x: 100, y: 20 }, { x: 400, y: 20 }, '#ff4a4a')
    const before = JSON.stringify(wire)
    expect(untangle(w)).toBe(0)
    expect(JSON.stringify(wire)).toBe(before)
  })

  it('does not touch a wire another wire branches off', () => {
    const w = new World()
    w.parts.push(newPart(w.nextId('p'), 'battery', 200, 100))
    const main = w.addWire({ x: 100, y: 160 }, { x: 400, y: 160 }, '#ff4a4a')
    w.addWire({ x: 140, y: 160 }, { x: 140, y: 240 }, '#2f6fe0') // rests on main
    const before = JSON.stringify(main)
    expect(untangle(w)).toBe(0)
    expect(JSON.stringify(main)).toBe(before)
  })
})
