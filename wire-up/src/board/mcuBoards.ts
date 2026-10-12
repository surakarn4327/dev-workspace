// The sketches running on the Arduino boards of a lab: one machine per powered board, its pins joined to the board's pads and its
// Serial output kept for the console. Everything here follows the real chip: a sketch starts when the board gets power or is
// reset, runs the program flashed into it (`program`, set by the code panel's Upload), and stops when power goes.

import { compile, CompileError } from '../mcu/compile.ts'
import type { Program } from '../mcu/compile.ts'
import { EEPROM_SIZE, Machine } from '../mcu/vm.ts'
import type { McuHost } from '../mcu/vm.ts'
import { padOf } from '../parts/arduino.ts'
import type { Simulation } from './simulation.ts'
import type { PartInstance, World } from './world.ts'

export type BoardState = 'off' | 'blank' | 'running' | 'reset' | 'error' | 'stalled'

/** Pins that have hardware PWM on the Uno. */
const PWM_PINS = new Set([3, 5, 6, 9, 10, 11])
/** Supply below this and the chip does not run (brown-out); the Uno needs 4.5 V for 16 MHz, the Arduino cores are happy from here. */
const RUN_VOLTS = 3.5
/** RESET held under this voltage keeps the chip in reset. */
const RESET_LOW = 1.0
const KEEP_CHARS = 12000

interface Pad {
  /** What the sketch asked for: input (-1), input with pull-up (-2), or the share of time driven high (0..1). */
  eff: number
  mode: 'in' | 'out'
  level: 0 | 1
  /** analogWrite duty 0..1 while a PWM is set, else null. */
  pwm: number | null
  acc: number
  seg: number
  sent: number
  /** Frequency of the `tone()` running on the pin, 0 when none. */
  tone: number
}

class Board {
  machine: Machine | null = null
  source: string | null = null
  program: Program | null = null
  startedAt = 0
  state: BoardState = 'off'
  error = ''
  text = ''
  total = 0
  txAt = -1
  rxAt = -1
  frameStart = 0
  slow = false
  pads: Pad[] = Array.from({ length: 20 }, () => ({ eff: -1, mode: 'in', level: 0, pwm: null, acc: 0, seg: 0, sent: -1, tone: 0 }))
}

/** The EEPROM saved in a board's `eeprom` parameter (hex text); cells never written read 0xFF. */
function loadEeprom(text: unknown): Uint8Array {
  const out = new Uint8Array(EEPROM_SIZE).fill(0xff)
  if (typeof text === 'string') {
    for (let i = 0; i < EEPROM_SIZE && i * 2 + 1 < text.length; i++) {
      const v = parseInt(text.slice(i * 2, i * 2 + 2), 16)
      if (!Number.isNaN(v)) out[i] = v
    }
  }
  return out
}

function saveEeprom(bytes: Uint8Array): string {
  // all erased: nothing to keep
  if (bytes.every((v) => v === 0xff)) return ''
  let last = bytes.length - 1
  while (last > 0 && bytes[last] === 0xff) last--
  let s = ''
  for (let i = 0; i <= last; i++) s += bytes[i].toString(16).padStart(2, '0')
  return s
}

export class McuBoards {
  /** Called when a sketch changed something worth saving (the EEPROM). */
  onPersist: () => void = () => {}
  private boards = new Map<string, Board>()
  private cache = new Map<string, Program | string>()

  /** Compile with a small cache; the result is the program or the error text with its line. */
  private build(source: string): Program | string {
    const hit = this.cache.get(source)
    if (hit !== undefined) return hit
    let out: Program | string
    try {
      out = compile(source)
    } catch (e) {
      out = e instanceof CompileError ? `line ${e.line}: ${e.message}` : String(e)
    }
    if (this.cache.size > 20) this.cache.clear()
    this.cache.set(source, out)
    return out
  }

  /** What the console of a board shows: its state, the last error, and the Serial text. */
  info(partId: string): { state: BoardState; error: string; text: string; total: number; slow: boolean } {
    const b = this.boards.get(partId)
    return b ? { state: b.state, error: b.error, text: b.text, total: b.total, slow: b.slow } : { state: 'off', error: '', text: '', total: 0, slow: false }
  }

  /** The frequency of the `tone()` playing on a pin of a board (0 when silent): what a buzzer wired to the pin would sound. */
  toneOf(partId: string, pin: number): number {
    return this.boards.get(partId)?.pads[pin]?.tone ?? 0
  }

  serialInput(partId: string, text: string): void {
    const b = this.boards.get(partId)
    if (!b?.machine) return
    b.machine.serialIn(text)
    b.rxAt = b.startedAt + b.machine.time
  }

  clearSerial(partId: string): void {
    const b = this.boards.get(partId)
    if (b) {
      b.text = ''
      b.total = 0
    }
  }

  /** Put the TX / RX lamp readings in a board's live values. */
  decorate(partId: string, live: Record<string, number>, clock: number): void {
    const b = this.boards.get(partId)
    live.tx = b && b.txAt >= 0 && clock - b.txAt < 0.06 ? 1 : 0
    live.rx = b && b.rxAt >= 0 && clock - b.rxAt < 0.06 ? 1 : 0
  }

  /** Called once per simulation step, before the circuit is solved: run each board's sketch up to now and set its pads. */
  update(sim: Simulation, world: World, dt: number): void {
    const seen = new Set<string>()
    for (const part of world.parts) {
      if (part.type !== 'arduino-uno') continue
      seen.add(part.id)
      this.updateOne(sim, part, dt)
    }
    for (const id of [...this.boards.keys()]) if (!seen.has(id)) this.boards.delete(id)
  }

  private releasePads(sim: Simulation, partId: string, b: Board): void {
    for (let n = 0; n < 20; n++) {
      const p = b.pads[n]
      p.eff = -1
      p.mode = 'in'
      p.level = 0
      p.pwm = null
      p.tone = 0
      p.acc = 0
      if (p.sent !== -1) sim.setPad(partId, padOf(n), -1)
      p.sent = -1
    }
  }

  private updateOne(sim: Simulation, part: PartInstance, dt: number): void {
    let b = this.boards.get(part.id)
    if (!b) {
      b = new Board()
      this.boards.set(part.id, b)
    }
    const live = sim.live.get(part.id)
    const program = typeof part.params.program === 'string' ? part.params.program.slice(0, 30000) : ''
    const powered = !part.state.failed && (live?.v ?? 0) >= RUN_VOLTS
    const held = part.params.pressed === true || (powered && (live?.rst ?? 5) < RESET_LOW)
    const now = sim.clock
    if (!powered || held || program.trim() === '') {
      if (b.machine || b.state === 'running' || b.state === 'error' || b.state === 'stalled') this.releasePads(sim, part.id, b)
      b.machine = null
      b.source = null
      b.state = !powered ? 'off' : held ? 'reset' : 'blank'
      return
    }
    if (b.machine === null || b.source !== program) {
      // power came back, reset was released, or a new program was flashed: start from the top
      if (b.machine || b.pads.some((p) => p.sent !== -1)) this.releasePads(sim, part.id, b)
      b.source = program
      const built = this.build(program)
      if (typeof built === 'string') {
        b.machine = null
        b.program = null
        b.state = 'error'
        b.error = built
        return
      }
      b.program = built
      b.error = ''
      b.startedAt = now - dt
      b.frameStart = now - dt
      b.machine = new Machine(built, this.hostFor(sim, part.id, b), loadEeprom(part.params.eeprom))
      b.state = 'running'
    }
    const m = b.machine
    if (m.error !== null) {
      if (b.state !== 'error') {
        b.state = 'error'
        b.error = m.error
        // the chip is stuck: it keeps driving whatever it last drove, like a hung sketch would
      }
      return
    }
    // run to now, the pads recording how long they were high within this frame
    for (const p of b.pads) {
      p.acc = 0
      p.seg = b.frameStart
    }
    m.advance(now - b.startedAt)
    b.slow = m.slow
    if (m.eepromDirty) {
      // the cells live in the board's parameters, so they survive a reset, a power cut and a save
      m.eepromDirty = false
      part.params.eeprom = saveEeprom(m.eeprom)
      this.onPersist()
    }
    b.state = m.slow ? 'stalled' : 'running'
    if (m.error !== null) {
      b.state = 'error'
      b.error = m.error
    }
    for (let n = 0; n < 20; n++) {
      const p = b.pads[n]
      let v: number
      if (p.mode === 'in') v = p.level ? -2 : -1
      else {
        const span = now - b.frameStart
        const cur = p.pwm !== null ? p.pwm : p.level
        v = span > 0 ? (p.acc + cur * (now - p.seg)) / span : cur
        v = Math.min(Math.max(v, 0), 1)
        // within a hair of fully on or off is fully on or off (avoids chasing noise)
        if (v < 0.002) v = 0
        else if (v > 0.998) v = 1
      }
      if (v !== p.sent) {
        sim.setPad(part.id, padOf(n), v)
        p.sent = v
      }
      p.eff = v
    }
    b.frameStart = now
  }

  private hostFor(sim: Simulation, partId: string, b: Board): McuHost {
    const abs = (t: number): number => b.startedAt + t
    /** Close the time spent in the pad's current state before it changes at machine time `t`. */
    const change = (n: number, t: number, apply: (p: Pad) => void): void => {
      const p = b.pads[n]
      const at = Math.min(Math.max(abs(t), p.seg), sim.clock)
      if (p.mode === 'out') p.acc += (p.pwm !== null ? p.pwm : p.level) * (at - p.seg)
      p.seg = at
      apply(p)
    }
    const index = (pin: number): number => (pin >= 0 && pin <= 19 ? pin : -1)
    return {
      pinMode(pin, mode, t) {
        const n = index(pin)
        if (n < 0) return
        change(n, t, (p) => {
          p.pwm = null
          p.tone = 0
          if (mode === 1) p.mode = 'out'
          else {
            p.mode = 'in'
            p.level = mode === 2 ? 1 : p.level
          }
        })
      },
      digitalWrite(pin, value, t) {
        const n = index(pin)
        if (n < 0) return
        change(n, t, (p) => {
          p.level = value ? 1 : 0
          p.pwm = null
          p.tone = 0
        })
      },
      digitalRead(pin) {
        const n = index(pin)
        return n >= 0 && sim.padVolts(partId, n) > 2.5 ? 1 : 0
      },
      analogRead(pin) {
        const n = index(pin)
        if (n < 14) return 0
        const v = sim.padVolts(partId, n)
        const rail = Math.max(sim.railVolts(partId), 0.1)
        return Math.min(Math.max(Math.round((v / rail) * 1023), 0), 1023)
      },
      analogWrite(pin, value, t) {
        const n = index(pin)
        if (n < 0) return
        change(n, t, (p) => {
          if (PWM_PINS.has(pin)) {
            p.pwm = value <= 0 ? 0 : value >= 255 ? 1 : value / 255
          } else {
            p.pwm = null
            p.level = value >= 128 ? 1 : 0
          }
          p.tone = 0
        })
      },
      tone(pin, freq, t) {
        const n = index(pin)
        if (n < 0) return
        // tone() makes the pin an output and swings it at `freq`: over a frame that is half the time high
        change(n, t, (p) => {
          p.mode = 'out'
          p.pwm = 0.5
          p.tone = freq
        })
      },
      noTone(pin, t) {
        const n = index(pin)
        if (n < 0) return
        change(n, t, (p) => {
          p.pwm = null
          p.level = 0
          p.tone = 0
        })
      },
      serialWrite(text, t) {
        b.text += text
        b.total += text.length
        if (b.text.length > KEEP_CHARS) b.text = b.text.slice(b.text.length - KEEP_CHARS)
        b.txAt = abs(t)
      },
    }
  }
}

