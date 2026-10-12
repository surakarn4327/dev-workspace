// Arduino Uno R3: the board with its two rows of female headers (top: SCL SDA AREF GND 13..8, 7..0; bottom: NC IOREF RESET 3V3 5V
// GND GND VIN, A0..A5), a USB-B socket on the left and the plug in it. The plug is the board's power: pull it out (click the
// socket) and the board goes dark, like a switch. Every wired I/O pin is a pad of the ATmega328P (`McuPinElement`): a driven pad
// is 5 V or 0 V behind 25 ohm, an input pad draws nothing, and every pad has the two protection diodes to the rails.

import { COL, drawLabelAbove, drawText, rrect } from '../render/draw.ts'
import { drawSprite, spriteInk } from '../render/pixel.ts'
import { scene } from '../render/scene.ts'
import { eng, LED_COLORS, LED_N, ledIs, MCU } from '../sim/models.ts'
import { UNO_HEADERS, UNO_LAMPS, UNO_PAD, UNO_PLUG, UNO_RESET, UNO_USB, unoBoardSprite, unoHeaderSprite, unoLensSprite, unoPlugSprite, unoResetSprite } from './art.ts'
import { eid, flag, stress } from './common.ts'
import type { PartInstance } from '../board/world.ts'
import type { PartDef } from './types.ts'

/** Pin names in pin order: along the top edge left to right, then along the bottom edge left to right. */
export const UNO_PINS = [
  'SCL', 'SDA', 'AREF', 'GND', 'D13', 'D12', 'D11', 'D10', 'D9', 'D8',
  'D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'D1', 'D0',
  'NC', 'IOREF', 'RESET', '3V3', '5V', 'GND', 'GND', 'VIN',
  'A0', 'A1', 'A2', 'A3', 'A4', 'A5',
]

/** Pin index of the arduino pin number `n`: 0..13 are D0..D13, 14..19 are A0..A5. */
export function padOf(n: number): number {
  return n <= 13 ? 17 - n : 26 + (n - 14)
}

const GND_TOP = 3
const GND_B1 = 23
const GND_B2 = 24
const IOREF = 19
const RESET = 20
const V33 = 21
const V5 = 22
/** Pin indices of the 20 I/O pads (D0..D13 then A0..A5). */
const IO = Array.from({ length: 20 }, (_, n) => padOf(n))
const L_LED_PAD = padOf(13)
const PWM_PINS = new Set([3, 5, 6, 9, 10, 11])
const INK = '#eef4ff'
/** The lamp that says the board has power draws a milliamp or so; below half of that it is dark. */
const LAMP_ON = 0.0005

/** What is printed beside each pin on the board (as on the Pololu photo: SCL and SDA carry no name on this revision). */
function printedName(idx: number): string {
  const name = UNO_PINS[idx]
  if (/^D\d+$/.test(name)) {
    const n = Number(name.slice(1))
    if (n === 0) return 'RX<0'
    if (n === 1) return 'TX>1'
    return `${PWM_PINS.has(n) ? '~' : ''}${n}`
  }
  if (name === 'NC' || name === 'SCL' || name === 'SDA') return ''
  if (name === '3V3') return '3.3V'
  if (name === 'VIN') return 'Vin'
  return name
}

/** Silkscreen lettering is heavier than the pixel font: the same text twice, one world pixel apart. */
function bold(c: CanvasRenderingContext2D, text: string, x: number, y: number, align: 'left' | 'center' | 'right', color: string, size: number): void {
  drawText(c, text, x, y, { color, align, size })
  drawText(c, text, x + 1, y, { color, align, size })
}

/**
 * A pin name printed on the board as on the real one: turned a quarter so it reads upward along the pin's column. Under the top
 * header it ends 8 pixels under the header; over the bottom header it starts 4 above it.
 */
function printed(c: CanvasRenderingContext2D, text: string, x: number, y: number, edge: 'top' | 'bottom', size: number): void {
  c.save()
  c.translate(x, y)
  c.rotate(-Math.PI / 2)
  bold(c, text, 0, -size / 2 - 1, edge === 'top' ? 'right' : 'left', INK, size)
  c.restore()
}

/** Small lettering turned a quarter, reading upward, centred on (x, y). */
function turnedText(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string): void {
  c.save()
  c.translate(x, y)
  c.rotate(-Math.PI / 2)
  drawText(c, text, 0, -size / 2, { color, align: 'center', size })
  c.restore()
}

function plugged(p: PartInstance): boolean {
  return flag(p, 'usb')
}

/** Where the plug sits in world px (its sprite's top-left): the collar's end 15 art pixels inside the socket's mouth, centred on it. */
const PLUG_AT = { x: (-15 - UNO_PLUG.w) * 2, y: (UNO_USB.y + UNO_USB.h / 2 - UNO_PLUG.h / 2) * 2 }

function inSocket(p: PartInstance, x: number, y: number): boolean {
  const socket = x >= (UNO_USB.x - 2) * 2 && x <= (UNO_USB.x + UNO_USB.w) * 2 && y >= UNO_USB.y * 2 && y <= (UNO_USB.y + UNO_USB.h) * 2
  const plug = plugged(p) && x >= PLUG_AT.x && x <= PLUG_AT.x + UNO_PLUG.w * 2 && y >= PLUG_AT.y && y <= PLUG_AT.y + UNO_PLUG.h * 2
  return socket || plug
}

export const arduinoUno: PartDef = {
  type: 'arduino-uno',
  name: 'Arduino Uno R3',
  category: 'board',
  blurb:
    'Arduino Uno R3 with an ATmega328P. The USB plug powers it: click the socket to pull the plug out or push it in. Pins D0-D13 and A0-A5 each give 5 V or 0 V behind 25 ohm and take at most 40 mA (200 mA all together); the 5V pin gives at most 500 mA, 3V3 at most 50 mA. VIN and the DC jack do nothing yet.',
  pinLabels: UNO_PINS,
  hidePinLabels: true, // the names are printed on the board
  runtimeKeys: ['usb'],
  defaults: () => ({ usb: true, pressed: false }),
  pins() {
    const out: { x: number; y: number }[] = []
    for (const h of UNO_HEADERS) for (let k = 0; k < h.n; k++) out.push({ x: h.x + k, y: h.y })
    return out
  },
  bounds: (p) => (plugged(p) ? { x: PLUG_AT.x - 4, y: 0, w: 540 - PLUG_AT.x + 4, h: 420 } : { x: -54, y: 0, w: 594, h: 420 }),
  sourceNegPin: (p) => (plugged(p) && !p.state.failed ? GND_TOP : null),
  build(p, ctx) {
    if (p.state.failed) return
    const gnd = ctx.pins[GND_TOP]
    const v5 = ctx.pins[V5]
    // the board's three grounds and its IOREF are one net each
    ctx.add({ kind: 'R', id: ctx.id('g1'), a: gnd, b: ctx.pins[GND_B1], r: 0.001 })
    ctx.add({ kind: 'R', id: ctx.id('g2'), a: gnd, b: ctx.pins[GND_B2], r: 0.001 })
    ctx.add({ kind: 'R', id: ctx.id('io'), a: v5, b: ctx.pins[IOREF], r: 0.001 })
    if (plugged(p)) {
      // the USB port: 5 V behind the cable and the resettable fuse; the 3.3 V regulator hangs on it
      ctx.add({ kind: 'B', id: ctx.id('usb'), a: v5, b: gnd, v: 5, r: MCU.rUsb })
      ctx.add({ kind: 'B', id: ctx.id('v33'), a: ctx.pins[V33], b: gnd, v: 3.3, r: MCU.r33 })
    }
    // the power LED: a milliamp or two through its resistor, so it only lights when 5 V really is across the board
    const pw = ctx.newNode()
    const green = LED_COLORS.green
    ctx.add({ kind: 'R', id: ctx.id('pw'), a: v5, b: pw, r: 1000 })
    ctx.add({ kind: 'D', id: ctx.id('pwd'), a: pw, b: gnd, is: ledIs(green.vf10), n: LED_N })
    // RESET is pulled up by 10 k; the button pulls it down
    ctx.add({ kind: 'R', id: ctx.id('rp'), a: v5, b: ctx.pins[RESET], r: 10000 })
    if (flag(p, 'pressed')) ctx.add({ kind: 'R', id: ctx.id('rb'), a: ctx.pins[RESET], b: gnd, r: 1 })
    // a supply wired the wrong way round drives a large current straight through the chip
    ctx.add({ kind: 'D', id: ctx.id('sub'), a: gnd, b: v5, is: MCU.diodeIs, n: 1 })
    // the pads: only those something is wired to (and D13, which has the board's own L LED on it)
    for (const idx of IO) {
      if (!ctx.wired(idx) && idx !== L_LED_PAD) continue
      const pin = ctx.pins[idx]
      ctx.add({ kind: 'P', id: ctx.id(`p${idx}`), pin, vcc: v5, gnd })
      ctx.add({ kind: 'D', id: ctx.id(`cu${idx}`), a: pin, b: v5, is: MCU.diodeIs, n: 1 })
      ctx.add({ kind: 'D', id: ctx.id(`cd${idx}`), a: gnd, b: pin, is: MCU.diodeIs, n: 1 })
    }
    const yellow = LED_COLORS.yellow
    const l = ctx.newNode()
    ctx.add({ kind: 'R', id: ctx.id('l'), a: ctx.pins[L_LED_PAD], b: l, r: 1000 })
    ctx.add({ kind: 'D', id: ctx.id('ld'), a: l, b: gnd, is: ledIs(yellow.vf10), n: LED_N })
  },
  evaluate(p, env) {
    const vs = env.v(env.pins[V5]) - env.v(env.pins[GND_TOP])
    const amps = (suffix: string): number => Math.abs(env.cur(eid(p, suffix))?.i ?? 0)
    const usb = amps('usb')
    const v33 = amps('v33')
    const sub = amps('sub')
    let worstPad = 0
    let worstIdx = IO[0]
    let sourced = 0
    let sunk = 0
    for (const idx of IO) {
      const pad = env.cur(eid(p, `p${idx}`))
      const up = env.cur(eid(p, `cu${idx}`))?.i ?? 0
      const down = env.cur(eid(p, `cd${idx}`))?.i ?? 0
      // what the pad delivers into whatever is wired to it: the driver's current plus the protection diodes'
      const out = (pad?.i ?? 0) + (pad?.ib ?? 0) + down - up
      if (Math.abs(out) > worstPad) {
        worstPad = Math.abs(out)
        worstIdx = idx
      }
      if (out > 0) sourced += out
      else sunk -= out
    }
    const lamp = (suffix: string): number => (amps(suffix) >= LAMP_ON ? 1 : 0)
    const rPad = worstPad / MCU.iPinMax
    const rTotal = Math.max(sourced, sunk) / MCU.iTotalMax
    const rUsb = usb / MCU.iUsbMax
    const r33 = v33 / MCU.i33Max
    const rV = Math.max(vs, 0) / MCU.vMax
    const rSub = sub / MCU.iTotalMax
    return {
      live: { v: vs, i: usb, i33: v33, pw: lamp('pwd'), l: lamp('ld'), usb: plugged(p) ? 1 : 0 },
      stress: stress(Math.max(rPad, rTotal, rUsb, r33, rV, rSub), () => {
        const top = Math.max(rPad, rTotal, rUsb, r33, rV, rSub)
        if (rSub === top) return `The Uno has 5V and GND the wrong way round: ${eng(sub, 'A')} ran straight through the chip (at most ${eng(MCU.iTotalMax, 'A')}). 5V goes to +, GND to -.`
        if (rV === top) return `The Uno's 5 V rail was ${eng(vs, 'V')}; the ATmega328P takes at most ${MCU.vMax} V (the board runs on 5 V).`
        if (rUsb === top) return `The 5V pin carried ${eng(usb, 'A')}; a USB port gives at most ${eng(MCU.iUsbMax, 'A')}. Use a resistor and do not short 5V to GND.`
        if (r33 === top) return `The 3V3 pin carried ${eng(v33, 'A')}; the board's 3.3 V regulator gives at most ${eng(MCU.i33Max, 'A')}.`
        if (rTotal === top) return `The Uno's pins carried ${eng(Math.max(sourced, sunk), 'A')} in total; at most ${eng(MCU.iTotalMax, 'A')} may flow through the chip's VCC and GND pins.`
        return `Pin ${UNO_PINS[worstIdx]} carried ${eng(worstPad, 'A')}; one pin of the ATmega328P takes at most ${eng(MCU.iPinMax, 'A')} (20 mA is the usual top). Use a resistor and do not short a pin.`
      }),
    }
  },
  drawOver(c) {
    // the sockets again, over the wires: a wire seems to go into the header (the vector look has no such pass)
    if (scene.pixel) drawSprite(c, unoHeaderSprite(), -2 * UNO_PAD, 0)
  },
  draw(c, p, live) {
    const usb = plugged(p)
    if (scene.pixel) {
      const board = unoBoardSprite()
      drawSprite(c, board, -2 * UNO_PAD, 0)
      // the lamps: ON (power), L (pin 13), and TX / RX which wait for the sketch's serial traffic
      const lamp = (at: { x: number; y: number }, color: 'green' | 'orange' | 'yellow', on: boolean): void => drawSprite(c, unoLensSprite(color, on), at.x * 2, at.y * 2)
      lamp(UNO_LAMPS.l, 'orange', (live.l ?? 0) > 0.5)
      lamp(UNO_LAMPS.tx, 'yellow', false)
      lamp(UNO_LAMPS.rx, 'yellow', false)
      lamp(UNO_LAMPS.on, 'green', (live.pw ?? 0) > 0.5)
      drawSprite(c, unoResetSprite(flag(p, 'pressed')), UNO_RESET.x * 2, UNO_RESET.y * 2)
      // the pin names, printed under the top header and over the bottom one
      let idx = 0
      for (const h of UNO_HEADERS) {
        for (let k = 0; k < h.n; k++, idx++) {
          const text = printedName(idx)
          if (!text) continue
          const analog = UNO_PINS[idx].startsWith('A')
          printed(c, text, (h.x + k) * 20 + 1, h.y < 10 ? 38 : 387, h.y < 10 ? 'top' : 'bottom', analog ? 17 : h.y < 10 ? 19 : 15)
        }
      }
      const upright = (text: string, x: number, y: number, align: 'left' | 'center' | 'right', size: number, color = INK, heavy = true): void =>
        heavy ? bold(c, text, x, y - size / 2, align, color, size) : drawText(c, text, x, y - size / 2, { color, align, size })
      upright('DIGITAL (PWM~)', 412, 70, 'center', 17)
      upright('POWER', 367, 357, 'right', 17)
      upright('ANALOG IN', 508, 357, 'right', 16)
      upright('ARDUINO', 302, 147, 'center', 24)
      upright('UNO', 404, 110, 'center', 34, INK, false)
      upright('L', 200, 87, 'right', 15)
      upright('TX', 200, 133, 'right', 15)
      upright('RX', 200, 150, 'right', 15)
      upright('ON', 478, 132, 'left', 15)
      upright('ICSP', 514, 160, 'center', 10)
      upright('WWW.ARDUINO.CC - MADE IN ITALY', 534, 242, 'right', 12)
      upright('T16.000', 146, 217, 'center', 9, '#6a6558', false)
      turnedText(c, 'RESET', 3, 30, 8, INK)
      turnedText(c, 'JP2', 124, 110, 9, INK)
      turnedText(c, 'RESET EN', 240, 206, 7, INK)
      turnedText(c, '503C', 30, 212, 8, '#f0cf48')
      // the chip's marking, upside down like the real one, and the capacitors' three printed lines
      c.save()
      c.translate(366, 282)
      c.rotate(Math.PI)
      drawText(c, 'ATMEGA328P-PU', 0, -5, { color: '#6b5a48', align: 'center', size: 10 })
      drawText(c, '1320', -60, 8, { color: '#6b5a48', align: 'center', size: 10 })
      c.restore()
      for (const cx of [140, 198]) {
        turnedText(c, '35462', cx - 16, 351, 8, '#2a2a30')
        turnedText(c, '47', cx, 351, 13, '#2a2a30')
        turnedText(c, '25V', cx + 13, 351, 13, '#2a2a30')
      }
      if (usb) drawSprite(c, unoPlugSprite(), PLUG_AT.x, PLUG_AT.y)
      if (scene.labeled.has(p.id)) drawLabelAbove(c, 'Arduino Uno R3', 270, spriteInk(board, -2 * UNO_PAD, 0).top)
      return
    }
    c.fillStyle = '#1f5fb0'
    rrect(c, 0, 0, 540, 420, 10)
    c.fill()
    c.fillStyle = COL.metal
    c.fillRect(-50, 50, 140, 96)
    if (usb) {
      c.fillStyle = '#2f6fe0'
      c.fillRect(PLUG_AT.x + 200, 80, 240, 40)
    }
    c.fillStyle = '#16161b'
    for (const h of UNO_HEADERS) c.fillRect(h.x * 20 - 10, h.y * 20 - 10, h.n * 20, 20)
    c.fillStyle = COL.metal
    for (const v of arduinoUno.pins(p)) {
      c.beginPath()
      c.arc(v.x * 20, v.y * 20, 4, 0, Math.PI * 2)
      c.fill()
    }
    if (scene.labeled.has(p.id)) drawLabelAbove(c, 'Arduino Uno R3', 270, 0)
  },
  fields: () => [{ kind: 'toggle', key: 'usb', label: 'USB cable plugged in' }],
  summary: (p) => `${plugged(p) ? 'USB plugged in' : 'USB unplugged'}${p.state.failed ? ', burnt' : ''}`,
  clickZone: (p, local) => inSocket(p, local.x, local.y),
  click(p, local) {
    if (!inSocket(p, local.x, local.y)) return false
    p.params.usb = !plugged(p)
    return true
  },
  // the reset button: a mouse press holds it down
  pressZone: (local) => local.x >= 44 && local.x <= 88 && local.y >= 16 && local.y <= 56,
  press(p, down) {
    if (p.state.failed) return false
    p.params.pressed = down
    return true
  },
}
