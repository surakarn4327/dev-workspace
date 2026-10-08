import { describe, expect, it } from 'vitest'
import { newPart, pinWorld } from '../parts/index.ts'
import { World } from './world.ts'

describe('isolated parts', () => {
  it('are not joined to a wire end their pin sits on', async () => {
    const { buildNetlist } = await import('./connectivity.ts')
    const w = new World()
    const r = newPart(w.nextId('p'), 'resistor', 200, 200)
    w.parts.push(r)
    const [pin] = pinWorld(r)
    const wire = w.addWire({ x: pin.x, y: pin.y - 100 }, pin, '#ff4a4a')
    const joined = buildNetlist(w)
    expect(joined.nodeAt(wire.a)).toBe(joined.partPins.get(r.id)![0])
    w.isolated.set(r.id, 'g1')
    const cut = buildNetlist(w)
    expect(cut.nodeAt(wire.a)).not.toBe(cut.partPins.get(r.id)![0])
  })
})

describe('dragging an isolated part', () => {
  it('leaves the wire end on its pin where it is', async () => {
    const { planFollow, applyFollow } = await import('./follow.ts')
    const w = new World()
    const r = newPart(w.nextId('p'), 'resistor', 200, 200)
    w.parts.push(r)
    const [pin] = pinWorld(r)
    const wire = w.addWire({ x: pin.x, y: pin.y - 100 }, pin, '#ff4a4a')
    w.isolated.set(r.id, 'g1')
    const plan = planFollow(w, r)
    r.x += 60
    applyFollow(w, plan, 60, 0)
    expect(wire.b).toEqual(pin)
  })
})
