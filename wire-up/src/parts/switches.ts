import { COL, drawText, leg, radialGlow, rrect } from '../render/draw.ts'
import { eng } from '../sim/models.ts'
import { drawSprite, pxLine, pxRect } from '../render/pixel.ts'
import { scene } from '../render/scene.ts'
import { ROCKER_I, ROCKER_O, rockerSwitchSprite, slideSwitchSprite, tactSprite } from './art.ts'
import { eid, flag, stress } from './common.ts'
import type { PartDef } from './types.ts'

const CLOSED = 0.02
const OPEN = 1e9
const SWITCH_I_MAX = 2

function contactStress(i: number): ReturnType<typeof stress> {
  return stress(Math.abs(i) / SWITCH_I_MAX, () => `Contacts carried ${eng(Math.abs(i), 'A')} (rated ${SWITCH_I_MAX} A) and welded shut. The switch is now stuck closed.`)
}

export const rockerSwitch: PartDef = {
  type: 'switch',
  name: 'Rocker switch',
  category: 'switch',
  blurb: 'Click it to flip. ON connects the two legs.',
  pinLabels: ['1', '2'],
  pinLabelPlace: 'axis',
  tipPastPin: 4,
  defaults: () => ({ on: false }),
  pins: () => [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
  ],
  bounds: () => ({ x: -6, y: -34, w: 52, h: 82 }),
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
    if (scene.pixel) {
      drawSprite(c, rockerSwitchSprite(on), -2, -30)
      // O mark (top) and I mark (bottom): the active one glows, the other stays a dim print
      const GREEN = '#39ff88'
      const RED = '#ff3b4a'
      const dim = '#5d5d6a'
      const markO = on ? dim : RED
      const markI = on ? GREEN : dim
      for (let dy = -6; dy <= 5; dy++) {
        for (let dx = -6; dx <= 5; dx++) {
          const d = Math.hypot(dx + 0.5, dy + 0.5)
          if (d >= 2.7 && d < 4.4) pxRect(c, -2, -30, ROCKER_O.x + dx, ROCKER_O.y + dy, 1, 1, markO)
        }
      }
      pxRect(c, -2, -30, ROCKER_I.x - 1, ROCKER_I.y - 3, 2, 7, markI)
      radialGlow(c, 20, -14, 38, RED, on ? 0 : 0.55)
      radialGlow(c, 20, 12, 38, GREEN, on ? 0.55 : 0)
      return
    }
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

/** The small steel slide switch: a white lever rides in a slot, left = OFF, right = ON. */
export const slideSwitch: PartDef = {
  ...rockerSwitch,
  type: 'slide-switch',
  name: 'Slide switch',
  tipPastPin: 10,
  bounds: () => ({ x: -12, y: -18, w: 64, h: 36 }),
  draw(c, p, live, time) {
    if (!scene.pixel) {
      rockerSwitch.draw(c, p, live, time)
      return
    }
    const on = p.state.failed || flag(p, 'on')
    drawSprite(c, slideSwitchSprite(), -8, -17)
    // white lever riding in the slot: dark outline, lit top and left, shaded right and bottom, two grip ridges
    const hx = on ? 16 : 4
    pxRect(c, -8, -17, hx - 1, 3, 10, 9, '#101015')
    pxRect(c, -8, -17, hx, 4, 8, 7, '#e6e6ee')
    pxRect(c, -8, -17, hx, 4, 8, 1, '#ffffff')
    pxRect(c, -8, -17, hx, 4, 1, 7, '#ffffff')
    pxRect(c, -8, -17, hx + 7, 4, 1, 7, '#a8a8b4')
    pxRect(c, -8, -17, hx, 10, 8, 1, '#9a9aa8')
    pxRect(c, -8, -17, hx + 3, 5, 1, 5, '#b8b8c4')
    pxRect(c, -8, -17, hx + 5, 5, 1, 5, '#b8b8c4')
  },
}

export const pushButton: PartDef = {
  type: 'button',
  name: 'Push button',
  category: 'switch',
  blurb: 'Tactile switch. Hold the mouse button down to press it.',
  pinLabels: ['1a', '1b', '2a', '2b'],
  pinLabelPlace: 'side',
  tipPastPin: -2,
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
    if (scene.pixel) {
      // corner legs slant from the pins into the steel shell (art-pixel diagonals, 2 px wide)
      for (const [px, py, tx, ty] of [
        [0, 0, 4, 4],
        [0, 30, 4, 26],
        [30, 0, 26, 4],
        [30, 30, 26, 26],
      ]) {
        pxLine(c, 0, 0, px - 1, py, tx - 1, ty, COL.metal)
        pxLine(c, 0, 0, px, py, tx, ty, COL.metalDark)
      }
      drawSprite(c, tactSprite(down), 4, 4)
      return
    }
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
  // only the round cap presses the button; the steel shell around it is a handle for dragging
  pressZone: (local) => Math.hypot(local.x - 30, local.y - 30) <= 18,
  press(p, down) {
    if (p.state.failed) return false
    p.params.pressed = down
    return true
  },
}
