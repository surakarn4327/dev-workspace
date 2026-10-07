// Drawing helpers: neon palette, text, legs, glow. Canvas 2D only.

export const COL = {
  bg: '#23232b',
  grid: '#6a6a7c',
  cyan: '#38f9ff',
  magenta: '#ff3df2',
  green: '#39ff88',
  amber: '#ffb43a',
  red: '#ff3b4a',
  dim: '#a29dd2',
  text: '#b9b4e8',
  metal: '#c9ced6',
  metalDark: '#7d838f',
}

// Silver (pixel font, see THIRD-PARTY.md), then agent-office's monospace stack as fallback.
const FONT_STACK = 'Silver, "Cascadia Mono", Consolas, Menlo, "Courier New", monospace'

/** Silver has small glyphs for its em; this matches the size the old pixel text had. */
const FONT_BOOST = 1.6

export interface TextOpts {
  color?: string
  /** Multiplier on the base size. */
  scale?: number
  align?: 'left' | 'center' | 'right'
  /** Base font size in world px. */
  size?: number
  /** Draw on a white label box with black text (colour is ignored). */
  box?: boolean
}

/** (x, y) is the top of the text box. Drawn as real text, so it stays sharp at every zoom level. */
export function drawText(c: CanvasRenderingContext2D, str: string, x: number, y: number, o: TextOpts = {}): void {
  const px = (o.size ?? 8) * (o.scale ?? 1)
  const align = o.align ?? 'left'
  c.save()
  c.font = `${px * FONT_BOOST}px ${FONT_STACK}`
  c.textAlign = align
  c.textBaseline = 'alphabetic'
  const base = y + px
  if (o.box) {
    const m = c.measureText(str)
    const pad = 4
    const border = 2
    const left = align === 'center' ? x - m.width / 2 : align === 'right' ? x - m.width : x
    const asc = m.actualBoundingBoxAscent
    const desc = m.actualBoundingBoxDescent
    const bx = Math.round(left - pad - border)
    const by = Math.round(base - asc - pad - border)
    const bw = Math.round(m.width + (pad + border) * 2)
    const bh = Math.round(asc + desc + (pad + border) * 2)
    // pixel-art label: black outline with notched corners, white fill
    c.fillStyle = '#000000'
    c.fillRect(bx + border, by, bw - border * 2, bh)
    c.fillRect(bx, by + border, bw, bh - border * 2)
    c.fillStyle = '#ffffff'
    c.fillRect(bx + border * 2, by + border, bw - border * 4, bh - border * 2)
    c.fillRect(bx + border, by + border * 2, bw - border * 2, bh - border * 4)
    c.fillStyle = '#111111'
  } else {
    c.fillStyle = o.color ?? COL.text
  }
  c.fillText(str, x, base)
  c.restore()
}

export function rrect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2)
  c.beginPath()
  c.moveTo(x + rr, y)
  c.lineTo(x + w - rr, y)
  c.arcTo(x + w, y, x + w, y + rr, rr)
  c.lineTo(x + w, y + h - rr)
  c.arcTo(x + w, y + h, x + w - rr, y + h, rr)
  c.lineTo(x + rr, y + h)
  c.arcTo(x, y + h, x, y + h - rr, rr)
  c.lineTo(x, y + rr)
  c.arcTo(x, y, x + rr, y, rr)
  c.closePath()
}

/** Metal component leg with a highlight line. */
export function leg(c: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  c.lineCap = 'round'
  c.strokeStyle = COL.metalDark
  c.lineWidth = 3
  c.beginPath()
  c.moveTo(x1, y1)
  c.lineTo(x2, y2)
  c.stroke()
  c.strokeStyle = COL.metal
  c.lineWidth = 1.5
  c.beginPath()
  c.moveTo(x1, y1 - 0.5)
  c.lineTo(x2, y2 - 0.5)
  c.stroke()
  c.lineCap = 'butt'
}

export function neon(c: CanvasRenderingContext2D, color: string, blur: number, fn: () => void): void {
  c.save()
  c.shadowColor = color
  c.shadowBlur = blur
  fn()
  c.restore()
}

export function radialGlow(c: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number): void {
  if (alpha <= 0.01) return
  c.save()
  c.globalCompositeOperation = 'lighter'
  const g = c.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, withAlpha(color, alpha))
  g.addColorStop(0.45, withAlpha(color, alpha * 0.35))
  g.addColorStop(1, withAlpha(color, 0))
  c.fillStyle = g
  c.beginPath()
  c.arc(x, y, r, 0, Math.PI * 2)
  c.fill()
  c.restore()
}

export function withAlpha(hex: string, a: number): string {
  const h = hex.replace('#', '')
  const f = h.length === 3 ? h.split('').map((ch) => ch + ch).join('') : h
  const n = parseInt(f.slice(0, 6), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

/** Linear mix between two #rrggbb colours. t = 0 gives a, 1 gives b. */
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t)
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`
}

export function fmtNum(v: number, digits: number): string {
  if (!Number.isFinite(v)) return '--'
  return v.toFixed(digits)
}
