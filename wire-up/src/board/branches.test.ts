import { describe, expect, it } from 'vitest'
import { carryBranches, branchEndsOf, slideEnd } from './branches.ts'
import { World, wirePath } from './world.ts'

describe('slideEnd', () => {
  it('follows a vertical stretch that moved sideways, keeping its place along it', () => {
    const old = [{ x: 0, y: 0 }, { x: 0, y: 100 }]
    const now = [{ x: -40, y: 0 }, { x: -40, y: 100 }]
    expect(slideEnd({ x: 0, y: 40 }, old, now)).toEqual({ x: -40, y: 40 })
  })

  it('is held inside the stretch when it got shorter', () => {
    const old = [{ x: 0, y: 0 }, { x: 0, y: 100 }]
    const now = [{ x: -20, y: 0 }, { x: -20, y: 60 }]
    expect(slideEnd({ x: 0, y: 80 }, old, now)).toEqual({ x: -20, y: 60 })
  })

  it('picks the stretch of the same direction nearest across', () => {
    const old = [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 80, y: 100 }]
    const now = [{ x: -20, y: 0 }, { x: -20, y: 100 }, { x: 80, y: 100 }]
    expect(slideEnd({ x: 40, y: 100 }, old, now)).toEqual({ x: 40, y: 100 }) // the horizontal stretch did not move
  })
})

describe('carryBranches', () => {
  it('moves a branch end with a reshaped wire, turning a corner when it has to move along its own stretch', () => {
    const w = new World()
    const main = w.addWire({ x: 0, y: 0 }, { x: 0, y: 100 }, '#ff4a4a')
    const side = w.addWire({ x: 60, y: 40 }, { x: 0, y: 40 }, '#2ea043') // comes in sideways
    const along = w.addWire({ x: 0, y: 60 }, { x: 0, y: 90 }, '#2f6fe0') // runs along the main wire itself
    const ends = branchEndsOf(w, main)
    expect(ends.some((e) => e.wire === side.id)).toBe(true)
    main.a = { x: -40, y: 0 }
    main.b = { x: -40, y: 100 }
    carryBranches(w, ends, [{ x: 0, y: 0 }, { x: 0, y: 100 }], [main.a, main.b])
    expect(side.b).toEqual({ x: -40, y: 40 })
    // it lay along the main wire, so its ends move sideways and it turns corners to follow: still in right angles, still on the wire
    expect(along.a.x === -40 && along.b.x === -40).toBe(true)
    expect(wirePath(along).every((p, k, all) => k === 0 || p.x === all[k - 1].x || p.y === all[k - 1].y)).toBe(true)
  })
})
