// A big test circuit for measuring how the board copes: rows of cells (resistor + LED in series) hung between two bus wires
// that a battery feeds, the same way a real lab is wired (branches resting on a bus wire). Nothing here is saved.

import { pinWorld } from '../parts/index.ts'
import type { SceneBuilder } from '../lessons/lessons.ts'
import type { Vec } from '../board/world.ts'

const CELLS_PER_ROW = 20
const COLUMN = 80
const ROW = 320

/** Fill the scene with about `parts` parts (two per cell, one battery per row). Returns how many parts it made. */
export function buildBench(b: SceneBuilder, parts: number): number {
  const cells = Math.max(1, Math.floor(parts / (2 + 1 / CELLS_PER_ROW)))
  const rows = Math.ceil(cells / CELLS_PER_ROW)
  let made = 0
  for (let row = 0; row < rows; row++) {
    const ry = row * ROW
    const count = Math.min(CELLS_PER_ROW, cells - row * CELLS_PER_ROW)
    const topY = ry - 60
    const bottomY = ry + 220
    const left = -40
    const right = (count - 1) * COLUMN + 40
    const bat = b.place('battery', -240, ry, { volts: 4.5 })
    made++
    const [plus, minus] = pinWorld(bat)
    const red = '#ff4a4a'
    const blue = '#2f6fe0'
    const topBus: Vec = { x: left, y: topY }
    const bottomBus: Vec = { x: left, y: bottomY }
    b.world.addWire(topBus, { x: right, y: topY }, red, [])
    b.world.addWire(bottomBus, { x: right, y: bottomY }, blue, [])
    b.world.addWire(plus, topBus, red, [{ x: plus.x, y: topY }])
    b.world.addWire(minus, bottomBus, blue, [{ x: minus.x, y: bottomY }])
    for (let k = 0; k < count; k++) {
      const cx = k * COLUMN
      const r = b.place('resistor', cx, ry, { value: 1000, legs: 1 })
      r.rot = 1
      const led = b.place('led', cx, ry + 100, { color: 'red', legs: 1 })
      led.rot = 1
      made += 2
      const rp = pinWorld(r)
      const lp = pinWorld(led)
      const top = rp[0].y <= rp[1].y ? rp[0] : rp[1]
      const low = top === rp[0] ? rp[1] : rp[0]
      const anode = lp[0] // A
      const cathode = lp[1] // K
      b.world.addWire(top, { x: top.x, y: topY }, red, [])
      b.world.addWire(low, anode, red, anode.x === low.x ? [] : [{ x: low.x, y: (low.y + anode.y) / 2 }, { x: anode.x, y: (low.y + anode.y) / 2 }])
      b.world.addWire(cathode, { x: cathode.x, y: bottomY }, blue, [])
    }
  }
  return made
}
