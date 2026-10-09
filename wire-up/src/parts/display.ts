import { COL, drawLabelAbove, rrect } from '../render/draw.ts'
import { drawSprite, PX, pxLeg } from '../render/pixel.ts'
import { scene } from '../render/scene.ts'
import { eng, LED_COLORS, LED_I_MAX, LED_N, LED_RS, LED_VR_MAX, ledIs } from '../sim/models.ts'
import { seg4DisplaySprite, segDisplaySprite } from './art.ts'
import { eid, stress } from './common.ts'
import type { PartDef } from './types.ts'

// ---------------------------------------------------------------- seven-segment displays (1 and 4 digits, common cathode)

/** Segment name and where it is drawn in one digit (art pixels from the left edge of that digit's 50 pixel wide cell). */
export const SEGMENTS: { name: string; x: number; y: number; w: number; h: number }[] = [
  { name: 'a', x: 11, y: 6, w: 27, h: 5 },
  { name: 'b', x: 36, y: 9, w: 5, h: 25 },
  { name: 'c', x: 36, y: 35, w: 5, h: 25 },
  { name: 'd', x: 11, y: 58, w: 27, h: 5 },
  { name: 'e', x: 8, y: 35, w: 5, h: 25 },
  { name: 'f', x: 8, y: 9, w: 5, h: 25 },
  { name: 'g', x: 11, y: 32, w: 27, h: 5 },
  { name: 'dp', x: 43, y: 58, w: 5, h: 5 },
]
export const DIGIT_W = 50 // art pixels per digit
const OY = 10

const red = LED_COLORS.red

const segCache = new Map<string, HTMLCanvasElement>()

/**
 * One segment as a flat pixel bar in one colour, with ends cut at 45 degrees to a point (the dot is a small round blob). Made once
 * as a tiny bitmap and drawn with no smoothing, like the sprites: drawing it row by row left hairline seams between the rows when
 * the board is zoomed to an odd size, so the bar looked like several strips side by side.
 */
function segBitmap(s: (typeof SEGMENTS)[number], color: string): HTMLCanvasElement {
  const key = `${s.name === 'dp' ? 'dp' : s.w > s.h ? 'h' : 'v'}${s.w}x${s.h}${color}`
  let bmp = segCache.get(key)
  if (!bmp) {
    bmp = document.createElement('canvas')
    bmp.width = s.w
    bmp.height = s.h
    const g = bmp.getContext('2d')!
    g.fillStyle = color
    const px = (x: number, y: number, w: number, h: number) => g.fillRect(x, y, w, h)
    if (s.name === 'dp') {
      // a round dot
      px(1, 0, 3, 1)
      px(0, 1, 5, 3)
      px(1, 4, 3, 1)
    } else {
      // a bar 5 pixels thick whose two ends are cut at 45 degrees to a point, like the picture the user sent
      const inset = [2, 1, 0, 1, 2]
      if (s.w > s.h) inset.forEach((k, r) => px(k, r, s.w - 2 * k, 1))
      else inset.forEach((k, col) => px(col, k, 1, s.h - 2 * k))
    }
    segCache.set(key, bmp)
  }
  return bmp
}

function drawSegment(c: CanvasRenderingContext2D, ox: number, s: (typeof SEGMENTS)[number], color: string): void {
  const smooth = c.imageSmoothingEnabled
  c.imageSmoothingEnabled = false
  c.drawImage(segBitmap(s, color), ox + s.x * PX, OY + s.y * PX, s.w * PX, s.h * PX)
  c.imageSmoothingEnabled = smooth
}

/** How far the glow of a lit segment reaches, in art pixels: about one bar thickness. */
const GLOW_R = 5
const glowCache = new Map<string, HTMLCanvasElement>()

/**
 * The light spilling from a lit segment: a stepped halo in the shape of the segment itself (not a circle), strongest at the edge of
 * the bar and fading out over `GLOW_R` art pixels. One pixel per art pixel, drawn with no smoothing like everything else.
 */
function glowBitmap(s: (typeof SEGMENTS)[number]): HTMLCanvasElement {
  const key = `${s.name === 'dp' ? 'dp' : s.w > s.h ? 'h' : 'v'}${s.w}x${s.h}`
  let bmp = glowCache.get(key)
  if (!bmp) {
    const shape = segBitmap(s, '#000000')
    const mask = shape.getContext('2d')!.getImageData(0, 0, s.w, s.h).data
    const lit = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < s.w && y < s.h && mask[(y * s.w + x) * 4 + 3] > 0
    const W = s.w + 2 * GLOW_R
    const H = s.h + 2 * GLOW_R
    bmp = document.createElement('canvas')
    bmp.width = W
    bmp.height = H
    const g = bmp.getContext('2d')!
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const sx = x - GLOW_R
        const sy = y - GLOW_R
        if (lit(sx, sy)) continue
        // distance to the nearest pixel of the bar
        let best = Infinity
        for (let dy = -GLOW_R; dy <= GLOW_R; dy++) for (let dx = -GLOW_R; dx <= GLOW_R; dx++) if (lit(sx + dx, sy + dy)) best = Math.min(best, Math.hypot(dx, dy))
        if (best > GLOW_R) continue
        const t = 1 - (best - 0.5) / (GLOW_R + 0.5)
        g.fillStyle = `rgba(255,59,74,${(0.55 * t * t).toFixed(3)})`
        g.fillRect(x, y, 1, 1)
      }
    }
    glowCache.set(key, bmp)
  }
  return bmp
}

function drawGlow(c: CanvasRenderingContext2D, ox: number, s: (typeof SEGMENTS)[number], strength: number): void {
  const smooth = c.imageSmoothingEnabled
  c.imageSmoothingEnabled = false
  c.globalAlpha = strength
  c.drawImage(glowBitmap(s), ox + (s.x - GLOW_R) * PX, OY + (s.y - GLOW_R) * PX, (s.w + 2 * GLOW_R) * PX, (s.h + 2 * GLOW_R) * PX)
  c.globalAlpha = 1
  c.imageSmoothingEnabled = smooth
}

/** What differs between the one-digit and the four-digit display. */
export interface SegDisplayInfo {
  digits: number
  /** Pin names, in pin order (pin 1 first). */
  pinNames: string[]
  /** Pins per row. */
  perRow: number
  /** Pin (0-based) each segment is wired to. */
  segPin: Record<string, number>
  /** Pins (0-based) that are the common cathode of each digit (several pins of one digit are joined inside). */
  comPins: number[][]
}

export const SEG_INFO = new Map<string, SegDisplayInfo>()

function makeSegDisplay(type: string, name: string, blurb: string, info: SegDisplayInfo): PartDef {
  SEG_INFO.set(type, info)
  const { digits, perRow } = info
  const n = info.pinNames.length
  const bodyW = digits * DIGIT_W * 2 // world px
  const pinSpan = (perRow - 1) * 20
  const ox = pinSpan / 2 - bodyW / 2 // world x of the body's left edge, the body centred on the pins
  const centre = pinSpan / 2
  const pinX = (i: number) => (i < perRow ? i : perRow - 1 - (i - perRow))
  return {
    type,
    name,
    category: 'logic',
    blurb,
    pinLabels: info.pinNames,
    hidePinLabels: true, // a real display has no printed pin names; the pinout is in the description and the picture
    defaults: () => ({}),
    pins: () => Array.from({ length: n }, (_, i) => ({ x: pinX(i), y: i < perRow ? 8 : 0 })),
    bounds: () => ({ x: Math.min(ox, -12), y: -4, w: Math.max(bodyW, pinSpan + 24), h: 170 }),
    build(p, ctx) {
      if (p.state.failed) return
      info.comPins.forEach((pins, d) => {
        // the common pins of one digit are one wire inside the package
        for (let k = 1; k < pins.length; k++) ctx.add({ kind: 'R', id: ctx.id(`com${d}_${k}`), a: ctx.pins[pins[0]], b: ctx.pins[pins[k]], r: 0.01, pinA: pins[0], pinB: pins[k] })
        const com = ctx.pins[pins[0]]
        for (const s of SEGMENTS) {
          const mid = ctx.newNode()
          // common cathode: current flows from the segment pin through the LED into the digit's common
          // pinA / pinB tell the wire-current code which pin each current belongs to when the user wires pins together
          ctx.add({ kind: 'R', id: ctx.id(`rs_${d}_${s.name}`), a: ctx.pins[info.segPin[s.name]], b: mid, r: LED_RS, pinA: info.segPin[s.name] })
          ctx.add({ kind: 'D', id: ctx.id(`d_${d}_${s.name}`), a: mid, b: com, is: ledIs(red.vf10), n: LED_N, pinB: pins[0] })
          // the plastic is not a perfect insulator: 10 Mohm between a segment pin and its common keeps a lone wired segment solvable (a common left unwired used to leave the solver spinning)
          ctx.add({ kind: 'R', id: ctx.id(`leak_${d}_${s.name}`), a: ctx.pins[info.segPin[s.name]], b: com, r: 1e7, pinA: info.segPin[s.name], pinB: pins[0] })
        }
      })
    },
    evaluate(p, env) {
      const live: Record<string, number> = {}
      let total = 0
      let worst = 0
      let worstName = 'A'
      let worstDigit = 0
      let worstRev = false
      info.comPins.forEach((pins, d) => {
        for (const s of SEGMENTS) {
          const i = env.cur(eid(p, `d_${d}_${s.name}`))?.i ?? 0
          live[`i_${d}_${s.name}`] = i
          total += Math.max(i, 0)
          // forward current, or the reverse voltage across the segment
          const rev = env.v(env.pins[pins[0]]) - env.v(env.pins[info.segPin[s.name]])
          const rF = i / LED_I_MAX
          const rR = rev / LED_VR_MAX
          const r = Math.max(rF, rR)
          if (r > worst) {
            worst = r
            worstName = s.name.toUpperCase()
            worstDigit = d + 1
            worstRev = rR > rF
          }
        }
      })
      live.i = total
      const where = digits > 1 ? `Digit ${worstDigit} segment ${worstName}` : `Segment ${worstName}`
      return {
        live,
        stress: stress(worst, () =>
          worstRev
            ? `${where} was reverse-biased: an LED segment takes at most ${LED_VR_MAX} V backwards. Common cathode: the digit's common pin goes to - and the segment pins get the + voltage.`
            : `${where} carried ${eng(worst * LED_I_MAX, 'A')}; one segment is rated for ${eng(LED_I_MAX, 'A')} (normal: 10-20 mA). Add a resistor in series with each segment: R = (Vsupply - 2 V) / 0.01 A.`,
        ),
      }
    },
    draw(c, p, live) {
      const label = digits > 1 ? `${digits}-digit 7-segment display` : '7-segment display'
      if (scene.pixel) {
        // pins first (they end under the body), then the block over them
        for (let i = 0; i < perRow; i++) {
          pxLeg(c, i * 20, 0, 18)
          pxLeg(c, i * 20, 142, 160)
        }
        const body = digits > 1 ? seg4DisplaySprite() : segDisplaySprite()
        drawSprite(c, body, ox, OY)
        const brightness = (d: number, name: string): number => {
          const i = live[`i_${d}_${name}`] ?? 0
          // an LED looks bright well below its full current: about half of the brightness is reached at a quarter of 12 mA
          return i > 1e-5 ? Math.min(1, Math.sqrt(i / 0.012)) : 0
        }
        // the light of every lit segment first (so it lies under the bars), then the bars
        for (let d = 0; d < digits; d++) {
          const dx = ox + d * DIGIT_W * 2
          for (const s of SEGMENTS) {
            const b = brightness(d, s.name)
            if (b > 0) drawGlow(c, dx, s, b)
          }
        }
        for (let d = 0; d < digits; d++) {
          const dx = ox + d * DIGIT_W * 2
          for (const s of SEGMENTS) {
            const b = brightness(d, s.name)
            drawSegment(c, dx, s, '#a9a7a4')
            if (b > 0) {
              c.globalAlpha = Math.min(1, 0.3 + 0.8 * b)
              drawSegment(c, dx, s, '#ff3b4a')
              c.globalAlpha = 1
            }
          }
        }
        if (scene.labeled.has(p.id)) drawLabelAbove(c, label, centre, -2) // above the top row of pins (their outline reaches 2 above the pin point)
        return
      }
      for (let i = 0; i < perRow; i++) {
        c.fillStyle = COL.metal
        c.fillRect(i * 20 - 2, 0, 4, 18)
        c.fillRect(i * 20 - 2, 142, 4, 18)
      }
      c.fillStyle = '#1d1d23'
      rrect(c, ox, OY, bodyW, 140, 6)
      c.fill()
      for (let d = 0; d < digits; d++) {
        for (const s of SEGMENTS) {
          const on = (live[`i_${d}_${s.name}`] ?? 0) > 1e-5
          c.fillStyle = on ? '#ff3b4a' : '#a9a7a4'
          c.fillRect(ox + d * DIGIT_W * 2 + s.x * 2, OY + s.y * 2, s.w * 2, s.h * 2)
        }
      }
      if (scene.labeled.has(p.id)) drawLabelAbove(c, label, centre, 0)
    },
    fields: () => [],
    summary: () => (digits > 1 ? `${digits} digits, common cathode per digit, 8 red LEDs each, 30 mA per segment max` : 'Common cathode: COM to -, 8 red LEDs, 30 mA each max'),
  }
}

export const seg7 = makeSegDisplay(
  'seg7',
  '7-segment display',
  'One-digit LED display, 10 pins. Each segment is an LED: give it a resistor. Common cathode: connect COM to -, and give a segment + through a resistor to light it. Pins 1-5 bottom row left to right: E D COM C DP; 6-10 top row right to left: B A COM F G. Both COM pins are joined inside.',
  {
    digits: 1,
    perRow: 5,
    pinNames: ['E', 'D', 'COM', 'C', 'DP', 'B', 'A', 'COM', 'F', 'G'],
    segPin: { a: 6, b: 5, c: 3, d: 1, e: 0, f: 8, g: 9, dp: 4 },
    comPins: [[2, 7]],
  },
)

export const seg7x4 = makeSegDisplay(
  'seg7x4',
  '7-segment display (4 digits)',
  'Four-digit LED display, 12 pins, common cathode per digit. The segment pins A-G and DP are shared by all four digits; D1-D4 are the commons of the digits, left to right. Connect a digit pin to - and give a segment + through a resistor to light that segment in that digit. Pins 1-6 bottom row left to right: E D DP C G D4; 7-12 top row right to left: B D3 D2 F A D1.',
  {
    digits: 4,
    perRow: 6,
    pinNames: ['E', 'D', 'DP', 'C', 'G', 'D4', 'B', 'D3', 'D2', 'F', 'A', 'D1'],
    segPin: { a: 10, b: 6, c: 3, d: 1, e: 0, f: 9, g: 4, dp: 2 },
    comPins: [[11], [8], [7], [5]],
  },
)
