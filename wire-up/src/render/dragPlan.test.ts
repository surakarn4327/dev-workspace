import { describe, expect, it } from 'vitest'
import { MAX_LIVE, closeVals, sameSigs, shiftOf, splitOf } from './dragPlan.ts'
import type { Sigs, Snap } from './dragPlan.ts'

/** A board of items; each has a look, a position and some readings. */
function board(items: Record<string, { look?: string; at: [number, number]; vals?: number[] }>): Sigs {
  const look = new Map<string, string>()
  const pos = new Map<string, [number, number]>()
  const vals = new Map<string, number[]>()
  for (const [id, it] of Object.entries(items)) {
    look.set(id, it.look ?? 'same')
    pos.set(id, it.at)
    if (it.vals) vals.set(id, it.vals)
  }
  return { look, pos, vals }
}

function snapOf(sigs: Sigs, moving: string[] = [], live: string[] = []): Snap {
  return { look: sigs.look, pos: new Map(sigs.pos), vals: sigs.vals, moving: new Set(moving), live: new Set(live), base: 'b', zoom: 1 }
}

describe('readings', () => {
  it('count as the same when they differ only by solver noise', () => {
    expect(closeVals([0.02124580792958827], [0.02124580792958963])).toBe(true)
    expect(closeVals([8.98e-12], [-2e-13])).toBe(true)
    expect(closeVals([0.02], [0.03])).toBe(false)
    expect(closeVals([1, 2], [1])).toBe(false)
    expect(closeVals(undefined, [1])).toBe(false)
  })
})

describe('what a frame of a drag needs', () => {
  const still = board({ a: { at: [0, 0] }, b: { at: [20, 0] }, c: { at: [40, 0] }, led: { at: [60, 0], vals: [0.02] } })

  it('a quiet board has nothing to shift', () => {
    expect(shiftOf(still, snapOf(still))).toEqual({ dx: 0, dy: 0 })
    expect(sameSigs(still, board({ a: { at: [0, 0] }, b: { at: [20, 0] }, c: { at: [40, 0] }, led: { at: [60, 0], vals: [0.02000001] } }))).toBe(true)
  })

  it('splits the things that moved the same way from those that changed shape or reading', () => {
    // a and b are dragged by (20, 0); the wire c stretches (its look changes); the LED lights up
    const now = board({ a: { at: [20, 0] }, b: { at: [40, 0] }, c: { look: 'longer', at: [40, 0] }, led: { at: [60, 0], vals: [0.2] } })
    const plan = splitOf(now, snapOf(still))!
    expect([...plan.moving].sort()).toEqual(['a', 'b'])
    expect([...plan.live].sort()).toEqual(['c', 'led'])
  })

  it('shows the same frame again from the layers once the dragged things are in them', () => {
    const first = board({ a: { at: [20, 0] }, b: { at: [40, 0] }, c: { look: 'longer', at: [40, 0] }, led: { at: [60, 0], vals: [0.02] } })
    const plan = splitOf(first, snapOf(still))!
    const snap = snapOf(first, [...plan.moving], [...plan.live])
    // two steps further on: a and b by 40 more, c keeps changing, the rest still
    const later = board({ a: { at: [60, 0] }, b: { at: [80, 0] }, c: { look: 'longest', at: [80, 0] }, led: { at: [60, 0], vals: [0.02] } })
    expect(shiftOf(later, snap)).toEqual({ dx: 40, dy: 0 })
  })

  it('refuses a frame the layers cannot show', () => {
    const first = board({ a: { at: [20, 0] }, b: { at: [40, 0] }, c: { at: [40, 0] }, led: { at: [60, 0], vals: [0.02] } })
    const snap = snapOf(first, ['a', 'b'])
    // one of the dragged things went a different way
    expect(shiftOf(board({ a: { at: [40, 0] }, b: { at: [40, 0] }, c: { at: [40, 0] }, led: { at: [60, 0], vals: [0.02] } }), snap)).toBeNull()
    // a dragged thing changed its look
    expect(shiftOf(board({ a: { look: 'other', at: [20, 0] }, b: { at: [40, 0] }, c: { at: [40, 0] }, led: { at: [60, 0], vals: [0.02] } }), snap)).toBeNull()
    // something still changed that is in the still layers
    expect(shiftOf(board({ a: { at: [20, 0] }, b: { at: [40, 0] }, c: { at: [60, 0] }, led: { at: [60, 0], vals: [0.02] } }), snap)).toBeNull()
    expect(shiftOf(board({ a: { at: [20, 0] }, b: { at: [40, 0] }, c: { at: [40, 0] }, led: { at: [60, 0], vals: [0.5] } }), snap)).toBeNull()
    // a part appeared or went away
    expect(shiftOf(board({ a: { at: [20, 0] }, b: { at: [40, 0] }, c: { at: [40, 0] }, led: { at: [60, 0], vals: [0.02] }, d: { at: [0, 0] } }), snap)).toBeNull()
    expect(splitOf(board({ a: { at: [20, 0] } }), snapOf(still))).toBeNull()
  })

  it('gives up keeping things apart when too many of them change shape at once', () => {
    const many: Record<string, { at: [number, number] }> = {}
    const changed: Record<string, { look: string; at: [number, number] }> = {}
    for (let i = 0; i < MAX_LIVE + 5; i++) {
      many[`w${i}`] = { at: [i, 0] }
      changed[`w${i}`] = { look: 'x', at: [i, 0] }
    }
    expect(splitOf(board(changed), snapOf(board(many)))).toBeNull()
  })

  it('drags the whole board as one group', () => {
    const now = board({ a: { at: [20, 0] }, b: { at: [40, 0] }, c: { at: [60, 0] }, led: { at: [80, 0], vals: [0.02] } })
    const plan = splitOf(now, snapOf(still))!
    expect(plan.moving.size).toBe(4)
    expect(plan.live.size).toBe(0)
  })
})
