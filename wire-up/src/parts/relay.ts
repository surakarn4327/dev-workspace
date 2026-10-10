// 5 V PCB relay (Songle SRD-05VDC-SL-C style): a 70 ohm coil that pulls a changeover contact in. The coil and the contacts are
// separate circuits. Pins in grid units: two coil pins on the left, COM top right, NC and NO along the bottom.

import { COL, drawLabelAbove, drawText, rrect } from '../render/draw.ts'
import { drawSprite, pxRect, spriteInk } from '../render/pixel.ts'
import { scene } from '../render/scene.ts'
import { eng, RELAY } from '../sim/models.ts'
import { RELAY_PADS, relaySprite } from './art.ts'
import { eid, stress } from './common.ts'
import type { PartDef } from './types.ts'

const ORIGIN = { x: -8, y: -32 }
const LAMP = { x: 126, y: -22 }
const INK = '#dbe7ff'

/** The status lamp: one green art pixel block with a soft halo while the armature is pulled in (normal blend, like the gates). */
function lamp(c: CanvasRenderingContext2D, on: boolean): void {
  if (on) {
    const g = c.createRadialGradient(LAMP.x, LAMP.y, 0, LAMP.x, LAMP.y, 9)
    g.addColorStop(0, 'rgba(57,255,136,0.7)')
    g.addColorStop(0.5, 'rgba(57,255,136,0.3)')
    g.addColorStop(1, 'rgba(57,255,136,0)')
    c.fillStyle = g
    c.beginPath()
    c.arc(LAMP.x, LAMP.y, 9, 0, Math.PI * 2)
    c.fill()
  }
  pxRect(c, 0, 0, (LAMP.x - 2) / 2, (LAMP.y - 2) / 2, 2, 2, on ? COL.green : '#0f2038')
}

/** The pin names printed beside the pads (pin coordinates in world px). */
const NAMES: Array<[string, number, number, number]> = [
  ['COIL', 0, -17, 0],
  ['COIL', 0, 68, 0],
  ['COM', 100, -17, 0],
  ['NC', 60, 68, 0],
  ['NO', 140, 68, 0],
]

export const relay5v: PartDef = {
  type: 'relay-5v',
  name: 'Relay 5 V',
  category: 'semiconductor',
  blurb:
    'Real 5 V relay (SRD-05VDC-SL-C). The coil (70 ohm, no polarity) pulls in at 3.75 V and lets go below 0.5 V: COM then joins NO, otherwise COM joins NC. The coil and the contacts are separate circuits. Contacts take 10 A at most.',
  pinLabels: ['COIL', 'COIL', 'COM', 'NC', 'NO'],
  hidePinLabels: true, // the names are printed beside the pads
  defaults: () => ({}),
  pins: () => [
    { x: 0, y: 0 },
    { x: 0, y: 3 },
    { x: 5, y: 0 },
    { x: 3, y: 3 },
    { x: 7, y: 3 },
  ],
  bounds: () => ({ x: -8, y: -32, w: 156, h: 124 }),
  build(p, ctx) {
    if (p.state.failed) return
    ctx.add({ kind: 'R', id: ctx.id('coil'), a: ctx.pins[0], b: ctx.pins[1], r: RELAY.rCoil })
    ctx.add({ kind: 'Y', id: ctx.id('k'), c1: ctx.pins[0], c2: ctx.pins[1], com: ctx.pins[2], nc: ctx.pins[3], no: ctx.pins[4] })
  },
  evaluate(p, env) {
    const vc = env.v(env.pins[0]) - env.v(env.pins[1])
    const coil = env.cur(eid(p, 'coil'))
    const k = env.cur(eid(p, 'k'))
    const iContact = Math.abs(k?.i ?? 0)
    const on = (k?.ib ?? 0) > 0.5
    const rV = Math.abs(vc) / RELAY.vCoilMax
    const rI = iContact / RELAY.iContactMax
    return {
      live: { v: vc, i: coil?.i ?? 0, on: on ? 1 : 0, ic: iContact },
      stress: stress(Math.max(rV, rI), () =>
        rI > rV
          ? `Relay contact carried ${eng(iContact, 'A')}; the contacts are rated ${RELAY.iContactMax} A. Use a load with a resistor or a smaller load.`
          : `Relay coil had ${eng(Math.abs(vc), 'V')} across it (${eng(Math.abs(vc) / RELAY.rCoil, 'A')}); it is a ${RELAY.vRated} V coil and burns out above about ${RELAY.vCoilMax} V.`,
      ),
    }
  },
  draw(c, p, live) {
    const on = (live.on ?? 0) > 0.5
    if (scene.pixel) {
      const s = relaySprite()
      drawSprite(c, s, ORIGIN.x, ORIGIN.y)
      drawText(c, 'SRD-05VDC-SL-C', 70, 14, { color: INK, align: 'center' })
      drawText(c, '10A 250VAC 10A 30VDC', 70, 28, { color: '#a9c2f2', align: 'center' })
      for (const [name, x, y] of NAMES) drawText(c, name, x, y, { color: INK, align: 'center', size: 7 })
      lamp(c, on)
      if (scene.labeled.has(p.id)) drawLabelAbove(c, 'Relay 5 V', 70, spriteInk(s, ORIGIN.x, ORIGIN.y).top)
      return
    }
    c.fillStyle = '#3b6cc9'
    rrect(c, ORIGIN.x, ORIGIN.y, 156, 124, 6)
    c.fill()
    c.fillStyle = COL.metal
    for (const [cx, cy] of RELAY_PADS) {
      c.beginPath()
      c.arc(ORIGIN.x + cx * 2, ORIGIN.y + cy * 2, 4.5, 0, Math.PI * 2)
      c.fill()
    }
    drawText(c, 'SRD-05VDC-SL-C', 70, 14, { color: INK, align: 'center' })
    c.fillStyle = on ? '#39ff88' : '#0f2038'
    c.beginPath()
    c.arc(LAMP.x, LAMP.y, 4, 0, Math.PI * 2)
    c.fill()
    if (scene.labeled.has(p.id)) drawLabelAbove(c, 'Relay 5 V', 70, ORIGIN.y)
  },
  fields: () => [],
  summary: (p) => `5 V coil, 70 ohm${p.state.failed ? ', burnt' : ''}`,
}
