import { describe, expect, it } from 'vitest'
import { newPart } from '../parts/index.ts'
import { buildNetlist } from './connectivity.ts'
import { branchesOfParts, effectiveColors, rootWire } from './wireJoin.ts'
import { World } from './world.ts'

function mainAndBranch(): { w: World; main: string; branch: string } {
  const w = new World()
  const main = w.addWire({ x: 0, y: 0 }, { x: 200, y: 0 }, '#ff4a4a')
  const branch = w.addWire({ x: 100, y: 100 }, { x: 100, y: 0 }, '#2f6fe0')
  return { w, main: main.id, branch: branch.id }
}

describe('branch wires', () => {
  // pin 0 of a resistor sits on the resistor's own position, so a resistor placed at a point reads that point's net
  function netsAt(w: World, a: { x: number; y: number }, b: { x: number; y: number }): [number, number] {
    const ra = newPart(w.nextId('p'), 'resistor', a.x, a.y)
    const rb = newPart(w.nextId('p'), 'resistor', b.x, b.y)
    w.parts.push(ra, rb)
    const net = buildNetlist(w)
    return [net.partPins.get(ra.id)![0], net.partPins.get(rb.id)![0]]
  }

  it('a wire end resting on another wire joins it electrically', () => {
    const { w } = mainAndBranch()
    const [far, main] = netsAt(w, { x: 100, y: 100 }, { x: 200, y: 0 })
    expect(far).toBe(main)
  })

  it('a wire that only passes by its neighbour stays separate', () => {
    const w = new World()
    w.addWire({ x: 0, y: 0 }, { x: 200, y: 0 }, '#ff4a4a')
    w.addWire({ x: 100, y: 100 }, { x: 100, y: 20 }, '#2f6fe0')
    const [far, main] = netsAt(w, { x: 100, y: 100 }, { x: 200, y: 0 })
    expect(far).not.toBe(main)
  })

  it('the branch is drawn in the main wire colour, and changing the branch changes the main', () => {
    const { w, main, branch } = mainAndBranch()
    expect(effectiveColors(w).get(branch)).toBe('#ff4a4a')
    expect(rootWire(w, w.getWire(branch)!).id).toBe(main)
    w.getWire(branch)!.via = [{ x: 100, y: 60 }]
    expect(effectiveColors(w).get(branch)).toBe('#ff4a4a')
  })

  it('moving the end away undoes the join and brings back its own colour', () => {
    const { w, branch } = mainAndBranch()
    w.getWire(branch)!.b = { x: 100, y: 40 }
    expect(effectiveColors(w).get(branch)).toBe('#2f6fe0')
  })

  it('an end plugged into a pin that lies under another wire does not join it', () => {
    const w = new World()
    w.addWire({ x: 0, y: 100 }, { x: 200, y: 100 }, '#ff4a4a')
    const r = newPart(w.nextId('p'), 'resistor', 100, 100) // pin 1 sits on the passing wire
    w.parts.push(r)
    const own = w.addWire({ x: 100, y: 100 }, { x: 100, y: 300 }, '#2f6fe0')
    expect(effectiveColors(w).get(own.id)).toBe('#2f6fe0')
  })

  it('deleting the part the branch was pulled from takes the branch with it, not the main wire', () => {
    const w = new World()
    const main = w.addWire({ x: 0, y: 0 }, { x: 300, y: 0 }, '#ff4a4a')
    const r = newPart(w.nextId('p'), 'resistor', 100, 100)
    w.parts.push(r)
    const branch = w.addWire({ x: 100, y: 100 }, { x: 100, y: 0 }, '#2f6fe0')
    const plain = w.addWire({ x: 140, y: 100 }, { x: 140, y: 200 }, '#2ea043') // plugged in, but not a branch
    const gone = branchesOfParts(w, [r])
    expect(gone.has(branch.id)).toBe(true)
    expect(gone.has(main.id)).toBe(false)
    expect(gone.has(plain.id)).toBe(false)
  })
})

describe('meter probes only touch', () => {
  it('a probe tip on the free end of a branch neither keeps it from joining the main wire nor makes it go with the meter', () => {
    const { w, main, branch } = mainAndBranch()
    const meter = newPart(w.nextId('p'), 'meter', 400, 0)
    meter.leads![0] = { x: 100, y: 100 } // the free end of the branch
    w.parts.push(meter)
    expect(effectiveColors(w).get(branch)).toBe(w.getWire(main)!.color)
    expect(branchesOfParts(w, [meter]).size).toBe(0)
  })

  it('a probe tip on the end that rests on the main wire does not turn the branch into its own colour', () => {
    const { w, main, branch } = mainAndBranch()
    const meter = newPart(w.nextId('p'), 'meter', 400, 0)
    meter.leads![0] = { x: 100, y: 0 } // where the branch rests on the main wire
    w.parts.push(meter)
    expect(effectiveColors(w).get(branch)).toBe(w.getWire(main)!.color)
  })

  it('reads a wire end (bare cap) but not the covered point where a branch rests on another wire', () => {
    const { w } = mainAndBranch()
    w.addWire({ x: 0, y: 0 }, { x: 0, y: -100 }, '#2f6fe0') // a second wire starting on the main wire's end
    const meter = newPart(w.nextId('p'), 'meter', 400, 0)
    meter.leads![0] = { x: 100, y: 100 } // free end (cap) of the branch
    meter.leads![1] = { x: 100, y: 0 } // where the branch rests on the main wire's body
    w.parts.push(meter)
    const net = buildNetlist(w)
    const pins = net.partPins.get(meter.id)!
    const mainEnd = net.nodeAt({ x: 200, y: 0 })
    expect(pins[0]).toBe(mainEnd) // the branch's cap is on the main wire's net
    expect(pins[1]).not.toBe(mainEnd) // the covered joint reads nothing
  })
})

