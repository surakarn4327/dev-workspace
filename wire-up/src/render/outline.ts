// Selection outline that follows a part's own shape: the part is drawn small (one art pixel per canvas pixel), the
// pixels it covers are found, and the ring of pixels just outside them is the outline.

import type { PartDef } from '../parts/types.ts'
import type { PartInstance } from '../board/world.ts'
import { PX } from './pixel.ts'
import { scene } from './scene.ts'

export interface Ring {
  /** Outline pixels in part-local world units (top-left corner of each art pixel). */
  cells: Array<[number, number]>
}

/** Room around the part's bounds, so legs and anything drawn outside it are inside the grid. */
const PAD = 24
const cache = new Map<string, Ring>()
let scratch: HTMLCanvasElement | null = null

export function ringOf(part: PartInstance, def: PartDef): Ring {
  // looks of a part that change its shape (a switch flipped, legs lengthened); live readings never do
  const key = `${part.type}|${JSON.stringify(part.params)}|${part.state.failed}`
  const hit = cache.get(key)
  if (hit) return hit
  const ring = build(part, def)
  if (cache.size > 300) cache.clear()
  cache.set(key, ring)
  return ring
}

function build(part: PartInstance, def: PartDef): Ring {
  const b = def.bounds(part)
  const ox = Math.floor((b.x - PAD) / PX) * PX
  const oy = Math.floor((b.y - PAD) / PX) * PX
  const w = Math.ceil((b.w + PAD * 2) / PX)
  const h = Math.ceil((b.h + PAD * 2) / PX)
  scratch ??= document.createElement('canvas')
  scratch.width = w
  scratch.height = h
  const c = scratch.getContext('2d', { willReadFrequently: true })!
  c.setTransform(1 / PX, 0, 0, 1 / PX, -ox / PX, -oy / PX)
  c.imageSmoothingEnabled = false
  // draw the bare part: no value labels, no live glow
  const labeled = scene.labeled
  scene.labeled = new Set()
  try {
    def.draw(c, { ...part, rot: 0 }, {}, 0)
  } finally {
    scene.labeled = labeled
  }
  const data = c.getImageData(0, 0, w, h).data
  const mask = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) mask[i] = data[i * 4 + 3] > 140 ? 1 : 0
  const cells: Array<[number, number]> = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) continue
      let near = false
      for (let dy = -1; dy <= 1 && !near; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && mask[ny * w + nx]) {
            near = true
            break
          }
        }
      }
      if (near) cells.push([ox + x * PX, oy + y * PX])
    }
  }
  return { cells }
}
