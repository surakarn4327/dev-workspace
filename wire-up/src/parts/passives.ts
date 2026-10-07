import type { PartInstance } from '../board/world.ts'
import { drawText, leg, radialGlow, rrect } from '../render/draw.ts'
import { eng, fmtOhms, ldrResistance, ntcResistance, resistorBands, RESISTOR_VALUES } from '../sim/models.ts'
import { drawSprite } from '../render/pixel.ts'
import { scene } from '../render/scene.ts'
import { resistorSprite } from './art.ts'
import { eid, num, stress, U } from './common.ts'
import type { Env, Eval, PartDef } from './types.ts'

const pinsTwo = (spread: number) => [
  { x: 0, y: 0 },
  { x: spread, y: 0 },
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
  defaults: () => ({ value: 330, spread: 4 }),
  pins: (p) => pinsTwo(num(p, 'spread', 4)),
  bounds: (p) => ({ x: -12, y: -14, w: num(p, 'spread', 4) * U + 24, h: 28 }),
  build(p, ctx) {
    if (p.state.failed) return
    ctx.add({ kind: 'R', id: ctx.id('r'), a: ctx.pins[0], b: ctx.pins[1], r: num(p, 'value', 330) })
  },
  evaluate: (p, env) => twoTerm(env, p, 0.25, `${fmtOhms(num(p, 'value'))} ohm resistor`),
  draw(c, p) {
    const s = num(p, 'spread', 4) * U
    const cx = s / 2
    if (scene.pixel) {
      drawSprite(c, resistorSprite(resistorBands(num(p, 'value', 330))), cx - 24, -11)
      for (const [x0, x1] of [
        [0, cx - 26],
        [cx + 26, s],
      ]) {
        c.fillStyle = '#c9ced6'
        c.fillRect(x0, -2, x1 - x0, 2)
        c.fillStyle = '#7d838f'
        c.fillRect(x0, 0, x1 - x0, 2)
      }
      if (scene.labeled.has(p.id)) drawText(c, `${fmtOhms(num(p, 'value', 330))}`, cx, 15, { align: 'center', size: 11, box: true })
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
    if (scene.labeled.has(p.id)) drawText(c, `${fmtOhms(num(p, 'value', 330))}`, cx, 15, { align: 'center', size: 11, box: true })
  },
  fields: () => [
    {
      kind: 'select',
      key: 'value',
      label: 'Resistance (ohm)',
      options: RESISTOR_VALUES.map((v) => ({ value: v, label: fmtOhms(v) })),
    },
    { kind: 'range', key: 'spread', label: 'Leg spacing (holes)', min: 2, max: 10, step: 1 },
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
  defaults: () => ({ value: 10000, pos: 0.5 }),
  pins: () => [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
  ],
  bounds: () => ({ x: -14, y: -66, w: 68, h: 74 }),
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
    leg(c, 0, 0, 0, -10)
    leg(c, 20, 0, 20, -10)
    leg(c, 40, 0, 40, -10)
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
    if (!scene.labeled.has(p.id)) return
    drawText(c, fmtOhms(num(p, 'value', 10000)), 20, 10, { align: 'center', size: 11, box: true })
    drawText(c, '1', 0, -8, { align: 'center', size: 10, box: true })
    drawText(c, 'W', 20, -8, { align: 'center', size: 10, box: true })
    drawText(c, '2', 40, -8, { align: 'center', size: 10, box: true })
  },
  fields: () => [
    {
      kind: 'select',
      key: 'value',
      label: 'Total resistance (ohm)',
      options: [1000, 5000, 10000, 50000, 100000].map((v) => ({ value: v, label: fmtOhms(v) })),
    },
    { kind: 'range', key: 'pos', label: 'Knob position', min: 0, max: 1, step: 0.01 },
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
  wheelKey: 'lux',
  defaults: () => ({ lux: 100 }),
  pins: () => pinsTwo(2),
  bounds: () => ({ x: -12, y: -48, w: 64, h: 56 }),
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
    leg(c, 0, 0, 12, -14)
    leg(c, 40, 0, 28, -14)
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
    if (scene.labeled.has(p.id)) drawText(c, `${eng(lux, 'lx', 2).replace(' ', '')}`, 20, 10, { align: 'center', size: 11, box: true })
  },
  fields: () => [{ kind: 'range', key: 'lux', label: 'Light level', min: 0.1, max: 100000, step: 0.1, log: true, unit: 'lx' }],
  summary: (p) => `${eng(ldrResistance(num(p, 'lux', 100)), 'ohm')} at ${eng(num(p, 'lux', 100), 'lx')}`,
}

// ---------------------------------------------------------------- NTC thermistor

export const ntc: PartDef = {
  type: 'ntc',
  name: 'Thermistor (NTC)',
  category: 'sensor',
  blurb: '10 k at 25 C. Resistance falls as it warms up.',
  pinLabels: ['1', '2'],
  wheelKey: 'temp',
  defaults: () => ({ temp: 25 }),
  pins: () => pinsTwo(2),
  bounds: () => ({ x: -12, y: -40, w: 64, h: 48 }),
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
    leg(c, 0, 0, 14, -10)
    leg(c, 40, 0, 26, -10)
    const hot = Math.min(Math.max((t - 40) / 100, 0), 1)
    radialGlow(c, 20, -20, 32, '#ff6a2a', hot * 0.6)
    c.fillStyle = '#1f6fd0'
    c.beginPath()
    c.arc(20, -20, 14, 0, Math.PI * 2)
    c.fill()
    c.fillStyle = 'rgba(255,255,255,0.3)'
    c.beginPath()
    c.arc(15, -25, 5, 0, Math.PI * 2)
    c.fill()
    c.strokeStyle = '#123f80'
    c.lineWidth = 1.5
    c.beginPath()
    c.arc(20, -20, 14, 0, Math.PI * 2)
    c.stroke()
    if (scene.labeled.has(p.id)) drawText(c, `${t.toFixed(0)}C`, 20, 10, { align: 'center', size: 11, box: true })
  },
  fields: () => [{ kind: 'range', key: 'temp', label: 'Temperature', min: -40, max: 150, step: 1, unit: 'C' }],
  summary: (p) => `${eng(ntcResistance(num(p, 'temp', 25)), 'ohm')} at ${num(p, 'temp', 25).toFixed(0)} C`,
}
