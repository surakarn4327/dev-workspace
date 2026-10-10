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
  // a few cells: plain rectangles are the cheapest thing a graphics card is asked to draw (a path of them is not)
  for (const [x, y] of cells) c.fillRect(x * PX, y * PX, PX, PX)
}

export interface CableShape {
  bodyCells: Array<[number, number]>
  outline: Array<[number, number]>
  shadow: Array<[number, number]>
  lit: Array<[number, number]>
  mid: Array<[number, number]>
  dark: Array<[number, number]>
  /** The cells of each layer as one Path2D, made the first time the layer is drawn and kept with the shape. */
  paths: Partial<Record<'shadow' | 'outline' | 'mid' | 'lit' | 'dark' | 'select' | 'halo1' | 'halo2', Path2D>>
  /** The cable as two small pictures, one art pixel per canvas pixel, for each colour it has been drawn in (see `cablePictures`). */
  pictures: Map<string, CablePictures | null>
  /**
   * The cells above are relative to this art pixel. A shape does not depend on where the cable lies, so a cable that is only moved
   * (a dragged wire) uses the shape it already had, put down at the new place: see `place`.
   */
  ox: number
  oy: number
}

interface CablePictures {
  /** Shadow and outline. */
  base: HTMLCanvasElement
  /** The three shades of the body. */
  body: HTMLCanvasElement
  /** Art pixel of the picture's top-left corner. */
  x: number
  y: number
}

/** A cable bigger than this many art pixels in its bounding box is painted from its cells instead of from a picture. */
const MAX_PICTURE_PIXELS = 400_000

function paintCells(g: CanvasRenderingContext2D, cells: Array<[number, number]>, ox: number, oy: number, color: string): void {
  if (cells.length === 0) return
  g.fillStyle = color
  g.beginPath()
  for (const [x, y] of cells) g.rect(x - ox, y - oy, 1, 1)
  g.fill()
}

/**
 * A cable is thousands of one-pixel squares. Filling them every frame is cheap for the script but slow for a weak graphics card
 * (a path made of thousands of little squares), so the squares are painted once into a small picture, one art pixel per picture
 * pixel, and each frame only copies the picture. Copying it with smoothing off keeps it sharp at every zoom level.
 */
function cablePictures(shape: CableShape, color: string): CablePictures | null {
  const cache = shape.pictures
  const hit = cache.get(color)
  if (hit !== undefined) return hit
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const cells of [shape.shadow, shape.outline, shape.bodyCells]) {
    for (const [x, y] of cells) {
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  if (!(w > 0 && h > 0) || w * h > MAX_PICTURE_PIXELS) {
    cache.set(color, null)
    return null
  }
  const make = (): [HTMLCanvasElement, CanvasRenderingContext2D] => {
    const cv = document.createElement('canvas')
    cv.width = w
    cv.height = h
    return [cv, cv.getContext('2d')!]
  }
  const [base, gb] = make()
  paintCells(gb, shape.shadow, x0, y0, 'rgba(0,0,0,0.38)')
  paintCells(gb, shape.outline, x0, y0, mix(color, '#000000', 0.78))
  const [body, gd] = make()
  paintCells(gd, shape.mid, x0, y0, color)
  paintCells(gd, shape.lit, x0, y0, mix(color, '#ffffff', 0.4))
  paintCells(gd, shape.dark, x0, y0, mix(color, '#000000', 0.35))
  const made = { base, body, x: x0, y: y0 }
  cache.set(color, made)
  return made
}

function copyPicture(c: CanvasRenderingContext2D, pic: HTMLCanvasElement, x: number, y: number): void {
  const smooth = c.imageSmoothingEnabled
  c.imageSmoothingEnabled = false
  c.drawImage(pic, x * PX, y * PX, pic.width * PX, pic.height * PX)
  c.imageSmoothingEnabled = smooth
}

type Layer = 'shadow' | 'outline' | 'mid' | 'lit' | 'dark'

function fillLayer(c: CanvasRenderingContext2D, shape: CableShape, layer: Layer, color: string): void {
  const cells = shape[layer]
  if (cells.length === 0) return
  const paths = shape.paths
  let path = paths[layer]
  if (!path) {
    path = new Path2D()
    for (const [x, y] of cells) path.rect(x * PX, y * PX, PX, PX)
    paths[layer] = path
  }
  c.fillStyle = color
  c.save()
  c.translate(shape.ox * PX, shape.oy * PX)
  c.fill(path)
  c.restore()
}

/**
 * Shapes are a pure function of the rounded polyline, and working one out is the costliest thing a frame can do (a hundred wires
 * took ~175 ms when redone every frame), so they are remembered. Shapes are shared: callers only read them.
 */
const shapeCache = new Map<string, CableShape>()
const SHAPE_CACHE_MAX = 2000

function remember(k: string, make: () => CableShape): CableShape {
  let shape = shapeCache.get(k)
  if (!shape) {
    if (shapeCache.size >= SHAPE_CACHE_MAX) shapeCache.clear() // a wire being dragged makes a new key every frame
    shape = make()
    shapeCache.set(k, shape)
  }
  return shape
}

/** Work out which art pixels a cable covers and how each is shaded. */
export function cableShape(pts: PixelPoint[]): CableShape {
  // remembered by its form (every corner relative to the first), so a cable that only moved finds the shape it had
  const ox = Math.round(pts[0].x / PX)
  const oy = Math.round(pts[0].y / PX)
  const form = pts.map((p) => `${Math.round(p.x / PX) - ox},${Math.round(p.y / PX) - oy}`).join(';')
  return place(remember(form, () => buildCable(pts, ox, oy)), ox, oy)
}

function buildCable(pts: PixelPoint[], ox: number, oy: number): CableShape {
  const body = new Set<number>()
  const relative = pts.map((p) => ({ x: p.x - ox * PX, y: p.y - oy * PX }))
  for (const [x, y] of rasterize(relative)) {
    body.add(key(x, y))
    body.add(key(x - 1, y))
    body.add(key(x + 1, y))
    body.add(key(x, y - 1))
    body.add(key(x, y + 1))
  }
  return shapeOf(body)
}

/**
 * The round dot where a branch wire joins the middle of another: a disc 5 art pixels across (the cable is 3 thick; 4.5 would be
 * 1.5 times, and 5 is the nearest width that sits exactly centred on the cable), shaded and outlined exactly like a cable so the
 * two merge. Draw its base with the cables' bases and its body after the cables' bodies.
 */
export function junctionShape(at: PixelPoint): CableShape {
  const cx = Math.round(at.x / PX)
  const cy = Math.round(at.y / PX)
  return place(remember('junction', buildJunction), cx, cy)
}

function buildJunction(): CableShape {
  const body = new Set<number>()
  for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) if (Math.abs(dx) + Math.abs(dy) < 4) body.add(key(dx, dy)) // 5x5 minus its four corner cells
  return shapeOf(body)
}

/** Outline, shadow and shading for a set of body cells. */
function shapeOf(body: Set<number>): CableShape {
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
  return { bodyCells, outline: [...outlineMap.values()], shadow, lit, mid, dark, paths: {}, pictures: new Map(), ox: 0, oy: 0 }
}

/** The same shape put down at art pixel (ox, oy): shares the saved paths and pictures of `base`. */
function place(base: CableShape, ox: number, oy: number): CableShape {
  const placed = Object.create(base) as CableShape
  placed.ox = ox
  placed.oy = oy
  return placed
}

/**
 * The mark of a selected cable: a solid one-pixel line just outside its dark outline, in the same pixel style as the dashed outline
 * of a selected part (but without the gaps). A ready-made path of art-pixel squares, kept with the shape.
 */
/**
 * The glow round a selection: two layers from the outside in, each (how many art pixels it reaches out from the line, how strong it
 * is): two art pixels wide in all.
 */
export const SELECT_GLOW_STEPS: ReadonlyArray<readonly [number, number]> = [
  [2, 0.12],
  [1, 0.25],
]
export const SELECT_GLOW_REACH = 2

function selectionPicture(shape: CableShape, color: string): CablePictures | null {
  const cache = shape.pictures
  const id = `select|${color}`
  const hit = cache.get(id)
  if (hit !== undefined) return hit
  {
    const taken = new Set<number>()
    for (const [x, y] of shape.bodyCells) taken.add(key(x, y))
    for (const [x, y] of shape.outline) taken.add(key(x, y))
    const ring = new Map<number, [number, number]>()
    for (const [x, y] of shape.outline) {
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ]) {
        const k = key(nx, ny)
        if (!taken.has(k)) ring.set(k, [nx, ny])
      }
    }
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const [x, y] of ring.values()) {
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
    x0 -= SELECT_GLOW_REACH
    y0 -= SELECT_GLOW_REACH
    x1 += SELECT_GLOW_REACH
    y1 += SELECT_GLOW_REACH
    const w = x1 - x0 + 1
    const h = y1 - y0 + 1
    if (!(w > 0 && h > 0) || w * h > MAX_PICTURE_PIXELS) {
      cache.set(id, null)
      return null
    }
    const cv = document.createElement('canvas')
    cv.width = w
    cv.height = h
    const g = cv.getContext('2d')!
    g.fillStyle = color
    // the two layers of glow from the outside in (each a fainter, fatter copy of the line), then the line itself
    for (const [grow, alpha] of [...SELECT_GLOW_STEPS, [0, 1] as const]) {
      g.globalAlpha = alpha
      g.beginPath()
      for (const [x, y] of ring.values()) g.rect(x - grow - x0, y - grow - y0, 2 * grow + 1, 2 * grow + 1)
      g.fill()
    }
    const made = { base: cv, body: cv, x: x0, y: y0 }
    cache.set(id, made)
    return made
  }
}

/**
 * Draw the selection mark of a cable at the place it lies: the line, and two steps of glow round it that are fainter and fatter
 * copies of it (`outer` and `inner` are how strong they are). No blur, and one picture copied per cable: thousands of little
 * squares filled every frame (what it used to be) is the slowest thing a weak graphics card is asked to do.
 */
export function drawCableSelection(c: CanvasRenderingContext2D, shape: CableShape, color: string): void {
  const pic = selectionPicture(shape, color)
  if (pic) copyPicture(c, pic.base, pic.x + shape.ox, pic.y + shape.oy)
}

/** The drop shadow and dark outline. Draw these for every cable before any body so joined cables merge cleanly. */
export function drawCableBase(c: CanvasRenderingContext2D, shape: CableShape, color: string): void {
  const pic = cablePictures(shape, color)
  if (pic) return copyPicture(c, pic.base, pic.x + shape.ox, pic.y + shape.oy)
  fillLayer(c, shape, 'shadow', 'rgba(0,0,0,0.38)')
  fillLayer(c, shape, 'outline', mix(color, '#000000', 0.78))
}

export function drawCableBody(c: CanvasRenderingContext2D, shape: CableShape, color: string): void {
  const pic = cablePictures(shape, color)
  if (pic) return copyPicture(c, pic.body, pic.x + shape.ox, pic.y + shape.oy)
  fillLayer(c, shape, 'mid', color)
  fillLayer(c, shape, 'lit', mix(color, '#ffffff', 0.4))
  fillLayer(c, shape, 'dark', mix(color, '#000000', 0.35))
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
