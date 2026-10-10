// Pinout of the selected 74HC chip, drawn on its own transparent canvas that floats over the board beside the right panel:
// just the package (notch on the left), numbered pin boxes, the words VCC and GND, and the gates inside wired to their real
// pins, in white lines straight on the dark board (style.md 4.02).

import { CHIP_INFO, NE555_PINS } from '../parts/ic.ts'
import type { ChipInfo } from '../parts/ic.ts'
import { gateGeometry } from '../parts/art.ts'
import { SEG_INFO, SEGMENTS } from '../parts/display.ts'
import { drawText } from '../render/draw.ts'
import type { PartInstance } from '../board/world.ts'
import type { GateFn } from '../sim/solver.ts'

/** Colours of the pinout drawing (style.md 2.9). */
export const SHEET = { ink: '#ffffff' }

// drawing frame: the package spans x 14..222, y 62..150 and the pin boxes and words around it fit in 228 x 192
const W = 228
const H = 192
const OFFSET = { x: -6, y: -22 }
const PITCH = 29
const X0 = 30 // column of pin 1 / pin 14
const CHIP = { x: 14, y: 62, w: 208, h: 112 }
const BOX = 16
const GATE_Y = { top: 90, bottom: 146 } // gate centres: each gate and all its wires stay inside its own half of the package, so nothing crosses a symbol
const LANE = 10 // how far wires run before turning toward a gate
const SCALE = 0.36 // gate geometry units -> sheet px

/** Pin k (1..14) column x and whether it is on the top row. */
function pinCol(k: number): { x: number; top: boolean } {
  return k <= 7 ? { x: X0 + (k - 1) * PITCH, top: false } : { x: X0 + (14 - k) * PITCH, top: true }
}

function line(c: CanvasRenderingContext2D, pts: [number, number][]): void {
  c.beginPath()
  pts.forEach(([x, y], i) => (i === 0 ? c.moveTo(x, y) : c.lineTo(x, y)))
  c.stroke()
}

/** One gate standing between its pins: bottom-row gates point up, top-row ones down; wires turn at right angles. */
function drawGate(c: CanvasRenderingContext2D, fn: GateFn, g: number[]): void {
  const ins = g.length === 2 ? [g[0]] : [g[0], g[1]]
  const out = pinCol(g[g.length - 1])
  const top = out.top
  const edge = top ? CHIP.y : CHIP.y + CHIP.h
  const cy = top ? GATE_Y.top : GATE_Y.bottom
  const inXs = ins.map((k) => pinCol(k).x).sort((p, q) => p - q)
  const cx = inXs.reduce((sum, x) => sum + x, 0) / inXs.length
  const dir = top ? 1 : -1 // screen y per unit along the gate's output direction
  // geometry: u runs input -> output, v across; turned so the output points away from the gate's own pin row
  const at = (u: number, v: number): [number, number] => [cx - dir * v * SCALE, cy + dir * u * SCALE]
  const geo = gateGeometry(fn)
  const legs = ins.length + 1
  for (const poly of geo.polys.slice(0, geo.polys.length - legs)) line(c, poly.map(([u, v]) => at(u, v)))
  for (const [u, v, r] of geo.circles) {
    c.beginPath()
    c.arc(...at(u, v), r * SCALE, 0, Math.PI * 2)
    c.stroke()
  }
  // inputs: left pin to the left input, so the wires never cross
  const inEnds = geo.polys
    .slice(geo.polys.length - legs, geo.polys.length - 1)
    .map((leg) => at(leg[1][0], leg[1][1]))
    .sort((p, q) => p[0] - q[0])
  inXs.forEach((x, i) => {
    const [ex, ey] = inEnds[i]
    const lane = ey - dir * LANE
    line(c, [[x, edge], [x, lane], [ex, lane], [ex, ey]])
  })
  const outLeg = geo.polys[geo.polys.length - 1]
  const [ox, oy] = at(outLeg[0][0], 0)
  const lane = oy + dir * LANE
  line(c, [[ox, oy], [ox, lane], [out.x, lane], [out.x, edge]])
}

function drawSheet(c: CanvasRenderingContext2D, info: ChipInfo): void {
  c.translate(OFFSET.x, OFFSET.y)
  c.strokeStyle = SHEET.ink
  c.lineWidth = 1.5
  c.lineCap = 'square'
  c.lineJoin = 'miter'
  // package with the notch on the left
  const mid = CHIP.y + CHIP.h / 2
  c.beginPath()
  c.moveTo(CHIP.x, CHIP.y)
  c.lineTo(CHIP.x + CHIP.w, CHIP.y)
  c.lineTo(CHIP.x + CHIP.w, CHIP.y + CHIP.h)
  c.lineTo(CHIP.x, CHIP.y + CHIP.h)
  c.lineTo(CHIP.x, mid + 8)
  c.arc(CHIP.x, mid, 8, Math.PI / 2, -Math.PI / 2, true)
  c.closePath()
  c.stroke()
  for (const g of info.layout) drawGate(c, info.fn, g)
  // numbered pin boxes
  for (let k = 1; k <= 14; k++) {
    const p = pinCol(k)
    const y = p.top ? CHIP.y - BOX : CHIP.y + CHIP.h
    c.strokeRect(p.x - BOX / 2, y, BOX, BOX)
    drawText(c, String(k), p.x, y + 3, { color: SHEET.ink, align: 'center', size: 10 })
  }
  drawText(c, 'VCC', pinCol(14).x - BOX / 2, CHIP.y - BOX - 16, { color: SHEET.ink, size: 10 })
  drawText(c, 'GND', pinCol(7).x - BOX / 2, CHIP.y + CHIP.h + BOX + 4, { color: SHEET.ink, size: 10 })
}

// ---------------------------------------------------------------- seven-segment displays

const SEG_M = { x: 12, y: 38 } // margins round the package: the canvas hugs the drawing so the panel's right edge anchor puts it as close as the chip sheet

/** Size of the pinout canvas for a display with this many digits (one digit drawn at full size, four digits at 0.6). */
function segSize(digits: number): { w: number; h: number; k: number } {
  const k = digits === 1 ? 1 : 0.6
  return { w: Math.round(digits * 100 * k + 2 * SEG_M.x), h: Math.round(165 * k + 79), k }
}

/** The pinout of a seven-segment display: the black package, the digits with their segment letters, numbered pin boxes and the pin names. */
function drawSegSheet(c: CanvasRenderingContext2D, type: string): void {
  const info = SEG_INFO.get(type)!
  const { w: sheetW, k } = segSize(info.digits)
  c.strokeStyle = SHEET.ink
  c.lineWidth = 1.5
  c.lineCap = 'square'
  c.lineJoin = 'miter'
  const x = SEG_M.x
  const y = SEG_M.y
  const w = sheetW - 2 * SEG_M.x
  const h = 165 * k
  c.strokeRect(x, y, w, h)
  // each digit: every segment as the same pointed bar the part draws (art pixels x 2 x k), centred in its cell
  const oy = y + (h - 114 * k) / 2 - 12 * k
  for (let d = 0; d < info.digits; d++) {
    const cellX = x + d * 100 * k
    for (const s of SEGMENTS) {
      const sx = cellX + s.x * 2 * k
      const sy = oy + s.y * 2 * k
      const sw = s.w * 2 * k
      const sh = s.h * 2 * k
      if (s.name === 'dp') {
        c.beginPath()
        c.arc(sx + sw / 2, sy + sh / 2, sw / 2, 0, Math.PI * 2)
        c.stroke()
        continue
      }
      const t = Math.min(sw, sh) / 2
      const pts: [number, number][] =
        sw > sh
          ? [[sx + t, sy], [sx + sw - t, sy], [sx + sw, sy + t], [sx + sw - t, sy + sh], [sx + t, sy + sh], [sx, sy + t]]
          : [[sx + t, sy], [sx + sw, sy + t], [sx + sw, sy + sh - t], [sx + t, sy + sh], [sx, sy + sh - t], [sx, sy + t]]
      c.beginPath()
      pts.forEach(([px, py], i) => (i === 0 ? c.moveTo(px, py) : c.lineTo(px, py)))
      c.closePath()
      c.stroke()
      // the letter of each bar, small enough for the four-digit sheet (bars drawn at 0.6) too
      const size = info.digits === 1 ? 9 : 7
      drawText(c, s.name, sx + sw / 2, sy + sh / 2 - size / 2 - 1, { color: SHEET.ink, align: 'center', size })
    }
  }
  // numbered pin boxes (1..perRow along the bottom left to right, the rest back along the top) with the pin names beyond them
  const n = info.pinNames.length
  const x0 = x + w / 2 - ((info.perRow - 1) * 20) / 2
  for (let i = 0; i < n; i++) {
    const top = i >= info.perRow
    const px = x0 + (top ? info.perRow - 1 - (i - info.perRow) : i) * 20
    const by = top ? y - BOX : y + h
    c.strokeRect(px - BOX / 2, by, BOX, BOX)
    drawText(c, String(i + 1), px, by + 3, { color: SHEET.ink, align: 'center', size: 10 })
    drawText(c, info.pinNames[i], px, top ? by - 14 : by + BOX + 3, { color: SHEET.ink, align: 'center', size: 9 })
  }
}

// ---------------------------------------------------------------- NE555 timer

const TIMER_SIZE = { w: 190, h: 150 }

/** The timer's pinout: the eight-pin package with its notch on the left, numbered pin boxes and the pin names beyond them. */
function drawTimerSheet(c: CanvasRenderingContext2D): void {
  c.strokeStyle = SHEET.ink
  c.lineWidth = 1.5
  c.lineCap = 'square'
  c.lineJoin = 'miter'
  const pitch = 36
  const x = 14
  const y = 48
  const w = 3 * pitch + 60
  const h = 52
  const mid = y + h / 2
  c.beginPath()
  c.moveTo(x, y)
  c.lineTo(x + w, y)
  c.lineTo(x + w, y + h)
  c.lineTo(x, y + h)
  c.lineTo(x, mid + 8)
  c.arc(x, mid, 8, Math.PI / 2, -Math.PI / 2, true)
  c.closePath()
  c.stroke()
  const x0 = x + 30
  for (let k = 1; k <= 8; k++) {
    const top = k > 4
    const px = x0 + (top ? 8 - k : k - 1) * pitch
    const by = top ? y - BOX : y + h
    c.strokeRect(px - BOX / 2, by, BOX, BOX)
    drawText(c, String(k), px, by + 3, { color: SHEET.ink, align: 'center', size: 10 })
    drawText(c, NE555_PINS[k - 1], px, top ? by - 14 : by + BOX + 3, { color: SHEET.ink, align: 'center', size: 9 })
  }
}

/** Show the pinout for the selected chip or display, or hide it when anything else (or nothing) is selected. */
export function updateChipSheet(canvas: HTMLCanvasElement, part: PartInstance | undefined): void {
  const info = part ? CHIP_INFO.get(part.type) : undefined
  const seg = part ? SEG_INFO.has(part.type) : false
  const timer = part?.type === 'ic-ne555'
  if (!info && !seg && !timer) {
    canvas.style.display = 'none'
    canvas.dataset.chip = ''
    return
  }
  canvas.style.display = 'block'
  const key = part!.type
  if (canvas.dataset.chip === key) return
  canvas.dataset.chip = key
  const size = seg ? segSize(SEG_INFO.get(key)!.digits) : timer ? TIMER_SIZE : { w: W, h: H }
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.round(size.w * dpr)
  canvas.height = Math.round(size.h * dpr)
  canvas.style.width = `${size.w}px`
  canvas.style.height = `${size.h}px`
  const c = canvas.getContext('2d')
  if (!c) return
  c.setTransform(dpr, 0, 0, dpr, 0, 0)
  c.clearRect(0, 0, size.w, size.h)
  if (seg) drawSegSheet(c, key)
  else if (timer) drawTimerSheet(c)
  else drawSheet(c, info!)
}
