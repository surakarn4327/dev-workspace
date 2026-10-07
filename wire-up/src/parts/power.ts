import { COL, drawText, neon, rrect } from '../render/draw.ts'
import { BATTERY_TYPES, eng } from '../sim/models.ts'
import { drawSprite } from '../render/pixel.ts'
import { pxLine, pxRect } from '../render/pixel.ts'
import { scene } from '../render/scene.ts'
import { batteryArtSize, batterySprite, supplySprite } from './art.ts'
import { eid, flag, num, stress } from './common.ts'
import type { PartInstance } from '../board/world.ts'
import type { PartDef, PartLive } from './types.ts'

// ---------------------------------------------------------------- battery

function batterySize(v: string): { w: number; h: number } {
  switch (v) {
    case '1.5':
      return { w: 44, h: 140 }
    case '3':
      return { w: 80, h: 140 }
    case '4.5':
      return { w: 116, h: 140 }
    default:
      return { w: 72, h: 128 }
  }
}

/** Terminal columns of the pixel art, in art pixels. */
function terminalsArt(v: string): [number, number] {
  const [w] = batteryArtSize(v)
  return [Math.round(w * 0.3), Math.round(w * 0.7)]
}

function volts(p: { params: Record<string, unknown> }): string {
  const v = p.params.volts
  return typeof v === 'number' ? String(v) : '9'
}

export const battery: PartDef = {
  type: 'battery',
  name: 'Battery',
  category: 'power',
  blurb: 'Real cell with internal resistance. Red lead is +, black is -.',
  freeLeads: true,
  fixedRot: true,
  leadTip: 'bare',
  leadColors: ['#ff3b4a', '#1c1c20'],
  pinLabels: ['+', '-'],
  defaults: () => ({ volts: 9 }),
  pins: () => [
    { x: 1, y: -3 },
    { x: 3, y: -3 },
  ],
  anchors(p) {
    const [a1, a2] = terminalsArt(volts(p))
    return [
      { x: a1 * 2, y: -2 },
      { x: a2 * 2, y: -2 },
    ]
  },
  bounds(p) {
    const s = batterySize(volts(p))
    return { x: 0, y: 0, w: s.w, h: s.h }
  },
  build(p, ctx) {
    if (p.state.failed) return
    const t = BATTERY_TYPES[volts(p)] ?? BATTERY_TYPES['9']
    ctx.add({ kind: 'B', id: ctx.id('b'), a: ctx.pins[0], b: ctx.pins[1], v: num(p, 'volts', 9), r: t.r })
  },
  evaluate(p, env) {
    const t = BATTERY_TYPES[volts(p)] ?? BATTERY_TYPES['9']
    const c = env.cur(eid(p, 'b'))
    const out = c ? -c.i : 0
    const v = env.v(env.pins[0]) - env.v(env.pins[1])
    return {
      live: { i: out, v },
      stress: stress(Math.abs(out) / t.iMax, () =>
        `Battery delivered ${eng(Math.abs(out), 'A')} (safe limit ${eng(t.iMax, 'A')}), heating itself by ${eng(out * out * t.r, 'W')}. Never short a battery; always keep a load in the circuit.`,
      ),
    }
  },
  draw(c, p) {
    const v = volts(p)
    const { w, h } = batterySize(v)
    if (scene.pixel) {
      const art = batterySprite(v, terminalsArt(v))
      drawSprite(c, art.sprite, 0, -art.lift)
      if (v === '9') drawText(c, '9V', w / 2, 54, { color: '#16161b', align: 'center', scale: 1.5 })
      else drawText(c, `${v}V`, w / 2, 50, { color: '#f0e6c8', align: 'center', scale: 1.5 })
      if (scene.labeled.has(p.id)) drawText(c, `${v} V`, w / 2, h + 4, { align: 'center', size: 11, box: true })
      return
    }
    if (v === '9') {
      c.fillStyle = '#16161b'
      rrect(c, 0, 0, w, h, 5)
      c.fill()
      c.fillStyle = '#c4c9d1'
      rrect(c, 3, 22, w - 6, h - 30, 3)
      c.fill()
      c.fillStyle = '#e0a31b'
      c.fillRect(3, 60, w - 6, 26)
      c.fillStyle = '#16161b'
      drawText(c, '9V', w / 2, 63, { color: '#16161b', align: 'center', scale: 2 })
      c.fillStyle = '#c4c9d1'
      c.beginPath()
      c.arc(w * 0.3, 2, 6, 0, Math.PI * 2)
      c.fill()
      c.fillRect(w * 0.7 - 6, -4, 12, 12)
    } else {
      c.fillStyle = '#18181d'
      rrect(c, 0, 0, w, h, 6)
      c.fill()
      const cells = v === '1.5' ? 1 : v === '3' ? 2 : 3
      for (let k = 0; k < cells; k++) {
        const cx = 6 + k * 36
        c.fillStyle = '#d8a21a'
        rrect(c, cx, 18, 32, h - 30, 6)
        c.fill()
        c.fillStyle = '#1d1d22'
        c.fillRect(cx, 40, 32, 22)
        drawText(c, '+', cx + 16, 24, { color: '#ff3b4a', align: 'center', scale: 2 })
      }
      drawText(c, `${v}V`, w / 2, 90, { color: '#f0e6c8', align: 'center', scale: 2 })
    }
    if (scene.labeled.has(p.id)) drawText(c, `${v} V`, w / 2, h + 4, { align: 'center', size: 11, box: true })
  },
  fields: () => [
    {
      kind: 'select',
      key: 'volts',
      label: 'Battery',
      options: Object.entries(BATTERY_TYPES).map(([k, t]) => ({ value: Number(k), label: t.label })),
    },
  ],
  summary: (p) => `${volts(p)} V, ${eng((BATTERY_TYPES[volts(p)] ?? BATTERY_TYPES['9']).r, 'ohm')} internal`,
}

// ---------------------------------------------------------------- bench power supply

function drawSupplyPixel(c: CanvasRenderingContext2D, p: PartInstance, live: PartLive): void {
  const on = flag(p, 'on')
  drawSprite(c, supplySprite(), 0, 0)
  const shownV = on ? (live.v ?? 0) : 0
  const shownI = on ? (live.i ?? 0) : 0
  drawText(c, `${shownV.toFixed(2).padStart(5, ' ')}V`, 14, 14, { color: COL.green, scale: 2 })
  drawText(c, `${Math.abs(shownI).toFixed(3)}A`, 14, 36, { color: live.cc ? COL.amber : COL.green, scale: 2 })
  drawText(c, 'LIM', 80, 14, { color: COL.dim })
  drawText(c, `${num(p, 'limit', 0.5).toFixed(2)}`, 80, 24, { color: COL.dim })
  const knob = (cx: number, cy: number, frac: number, label: string) => {
    const a = (-225 + 270 * frac) * (Math.PI / 180)
    pxLine(c, 0, 0, cx, cy, cx + Math.cos(a) * 4, cy + Math.sin(a) * 4, COL.cyan)
    drawText(c, label, 148, cy * 2 - 5, { color: COL.dim, align: 'center' })
  }
  knob(64, 9, num(p, 'volts', 5) / 30, 'V')
  knob(64, 24, num(p, 'limit', 0.5) / 2, 'A')
  pxRect(c, 0, 0, 7, 33, 20, 11, on ? COL.green : '#59607a')
  pxRect(c, 0, 0, 8, 34, 18, 9, on ? '#164a2c' : '#2a2d3a')
  drawText(c, on ? 'OUT ON' : 'OUT OFF', 34, 73, { color: on ? COL.green : COL.dim, align: 'center' })
  pxRect(c, 0, 0, 33, 37, 4, 4, live.cc ? COL.amber : '#3a3220')
  drawText(c, 'CC', 70, 84, { color: COL.dim, align: 'center' })
  drawText(c, '+', 100, 60, { color: COL.red, align: 'center' })
  drawText(c, '-', 140, 60, { color: COL.text, align: 'center' })
}

export const supply: PartDef = {
  type: 'supply',
  name: 'Bench supply',
  category: 'power',
  blurb: 'Adjustable 0-30 V with a current limit (CC mode).',
  fixedRot: true,
  pinLabels: ['+', '-'],
  defaults: () => ({ volts: 5, limit: 0.5, on: true }),
  pins: () => [
    { x: 5, y: 4 },
    { x: 7, y: 4 },
  ],
  bounds: () => ({ x: 0, y: 0, w: 160, h: 100 }),
  build(p, ctx) {
    if (!flag(p, 'on')) return
    ctx.add({ kind: 'V', id: ctx.id('v'), a: ctx.pins[0], b: ctx.pins[1], v: num(p, 'volts', 5), iLimit: Math.max(num(p, 'limit', 0.5), 0.001) })
  },
  evaluate(p, env) {
    const c = env.cur(eid(p, 'v'))
    const out = c ? -c.i : 0
    const v = env.v(env.pins[0]) - env.v(env.pins[1])
    return { live: { i: out, v, cc: env.ccIds.has(eid(p, 'v')) ? 1 : 0, on: flag(p, 'on') ? 1 : 0 } }
  },
  draw(c, p, live) {
    if (scene.pixel) {
      drawSupplyPixel(c, p, live)
      return
    }
    const on = flag(p, 'on')
    c.fillStyle = '#2b3040'
    rrect(c, 0, 0, 160, 100, 6)
    c.fill()
    c.strokeStyle = COL.cyan
    c.lineWidth = 1
    neon(c, COL.cyan, 6, () => {
      rrect(c, 0.5, 0.5, 159, 99, 6)
      c.stroke()
    })
    // display
    c.fillStyle = '#03140a'
    rrect(c, 10, 10, 96, 46, 3)
    c.fill()
    const shownV = on ? (live.v ?? 0) : 0
    const shownI = on ? (live.i ?? 0) : 0
    drawText(c, `${shownV.toFixed(2).padStart(5, ' ')}V`, 14, 14, { color: COL.green, scale: 2 })
    drawText(c, `${Math.abs(shownI).toFixed(3)}A`, 14, 36, { color: live.cc ? COL.amber : COL.green, scale: 2 })
    drawText(c, 'LIM', 80, 14, { color: COL.dim })
    drawText(c, `${num(p, 'limit', 0.5).toFixed(2)}`, 80, 24, { color: COL.dim })
    // knobs
    const knob = (cx: number, cy: number, frac: number, label: string) => {
      c.fillStyle = '#12141c'
      c.beginPath()
      c.arc(cx, cy, 15, 0, Math.PI * 2)
      c.fill()
      c.strokeStyle = '#59607a'
      c.lineWidth = 2
      c.stroke()
      const a = (-225 + 270 * frac) * (Math.PI / 180)
      c.strokeStyle = COL.cyan
      c.beginPath()
      c.moveTo(cx, cy)
      c.lineTo(cx + Math.cos(a) * 12, cy + Math.sin(a) * 12)
      c.stroke()
      drawText(c, label, cx, cy + 18, { color: COL.dim, align: 'center' })
    }
    knob(128, 22, num(p, 'volts', 5) / 30, 'VOLT')
    knob(128, 66, num(p, 'limit', 0.5) / 2, 'AMP')
    // output button + indicators
    c.fillStyle = on ? '#164a2c' : '#2a2d3a'
    rrect(c, 14, 66, 40, 22, 3)
    c.fill()
    c.strokeStyle = on ? COL.green : '#59607a'
    c.stroke()
    drawText(c, on ? 'OUT ON' : 'OUT OFF', 34, 73, { color: on ? COL.green : COL.dim, align: 'center' })
    c.fillStyle = live.cc ? COL.amber : '#3a3220'
    c.beginPath()
    c.arc(70, 77, 4, 0, Math.PI * 2)
    c.fill()
    drawText(c, 'CC', 70, 84, { color: COL.dim, align: 'center' })
    // binding posts
    const post = (x: number, y: number, col: string, label: string) => {
      c.fillStyle = col
      c.beginPath()
      c.arc(x, y, 8, 0, Math.PI * 2)
      c.fill()
      c.fillStyle = '#0b0b0e'
      c.beginPath()
      c.arc(x, y, 3, 0, Math.PI * 2)
      c.fill()
      c.strokeStyle = COL.metal
      c.lineWidth = 1.5
      c.beginPath()
      c.arc(x, y, 8, 0, Math.PI * 2)
      c.stroke()
      drawText(c, label, x, y - 20, { color: col === '#ff3b4a' ? COL.red : COL.text, align: 'center' })
    }
    post(100, 80, '#ff3b4a', '+')
    post(140, 80, '#1c1c20', '-')
  },
  fields: () => [
    { kind: 'range', key: 'volts', label: 'Voltage', min: 0, max: 30, step: 0.1, unit: 'V' },
    { kind: 'range', key: 'limit', label: 'Current limit', min: 0.01, max: 2, step: 0.01, unit: 'A' },
    { kind: 'toggle', key: 'on', label: 'Output ON' },
  ],
  summary: (p) => `${num(p, 'volts', 5).toFixed(1)} V, limit ${eng(num(p, 'limit', 0.5), 'A')}, ${flag(p, 'on') ? 'ON' : 'OFF'}`,
  wheelKey: 'volts',
  click(p, local) {
    if (local.x >= 14 && local.x <= 54 && local.y >= 66 && local.y <= 88) {
      p.params.on = !flag(p, 'on')
      return true
    }
    return false
  },
}
