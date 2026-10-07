// Live simulation: rebuild + solve when the workspace changes, accumulate stress every frame.

import { solve } from '../sim/solver.ts'
import type { SolveResult } from '../sim/solver.ts'
import { defOf, pinWorld } from '../parts/index.ts'
import type { PartLive, Stress } from '../parts/types.ts'
import { buildNetlist } from './connectivity.ts'
import type { Netlist } from './connectivity.ts'
import type { World } from './world.ts'

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
  stress = new Map<string, Stress>()
  events: FailEvent[] = []
  log: LogEntry[] = []
  clock = 0
  private builtVersion = -1
  private warm?: Float64Array
  private world: World

  constructor(world: World) {
    this.world = world
    this.net = buildNetlist(world)
  }

  /** Re-solve now if the workspace changed. */
  refresh(): void {
    if (this.builtVersion === this.world.version) return
    this.builtVersion = this.world.version
    this.net = buildNetlist(this.world)
    const res = solve(this.net.circuit, this.warm)
    this.warm = res.raw
    this.result = res
    this.live.clear()
    this.stress.clear()
    for (const part of this.world.parts) {
      const pins = this.net.partPins.get(part.id)
      if (!pins) continue
      const ev = defOf(part.type).evaluate(part, {
        pins,
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
