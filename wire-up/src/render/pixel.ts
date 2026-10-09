// Hand-built pixel art: shapes are drawn on a small grid of palette letters, outlined automatically,
// cached as tiny bitmaps and drawn with no smoothing. One art pixel = PX world px.

export const PX = 2

export interface Sprite {
  canvas: HTMLCanvasElement
  /** Grid size without the outline. */
  w: number
  h: number
}

export class PixelGrid {
  readonly w: number
  readonly h: number
  private cells: string[]

  constructor(w: number, h: number) {
    this.w = w
    this.h = h
    this.cells = new Array<string>(w * h).fill('.')
  }

  get(x: number, y: number): string {
    return x < 0 || y < 0 || x >= this.w || y >= this.h ? '.' : this.cells[y * this.w + x]
  }

  set(x: number, y: number, ch: string): void {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.cells[y * this.w + x] = ch
  }

  rect(x: number, y: number, w: number, h: number, ch: string): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, ch)
  }

  /** Filled circle; (cx, cy) may be fractional so even diameters stay symmetric. */
  disc(cx: number, cy: number, r: number, ch: string): void {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x + 0.5 - cx
        const dy = y + 0.5 - cy
        if (dx * dx + dy * dy <= r * r) this.set(x, y, ch)
      }
    }
  }

  /** Rectangle with properly rounded corners (quarter circles of radius r). */
  rrect(x: number, y: number, w: number, h: number, r: number, ch: string): void {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const dx = i < r ? r - i - 0.5 : i >= w - r ? i - (w - r) + 0.5 : 0
        const dy = j < r ? r - j - 0.5 : j >= h - r ? j - (h - r) + 0.5 : 0
        if (dx === 0 || dy === 0 || dx * dx + dy * dy <= r * r) this.set(x + i, y + j, ch)
      }
    }
  }

  /** Paint a rectangle, but only over cells that currently hold one of the letters in `over`. */
  paint(x: number, y: number, w: number, h: number, ch: string, over: string): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (over.includes(this.get(x + i, y + j))) this.set(x + i, y + j, ch)
  }

  /** Knock the four corners off so a rectangle reads as rounded. */
  round(n: number): void {
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < n - k; i++) {
        this.set(i, k, '.')
        this.set(this.w - 1 - i, k, '.')
        this.set(i, this.h - 1 - k, '.')
        this.set(this.w - 1 - i, this.h - 1 - k, '.')
      }
    }
  }

  /**
   * Rasterise to a bitmap. `outline` paints one pixel around every filled cell (null = no outline);
   * `shadow` adds a one-pixel drop shadow down and to the right of the whole silhouette.
   * The bitmap is (w + 3) x (h + 3); grid cell (0, 0) sits at bitmap (1, 1).
   */
  build(palette: Record<string, string>, outline: string | null = '#15121f', shadow: string | null = 'rgba(0,0,0,0.38)'): Sprite {
    const ow = this.w + 3
    const oh = this.h + 3
    const cv = document.createElement('canvas')
    cv.width = ow
    cv.height = oh
    const c = cv.getContext('2d')!
    const solid = (x: number, y: number): boolean => {
      if (this.get(x, y) !== '.') return true
      return outline !== null && (this.get(x - 1, y) !== '.' || this.get(x + 1, y) !== '.' || this.get(x, y - 1) !== '.' || this.get(x, y + 1) !== '.')
    }
    if (shadow) {
      c.fillStyle = shadow
      for (let y = -1; y <= this.h + 1; y++) for (let x = -1; x <= this.w + 1; x++) if (!solid(x, y) && solid(x - 1, y - 1)) c.fillRect(x + 1, y + 1, 1, 1)
    }
    for (let y = -1; y <= this.h; y++) {
      for (let x = -1; x <= this.w; x++) {
        const ch = this.get(x, y)
        if (ch !== '.') {
          c.fillStyle = palette[ch] ?? '#ff00ff'
          c.fillRect(x + 1, y + 1, 1, 1)
        } else if (outline && solid(x, y)) {
          c.fillStyle = outline
          c.fillRect(x + 1, y + 1, 1, 1)
        }
      }
    }
    return { canvas: cv, w: this.w, h: this.h }
  }
}

const cache = new Map<string, Sprite>()

/** Build once per key. */
export function sprite(key: string, make: () => Sprite): Sprite {
  let s = cache.get(key)
  if (!s) {
    if (cache.size > 200) cache.clear()
    s = make()
    cache.set(key, s)
  }
  return s
}

/** Draw a sprite with grid cell (0, 0) at world (x, y). */
export function drawSprite(c: CanvasRenderingContext2D, s: Sprite, x: number, y: number): void {
  const smooth = c.imageSmoothingEnabled
  c.imageSmoothingEnabled = false
  c.drawImage(s.canvas, x - PX, y - PX, s.canvas.width * PX, s.canvas.height * PX)
  c.imageSmoothingEnabled = smooth
}

const inkCache = new WeakMap<Sprite, { x0: number; y0: number; x1: number; y1: number }>()

/** Visible edges of a sprite (solid pixels clearly different from the background, `COL.bg` = #23232b) drawn with `drawSprite(c, s, x, y)`, in world px. */
export function spriteInk(s: Sprite, x: number, y: number): { left: number; top: number; right: number; bottom: number } {
  let b = inkCache.get(s)
  if (!b) {
    const cv = s.canvas
    const data = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data
    b = { x0: cv.width, y0: cv.height, x1: -1, y1: -1 }
    for (let j = 0; j < cv.height; j++) {
      for (let i = 0; i < cv.width; i++) {
        const o = (j * cv.width + i) * 4
        // visible = solid enough and different enough from the canvas background (a near-background outline row is not an edge)
        if (data[o + 3] < 128 || Math.abs(data[o] - 35) + Math.abs(data[o + 1] - 35) + Math.abs(data[o + 2] - 43) <= 60) continue
        b.x0 = Math.min(b.x0, i)
        b.x1 = Math.max(b.x1, i)
        b.y0 = Math.min(b.y0, j)
        b.y1 = Math.max(b.y1, j)
      }
    }
    inkCache.set(s, b)
  }
  return {
    left: x - PX + b.x0 * PX,
    top: y - PX + b.y0 * PX,
    right: x - PX + (b.x1 + 1) * PX,
    bottom: y - PX + (b.y1 + 1) * PX,
  }
}

/** One art pixel rectangle in art coordinates, for small moving details. */
type LegCells = Map<string, 'L' | 'D'>

/**
 * Paint a steel leg given as cells of the art pixel grid (light or dark half), in the style of the DIP chip's pins: a dark outline
 * round every cell (4 neighbours, no corners) and the sprites' 38 % drop shadow, using exactly the rule `PixelGrid.build` uses.
 * The outline adds one art pixel (2 world px) past each end, so a label at the tip needs `tipPastPin` 2 more than for a bare leg.
 */
function paintLegCells(c: CanvasRenderingContext2D, cells: LegCells): void {
  const has = (ax: number, ay: number): boolean => cells.has(`${ax},${ay}`)
  const solid = (ax: number, ay: number): boolean => has(ax, ay) || has(ax - 1, ay) || has(ax + 1, ay) || has(ax, ay - 1) || has(ax, ay + 1)
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const k of cells.keys()) {
    const [ax, ay] = k.split(',').map(Number)
    x0 = Math.min(x0, ax)
    x1 = Math.max(x1, ax)
    y0 = Math.min(y0, ay)
    y1 = Math.max(y1, ay)
  }
  c.fillStyle = 'rgba(0,0,0,0.38)'
  for (let ay = y0 - 1; ay <= y1 + 2; ay++) for (let ax = x0 - 1; ax <= x1 + 2; ax++) if (!solid(ax, ay) && solid(ax - 1, ay - 1)) c.fillRect(ax * PX, ay * PX, PX, PX)
  c.fillStyle = '#07070a'
  for (let ay = y0 - 1; ay <= y1 + 1; ay++) for (let ax = x0 - 1; ax <= x1 + 1; ax++) if (solid(ax, ay) && !has(ax, ay)) c.fillRect(ax * PX, ay * PX, PX, PX)
  for (const [k, tone] of cells) {
    const [ax, ay] = k.split(',').map(Number)
    c.fillStyle = tone === 'L' ? '#c9ced6' : '#7d838f'
    c.fillRect(ax * PX, ay * PX, PX, PX)
  }
}

/** A vertical leg centred on world x, from `top` to `bottom` (even numbers), light on the left, shaded on the right. */
export function pxLeg(c: CanvasRenderingContext2D, x: number, top: number, bottom: number): void {
  const cells: LegCells = new Map()
  for (let ay = top / PX; ay < bottom / PX; ay++) {
    cells.set(`${(x - 2) / PX},${ay}`, 'L')
    cells.set(`${(x - 2) / PX + 1},${ay}`, 'D')
  }
  paintLegCells(c, cells)
}

/** A horizontal leg centred on world y, from `left` to `right`, light on the top row, shaded on the bottom row. */
export function pxLegH(c: CanvasRenderingContext2D, y: number, left: number, right: number): void {
  const cells: LegCells = new Map()
  for (let ax = left / PX; ax < right / PX; ax++) {
    cells.set(`${ax},${(y - 2) / PX}`, 'L')
    cells.set(`${ax},${(y - 2) / PX + 1}`, 'D')
  }
  paintLegCells(c, cells)
}

/** A slanted leg from art pixel (x0, y0) to (x1, y1): the dark line, with the light line one pixel to its left (as `pxLine` pairs were drawn before). */
export function pxLegDiag(c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  const cells: LegCells = new Map()
  for (const [dx, tone] of [[-1, 'L'], [0, 'D']] as const) {
    let x = Math.round(x0 + dx)
    let y = Math.round(y0)
    const ex = Math.round(x1 + dx)
    const ey = Math.round(y1)
    const ddx = Math.abs(ex - x)
    const ddy = -Math.abs(ey - y)
    const sx = x < ex ? 1 : -1
    const sy = y < ey ? 1 : -1
    let err = ddx + ddy
    for (;;) {
      cells.set(`${x},${y}`, tone)
      if (x === ex && y === ey) break
      const e2 = 2 * err
      if (e2 >= ddy) {
        err += ddy
        x += sx
      }
      if (e2 <= ddx) {
        err += ddx
        y += sy
      }
    }
  }
  paintLegCells(c, cells)
}

export function pxRect(c: CanvasRenderingContext2D, ox: number, oy: number, ax: number, ay: number, aw: number, ah: number, color: string): void {
  c.fillStyle = color
  c.fillRect(ox + ax * PX, oy + ay * PX, aw * PX, ah * PX)
}

/** Straight line of art pixels (Bresenham), for pointers and needles. */
export function pxLine(c: CanvasRenderingContext2D, ox: number, oy: number, x0: number, y0: number, x1: number, y1: number, color: string): void {
  let x = Math.round(x0)
  let y = Math.round(y0)
  const ex = Math.round(x1)
  const ey = Math.round(y1)
  const dx = Math.abs(ex - x)
  const dy = -Math.abs(ey - y)
  const sx = x < ex ? 1 : -1
  const sy = y < ey ? 1 : -1
  let err = dx + dy
  for (;;) {
    pxRect(c, ox, oy, x, y, 1, 1, color)
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
