// The machine that runs a compiled sketch in virtual time. Every operation costs the cycles an AVR at 16 MHz would spend on it, so a
// loop that does not wait still takes real (virtual) time and `millis()` agrees with it; `delay()` puts the sketch to sleep until
// its wake time. The caller advances the machine to a target time each frame and the machine reports pin and Serial activity
// through a host. No DOM, nothing from the rest of the app.

import { OP } from './compile.ts'
import type { FnInfo, Op, Program, Type } from './compile.ts'

/** What the sketch can do to the world. `t` is the machine's own time in seconds since reset. */
export interface McuHost {
  pinMode(pin: number, mode: number, t: number): void
  digitalWrite(pin: number, value: number, t: number): void
  digitalRead(pin: number, t: number): number
  /** `pin` is the Arduino pin number 14..19 (A0..A5); the result is 0..1023. */
  analogRead(pin: number, t: number): number
  analogWrite(pin: number, value: number, t: number): void
  serialWrite(text: string, t: number): void
  /** `tone()`: a 50 % square wave of `freq` Hz on the pin until `noTone` (the machine calls it again when a duration runs out). */
  tone(pin: number, freq: number, t: number): void
  noTone(pin: number, t: number): void
}

const CYCLE = 1 / 16e6
/** Cycles one digitalWrite / digitalRead inside shiftOut and shiftIn costs, loop overhead included. */
const SHIFT_CYCLES = 90
/** Bytes of EEPROM on the ATmega328P; erased cells read 0xFF. */
export const EEPROM_SIZE = 1024
/** A write to the EEPROM takes this long, and the next one waits for it. */
const EEPROM_WRITE = 0.0033
/** How often `pulseIn` looks at the pin while it waits. */
const PULSE_POLL = 20e-6
const MAX_FRAMES = 40
/** Operations one `advance` may run: a sketch that spins faster than this is slowed, not allowed to freeze the page. */
const MAX_OPS = 400_000

/** Cycles of the built-in calls on a real Uno (measured figures for the Arduino core). */
const BUILTIN_CYCLES: Record<string, number> = {
  pinMode: 90,
  digitalWrite: 80, // 5 us, as measured on a real Uno
  digitalRead: 72,
  analogRead: 1800, // 13 ADC clocks at 125 kHz
  analogWrite: 110,
  millis: 30,
  micros: 30,
  random: 200,
  tone: 120,
  noTone: 80,
  pulseIn: 60,
  randomSeed: 40,
  map: 120,
  sqrt: 300,
  pow: 900,
  sin: 700,
  cos: 700,
  tan: 800,
  exp: 800,
  log: 800,
}

export function wrapType(t: string, v: number): number {
  switch (t) {
    case 'int':
      return (v << 16) >> 16
    case 'uint':
      return v & 0xffff
    case 'long':
      return v | 0
    case 'ulong':
      return v >>> 0
    case 'byte':
      return v & 0xff
    case 'char':
      return (v << 24) >> 24
    case 'bool':
      return v ? 1 : 0
    default:
      return v
  }
}

/**
 * Arduino's `Print::printFloat`: on the AVR a double is a 32-bit float, the number is rounded by adding half of the last digit, and
 * the digits come out one at a time. Not `toFixed`, which rounds differently in the last place.
 */
function printFloat(value: number, digits: number): string {
  if (Number.isNaN(value)) return 'nan'
  if (!Number.isFinite(value)) return 'inf'
  let n = Math.fround(value)
  if (n > 4294967040 || n < -4294967040) return 'ovf'
  let out = ''
  if (n < 0) {
    out = '-'
    n = -n
  }
  let rounding = 0.5
  for (let i = 0; i < digits; i++) rounding = Math.fround(rounding / 10)
  n = Math.fround(n + rounding)
  const whole = Math.floor(n)
  let rest = Math.fround(n - whole)
  out += String(whole)
  if (digits > 0) out += '.'
  for (let i = 0; i < digits; i++) {
    rest = Math.fround(rest * 10)
    const d = Math.floor(rest)
    out += String(d)
    rest = Math.fround(rest - d)
  }
  return out
}

/**
 * The text Serial.print and String() make of a value of the given static type. `arg` is the second argument of print: the number
 * of decimals for a float, the base (2, 8, 10, 16) for an integer. With a base the number is printed as a number even for a char,
 * and a negative int comes out as the 32-bit pattern, as the Arduino core does (print(-1, HEX) is FFFFFFFF).
 */
export function formatValue(v: unknown, t: string, arg?: number): string {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map((c) => String.fromCharCode(c as number)).join('').replace(/\0.*$/, '')
  const n = v as number
  if (t === 'float') return printFloat(n, arg === undefined ? 2 : Math.min(Math.max(Math.trunc(arg), 0), 10))
  if (arg === undefined && t === 'char') return String.fromCharCode(n & 0xff)
  if (arg !== undefined && arg !== 10 && (arg === 2 || arg === 8 || arg === 16)) {
    const u = t === 'byte' ? n & 0xff : t === 'uint' ? n & 0xffff : n >>> 0
    return u.toString(arg).toUpperCase()
  }
  return String(Math.trunc(n))
}

interface Frame {
  fn: FnInfo
  pc: number
  locals: unknown[]
  st: unknown[]
  /** An interrupt handler running on top of the sketch: its return does not push a value. */
  isr?: boolean
}

/** Interrupt modes as the AVR core numbers them (RISING is 3). */
const IRQ_LOW = 0
const IRQ_CHANGE = 1
const IRQ_FALLING = 2

/** What one VM operation costs on the AVR (loads and stores move two bytes, a jump takes a few cycles, ...). */
const OP_CYCLES: number[] = []
OP_CYCLES[OP.PUSH] = 2
OP_CYCLES[OP.LGET] = 4
OP_CYCLES[OP.LSET] = 4
OP_CYCLES[OP.GGET] = 6
OP_CYCLES[OP.GSET] = 6
OP_CYCLES[OP.AGET] = 10
OP_CYCLES[OP.ASET] = 10
OP_CYCLES[OP.POP] = 1
OP_CYCLES[OP.ARITH] = 4
OP_CYCLES[OP.CMP] = 6
OP_CYCLES[OP.NEG] = 4
OP_CYCLES[OP.NOT] = 4
OP_CYCLES[OP.BNOT] = 4
OP_CYCLES[OP.CAST] = 3
OP_CYCLES[OP.JMP] = 3
OP_CYCLES[OP.JZ] = 5
OP_CYCLES[OP.JNZ] = 5
OP_CYCLES[OP.JZK] = 5
OP_CYCLES[OP.JNZK] = 5
OP_CYCLES[OP.DUP] = 2
OP_CYCLES[OP.BOOL] = 4

export class Machine {
  /** Virtual seconds since the last reset. */
  time = 0
  /** The runtime error that stopped the sketch, with its line, or null. */
  error: string | null = null
  /** Set when the last `advance` had to skip time because the sketch ran more operations than one frame allows. */
  slow = false
  private prog: Program
  private host: McuHost
  private globals: unknown[]
  private frames: Frame[] = []
  private phase: 'init' | 'setup' | 'loop' = 'init'
  private wake = -1
  private input: number[] = []
  private begun = false
  private baud = 9600
  private serialBusyUntil = 0
  private seed = 1
  private rxAt = -1
  /** Running `tone(pin, f, ms)` calls: pin -> machine time the tone stops. */
  private tones = new Map<number, number>()
  /** A `pulseIn` that is still waiting for its pulse. */
  private pulse: { phase: 0 | 1 | 2; started: number; begin: number } | null = null
  private eepromReady = 0
  /** Pins the sketch has made outputs (an input pin is read from the circuit, an output one changes only by the sketch's own writes). */
  private outputs = new Set<number>()
  /** attachInterrupt handlers for interrupt 0 (pin 2) and 1 (pin 3): the function, the mode, and the last level seen. */
  private irq: ({ fn: number; mode: number; last: number } | null)[] = [null, null]
  /** Bit n set = interrupt n has fired and its handler has not run yet. */
  private irqPending = 0
  private irqEnabled = true
  private inIsr = false
  /** After a handler returns the sketch runs one operation before the next interrupt, as the chip guarantees. */
  private irqHold = false
  /** While a handler runs over a sleeping `delay`, the time that sleep ends. */
  private resumeWake: number | null = null
  /** The EEPROM contents; the caller keeps them between runs. `eepromDirty` is set by a write that changed a byte. */
  readonly eeprom: Uint8Array
  eepromDirty = false

  constructor(prog: Program, host: McuHost, eeprom?: Uint8Array) {
    this.prog = prog
    this.host = host
    this.eeprom = eeprom ?? new Uint8Array(EEPROM_SIZE).fill(0xff)
    this.globals = new Array<unknown>(prog.nGlobals).fill(0)
    this.enter(prog.init, [])
  }

  /** Text for the sketch's Serial.read() and friends. */
  serialIn(text: string): void {
    for (const ch of text) this.input.push(ch.charCodeAt(0) & 0xff)
    this.rxAt = this.time
  }

  /** Virtual time of the last byte received (for the RX lamp). */
  get lastRx(): number {
    return this.rxAt
  }

  get running(): boolean {
    return this.error === null
  }

  private enter(fnIndex: number, args: unknown[]): void {
    const fn = this.prog.fns[fnIndex]
    const locals = new Array<unknown>(Math.max(fn.nLocals, args.length)).fill(0)
    for (let i = 0; i < args.length; i++) locals[i] = args[i]
    this.frames.push({ fn, pc: 0, locals, st: [] })
  }

  private fail(msg: string, line: number): void {
    this.error = `line ${line}: ${msg}`
  }

  /** Stop the tones whose time has run out. */
  private expireTones(): void {
    for (const [pin, end] of this.tones) {
      if (end <= this.time) {
        this.tones.delete(pin)
        this.host.noTone(pin, end)
      }
    }
  }

  private nextToneEnd(): number {
    let at = Infinity
    for (const end of this.tones.values()) at = Math.min(at, end)
    return at
  }

  /** Run until virtual time `until` (seconds since reset), the sketch's own sleeps respected. */
  advance(until: number): void {
    this.slow = false
    if (this.error !== null) {
      this.time = until
      return
    }
    let budget = MAX_OPS
    this.sampleIrq()
    while (this.time < until && this.error === null) {
      // a tone with a duration ends on time even while the sketch sleeps
      const lim = Math.min(until, this.nextToneEnd())
      if (this.wake > this.time) {
        if (this.irqPending !== 0 && this.irqEnabled && !this.inIsr) {
          this.irqHold = false
          // an interrupt during delay(): the handler runs, then the sleep goes on
          this.resumeWake = this.wake
          this.wake = -1
          budget -= this.exec(lim, budget)
          if (budget <= 0) {
            this.slow = true
            this.time = until
            return
          }
          continue
        }
        if (this.wake >= lim) {
          this.time = lim
          this.expireTones()
          continue
        }
        this.time = this.wake
      }
      budget -= this.exec(lim, budget)
      this.expireTones()
      if (budget <= 0) {
        // the sketch spins faster than a frame allows: let it fall behind rather than hang
        this.slow = true
        this.time = until
        return
      }
    }
    if (this.error !== null) this.time = until
  }

  /** Execute operations until time is up, the sketch sleeps, or it stops. Returns how many ran. */
  private exec(until: number, budget: number): number {
    let f = this.frames[this.frames.length - 1]
    let code: Op[] = f.fn.code
    let st = f.st
    let loc = f.locals
    let pc = f.pc
    let t = this.time
    let n = 0
    const g = this.globals
    for (;;) {
      if (t >= until || n >= budget) break
      if (this.irqPending !== 0 && this.irqEnabled && !this.inIsr && !this.irqHold) {
        // between two operations, as on the chip: lowest interrupt number first
        const k = this.irqPending & 1 ? 0 : 1
        this.irqPending &= ~(1 << k)
        f.pc = pc
        f.st = st
        this.enter(this.irq[k]!.fn, [])
        f = this.frames[this.frames.length - 1]
        f.isr = true
        this.inIsr = true
        code = f.fn.code
        st = f.st
        loc = f.locals
        pc = 0
        t += 40 * CYCLE
        continue
      }
      const op = code[pc++]
      n++
      this.irqHold = false
      let cycles = OP_CYCLES[op.o] ?? 3
      switch (op.o) {
        case OP.PUSH:
          st.push(op.a)
          break
        case OP.LGET:
          st.push(loc[op.a as number])
          break
        case OP.LSET: {
          const v = op.b === 'String' || op.b === 'float' ? (st.pop() as number) : wrapType(op.b as string, st.pop() as number)
          loc[op.a as number] = v
          if (op.k) st.push(v)
          break
        }
        case OP.GGET:
          st.push(g[op.a as number])
          break
        case OP.GSET: {
          const v = op.b === 'String' || op.b === 'float' ? (st.pop() as number) : wrapType(op.b as string, st.pop() as number)
          g[op.a as number] = v
          if (op.k) st.push(v)
          break
        }
        case OP.AGET: {
          const i = st.pop() as number
          const arr = st.pop() as unknown[]
          if (!Array.isArray(arr) || i < 0 || i >= arr.length) {
            this.fail(`array index ${i} is out of range (0 to ${Array.isArray(arr) ? arr.length - 1 : 0})`, op.l)
            this.time = t
            return n
          }
          st.push(arr[i])
          cycles = 6
          break
        }
        case OP.ASET: {
          const v = st.pop() as number
          const i = st.pop() as number
          const arr = st.pop() as unknown[]
          if (!Array.isArray(arr) || i < 0 || i >= arr.length) {
            this.fail(`array index ${i} is out of range (0 to ${Array.isArray(arr) ? arr.length - 1 : 0})`, op.l)
            this.time = t
            return n
          }
          const w = op.a === 'String' || op.a === 'float' ? v : wrapType(op.a as string, v)
          arr[i] = w
          if (op.k) st.push(w)
          cycles = 6
          break
        }
        case OP.POP:
          st.pop()
          break
        case OP.ARITH: {
          const y = st.pop() as number
          const x = st.pop() as number
          const ty = op.b as string
          let r: number
          const o = op.a as string
          const wide = ty === 'long' || ty === 'ulong'
          if (ty === 'float') {
            cycles = o === '/' ? 300 : o === '*' ? 100 : 80
            switch (o) {
              case '+':
                r = x + y
                break
              case '-':
                r = x - y
                break
              case '*':
                r = x * y
                break
              default:
                r = x / y
                break
            }
          } else {
            if (wide) cycles = 8
            switch (o) {
              case '+':
                r = x + y
                break
              case '-':
                r = x - y
                break
              case '*':
                r = Math.imul(x, y)
                cycles = wide ? 60 : 14
                break
              case '/':
                if (y === 0) {
                  r = 0
                  this.fail('division by zero', op.l)
                  this.time = t
                  return n
                }
                r = Math.trunc(x / y)
                cycles = ty === 'int' || ty === 'uint' ? 200 : 600
                break
              case '%':
                if (y === 0) {
                  r = 0
                  this.fail('division by zero (remainder)', op.l)
                  this.time = t
                  return n
                }
                r = x % y
                cycles = ty === 'int' || ty === 'uint' ? 200 : 600
                break
              case '<<':
                r = y >= 32 ? 0 : x << y
                cycles = (wide ? 12 : 8) + (wide ? 8 : 4) * Math.min(Math.max(y, 0), 32)
                break
              case '>>':
                r = ty === 'ulong' || ty === 'uint' ? (y >= 32 ? 0 : x >>> y) : x >> Math.min(y, 31)
                cycles = (wide ? 12 : 8) + (wide ? 8 : 4) * Math.min(Math.max(y, 0), 32)
                break
              case '&':
                r = x & y
                break
              case '|':
                r = x | y
                break
              default:
                r = x ^ y
                break
            }
            r = wrapType(ty, r)
          }
          st.push(r)
          break
        }
        case OP.CMP: {
          const y = st.pop() as number | string
          const x = st.pop() as number | string
          let r: boolean
          switch (op.a) {
            case '==':
              r = x === y
              break
            case '!=':
              r = x !== y
              break
            case '<':
              r = x < y
              break
            case '<=':
              r = x <= y
              break
            case '>':
              r = x > y
              break
            default:
              r = x >= y
              break
          }
          st.push(r ? 1 : 0)
          break
        }
        case OP.NEG:
          st.push(op.a === 'float' ? -(st.pop() as number) : wrapType(op.a as string, -(st.pop() as number)))
          break
        case OP.NOT:
          st.push(st.pop() ? 0 : 1)
          break
        case OP.BNOT:
          st.push(wrapType(op.a as string, ~(st.pop() as number)))
          break
        case OP.CAST: {
          const v = st.pop() as number
          st.push(op.a === 'float' ? v : wrapType(op.a as string, op.a === 'bool' ? v : Math.trunc(v)))
          break
        }
        case OP.JMP:
          pc = op.a as number
          break
        case OP.JZ:
          if (!st.pop()) pc = op.a as number
          break
        case OP.JNZ:
          if (st.pop()) pc = op.a as number
          break
        case OP.JZK:
          if (!st[st.length - 1]) pc = op.a as number
          else st.pop()
          break
        case OP.JNZK:
          if (st[st.length - 1]) pc = op.a as number
          else st.pop()
          break
        case OP.DUP:
          st.push(st[st.length - 1])
          break
        case OP.BOOL:
          st.push(st.pop() ? 1 : 0)
          break
        case OP.NEWARR: {
          const fill = op.b === 'String' ? '' : 0
          // a third operand makes an array of arrays (the rows of a 2-D array, the structs of an array of structs)
          const cols = op.c ?? 0
          st.push(cols > 0 ? Array.from({ length: op.a as number }, () => new Array<number | string>(cols).fill(fill)) : new Array<number | string>(op.a as number).fill(fill))
          cycles = 20
          break
        }
        case OP.COPY:
          st.push((st.pop() as unknown[]).slice())
          cycles = 30
          break
        case OP.CONCAT: {
          const y = st.pop()
          const x = st.pop()
          st.push(formatValue(x, op.a as string) + formatValue(y, op.b as string))
          cycles = 60
          break
        }
        case OP.CALL: {
          const argc = op.b as number
          if (this.frames.length >= MAX_FRAMES) {
            this.fail('the stack overflowed (a function calls itself too deeply)', op.l)
            this.time = t
            return n
          }
          const args = argc > 0 ? st.splice(st.length - argc, argc) : []
          f.pc = pc
          this.enter(op.a as number, args)
          f = this.frames[this.frames.length - 1]
          code = f.fn.code
          st = f.st
          loc = f.locals
          pc = 0
          cycles = 20
          break
        }
        case OP.RET: {
          if (f.isr) {
            // an interrupt handler is done: back to the sketch, which sees nothing of it
            this.frames.pop()
            this.inIsr = false
            this.irqHold = true
            const h = this.irq.findIndex((x) => x !== null && x.fn === this.prog.fns.indexOf(f.fn))
            if (h >= 0 && this.irq[h]!.mode === IRQ_LOW && this.irq[h]!.last === 0) this.irqPending |= 1 << h
            t += 40 * CYCLE
            if (this.resumeWake !== null) {
              this.wake = this.resumeWake
              this.resumeWake = null
              this.time = t
              return n
            }
            f = this.frames[this.frames.length - 1]
            code = f.fn.code
            st = f.st
            loc = f.locals
            pc = f.pc
            continue
          }
          let v = st.pop() as number
          if (op.a !== 'void' && op.a !== 'String') v = op.a === 'float' ? v : wrapType(op.a as string, v)
          this.frames.pop()
          cycles = 15
          if (this.frames.length === 0) {
            // init, setup or loop finished: go on to the next phase (loop runs forever)
            if (this.phase === 'init') {
              this.phase = 'setup'
              this.enter(this.prog.setup, [])
            } else {
              this.phase = 'loop'
              this.enter(this.prog.loop, [])
              cycles += 15 // the core's main loop: loop(), serialEventRun(), again
            }
          } else this.frames[this.frames.length - 1].st.push(v)
          f = this.frames[this.frames.length - 1]
          code = f.fn.code
          st = f.st
          loc = f.locals
          pc = f.pc
          break
        }
        case OP.CALLB: {
          const argc = op.b as number
          if (op.a === 'pulseIn' || op.a === 'pulseInLong') {
            // blocks across frames: while the pulse has not come the op runs again after a short sleep
            const base = st.length - argc
            const r = this.pulseStep(st[base] as number, st[base + 1] as number, argc > 2 ? (st[base + 2] as number) : 1e6, t)
            if (r === null) {
              this.wake = t + PULSE_POLL
              f.pc = pc - 1
              t += 60 * CYCLE
              this.time = t
              return n
            }
            st.length = base
            st.push(r)
            cycles = 60
            break
          }
          const args = argc > 0 ? st.splice(st.length - argc, argc) : []
          this.time = t
          f.pc = pc
          const r = this.builtin(op.a as string, args, op.ts ?? [], op.l)
          cycles = BUILTIN_CYCLES[op.a as string] ?? 30
          st.push(r)
          t = this.time
          if (this.error !== null) return n
          if (this.wake > t) {
            // delay(): the sketch sleeps; the caller handles the time
            t += cycles * CYCLE
            this.time = t
            f.pc = pc
            f.st = st
            return n
          }
          break
        }
        case OP.CALLM: {
          const argc = op.b as number
          const args = argc > 0 ? st.splice(st.length - argc, argc) : []
          const s = st.pop() as string
          st.push(this.stringMethod(op.a as string, s, args))
          cycles = 80
          break
        }
        default:
          this.fail(`bad instruction ${op.o}`, op.l)
          this.time = t
          return n
      }
      t += cycles * CYCLE
    }
    f.pc = pc
    this.time = t
    return n
  }

  private stringMethod(name: string, s: string, a: unknown[]): number | string {
    switch (name) {
      case 'length':
        return s.length
      case 'charAt':
        return (s.charCodeAt(a[0] as number) || 0) & 0xff
      case 'toInt': {
        const m = /^\s*[-+]?\d+/.exec(s)
        return m ? wrapType('long', parseInt(m[0], 10)) : 0
      }
      case 'toFloat': {
        const v = parseFloat(s)
        return Number.isNaN(v) ? 0 : v
      }
      case 'indexOf':
        return s.indexOf(typeof a[0] === 'number' ? String.fromCharCode(a[0]) : String(a[0]))
      case 'substring':
        return s.substring(a[0] as number, a[1] as number | undefined)
      case 'toUpperCase':
        return s.toUpperCase()
      case 'toLowerCase':
        return s.toLowerCase()
      default:
        return s === String(a[0]) ? 1 : 0
    }
  }

  /** One look at the pin for `pulseIn`: the microseconds of the pulse once it has come, or null while the sketch has to keep waiting. */
  private pulseStep(pin: number, level: number, timeoutUs: number, t: number): number | null {
    const p = (this.pulse ??= { phase: 0, started: t, begin: t })
    const done = (v: number): number => {
      this.pulse = null
      return v
    }
    if (t - p.started > timeoutUs / 1e6) return done(0)
    const now = this.host.digitalRead(pin, t) ? 1 : 0
    const want = level ? 1 : 0
    if (p.phase === 0) {
      // a pulse already in progress does not count: wait for it to end
      if (now !== want) p.phase = 1
    }
    if (p.phase === 1 && now === want) {
      p.phase = 2
      p.begin = t
      return null
    }
    if (p.phase === 2 && now !== want) return done(Math.round((t - p.begin) * 1e6))
    return null
  }

  private eepromAddr(a: number): number {
    return a & (EEPROM_SIZE - 1)
  }

  /** `update` leaves a cell alone when it already holds the value; `write` burns it every time, as the real one does. */
  private eepromWrite(addr: number, v: number, onlyIfChanged: boolean): void {
    const i = this.eepromAddr(addr)
    const b = v & 0xff
    if (onlyIfChanged && this.eeprom[i] === b) return
    // each write keeps the next one waiting while the cell burns in
    if (this.time < this.eepromReady) this.time = this.eepromReady
    this.eepromReady = this.time + EEPROM_WRITE
    if (this.eeprom[i] !== b) this.eepromDirty = true
    this.eeprom[i] = b
  }

  private eepromBytes(type: string): number {
    return type === 'int' || type === 'uint' ? 2 : type === 'long' || type === 'ulong' || type === 'float' ? 4 : 1
  }

  private serialOut(text: string, t: number): void {
    if (!this.begun) return
    this.host.serialWrite(text, t)
    const charTime = 10 / this.baud
    // putting a byte in the transmit buffer takes the sketch about 60 cycles each
    this.time += text.length * 60 * CYCLE
    this.serialBusyUntil = Math.max(this.serialBusyUntil, t) + text.length * charTime
    // the 64-byte transmit buffer: past it, the sketch has to wait for the line to drain
    const over = this.serialBusyUntil - t - 64 * charTime
    if (over > 0 && !this.inIsr) this.wake = Math.max(this.wake, t + over)
  }

  /** The level an input pin has now, or the last one the sketch wrote to an output pin. */
  private pinLevel(pin: number): number {
    return this.host.digitalRead(pin, this.time) ? 1 : 0
  }

  /** A new level on interrupt pin `n` (0 = pin 2, 1 = pin 3): does it fire this interrupt? */
  private irqEdge(n: number, level: number): void {
    const h = this.irq[n]
    if (!h) return
    const prev = h.last
    h.last = level
    const fire = h.mode === IRQ_LOW ? level === 0 : h.mode === IRQ_CHANGE ? level !== prev : h.mode === IRQ_FALLING ? prev === 1 && level === 0 : prev === 0 && level === 1
    if (fire) this.irqPending |= 1 << n
  }

  /**
   * The circuit only changes between frames, so an interrupt pin driven from outside is looked at once at the start of each
   * frame: an edge in it fires the interrupt (two edges inside one frame are seen as the net change). A pin the sketch itself drives
   * raises its interrupt at the moment of the write instead.
   */
  private sampleIrq(): void {
    for (let n = 0; n < 2; n++) {
      if (!this.irq[n] || this.outputs.has(n + 2)) continue
      this.irqEdge(n, this.pinLevel(n + 2))
    }
  }

  private builtin(name: string, a: unknown[], ts: string[], line: number): number | string {
    const t = this.time
    const num = (i: number): number => a[i] as number
    switch (name) {
      case 'pinMode':
        if (num(1) === 1) this.outputs.add(num(0))
        else this.outputs.delete(num(0))
        this.host.pinMode(num(0), num(1), t)
        return 0
      case 'digitalWrite':
        this.host.digitalWrite(num(0), num(1) ? 1 : 0, t)
        // a sketch driving its own interrupt pin raises the interrupt, as on the chip
        if ((num(0) === 2 || num(0) === 3) && this.outputs.has(num(0))) this.irqEdge(num(0) - 2, num(1) ? 1 : 0)
        return 0
      case 'digitalRead':
        return this.host.digitalRead(num(0), t) ? 1 : 0
      case 'analogRead': {
        const p = num(0) >= 14 ? num(0) : num(0) + 14
        return this.host.analogRead(p, t)
      }
      case 'analogWrite':
        this.host.analogWrite(num(0), Math.min(Math.max(num(1), 0), 255), t)
        return 0
      case 'analogReference':
        return 0
      case 'attachInterrupt': {
        // [interrupt number, handler function index, mode]
        const n = num(0)
        if (n !== 0 && n !== 1) {
          this.fail(`interrupt ${n} does not exist on the Uno: use pin 2 (interrupt 0) or pin 3 (interrupt 1)`, line)
          return 0
        }
        this.irq[n] = { fn: num(1), mode: num(2), last: this.pinLevel(n + 2) }
        if (num(2) === IRQ_LOW && this.irq[n]!.last === 0) this.irqPending |= 1 << n
        return 0
      }
      case 'detachInterrupt':
        if (num(0) === 0 || num(0) === 1) {
          this.irq[num(0)] = null
          this.irqPending &= ~(1 << num(0))
        }
        return 0
      case 'digitalPinToInterrupt':
        return num(0) === 2 ? 0 : num(0) === 3 ? 1 : -1
      case 'interrupts':
        this.irqEnabled = true
        return 0
      case 'noInterrupts':
        this.irqEnabled = false
        return 0
      case 'delay':
        if (this.inIsr) {
          this.fail('delay() inside an interrupt handler would hang the chip: millis() does not advance while a handler runs', line)
          return 0
        }
        this.wake = t + Math.max(num(0), 0) / 1000
        return 0
      case 'delayMicroseconds':
        // inside a handler the sketch cannot sleep: the time simply passes
        if (this.inIsr) this.time = t + Math.max(num(0), 0) / 1e6
        else if (num(0) >= 3) this.wake = t + num(0) / 1e6
        return 0
      case 'millis':
        return Math.floor(t * 1000) >>> 0
      case 'micros':
        return Math.floor(t * 1e6) >>> 0
      case 'random': {
        // xorshift: a fair stand-in for the Arduino's long-period generator
        let x = this.seed >>> 0 || 1
        x ^= x << 13
        x ^= x >>> 17
        x ^= x << 5
        this.seed = x >>> 0
        const r = this.seed >>> 1
        if (a.length === 1) return num(0) > 0 ? r % num(0) : 0
        const lo = num(0)
        const hi = num(1)
        return hi > lo ? lo + (r % (hi - lo)) : lo
      }
      case 'randomSeed':
        this.seed = (num(0) | 0) || 1
        return 0
      case 'map': {
        const inSpan = num(2) - num(1)
        if (inSpan === 0) return num(3)
        return wrapType('long', Math.trunc(((num(0) - num(1)) * (num(4) - num(3))) / inSpan) + num(3))
      }
      case 'constrain':
        return Math.min(Math.max(num(0), num(1)), num(2))
      case 'min':
        return Math.min(num(0), num(1))
      case 'max':
        return Math.max(num(0), num(1))
      case 'abs':
        return Math.abs(num(0))
      case 'sq':
        return num(0) * num(0)
      case 'sqrt':
        return Math.sqrt(num(0))
      case 'pow':
        return Math.pow(num(0), num(1))
      case 'sin':
        return Math.sin(num(0))
      case 'cos':
        return Math.cos(num(0))
      case 'tan':
        return Math.tan(num(0))
      case 'exp':
        return Math.exp(num(0))
      case 'log':
        return Math.log(num(0))
      case 'floor':
        return Math.floor(num(0))
      case 'ceil':
        return Math.ceil(num(0))
      case 'round':
        return Math.round(num(0))
      case 'radians':
        return (num(0) * Math.PI) / 180
      case 'degrees':
        return (num(0) * 180) / Math.PI
      case 'bitRead':
        return (num(0) >>> num(1)) & 1
      case 'pgm_read_byte':
      case 'pgm_read_word':
      case 'pgm_read_dword':
      case 'pgm_read_float':
        // flash tables are ordinary arrays here, and `&table[i]` was already read as the element
        return num(0)
      case '__sizeof': {
        // [array, element size, rank]
        const arr = a[0] as unknown[]
        const inner = num(2) === 2 && arr.length > 0 ? (arr[0] as unknown[]).length : 1
        return arr.length * inner * num(1)
      }
      case 'bit':
        return num(0) >= 0 && num(0) < 32 ? (1 << num(0)) >>> 0 : 0
      case 'shiftOut': {
        // the Arduino core's loop: data bit out, clock high, clock low, each a digitalWrite
        const [data, clock, order, val] = [num(0), num(1), num(2), num(3)]
        let at = t
        const step = (pin: number, v: number): void => {
          this.host.digitalWrite(pin, v, at)
          at += SHIFT_CYCLES * CYCLE
        }
        for (let i = 0; i < 8; i++) {
          step(data, (order ? val >> (7 - i) : val >> i) & 1)
          step(clock, 1)
          step(clock, 0)
        }
        this.time = at
        return 0
      }
      case 'shiftIn': {
        const [data, clock, order] = [num(0), num(1), num(2)]
        let at = t
        let value = 0
        for (let i = 0; i < 8; i++) {
          this.host.digitalWrite(clock, 1, at)
          at += SHIFT_CYCLES * CYCLE
          const bit = this.host.digitalRead(data, at) ? 1 : 0
          value |= order ? bit << (7 - i) : bit << i
          this.host.digitalWrite(clock, 0, at)
          at += SHIFT_CYCLES * CYCLE
        }
        this.time = at
        return value
      }
      case 'tone': {
        const f = num(1)
        if (f <= 0) return 0
        this.host.tone(num(0), f, t)
        if (a.length > 2 && num(2) > 0) this.tones.set(num(0), t + num(2) / 1000)
        else this.tones.delete(num(0))
        return 0
      }
      case 'noTone':
        this.tones.delete(num(0))
        this.host.noTone(num(0), t)
        return 0
      case 'EEPROM.read':
        return this.eeprom[this.eepromAddr(num(0))]
      case 'EEPROM.write':
        this.eepromWrite(num(0), num(1), false)
        return 0
      case 'EEPROM.update':
        this.eepromWrite(num(0), num(1), true)
        return 0
      case 'EEPROM.length':
        return EEPROM_SIZE
      case 'EEPROM.put': {
        const type = ts[1] ?? 'int'
        const buf = new DataView(new ArrayBuffer(4))
        const n = this.eepromBytes(type)
        if (type === 'float') buf.setFloat32(0, num(1), true)
        else buf.setUint32(0, num(1) >>> 0, true)
        for (let i = 0; i < n; i++) this.eepromWrite(num(0) + i, buf.getUint8(i), true)
        return 0
      }
      case 'EEPROM.get': {
        // the compiler adds the type of the variable being filled as a second argument
        const type = a[1] as string
        const n = this.eepromBytes(type)
        const buf = new DataView(new ArrayBuffer(4))
        for (let i = 0; i < n; i++) buf.setUint8(i, this.eeprom[this.eepromAddr(num(0) + i)])
        return type === 'float' ? buf.getFloat32(0, true) : wrapType(type, buf.getUint32(0, true))
      }
      case 'lowByte':
        return num(0) & 0xff
      case 'highByte':
        return (num(0) >> 8) & 0xff
      case 'String':
        return formatValue(a[0], ts[0] ?? 'int', a.length > 1 ? num(1) : undefined)
      case 'F':
        return a[0] as string
      case 'Serial.begin':
        this.begun = true
        this.baud = Math.max(num(0), 300)
        return 0
      case 'Serial.end':
        this.begun = false
        return 0
      case 'Serial.print':
        this.serialOut(formatValue(a[0], ts[0] ?? 'int', a.length > 1 ? num(1) : undefined), t)
        return 0
      case 'Serial.println':
        this.serialOut((a.length > 0 ? formatValue(a[0], ts[0] ?? 'int', a.length > 1 ? num(1) : undefined) : '') + '\r\n', t)
        return 0
      case 'Serial.write': {
        if (Array.isArray(a[0])) {
          // write(buffer, length)
          const codes = (a[0] as number[]).slice(0, a.length > 1 ? num(1) : undefined)
          this.serialOut(codes.map((c) => String.fromCharCode(c & 0xff)).join(''), t)
        } else this.serialOut(typeof a[0] === 'string' ? (a[0] as string) : String.fromCharCode(num(0) & 0xff), t)
        return 0
      }
      case 'Serial.availableForWrite':
        return Math.max(0, 63 - Math.round(Math.max(0, this.serialBusyUntil - t) * (this.baud / 10)))
      case 'Serial.readString': {
        // the buffer is all there is: the real call would also wait out its timeout for more
        const s = this.input.map((c) => String.fromCharCode(c)).join('')
        this.input.length = 0
        return s
      }
      case 'Serial.readStringUntil': {
        let s = ''
        while (this.input.length > 0) {
          const c = this.input.shift()!
          if (c === (num(0) & 0xff)) break
          s += String.fromCharCode(c)
        }
        return s
      }
      case 'Serial.available':
        return this.input.length
      case 'Serial.read':
        return this.input.length > 0 ? this.input.shift()! : -1
      case 'Serial.peek':
        return this.input.length > 0 ? this.input[0] : -1
      case 'Serial.parseInt': {
        while (this.input.length > 0 && !(this.input[0] === 45 || (this.input[0] >= 48 && this.input[0] <= 57))) this.input.shift()
        let s = ''
        while (this.input.length > 0 && ((this.input[0] >= 48 && this.input[0] <= 57) || (s === '' && this.input[0] === 45))) s += String.fromCharCode(this.input.shift()!)
        return s === '' || s === '-' ? 0 : wrapType('long', parseInt(s, 10))
      }
      case 'Serial.parseFloat': {
        while (this.input.length > 0 && !(this.input[0] === 45 || this.input[0] === 46 || (this.input[0] >= 48 && this.input[0] <= 57))) this.input.shift()
        let s = ''
        while (this.input.length > 0 && /[-0-9.]/.test(String.fromCharCode(this.input[0]))) s += String.fromCharCode(this.input.shift()!)
        const v = parseFloat(s)
        return Number.isNaN(v) ? 0 : v
      }
      case 'Serial.flush':
      case 'Serial.setTimeout':
        return 0
      default:
        this.fail(`'${name}' is not available`, line)
        return 0
    }
  }
}

export type { Type }
