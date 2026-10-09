import { describe, expect, it } from 'vitest'
import { newPart } from '../parts/index.ts'
import { applyFollow, planGroup } from './follow.ts'
import { copyOut, itemsInBox, partBox, pasteIn } from './group.ts'
import { G, World } from './world.ts'

function setup(): { w: World; r1: string; r2: string; wire: string } {
  const w = new World()
  const r1 = newPart(w.nextId('p'), 'resistor', 100, 100)
  const r2 = newPart(w.nextId('p'), 'resistor', 400, 300)
  w.parts.push(r1, r2)
  const wire = w.addWire({ x: 100, y: 200 }, { x: 160, y: 200 }, '#ff4a4a')
  return { w, r1: r1.id, r2: r2.id, wire: wire.id }
}

describe('box selection', () => {
  it('takes only what lies fully inside the box', () => {
    const { w, r1, wire } = setup()
    const b = partBox(w.getPart(r1)!)
    const found = itemsInBox(w, { x0: b.x0 - 10, y0: b.y0 - 10, x1: 300, y1: 260 })
    expect([...found.parts]).toEqual([r1])
    expect([...found.wires]).toEqual([wire])
    // a box that only touches the part's corner takes nothing
    const half = itemsInBox(w, { x0: b.x0 - 10, y0: b.y0 - 10, x1: b.x0 + 4, y1: b.y0 + 4 })
    expect(half.parts.size).toBe(0)
  })
})

describe('group move', () => {
  it('moves selected parts and wires together', () => {
    const { w, r1, r2, wire } = setup()
    const before = { x: w.getPart(r1)!.x, y: w.getPart(r1)!.y }
    const plan = planGroup(w, new Set([r1, r2]), new Set([wire]))
    applyFollow(w, plan, 2 * G, G)
    expect(w.getPart(r1)!.x).toBe(before.x + 2 * G)
    expect(w.getPart(r1)!.y).toBe(before.y + G)
    expect(w.getPart(r2)!.x).toBe(400 + 2 * G)
    expect(w.getWire(wire)!.a).toEqual({ x: 100 + 2 * G, y: 200 + G })
    expect(w.getWire(wire)!.b).toEqual({ x: 160 + 2 * G, y: 200 + G })
  })

  it('stretches an unselected wire plugged into a moved part', () => {
    const { w, r1, wire } = setup()
    const pin = w.getPart(r1)!
    const w2 = w.addWire({ x: pin.x, y: pin.y }, { x: pin.x, y: pin.y - 60 }, '#2f6fe0')
    const plan = planGroup(w, new Set([r1]), new Set())
    applyFollow(w, plan, 0, G)
    expect(w.getWire(w2.id)!.a.y).toBe(pin.y) // end stays on the pin of the moved part
    expect(w.getWire(wire)).toBeDefined()
  })

  it('carries an unselected branch resting on a selected wire', () => {
    const w = new World()
    const main = w.addWire({ x: 100, y: 200 }, { x: 160, y: 200 }, '#ff4a4a')
    const branch = w.addWire({ x: 120, y: 200 }, { x: 120, y: 140 }, '#2f6fe0')
    const plan = planGroup(w, new Set(), new Set([main.id]))
    applyFollow(w, plan, 2 * G, G)
    const m = w.getWire(main.id)!
    const b = w.getWire(branch.id)!
    expect(b.a).toEqual({ x: 120 + 2 * G, y: 200 + G }) // end slid along with the main wire
    expect(b.b).toEqual({ x: 120, y: 140 }) // far end stays put
    expect(m.a.y).toBe(200 + G)
  })
})

describe('copy and paste', () => {
  it('makes new ids, keeps the originals, and shifts the copy', () => {
    const { w, r1, wire } = setup()
    const clip = copyOut(w, new Set([r1]), new Set([wire]))
    const made = pasteIn(w, clip, 40, 40)
    expect(w.parts).toHaveLength(3)
    expect(w.wires).toHaveLength(2)
    expect(made.parts.has(r1)).toBe(false)
    const copy = w.getPart([...made.parts][0])!
    expect(copy.x).toBe(w.getPart(r1)!.x + 40)
    expect(copy.state.failed).toBe(false)
    const wcopy = w.getWire([...made.wires][0])!
    expect(wcopy.a).toEqual({ x: 140, y: 240 })
  })

  it('pastes a breadboard under everything else', () => {
    const w = new World()
    const r = newPart(w.nextId('p'), 'resistor', 0, 0)
    const board = newPart(w.nextId('p'), 'breadboard', 200, 0)
    w.parts.push(board, r)
    const clip = copyOut(w, new Set([r.id, board.id]), new Set())
    pasteIn(w, clip, 40, 40)
    expect(w.parts[0].type.startsWith('breadboard')).toBe(true)
  })
})
