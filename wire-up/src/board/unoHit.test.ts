import { describe, expect, it } from 'vitest'
import { newPart } from '../parts/index.ts'
import { World } from './world.ts'
import { hitTest } from './hit.ts'

function kind(w: World, x: number, y: number): string {
  return hitTest(w, { x, y }, 1, null).kind
}

describe('the Uno is clicked where it is, not in its bounding box', () => {
  const make = (usb: boolean): World => {
    const w = new World()
    const uno = newPart('p1', 'arduino-uno', 1000, 1000)
    uno.params.usb = usb
    w.parts.push(uno)
    return w
  }

  it('the board, the USB socket and the plug are hit', () => {
    const w = make(true)
    expect(kind(w, 1000 + 300, 1000 + 250)).toBe('part') // the middle of the board
    expect(kind(w, 1000 - 20, 1000 + 120)).toBe('part') // the USB socket past the left edge
    expect(kind(w, 1000 - 300, 1000 + 116)).toBe('part') // the plug and its cable
  })

  it('empty corners of the bounding box are not hit', () => {
    const w = make(true)
    expect(kind(w, 1000 - 300, 1000 + 20)).not.toBe('part') // above the cable
    expect(kind(w, 1000 - 300, 1000 + 300)).not.toBe('part') // below the cable
    expect(kind(w, 1000 + 535, 1000 + 20)).not.toBe('part') // the cut top-right corner of the board
  })

  it('with the plug out, the space where the cable was is empty', () => {
    const w = make(false)
    expect(kind(w, 1000 - 300, 1000 + 116)).not.toBe('part')
    expect(kind(w, 1000 - 20, 1000 + 120)).toBe('part') // the socket is still there
  })
})
