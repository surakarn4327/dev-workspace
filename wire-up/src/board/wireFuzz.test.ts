import { describe, expect, it } from 'vitest'
import { branchEndsOf, branchMap, carryBranches } from './branches.ts'
import { applyFollow } from './follow.ts'
import type { FollowPlan } from './follow.ts'
import { routeVia } from './router.ts'
import { socketKeys, tapTarget } from './wireJoin.ts'
import { dragEnd, moveBend, wireOverlaps } from './wireEdit.ts'
import type { WireShape } from './wireEdit.ts'
import { World, pointKey, wirePath } from './world.ts'
import type { Vec } from './world.ts'

// Random wires, random drags: whatever the user does, a wire must stay made of right angles with no repeated points and
// with its ends where they belong, never running over itself, and a branch resting on it must stay joined to it.

const G = 20
const pt = (x: number, y: number): Vec => ({ x: x * G, y: y * G })
const same = (a: Vec, b: Vec): boolean => a.x === b.x && a.y === b.y
const ortho = (pts: Vec[]): boolean => pts.every((p, k) => k === 0 || p.x === pts[k - 1].x || p.y === pts[k - 1].y)
const dups = (pts: Vec[]): boolean => pts.some((p, k) => k > 0 && same(p, pts[k - 1]))
const straight = (pts: Vec[]): boolean =>
  pts.some((p, k) => k > 0 && k + 1 < pts.length && ((pts[k - 1].x === p.x && p.x === pts[k + 1].x) || (pts[k - 1].y === p.y && p.y === pts[k + 1].y)))

function rng(seed: number): { ri(a: number, b: number): number; chance(p: number): boolean } {
  let s = seed
  const next = (): number => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  return { ri: (a, b) => a + Math.floor(next() * (b - a + 1)), chance: (p) => next() < p }
}

function randomWire(r: ReturnType<typeof rng>): { a: Vec; via: Vec[]; b: Vec } {
  for (;;) {
    let cur = pt(r.ri(-6, 6), r.ri(-6, 6))
    const a = cur
    const via: Vec[] = []
    const n = r.ri(0, 4)
    let horiz = r.chance(0.5)
    for (let k = 0; k <= n; k++) {
      const len = r.ri(1, 8) * (r.chance(0.5) ? -1 : 1) * G
      cur = horiz ? { x: cur.x + len, y: cur.y } : { x: cur.x, y: cur.y + len }
      if (k < n) via.push(cur)
      horiz = !horiz
    }
    if (!same(a, cur) && !wireOverlaps(a, via, cur)) return { a, via, b: cur }
  }
}

const show = (a: Vec, via: Vec[], b: Vec): string => JSON.stringify([a, ...via, b].map((p) => [p.x / G, p.y / G]))

describe('wire editing, random drags', () => {
  it('dragging a corner keeps right angles, no repeated or straight-through points', () => {
    const r = rng(12345)
    for (let t = 0; t < 1500; t++) {
      const w = randomWire(r)
      if (w.via.length === 0) continue
      const idx = r.ri(0, w.via.length - 1)
      const pos = pt(r.ri(-9, 9), r.ri(-9, 9))
      const out = moveBend(w.a, w.via, w.b, idx, pos, [])
      const pts = [w.a, ...out, w.b]
      const what = `${show(w.a, w.via, w.b)} corner ${idx} -> ${pos.x / G},${pos.y / G}`
      expect(ortho(pts), what).toBe(true)
      expect(dups(pts), what).toBe(false)
      expect(straight(pts), what).toBe(false)
      expect(wireOverlaps(w.a, out, w.b), what).toBe(false)
    }
  })

  it('dragging an end keeps right angles, puts the end where dropped and leaves the other end alone', () => {
    const r = rng(54321)
    for (let t = 0; t < 1500; t++) {
      const w = randomWire(r)
      const end = r.chance(0.5) ? 'a' : 'b'
      const to = pt(r.ri(-9, 9), r.ri(-9, 9))
      const base: WireShape = { a: w.a, b: w.b, via: w.via, taps: [] }
      const res = dragEnd(base, end, to, false)
      const what = `${show(w.a, w.via, w.b)} end ${end} -> ${to.x / G},${to.y / G}`
      expect(ortho([res.a, ...res.via, res.b]), what).toBe(true)
      expect(dups([res.a, ...res.via, res.b]), what).toBe(false)
      expect(wireOverlaps(res.a, res.via, res.b), what).toBe(false)
      const moved = end === 'a' ? res.a : res.b
      const stayed = end === 'a' ? res.b : res.a
      if (!same(to, end === 'a' ? w.b : w.a)) expect(same(moved, to), what).toBe(true)
      expect(same(stayed, end === 'a' ? w.b : w.a), what).toBe(true)
    }
  })

  it('a wire pulled along by a part keeps right angles and the right ends', () => {
    const r = rng(777)
    for (let t = 0; t < 1500; t++) {
      const w = randomWire(r)
      const world = new World()
      const main = world.addWire(w.a, w.b, '#ff4a4a', w.via)
      const end = r.chance(0.5) ? 'a' : 'b'
      const dx = r.ri(-6, 6) * G
      const dy = r.ri(-6, 6) * G
      if (dx === 0 && dy === 0) continue
      const plan: FollowPlan = {
        carried: [],
        moving: new Set([pointKey(end === 'a' ? w.a : w.b)]),
        parts: new Map(),
        wires: world.wires.map((x) => JSON.parse(JSON.stringify(x))),
        whole: new Set(),
      }
      applyFollow(world, plan, dx, dy)
      const what = `${show(w.a, w.via, w.b)} end ${end} by ${dx / G},${dy / G}`
      expect(ortho(wirePath(main)), what).toBe(true)
      expect(wireOverlaps(main.a, main.via, main.b), what).toBe(false)
      const from = end === 'a' ? w.a : w.b
      expect(same(end === 'a' ? main.a : main.b, { x: from.x + dx, y: from.y + dy }), what).toBe(true)
      expect(same(end === 'a' ? main.b : main.a, end === 'a' ? w.b : w.a), what).toBe(true)
    }
  })

  it('the router always gives right angles from the start to the end', () => {
    const r = rng(99)
    for (let t = 0; t < 600; t++) {
      const a = pt(r.ri(-8, 8), r.ri(-8, 8))
      const b = pt(r.ri(-8, 8), r.ri(-8, 8))
      if (same(a, b)) continue
      const via = routeVia(a, b, [], [])
      const pts = [a, ...via, b]
      expect(ortho(pts), show(a, via, b)).toBe(true)
      expect(dups(pts) || straight(pts) || wireOverlaps(a, via, b), show(a, via, b)).toBe(false)
    }
  })
})

/** A short branch wire whose end rests on a random stretch of `main` (null if no stretch is long enough). */
function addBranch(world: World, main: ReturnType<World['addWire']>, r: ReturnType<typeof rng>): ReturnType<World['addWire']> | null {
  const path = wirePath(main)
  const k = r.ri(0, path.length - 2)
  const p = path[k]
  const q = path[k + 1]
  const horiz = p.y === q.y
  const lo = horiz ? Math.min(p.x, q.x) : Math.min(p.y, q.y)
  const hi = horiz ? Math.max(p.x, q.x) : Math.max(p.y, q.y)
  if (hi - lo < 3 * G) return null
  const along = lo + G * r.ri(1, (hi - lo) / G - 1)
  const on = horiz ? { x: along, y: p.y } : { x: p.x, y: along }
  const off = horiz ? { x: along, y: p.y + 2 * G } : { x: p.x + 2 * G, y: along }
  return world.addWire(off, on, '#2ea043')
}

const stillOn = (world: World, branch: { b: Vec }, main: { a: Vec; b: Vec; via: Vec[] }): boolean =>
  tapTarget(world, branch as never, branch.b, socketKeys(world)) !== undefined || wirePath(main as never).some((p) => same(p, branch.b))

describe('branch wires, random drags', () => {
  it('a branch stays joined, in right angles, when the wire it rests on is reshaped', () => {
    const r = rng(2024)
    let checked = 0
    for (let t = 0; t < 1500; t++) {
      const w = randomWire(r)
      if (w.via.length === 0) continue
      const world = new World()
      const main = world.addWire(w.a, w.b, '#ff4a4a', w.via)
      const branch = addBranch(world, main, r)
      if (!branch) continue
      const ends = branchEndsOf(world, main)
      if (ends.length === 0) continue
      const idx = r.ri(0, main.via.length - 1)
      const pos = pt(r.ri(-9, 9), r.ri(-9, 9))
      const old = main.via.map((v) => ({ ...v }))
      main.via = moveBend(main.a, old, main.b, idx, pos, [])
      carryBranches(world, ends, [main.a, ...old, main.b], [main.a, ...main.via, main.b])
      const what = `main ${show(w.a, old, w.b)} corner ${idx} -> ${pos.x / G},${pos.y / G}`
      expect(stillOn(world, branch, main), what).toBe(true)
      expect(ortho(wirePath(branch)), what).toBe(true)
      expect(wireOverlaps(branch.a, branch.via, branch.b), what).toBe(false)
      checked++
    }
    expect(checked).toBeGreaterThan(500)
  })

  it('a branch stays joined when a part pulls the wire it rests on', () => {
    const r = rng(31337)
    let checked = 0
    for (let t = 0; t < 1500; t++) {
      const w = randomWire(r)
      const world = new World()
      const main = world.addWire(w.a, w.b, '#ff4a4a', w.via)
      const branch = addBranch(world, main, r)
      if (!branch) continue
      const end = r.chance(0.5) ? 'a' : 'b'
      const dx = r.ri(-4, 4) * G
      const dy = r.ri(-4, 4) * G
      if (dx === 0 && dy === 0) continue
      const plan: FollowPlan = {
        carried: [],
        moving: new Set([pointKey(end === 'a' ? w.a : w.b)]),
        parts: new Map(),
        wires: world.wires.map((x) => JSON.parse(JSON.stringify(x))),
        whole: new Set(),
        branches: branchMap(world),
      }
      if ((plan.branches?.get(main.id)?.length ?? 0) === 0) continue
      applyFollow(world, plan, dx, dy)
      if (same(main.a, main.b) && main.via.length === 0) continue // pulled to nothing: cleaned up on release
      const what = `${show(w.a, w.via, w.b)} end ${end} by ${dx / G},${dy / G}`
      expect(stillOn(world, branch, main), what).toBe(true)
      expect(ortho(wirePath(branch)), what).toBe(true)
      checked++
    }
    expect(checked).toBeGreaterThan(300)
  })

  it('a wire pulled to nothing is dropped on release', () => {
    const world = new World()
    world.addWire({ x: 0, y: 0 }, { x: 0, y: 40 }, '#ff4a4a')
    const keep = world.addWire({ x: 100, y: 0 }, { x: 100, y: 40 }, '#2f6fe0')
    world.wires[0].b = { x: 0, y: 0 }
    expect(world.dropEmptyWires()).toBe(1)
    expect(world.wires).toEqual([keep])
  })
})
