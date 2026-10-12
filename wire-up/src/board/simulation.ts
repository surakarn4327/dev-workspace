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
  /** The circuit as it was last solved: a rebuild that comes out electrically identical (a part or wire dragged about) keeps the answer. */
  private sig = ''
  private solved: (SolveResult & { raw: Float64Array }) | null = null
  /** Every capacitor has stopped moving: no need to step time until the circuit changes. */
  private settled = false
  private world: World
  /** The sketches running on the Arduino boards (one machine per powered board). */
  readonly boards = new McuBoards()
  private pwmPhase = 0

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
  setPad(partId: string, pad: number, value: number): void {
    const key = `${partId}:p${pad}:m`
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
   * One frame with PWM pads: the circuit is solved at 16 instants of the PWM period (a pad is high at those where the period's phase
   * is under its duty), and the answers averaged. A load that is not linear (an LED) then gets the average of its current, not the
   * current at the average voltage. The phases shift a little every frame so the average is exact over time.
   */
  private stepPwm(dt: number, keys: string[]): void {
    const K = 16
    const duty = keys.map((k) => this.charge.get(k) as number)
    this.pwmPhase = (this.pwmPhase + 0.381966) % 1
    let vSum: Float64Array | null = null
    const iSum = new Map<string, { i: number; ib: number; has: boolean }>()
    const cc = new Set<string>()
    let ok = true
    let iters = 0
    let last: (SolveResult & { raw: Float64Array }) | null = null
    for (let j = 0; j < K; j++) {
      const phase = (j + this.pwmPhase) / K
      keys.forEach((k, n) => this.charge.set(k, phase < duty[n] ? 1 : 0))
      const r = advance(this.net.circuit, this.charge, dt / K, this.warm)
      last = r
      this.warm = r.raw
      if (vSum === null) vSum = new Float64Array(r.v.length)
      for (let n = 0; n < r.v.length; n++) vSum[n] += r.v[n]
      for (const [id, c] of r.cur) {
        const e = iSum.get(id)
        if (e) {
          e.i += c.i
          e.ib += c.ib ?? 0
        } else iSum.set(id, { i: c.i, ib: c.ib ?? 0, has: c.ib !== undefined })
      }
      for (const id of r.ccIds) cc.add(id)
      if (!r.converged) ok = false
      iters += r.iterations
    }
    keys.forEach((k, n) => this.charge.set(k, duty[n]))
    if (!last || !vSum) return
    const v = new Float64Array(vSum.length)
    for (let n = 0; n < v.length; n++) v[n] = vSum[n] / K
    const cur = new Map<string, { i: number; ib?: number }>()
    for (const [id, e] of iSum) cur.set(id, e.has ? { i: e.i / K, ib: e.ib / K } : { i: e.i / K })
    this.show({ v, cur, ccIds: cc, converged: ok, iterations: iters, raw: last.raw })
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
