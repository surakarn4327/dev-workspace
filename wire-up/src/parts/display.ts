import { COL, drawLabelAbove, drawText, rrect } from '../render/draw.ts'
import { drawSprite, pxLeg, pxRect } from '../render/pixel.ts'
import { scene } from '../render/scene.ts'
import { eng, LED_COLORS, LED_I_MAX, LED_N, LED_RS, LED_VR_MAX, ledIs } from '../sim/models.ts'
import { segDisplaySprite } from './art.ts'
import { eid, str, stress } from './common.ts'
import type { PartDef } from './types.ts'

// ---------------------------------------------------------------- seven-segment display

/** Segment name, the pin (0-based) it is wired to, and where it is drawn in the window (art pixels from the sprite's corner). */
const SEGMENTS: { name: string; pin: number; x: number; y: number; w: number; h: number }[] = [
  { name: 'a', pin: 6, x: 15, y: 9, w: 20, h: 3 },
  { name: 'b', pin: 5, x: 35, y: 12, w: 3, h: 10 },
  { name: 'c', pin: 3, x: 35, y: 25, w: 3, h: 10 },
  { name: 'd', pin: 1, x: 15, y: 34, w: 20, h: 3 },
  { name: 'e', pin: 0, x: 12, y: 25, w: 3, h: 10 },
  { name: 'f', pin: 8, x: 12, y: 12, w: 3, h: 10 },
  { name: 'g', pin: 9, x: 15, y: 22, w: 20, h: 3 },
  { name: 'dp', pin: 4, x: 40, y: 34, w: 3, h: 3 },
]
const COM_PINS = [2, 7]
const PIN_NAMES = ['E', 'D', 'COM', 'C', 'DP', 'B', 'A', 'COM', 'F', 'G']
/** Origin of the sprite in the part's own frame. */
const OX = -10
const OY = 14

const red = LED_COLORS.red

export const seg7: PartDef = {
  type: 'seg7',
  name: '7-segment display',
  category: 'logic',
  blurb:
    'One-digit LED display, 10 pins (like the FND500). Each segment is an LED: give it a resistor. Pins 1-5 bottom row left to right: E D COM C DP; 6-10 top row right to left: B A COM F G. Both COM pins are joined inside.',
  pinLabels: PIN_NAMES,
  hidePinLabels: true, // a real display has no printed pin names; the pinout is in the description
  defaults: () => ({ common: 'cathode' }),
  pins: () => Array.from({ length: 10 }, (_, i) => (i < 5 ? { x: i, y: 6 } : { x: 4 - (i - 5), y: 0 })),
  bounds: () => ({ x: -12, y: -4, w: 104, h: 130 }),
  build(p, ctx) {
    if (p.state.failed) return
    const anode = str(p, 'common', 'cathode') === 'anode'
    const com = ctx.pins[COM_PINS[0]]
    // the two COM pins are one wire inside the package
    ctx.add({ kind: 'R', id: ctx.id('com'), a: com, b: ctx.pins[COM_PINS[1]], r: 0.01 })
    for (const s of SEGMENTS) {
      const mid = ctx.newNode()
      const pin = ctx.pins[s.pin]
      const led = { is: ledIs(red.vf10), n: LED_N }
      if (anode) {
        // common anode: current flows from COM through the LED and out of the segment pin
        ctx.add({ kind: 'D', id: ctx.id(`d_${s.name}`), a: com, b: mid, ...led })
        ctx.add({ kind: 'R', id: ctx.id(`rs_${s.name}`), a: mid, b: pin, r: LED_RS })
      } else {
        ctx.add({ kind: 'R', id: ctx.id(`rs_${s.name}`), a: pin, b: mid, r: LED_RS })
        ctx.add({ kind: 'D', id: ctx.id(`d_${s.name}`), a: mid, b: com, ...led })
      }
    }
  },
  evaluate(p, env) {
    const anode = str(p, 'common', 'cathode') === 'anode'
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
      const rev = anode ? vSeg - vCom : vCom - vSeg
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
          ? `Segment ${worstName} was reverse-biased: an LED segment takes at most ${LED_VR_MAX} V backwards. Check which way the COM pin should go (${anode ? 'to +' : 'to -'}).`
          : `Segment ${worstName} carried ${eng(worst * LED_I_MAX, 'A')}; one segment is rated for ${eng(LED_I_MAX, 'A')} (normal: 10-20 mA). Add a resistor in series with each segment: R = (Vsupply - 2 V) / 0.01 A.`,
      ),
    }
  },
  draw(c, p, live) {
    const anode = str(p, 'common', 'cathode') === 'anode'
    const label = anode ? '7-seg common anode' : '7-seg common cathode'
    if (scene.pixel) {
      // pins first (they end under the body), then the block over them
      for (let i = 0; i < 5; i++) {
        pxLeg(c, i * 20, 0, 18)
        pxLeg(c, i * 20, 102, 120)
      }
      const body = segDisplaySprite()
      drawSprite(c, body, OX, OY)
      for (const s of SEGMENTS) {
        const i = live[`i_${s.name}`] ?? 0
        const b = i > 1e-5 ? Math.min(1, i / 0.012) : 0
        pxRect(c, OX, OY, s.x, s.y, s.w, s.h, '#4a0d12')
        if (b > 0) {
          c.globalAlpha = Math.min(1, 0.25 + b)
          pxRect(c, OX, OY, s.x, s.y, s.w, s.h, '#ff3b4a')
          // a lighter core down the middle of each bar
          if (s.w > s.h) pxRect(c, OX, OY, s.x + 1, s.y + 1, s.w - 2, 1, '#ff9aa2')
          else if (s.h > s.w) pxRect(c, OX, OY, s.x + 1, s.y + 1, 1, s.h - 2, '#ff9aa2')
          c.globalAlpha = 1
        }
      }
      drawText(c, 'FND500', 40, 97, { color: '#e8c8cc', align: 'center' })
      if (scene.labeled.has(p.id)) drawLabelAbove(c, label, 40, -2) // above the top row of pins (their outline reaches 2 above the pin point)
      return
    }
    for (let i = 0; i < 5; i++) {
      c.fillStyle = COL.metal
      c.fillRect(i * 20 - 2, 0, 4, 18)
      c.fillRect(i * 20 - 2, 102, 4, 18)
    }
    c.fillStyle = '#86202a'
    rrect(c, OX, OY, 100, 92, 6)
    c.fill()
    c.fillStyle = '#210508'
    c.fillRect(OX + 10, OY + 8, 80, 76)
    for (const s of SEGMENTS) {
      const on = (live[`i_${s.name}`] ?? 0) > 1e-5
      c.fillStyle = on ? '#ff3b4a' : '#4a0d12'
      c.fillRect(OX + s.x * 2, OY + s.y * 2, s.w * 2, s.h * 2)
    }
    if (scene.labeled.has(p.id)) drawLabelAbove(c, label, 40, 0)
  },
  fields: () => [
    {
      kind: 'select',
      key: 'common',
      label: 'Common pin',
      options: [
        { value: 'cathode', label: 'Common cathode (COM to -)' },
        { value: 'anode', label: 'Common anode (COM to +)' },
      ],
    },
  ],
  summary: (p) => `${str(p, 'common', 'cathode') === 'anode' ? 'Common anode' : 'Common cathode'}, 8 red LEDs, 30 mA each max`,
}
