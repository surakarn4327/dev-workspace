// How a burnt-out part looks: the part itself, charred. It is drawn the normal way into a scratch canvas, then darkened
// and sooted only where the part has pixels (source-atop), so the burn follows the real shape of every part.

import { PX } from './pixel.ts'

/** Parts whose "failed" state is not a burn (the multimeter's blown fuse shows on its own display). */
const NOT_BURNT = new Set(['meter'])

export function canBurn(type: string): boolean {
  return !NOT_BURNT.has(type)
}

/** Burnt look, in order of use. See style.md 2.7. */
export const BURN = {
  char: '#17100e',
  charAlpha: 0.74,
  soot: '#050304',
  sootAlpha: 0.8,
  scorch: '#3a2418',
  ember: '#ff7a2a',
  emberHot: '#ffb43a',
}

/** Room around the part's bounds, so legs and anything else drawn outside it are charred too. */
const PAD = 40

/** Same input, same number in [0, 1): the soot never shimmers from frame to frame. */
function hash(a: number, b: number, seed: number): number {
  let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(seed, 2246822519)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function seedOf(id: string): number {
  let s = 17
  for (let i = 0; i < id.length; i++) s = (Math.imul(s, 31) + id.charCodeAt(i)) | 0
  return s
}

export interface BurntArea {
  /** Part-local rectangle the scratch canvas covers. */
  x: number
  y: number
  w: number
  h: number
}

/**
 * Paint the burnt part into `scratch` (resized to fit) and return the part-local area it covers; the caller draws the
 * canvas there. `scale` is device pixels per world unit, so the pixel art stays crisp.
 */
export function paintBurnt(
  scratch: HTMLCanvasElement,
  drawPart: (c: CanvasRenderingContext2D) => void,
  b: { x: number; y: number; w: number; h: number },
  id: string,
  now: number,
  scale: number,
): BurntArea {
  const area: BurntArea = { x: Math.floor(b.x - PAD), y: Math.floor(b.y - PAD), w: Math.ceil(b.w + PAD * 2), h: Math.ceil(b.h + PAD * 2) }
  scratch.width = Math.max(1, Math.ceil(area.w * scale))
  scratch.height = Math.max(1, Math.ceil(area.h * scale))
  const c = scratch.getContext('2d')!
  c.setTransform(scale, 0, 0, scale, -area.x * scale, -area.y * scale)
  c.imageSmoothingEnabled = false
  drawPart(c)

  c.globalCompositeOperation = 'source-atop'
  c.globalAlpha = BURN.charAlpha
  c.fillStyle = BURN.char
  c.fillRect(area.x, area.y, area.w, area.h)

  // soot: big dark patches that thicken toward the middle, then small brown scorch specks
  const seed = seedOf(id)
  const cx = b.x + b.w / 2
  const cy = b.y + b.h / 2
  const rx = Math.max(b.w / 2, 1)
  const ry = Math.max(b.h / 2, 1)
  const patch = PX * 3
  const x0 = Math.floor(b.x / patch) * patch
  const y0 = Math.floor(b.y / patch) * patch
  c.globalAlpha = BURN.sootAlpha
  c.fillStyle = BURN.soot
  for (let y = y0; y < b.y + b.h; y += patch) {
    for (let x = x0; x < b.x + b.w; x += patch) {
      const d = Math.min(1, Math.hypot((x + patch / 2 - cx) / rx, (y + patch / 2 - cy) / ry))
      if (hash(x / patch, y / patch, seed) < 0.62 - 0.4 * d) c.fillRect(x, y, patch, patch)
    }
  }
  c.fillStyle = BURN.scorch
  for (let y = Math.floor(b.y / PX) * PX; y < b.y + b.h; y += PX) {
    for (let x = Math.floor(b.x / PX) * PX; x < b.x + b.w; x += PX) {
      if (hash(x / PX, y / PX, seed + 1) > 0.9) c.fillRect(x, y, PX, PX)
    }
  }

  // a few embers that still glow, flickering out of step
  for (let k = 0; k < 3; k++) {
    const ex = Math.floor((b.x + hash(k, 1, seed + 2) * b.w) / PX) * PX
    const ey = Math.floor((b.y + hash(k, 2, seed + 2) * b.h) / PX) * PX
    c.globalAlpha = Math.max(0, 0.45 + 0.4 * Math.sin(now * 7 + k * 2.1 + seed))
    c.fillStyle = k === 0 ? BURN.emberHot : BURN.ember
    c.fillRect(ex, ey, PX, PX)
  }
  c.globalAlpha = 1
  c.globalCompositeOperation = 'source-over'
  return area
}
