// Pixel-art cables: a polyline is rasterised onto the art-pixel grid (PX world px per pixel),
// three pixels thick with a lit top/left edge, a shaded bottom/right edge, a dark own-colour outline
// and a drop shadow, all painted in a few batched fills.

import { PX } from './pixel.ts'
import { mix } from './draw.ts'

export interface PixelPoint {
  x: number
  y: number
}

const OFF = 1 << 20
const key = (x: number, y: number): number => (x + OFF) * 2097152 + (y + OFF)

/** Art pixels along a world-space polyline (Bresenham between consecutive points). */
function rasterize(pts: PixelPoint[]): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let i = 0; i + 1 < pts.length; i++) {
    let x = Math.round(pts[i].x / PX)
    let y = Math.round(pts[i].y / PX)
    const ex = Math.round(pts[i + 1].x / PX)
    const ey = Math.round(pts[i + 1].y / PX)
    const dx = Math.abs(ex - x)
    const dy = -Math.abs(ey - y)
    const sx = x < ex ? 1 : -1
    const sy = y < ey ? 1 : -1
    let err = dx + dy
    for (;;) {
      out.push([x, y])
      if (x === ex && y === ey) break
      const e2 = 2 * err
      if (e2 >= dy) {
        err += dy
        x += sx
      }
      if (e2 <= dx) {
        err += dx
        y += sy
      }
    }
  }
  return out
}

function fillCells(c: CanvasRenderingContext2D, cells: Array<[number, number]>, color: string): void {
  if (cells.length === 0) return
  c.fillStyle = color
  c.beginPath()
  for (const [x, y] of cells) c.rect(x * PX, y * PX, PX, PX)
  c.fill()
}

export interface CableShape {
  bodyCells: Array<[number, number]>
  outline: Array<[number, number]>
  shadow: Array<[number, number]>
  lit: Array<[number, number]>
  mid: Array<[number, number]>
  dark: Array<[number, number]>
}

/** Work out which art pixels a cable covers and how each is shaded. */
export function cableShape(pts: PixelPoint[]): CableShape {
  const body = new Set<number>()
  for (const [x, y] of rasterize(pts)) {
    body.add(key(x, y))
    body.add(key(x - 1, y))
    body.add(key(x + 1, y))
    body.add(key(x, y - 1))
    body.add(key(x, y + 1))
  }
  const bodyCells: Array<[number, number]> = []
  const outlineMap = new Map<number, [number, number]>()
  const unkey = (k: number): [number, number] => [Math.floor(k / 2097152) - OFF, (k % 2097152) - OFF]
  for (const k of body) {
    const [x, y] = unkey(k)
    bodyCells.push([x, y])
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ]) {
      const nk = key(nx, ny)
      if (!body.has(nk)) outlineMap.set(nk, [nx, ny])
    }
  }
  const solid = (x: number, y: number) => body.has(key(x, y)) || outlineMap.has(key(x, y))
  const shadow: Array<[number, number]> = []
  for (const [x, y] of [...bodyCells, ...outlineMap.values()]) if (!solid(x + 1, y + 1)) shadow.push([x + 1, y + 1])
  const lit: Array<[number, number]> = []
  const mid: Array<[number, number]> = []
  const dark: Array<[number, number]> = []
  for (const [x, y] of bodyCells) {
    const light = !body.has(key(x, y - 1)) || !body.has(key(x - 1, y))
    const shade = !body.has(key(x, y + 1)) || !body.has(key(x + 1, y))
    ;(light && !shade ? lit : shade && !light ? dark : mid).push([x, y])
  }
  return { bodyCells, outline: [...outlineMap.values()], shadow, lit, mid, dark }
}

/** The drop shadow and dark outline. Draw these for every cable before any body so joined cables merge cleanly. */
export function drawCableBase(c: CanvasRenderingContext2D, shape: CableShape, color: string): void {
  fillCells(c, shape.shadow, 'rgba(0,0,0,0.38)')
  fillCells(c, shape.outline, mix(color, '#000000', 0.78))
}

export function drawCableBody(c: CanvasRenderingContext2D, shape: CableShape, color: string): void {
  fillCells(c, shape.mid, color)
  fillCells(c, shape.lit, mix(color, '#ffffff', 0.4))
  fillCells(c, shape.dark, mix(color, '#000000', 0.35))
}

/** Metal pins at the wire's ends and plugs; `skip` lists ends that rest on another wire and get no pin. */
export function drawCableCaps(c: CanvasRenderingContext2D, pts: PixelPoint[], plugs: PixelPoint[] = [], skip: PixelPoint[] = []): void {
  const skipped = new Set(skip.map((p) => key(Math.round(p.x / PX), Math.round(p.y / PX))))
  for (const p of [pts[0], pts[pts.length - 1], ...plugs]) {
    const x = Math.round(p.x / PX)
    const y = Math.round(p.y / PX)
    if (skipped.has(key(x, y))) continue
    fillCells(c, [[x, y], [x + 1, y], [x, y + 1]], '#c9ced6')
    fillCells(c, [[x - 1, y], [x, y - 1]], '#f1f4f9')
    fillCells(c, [[x + 1, y + 1]], '#7d838f')
  }
}

/** Draw a cable along `pts` in `color`; `ends` adds a metal pin at both ends (jumper wires). */
export function pixelCable(c: CanvasRenderingContext2D, pts: PixelPoint[], color: string, ends: boolean, plugs: PixelPoint[] = []): void {
  if (pts.length < 2) return
  const shape = cableShape(pts)
  drawCableBase(c, shape, color)
  drawCableBody(c, shape, color)
  if (ends) drawCableCaps(c, pts, plugs)
}

/**
 * Pixel probe head. `tip` is the contact point and the housing extends away from it along y
 * (`bodyDir` = +1 down / -1 up), as the lead always arrives vertically.
 */
export function pixelProbeHead(c: CanvasRenderingContext2D, tip: PixelPoint, bodyDir: number, color: string): void {
  const tx = Math.round(tip.x / PX)
  const ty = Math.round(tip.y / PX)
  const rect = (x0: number, y0: number, w: number, h: number): Array<[number, number]> => {
    const cells: Array<[number, number]> = []
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) cells.push([x0 + i, y0 + j])
    return cells
  }
  // laid out going down from the tip, mirrored when the housing is above it
  const at = (x: number, y: number, w: number, h: number): Array<[number, number]> =>
    bodyDir > 0 ? rect(tx + x, ty + y, w, h) : rect(tx + x, ty - y - h, w, h)
  const outlineColor = mix(color, '#000000', 0.78)
  // metal tip 2 wide x 3 long, housing 6 wide x 14 long
  fillCells(c, at(-3, 3, 8, 16), 'rgba(0,0,0,0.38)')
  fillCells(c, at(-4, 2, 8, 16), outlineColor)
  fillCells(c, at(-1, -1, 2, 5), outlineColor)
  fillCells(c, at(-1, 0, 2, 3), '#c9ced6')
  fillCells(c, at(-1, 0, 1, 3), '#f1f4f9')
  fillCells(c, at(-3, 3, 6, 14), color)
  fillCells(c, at(-3, 3, 1, 14), mix(color, '#ffffff', 0.4))
  fillCells(c, at(1, 3, 2, 14), mix(color, '#000000', 0.35))
}
