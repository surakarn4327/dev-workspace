// The I2C buses of a lab. A part that has `PartDef.i2c` is a device on a bus: the simulation keeps the device of every such part (a
// state machine that sees the bytes a sketch sends) and joins it to the Arduino boards whose SDA and SCL are on the same nets as its
// own SDA and SCL pins. The wiring and the supply are checked as on the bench: a device that is not powered, or that is not on the
// board's SDA and SCL, does not answer (a transmission to it comes back NACK). Pull-ups: the backpacks have their own and the
// Arduino turns its own on in Wire.begin().

import type { I2cDevice } from '../mcu/i2c.ts'
import { padOf } from '../parts/arduino.ts'
import { defOf } from '../parts/index.ts'
import type { Simulation } from './simulation.ts'
import type { PartInstance, World } from './world.ts'

/** The pin of the Uno the bus is on: A4 (SDA) and A5 (SCL) are the same nets as the SDA and SCL header pins beside AREF (R3). */
const UNO_SDA = [padOf(18), 1]
const UNO_SCL = [padOf(19), 0]
/** Supply a device needs to run. */
const MIN_VOLTS = 4

interface Entry {
  part: PartInstance
  dev: I2cDevice
  powered: boolean
}

export class I2cBuses {
  private devices = new Map<string, Entry>()
  /** Set when a device changed what it shows: the simulation redoes the readings of the parts. */
  private dirty = false

  /** Called once per simulation step: make the devices of new parts, drop the devices of parts that are gone, and follow the power. */
  update(sim: Simulation, world: World): void {
    const seen = new Set<string>()
    for (const part of world.parts) {
      const spec = defOf(part.type).i2c
      if (!spec) continue
      seen.add(part.id)
      let e = this.devices.get(part.id)
      if (!e) {
        e = { part, dev: spec.create(part), powered: false }
        this.devices.set(part.id, e)
      }
      e.part = part
      const addr = part.params.addr
      if (typeof addr === 'number') e.dev.address = addr & 0x7f
      const powered = !part.state.failed && sim.volts(part.id, spec.vcc, spec.gnd) >= MIN_VOLTS
      if (e.powered && !powered) {
        // power cut: the display forgets everything
        e.dev.reset()
        this.dirty = true
      }
      if (e.powered !== powered) this.dirty = true
      e.powered = powered
      // the backlight is part of the circuit (it draws current): follow the expander's pin into the part's settings
      const bl = e.dev.live?.().bl
      if (powered && bl !== undefined && part.params.bl !== bl) {
        part.params.bl = bl
        world.touch()
      } else if (!powered && part.params.bl !== 1) {
        // an expander with no power has nothing on its pins; it starts with them high
        part.params.bl = 1
        world.touch()
      }
    }
    for (const id of [...this.devices.keys()]) if (!seen.has(id)) this.devices.delete(id)
  }

  /** Is the device on the SDA and SCL of this board? */
  private onBus(sim: Simulation, boardId: string, e: Entry): boolean {
    const spec = defOf(e.part.type).i2c
    if (!spec) return false
    const board = sim.net.partPins.get(boardId)
    const dev = sim.net.partPins.get(e.part.id)
    if (!board || !dev) return false
    const sda = dev[spec.sda]
    const scl = dev[spec.scl]
    return UNO_SDA.some((i) => board[i] === sda) && UNO_SCL.some((i) => board[i] === scl) && sda !== scl
  }

  private answering(sim: Simulation, boardId: string, addr: number): Entry[] {
    const out: Entry[] = []
    for (const e of this.devices.values()) if (e.powered && e.dev.address === addr && this.onBus(sim, boardId, e)) out.push(e)
    return out
  }

  /** A whole transmission from `boardId`: the status `Wire.endTransmission()` returns (0 = acknowledged, 2 = nobody answered the address). */
  write(sim: Simulation, boardId: string, addr: number, data: number[]): number {
    const hits = this.answering(sim, boardId, addr)
    if (hits.length === 0) return 2
    let status = 0
    for (const e of hits) {
      status = Math.max(status, e.dev.write(data))
      this.dirty = true
    }
    return status
  }

  /** `count` bytes read from the device at `addr`, or null when none answers. */
  read(sim: Simulation, boardId: string, addr: number, count: number): number[] | null {
    const hits = this.answering(sim, boardId, addr)
    if (hits.length === 0) return null
    return hits[0].dev.read(count)
  }

  /** Put what a part's device shows in the part's live values (a part with no device, or one that has no power, gets nothing). */
  decorate(partId: string, live: Record<string, number>): void {
    const e = this.devices.get(partId)
    if (!e) return
    if (e.powered) Object.assign(live, e.dev.live?.() ?? {})
  }

  /** Has any device changed since the last call? */
  takeDirty(): boolean {
    const d = this.dirty
    this.dirty = false
    return d
  }

  deviceOf(partId: string): I2cDevice | undefined {
    return this.devices.get(partId)?.dev
  }
}
