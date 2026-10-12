import { COL, drawLabelAbove, drawText, rrect } from '../render/draw.ts'
import { drawSprite, PX, pxLegH, spriteInk } from '../render/pixel.ts'
import { scene } from '../render/scene.ts'
import { Hd44780Backpack, lcdFromLive } from '../mcu/hd44780.ts'
import type { LcdSnapshot } from '../mcu/hd44780.ts'
import { eng, LCD1602, LED_COLORS, LED_N, ledIs, MCU } from '../sim/models.ts'
import { LCD_BEZEL, LCD_H, LCD_PAD0, LCD_SCREEN, LCD_W, lcd1602Sprite } from './art.ts'
import { eid, num, stress } from './common.ts'
import { glyphRows } from './lcdfont.ts'
import type { PartDef } from './types.ts'

// ---------------------------------------------------------------- 1602 character LCD with an I2C backpack (16 x 2, blue)

// pin order = the printed order of the backpack: GND, VCC, SDA, SCL (they come out of the left edge, top to bottom)
const GND = 0
const VCC = 1
const SDA = 2
const SCL = 3

/** Where the four pins are, in grid units: two grid steps left of the board's edge, one step apart. */
const PIN_X = -2
const PIN_Y0 = 3

/** The names printed under the pads of the display header (pin 1 at the left). */
const HEADER_NAMES = ['VSS', 'VDD', 'V0', 'RS', 'RW', 'E', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'A', 'K']

/** Dots: 5 x 8 to a character, drawn 2 art pixels each on a pitch of 3; 16 art pixels from one character to the next. */
const CHAR_PITCH = 16
const ROW_PITCH = 28
const TEXT_X = 5
const TEXT_Y = 3

interface GlassLook {
  bg: string
  /** The dots that are not part of a character: a faint grid. */
  grid: string
  lit: string
}

const BACKLIT: GlassLook = { bg: '#5a50f0', grid: '#4f46da', lit: '#f6f8ff' }
const DARK: GlassLook = { bg: '#1b2262', grid: '#1f276b', lit: '#4a56b0' }

const glassCache = new Map<string, HTMLCanvasElement>()
const glyphCache = new Map<string, HTMLCanvasElement>()

/** The glass with no characters on it: the colour of the liquid crystal and, when the display is on, its grid of dots. */
function glassBitmap(look: GlassLook, grid: boolean): HTMLCanvasElement {
  const key = `${look.bg}${grid ? look.grid : ''}`
  let bmp = glassCache.get(key)
  if (!bmp) {
    bmp = document.createElement('canvas')
    bmp.width = LCD_SCREEN.w
    bmp.height = LCD_SCREEN.h
    const g = bmp.getContext('2d')!
    g.fillStyle = look.bg
    g.fillRect(0, 0, bmp.width, bmp.height)
    if (grid) {
      g.fillStyle = look.grid
      for (let row = 0; row < 2; row++) {
        for (let ch = 0; ch < 16; ch++) {
          for (let r = 0; r < 8; r++) for (let c = 0; c < 5; c++) g.fillRect(TEXT_X + ch * CHAR_PITCH + c * 3, TEXT_Y + row * ROW_PITCH + r * 3, 2, 2)
        }
      }
    }
    glassCache.set(key, bmp)
  }
  return bmp
}

/** One character cell as a bitmap of lit dots (15 x 24 art pixels). */
function glyphBitmap(rows: number[], color: string): HTMLCanvasElement {
  const key = `${rows.join(',')}${color}`
  let bmp = glyphCache.get(key)
  if (!bmp) {
    if (glyphCache.size > 600) glyphCache.clear()
    bmp = document.createElement('canvas')
    bmp.width = 15
    bmp.height = 24
    const g = bmp.getContext('2d')!
    g.fillStyle = color
    rows.forEach((bits, r) => {
      for (let c = 0; c < 5; c++) if ((bits >> (4 - c)) & 1) g.fillRect(c * 3, r * 3, 2, 2)
    })
    glyphCache.set(key, bmp)
  }
  return bmp
}

/** What the glass shows before the first solve (and in the gallery): a lit display with a greeting. */
function demoSnapshot(): LcdSnapshot {
  const row = (s: string): number[] => Array.from({ length: 16 }, (_, i) => (s[i] ?? ' ').charCodeAt(0))
  return {
    cols: 16,
    rows: 2,
    chars: [...row('Hello, Wire-Up!'), ...row('LCD 1602  I2C')],
    on: true,
    boxes: false,
    backlight: true,
    cursorOn: false,
    blinkOn: false,
    cursor: null,
    cgram: Array.from({ length: 8 }, () => new Array<number>(8).fill(0)),
  }
}

/** Draw the glass of the display: the crystal, its dots and the characters. `ox`, `oy` is the world position of art pixel (0, 0). */
function drawGlass(c: CanvasRenderingContext2D, s: LcdSnapshot, powered: boolean, time: number): void {
  const look = powered && s.backlight ? BACKLIT : DARK
  const smooth = c.imageSmoothingEnabled
  c.imageSmoothingEnabled = false
  c.drawImage(glassBitmap(look, powered && s.on), LCD_SCREEN.x * PX, LCD_SCREEN.y * PX, LCD_SCREEN.w * PX, LCD_SCREEN.h * PX)
  if (powered) {
    const cell = (index: number, rows: number[], color: string): void => {
      const col = index % s.cols
      const row = Math.floor(index / s.cols)
      const x = LCD_SCREEN.x + TEXT_X + col * CHAR_PITCH
      const y = LCD_SCREEN.y + TEXT_Y + row * ROW_PITCH
      c.drawImage(glyphBitmap(rows, color), x * PX, y * PX, 15 * PX, 24 * PX)
    }
    if (s.boxes) {
      // a controller nobody has set up shows dark blocks in the first row
      for (let i = 0; i < s.cols; i++) cell(i, [31, 31, 31, 31, 31, 31, 31, 31], look.lit)
    } else if (s.on) {
      s.chars.forEach((code, i) => {
        if (code === 0x20) return
        // 0..7 are the custom characters, and 8..15 the same ones again
        const rows = code < 16 ? s.cgram[code & 7] : glyphRows(code)
        cell(i, rows, look.lit)
      })
      if (s.cursor) {
        const i = s.cursor.row * s.cols + s.cursor.col
        // the underline is the eighth row; a blinking cursor is a block that comes and goes about once a second
        if (s.cursorOn) cell(i, [0, 0, 0, 0, 0, 0, 0, 31], look.lit)
        if (s.blinkOn && time % 1 < 0.5) cell(i, [31, 31, 31, 31, 31, 31, 31, 31], look.lit)
      }
    }
  }
  c.imageSmoothingEnabled = smooth
}

export const lcd1602i2c: PartDef = {
  type: 'lcd1602-i2c',
  name: 'LCD 1602 (I2C)',
  category: 'logic',
  blurb:
    'A 16 x 2 character LCD with an I2C backpack (PCF8574): four pins GND, VCC, SDA, SCL on the left, top to bottom. Give it 5 V and connect SDA and SCL to the Uno\'s A4 and A5 (the board also has them as SDA / SCL beside AREF). Use the library LiquidCrystal_I2C with the address set here (0x27, or 0x3F on some boards); call lcd.init() and lcd.backlight() - without them the screen stays dark or shows a row of blocks. It takes about 25 mA with the backlight on.',
  pinLabels: ['GND', 'VCC', 'SDA', 'SCL'],
  // the pins come out of the left edge: the label sits at the tip, past the end of the leg
  pinLabelPlace: 'lead',
  pinLeadDir: () => ({ x: -1, y: 0 }),
  tipPastPin: 2,
  tipPastPinVector: 0,
  // the address of the backpack, whether the backlight is on (from the sketch), and a flag the simulation uses to rebuild the circuit
  defaults: () => ({ addr: 0x27, bl: 1 }),
  runtimeKeys: ['bl'],
  pins: () => Array.from({ length: 4 }, (_, i) => ({ x: PIN_X, y: PIN_Y0 + i })),
  bounds: () => ({ x: PIN_X * 20 - 4, y: -4, w: LCD_W * PX + 8 - PIN_X * 20, h: LCD_H * PX + 8 }),
  i2c: {
    sda: SDA,
    scl: SCL,
    vcc: VCC,
    gnd: GND,
    create: (p) => new Hd44780Backpack(num(p, 'addr', 0x27), 16, 2),
  },
  build(p, ctx) {
    if (p.state.failed) return
    const vcc = ctx.pins[VCC]
    const gnd = ctx.pins[GND]
    // the controller and the expander: a couple of milliamps
    ctx.add({ kind: 'R', id: ctx.id('rl'), a: vcc, b: gnd, r: LCD1602.rLogic })
    // the backlight: an LED behind its own 100 ohm resistor, on while the expander's P3 is high
    if (num(p, 'bl', 1) > 0.5) {
      const mid = ctx.newNode()
      ctx.add({ kind: 'R', id: ctx.id('rb'), a: vcc, b: mid, r: LCD1602.rBacklight })
      ctx.add({ kind: 'D', id: ctx.id('bd'), a: mid, b: gnd, is: ledIs(LED_COLORS.blue.vf10), n: LED_N })
    }
    // the pull-ups of the backpack
    ctx.add({ kind: 'R', id: ctx.id('pu1'), a: vcc, b: ctx.pins[SDA], r: LCD1602.rPull })
    ctx.add({ kind: 'R', id: ctx.id('pu2'), a: vcc, b: ctx.pins[SCL], r: LCD1602.rPull })
    // a supply the wrong way round goes through the chips' protection diodes
    ctx.add({ kind: 'D', id: ctx.id('sub'), a: gnd, b: vcc, is: MCU.diodeIs, n: 1 })
  },
  evaluate(p, env) {
    const vs = env.v(env.pins[VCC]) - env.v(env.pins[GND])
    const i = Math.abs(env.cur(eid(p, 'rl'))?.i ?? 0) + Math.abs(env.cur(eid(p, 'rb'))?.i ?? 0)
    const sub = Math.abs(env.cur(eid(p, 'sub'))?.i ?? 0)
    const rV = Math.max(vs, 0) / LCD1602.vMax
    const rSub = sub / LCD1602.iSubMax
    return {
      live: { v: vs, i, up: vs >= LCD1602.vOn && !p.state.failed ? 1 : 0 },
      stress: stress(Math.max(rV, rSub), () =>
        rSub >= rV
          ? `The LCD module had its supply the wrong way round: ${eng(sub, 'A')} went through its chips (at most ${eng(LCD1602.iSubMax, 'A')}). VCC goes to +, GND to -.`
          : `The LCD module's supply was ${eng(vs, 'V')}; it is made for 5 V and takes at most ${LCD1602.vMax} V.`,
      ),
    }
  },
  draw(c, p, live, time) {
    if (scene.pixel) {
      // the four legs of the backpack, under the board; their tips are the pins
      for (let i = 0; i < 4; i++) pxLegH(c, (PIN_Y0 + i) * 20, PIN_X * 20, 8)
      const board = lcd1602Sprite()
      drawSprite(c, board, 0, 0)
      const powered = live.up === undefined ? true : live.up > 0.5
      const snap = live.up === undefined ? demoSnapshot() : lcdFromLive(live)
      drawGlass(c, snap, powered, time)
      // the names printed under the pads of the display header
      HEADER_NAMES.forEach((name, k) => drawText(c, name, (LCD_PAD0.x + 10 * k) * PX, (LCD_PAD0.y + 8) * PX, { size: 7, align: 'center', color: '#e6f3ea' }))
      drawText(c, '1', (LCD_PAD0.x - 9) * PX, (LCD_PAD0.y - 4) * PX, { size: 7, align: 'center', color: '#e6f3ea' })
      drawText(c, '16', (LCD_PAD0.x + 159) * PX, (LCD_PAD0.y - 4) * PX, { size: 7, align: 'center', color: '#e6f3ea' })
      drawText(c, 'I2C', (LCD_BEZEL.x + LCD_BEZEL.w - 22) * PX, (LCD_H - 17) * PX, { size: 8, align: 'center', color: '#e6f3ea' })
      if (scene.labeled.has(p.id)) drawLabelAbove(c, 'LCD 1602 (I2C)', (LCD_W * PX) / 2, spriteInk(board, 0, 0).top)
      return
    }
    for (let i = 0; i < 4; i++) {
      c.fillStyle = COL.metal
      c.fillRect(PIN_X * 20, (PIN_Y0 + i) * 20 - 2, 48, 4)
    }
    c.fillStyle = '#239b4b'
    rrect(c, 0, 0, LCD_W * PX, LCD_H * PX, 6)
    c.fill()
    c.fillStyle = '#17171c'
    c.fillRect(LCD_BEZEL.x * PX, LCD_BEZEL.y * PX, LCD_BEZEL.w * PX, LCD_BEZEL.h * PX)
    c.fillStyle = (live.bl ?? 1) > 0.5 && live.up !== 0 ? '#5a50f0' : '#1b2262'
    c.fillRect(LCD_SCREEN.x * PX, LCD_SCREEN.y * PX, LCD_SCREEN.w * PX, LCD_SCREEN.h * PX)
    if (scene.labeled.has(p.id)) drawLabelAbove(c, 'LCD 1602 (I2C)', (LCD_W * PX) / 2, 0)
  },
  fields: () => [
    {
      kind: 'select',
      key: 'addr',
      label: 'I2C address',
      options: [
        { value: 0x27, label: '0x27 (PCF8574T)' },
        { value: 0x3f, label: '0x3F (PCF8574AT)' },
      ],
    },
  ],
  summary: (p) => `I2C address 0x${num(p, 'addr', 0x27).toString(16).toUpperCase()}${p.state.failed ? ', burnt' : ''}`,
}
