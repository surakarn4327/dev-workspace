// Helpers for the machine tests: a host that records what the sketch did, and a runner that steps in 16 ms frames like the simulation.

import { compile, CompileError } from './compile.ts'
import { Machine } from './vm.ts'
import type { McuHost } from './vm.ts'

export interface Log {
  writes: [number, number, number][] // pin, value, time
  modes: [number, number][]
  serial: string
  analog: Record<number, number>
  digital: Record<number, number>
  pwm: [number, number, number][]
  tones: [number, number, number][] // pin, Hz (0 = noTone), time
  /** Pin level as a function of time, for pulseIn. */
  level?: (pin: number, t: number) => number
}

export function host(): { h: McuHost; log: Log } {
  const log: Log = { writes: [], modes: [], serial: '', analog: {}, digital: {}, pwm: [], tones: [] }
  const h: McuHost = {
    pinMode: (p, m) => log.modes.push([p, m]),
    digitalWrite: (p, v, t) => log.writes.push([p, v, t]),
    digitalRead: (p, t) => (log.level ? log.level(p, t) : log.digital[p] ?? 0),
    analogRead: (p) => log.analog[p] ?? 0,
    analogWrite: (p, v, t) => log.pwm.push([p, v, t]),
    serialWrite: (s) => {
      log.serial += s
    },
    tone: (p, f, t) => log.tones.push([p, f, t]),
    noTone: (p, t) => log.tones.push([p, 0, t]),
  }
  return { h, log }
}

export function run(src: string, seconds: number, setup?: (log: Log) => void): { m: Machine; log: Log } {
  const { h, log } = host()
  setup?.(log)
  const m = new Machine(compile(src), h)
  // advance in 16 ms frames like the simulation does
  for (let t = 0.016; t <= seconds + 1e-9; t += 0.016) m.advance(t)
  return { m, log }
}

export function errorOf(src: string): CompileError {
  try {
    compile(src)
  } catch (e) {
    if (e instanceof CompileError) return e
    throw e
  }
  throw new Error('expected a compile error')
}
