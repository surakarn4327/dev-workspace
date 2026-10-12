// Live simulation: rebuild + solve when the workspace changes, accumulate stress every frame.

import { advance } from '../sim/solver.ts'
import type { SolveResult } from '../sim/solver.ts'
import { defOf, pinWorld } from '../parts/index.ts'
import type { PartLive, Stress } from '../parts/types.ts'
import { McuBoards } from './mcuBoards.ts'
import { padOf } from '../parts/arduino.ts'
import { buildNetlist } from './connectivity.ts'
import type { Netlist } from './connectivity.ts'
import { computeFlow } from './flow.ts'
import type { Vec, World } from './world.ts'

export interface FailEvent {
  partId: string
  x: number
  y: number
}

export interface LogEntry {
  time: number
  partId: string
  partName: string
  message: string
}

const HEAT_RATE = 1.4
const COOL_RATE = 0.3
const INSTANT_RATIO = 6

export class Simulation {
  net: Netlist
  result: SolveResult | null = null
  live = new Map<string, PartLive>()
  /** Signed current in each wire (+ = from its `a` end to its `b` end) for the flowing dots; wires with no answer are absent. */
  flow = new Map<string, number>()
  /** Every stretch of wire with its own current (a wire with branches resting on it is several), for the dots. */
  flowParts: { wire: string; path: Vec[]; i: number }[] = []
  stress = new Map<string, Stress>()
  events: FailEvent[] = []
  log: LogEntry[] = []
  clock = 0
  /** Counts every new answer shown (readings, stress, wire currents): a picture of the circuit is stale when this moved. */
  stamp = 0
  private builtVersion = -1
  private builtClock = 0
  private warm?: Float64Array
  /** Voltage across each capacitor (by element id): where its charge is now. A new circuit starts discharged. */
  private charge = new Map<string, number>()
  private hasCaps = false
  /** The circuit has a capacitor or a timer chip: its state moves with time, so a PWM frame has to be stepped through. */
  private dynamic = false
  /** The circuit as it was last solved: a rebuild that comes out electrically identical (a part or wire dragged about) keeps the answer. */
  private sig = ''
  private solved: (SolveResult & { raw: Float64Array }) | null = null
  /** Every capacitor has stopped moving: no need to step time until the circuit changes. */
  private settled = false
  private world: World
  /** The sketches running on the Arduino boards (one machine per powered board). */
  readonly boards = new McuBoards()
  private pwmPhase = 0
  /** The frequency of the PWM wave on each pad that has duty between 0 and 1 (by pad key); 0 or missing = a stand-in rate. */
  private padHz = new Map<string, number>()

  constructor(world: World) {
    this.world = world
    this.net = buildNetlist(world)
  }

  /** Re-solve now if the workspace changed. */
  refresh(): void {
    // a part that drifts with time (a floating chip input) asks for a fresh build every 0.2 s
    const drifted = this.net.animated && this.clock - this.builtClock >= 0.2
    if (this.builtVersion === this.world.version && !drifted) return
    this.builtVersion = this.world.version
    this.builtClock = this.clock
    this.net = buildNetlist(this.world, this.clock)
    this.dynamic = this.net.circuit.elements.some((e) => e.kind === 'K' || e.kind === 'T')
    this.hasCaps = this.net.circuit.elements.some((e) => e.kind === 'K' || e.kind === 'T' || e.kind === 'Y' || e.kind === 'P')
    // a capacitor that is gone (deleted, burnt, replaced) lets go of its charge; a timer chip that is gone, of its latch
    const caps = new Set(this.net.circuit.elements.flatMap((e) => (e.kind === 'K' ? [e.id] : e.kind === 'T' ? [`${e.id}:q`, `${e.id}:en`] : e.kind === 'Y' ? [`${e.id}:on`] : e.kind === 'P' ? [`${e.id}:m`] : [])))
    for (const id of [...this.charge.keys()]) if (!caps.has(id)) this.charge.delete(id)
    const sig = JSON.stringify([this.net.circuit, [...this.net.partPins], [...this.net.partRef]])
    if (sig === this.sig && this.solved?.converged) {
      // same electrical circuit, only the geometry moved: the voltages and currents stand, the wire dots and readings are redone
      this.show(this.solved)
      return
    }
    this.sig = sig
    this.settled = false
    this.show(advance(this.net.circuit, this.charge, 0, this.warm))
  }

  /** Take a solve as the state of the circuit: current in the wires, and every part's readings and stress. */
  private show(res: SolveResult & { raw: Float64Array }): void {
    this.warm = res.raw
    this.stamp++
    this.solved = res
    this.result = res
    const flow = computeFlow(this.world, this.net, res)
    this.flow = flow.byWire
    this.flowParts = flow.parts
    this.live.clear()
    this.stress.clear()
    for (const part of this.world.parts) {
      const pins = this.net.partPins.get(part.id)
      if (!pins) continue
      const ev = defOf(part.type).evaluate(part, {
        pins,
        ref: this.net.partRef.get(part.id) ?? 0,
        v: (n) => res.v[n] ?? 0,
        cur: (id) => res.cur.get(id),
        ccIds: res.ccIds,
      })
      if (part.type === 'arduino-uno') this.boards.decorate(part.id, ev.live, this.clock)
      this.live.set(part.id, ev.live)
      if (ev.stress) this.stress.set(part.id, ev.stress)
    }
  }

  /**
   * A microcontroller pad's setting (`McuPinElement`): `value` 0..1 drives it (a PWM duty between), -2 turns the pull-up on, -1 makes
   * it a plain input. `pad` is the pin number of the part; the pad exists only while something is wired to it, so a caller keeps its
   * own table and sets it again after a rebuild.
   */
  setPad(partId: string, pad: number, value: number, hz = 0): void {
    const key = `${partId}:p${pad}:m`
    if (hz > 0) this.padHz.set(key, hz)
    else this.padHz.delete(key)
    if ((this.charge.get(key) ?? -1) === value) return
    this.charge.set(key, value)
    this.settled = false
  }

  /** Voltage of one I/O pad of an Arduino board (pad 0..19 = D0..D13, A0..A5) against the board's GND, from the last solve. */
  padVolts(partId: string, pad: number): number {
    const nodes = this.net.partPins.get(partId)
    const v = this.result?.v
    if (!nodes || !v) return 0
    return (v[nodes[padOf(pad)]] ?? 0) - (v[nodes[3]] ?? 0)
  }

  /** The 5 V rail of an Arduino board against its GND (analogRead's reference). */
  railVolts(partId: string): number {
    const nodes = this.net.partPins.get(partId)
    const v = this.result?.v
    if (!nodes || !v) return 5
    return (v[nodes[22]] ?? 0) - (v[nodes[3]] ?? 0)
  }

  /** Keys of the pads that a PWM is driving right now (duty strictly between 0 and 1). */
  private pwmKeys(): string[] {
    const out: string[] = []
    for (const [k, v] of this.charge) if (k.endsWith(':m') && v > 0 && v < 1) out.push(k)
    return out
  }

  /**
   * One frame with PWM pads. Each pad is a square wave of its own frequency (`padHz`) and duty, continuing from frame to frame; the
   * frame is cut at every edge of every wave and the circuit solved over each piece with the pads at their level in it. Capacitors
   * therefore follow the real waveform, and a load that is not linear (an LED) gets the average of its current, not the current at
   * the average voltage. When the waves have more edges than a frame can afford (a tone of several kHz) the frame is cut into 16
   * equal pieces whose phases shift a little each time, which gives the same average.
   */
  private stepPwm(dt: number, keys: string[]): void {
    const duty = keys.map((k) => this.charge.get(k) as number)
    const period = keys.map((k) => 1 / (this.padHz.get(k) ?? 490.196))
    const t0 = this.clock - dt
    const cuts = [0, dt]
    keys.forEach((_, n) => {
      const T = period[n]
      for (let p = Math.floor(t0 / T); p * T < t0 + dt; p++) {
        for (const e of [p * T, p * T + duty[n] * T]) {
          const x = e - t0
          if (x > 1e-9 && x < dt - 1e-9) cuts.push(x)
        }
      }
    })
    const segs: { len: number; high: boolean[] }[] = []
    if (cuts.length <= 72) {
      cuts.sort((x, y) => x - y)
      for (let j = 1; j < cuts.length; j++) {
        const len = cuts[j] - cuts[j - 1]
        if (len < 1e-8) continue
        const mid = t0 + (cuts[j] + cuts[j - 1]) / 2
        segs.push({ len, high: keys.map((_, n) => (mid / period[n]) % 1 < duty[n]) })
      }
    } else {
      const K = 16
      this.pwmPhase = (this.pwmPhase + 0.381966) % 1
      for (let j = 0; j < K; j++) {
        const phase = (j + this.pwmPhase) / K
        segs.push({ len: dt / K, high: duty.map((d) => phase < d) })
      }
    }
    let vSum: Float64Array | null = null
    const iSum = new Map<string, { i: number; ib: number; has: boolean }>()
    const cc = new Set<string>()
    let ok = true
    let iters = 0
    let last: (SolveResult & { raw: Float64Array }) | null = null
    // with nothing that stores state, a piece of the frame is solved once per pattern of high and low pads, however often it comes
    const seen = new Map<string, SolveResult & { raw: Float64Array }>()
    for (const seg of segs) {
      const w = seg.len / dt
      keys.forEach((k, n) => this.charge.set(k, seg.high[n] ? 1 : 0))
      const pattern = seg.high.map((h) => (h ? '1' : '0')).join('')
      let r = this.dynamic ? undefined : seen.get(pattern)
      if (!r) {
        r = advance(this.net.circuit, this.charge, this.dynamic ? seg.len : 0, this.warm, 1)
        if (!this.dynamic) seen.set(pattern, r)
      }
      last = r
      this.warm = r.raw
      if (vSum === null) vSum = new Float64Array(r.v.length)
      for (let n = 0; n < r.v.length; n++) vSum[n] += r.v[n] * w
      for (const [id, c] of r.cur) {
        const e = iSum.get(id)
        if (e) {
          e.i += c.i * w
          e.ib += (c.ib ?? 0) * w
        } else iSum.set(id, { i: c.i * w, ib: (c.ib ?? 0) * w, has: c.ib !== undefined })
      }
      for (const id of r.ccIds) cc.add(id)
      if (!r.converged) ok = false
      iters += r.iterations
    }
    keys.forEach((k, n) => this.charge.set(k, duty[n]))
    if (!last || !vSum) return
    const cur = new Map<string, { i: number; ib?: number }>()
    for (const [id, e] of iSum) cur.set(id, e.has ? { i: e.i, ib: e.ib } : { i: e.i })
    this.show({ v: vSum, cur, ccIds: cc, converged: ok, iterations: iters, raw: last.raw })
    this.settled = false
  }

  step(dt: number): void {
    this.clock += dt
    this.refresh()
    // the sketches run first, so what they do to their pads is in the solve below
    this.boards.update(this, this.world, dt)
    const pwm = this.pwmKeys()
    // capacitors charge and discharge in real time
    if (this.hasCaps && dt > 0 && pwm.length > 0) {
      this.stepPwm(Math.min(dt, 0.25), pwm)
    } else if (this.hasCaps && dt > 0 && !this.settled) {
      const before = new Map(this.charge)
      this.show(advance(this.net.circuit, this.charge, Math.min(dt, 0.25), this.warm))
      let moved = 0
      for (const [id, v] of this.charge) moved = Math.max(moved, Math.abs(v - (before.get(id) ?? 0)))
      if (moved < 1e-7) this.settled = true
    }
    let failedNow = false
    // a solve that did not converge gives numbers that mean nothing (a cold start after loading a file, or a wiring change that
    // the solver could not follow): never heat or burn a part on them, wait for a solve that did converge
    const trusted = this.result?.converged !== false
    for (const part of this.world.parts) {
      if (part.state.failed || !trusted) continue
      const s = this.stress.get(part.id)
      const ratio = s ? s.ratio : 0
      if (ratio > 1) part.state.heat += (ratio - 1) * HEAT_RATE * dt
      else part.state.heat = Math.max(0, part.state.heat - COOL_RATE * dt)
      if (ratio >= INSTANT_RATIO || part.state.heat >= 1) {
        part.state.heat = 1
        part.state.failed = true
        part.state.failMsg = s ? s.reason() : 'Part failed.'
        const def = defOf(part.type)
        const pins = pinWorld(part)
        const c = pins.length > 0 ? pins[Math.floor(pins.length / 2)] : { x: part.x, y: part.y }
        this.events.push({ partId: part.id, x: c.x, y: c.y - 10 })
        this.log.push({ time: this.clock, partId: part.id, partName: def.name, message: part.state.failMsg })
        if (this.log.length > 50) this.log.shift()
        failedNow = true
      }
    }
    if (failedNow) this.world.commit()
  }

  replace(partId: string): void {
    const part = this.world.getPart(partId)
    if (!part) return
    part.state = { heat: 0, failed: false, failMsg: '' }
    this.world.commit()
  }
}
