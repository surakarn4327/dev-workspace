import { COL, drawLabelAbove, drawText, leg, mix, radialGlow, rrect } from '../render/draw.ts'
import { BJT, DIODE, eng, LED_COLORS, LED_I_MAX, LED_I_RATED, LED_N, LED_RS, LED_VR_MAX, ledIs } from '../sim/models.ts'
import { drawSprite, pxLeg, pxLine, spriteInk } from '../render/pixel.ts'
import { scene } from '../render/scene.ts'
import { diodeSprite, ledSprite, to92Sprite } from './art.ts'
import { eid, legDrop, legGrid, LEG_FIELD, spreadOf, str, stress, U } from './common.ts'
import type { PartDef } from './types.ts'

// ---------------------------------------------------------------- LED

export const led: PartDef = {
  type: 'led',
  name: 'LED (5 mm)',
  category: 'semiconductor',
  blurb: 'Lights up when current flows anode to cathode. Needs a resistor!',
  pinLabels: ['A', 'K'],
  pinLabelPlace: 'below',
  tipPastPin: 6,
  tipPastPinVector: 2,
  defaults: () => ({ color: 'red', legs: 1 }),
  pins: (p) => [
    { x: 0, y: legGrid(p) },
    { x: 1, y: legGrid(p) },
  ],
  bounds: (p) => ({ x: -16, y: -66, w: 52, h: 76 + legDrop(p) }),
  build(p, ctx) {
    if (p.state.failed) return
    const col = LED_COLORS[str(p, 'color', 'red')] ?? LED_COLORS.red
    const mid = ctx.newNode()
    ctx.add({ kind: 'R', id: ctx.id('rs'), a: ctx.pins[0], b: mid, r: LED_RS })
    ctx.add({ kind: 'D', id: ctx.id('d'), a: mid, b: ctx.pins[1], is: ledIs(col.vf10), n: LED_N })
  },
  evaluate(p, env) {
    const cur = env.cur(eid(p, 'd'))
    const i = cur ? cur.i : 0
    const v = env.v(env.pins[0]) - env.v(env.pins[1])
    const rev = Math.max(-v, 0)
    const b = Math.min(Math.max(i, 0) / LED_I_RATED, 1.6) ** 0.6
    return {
      live: { i, v, b },
      stress: stress(Math.max(i / LED_I_MAX, rev / LED_VR_MAX), () =>
        rev / LED_VR_MAX > i / LED_I_MAX
          ? `LED was reverse-biased with ${eng(rev, 'V')}; the maximum reverse voltage is ${LED_VR_MAX} V. Check which leg is the anode (the longer leg, round side).`
          : `LED carried ${eng(i, 'A')}; the absolute maximum is ${eng(LED_I_MAX, 'A')} (normal: ${eng(LED_I_RATED, 'A')}). Add a series resistor: R = (Vsupply - Vf) / 0.02 A.`,
      ),
    }
  },
  draw(c, p, live) {
    const col = LED_COLORS[str(p, 'color', 'red')] ?? LED_COLORS.red
    const b = live.b ?? 0
    if (scene.pixel) {
      for (const x of [0, 20]) pxLeg(c, x, -12, 4 + legDrop(p))
      drawSprite(c, ledSprite(col.body, false), -14, -62)
      if (b > 0) {
        c.globalAlpha = Math.min(1, b)
        drawSprite(c, ledSprite(col.body, true), -14, -62)
        c.globalAlpha = 1
      }
      radialGlow(c, 10, -42, 36 + 90 * b, col.glow, 0.85 * b)
      return
    }
    leg(c, 0, 0, 0, -6)
    leg(c, 20, 0, 20, 4)
    // flange + dome (top view)
    c.fillStyle = mix('#1a1a20', col.body, 0.25 + 0.6 * b)
    c.beginPath()
    c.arc(10, -4, 20, 0, Math.PI * 2)
    c.fill()
    c.fillStyle = mix('#222228', col.body, 0.35 + 0.65 * b)
    c.beginPath()
    c.arc(10, -4, 17, 0, Math.PI * 2)
    c.fill()
    // flat edge on the cathode side
    c.fillStyle = COL.bg
    c.fillRect(27, -26, 6, 44)
    c.fillStyle = mix('#222228', col.body, 0.3 + 0.6 * b)
    c.fillRect(26, -14, 2, 20)
    // die and anvil
    c.fillStyle = 'rgba(255,255,255,0.35)'
    c.fillRect(4, -9, 3, 10)
    c.fillRect(12, -9, 3, 6)
    c.fillStyle = 'rgba(255,255,255,0.28)'
    c.beginPath()
    c.arc(3, -14, 5, 0, Math.PI * 2)
    c.fill()
    radialGlow(c, 10, -4, 36 + 90 * b, col.glow, 0.85 * b)
    if (legDrop(p) > 0) for (const x of [0, 20]) leg(c, x, 4, x, legDrop(p))
  },
  fields: () => [
    {
      kind: 'select',
      key: 'color',
      label: 'Colour',
      options: Object.entries(LED_COLORS).map(([k, v]) => ({ value: k, label: v.name })),
    },
    LEG_FIELD,
  ],
  summary: (p) => `${(LED_COLORS[str(p, 'color', 'red')] ?? LED_COLORS.red).name} LED, max ${LED_I_MAX * 1000} mA`,
}

// ---------------------------------------------------------------- diode

export const diode: PartDef = {
  type: 'diode',
  name: 'Diode (1N4007)',
  category: 'semiconductor',
  blurb: 'One-way valve for current. Band marks the cathode.',
  pinLabels: ['A', 'K'],
  pinLabelPlace: 'axis',
  tipPastPinVector: 2,
  defaults: () => ({ legs: 1 }),
  pins: (p) => [
    { x: 0, y: 0 },
    { x: spreadOf(p), y: 0 },
  ],
  bounds: (p) => ({ x: -12, y: -14, w: spreadOf(p) * U + 24, h: 28 }),
  build(p, ctx) {
    if (p.state.failed) return
    const mid = ctx.newNode()
    ctx.add({ kind: 'R', id: ctx.id('rs'), a: ctx.pins[0], b: mid, r: DIODE.rs })
    ctx.add({ kind: 'D', id: ctx.id('d'), a: mid, b: ctx.pins[1], is: DIODE.is, n: DIODE.n })
  },
  evaluate(p, env) {
    const cur = env.cur(eid(p, 'd'))
    const i = cur ? cur.i : 0
    const v = env.v(env.pins[0]) - env.v(env.pins[1])
    return {
      live: { i, v },
      stress: stress(Math.max(i / DIODE.iMax, -v / DIODE.vrMax), () =>
        `Diode carried ${eng(i, 'A')}; the 1N4007 is rated for ${eng(DIODE.iMax, 'A')} forward current. Add a resistor or use a bigger rectifier.`,
      ),
    }
  },
  draw(c, p) {
    if (scene.pixel) {
      const sp = spreadOf(p) * U
      const cx = sp / 2
      const body = diodeSprite()
      drawSprite(c, body, cx - 22, -10)
      for (const [x0, x1] of [
        [0, cx - 24],
        [cx + 24, sp],
      ]) {
        c.fillStyle = COL.metal
        c.fillRect(x0, -2, x1 - x0, 2)
        c.fillStyle = COL.metalDark
        c.fillRect(x0, 0, x1 - x0, 2)
      }
      if (scene.labeled.has(p.id)) drawLabelAbove(c, '1N4007', cx, spriteInk(body, cx - 22, -10).top)
      return
    }
    const sp = spreadOf(p) * U
    const cx = sp / 2
    leg(c, 0, 0, cx - 20, 0)
    leg(c, cx + 20, 0, sp, 0)
    c.save()
    c.translate(cx - 40, 0)
    c.fillStyle = '#1b1b20'
    rrect(c, 19, -10, 42, 20, 3)
    c.fill()
    c.fillStyle = 'rgba(255,255,255,0.14)'
    c.fillRect(21, -9, 38, 3)
    c.fillStyle = '#c4c9d1'
    c.fillRect(49, -10, 7, 20)
    c.fillStyle = 'rgba(0,0,0,0.25)'
    c.fillRect(54, -10, 2, 20)
    c.restore()
    if (scene.labeled.has(p.id)) drawLabelAbove(c, '1N4007', cx, -10)
  },
  fields: () => [LEG_FIELD],
  summary: () => `1N4007, ${DIODE.iMax} A, ${DIODE.vrMax} V`,
}

// ---------------------------------------------------------------- bipolar transistors

function bjt(type: string, name: string, pol: 1 | -1, label: string): PartDef {
  const npn = pol === 1
  return {
    type,
    name,
    category: 'semiconductor',
    blurb: npn
      ? 'NPN switch/amplifier. A small base current controls a big collector current.'
      : 'PNP: conducts when the base is pulled LOW relative to the emitter.',
    pinLabels: ['C', 'B', 'E'],
    pinLabelPlace: 'below',
    tipPastPin: 4,
    tipPastPinVector: 2,
    defaults: () => ({ legs: 1 }),
    pins: (p) => [
      { x: 0, y: legGrid(p) },
      { x: 1, y: legGrid(p) },
      { x: 2, y: legGrid(p) },
    ],
    bounds: (p) => ({ x: -12, y: -48, w: 64, h: 58 + legDrop(p) }),
    build(p, ctx) {
      if (p.state.failed) return
      ctx.add({ kind: 'Q', id: ctx.id('q'), c: ctx.pins[0], b: ctx.pins[1], e: ctx.pins[2], pol, is: BJT.is, bf: BJT.bf, br: BJT.br })
    },
    evaluate(p, env) {
      const q = env.cur(eid(p, 'q'))
      const ic = q ? q.i : 0
      const ib = q ? (q.ib ?? 0) : 0
      const vc = env.v(env.pins[0])
      const vb = env.v(env.pins[1])
      const ve = env.v(env.pins[2])
      const vce = vc - ve
      const vbe = vb - ve
      const pd = Math.abs(vce * ic + vbe * ib)
      const revBe = Math.max(-pol * vbe, 0)
      const worst = Math.max(Math.abs(ic) / BJT.icMax, pd / BJT.pdMax, Math.abs(vce) / BJT.vceMax, revBe / BJT.vebMax)
      return {
        live: { ic, ib, vce, vbe, pd },
        stress: stress(worst, () => {
          if (revBe / BJT.vebMax >= worst) return `Base-emitter junction was reverse-biased by ${eng(revBe, 'V')} (max ${BJT.vebMax} V).`
          if (Math.abs(vce) / BJT.vceMax >= worst) return `Collector-emitter voltage reached ${eng(Math.abs(vce), 'V')} (max ${BJT.vceMax} V).`
          if (pd / BJT.pdMax >= worst)
            return `Transistor dissipated ${eng(pd, 'W')} (Vce ${eng(Math.abs(vce), 'V')} x Ic ${eng(Math.abs(ic), 'A')}); the limit is ${eng(BJT.pdMax, 'W')}.`
          return `Collector current reached ${eng(Math.abs(ic), 'A')}; the limit is ${eng(BJT.icMax, 'A')}. Use a resistor in the collector path.`
        }),
      }
    },
    draw(c, p, live) {
      if (scene.pixel) {
        // middle leg straight; outer legs go up from the pins, then slant in under the body (art-pixel diagonals)
        for (let k = 0; k < 3; k++) {
          c.fillStyle = COL.metal
          c.fillRect(k * U - 2, k === 1 ? -10 : 0, 2, (k === 1 ? 14 : 4) + legDrop(p))
          c.fillStyle = COL.metalDark
          c.fillRect(k * U, k === 1 ? -10 : 0, 2, (k === 1 ? 14 : 4) + legDrop(p))
        }
        for (const [x, tx] of [
          [0, 5],
          [40, 15],
        ]) {
          pxLine(c, 0, 0, x / 2 - 1, 0, tx - 1, -7, COL.metal)
          pxLine(c, 0, 0, x / 2, 0, tx, -7, COL.metalDark)
        }
        drawSprite(c, to92Sprite(), 0, -44)
        drawText(c, label, 20, -24, { color: '#8e8aa8', align: 'center' })
        const lit = Math.abs(live.ic ?? 0) > 1e-4
        radialGlow(c, 20, -26, 30, lit ? '#39ff88' : '#000000', lit ? Math.min(Math.abs(live.ic ?? 0) / 0.05, 0.4) : 0)
        return
      }
      for (let k = 0; k < 3; k++) leg(c, k * U, 0, k * U, -8)
      if (legDrop(p) > 0) for (let k = 0; k < 3; k++) leg(c, k * U, 4, k * U, legDrop(p))
      // TO-92: curved top, flat bottom
      c.fillStyle = '#17171c'
      c.beginPath()
      c.arc(20, -8, 21, Math.PI, 2 * Math.PI)
      c.closePath()
      c.fill()
      c.fillStyle = 'rgba(255,255,255,0.12)'
      c.beginPath()
      c.arc(20, -8, 17, Math.PI * 1.05, Math.PI * 1.55)
      c.lineTo(20, -8)
      c.fill()
      c.strokeStyle = '#2b2b33'
      c.lineWidth = 1
      c.beginPath()
      c.moveTo(-1, -8)
      c.lineTo(41, -8)
      c.stroke()
      drawText(c, label, 20, -22, { color: '#8e8aa8', align: 'center' })
      const on = Math.abs(live.ic ?? 0) > 1e-4
      radialGlow(c, 20, -14, 30, on ? '#39ff88' : '#000000', on ? Math.min(Math.abs(live.ic ?? 0) / 0.05, 0.4) : 0)
    },
    fields: () => [LEG_FIELD],
    summary: () => `${label}, ${BJT.icMax * 1000} mA, ${BJT.vceMax} V, hFE ${BJT.bf}`,
  }
}

export const bc547 = bjt('bc547', 'Transistor NPN (BC547)', 1, 'BC547')
export const bc557 = bjt('bc557', 'Transistor PNP (BC557)', -1, 'BC557')
