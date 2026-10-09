import { describe, expect, it } from 'vitest'
import { applyFollow } from './follow.ts'
import type { FollowPlan } from './follow.ts'
import { pointKey, World } from './world.ts'

function drag(a: { x: number; y: number }, via: { x: number; y: number }[], b: { x: number; y: number }, moved: 'a' | 'b', dx: number, dy: number) {
  const w = new World()
  const wire = w.addWire(a, b, '#2ea043', via)
  const plan: FollowPlan = {
    carried: [],
    partial: [],
    moving: new Set([pointKey(moved === 'a' ? a : b)]),
    parts: new Map(),
    wires: [JSON.parse(JSON.stringify(wire))],
    whole: new Set(),
  }
  applyFollow(w, plan, dx, dy)
  return wire
}

describe('wire following a dragged end', () => {
  it('slides the corner next to the end instead of adding one', () => {
    // fixed end -> right along y=0 -> down into the pin at (100, 40); the pin moves 60 to the left
    const w = drag({ x: 0, y: 0 }, [{ x: 100, y: 0 }], { x: 100, y: 40 }, 'b', -60, 0)
    expect(w.b).toEqual({ x: 40, y: 40 })
    expect(w.via).toEqual([{ x: 40, y: 0 }])
  })

  it('slides a horizontal last stretch up and down with the end', () => {
    const w = drag({ x: 0, y: 0 }, [{ x: 0, y: 40 }], { x: 80, y: 40 }, 'b', 0, 20)
    expect(w.b).toEqual({ x: 80, y: 60 })
    expect(w.via).toEqual([{ x: 0, y: 60 }])
  })

  it('works from the first end too', () => {
    const w = drag({ x: 100, y: 40 }, [{ x: 100, y: 0 }], { x: 0, y: 0 }, 'a', -60, 0)
    expect(w.a).toEqual({ x: 40, y: 40 })
    expect(w.via).toEqual([{ x: 40, y: 0 }])
  })
})

describe('branches on a wire that follows', () => {
  it('slide with the stretch they rest on when the corner next to the dragged end slides', async () => {
    const { branchMap } = await import('./branches.ts')
    const w = new World()
    const main = w.addWire({ x: 0, y: 0 }, { x: 100, y: 60 }, '#ff4a4a', [{ x: 100, y: 0 }])
    const branch = w.addWire({ x: 160, y: 30 }, { x: 100, y: 30 }, '#2ea043') // its b end rests on the main wire's last stretch
    const plan: FollowPlan = {
      carried: [],
      partial: [],
      moving: new Set([pointKey({ x: 100, y: 60 })]),
      parts: new Map(),
      wires: w.wires.map((x) => JSON.parse(JSON.stringify(x))),
      whole: new Set(),
      branches: branchMap(w),
    }
    applyFollow(w, plan, -60, 0)
    expect(main.via).toEqual([{ x: 40, y: 0 }])
    expect(branch.b).toEqual({ x: 40, y: 30 }) // still on the main wire
    expect(branch.a).toEqual({ x: 160, y: 30 })
  })
})
