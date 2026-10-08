import { COL, drawText, leg, rrect } from '../render/draw.ts'
import { drawSprite } from '../render/pixel.ts'
import { scene } from '../render/scene.ts'
import { eng, GATE } from '../sim/models.ts'
import type { GateFn } from '../sim/solver.ts'
import { gateSprite } from './art.ts'
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

/** Gate body in local px: the sprite is 48 x 56 world px with its top left at (16, -8); legs run from the pins to its edge. */
const BODY_X = 16
const BODY_Y = -8
const BODY_W = 48
const BODY_H = 56

function gate(fn: GateFn): PartDef {
  const two = fn !== 'not'
  const inverting = fn === 'not' || fn === 'nand' || fn === 'nor' || fn === 'xnor'
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
    tipPastPin: 0,
    tipPastPinVector: 2,
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
    bounds: () => ({ x: -10, y: BODY_Y - 4, w: 100, h: BODY_H + 8 }),
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
    draw(c, _p, live) {
      const high = (live.high ?? 0) > 0
      const outX = 4 * 20
      if (scene.pixel) {
        c.fillStyle = COL.metal
        c.fillRect(0, two ? -2 : 18, BODY_X + 8, 2)
        c.fillRect(outX - 18, 18, 18, 2)
        c.fillStyle = COL.metalDark
        c.fillRect(0, two ? 0 : 20, BODY_X + 8, 2)
        c.fillRect(outX - 18, 20, 18, 2)
        if (two) {
          c.fillStyle = COL.metal
          c.fillRect(0, 38, BODY_X + 8, 2)
          c.fillStyle = COL.metalDark
          c.fillRect(0, 40, BODY_X + 8, 2)
        }
        drawSprite(c, gateSprite(fn), BODY_X, BODY_Y)
        statusDot(c, inverting ? 36 : 40, 20, high)
        return
      }
      leg(c, 0, two ? 0 : 20, BODY_X + 8, two ? 0 : 20)
      if (two) leg(c, 0, 40, BODY_X + 8, 40)
      leg(c, outX - 18, 20, outX, 20)
      c.fillStyle = '#4a577d'
      rrect(c, BODY_X, BODY_Y, BODY_W - (inverting ? 8 : 0), BODY_H, 8)
      c.fill()
      if (inverting) {
        c.beginPath()
        c.arc(BODY_X + BODY_W - 4, 20, 4, 0, Math.PI * 2)
        c.fill()
      }
      drawText(c, name, BODY_X + (BODY_W - (inverting ? 8 : 0)) / 2, 8, { color: '#b9b4e8', align: 'center', size: 6 })
      statusDot(c, inverting ? 36 : 40, 20, high)
    },
    fields: () => [],
    summary: () => `${name} gate, 5 V logic, switches at ${GATE.vth} V`,
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
