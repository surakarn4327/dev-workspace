// Live simulation: rebuild + solve when the workspace changes, accumulate stress every frame.

import { advance } from '../sim/solver.ts'
import type { SolveResult } from '../sim/solver.ts'
import { defOf, pinWorld } from '../parts/index.ts'
import type { PartLive, Stress } from '../parts/types.ts'
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
  private builtVersion = -1
  private builtClock = 0
  private warm?: Float64Array
  /** Voltage across each capacitor (by element id): where its charge is now. A new circuit starts discharged. */
  private charge = new Map<string, number>()
  private hasCaps = false
  private world: World

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
    this.hasCaps = this.net.circuit.elements.some((e) => e.kind === 'K')
    // a capacitor that is gone (deleted, burnt, replaced) lets go of its charge
    const caps = new Set(this.net.circuit.elements.flatMap((e) => (e.kind === 'K' ? [e.id] : [])))
    for (const id of [...this.charge.keys()]) if (!caps.has(id)) this.charge.delete(id)
    this.show(advance(this.net.circuit, this.charge, 0, this.warm))
  }

  /** Take a solve as the state of the circuit: current in the wires, and every part's readings and stress. */
  private show(res: SolveResult & { raw: Float64Array }): void {
    this.warm = res.raw
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
      this.live.set(part.id, ev.live)
      if (ev.stress) this.stress.set(part.id, ev.stress)
    }
  }

  step(dt: number): void {
    this.clock += dt
    this.refresh()
    // capacitors charge and discharge in real time
    if (this.hasCaps && dt > 0) this.show(advance(this.net.circuit, this.charge, Math.min(dt, 0.25), this.warm))
    let failedNow = false
    for (const part of this.world.parts) {
      if (part.state.failed) continue
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
