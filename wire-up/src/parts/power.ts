import { COL, drawText, neon, radialGlow, rrect } from '../render/draw.ts'
import { BATTERY_TYPES, eng } from '../sim/models.ts'
import { drawSprite } from '../render/pixel.ts'
import { pxLine, pxRect } from '../render/pixel.ts'
import { scene } from '../render/scene.ts'
import { G } from '../board/world.ts'
import { batteryArtSize, batterySprite, batteryTerminals, supplySprite } from './art.ts'
import { eid, flag, num, stress } from './common.ts'
import type { PartInstance } from '../board/world.ts'
import type { PartDef, PartLive } from './types.ts'

// ---------------------------------------------------------------- battery

/** Case size in world px (the terminals poke 8 px above it). */
function batterySize(v: string): { w: number; h: number } {
  const [w, h] = batteryArtSize(v)
  return { w: w * 2, h: h * 2 }
}

function volts(p: { params: Record<string, unknown> }): string {
  const v = p.params.volts
  return typeof v === 'number' ? String(v) : '9'
}

const makeBattery = (type: string, name: string, volts0: number): PartDef => ({
  type,
  name,
  category: 'power',
  blurb: 'Real cell with internal resistance. Wire from the left terminal (+) and the right terminal (-).',
  fixedRot: true,
  pinLabels: ['+', '-'],
  defaults: () => ({ volts: volts0 }),
  // the two terminals are the pins: on grid points at the top of the sprite
  pins: (p) => {
    const t = batteryTerminals(volts(p))
    return [
      { x: (t.ox + t.a[0] * 2) / G, y: 0 },
      { x: (t.ox + t.a[1] * 2) / G, y: 0 },
    ]
  },
  bounds(p) {
    const s = batterySize(volts(p))
    const t = batteryTerminals(volts(p))
    return { x: t.ox, y: 0, w: s.w, h: s.h + 8 }
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
    const term = batteryTerminals(v)
    if (scene.pixel) {
      const art = batterySprite(v, term.a)
      // sprite top (terminal tops) sits on the pin row; the case starts 8 px lower
      drawSprite(c, art.sprite, term.ox, 0)
      if (v === '9') {
        // vertical lettering on the navy label
        c.save()
        c.translate(term.ox + 38, 77)
        c.rotate(-Math.PI / 2)
        drawText(c, 'ALKALINE', 0, -7, { color: '#f4f4fa', align: 'center', scale: 1.2 })
        c.restore()
      } else {
        // each cell gets the same vertical lettering
        const cellCount = v === '1.5' ? 1 : v === '3' ? 2 : 3
        for (let k = 0; k < cellCount; k++) {
          c.save()
          c.translate(term.ox + (3 + k * 18 + 8) * 2, 80)
          c.rotate(-Math.PI / 2)
          drawText(c, 'ALKALINE', 0, -6, { color: '#f4f4fa', align: 'center' })
          c.restore()
        }
      }
      if (scene.labeled.has(p.id)) drawText(c, `${v} V`, term.ox + w / 2, h + 12, { align: 'center', size: 11, box: true })
      return
    }
    c.save()
    c.translate(term.ox, 8)
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
      c.arc(term.a[0] * 2, 2, 6, 0, Math.PI * 2)
      c.fill()
      c.fillRect(term.a[1] * 2 - 6, -4, 12, 12)
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
    c.restore()
    if (scene.labeled.has(p.id)) drawText(c, `${v} V`, term.ox + w / 2, h + 12, { align: 'center', size: 11, box: true })
  },
  fields: () => [],
  summary: (p) => `${volts(p)} V, ${eng((BATTERY_TYPES[volts(p)] ?? BATTERY_TYPES['9']).r, 'ohm')} internal`,
})

export const battery = makeBattery('battery', 'Battery 9 V (PP3)', 9)
export const battery15 = makeBattery('battery-1.5', 'Battery 1.5 V (AA)', 1.5)
export const battery3 = makeBattery('battery-3', 'Battery 3 V (2xAA)', 3)
export const battery45 = makeBattery('battery-4.5', 'Battery 4.5 V (3xAA)', 4.5)

// ---------------------------------------------------------------- bench power supply

function drawSupplyPixel(c: CanvasRenderingContext2D, p: PartInstance, live: PartLive): void {
  const on = flag(p, 'on')
  drawSprite(c, supplySprite(), 0, 0)
  const shownV = on ? (live.v ?? 0) : 0
  const shownI = on ? (live.i ?? 0) : 0
  const LED = '#ff3b30'
  drawText(c, `${shownV.toFixed(2).padStart(5, ' ')}V`, 22, 17, { color: LED, scale: 2 })
  drawText(c, `${Math.abs(shownI).toFixed(3)}A`, 22, 59, { color: live.cc ? COL.amber : LED, scale: 2 })
  const knob = (cx: number, cy: number, frac: number, label: string) => {
    const a = (-225 + 270 * frac) * (Math.PI / 180)
    pxLine(c, 0, 0, cx, cy, cx + Math.cos(a) * 6, cy + Math.sin(a) * 6, '#f4f4f8')
    drawText(c, label, cx * 2, cy * 2 + 20, { color: COL.dim, align: 'center' })
  }
  knob(14, 58, num(p, 'volts', 5) / 30, 'V')
  knob(46, 58, num(p, 'limit', 0.5) / 2, 'A')
  // power symbol on the round output button: green when on, red when off, with a soft glow
  const mark = on ? '#39ff88' : '#ff3b4a'
  radialGlow(c, 60, 123, 14, mark, 0.5)
  for (let y = 55; y <= 68; y++) {
    for (let x = 24; x <= 36; x++) {
      const dx = x + 0.5 - 30
      const dy = y + 0.5 - 61.7
      const d = Math.hypot(dx, dy)
      const arc = d >= 2.5 && d < 3.9 && !(dy < 0 && Math.abs(dx) < 2)
      const bar = (x === 29 || x === 30) && y >= 57 && y <= 61
      if (arc || bar) pxRect(c, 0, 0, x, y, 1, 1, mark)
    }
  }
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
    { x: 2, y: 8 },
    { x: 4, y: 8 },
  ],
  bounds: () => (scene.pixel ? { x: 0, y: 0, w: 120, h: 190 } : { x: -60, y: 80, w: 160, h: 100 }),
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
    c.save()
    c.translate(-60, 80) // the old vector body sits low and left so its posts land on the pins
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
    c.restore()
  },
  fields: () => [
    { kind: 'range', key: 'volts', label: 'Voltage', min: 0, max: 30, step: 0.1, unit: 'V' },
    { kind: 'range', key: 'limit', label: 'Current limit', min: 0.01, max: 2, step: 0.01, unit: 'A' },
    { kind: 'toggle', key: 'on', label: 'Output ON' },
  ],
  summary: (p) => `${num(p, 'volts', 5).toFixed(1)} V, limit ${eng(num(p, 'limit', 0.5), 'A')}, ${flag(p, 'on') ? 'ON' : 'OFF'}`,
  wheelKey: 'volts',
  click(p, local) {
    const btn = scene.pixel ? { x0: 48, x1: 72, y0: 111, y1: 135 } : { x0: -46, x1: -6, y0: 146, y1: 168 }
    if (local.x >= btn.x0 && local.x <= btn.x1 && local.y >= btn.y0 && local.y <= btn.y1) {
      p.params.on = !flag(p, 'on')
      return true
    }
    return false
  },
}
