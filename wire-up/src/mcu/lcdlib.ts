// The LiquidCrystal_I2C library (Frank de Brabander's, the one almost every tutorial uses), statement for statement: it drives an
// HD44780 character LCD through a PCF8574 expander in 4-bit mode, one I2C write per expander byte. Because it talks to the display
// through the same `Wire` path a sketch uses, the display model on the bus sees exactly the bytes the real library would send, and
// the time a sketch spends in each call (about 1.5 ms a character at 100 kHz, a full second in `init()`) comes out as on the board.
// No DOM, nothing from the rest of the app.

import { formatValue } from './vm.ts'

/** What the library needs from the machine it runs on. */
export interface LcdIo {
  /** `Wire.begin()` */
  wireBegin(): void
  /** One transaction: beginTransmission(addr); write(byte); endTransmission(). */
  expander(addr: number, byte: number): void
  delayMs(ms: number): void
  delayUs(us: number): void
}

export interface LcdObj {
  lib: 'LiquidCrystal_I2C'
  addr: number
  cols: number
  rows: number
  numLines: number
  backlight: number
  displayFunction: number
  displayControl: number
  displayMode: number
}

const LCD_CLEARDISPLAY = 0x01
const LCD_RETURNHOME = 0x02
const LCD_ENTRYMODESET = 0x04
const LCD_DISPLAYCONTROL = 0x08
const LCD_CURSORSHIFT = 0x10
const LCD_FUNCTIONSET = 0x20
const LCD_SETCGRAMADDR = 0x40
const LCD_SETDDRAMADDR = 0x80

const LCD_ENTRYLEFT = 0x02
const LCD_ENTRYSHIFTINCREMENT = 0x01
const LCD_DISPLAYON = 0x04
const LCD_CURSORON = 0x02
const LCD_BLINKON = 0x01
const LCD_DISPLAYMOVE = 0x08
const LCD_MOVERIGHT = 0x04
const LCD_4BITMODE = 0x00
const LCD_2LINE = 0x08
const LCD_1LINE = 0x00
const LCD_5x10DOTS = 0x04
const LCD_5x8DOTS = 0x00

const LCD_BACKLIGHT = 0x08
const EN = 0x04
const RS = 0x01

/** `LiquidCrystal_I2C lcd(address, columns, rows)`: the backlight starts off until `backlight()` is called, as in the library. */
export function newLcd(args: number[]): LcdObj {
  return {
    lib: 'LiquidCrystal_I2C',
    addr: (args[0] ?? 0x27) & 0x7f,
    cols: args[1] ?? 16,
    rows: args[2] ?? 2,
    numLines: args[2] ?? 2,
    backlight: 0,
    displayFunction: 0,
    displayControl: 0,
    displayMode: 0,
  }
}

function expanderWrite(io: LcdIo, o: LcdObj, data: number): void {
  io.expander(o.addr, (data | o.backlight) & 0xff)
}

function pulseEnable(io: LcdIo, o: LcdObj, data: number): void {
  expanderWrite(io, o, data | EN)
  io.delayUs(1)
  expanderWrite(io, o, data & ~EN)
  io.delayUs(50)
}

function write4bits(io: LcdIo, o: LcdObj, value: number): void {
  expanderWrite(io, o, value)
  pulseEnable(io, o, value)
}

function send(io: LcdIo, o: LcdObj, value: number, mode: number): void {
  const high = value & 0xf0
  const low = (value << 4) & 0xf0
  write4bits(io, o, high | mode)
  write4bits(io, o, low | mode)
}

function command(io: LcdIo, o: LcdObj, v: number): void {
  send(io, o, v, 0)
}

function put(io: LcdIo, o: LcdObj, v: number): void {
  send(io, o, v & 0xff, RS)
}

function begin(io: LcdIo, o: LcdObj, cols: number, lines: number, dot: number): void {
  if (lines > 1) o.displayFunction |= LCD_2LINE
  o.numLines = lines
  o.cols = cols
  // some one line displays can select a 10 pixel high font
  if (dot !== 0 && lines === 1) o.displayFunction |= LCD_5x10DOTS
  // the chip needs more than 40 ms after power-up; the library waits 50 ms and then a second more
  io.delayMs(50)
  expanderWrite(io, o, o.backlight)
  io.delayMs(1000)
  // the datasheet's way into 4-bit mode (figure 24)
  write4bits(io, o, 0x03 << 4)
  io.delayUs(4500)
  write4bits(io, o, 0x03 << 4)
  io.delayUs(4500)
  write4bits(io, o, 0x03 << 4)
  io.delayUs(150)
  write4bits(io, o, 0x02 << 4)
  command(io, o, LCD_FUNCTIONSET | o.displayFunction)
  o.displayControl = LCD_DISPLAYON
  command(io, o, LCD_DISPLAYCONTROL | o.displayControl)
  clear(io, o)
  o.displayMode = LCD_ENTRYLEFT
  command(io, o, LCD_ENTRYMODESET | o.displayMode)
  home(io, o)
}

function clear(io: LcdIo, o: LcdObj): void {
  command(io, o, LCD_CLEARDISPLAY)
  io.delayUs(2000)
}

function home(io: LcdIo, o: LcdObj): void {
  command(io, o, LCD_RETURNHOME)
  io.delayUs(2000)
}

function control(io: LcdIo, o: LcdObj, bit: number, on: boolean): void {
  if (on) o.displayControl |= bit
  else o.displayControl &= ~bit
  command(io, o, LCD_DISPLAYCONTROL | o.displayControl)
}

function mode(io: LcdIo, o: LcdObj, bit: number, on: boolean): void {
  if (on) o.displayMode |= bit
  else o.displayMode &= ~bit
  command(io, o, LCD_ENTRYMODESET | o.displayMode)
}

/**
 * One call of a method of the library. `a[0]` is the object, then the arguments; `ts` the static types of all of them (for the text
 * of `print`). Returns the value of the call (the number of characters for print and write, 0 otherwise).
 */
export function lcdCall(io: LcdIo, o: LcdObj, name: string, a: unknown[], ts: string[]): number {
  const num = (i: number): number => a[i] as number
  const text = (s: string): number => {
    for (let i = 0; i < s.length; i++) put(io, o, s.charCodeAt(i))
    return s.length
  }
  switch (name) {
    case 'init':
      io.wireBegin()
      o.displayFunction = LCD_4BITMODE | LCD_1LINE | LCD_5x8DOTS
      begin(io, o, o.cols, o.rows, 0)
      return 0
    case 'begin':
      // begin(cols, rows[, dotsize]) of the library, or the bare begin() of the forks that replace init()
      if (a.length === 1) {
        io.wireBegin()
        o.displayFunction = LCD_4BITMODE | LCD_1LINE | LCD_5x8DOTS
        begin(io, o, o.cols, o.rows, 0)
      } else {
        io.wireBegin()
        o.displayFunction = LCD_4BITMODE | LCD_1LINE | LCD_5x8DOTS
        begin(io, o, num(1), num(2), a.length > 3 ? num(3) : 0)
      }
      return 0
    case 'clear':
      clear(io, o)
      return 0
    case 'home':
      home(io, o)
      return 0
    case 'noDisplay':
      control(io, o, LCD_DISPLAYON, false)
      return 0
    case 'display':
      control(io, o, LCD_DISPLAYON, true)
      return 0
    case 'noBlink':
      control(io, o, LCD_BLINKON, false)
      return 0
    case 'blink':
      control(io, o, LCD_BLINKON, true)
      return 0
    case 'noCursor':
      control(io, o, LCD_CURSORON, false)
      return 0
    case 'cursor':
      control(io, o, LCD_CURSORON, true)
      return 0
    case 'scrollDisplayLeft':
      command(io, o, LCD_CURSORSHIFT | LCD_DISPLAYMOVE)
      return 0
    case 'scrollDisplayRight':
      command(io, o, LCD_CURSORSHIFT | LCD_DISPLAYMOVE | LCD_MOVERIGHT)
      return 0
    case 'leftToRight':
      mode(io, o, LCD_ENTRYLEFT, true)
      return 0
    case 'rightToLeft':
      mode(io, o, LCD_ENTRYLEFT, false)
      return 0
    case 'autoscroll':
      mode(io, o, LCD_ENTRYSHIFTINCREMENT, true)
      return 0
    case 'noAutoscroll':
      mode(io, o, LCD_ENTRYSHIFTINCREMENT, false)
      return 0
    case 'backlight':
      o.backlight = LCD_BACKLIGHT
      expanderWrite(io, o, 0)
      return 0
    case 'noBacklight':
      o.backlight = 0
      expanderWrite(io, o, 0)
      return 0
    case 'setBacklight':
      o.backlight = num(1) ? LCD_BACKLIGHT : 0
      expanderWrite(io, o, 0)
      return 0
    case 'setCursor': {
      const offsets = [0x00, 0x40, 0x14, 0x54]
      let row = num(2)
      if (row >= o.numLines) row = o.numLines - 1
      if (row < 0) row = 0
      command(io, o, LCD_SETDDRAMADDR | ((num(1) + offsets[Math.min(row, 3)]) & 0x7f))
      return 0
    }
    case 'createChar': {
      const map = a[2] as number[]
      command(io, o, LCD_SETCGRAMADDR | ((num(1) & 0x7) << 3))
      for (let i = 0; i < 8; i++) put(io, o, (map[i] ?? 0) & 0xff)
      return 0
    }
    case 'write':
      put(io, o, num(1))
      return 1
    case 'print':
      return text(formatValue(a[1], ts[1] ?? 'int', a.length > 2 ? num(2) : undefined))
    case 'println': {
      const n = a.length > 1 ? text(formatValue(a[1], ts[1] ?? 'int', a.length > 2 ? num(2) : undefined)) : 0
      return n + text('\r\n')
    }
    default:
      return 0
  }
}
