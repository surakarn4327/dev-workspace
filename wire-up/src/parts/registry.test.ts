// Guard rails for adding parts (see PARTS.md): every part in ALL_PARTS must be complete and consistent, and listed in style.md 1.3.
// A new part that forgets something fails here, on any machine, before it can be committed as "done".

import { describe, expect, it } from 'vitest'
import { HANGING_LEG_PARTS, G } from '../board/world.ts'
import type { Element } from '../sim/solver.ts'
import { ALL_PARTS, drawsOverWires, layerOf, newPart, sanitizeParams } from './index.ts'
import type { BuildCtx, Env, PartDef } from './types.ts'
import styleMd from '../../style.md?raw'
import artSource from './art.ts?raw'

/** Parts allowed to have no burn-out rating (`evaluate` returns no `stress`), each with the reason. */
const NO_STRESS: Record<string, string> = {
  'breadboard': 'a board, nothing to burn',
  'breadboard-mini': 'a board, nothing to burn',
  'gate-not': 'symbol gates never burn (user rule 2026-10-08)',
  'gate-and': 'symbol gates never burn',
  'gate-or': 'symbol gates never burn',
  'gate-nand': 'symbol gates never burn',
  'gate-nor': 'symbol gates never burn',
  'gate-xor': 'symbol gates never burn',
  'gate-xnor': 'symbol gates never burn',
  meter: 'the multimeter has its own fuse',
  supply: 'a bench supply limits its own current (CC mode) and never burns',
}

function fakeCtx(p: { id: string }, pinCount: number, out: Element[]): BuildCtx {
  let next = pinCount + 1
  return {
    pins: Array.from({ length: pinCount }, (_, i) => i + 1),
    ref: 0,
    wired: () => true,
    time: 0,
    animate: () => {},
    newNode: () => next++,
    add: (e) => out.push(e),
    id: (s) => `${p.id}:${s}`,
  }
}

function fakeEnv(pinCount: number): Env {
  return { pins: Array.from({ length: pinCount }, (_, i) => i + 1), ref: 0, v: () => 0, cur: () => undefined, ccIds: new Set() }
}

const withDef = (fn: (def: PartDef) => void) => () => {
  for (const def of ALL_PARTS) {
    try {
      fn(def)
    } catch (e) {
      throw new Error(`[${def.type}] ${(e as Error).message}`)
    }
  }
}

describe('every part is complete', () => {
  it('has a unique type, a name and a blurb', () => {
    const types = ALL_PARTS.map((d) => d.type)
    expect(new Set(types).size).toBe(types.length)
    for (const d of ALL_PARTS) {
      expect(d.name.length, d.type).toBeGreaterThan(2)
      expect(d.blurb.length, d.type).toBeGreaterThan(10)
    }
  })

  it('keeps its default settings through sanitizeParams, and every field edits a real setting', () => {
    withDef((def) => {
      const p = newPart('t1', def.type, 0, 0)
      const before = JSON.stringify(p.params)
      sanitizeParams([p])
      expect(JSON.stringify(p.params)).toBe(before)
      for (const f of def.fields(p)) {
        expect(f.key in p.params, `field ${f.key} has no default`).toBe(true)
        if (f.kind === 'select') expect(f.options.some((o) => o.value === p.params[f.key]), `default of ${f.key} is not one of its options`).toBe(true)
        if (f.kind === 'range') {
          const v = p.params[f.key]
          expect(typeof v === 'number' && v >= f.min && v <= f.max, `default of ${f.key} is outside its range`).toBe(true)
        }
      }
    })()
  })

  it('has one pin label per pin, pins on whole grid steps, and a hit box around them', () => {
    withDef((def) => {
      if (def.pinLabels.length === 0) return
      const p = newPart('t1', def.type, 0, 0)
      const pins = def.pins(p)
      expect(pins.length).toBe(def.pinLabels.length)
      for (const v of pins) {
        expect(Number.isInteger(v.x) && Number.isInteger(v.y), 'pin is off the grid').toBe(true)
        if (def.freeLeads) continue
        const b = def.bounds(p)
        expect(v.x * G >= b.x && v.x * G <= b.x + b.w && v.y * G >= b.y && v.y * G <= b.y + b.h, `pin (${v.x}, ${v.y}) is outside bounds()`).toBe(true)
      }
    })()
  })

  it('builds into the solver, and a burnt part builds nothing', () => {
    withDef((def) => {
      if (def.pinLabels.length === 0) return
      const p = newPart('t1', def.type, 0, 0)
      const out: Element[] = []
      def.build(p, fakeCtx(p, def.pinLabels.length, out))
      expect(out.length, 'build() added no elements').toBeGreaterThan(0)
      const ids = out.map((e) => e.id)
      expect(new Set(ids).size, 'element ids repeat').toBe(ids.length)
      for (const id of ids) expect(id.startsWith('t1:'), `element id ${id} must come from ctx.id()`).toBe(true)
      if (NO_STRESS[def.type]) return
      p.state.failed = true
      const dead: Element[] = []
      def.build(p, fakeCtx(p, def.pinLabels.length, dead))
      // a burnt switch / button holds closed, everything else is an open circuit
      if (def.category !== 'switch') expect(dead.length, 'a burnt part must build nothing').toBe(0)
    })()
  })

  it('reports readings and a burn-out rating (or says why it has none)', () => {
    withDef((def) => {
      if (def.pinLabels.length === 0) return
      const p = newPart('t1', def.type, 0, 0)
      const ev = def.evaluate(p, fakeEnv(def.pinLabels.length))
      for (const [k, v] of Object.entries(ev.live)) expect(Number.isFinite(v), `live.${k} is not a number`).toBe(true)
      if (ev.stress) {
        expect(Number.isFinite(ev.stress.ratio)).toBe(true)
        expect(ev.stress.reason().length, 'stress.reason() should explain with numbers').toBeGreaterThan(20)
      } else {
        expect(NO_STRESS[def.type], 'no stress rating: add one in evaluate(), or list the part in NO_STRESS with a reason').toBeTruthy()
      }
      expect(typeof def.summary(p)).toBe('string')
    })()
  })

  it('hanging-leg parts are registered everywhere that needs to know', () => {
    withDef((def) => {
      const p = newPart('t1', def.type, 0, 0)
      if (typeof p.params.legs !== 'number' || def.pinLabels.length === 0) return
      const short = newPart('t2', def.type, 0, 0)
      short.params.legs = 1
      const long = newPart('t3', def.type, 0, 0)
      long.params.legs = 3
      const a = def.pins(short)
      const b = def.pins(long)
      const hangs = a.some((v, i) => v.y !== b[i].y)
      expect(HANGING_LEG_PARTS.has(def.type), 'legs move the pins down: add the type to HANGING_LEG_PARTS (board/world.ts)').toBe(hangs)
      if (hangs) expect(layerOf(def.type), 'tall part: add the type to TALL_PARTS (parts/index.ts)').toBe(2)
      expect(def.fields(p).some((f) => f.key === 'legs'), 'a part with legs needs LEG_FIELD').toBe(true)
    })()
  })
})

describe('wire stacking', () => {
  it('switches and push buttons are over the wires, every other part is under them', () => {
    const over = ALL_PARTS.filter((d) => drawsOverWires(d.type)).map((d) => d.type).sort()
    expect(over).toEqual(['button', 'slide-switch', 'switch'])
  })
})

describe('style.md 1.3 lists every part', () => {
  const art = artSource
  const rows = styleMd
    .split('\n')
    .map((l: string) => l.match(/^\|\s*`([a-z0-9.-]+)`\s*\|\s*(approved|draft)\s*\|\s*`?([A-Za-z0-9]+)`?\s*\|/))
    .filter((m: RegExpMatchArray | null): m is RegExpMatchArray => m !== null)

  it('has exactly one row per part, in the 1.3 table', () => {
    const listed = rows.map((r: RegExpMatchArray) => r[1])
    expect(new Set(listed).size, 'a part is listed twice').toBe(listed.length)
    const missing = ALL_PARTS.map((d) => d.type).filter((t) => !listed.includes(t))
    expect(missing, 'add these parts to the style.md 1.3 table (status draft until the user approves the look)').toEqual([])
    const extra = listed.filter((t: string) => !ALL_PARTS.some((d) => d.type === t))
    expect(extra, 'style.md 1.3 lists parts that no longer exist').toEqual([])
  })

  it('names a sprite function that exists in parts/art.ts', () => {
    for (const [, type, , fn] of rows) {
      if (fn === 'none') continue
      expect(art.includes(`export function ${fn}(`), `${type}: style.md names ${fn}, which is not exported from art.ts`).toBe(true)
    }
  })
})
