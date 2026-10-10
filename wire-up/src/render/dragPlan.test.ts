import { describe, expect, it } from 'vitest'
import { closeVals, sameSigs } from './dragPlan.ts'
import type { Sigs } from './dragPlan.ts'

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

describe('readings', () => {
  it('count as the same when they differ only by solver noise', () => {
    expect(closeVals([0.02124580792958827], [0.02124580792958963])).toBe(true)
    expect(closeVals([8.98e-12], [-2e-13])).toBe(true)
    expect(closeVals([0.02], [0.03])).toBe(false)
    expect(closeVals([1, 2], [1])).toBe(false)
    expect(closeVals(undefined, [1])).toBe(false)
  })
})

describe('does the saved picture of the board still show it', () => {
  const still = board({ a: { at: [0, 0] }, b: { at: [20, 0] }, led: { at: [60, 0], vals: [0.02] } })

  it('yes while nothing changed, even if a reading moved by solver noise', () => {
    expect(sameSigs(still, board({ a: { at: [0, 0] }, b: { at: [20, 0] }, led: { at: [60, 0], vals: [0.02000001] } }))).toBe(true)
  })

  it('no once something moved, changed its look or its reading, or came or went', () => {
    expect(sameSigs(still, board({ a: { at: [20, 0] }, b: { at: [20, 0] }, led: { at: [60, 0], vals: [0.02] } }))).toBe(false)
    expect(sameSigs(still, board({ a: { look: 'other', at: [0, 0] }, b: { at: [20, 0] }, led: { at: [60, 0], vals: [0.02] } }))).toBe(false)
    expect(sameSigs(still, board({ a: { at: [0, 0] }, b: { at: [20, 0] }, led: { at: [60, 0], vals: [0.5] } }))).toBe(false)
    expect(sameSigs(still, board({ a: { at: [0, 0] }, b: { at: [20, 0] } }))).toBe(false)
    expect(sameSigs(still, board({ a: { at: [0, 0] }, b: { at: [20, 0] }, led: { at: [60, 0], vals: [0.02] }, c: { at: [0, 0] } }))).toBe(false)
  })
})
