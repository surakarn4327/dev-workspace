import { describe, expect, it } from 'vitest'
import { routeVia } from './router.ts'
import { G, wirePath } from './world.ts'
import type { Vec, Wire } from './world.ts'

function wire(id: string, a: Vec, b: Vec, via: Vec[] = []): Wire {
  return { id, a, b, via, color: '#fff' }
}

function edges(w: Wire): Set<string> {
  const out = new Set<string>()
  const pts = wirePath(w)
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i]
    const q = pts[i + 1]
    const dx = Math.sign(q.x - p.x)
    const dy = Math.sign(q.y - p.y)
    let x = p.x
    let y = p.y
    while (x !== q.x || y !== q.y) {
      const nx = x + dx * G
      const ny = y + dy * G
      out.add(x < nx || y < ny ? `${x},${y}|${nx},${ny}` : `${nx},${ny}|${x},${y}`)
      x = nx
      y = ny
    }
  }
  return out
}

describe('wire router', () => {
  it('uses only right angles', () => {
    const a = { x: 0, y: 0 }
    const b = { x: 200, y: 120 }
    const w = wire('n', a, b, routeVia(a, b, []))
    const pts = wirePath(w)
    for (let i = 0; i + 1 < pts.length; i++) expect(pts[i].x === pts[i + 1].x || pts[i].y === pts[i + 1].y).toBe(true)
  })

  it('goes around a wire instead of running along it', () => {
    const other = wire('o', { x: 0, y: 0 }, { x: 200, y: 0 })
    const a = { x: -20, y: 0 }
    const b = { x: 220, y: 0 }
    const w = wire('n', a, b, routeVia(a, b, [other]))
    expect(w.via.length).toBeGreaterThan(0)
    const mine = edges(w)
    for (const e of edges(other)) expect(mine.has(e)).toBe(false)
  })

  it('does not end a bend on another wire', () => {
    const other = wire('o', { x: 0, y: 0 }, { x: 200, y: 0 })
    const a = { x: -20, y: 0 }
    const b = { x: 220, y: 0 }
    const w = wire('n', a, b, routeVia(a, b, [other]))
    const keys = new Set(wirePath(other).map((p) => `${p.x},${p.y}`))
    for (const v of w.via) expect(keys.has(`${v.x},${v.y}`)).toBe(false)
  })

  it('crosses a wire straight when that is the shortest way', () => {
    const other = wire('o', { x: 0, y: 0 }, { x: 200, y: 0 })
    const a = { x: 100, y: -40 }
    const b = { x: 100, y: 40 }
    expect(routeVia(a, b, [other])).toEqual([])
  })

  it('is straight when nothing is in the way', () => {
    expect(routeVia({ x: 0, y: 0 }, { x: 100, y: 0 }, [])).toEqual([])
  })
})
