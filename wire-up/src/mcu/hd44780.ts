// A character LCD (HD44780 controller) on an I2C backpack (PCF8574 port expander), the "1602 I2C" module every kit has. The device
// sees the bytes a sketch sends over the bus and does what the chip does: the backpack maps bit 0 = RS, 1 = RW, 2 = E, 3 = backlight,
// 4..7 = D4..D7, the controller takes a nibble on every falling edge of E, starts in its power-up state (display blank, 8-bit
// interface) and gets into 4-bit mode by the datasheet's sequence. No DOM, nothing from the rest of the app.

/** A device on the I2C bus. */
export interface I2cDevice {
  /** The 7-bit address it answers to. */
  address: number
  /** A transmission addressed to it (the data bytes). Returns 0 when it answered every byte, 3 when it did not. */
  write(data: number[]): number
  /** `count` bytes for a master that reads. */
  read(count: number): number[]
  /** Lost its power: back to the state of a chip just switched on. */
  reset(): void
}

/** Everything a picture of the display needs. */
export interface LcdSnapshot {
  cols: number
  rows: number
  /** The code of the character in each visible cell (rows * cols, row by row): 0..7 are the custom characters. */
  chars: number[]
  /** The display is on (D bit of display control). */
  on: boolean
  /** The chip has never been set up: the first row shows the dark blocks of a freshly powered controller. */
  boxes: boolean
  backlight: boolean
  cursorOn: boolean
  blinkOn: boolean
  /** Visible cell of the cursor (the address counter), or null when it is outside the window or in the CGRAM. */
  cursor: { col: number; row: number } | null
  /** The 8 custom characters, 8 rows of 5 bits each. */
  cgram: number[][]
}

const ROW_BASE = [0x00, 0x40, 0x14, 0x54]

export class Hd44780Backpack implements I2cDevice {
  address: number
  readonly cols: number
  readonly rows: number
  private ddram = new Uint8Array(128).fill(0x20)
  private cgram = new Uint8Array(64)
  private ac = 0
  private cgMode = false
  private inc = true
  private shiftOnWrite = false
  private displayOn = false
  private cursorOn = false
  private blinkOn = false
  private shift = 0
  private bits4 = false
  private initialized = false
  private lcdBacklight = false
  private pending: number | null = null
  private lastEnable = 0
  private port = 0xff

  constructor(address = 0x27, cols = 16, rows = 2) {
    this.address = address
    this.cols = cols
    this.rows = rows
  }

  reset(): void {
    this.ddram.fill(0x20)
    this.cgram.fill(0)
    this.ac = 0
    this.cgMode = false
    this.inc = true
    this.shiftOnWrite = false
    this.displayOn = false
    this.cursorOn = false
    this.blinkOn = false
    this.shift = 0
    this.bits4 = false
    this.initialized = false
    this.lcdBacklight = false
    this.pending = null
    this.lastEnable = 0
    this.port = 0xff
  }

  write(data: number[]): number {
    for (const b of data) {
      const rs = b & 1
      const rw = b & 2
      const en = b & 4
      this.lcdBacklight = (b & 8) !== 0
      this.port = b
      // the controller latches what is on its pins when E falls (a read cycle, RW high, does not write anything)
      if (this.lastEnable && !en && !rw) this.latch(rs, b >> 4)
      this.lastEnable = en
    }
    return 0
  }

  read(count: number): number[] {
    return Array.from({ length: count }, () => this.port)
  }

  private latch(rs: number, nibble: number): void {
    if (!this.bits4) {
      // eight-bit interface: only D4..D7 are wired, so a "byte" is the high nibble alone
      if (rs === 0) {
        if (nibble === 0x3) this.initialized = true
        else if (nibble === 0x2) {
          this.bits4 = true
          this.pending = null
        }
      }
      return
    }
    if (this.pending === null) {
      this.pending = nibble
      return
    }
    const byte = (this.pending << 4) | nibble
    this.pending = null
    this.execute(rs, byte)
  }

  private wrap(addr: number, step: number): number {
    return (addr + step) & 0x7f
  }

  private execute(rs: number, v: number): void {
    if (rs) {
      if (this.cgMode) {
        this.cgram[this.ac & 0x3f] = v & 0x1f
        this.ac = (this.ac + (this.inc ? 1 : -1)) & 0x3f
      } else {
        this.ddram[this.ac & 0x7f] = v
        this.ac = this.wrap(this.ac, this.inc ? 1 : -1)
        if (this.shiftOnWrite) this.shift += this.inc ? 1 : -1
      }
      return
    }
    if (v & 0x80) {
      this.ac = v & 0x7f
      this.cgMode = false
    } else if (v & 0x40) {
      this.ac = v & 0x3f
      this.cgMode = true
    } else if (v & 0x20) {
      this.initialized = true
    } else if (v & 0x10) {
      const display = (v & 0x08) !== 0
      const right = (v & 0x04) !== 0
      if (display) this.shift += right ? -1 : 1
      else this.ac = this.wrap(this.ac, right ? 1 : -1)
    } else if (v & 0x08) {
      this.displayOn = (v & 0x04) !== 0
      this.cursorOn = (v & 0x02) !== 0
      this.blinkOn = (v & 0x01) !== 0
    } else if (v & 0x04) {
      this.inc = (v & 0x02) !== 0
      this.shiftOnWrite = (v & 0x01) !== 0
    } else if (v & 0x02) {
      this.ac = 0
      this.shift = 0
      this.cgMode = false
    } else if (v & 0x01) {
      this.ddram.fill(0x20)
      this.ac = 0
      this.inc = true
      this.shift = 0
      this.cgMode = false
    }
  }

  /** DDRAM address shown in cell (col, row) with the display shifted as it is now. */
  private addressOf(col: number, row: number): number {
    const lineLen = this.rows >= 4 ? 20 : 40
    const at = (((col + this.shift) % lineLen) + lineLen) % lineLen
    return (ROW_BASE[Math.min(row, 3)] + at) & 0x7f
  }

  snapshot(): LcdSnapshot {
    const chars: number[] = []
    let cursor: LcdSnapshot['cursor'] = null
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const addr = this.addressOf(c, r)
        chars.push(this.ddram[addr])
        if (!this.cgMode && addr === (this.ac & 0x7f)) cursor = { col: c, row: r }
      }
    }
    const cgram: number[][] = []
    for (let k = 0; k < 8; k++) cgram.push(Array.from(this.cgram.slice(k * 8, k * 8 + 8)))
    return {
      cols: this.cols,
      rows: this.rows,
      chars,
      on: this.displayOn,
      boxes: !this.initialized,
      backlight: this.lcdBacklight,
      cursorOn: this.cursorOn,
      blinkOn: this.blinkOn,
      cursor,
      cgram,
    }
  }

  /** The visible text, one string per row (custom characters as their codes 0..7 left as control characters). */
  text(): string[] {
    const s = this.snapshot()
    const out: string[] = []
    for (let r = 0; r < s.rows; r++) out.push(String.fromCharCode(...s.chars.slice(r * s.cols, (r + 1) * s.cols)))
    return out
  }
}
