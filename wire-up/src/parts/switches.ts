import { COL, drawText, leg, rrect } from '../render/draw.ts'
import { eng } from '../sim/models.ts'
import { eid, flag, stress } from './common.ts'
import type { PartDef } from './types.ts'

const CLOSED = 0.02
const OPEN = 1e9
const SWITCH_I_MAX = 2

function contactStress(i: number): ReturnType<typeof stress> {
  return stress(Math.abs(i) / SWITCH_I_MAX, () => `Contacts carried ${eng(Math.abs(i), 'A')} (rated ${SWITCH_I_MAX} A) and welded shut. The switch is now stuck closed.`)
}

export const slideSwitch: PartDef = {
  type: 'switch',
  name: 'Slide switch',
  category: 'switch',
  blurb: 'Click it to flip. ON connects the two legs.',
  pinLabels: ['1', '2'],
  defaults: () => ({ on: false }),
  pins: () => [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
  ],
  bounds: () => ({ x: -12, y: -18, w: 64, h: 36 }),
  build(p, ctx) {
    const closed = p.state.failed || flag(p, 'on')
    ctx.add({ kind: 'R', id: ctx.id('s'), a: ctx.pins[0], b: ctx.pins[1], r: closed ? CLOSED : OPEN })
  },
  evaluate(p, env) {
    const c = env.cur(eid(p, 's'))
    const i = c ? c.i : 0
    return { live: { i, v: env.v(env.pins[0]) - env.v(env.pins[1]) }, stress: contactStress(i) }
  },
  draw(c, p) {
    const on = p.state.failed || flag(p, 'on')
    leg(c, 0, 0, 0, -6)
    leg(c, 40, 0, 40, -6)
    c.fillStyle = '#c4c9d1'
    rrect(c, -8, -17, 56, 34, 3)
    c.fill()
    c.fillStyle = '#1d1e24'
    rrect(c, -5, -14, 50, 28, 2)
    c.fill()
    c.fillStyle = '#0a0a0d'
    c.fillRect(2, -5, 36, 10)
    // lever
    const kx = on ? 22 : 4
    c.fillStyle = on ? '#39ff88' : '#e6e6ee'
    rrect(c, kx, -9, 14, 18, 2)
    c.fill()
    c.fillStyle = 'rgba(0,0,0,0.3)'
    c.fillRect(kx + 5, -9, 1, 18)
    c.fillRect(kx + 9, -9, 1, 18)
    drawText(c, on ? 'ON' : 'OFF', 20, 20, { color: on ? COL.green : COL.dim, align: 'center', size: 11 })
  },
  fields: () => [{ kind: 'toggle', key: 'on', label: 'Switch is ON' }],
  summary: (p) => (p.state.failed ? 'welded shut' : flag(p, 'on') ? 'ON (closed)' : 'OFF (open)'),
  click(p) {
    if (p.state.failed) return false
    p.params.on = !flag(p, 'on')
    return true
  },
}

export const pushButton: PartDef = {
  type: 'button',
  name: 'Push button',
  category: 'switch',
  blurb: 'Tactile switch. Hold the mouse button down to press it.',
  pinLabels: ['1a', '1b', '2a', '2b'],
  defaults: () => ({ pressed: false }),
  pins: () => [
    { x: 0, y: 0 },
    { x: 0, y: 3 },
    { x: 3, y: 0 },
    { x: 3, y: 3 },
  ],
  bounds: () => ({ x: -4, y: -4, w: 68, h: 68 }),
  build(p, ctx) {
    ctx.add({ kind: 'R', id: ctx.id('j1'), a: ctx.pins[0], b: ctx.pins[1], r: CLOSED })
    ctx.add({ kind: 'R', id: ctx.id('j2'), a: ctx.pins[2], b: ctx.pins[3], r: CLOSED })
    const closed = p.state.failed || flag(p, 'pressed')
    ctx.add({ kind: 'R', id: ctx.id('s'), a: ctx.pins[0], b: ctx.pins[2], r: closed ? CLOSED : OPEN })
  },
  evaluate(p, env) {
    const c = env.cur(eid(p, 's'))
    const i = c ? c.i : 0
    return { live: { i, v: env.v(env.pins[0]) - env.v(env.pins[2]) }, stress: contactStress(i) }
  },
  draw(c, p) {
    const down = p.state.failed || flag(p, 'pressed')
    const corners = [
      [0, 0],
      [0, 60],
      [60, 0],
      [60, 60],
    ]
    for (const [x, y] of corners) leg(c, x, y, x + (x === 0 ? 8 : -8), y + (y === 0 ? 8 : -8))
    c.fillStyle = '#c4c9d1'
    rrect(c, 6, 6, 48, 48, 4)
    c.fill()
    c.fillStyle = '#1b1c21'
    rrect(c, 9, 9, 42, 42, 3)
    c.fill()
    c.fillStyle = down ? '#1f4a33' : '#2b2d35'
    c.beginPath()
    c.arc(30, 30, down ? 14 : 15, 0, Math.PI * 2)
    c.fill()
    c.strokeStyle = down ? COL.green : '#464a58'
    c.lineWidth = 2
    c.stroke()
    c.fillStyle = 'rgba(255,255,255,0.15)'
    c.beginPath()
    c.arc(26, 25, 5, 0, Math.PI * 2)
    c.fill()
  },
  fields: () => [],
  summary: (p) => (p.state.failed ? 'welded shut' : flag(p, 'pressed') ? 'pressed' : 'released'),
  press(p, down) {
    if (p.state.failed) return false
    p.params.pressed = down
    return true
  },
}
