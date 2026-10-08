import { COL, drawLabelAbove } from '../render/draw.ts'
import { drawSprite, spriteInk } from '../render/pixel.ts'
import { scene } from '../render/scene.ts'
import { eng, GATE } from '../sim/models.ts'
import type { GateFn } from '../sim/solver.ts'
import { GATE_CENTRE, GATE_ORIGIN, GATE_UNIT, gateGeometry, gateSprite } from './art.ts'
import { eid, stress } from './common.ts'
import type { PartDef } from './types.ts'

// ---------------------------------------------------------------- logic gates (symbol level, no supply pins)

const NAMES: Record<GateFn, string> = { not: 'NOT', and: 'AND', or: 'OR', nand: 'NAND', nor: 'NOR', xor: 'XOR', xnor: 'XNOR' }

const BLURBS: Record<GateFn, string> = {
  not: 'Inverter: Y is high when A is low, and low when A is high.',
  and: 'Y is high only when both A and B are high.',
  or: 'Y is high when A or B (or both) is high.',
  nand: 'AND with the output inverted: Y is low only when both A and B are high.',
  nor: 'OR with the output inverted: Y is high only when both A and B are low.',
  xor: 'Y is high when A and B are different.',
  xnor: 'Y is high when A and B are the same.',
}

function gate(fn: GateFn): PartDef {
  const two = fn !== 'not'
  const name = NAMES[fn]
  return {
    type: `gate-${fn}`,
    name: `${name} gate`,
    category: 'logic',
    blurb: BLURBS[fn],
    pinLabels: two ? ['A', 'B', 'Y'] : ['A', 'Y'],
    pinLabelPlace: 'lead',
    // inputs point left out of the body, the output right
    pinLeadDir: (i) => ({ x: i === (two ? 2 : 1) ? 1 : -1, y: 0 }),
    // the visible tip is the pin dot (3 px past an input pin on the rim) or, for the output and a lone NOT input, the rim itself
    pinTipPast: (i, pixel) => (two && i < 2 ? (pixel ? 6 : 4) : pixel ? 6 : 5),
    defaults: () => ({}),
    // inputs on the left (A over B), output on the right at the middle row
    pins: () =>
      two
        ? [
            { x: 0, y: 0 },
            { x: 0, y: 2 },
            { x: 4, y: 1 },
          ]
        : [
            { x: 0, y: 1 },
            { x: 4, y: 1 },
          ],
    bounds: () => ({ x: -8, y: -28, w: 96, h: 96 }),
    build(p, ctx) {
      if (p.state.failed) return
      // a weak pull-down on every input: an unconnected input (or one behind an open switch's leakage) reads low
      ctx.add({ kind: 'R', id: ctx.id('pda'), a: ctx.pins[0], b: 0, r: GATE.rpull })
      if (two) ctx.add({ kind: 'R', id: ctx.id('pdb'), a: ctx.pins[1], b: 0, r: GATE.rpull })
      ctx.add({
        kind: 'G',
        id: ctx.id('g'),
        fn,
        a: ctx.pins[0],
        b: two ? ctx.pins[1] : undefined,
        y: ctx.pins[two ? 2 : 1],
        vh: GATE.vh,
        vth: GATE.vth,
        w: GATE.w,
        rout: GATE.rout,
      })
    },
    evaluate(p, env) {
      const out = env.pins[two ? 2 : 1]
      const vy = env.v(out)
      const va = env.v(env.pins[0])
      const vb = two ? env.v(env.pins[1]) : 0
      const iy = env.cur(eid(p, 'g'))?.i ?? 0
      const vin = Math.max(Math.abs(va), Math.abs(vb))
      const iOut = Math.abs(iy)
      const worst = Math.max(iOut / GATE.iMax, vin / GATE.vinMax)
      return {
        live: { a: va, b: vb, y: vy, i: iy, high: vy > GATE.vh / 2 ? 1 : 0 },
        stress: stress(worst, () =>
          vin / GATE.vinMax >= iOut / GATE.iMax
            ? `${name} gate input saw ${eng(vin, 'V')}; an input can take at most ${GATE.vinMax} V.`
            : `${name} gate output sourced ${eng(iOut, 'A')} (${eng(Math.abs(vy), 'V')} on Y); it can drive at most ${eng(GATE.iMax, 'A')}. Do not short Y or fight another output: use a resistor.`,
        ),
      }
    },
    draw(c, p, live) {
      const high = (live.high ?? 0) > 0
      const pinsAt = two
        ? [{ x: 0, y: 0 }, { x: 0, y: 40 }, { x: 80, y: 20 }]
        : [{ x: 0, y: 20 }, { x: 80, y: 20 }]
      if (scene.pixel) {
        const sprite = gateSprite(fn)
        drawSprite(c, sprite, GATE_ORIGIN.x, GATE_ORIGIN.y)
        drawSymbol(c, fn)
        pinDots(c, pinsAt)
        statusDot(c, GATE_CENTRE.x, -16, high)
        if (scene.labeled.has(p.id)) drawLabelAbove(c, name, GATE_CENTRE.x, spriteInk(sprite, GATE_ORIGIN.x, GATE_ORIGIN.y).top)
        return
      }
      c.fillStyle = '#f4f6fb'
      c.strokeStyle = '#08080c'
      c.lineWidth = 1.5
      c.beginPath()
      c.arc(GATE_CENTRE.x, GATE_CENTRE.y, 44, 0, Math.PI * 2)
      c.fill()
      c.stroke()
      drawSymbol(c, fn)
      pinDots(c, pinsAt)
      statusDot(c, GATE_CENTRE.x, -16, high)
      if (scene.labeled.has(p.id)) drawLabelAbove(c, name, GATE_CENTRE.x, -25)
    },
    fields: () => [],
    summary: () => `${name} gate, 5 V logic, switches at ${GATE.vth} V`,
  }
}

/** The gate symbol and its legs as smooth dark strokes inside the disc (not pixel art). */
function drawSymbol(c: CanvasRenderingContext2D, fn: GateFn): void {
  const geo = gateGeometry(fn)
  const at = (u: number, v: number): [number, number] => [GATE_CENTRE.x + u * GATE_UNIT, GATE_CENTRE.y + v * GATE_UNIT]
  c.save()
  c.strokeStyle = '#23232b'
  c.lineWidth = 3.4
  c.lineJoin = 'round'
  c.lineCap = 'round'
  for (const poly of geo.polys) {
    c.beginPath()
    poly.forEach(([u, v], i) => (i === 0 ? c.moveTo(...at(u, v)) : c.lineTo(...at(u, v))))
    c.stroke()
  }
  for (const [u, v, r] of geo.circles) {
    c.beginPath()
    c.arc(...at(u, v), r * GATE_UNIT, 0, Math.PI * 2)
    c.stroke()
  }
  c.restore()
}

/** The pin points: small grey squares on the rim of the disc. */
function pinDots(c: CanvasRenderingContext2D, pts: { x: number; y: number }[]): void {
  for (const q of pts) {
    c.fillStyle = COL.metalDark
    c.fillRect(q.x - 3, q.y - 3, 6, 6)
    c.fillStyle = COL.metal
    c.fillRect(q.x - 3, q.y - 3, 3, 3)
  }
}

/** Small lamp on the body: lit green while Y is high. */
function statusDot(c: CanvasRenderingContext2D, x: number, y: number, high: boolean): void {
  c.fillStyle = high ? '#39ff88' : '#1d2a22'
  c.beginPath()
  c.arc(x, y, 4, 0, Math.PI * 2)
  c.fill()
  if (high) {
    c.fillStyle = 'rgba(57,255,136,0.25)'
    c.beginPath()
    c.arc(x, y, 8, 0, Math.PI * 2)
    c.fill()
  }
}

export const gateNot = gate('not')
export const gateAnd = gate('and')
export const gateOr = gate('or')
export const gateNand = gate('nand')
export const gateNor = gate('nor')
export const gateXor = gate('xor')
export const gateXnor = gate('xnor')
