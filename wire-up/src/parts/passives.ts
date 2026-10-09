import type { PartInstance } from '../board/world.ts'
import { COL, drawLabelAbove, drawText, leg, radialGlow, rrect } from '../render/draw.ts'
import { CAP, CERAMIC_CAP_VALUES, ELECTRO_CAP_VALUES, eiaCode, eng, fmtFarads, fmtOhms, ldrResistance, ntcResistance, resistorBands, RESISTOR_VALUES } from '../sim/models.ts'
import { drawSprite, pxLine, pxRect, spriteInk } from '../render/pixel.ts'
import { scene } from '../render/scene.ts'
import { ceramicCapSprite, electroCapSprite, ldrSprite, ntcSprite, potSprite, resistorSprite } from './art.ts'
import { eid, legDrop, legGrid, LEG_FIELD, num, spreadOf, stress, U } from './common.ts'
import type { Env, Eval, PartDef, Stress } from './types.ts'

const pinsTwo = (spread: number, y = 0) => [
  { x: 0, y },
  { x: spread, y },
]

function twoTerm(env: Env, p: PartInstance, ratedW: number, label: string): Eval {
  const c = env.cur(eid(p, 'r'))
  const i = c ? c.i : 0
  const v = env.v(env.pins[0]) - env.v(env.pins[1])
  const pw = Math.abs(v * i)
  return {
    live: { i, v, p: pw },
    stress: stress(pw / ratedW, () => {
      return `${label} dissipated ${eng(pw, 'W')} (${eng(Math.abs(i), 'A')} x ${eng(Math.abs(v), 'V')}) but is rated for ${eng(ratedW, 'W')}. Use a higher resistance or a bigger part.`
    }),
  }
}

// ---------------------------------------------------------------- resistor

export const resistor: PartDef = {
  type: 'resistor',
  name: 'Resistor',
  category: 'passive',
  blurb: 'Limits current. 1/4 W carbon film, 5%.',
  pinLabels: ['1', '2'],
  hidePinLabels: true,
  defaults: () => ({ value: 330, legs: 1 }),
  pins: (p) => pinsTwo(spreadOf(p)),
  bounds: (p) => ({ x: -12, y: -14, w: spreadOf(p) * U + 24, h: 28 }),
  build(p, ctx) {
    if (p.state.failed) return
    ctx.add({ kind: 'R', id: ctx.id('r'), a: ctx.pins[0], b: ctx.pins[1], r: num(p, 'value', 330) })
  },
  evaluate: (p, env) => twoTerm(env, p, 0.25, `${fmtOhms(num(p, 'value'))} ohm resistor`),
  draw(c, p) {
    const s = spreadOf(p) * U
    const cx = s / 2
    if (scene.pixel) {
      const body = resistorSprite(resistorBands(num(p, 'value', 330)))
      drawSprite(c, body, cx - 24, -11)
      for (const [x0, x1] of [
        [0, cx - 26],
        [cx + 26, s],
      ]) {
        c.fillStyle = '#c9ced6'
        c.fillRect(x0, -2, x1 - x0, 2)
        c.fillStyle = '#7d838f'
        c.fillRect(x0, 0, x1 - x0, 2)
      }
      if (scene.labeled.has(p.id)) drawLabelAbove(c, fmtOhms(num(p, 'value', 330)), cx, spriteInk(body, cx - 24, -11).top)
      return
    }
    leg(c, 0, 0, cx - 18, 0)
    leg(c, cx + 18, 0, s, 0)
    // body: dog-bone shape
    const bx = cx - 25
    c.fillStyle = '#d8b87a'
    rrect(c, bx + 4, -8, 42, 16, 5)
    c.fill()
    rrect(c, bx, -10, 12, 20, 6)
    c.fill()
    rrect(c, bx + 38, -10, 12, 20, 6)
    c.fill()
    c.fillStyle = 'rgba(255,255,255,0.22)'
    c.fillRect(bx + 6, -8, 38, 3)
    c.fillStyle = 'rgba(0,0,0,0.22)'
    c.fillRect(bx + 6, 5, 38, 3)
    const bands = resistorBands(num(p, 'value', 330))
    const xs = [bx + 9, bx + 17, bx + 25, bx + 38]
    bands.forEach((col, k) => {
      c.fillStyle = col
      c.fillRect(xs[k], k === 3 ? -9 : -8, 4, k === 3 ? 18 : 16)
    })
    // sideways (rotated) the label only spans the thin middle and the shoulders of the round caps, whose nearest ink is 9.3 px out (label-gap-harness)
    if (scene.labeled.has(p.id)) drawLabelAbove(c, fmtOhms(num(p, 'value', 330)), cx, p.rot % 2 ? -9.3 : -10)
  },
  fields: () => [
    {
      kind: 'select',
      key: 'value',
      label: 'Resistance (ohm)',
      options: RESISTOR_VALUES.map((v) => ({ value: v, label: fmtOhms(v) })),
    },
    LEG_FIELD,
  ],
  summary: (p) => `${eng(num(p, 'value', 330), 'ohm')}, 0.25 W`,
}

// ---------------------------------------------------------------- potentiometer

export const potentiometer: PartDef = {
  type: 'pot',
  name: 'Potentiometer',
  category: 'sensor',
  blurb: 'Trimmer pot. Turn the knob to slide the wiper.',
  wheelKey: 'pos',
  pinLabels: ['1', 'W', '2'],
  pinLabelPlace: 'below',
  tipPastPin: 4,
  tipPastPinVector: 2,
  defaults: () => ({ value: 10000, pos: 0.5, legs: 1 }),
  pins: (p) => [
    { x: 0, y: legGrid(p) },
    { x: 1, y: legGrid(p) },
    { x: 2, y: legGrid(p) },
  ],
  bounds: (p) => ({ x: -14, y: -66, w: 68, h: 74 + legDrop(p) }),
  build(p, ctx) {
    if (p.state.failed) return
    const total = num(p, 'value', 10000)
    const pos = Math.min(Math.max(num(p, 'pos', 0.5), 0), 1)
    ctx.add({ kind: 'R', id: ctx.id('r1'), a: ctx.pins[0], b: ctx.pins[1], r: Math.max(total * pos, 0.5) })
    ctx.add({ kind: 'R', id: ctx.id('r2'), a: ctx.pins[1], b: ctx.pins[2], r: Math.max(total * (1 - pos), 0.5) })
  },
  evaluate(p, env) {
    const c1 = env.cur(eid(p, 'r1'))
    const c2 = env.cur(eid(p, 'r2'))
    const i1 = c1 ? c1.i : 0
    const i2 = c2 ? c2.i : 0
    const v1 = env.v(env.pins[0]) - env.v(env.pins[1])
    const v2 = env.v(env.pins[1]) - env.v(env.pins[2])
    const pw = Math.abs(v1 * i1) + Math.abs(v2 * i2)
    const iw = Math.abs(i1 - i2)
    return {
      live: { i1, i2, p: pw, vw: env.v(env.pins[1]) - env.v(env.pins[2]) },
      stress: stress(Math.max(pw / 0.25, iw / 0.1), () =>
        iw / 0.1 > pw / 0.25
          ? `Wiper carried ${eng(iw, 'A')}; the wiper contact is rated for 100 mA. Use the pot as a voltage divider feeding a high-impedance input.`
          : `Pot dissipated ${eng(pw, 'W')}; it is rated for 0.25 W. Use a higher total resistance.`,
      ),
    }
  },
  draw(c, p) {
    const pos = num(p, 'pos', 0.5)
    if (scene.pixel) {
      for (let k = 0; k < 3; k++) {
        c.fillStyle = COL.metal
        c.fillRect(k * U - 2, -10, 2, 14 + legDrop(p))
        c.fillStyle = COL.metalDark
        c.fillRect(k * U, -10, 2, 14 + legDrop(p))
      }
      drawSprite(c, potSprite(), -10, -62)
      // groove across the knob with a lit pointer at the end the setting points to
      const a = (-135 + 270 * pos) * (Math.PI / 180)
      const dx = Math.cos(a)
      const dy = Math.sin(a)
      pxLine(c, -10, -62, 15 - dx * 6, 13.5 - dy * 6, 15 + dx * 6, 13.5 + dy * 6, '#173769')
      pxLine(c, -10, -62, 15 - dx * 6 - 1, 13.5 - dy * 6 - 1, 15 + dx * 6 - 1, 13.5 + dy * 6 - 1, '#a9cdff')
      pxRect(c, -10, -62, Math.round(15 + dx * 6) - 1, Math.round(13.5 + dy * 6) - 1, 2, 2, '#ffffff')
      if (scene.labeled.has(p.id)) drawLabelAbove(c, fmtOhms(num(p, 'value', 10000)), 20, spriteInk(potSprite(), -10, -62).top)
      return
    }
    leg(c, 0, 0, 0, -10)
    leg(c, 20, 0, 20, -10)
    leg(c, 40, 0, 40, -10)
    if (legDrop(p) > 0) for (let k = 0; k < 3; k++) leg(c, k * U, 4, k * U, legDrop(p))
    c.fillStyle = '#2a5db0'
    rrect(c, -10, -62, 60, 54, 4)
    c.fill()
    c.fillStyle = 'rgba(255,255,255,0.18)'
    c.fillRect(-8, -60, 56, 4)
    c.fillStyle = 'rgba(0,0,0,0.25)'
    c.fillRect(-8, -14, 56, 4)
    // brass screw
    c.fillStyle = '#c9a24a'
    c.beginPath()
    c.arc(20, -35, 17, 0, Math.PI * 2)
    c.fill()
    c.strokeStyle = '#8b6a22'
    c.lineWidth = 2
    c.stroke()
    const a = (-135 + 270 * pos) * (Math.PI / 180)
    c.save()
    c.translate(20, -35)
    c.rotate(a)
    c.fillStyle = '#4a3512'
    c.fillRect(-14, -2, 28, 4)
    c.fillStyle = '#e8c870'
    c.fillRect(-14, -3, 28, 1)
    c.restore()
    if (scene.labeled.has(p.id)) drawLabelAbove(c, fmtOhms(num(p, 'value', 10000)), 20, -62)
  },
  fields: () => [
    {
      kind: 'select',
      key: 'value',
      label: 'Total resistance (ohm)',
      options: [1000, 5000, 10000, 50000, 100000].map((v) => ({ value: v, label: fmtOhms(v) })),
    },
    { kind: 'range', key: 'pos', label: 'Knob position', min: 0, max: 1, step: 0.01 },
    LEG_FIELD,
  ],
  summary: (p) => `${eng(num(p, 'value', 10000), 'ohm')} pot, knob ${(num(p, 'pos', 0.5) * 100).toFixed(0)}%`,
}

// ---------------------------------------------------------------- LDR

export const ldr: PartDef = {
  type: 'ldr',
  name: 'Light sensor (LDR)',
  category: 'sensor',
  blurb: 'Resistance falls as light gets brighter.',
  pinLabels: ['1', '2'],
  pinLabelPlace: 'below',
  tipPastPin: 4,
  tipPastPinVector: 2,
  wheelKey: 'lux',
  defaults: () => ({ lux: 100, legs: 1 }),
  pins: (p) => pinsTwo(1, legGrid(p)),
  bounds: (p) => ({ x: -22, y: -48, w: 64, h: 56 + legDrop(p) }),
  build(p, ctx) {
    if (p.state.failed) return
    ctx.add({ kind: 'R', id: ctx.id('r'), a: ctx.pins[0], b: ctx.pins[1], r: ldrResistance(num(p, 'lux', 100)) })
  },
  evaluate(p, env) {
    const e = twoTerm(env, p, 0.1, 'Light sensor')
    e.live.r = ldrResistance(num(p, 'lux', 100))
    return e
  },
  draw(c, p) {
    const lux = num(p, 'lux', 100)
    if (scene.pixel) {
      // straight legs one hole apart, hidden behind the disc; the disc is drawn 10 px left so it sits between them
      straightLegs(c, p, -4)
      c.save()
      c.translate(-10, 0)
      drawSprite(c, ldrSprite(), -2, -48)
      const bright = Math.min(1, Math.log10(Math.max(lux, 1)) / 4.5)
      radialGlow(c, 20, -26, 38, '#fff3b0', bright * 0.35)
      if (scene.labeled.has(p.id)) drawLabelAbove(c, eng(lux, 'lx', 2).replace(' ', ''), 20, spriteInk(ldrSprite(), -2, -48).top)
      c.restore()
      return
    }
    leg(c, 0, 0, 0, legDrop(p))
    leg(c, 20, 0, 20, legDrop(p))
    c.save()
    c.translate(-10, 0)
    c.fillStyle = '#7a5226'
    c.beginPath()
    c.arc(20, -26, 21, 0, Math.PI * 2)
    c.fill()
    c.fillStyle = '#d29a45'
    c.beginPath()
    c.arc(20, -26, 17, 0, Math.PI * 2)
    c.fill()
    c.strokeStyle = '#4a2c0b'
    c.lineWidth = 2
    c.beginPath()
    for (let k = 0; k < 6; k++) {
      const y = -38 + k * 5
      c.moveTo(8, y)
      c.lineTo(32, y)
      if (k < 5) c.lineTo(k % 2 === 0 ? 32 : 8, y + 5)
    }
    c.stroke()
    // light rays reflect the slider
    const b = Math.min(1, Math.log10(Math.max(lux, 1)) / 4.5)
    radialGlow(c, 20, -26, 38, '#fff3b0', b * 0.35)
    if (scene.labeled.has(p.id)) drawLabelAbove(c, eng(lux, 'lx', 2).replace(' ', ''), 20, -47)
    c.restore()
  },
  fields: () => [{ kind: 'range', key: 'lux', label: 'Light level', min: 0.1, max: 100000, step: 0.1, log: true, unit: 'lx' }, LEG_FIELD],
  summary: (p) => `${eng(ldrResistance(num(p, 'lux', 100)), 'ohm')} at ${eng(num(p, 'lux', 100), 'lx')}`,
}

// ---------------------------------------------------------------- NTC thermistor

export const ntc: PartDef = {
  type: 'ntc',
  name: 'Thermistor (NTC)',
  category: 'sensor',
  blurb: '10 k at 25 C. Resistance falls as it warms up.',
  pinLabels: ['1', '2'],
  pinLabelPlace: 'below',
  tipPastPin: 4,
  tipPastPinVector: 2,
  wheelKey: 'temp',
  defaults: () => ({ temp: 25, legs: 1 }),
  pins: (p) => pinsTwo(1, legGrid(p)),
  bounds: (p) => ({ x: -22, y: -54, w: 64, h: 62 + legDrop(p) }),
  build(p, ctx) {
    if (p.state.failed) return
    ctx.add({ kind: 'R', id: ctx.id('r'), a: ctx.pins[0], b: ctx.pins[1], r: ntcResistance(num(p, 'temp', 25)) })
  },
  evaluate(p, env) {
    const e = twoTerm(env, p, 0.25, 'Thermistor')
    e.live.r = ntcResistance(num(p, 'temp', 25))
    return e
  },
  draw(c, p) {
    const t = num(p, 'temp', 25)
    if (scene.pixel) {
      const hotGlow = Math.min(Math.max((t - 40) / 100, 0), 1)
      radialGlow(c, 10, -30, 38, '#ff6a2a', hotGlow * 0.6)
      // straight legs one hole apart, hidden behind the bead (same as the LDR)
      straightLegs(c, p, -6)
      c.save()
      c.translate(-10, 0)
      drawSprite(c, ntcSprite(), -2, -52)
      if (scene.labeled.has(p.id)) drawLabelAbove(c, `${t.toFixed(0)}C`, 20, spriteInk(ntcSprite(), -2, -52).top)
      c.restore()
      return
    }
    leg(c, 0, 0, 0, legDrop(p))
    leg(c, 20, 0, 20, legDrop(p))
    c.save()
    c.translate(-10, 0)
    const hot = Math.min(Math.max((t - 40) / 100, 0), 1)
    radialGlow(c, 20, -20, 32, '#ff6a2a', hot * 0.6)
    c.fillStyle = '#44444f'
    c.beginPath()
    c.arc(20, -20, 14, 0, Math.PI * 2)
    c.fill()
    c.fillStyle = 'rgba(255,255,255,0.3)'
    c.beginPath()
    c.arc(15, -25, 5, 0, Math.PI * 2)
    c.fill()
    c.strokeStyle = '#8a8a9a'
    c.lineWidth = 1.5
    c.beginPath()
    c.arc(20, -20, 14, 0, Math.PI * 2)
    c.stroke()
    if (scene.labeled.has(p.id)) drawLabelAbove(c, `${t.toFixed(0)}C`, 20, -35)
    c.restore()
  },
  fields: () => [{ kind: 'range', key: 'temp', label: 'Temperature', min: -40, max: 150, step: 1, unit: 'C' }, LEG_FIELD],
  summary: (p) => `${eng(ntcResistance(num(p, 'temp', 25)), 'ohm')} at ${num(p, 'temp', 25).toFixed(0)} C`,
}

// ---------------------------------------------------------------- capacitors

/** Two straight legs, one hole apart, running up from the pins to `top` and hidden behind the body (LDR, NTC, ceramic disc). */
function straightLegs(c: CanvasRenderingContext2D, p: PartInstance, top: number): void {
  for (const x of [0, 20]) {
    c.fillStyle = COL.metal
    c.fillRect(x - 2, top, 2, 4 - top + legDrop(p))
    c.fillStyle = COL.metalDark
    c.fillRect(x, top, 2, 4 - top + legDrop(p))
  }
}

function capEval(p: PartInstance, env: Env, esr: number, stressOf: (v: number) => Stress): Eval {
  const c = env.cur(eid(p, 'k'))
  const i = c ? c.i : 0
  const v = env.v(env.pins[0]) - env.v(env.pins[1])
  return { live: { i, v, esr, q: num(p, 'value') * v }, stress: stressOf(v) }
}

export const ceramicCap: PartDef = {
  type: 'cap-ceramic',
  name: 'Capacitor (ceramic)',
  category: 'passive',
  blurb: 'Stores charge. Ceramic disc, either way round, 50 V.',
  pinLabels: ['1', '2'],
  pinLabelPlace: 'below',
  tipPastPin: 4,
  tipPastPinVector: 2,
  defaults: () => ({ value: 1e-7, legs: 1 }),
  pins: (p) => pinsTwo(1, legGrid(p)),
  bounds: (p) => ({ x: -22, y: -54, w: 64, h: 62 + legDrop(p) }),
  build(p, ctx) {
    if (p.state.failed) return
    const mid = ctx.newNode()
    ctx.add({ kind: 'R', id: ctx.id('esr'), a: ctx.pins[0], b: mid, r: CAP.ceramicEsr })
    ctx.add({ kind: 'K', id: ctx.id('k'), a: mid, b: ctx.pins[1], c: num(p, 'value', 1e-7) })
  },
  evaluate: (p, env) =>
    capEval(p, env, CAP.ceramicEsr, (v) =>
      stress(Math.abs(v) / CAP.ceramicVmax, () => `Capacitor had ${eng(Math.abs(v), 'V')} across it but is rated for ${CAP.ceramicVmax} V. Use a lower voltage or a capacitor with a higher rating.`),
    ),
  draw(c, p) {
    if (scene.pixel) {
      straightLegs(c, p, -6)
      c.save()
      c.translate(-10, 0)
      drawSprite(c, ceramicCapSprite(), -2, -52)
      // the code printed on the disc, as on the real part
      drawText(c, eiaCode(num(p, 'value', 1e-7)), 20, -37, { color: '#5a3410', align: 'center' })
      if (scene.labeled.has(p.id)) drawLabelAbove(c, `${fmtFarads(num(p, 'value', 1e-7))}F`, 20, spriteInk(ceramicCapSprite(), -2, -52).top)
      c.restore()
      return
    }
    leg(c, 0, 0, 0, legDrop(p))
    leg(c, 20, 0, 20, legDrop(p))
    c.save()
    c.translate(-10, 0)
    c.fillStyle = '#e8a73f'
    c.beginPath()
    c.arc(20, -30, 19, 0, Math.PI * 2)
    c.fill()
    c.strokeStyle = '#3d2408'
    c.lineWidth = 2
    c.stroke()
    if (scene.labeled.has(p.id)) drawLabelAbove(c, `${fmtFarads(num(p, 'value', 1e-7))}F`, 20, -50)
    c.restore()
  },
  fields: () => [
    { kind: 'select', key: 'value', label: 'Capacitance (F)', options: CERAMIC_CAP_VALUES.map((v) => ({ value: v, label: `${fmtFarads(v)}F` })) },
    LEG_FIELD,
  ],
  summary: (p) => `${eng(num(p, 'value', 1e-7), 'F')}, ${CAP.ceramicVmax} V`,
}

export const electroCap: PartDef = {
  type: 'cap-electro',
  name: 'Capacitor (electrolytic)',
  category: 'passive',
  blurb: 'Big stored charge. Has a + and a - leg: 16 V, and it breaks if put in backwards.',
  pinLabels: ['+', '-'],
  pinLabelPlace: 'below',
  tipPastPin: 4,
  tipPastPinVector: 2,
  defaults: () => ({ value: 1e-4, legs: 1 }),
  pins: (p) => pinsTwo(1, legGrid(p)),
  bounds: (p) => ({ x: -16, y: -90, w: 52, h: 98 + legDrop(p) }),
  build(p, ctx) {
    if (p.state.failed) return
    const mid = ctx.newNode()
    ctx.add({ kind: 'R', id: ctx.id('esr'), a: ctx.pins[0], b: mid, r: CAP.electroEsr })
    ctx.add({ kind: 'K', id: ctx.id('k'), a: mid, b: ctx.pins[1], c: num(p, 'value', 1e-4) })
  },
  evaluate: (p, env) =>
    capEval(p, env, CAP.electroEsr, (v) =>
      stress(v >= 0 ? v / CAP.electroVmax : -v / CAP.electroVrev, () =>
        v >= 0
          ? `Capacitor had ${eng(v, 'V')} across it but is rated for ${CAP.electroVmax} V. Use a lower voltage or a capacitor with a higher rating.`
          : `Capacitor was connected backwards: ${eng(-v, 'V')} the wrong way round, and an electrolytic only takes about ${CAP.electroVrev} V that way. Put the + leg on the higher voltage.`,
      ),
    ),
  draw(c, p) {
    const value = `${fmtFarads(num(p, 'value', 1e-4))}F`
    if (scene.pixel) {
      // the legs come straight down from the bottom of the can
      for (const x of [0, 20]) {
        c.fillStyle = COL.metal
        c.fillRect(x - 2, -8, 2, 12 + legDrop(p))
        c.fillStyle = COL.metalDark
        c.fillRect(x, -8, 2, 12 + legDrop(p))
      }
      drawSprite(c, electroCapSprite(), -14, -88)
      // the value and voltage printed up the sleeve, on the lit side
      c.save()
      c.translate(-2, -48)
      c.rotate(-Math.PI / 2)
      drawText(c, `${value.replace('F', '')} ${CAP.electroVmax}V`, 0, -6, { color: '#c9ced6', align: 'center' })
      c.restore()
      if (scene.labeled.has(p.id)) drawLabelAbove(c, value, 10, spriteInk(electroCapSprite(), -14, -88).top)
      return
    }
    leg(c, 0, -8, 0, legDrop(p))
    leg(c, 20, -8, 20, legDrop(p))
    c.fillStyle = '#4a4a5c'
    rrect(c, -14, -88, 48, 80, 6)
    c.fill()
    c.fillStyle = '#c9ced6'
    c.fillRect(16, -82, 12, 68)
    if (scene.labeled.has(p.id)) drawLabelAbove(c, value, 10, -88)
  },
  fields: () => [
    { kind: 'select', key: 'value', label: 'Capacitance (F)', options: ELECTRO_CAP_VALUES.map((v) => ({ value: v, label: `${fmtFarads(v)}F` })) },
    LEG_FIELD,
  ],
  summary: (p) => `${eng(num(p, 'value', 1e-4), 'F')}, ${CAP.electroVmax} V, + leg on the left`,
}
