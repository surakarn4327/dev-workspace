// 5 V relay module: the black PCB with 1, 2, 4 or 8 Songle-style relays, each with an opto-coupler stage, a flyback diode and a
// status LED. Pins in grid units: along the bottom edge GND, IN1..INn, VCC; for channel i three screw terminals on the top edge
// (NC, COM, NO). The trigger jumper picks which level at IN pulls the relay in (low: IN to GND, high: IN to VCC).

import { COL, drawLabelAbove, drawText, rrect } from '../render/draw.ts'
import { drawSprite, pxRect, spriteInk } from '../render/pixel.ts'
import { scene } from '../render/scene.ts'
import { eng, RELAY } from '../sim/models.ts'
import { RELAY_CHANNEL_PITCH, relayHeaderStart, relayModuleSprite, relayModuleWidth } from './art.ts'
import { eid, stress } from './common.ts'
import type { PartInstance } from '../board/world.ts'
import type { PartDef } from './types.ts'

const CHANNELS = [1, 2, 4, 8]
/** The board is 312 world px high whatever the channel count; the channels sit side by side, 2 world px per art pixel. */
const HEIGHT = 312
const PITCH = RELAY_CHANNEL_PITCH * 2
/** The opto stage: the LED side draws through 1 kohm; the driver pulls the coil in above 2 V of drive and lets go below 1 V. */
const R_IN = 1000
const DRIVE_ON = 2
const DRIVE_OFF = 1
/** Input current at which the opto-coupler's LED is overdriven (ampere). */
const I_IN_MAX = 0.05
const INK = '#e9eefc'

export function channelsOf(p: PartInstance): number {
  const v = p.params.channels
  return typeof v === 'number' && CHANNELS.includes(v) ? v : 1
}

function triggerOf(p: PartInstance): 'low' | 'high' {
  return p.params.trigger === 'high' ? 'high' : 'low'
}

function namesFor(n: number): string[] {
  const out = ['GND']
  for (let k = 1; k <= n; k++) out.push(n === 1 ? 'IN' : `IN${k}`)
  out.push('VCC')
  for (let k = 1; k <= n; k++) out.push(n === 1 ? 'NC' : `NC${k}`, n === 1 ? 'COM' : `COM${k}`, n === 1 ? 'NO' : `NO${k}`)
  return out
}

/** One SMD status LED at art (ax, ay): the 4 x 4 lens, dark while off, bright with a soft halo while on (normal blend, like the gates). */
function statusLed(c: CanvasRenderingContext2D, ax: number, ay: number, on: boolean, rgb: string, lit: string, dark: string): void {
  if (on) {
    const x = (ax + 2) * 2
    const y = (ay + 2) * 2
    const g = c.createRadialGradient(x, y, 0, x, y, 12)
    g.addColorStop(0, `rgba(${rgb},0.7)`)
    g.addColorStop(0.5, `rgba(${rgb},0.3)`)
    g.addColorStop(1, `rgba(${rgb},0)`)
    c.fillStyle = g
    c.beginPath()
    c.arc(x, y, 12, 0, Math.PI * 2)
    c.fill()
  }
  pxRect(c, 0, 0, ax, ay, 4, 4, on ? lit : dark)
  if (on) pxRect(c, 0, 0, ax, ay, 2, 1, '#ffffff')
}

/** Silkscreen text turned so the foot of the letters faces the board edge it is nearest to: left edge +90 degrees, right edge -90, top 180, bottom 0. */
function printed(c: CanvasRenderingContext2D, text: string, x: number, y: number, edge: 'left' | 'right' | 'top' | 'bottom'): void {
  const turn = { left: Math.PI / 2, right: -Math.PI / 2, top: Math.PI, bottom: 0 }[edge]
  c.save()
  c.translate(x, y)
  c.rotate(turn)
  drawText(c, text, 0, -4, { color: INK, align: 'center', size: 8 })
  c.restore()
}

export const relayModule: PartDef = {
  type: 'relay-module',
  name: 'Relay module 5 V',
  category: 'semiconductor',
  blurb:
    'Real 5 V relay module with opto-coupler inputs. Wire VCC to + (5 V) and GND to -. A signal on IN pulls its relay in: with the jumper on LOW the relay is on while IN is pulled to GND (the usual module), on HIGH while IN is high. Each relay has NC, COM and NO screw terminals; its contacts take 10 A.',
  pinLabels: namesFor(1),
  pinLabelsOf: (p) => namesFor(channelsOf(p)),
  hidePinLabels: true, // the names are printed on the board
  defaults: () => ({ channels: 1, trigger: 'low' }),
  pins(p) {
    const n = channelsOf(p)
    // the header along the bottom edge: GND, IN1..INn, VCC
    const out = []
    const first = relayHeaderStart(n) / 10
    for (let k = 0; k < n + 2; k++) out.push({ x: first + k, y: 14 })
    // the screw terminals, one block per channel in a row along the top edge, each reading NC, COM, NO from the left
    for (let i = 0; i < n; i++) out.push({ x: 2 + (PITCH / 20) * i, y: 2 }, { x: 4 + (PITCH / 20) * i, y: 2 }, { x: 6 + (PITCH / 20) * i, y: 2 })
    return out
  },
  bounds: (p) => ({ x: 0, y: 0, w: relayModuleWidth(channelsOf(p)) * 2, h: HEIGHT }),
  build(p, ctx) {
    if (p.state.failed) return
    const n = channelsOf(p)
    const high = triggerOf(p) === 'high'
    const gnd = ctx.pins[0]
    const vcc = ctx.pins[n + 1]
    for (let i = 0; i < n; i++) {
      const inp = ctx.pins[1 + i]
      const nc = ctx.pins[n + 2 + 3 * i]
      const com = ctx.pins[n + 3 + 3 * i]
      const no = ctx.pins[n + 4 + 3 * i]
      const low = ctx.newNode() // the bottom of the coil, switched to GND by the driver stage
      ctx.add({ kind: 'R', id: ctx.id(`c${i}`), a: vcc, b: low, r: RELAY.rCoil })
      ctx.add({ kind: 'D', id: ctx.id(`fb${i}`), a: low, b: vcc, is: 1e-14, n: 1 }) // the flyback diode across the coil
      // the opto-coupler's LED: from VCC down to IN (low trigger) or from IN down to GND (high trigger)
      ctx.add({ kind: 'R', id: ctx.id(`ri${i}`), a: high ? inp : vcc, b: high ? gnd : inp, r: R_IN })
      // the driver: a switch from the coil's bottom to GND that follows the LED's drive
      ctx.add({
        kind: 'Y',
        id: ctx.id(`d${i}`),
        c1: high ? inp : vcc,
        c2: high ? gnd : inp,
        com: low,
        no: gnd,
        nc: ctx.newNode(),
        vPull: DRIVE_ON,
        vDrop: DRIVE_OFF,
      })
      // the relay: the coil's own voltage pulls the contacts over
      ctx.add({ kind: 'Y', id: ctx.id(`k${i}`), c1: vcc, c2: low, com, no, nc })
    }
  },
  evaluate(p, env) {
    const n = channelsOf(p)
    const vs = env.v(env.pins[n + 1]) - env.v(env.pins[0])
    const live: Record<string, number> = { v: vs }
    let worstContact = 0
    let worstIn = 0
    let on = 0
    for (let i = 0; i < n; i++) {
      const k = env.cur(eid(p, `k${i}`))
      const isOn = (k?.ib ?? 0) > 0.5
      const ic = Math.abs(k?.i ?? 0)
      const iin = Math.abs(env.cur(eid(p, `ri${i}`))?.i ?? 0)
      live[`on${i}`] = isOn ? 1 : 0
      live[`ic${i}`] = ic
      if (isOn) on++
      worstContact = Math.max(worstContact, ic)
      worstIn = Math.max(worstIn, iin)
    }
    live.on = on
    const rV = Math.abs(vs) / RELAY.vCoilMax
    const rI = worstContact / RELAY.iContactMax
    const rIn = worstIn / I_IN_MAX
    return {
      live,
      stress: stress(Math.max(rV, rI, rIn), () => {
        if (rI >= rV && rI >= rIn) return `A relay contact carried ${eng(worstContact, 'A')}; the contacts are rated ${RELAY.iContactMax} A. Use a load with a resistor or a smaller load.`
        if (rIn >= rV) return `An input carried ${eng(worstIn, 'A')} through its opto-coupler; at most ${eng(I_IN_MAX, 'A')}. Drive IN from a logic pin or a switch, not straight from a source.`
        return `The module supply was ${eng(Math.abs(vs), 'V')}; the relay coils are 5 V parts and burn out above about ${RELAY.vCoilMax} V.`
      }),
    }
  },
  draw(c, p, live) {
    const n = channelsOf(p)
    const high = triggerOf(p) === 'high'
    const width = relayModuleWidth(n) * 2
    if (scene.pixel) {
      const s = relayModuleSprite(n)
      drawSprite(c, s, 0, 0)
      // printed on the board, the foot of each label turned toward the edge it is nearest to
      for (let i = 0; i < n; i++) {
        const dx = PITCH * i
        const ax = RELAY_CHANNEL_PITCH * i
        const on = (live[`on${i}`] ?? 0) > 0.5
        printed(c, n === 1 ? 'NC' : `NC${i + 1}`, 40 + dx, 6, 'top')
        printed(c, n === 1 ? 'COM' : `COM${i + 1}`, 80 + dx, 6, 'top')
        printed(c, n === 1 ? 'NO' : `NO${i + 1}`, 120 + dx, 6, 'top')
        drawText(c, 'SRD-05VDC-SL-C', 80 + dx, 130, { color: INK, align: 'center', size: 8 })
        drawText(c, '10A 250VAC 10A 30VDC', 80 + dx, 146, { color: '#a9c2f2', align: 'center', size: 8 })
        // the red LED: this relay is pulled in; the green LED: the board has power (every channel shows its own)
        statusLed(c, 38 + ax, 126, on, '255,60,60', '#ff4a4a', '#3a1a1a')
        statusLed(c, 38 + ax, 116, (live.v ?? 0) >= 2.5, '57,255,136', COL.green, '#1a3a22')
      }
      if (n === 1) {
        // one channel: the jumper stands in a column at the right edge, a little higher than the header (names on its left)
        const jx = relayModuleWidth(n) - 10
        pxRect(c, 0, 0, jx, 126, 7, 17, '#0c0c12')
        pxRect(c, 0, 0, jx, 126, 7, 1, '#3c3c46')
        for (const y of [128, 133, 138]) {
          pxRect(c, 0, 0, jx + 2, y, 3, 3, COL.metal)
          pxRect(c, 0, 0, jx + 2, y, 1, 1, '#ffffff')
        }
        const cap = high ? 127 : 132
        pxRect(c, 0, 0, jx + 1, cap + 1, 5, 5, '#2f6cd6') // a rounded cap: the four corner pixels are left out
        pxRect(c, 0, 0, jx + 2, cap, 3, 1, '#8db3ff')
        pxRect(c, 0, 0, jx + 1, cap + 1, 1, 5, '#8db3ff')
        pxRect(c, 0, 0, jx + 5, cap + 1, 1, 5, '#22448a')
        pxRect(c, 0, 0, jx + 2, cap + 6, 3, 1, '#22448a')
        printed(c, 'H', 2 * (jx - 4), 2 * 129.5, 'left')
        printed(c, 'L', 2 * (jx - 4), 2 * 139.5, 'left')
      } else {
        // more channels: the header runs right from under the first socket as inputs are added, and the jumper is a row of three
        // pins on the same line, 2 grid steps (20 art pixels) after the last header pin, its names outside (below) like the header's
        const jx = relayHeaderStart(n) + 10 * (n + 1) + 20
        pxRect(c, 0, 0, jx - 6, 134, 32, 12, '#0c0c12')
        pxRect(c, 0, 0, jx - 6, 134, 32, 1, '#3c3c46')
        for (let k = 0; k < 3; k++) {
          const x = jx + 10 * k
          pxRect(c, 0, 0, x - 3, 137, 6, 6, '#16161b')
          pxRect(c, 0, 0, x - 2, 138, 4, 4, '#7d838f')
          pxRect(c, 0, 0, x - 2, 138, 3, 3, COL.metal)
          pxRect(c, 0, 0, x - 2, 138, 1, 1, '#f4f7fb')
        }
        // the blue cap lies over two pins: H and COM (HIGH) or COM and L (LOW)
        const cx = high ? jx - 4 : jx + 6
        pxRect(c, 0, 0, cx, 135, 18, 10, '#2f6cd6')
        pxRect(c, 0, 0, cx + 1, 135, 16, 1, '#8db3ff')
        pxRect(c, 0, 0, cx, 136, 1, 8, '#8db3ff')
        pxRect(c, 0, 0, cx + 17, 136, 1, 8, '#22448a')
        pxRect(c, 0, 0, cx + 1, 144, 16, 1, '#22448a')
        printed(c, 'H', 2 * jx, 296, 'bottom')
        printed(c, 'L', 2 * (jx + 20), 296, 'bottom')
      }
      // the header names under the pins
      namesFor(n)
        .slice(0, n + 2)
        .forEach((name, k) => printed(c, name, 2 * relayHeaderStart(n) + 20 * k, 296, 'bottom'))
      if (scene.labeled.has(p.id)) drawLabelAbove(c, `Relay module ${n} ch`, width / 2, spriteInk(s, 0, 0).top)
      return
    }
    c.fillStyle = '#15151c'
    rrect(c, 0, 0, width, HEIGHT, 10)
    c.fill()
    c.strokeStyle = '#3a3a46' // a lit rim, so the board's edge is a visible edge
    c.lineWidth = 2
    c.stroke()
    for (let i = 0; i < n; i++) {
      const dx = PITCH * i
      c.fillStyle = '#2f6cd6'
      rrect(c, 16 + dx, 12, 128, 56, 4)
      c.fill()
      rrect(c, 16 + dx, 78, 128, 142, 6)
      c.fill()
      c.fillStyle = (live[`on${i}`] ?? 0) > 0.5 ? '#ff4a4a' : '#3a1a1a'
      c.beginPath()
      c.arc(80 + dx, 256, 5, 0, Math.PI * 2)
      c.fill()
    }
    c.fillStyle = COL.metal
    for (const v of relayModule.pins(p)) {
      c.beginPath()
      c.arc(v.x * 20, v.y * 20, 5, 0, Math.PI * 2)
      c.fill()
    }
    if (scene.labeled.has(p.id)) drawLabelAbove(c, `Relay module ${n} ch`, width / 2, -1) // -1: the rim's stroke reaches 1 px out
  },
  fields: () => [
    {
      kind: 'select',
      key: 'channels',
      label: 'Channels',
      options: CHANNELS.map((n) => ({ value: n, label: `${n} channel${n > 1 ? 's' : ''}` })),
    },
    {
      kind: 'select',
      key: 'trigger',
      label: 'Trigger (jumper)',
      options: [
        { value: 'low', label: 'LOW: IN to GND pulls in' },
        { value: 'high', label: 'HIGH: IN to VCC pulls in' },
      ],
    },
  ],
  summary: (p) => `${channelsOf(p)} channel${channelsOf(p) > 1 ? 's' : ''}, ${triggerOf(p).toUpperCase()} trigger${p.state.failed ? ', burnt' : ''}`,
}
