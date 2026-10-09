import { COL, drawLabelAbove, rrect } from '../render/draw.ts'
import { drawSprite, pxLeg, pxRect } from '../render/pixel.ts'
import { scene } from '../render/scene.ts'
import { eng, LED_COLORS, LED_I_MAX, LED_N, LED_RS, LED_VR_MAX, ledIs } from '../sim/models.ts'
import { segDisplaySprite } from './art.ts'
import { eid, stress } from './common.ts'
import type { PartDef } from './types.ts'

// ---------------------------------------------------------------- seven-segment display

/** Segment name, the pin (0-based) it is wired to, and where it is drawn in the window (art pixels from the sprite's corner). */
export const SEGMENTS: { name: string; pin: number; x: number; y: number; w: number; h: number }[] = [
  { name: 'a', pin: 6, x: 13, y: 8, w: 24, h: 5 },
  { name: 'b', pin: 5, x: 35, y: 11, w: 5, h: 24 },
  { name: 'c', pin: 3, x: 35, y: 36, w: 5, h: 24 },
  { name: 'd', pin: 1, x: 13, y: 58, w: 24, h: 5 },
  { name: 'e', pin: 0, x: 10, y: 36, w: 5, h: 24 },
  { name: 'f', pin: 8, x: 10, y: 11, w: 5, h: 24 },
  { name: 'g', pin: 9, x: 13, y: 33, w: 24, h: 5 },
  { name: 'dp', pin: 4, x: 42, y: 58, w: 4, h: 4 },
]
const COM_PINS = [2, 7]
export const PIN_NAMES = ['E', 'D', 'COM', 'C', 'DP', 'B', 'A', 'COM', 'F', 'G']
/** Origin of the sprite in the part's own frame. */
const OX = -10
const OY = 10

const red = LED_COLORS.red

/** One segment as a pixel bar with chamfered ends (the dot is a small round blob): `color` body, `core` a lighter line along it. */
function drawSegment(c: CanvasRenderingContext2D, s: (typeof SEGMENTS)[number], color: string, core: string): void {
  const px = (x: number, y: number, w: number, h: number, col: string) => pxRect(c, OX, OY, s.x + x, s.y + y, w, h, col)
  if (s.name === 'dp') {
    // a round dot
    px(1, 0, 2, 1, color)
    px(0, 1, 4, 2, color)
    px(1, 3, 2, 1, color)
    px(1, 1, 1, 1, core)
    return
  }
  // a bar 5 pixels thick whose two ends are cut at 45 degrees to a point, like the picture the user sent
  const inset = [2, 1, 0, 1, 2]
  if (s.w > s.h) {
    inset.forEach((k, r) => px(k, r, s.w - 2 * k, 1, color))
    px(3, 2, s.w - 6, 1, core)
  } else {
    inset.forEach((k, col) => px(col, k, 1, s.h - 2 * k, color))
    px(2, 3, 1, s.h - 6, core)
  }
}

export const seg7: PartDef = {
  type: 'seg7',
  name: '7-segment display',
  category: 'logic',
  blurb:
    'One-digit LED display, 10 pins. Each segment is an LED: give it a resistor. Common cathode: connect COM to -, and give a segment + through a resistor to light it. Pins 1-5 bottom row left to right: E D COM C DP; 6-10 top row right to left: B A COM F G. Both COM pins are joined inside.',
  pinLabels: PIN_NAMES,
  hidePinLabels: true, // a real display has no printed pin names; the pinout is in the description
  defaults: () => ({}),
  pins: () => Array.from({ length: 10 }, (_, i) => (i < 5 ? { x: i, y: 8 } : { x: 4 - (i - 5), y: 0 })),
  bounds: () => ({ x: -12, y: -4, w: 104, h: 170 }),
  build(p, ctx) {
    if (p.state.failed) return
    const com = ctx.pins[COM_PINS[0]]
    // the two COM pins are one wire inside the package
    ctx.add({ kind: 'R', id: ctx.id('com'), a: com, b: ctx.pins[COM_PINS[1]], r: 0.01 })
    for (const s of SEGMENTS) {
      const mid = ctx.newNode()
      const pin = ctx.pins[s.pin]
      const led = { is: ledIs(red.vf10), n: LED_N }
      // common cathode: current flows from the segment pin through the LED into COM
      ctx.add({ kind: 'R', id: ctx.id(`rs_${s.name}`), a: pin, b: mid, r: LED_RS })
      ctx.add({ kind: 'D', id: ctx.id(`d_${s.name}`), a: mid, b: com, ...led })
    }
  },
  evaluate(p, env) {
    const live: Record<string, number> = {}
    let total = 0
    let worst = 0
    let worstName = 'A'
    let worstRev = false
    for (const s of SEGMENTS) {
      const i = env.cur(eid(p, `d_${s.name}`))?.i ?? 0
      live[`i_${s.name}`] = i
      total += Math.max(i, 0)
      // forward current, or the reverse voltage across the segment
      const vSeg = env.v(env.pins[s.pin])
      const vCom = env.v(env.pins[COM_PINS[0]])
      const rev = vCom - vSeg
      const rF = i / LED_I_MAX
      const rR = rev / LED_VR_MAX
      const r = Math.max(rF, rR)
      if (r > worst) {
        worst = r
        worstName = s.name.toUpperCase()
        worstRev = rR > rF
      }
    }
    live.i = total
    return {
      live,
      stress: stress(worst, () =>
        worstRev
          ? `Segment ${worstName} was reverse-biased: an LED segment takes at most ${LED_VR_MAX} V backwards. Common cathode: the COM pins go to - and the segment pins get the + voltage.`
          : `Segment ${worstName} carried ${eng(worst * LED_I_MAX, 'A')}; one segment is rated for ${eng(LED_I_MAX, 'A')} (normal: 10-20 mA). Add a resistor in series with each segment: R = (Vsupply - 2 V) / 0.01 A.`,
      ),
    }
  },
  draw(c, p, live) {
    const label = '7-segment display'
    if (scene.pixel) {
      // pins first (they end under the body), then the block over them
      for (let i = 0; i < 5; i++) {
        pxLeg(c, i * 20, 0, 18)
        pxLeg(c, i * 20, 142, 160)
      }
      const body = segDisplaySprite()
      drawSprite(c, body, OX, OY)
      for (const s of SEGMENTS) {
        const i = live[`i_${s.name}`] ?? 0
        const b = i > 1e-5 ? Math.min(1, i / 0.012) : 0
        drawSegment(c, s, '#d8d6cd', '#efede6')
        if (b > 0) {
          c.globalAlpha = Math.min(1, 0.25 + b)
          drawSegment(c, s, '#ff3b4a', '#ff9aa2')
          c.globalAlpha = 1
        }
      }
      if (scene.labeled.has(p.id)) drawLabelAbove(c, label, 40, -2) // above the top row of pins (their outline reaches 2 above the pin point)
      return
    }
    for (let i = 0; i < 5; i++) {
      c.fillStyle = COL.metal
      c.fillRect(i * 20 - 2, 0, 4, 18)
      c.fillRect(i * 20 - 2, 142, 4, 18)
    }
    c.fillStyle = '#1d1d23'
    rrect(c, OX, OY, 100, 140, 6)
    c.fill()
    for (const s of SEGMENTS) {
      const on = (live[`i_${s.name}`] ?? 0) > 1e-5
      c.fillStyle = on ? '#ff3b4a' : '#cfcfc6'
      c.fillRect(OX + s.x * 2, OY + s.y * 2, s.w * 2, s.h * 2)
    }
    if (scene.labeled.has(p.id)) drawLabelAbove(c, label, 40, 0)
  },
  fields: () => [],
  summary: () => 'Common cathode: COM to -, 8 red LEDs, 30 mA each max',
}
