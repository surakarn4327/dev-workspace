// 5 V relay module: the black PCB with 1, 2, 4 or 8 Songle-style relays, each with an opto-coupler stage, a flyback diode and a
// status LED. Pins in grid units: along the bottom edge GND, IN1..INn, VCC; for channel i three screw terminals on the top edge
// (NO, COM, NC). The trigger jumper picks which level at IN pulls the relay in (low: IN to GND, high: IN to VCC).

import { COL, drawLabelAbove, drawText, rrect } from '../render/draw.ts'
import { drawSprite, pxRect, spriteInk } from '../render/pixel.ts'
import { scene } from '../render/scene.ts'
import { eng, RELAY } from '../sim/models.ts'
import { relayModuleSprite } from './art.ts'
import { eid, stress } from './common.ts'
import type { PartInstance } from '../board/world.ts'
import type { PartDef } from './types.ts'

const CHANNELS = [1, 2, 4, 8]
/** Channel pitch (world px) and the module's height. */
const PITCH = 140
const HEIGHT = 440
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
  for (let k = 1; k <= n; k++) out.push(n === 1 ? 'NO' : `NO${k}`, n === 1 ? 'COM' : `COM${k}`, n === 1 ? 'NC' : `NC${k}`)
  return out
}

/** The lamp of one channel: the LED beside the opto-coupler, lit green while the relay is pulled in (normal blend, like the gates). */
function lamp(c: CanvasRenderingContext2D, x: number, y: number, on: boolean): void {
  if (on) {
    const g = c.createRadialGradient(x, y, 0, x, y, 12)
    g.addColorStop(0, 'rgba(57,255,136,0.7)')
    g.addColorStop(0.5, 'rgba(57,255,136,0.3)')
    g.addColorStop(1, 'rgba(57,255,136,0)')
    c.fillStyle = g
    c.beginPath()
    c.arc(x, y, 12, 0, Math.PI * 2)
    c.fill()
  }
  pxRect(c, 0, 0, (x - 6) / 2, (y - 3) / 2, 6, 3, on ? COL.green : '#2a3a30')
}

/** The three-pin trigger header with its blue jumper: over H and COM for a high trigger, over COM and L for a low one. */
function jumper(c: CanvasRenderingContext2D, x: number, y: number, high: boolean): void {
  for (let k = 0; k < 3; k++) pxRect(c, 0, 0, (x + 10 * k - 3) / 2, (y - 3) / 2, 3, 3, COL.metal)
  const left = high ? x : x + 10
  pxRect(c, 0, 0, (left - 5) / 2, (y - 5) / 2, 7, 5, '#2f6cd6')
  pxRect(c, 0, 0, (left - 5) / 2, (y - 5) / 2, 7, 1, '#6f9bf0')
  drawText(c, 'H', x, y - 18, { color: INK, align: 'center', size: 6 })
  drawText(c, 'L', x + 20, y - 18, { color: INK, align: 'center', size: 6 })
}

export const relayModule: PartDef = {
  type: 'relay-module',
  name: 'Relay module 5 V',
  category: 'semiconductor',
  blurb:
    'Real 5 V relay module with opto-coupler inputs. Wire VCC to + (5 V) and GND to -. A signal on IN pulls its relay in: with the jumper on LOW the relay is on while IN is pulled to GND (the usual module), on HIGH while IN is high. Each relay has NO, COM and NC screw terminals; its contacts take 10 A.',
  pinLabels: namesFor(1),
  pinLabelsOf: (p) => namesFor(channelsOf(p)),
  hidePinLabels: true, // the names are printed on the board
  defaults: () => ({ channels: 1, trigger: 'low' }),
  pins(p) {
    const n = channelsOf(p)
    const out = [{ x: 2, y: 20 }]
    for (let k = 1; k <= n; k++) out.push({ x: 2 + k, y: 20 })
    out.push({ x: 3 + n, y: 20 })
    for (let i = 0; i < n; i++) out.push({ x: 3 + 7 * i, y: 2 }, { x: 5 + 7 * i, y: 2 }, { x: 7 + 7 * i, y: 2 })
    return out
  },
  bounds: (p) => ({ x: 0, y: 0, w: PITCH * channelsOf(p) + 60, h: HEIGHT }),
  build(p, ctx) {
    if (p.state.failed) return
    const n = channelsOf(p)
    const high = triggerOf(p) === 'high'
    const gnd = ctx.pins[0]
    const vcc = ctx.pins[n + 1]
    for (let i = 0; i < n; i++) {
      const inp = ctx.pins[1 + i]
      const no = ctx.pins[n + 2 + 3 * i]
      const com = ctx.pins[n + 3 + 3 * i]
      const nc = ctx.pins[n + 4 + 3 * i]
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
    const width = PITCH * n + 60
    if (scene.pixel) {
      const s = relayModuleSprite(n)
      drawSprite(c, s, 0, 0)
      const header = namesFor(n).slice(0, n + 2)
      header.forEach((name, k) => drawText(c, name, 40 + 20 * k, 382, { color: INK, align: 'center', size: 6 }))
      for (let i = 0; i < n; i++) {
        const x = 100 + PITCH * i
        for (const [name, dx] of [['NO', -40], ['COM', 0], ['NC', 40]] as const) drawText(c, name, x + dx, 2, { color: INK, align: 'center', size: 6 })
        drawText(c, 'SRD-05VDC-SL-C', x, 104, { color: INK, align: 'center', size: 7 })
        drawText(c, '10A 250VAC 10A 30VDC', x, 120, { color: '#a9c2f2', align: 'center', size: 6 })
        lamp(c, x - 40, 301, (live[`on${i}`] ?? 0) > 0.5)
        jumper(c, x + 20, 340, high)
      }
      if (scene.labeled.has(p.id)) drawLabelAbove(c, `Relay module ${n} ch`, width / 2, spriteInk(s, 0, 0).top)
      return
    }
    c.fillStyle = '#15151c'
    rrect(c, 0, 0, width, HEIGHT, 10)
    c.fill()
    for (let i = 0; i < n; i++) {
      const x = 100 + PITCH * i
      c.fillStyle = '#2f6cd6'
      rrect(c, x - 60, 12, 120, 56, 4)
      c.fill()
      rrect(c, x - 61, 80, 122, 150, 6)
      c.fill()
      c.fillStyle = (live[`on${i}`] ?? 0) > 0.5 ? '#39ff88' : '#2a3a30'
      c.beginPath()
      c.arc(x - 40, 301, 6, 0, Math.PI * 2)
      c.fill()
    }
    c.fillStyle = COL.metal
    for (const v of relayModule.pins(p)) {
      c.beginPath()
      c.arc(v.x * 20, v.y * 20, 5, 0, Math.PI * 2)
      c.fill()
    }
    if (scene.labeled.has(p.id)) drawLabelAbove(c, `Relay module ${n} ch`, width / 2, 0)
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
