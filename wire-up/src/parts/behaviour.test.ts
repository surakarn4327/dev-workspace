// Behaviour guard rails for every part (PARTS.md). They exist because of a real bug: the relay module's power LED lit with GND
// unconnected, because it looked at a voltage instead of a current. Two invariants hold for every part, with no per-part code:
//
//   A. Drive ONE pin of the part from a source whose other side goes nowhere: no current may flow, anywhere.
//   B. In that situation the part must also LOOK exactly as it does with nothing connected (no lit LED, no moved switch...).
//
// A part that legitimately reacts to a single pin goes in ONE_PIN_OK with the reason.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SceneBuilder } from '../lessons/lessons.ts'
import { Simulation } from '../board/simulation.ts'
import { World } from '../board/world.ts'
import { ALL_PARTS, defOf, pinNamesOf, pinWorld } from './index.ts'
import type { PartLive } from './types.ts'

/** Parts that are sources, instruments or boards: they have no "unpowered" state to check. */
const SKIP: Record<string, string> = {
  'supply': 'a source',
  'battery': 'a source',
  'meter': 'an instrument; its probes read whatever they touch',
}

/** Parts allowed to react to a single driven pin, with the reason (leave this list short). */
const GATE_REASON = 'a symbol gate has no power pins: it is powered by the source of its own circuit, so one driven pin is a complete circuit'
const ONE_PIN_OK: Record<string, string> = {
  'gate-not': GATE_REASON,
  'gate-and': GATE_REASON,
  'gate-or': GATE_REASON,
  'gate-nand': GATE_REASON,
  'gate-nor': GATE_REASON,
  'gate-xor': GATE_REASON,
  'gate-xnor': GATE_REASON,
}

// ---- a canvas that records what is drawn, so two draws can be compared --------------------------------------------------
let canvasCount = 0
function show(a: unknown): string {
  if (typeof a === 'function') return '<proxy>'
  if (typeof a === 'object' && a !== null) return `<${(a as { id?: string }).id ?? 'obj'}>`
  return String(a)
}
function recorder(log: string[]): CanvasRenderingContext2D {
  const make = (): unknown =>
    new Proxy(function () {}, {
      get(_t, key) {
        if (key === 'canvas') return { width: 1, height: 1 }
        if (key === 'measureText') return () => ({ width: 8 })
        if (key === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h })
        return state.has(key) ? state.get(key) : make()
      },
      set(_t, key, value) {
        state.set(key, value)
        log.push(`${String(key)}=${show(value)}`)
        return true
      },
      apply(_t, _this, args) {
        log.push(`call(${args.map(show).join(',')})`)
        return make()
      },
    })
  const state = new Map<string | symbol, unknown>()
  return make() as CanvasRenderingContext2D
}

const fakeDocument = {
  createElement() {
    const id = `cv${canvasCount++}`
    const cv: Record<string, unknown> = { id, width: 0, height: 0 }
    cv.getContext = () => recorder([])
    return cv
  },
}

let hadDocument = false
beforeAll(() => {
  hadDocument = 'document' in globalThis
  if (!hadDocument) (globalThis as unknown as { document: unknown }).document = fakeDocument
})
afterAll(() => {
  if (!hadDocument) delete (globalThis as unknown as { document?: unknown }).document
})

// ---- scenes ---------------------------------------------------------------------------------------------------------------
interface Variant {
  type: string
  params: Record<string, number | string | boolean>
  label: string
}

function variantsOf(type: string): Variant[] {
  if (type === 'relay-module') {
    const out: Variant[] = []
    for (const channels of [1, 2, 4, 8]) for (const trigger of ['low', 'high']) out.push({ type, params: { channels, trigger }, label: `${type} ${channels}ch ${trigger}` })
    return out
  }
  return [{ type, params: {}, label: type }]
}

/** The part alone, or with a 9 V source (its minus left unconnected) on pin `k`. */
function scene(v: Variant, k: number | null) {
  const w = new World()
  const b = new SceneBuilder(w)
  const part = b.place(v.type, 400, 200, v.params)
  let source: ReturnType<typeof b.place> | null = null
  if (k !== null) {
    source = b.place('supply', 0, 0, { volts: 9, limit: 0.5 })
    b.wire(pinWorld(source)[0], pinWorld(part)[k])
  } else {
    // nothing connected: a supply far away keeps a ground reference like every other scene
    source = b.place('supply', 0, 0, { volts: 9, limit: 0.5 })
  }
  w.commit()
  const sim = new Simulation(w)
  for (let i = 0; i < 20; i++) sim.step(0.016)
  return { sim, part, source }
}

function drawLog(v: Variant, live: PartLive | undefined, part: ReturnType<typeof scene>['part']): string {
  const log: string[] = []
  const c = recorder(log)
  defOf(v.type).draw(c, part, live ?? {}, 0)
  return log.join('\n')
}

const TYPES = ALL_PARTS.map((d) => d.type).filter((t) => !(t in SKIP) && !t.startsWith('breadboard'))

describe('single driven pin', () => {
  for (const type of TYPES) {
    for (const v of variantsOf(type)) {
      const pinCount = pinNamesOf(scene(v, null).part).length
      it(`${v.label}: one driven pin draws no current and changes nothing visible`, () => {
        const idle = scene(v, null)
        const idleDraw = drawLog(v, idle.sim.live.get(idle.part.id), idle.part)
        const failures: string[] = []
        for (let k = 0; k < pinCount; k++) {
          const s = scene(v, k)
          const i = Math.abs(s.sim.live.get(s.source.id)?.i ?? 0)
          const name = pinNamesOf(s.part)[k] ?? String(k)
          if (i > 1e-6 && !(type in ONE_PIN_OK)) failures.push(`pin ${name}: the source delivered ${(i * 1000).toFixed(3)} mA into a part whose other pins are all open`)
          const d = drawLog(v, s.sim.live.get(s.part.id), s.part)
          if (d !== idleDraw && !(type in ONE_PIN_OK)) failures.push(`pin ${name}: the part looks different from its idle drawing (a lit LED or moved part without a complete circuit)`)
        }
        expect(failures).toEqual([])
      })
    }
  }
})
