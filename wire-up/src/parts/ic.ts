// Real 74HC logic chips in a DIP-14 package: VCC on pin 14, GND on pin 7, pinout as in the datasheets. They straddle the
// breadboard's middle gap (pin rows 3 grid steps apart) and need their own supply wired in, like the real thing.

import { COL, drawLabelAbove, drawText, rrect } from '../render/draw.ts'
import { drawSprite, spriteInk } from '../render/pixel.ts'
import { scene } from '../render/scene.ts'
import { eng, HC, NE555 } from '../sim/models.ts'
import type { GateFn } from '../sim/solver.ts'
import { DIP_COLORS, dip8Sprite, dipSprite } from './art.ts'
import { eid, stress } from './common.ts'
import type { BuildCtx, PartDef } from './types.ts'

/** Pin number (1..14) of each gate's inputs and output: [A, B, Y], or [A, Y] for an inverter. */
type Layout = number[][]

export interface ChipInfo {
  chip: string
  what: string
  fn: GateFn
  layout: Layout
}

/** Every chip type with its gate function and pinout (for the datasheet pinout sheet in the UI). */
export const CHIP_INFO = new Map<string, ChipInfo>()

const QUAD: Layout = [[1, 2, 3], [4, 5, 6], [9, 10, 8], [12, 13, 11]] // 74HC00 / 08 / 32 / 86
const QUAD_NOR: Layout = [[2, 3, 1], [5, 6, 4], [8, 9, 10], [11, 12, 13]] // 74HC02
const HEX_NOT: Layout = [[1, 2], [3, 4], [5, 6], [9, 8], [11, 10], [13, 12]] // 74HC04

const VCC = 14
/** Vector look: body box and leg length in world px (legs run from the pin rows y = 0 and y = 60 to the body). */
const BODY = { x: -10, y: 8, w: 140, h: 44 }
const LEG = 8
const GND = 7

/** Pin k (1..14) in grid units: 1..7 left to right along the bottom row, 8..14 right to left along the top. */
function pinAt(k: number): { x: number; y: number } {
  return k <= 7 ? { x: k - 1, y: 3 } : { x: 14 - k, y: 0 }
}

function pinNames(layout: Layout): string[] {
  const names = new Array<string>(14).fill('NC')
  layout.forEach((g, i) => {
    const n = i + 1
    names[g[0] - 1] = `${n}A`
    if (g.length === 2) names[g[1] - 1] = `${n}Y`
    else {
      names[g[1] - 1] = `${n}B`
      names[g[2] - 1] = `${n}Y`
    }
  })
  names[VCC - 1] = 'VCC'
  names[GND - 1] = 'GND'
  return names
}

/** A hash of a string to 0..1, steady for the same text. */
function unit(text: string): number {
  let h = 2166136261
  for (let k = 0; k < text.length; k++) h = Math.imul(h ^ text.charCodeAt(k), 16777619)
  return ((h >>> 0) % 100000) / 100000
}

/**
 * Where a floating input sits as time passes: wandering across the middle of the supply (and often beyond the switching
 * point either way), like an antenna picking up the room. A smooth sum of a few slow waves, different for every pin.
 */
function drift(owner: string, pinNo: number, time: number): number {
  const s = `${owner}#${pinNo}`
  const wave = (k: number, rate: number, depth: number) => depth * Math.sin(2 * Math.PI * (rate * time + unit(`${s}/${k}`)))
  return Math.min(Math.max(0.5 + wave(1, 0.37, 0.3) + wave(2, 0.91, 0.22) + wave(3, 2.3, 0.12), 0.03), 0.97)
}

/**
 * One input pin: wired, it is held by a huge pull-down (nothing but the switch or wire that drives it matters) and by the
 * chip's two protection diodes (up to VCC, down from GND). Left unconnected it is not pulled anywhere: it floats, a
 * divider of two million ohms that wanders with time, so the gate's output flickers until the pin is tied to + or -.
 */
function input(ctx: BuildCtx, owner: string, pinNo: number, tag: string, node: number, vcc: number, gnd: number): void {
  if (ctx.wired(pinNo - 1)) {
    ctx.add({ kind: 'R', id: ctx.id(`pd${tag}`), a: node, b: gnd, r: HC.rIn })
  } else {
    const u = drift(owner, pinNo, ctx.time)
    ctx.add({ kind: 'R', id: ctx.id(`fu${tag}`), a: vcc, b: node, r: HC.rFloat * (1 - u) * 2 })
    ctx.add({ kind: 'R', id: ctx.id(`fd${tag}`), a: node, b: gnd, r: HC.rFloat * u * 2 })
    ctx.animate()
  }
  ctx.add({ kind: 'D', id: ctx.id(`cu${tag}`), a: node, b: vcc, is: HC.diodeIs, n: 1 })
  ctx.add({ kind: 'D', id: ctx.id(`cd${tag}`), a: gnd, b: node, is: HC.diodeIs, n: 1 })
}

function makeChip(type: string, chip: string, what: string, fn: GateFn, layout: Layout): PartDef {
  CHIP_INFO.set(type, { chip, what, fn, layout })
  const pinout = layout
    .map((g, i) => (g.length === 2 ? `${i + 1}A=${g[0]} ${i + 1}Y=${g[1]}` : `${i + 1}A=${g[0]} ${i + 1}B=${g[1]} ${i + 1}Y=${g[2]}`))
    .join(', ')
  return {
    type,
    name: `${chip} ${what}`,
    category: 'logic',
    blurb: `Real CMOS chip. Wire pin 14 to + (2-6 V) and pin 7 to -. Pin 1 is bottom left (dot), notch on the left. Pins: ${pinout}.`,
    pinLabels: pinNames(layout),
    hidePinLabels: true, // a real chip has no printed pin names; the pinout is in the description
    defaults: () => ({}),
    pins: () => Array.from({ length: 14 }, (_, i) => pinAt(i + 1)),
    bounds: () => ({ x: -12, y: -2, w: 144, h: 64 }),
    build(p, ctx) {
      if (p.state.failed) return
      // a real chip does nothing until both supply pins are wired: leave its outputs floating
      if (!ctx.wired(VCC - 1) || !ctx.wired(GND - 1)) return
      const pin = (k: number) => ctx.pins[k - 1]
      const vcc = pin(VCC)
      const gnd = pin(GND)
      layout.forEach((g, i) => {
        const a = g[0]
        const b = g.length === 3 ? g[1] : undefined
        const y = g[g.length - 1]
        ctx.add({ kind: 'C', id: ctx.id(`g${i}`), fn, a: pin(a), b: b === undefined ? undefined : pin(b), y: pin(y), vcc, gnd, rout: HC.rout, w: HC.w })
        const inputs: [number, string][] = b === undefined ? [[a, 'a']] : [[a, 'a'], [b, 'b']]
        for (const [pinNo, tag] of inputs) input(ctx, p.id, pinNo, `${i}${tag}`, pin(pinNo), vcc, gnd)
      })
      ctx.add({ kind: 'R', id: ctx.id('leak'), a: vcc, b: gnd, r: HC.rLeak })
      // the substrate diode: a supply wired the wrong way round drives a large current straight through the chip
      ctx.add({ kind: 'D', id: ctx.id('sub'), a: gnd, b: vcc, is: HC.diodeIs, n: 1 })
    },
    evaluate(p, env) {
      const v = (k: number) => env.v(env.pins[k - 1])
      const vs = v(VCC) - v(GND)
      let worstOut = 0
      let worstPin = 0
      let supply = 0
      layout.forEach((g, i) => {
        const c = env.cur(eid(p, `g${i}`))
        const out = -((c?.i ?? 0) + (c?.ib ?? 0)) // pushed out of Y
        supply += Math.max(0, -(c?.i ?? 0)) // drawn in from VCC
        if (Math.abs(out) > worstOut) {
          worstOut = Math.abs(out)
          worstPin = g[g.length - 1]
        }
      })
      const sub = Math.abs(env.cur(eid(p, 'sub'))?.i ?? 0)
      // the protection diodes of each input: current into VCC or out of GND through them
      let clamp = 0
      let clampPin = 0
      layout.forEach((g, i) => {
        const pins = g.length === 3 ? [[g[0], 'a'], [g[1], 'b']] as [number, string][] : [[g[0], 'a']] as [number, string][]
        for (const [pinNo, tag] of pins) {
          const iu = Math.abs(env.cur(eid(p, `cu${i}${tag}`))?.i ?? 0)
          const id = Math.abs(env.cur(eid(p, `cd${i}${tag}`))?.i ?? 0)
          if (Math.max(iu, id) > clamp) {
            clamp = Math.max(iu, id)
            clampPin = pinNo
          }
        }
      })
      const rClamp = clamp / HC.iClampMax
      const rV = vs / HC.vccMax
      const rOut = worstOut / HC.iOutMax
      const rSup = Math.max(supply, sub) / HC.iSupplyMax
      return {
        live: { v: vs, i: supply + sub },
        stress: stress(Math.max(rV, rOut, rSup, rClamp), () => {
          const swapped = vs < -0.3 || sub / HC.iSupplyMax >= Math.max(rV, rOut)
          if (!swapped && rClamp >= Math.max(rV, rOut, rSup)) {
            const at = clampPin ? v(clampPin) - v(GND) : 0
            return `${chip} input on pin ${clampPin} was driven to ${eng(at, 'V')} with the supply at ${eng(vs, 'V')}: its protection diode carried ${eng(clamp, 'A')}, one input can take at most ${eng(HC.iClampMax, 'A')}. Keep inputs between GND and VCC.`
          }
          if (swapped) {
            return `${chip} has VCC and GND swapped: ${eng(sub, 'A')} ran straight through the chip (at most ${eng(HC.iSupplyMax, 'A')}). Pin 14 goes to +, pin 7 to -.`
          }
          if (rV >= rOut) return `${chip} supply was ${eng(vs, 'V')}; a 74HC chip takes at most ${HC.vccMax} V (it works on 2-6 V).`
          return `${chip} output on pin ${worstPin} carried ${eng(worstOut, 'A')}; one output can give at most ${eng(HC.iOutMax, 'A')}. Use a resistor and do not short an output.`
        }),
      }
    },
    draw(c, p) {
      if (scene.pixel) {
        const s = dipSprite()
        drawSprite(c, s, -10, 0)
        drawText(c, chip, 60, 26, { color: COL.dim, align: 'center' })
        if (scene.labeled.has(p.id)) drawLabelAbove(c, `${chip} ${what}`, 60, spriteInk(s, -10, 0).top)
        return
      }
      const top = BODY.y - LEG
      const mid = BODY.y + BODY.h / 2
      c.fillStyle = DIP_COLORS.S
      for (let i = 0; i < 7; i++) {
        c.fillRect(i * 20 - 2, top, 4, LEG)
        c.fillRect(i * 20 - 2, BODY.y + BODY.h, 4, LEG)
      }
      c.fillStyle = DIP_COLORS.b
      rrect(c, BODY.x, BODY.y, BODY.w, BODY.h, 3)
      c.fill()
      c.fillStyle = COL.bg
      c.beginPath()
      c.arc(BODY.x, mid, 6, -Math.PI / 2, Math.PI / 2)
      c.fill()
      drawText(c, chip, BODY.x + BODY.w / 2, mid - 4, { color: COL.dim, align: 'center' })
      if (scene.labeled.has(p.id)) drawLabelAbove(c, `${chip} ${what}`, BODY.x + BODY.w / 2, top)
    },
    fields: () => [],
    summary: () => `${layout.length} gates, VCC pin 14, GND pin 7`,
  }
}

export const hc00 = makeChip('ic-74hc00', '74HC00', 'quad NAND', 'nand', QUAD)
export const hc02 = makeChip('ic-74hc02', '74HC02', 'quad NOR', 'nor', QUAD_NOR)
export const hc04 = makeChip('ic-74hc04', '74HC04', 'hex NOT', 'not', HEX_NOT)
export const hc08 = makeChip('ic-74hc08', '74HC08', 'quad AND', 'and', QUAD)
export const hc32 = makeChip('ic-74hc32', '74HC32', 'quad OR', 'or', QUAD)
export const hc86 = makeChip('ic-74hc86', '74HC86', 'quad XOR', 'xor', QUAD)

// ---------------------------------------------------------------- NE555 timer (DIP-8)

/** Pin names in pin order, as printed on the datasheet pinout. */
export const NE555_PINS = ['GND', 'TRIG', 'OUT', 'RESET', 'CTRL', 'THRES', 'DISCH', 'VCC']

/** Pin k (1..8) in grid units: 1..4 left to right along the bottom row, 5..8 right to left along the top. */
function pin8At(k: number): { x: number; y: number } {
  return k <= 4 ? { x: k - 1, y: 3 } : { x: 8 - k, y: 0 }
}

const NE_BODY = { x: -10, y: 8, w: 80, h: 44 }

export const ne555: PartDef = {
  type: 'ic-ne555',
  name: 'NE555 timer',
  category: 'logic',
  blurb:
    'Real timer chip. Wire pin 8 to + (4.5-16 V) and pin 1 to -. Pin 1 is bottom left (dot), notch on the left. 1 GND, 2 TRIG, 3 OUT, 4 RESET, 5 CTRL, 6 THRES, 7 DISCH, 8 VCC. With R and C it blinks or times a pulse.',
  pinLabels: NE555_PINS,
  hidePinLabels: true,
  defaults: () => ({}),
  pins: () => Array.from({ length: 8 }, (_, i) => pin8At(i + 1)),
  bounds: () => ({ x: -12, y: -2, w: 84, h: 64 }),
  build(p, ctx) {
    if (p.state.failed) return
    // a real chip does nothing until both supply pins are wired
    if (!ctx.wired(0) || !ctx.wired(7)) return
    const pin = (k: number) => ctx.pins[k - 1]
    const gnd = pin(1)
    const vcc = pin(8)
    const ctl = pin(5)
    const ref = ctx.newNode() // the one-third point of the internal divider
    // the divider of three equal resistors: CTRL is the two-thirds point, the trigger comparator reads the one-third point
    ctx.add({ kind: 'R', id: ctx.id('d1'), a: vcc, b: ctl, r: NE555.rDiv })
    ctx.add({ kind: 'R', id: ctx.id('d2'), a: ctl, b: ref, r: NE555.rDiv })
    ctx.add({ kind: 'R', id: ctx.id('d3'), a: ref, b: gnd, r: NE555.rDiv })
    ctx.add({ kind: 'R', id: ctx.id('iq'), a: vcc, b: gnd, r: NE555.rQuiescent }) // the supply current the chip draws by itself
    // the comparator inputs draw almost nothing: an unwired one floats like a 74HC input; an unwired RESET reads high
    for (const k of [2, 6]) {
      if (ctx.wired(k - 1)) continue
      const u = drift(p.id, k, ctx.time)
      ctx.add({ kind: 'R', id: ctx.id(`fu${k}`), a: vcc, b: pin(k), r: HC.rFloat * (1 - u) * 2 })
      ctx.add({ kind: 'R', id: ctx.id(`fd${k}`), a: pin(k), b: gnd, r: HC.rFloat * u * 2 })
      ctx.animate()
    }
    if (!ctx.wired(3)) ctx.add({ kind: 'R', id: ctx.id('rh'), a: vcc, b: pin(4), r: 10000 })
    ctx.add({ kind: 'T', id: ctx.id('t'), vcc, gnd, trg: pin(2), thr: pin(6), out: pin(3), rst: pin(4), ctl, ref, dis: pin(7) })
    // a supply wired the wrong way round drives a large current straight through the chip
    ctx.add({ kind: 'D', id: ctx.id('sub'), a: gnd, b: vcc, is: HC.diodeIs, n: 1 })
  },
  evaluate(p, env) {
    const v = (k: number) => env.v(env.pins[k - 1])
    const vs = v(8) - v(1)
    const t = env.cur(eid(p, 't'))
    const iOut = Math.abs(t?.i ?? 0)
    const iDis = Math.abs(t?.ib ?? 0)
    const sub = Math.abs(env.cur(eid(p, 'sub'))?.i ?? 0)
    const rV = vs / NE555.vMax
    const rI = Math.max(iOut, iDis) / NE555.iMax
    const rSub = sub / NE555.iMax
    return {
      live: { v: vs, out: v(3) - v(1), i: iOut + iDis },
      stress: stress(Math.max(rV, rI, rSub), () => {
        if (rSub >= Math.max(rV, rI)) return `NE555 has VCC and GND swapped: ${eng(sub, 'A')} ran straight through the chip (at most ${eng(NE555.iMax, 'A')}). Pin 8 goes to +, pin 1 to -.`
        if (rV >= rI) return `NE555 supply was ${eng(vs, 'V')}; the absolute maximum is ${NE555.vMax} V (it works on 4.5-16 V).`
        const outPin = iOut >= iDis
        return `NE555 ${outPin ? 'output (pin 3)' : 'discharge pin (pin 7)'} carried ${eng(outPin ? iOut : iDis, 'A')}; the absolute maximum is ${eng(NE555.iMax, 'A')}. Use a resistor and do not short the pin.`
      }),
    }
  },
  draw(c, p) {
    if (scene.pixel) {
      const s = dip8Sprite()
      drawSprite(c, s, -10, 0)
      drawText(c, 'NE555', 30, 26, { color: COL.dim, align: 'center' })
      if (scene.labeled.has(p.id)) drawLabelAbove(c, 'NE555 timer', 30, spriteInk(s, -10, 0).top)
      return
    }
    const top = NE_BODY.y - LEG
    const mid = NE_BODY.y + NE_BODY.h / 2
    c.fillStyle = DIP_COLORS.S
    for (let i = 0; i < 4; i++) {
      c.fillRect(i * 20 - 2, top, 4, LEG)
      c.fillRect(i * 20 - 2, NE_BODY.y + NE_BODY.h, 4, LEG)
    }
    c.fillStyle = DIP_COLORS.b
    rrect(c, NE_BODY.x, NE_BODY.y, NE_BODY.w, NE_BODY.h, 3)
    c.fill()
    c.fillStyle = COL.bg
    c.beginPath()
    c.arc(NE_BODY.x, mid, 6, -Math.PI / 2, Math.PI / 2)
    c.fill()
    drawText(c, 'NE555', NE_BODY.x + NE_BODY.w / 2, mid - 4, { color: COL.dim, align: 'center' })
    if (scene.labeled.has(p.id)) drawLabelAbove(c, 'NE555 timer', NE_BODY.x + NE_BODY.w / 2, top)
  },
  fields: () => [],
  summary: () => 'timer, VCC pin 8, GND pin 1',
}
