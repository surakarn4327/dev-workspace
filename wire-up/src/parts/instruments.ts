import { COL, drawText, rrect } from '../render/draw.ts'
import { eng } from '../sim/models.ts'
import { drawSprite, pxLine, pxRect } from '../render/pixel.ts'
import { scene } from '../render/scene.ts'
import { meterSprite } from './art.ts'
import { eid, str, stress } from './common.ts'
import type { PartInstance } from '../board/world.ts'
import type { PartDef, PartLive } from './types.ts'

export const METER_FUSE_A = 0.2
const OHM_TEST_A = 1e-3
const OHM_COMPLIANCE_R = 3000
const MODES = ['V', 'A', 'OHM'] as const

export function meterReading(mode: string, live: Record<string, number>): { text: string; unit: string } {
  if (mode === 'A') return { text: eng(live.i ?? 0, 'A'), unit: 'A' }
  if (mode === 'OHM') {
    const v = live.v ?? 0
    if (v >= 2.95) return { text: 'OL', unit: '' }
    const r = v / Math.max(OHM_TEST_A - v / OHM_COMPLIANCE_R, 1e-12)
    return { text: eng(Math.max(r, 0), 'Ω'), unit: 'Ω' }
  }
  return { text: eng(live.v ?? 0, 'V'), unit: 'V' }
}

function drawMeterPixel(c: CanvasRenderingContext2D, p: PartInstance, live: PartLive): void {
  const mode = str(p, 'mode', 'V')
  drawSprite(c, meterSprite(), 0, 0)
  const r = meterReading(mode, live)
  const blown = mode === 'A' && p.state.failed
  // dark digits on the pale LCD glass
  drawText(c, blown ? 'FUSE' : r.text, 104, 24, { color: blown ? '#a01020' : '#16301c', align: 'right', scale: 2 })
  drawText(c, mode === 'V' ? 'DC VOLTS' : mode === 'A' ? 'DC AMPS' : 'OHMS', 16, 15, { color: '#3d5a40' })
  const idx = Math.max(MODES.indexOf(mode as (typeof MODES)[number]), 0)
  const ang = (-60 + 60 * idx - 90) * (Math.PI / 180)
  // white pointer line on the black knob
  pxLine(c, 0, 0, 30, 56, 30 + Math.cos(ang) * 10, 56 + Math.sin(ang) * 10, '#f4f4f8')
  pxRect(c, 0, 0, 29, 55, 2, 2, '#f4f4f8')
  ;['V', 'A', 'Ω'].forEach((l, k) => {
    const a = (-60 + 60 * k - 90) * (Math.PI / 180)
    drawText(c, l, 60 + Math.cos(a) * 31, 112 + Math.sin(a) * 31 - 4, { color: k === idx ? '#ffffff' : '#8a8a98', align: 'center' })
  })
  drawText(c, 'click dial', 60, 156, { color: '#3a2600', align: 'center' })
}

export const meter: PartDef = {
  type: 'meter',
  name: 'Multimeter',
  category: 'instrument',
  blurb: 'Volts, amps, ohms. Click the dial to change mode. Drag probe tips onto the circuit.',
  freeLeads: true,
  fixedRot: true,
  leadTip: 'probe',
  leadColors: ['#ff3b4a', '#15151a'],
  pinLabels: ['red', 'black'],
  defaults: () => ({ mode: 'V' }),
  pins: () => [
    { x: 1, y: 11 },
    { x: 5, y: 11 },
  ],
  anchors: () => [
    { x: 34, y: 186 },
    { x: 86, y: 186 },
  ],
  bounds: () => ({ x: 0, y: 0, w: 120, h: 190 }),
  build(p, ctx) {
    const mode = str(p, 'mode', 'V')
    if (mode === 'V') {
      ctx.add({ kind: 'R', id: ctx.id('m'), a: ctx.pins[0], b: ctx.pins[1], r: 10e6 })
    } else if (mode === 'A') {
      if (p.state.failed) return
      ctx.add({ kind: 'R', id: ctx.id('m'), a: ctx.pins[0], b: ctx.pins[1], r: 0.1 })
    } else {
      ctx.add({ kind: 'I', id: ctx.id('t'), a: ctx.pins[1], b: ctx.pins[0], i: OHM_TEST_A })
      ctx.add({ kind: 'R', id: ctx.id('m'), a: ctx.pins[0], b: ctx.pins[1], r: OHM_COMPLIANCE_R })
    }
  },
  evaluate(p, env) {
    const mode = str(p, 'mode', 'V')
    const v = env.v(env.pins[0]) - env.v(env.pins[1])
    const c = env.cur(eid(p, 'm'))
    const i = mode === 'A' ? (c ? c.i : 0) : 0
    return {
      live: { v, i },
      stress:
        mode === 'A'
          ? stress(Math.abs(i) / METER_FUSE_A, () =>
              `Meter fuse blew: ${eng(Math.abs(i), 'A')} flowed through the ${METER_FUSE_A * 1000} mA input. In amps mode the meter is a wire: put it in SERIES with the load, never across a supply.`,
            )
          : undefined,
    }
  },
  draw(c, p, live) {
    if (scene.pixel) {
      drawMeterPixel(c, p, live)
      return
    }
    const mode = str(p, 'mode', 'V')
    c.fillStyle = '#e8a91c'
    rrect(c, 0, 0, 120, 190, 10)
    c.fill()
    c.fillStyle = '#c98c10'
    rrect(c, 4, 4, 112, 182, 8)
    c.fill()
    c.strokeStyle = COL.cyan
    c.lineWidth = 1
    c.globalAlpha = 0.6
    rrect(c, 0.5, 0.5, 119, 189, 10)
    c.stroke()
    c.globalAlpha = 1
    // LCD
    c.fillStyle = '#0b1a10'
    rrect(c, 12, 12, 96, 46, 4)
    c.fill()
    const r = meterReading(mode, live)
    const blown = mode === 'A' && p.state.failed
    drawText(c, blown ? 'FUSE' : r.text, 104, 24, { color: blown ? COL.red : COL.green, align: 'right', scale: 2 })
    drawText(c, mode === 'V' ? 'DC VOLTS' : mode === 'A' ? 'DC AMPS' : 'OHMS', 16, 15, { color: '#7fd8a0' })
    // dial
    const cx = 60
    const cy = 112
    c.fillStyle = '#1a1b22'
    c.beginPath()
    c.arc(cx, cy, 38, 0, Math.PI * 2)
    c.fill()
    c.fillStyle = '#2a2c36'
    c.beginPath()
    c.arc(cx, cy, 24, 0, Math.PI * 2)
    c.fill()
    const idx = MODES.indexOf(mode as (typeof MODES)[number])
    const ang = (-60 + 60 * Math.max(idx, 0) - 90) * (Math.PI / 180)
    c.strokeStyle = COL.cyan
    c.lineWidth = 3
    c.beginPath()
    c.moveTo(cx, cy)
    c.lineTo(cx + Math.cos(ang) * 22, cy + Math.sin(ang) * 22)
    c.stroke()
    const labels = ['V', 'A', 'Ω']
    labels.forEach((l, k) => {
      const a = (-60 + 60 * k - 90) * (Math.PI / 180)
      drawText(c, l, cx + Math.cos(a) * 31, cy + Math.sin(a) * 31 - 4, { color: k === idx ? COL.cyan : '#8e8aa8', align: 'center' })
    })
    drawText(c, 'click dial', cx, 156, { color: '#3a2600', align: 'center' })
    // jacks
    for (const [x, col] of [
      [34, '#ff3b4a'],
      [86, '#15151a'],
    ] as const) {
      c.fillStyle = col
      c.beginPath()
      c.arc(x, 176, 7, 0, Math.PI * 2)
      c.fill()
      c.strokeStyle = COL.metal
      c.lineWidth = 1.5
      c.stroke()
    }
  },
  fields: () => [
    {
      kind: 'select',
      key: 'mode',
      label: 'Mode',
      options: [
        { value: 'V', label: 'DC Volts' },
        { value: 'A', label: 'DC Amps (200 mA fuse)' },
        { value: 'OHM', label: 'Ohms' },
      ],
    },
  ],
  summary: (p) => `mode ${str(p, 'mode', 'V')}${p.state.failed ? ', fuse blown' : ''}`,
  click(p, local) {
    const dx = local.x - 60
    const dy = local.y - 112
    if (dx * dx + dy * dy <= 40 * 40) {
      const i = MODES.indexOf(str(p, 'mode', 'V') as (typeof MODES)[number])
      p.params.mode = MODES[(i + 1) % MODES.length]
      return true
    }
    return false
  },
}
