import { G, pointKey } from '../board/world.ts'
import type { PartInstance, Vec } from '../board/world.ts'
import { COL, drawText, rrect } from '../render/draw.ts'
import { scene } from '../render/scene.ts'
import { num } from './common.ts'
import type { PartDef } from './types.ts'

export interface Hole {
  pos: Vec
  strip: string
}

// Row layout in grid units from the board origin.
const RAIL_TOP = [0, 1]
const ROWS_TOP = [3, 4, 5, 6, 7] // letters j..f (top half)
const ROWS_BOTTOM = [10, 11, 12, 13, 14] // letters e..a (bottom half)
const RAIL_BOTTOM = [16, 17]
const BOARD_H = 19

export function boardCols(p: PartInstance): number {
  return num(p, 'cols', 30)
}

/** All holes in world px with their electrical strip id. Boards never rotate. */
export function boardHoles(p: PartInstance): Hole[] {
  const cols = boardCols(p)
  const out: Hole[] = []
  const at = (cx: number, cy: number, strip: string) => out.push({ pos: { x: p.x + cx * G, y: p.y + cy * G }, strip: `${p.id}/${strip}` })
  for (let i = 0; i < cols; i++) {
    RAIL_TOP.forEach((r, k) => at(i, r, `rt${k}`))
    RAIL_BOTTOM.forEach((r, k) => at(i, r, `rb${k}`))
    for (const r of ROWS_TOP) at(i, r, `t${i}`)
    for (const r of ROWS_BOTTOM) at(i, r, `b${i}`)
  }
  return out
}

const HOLE_ROWS = new Set([...RAIL_TOP, ...ROWS_TOP, ...ROWS_BOTTOM, ...RAIL_BOTTOM])

/** Hole position near a world point, if any (arithmetic, no scan). */
export function holeNear(p: PartInstance, w: Vec, tol: number): Vec | null {
  const col = Math.round((w.x - p.x) / G)
  const row = Math.round((w.y - p.y) / G)
  if (col < 0 || col >= boardCols(p) || !HOLE_ROWS.has(row)) return null
  const pos = { x: p.x + col * G, y: p.y + row * G }
  return Math.hypot(pos.x - w.x, pos.y - w.y) <= tol ? pos : null
}

function board(type: string, name: string, cols: number): PartDef {
  return {
    type,
    name,
    category: 'board',
    blurb: 'Holes in each column of five are connected. The two long rails run the full length.',
    fixedRot: true,
    pinLabels: [],
    defaults: () => ({ cols }),
    pins: () => [],
    bounds: (p) => ({ x: -G, y: -G, w: (boardCols(p) + 1) * G, h: BOARD_H * G }),
    build() {},
    evaluate: () => ({ live: {} }),
    draw(c, p) {
      const cols = boardCols(p)
      const w = (cols + 1) * G
      const h = BOARD_H * G
      // shadow + body
      c.fillStyle = '#9d9884'
      rrect(c, -G, -G + 4, w, h, 6)
      c.fill()
      c.fillStyle = '#d4cfbd'
      rrect(c, -G, -G, w, h, 6)
      c.fill()
      c.strokeStyle = COL.cyan
      c.globalAlpha = 0.5
      c.lineWidth = 1
      rrect(c, -G + 0.5, -G + 0.5, w - 1, h - 1, 6)
      c.stroke()
      c.globalAlpha = 1
      // center channel
      c.fillStyle = '#b3ae9b'
      c.fillRect(-G + 6, 8.5 * G - 8, w - 12, 16)
      c.fillStyle = '#8f8a77'
      c.fillRect(-G + 6, 8.5 * G - 8, w - 12, 2)
      // rail stripes
      const stripe = (row: number, color: string) => {
        c.fillStyle = color
        c.fillRect(-G + 8, row * G - 11, w - 16, 2)
      }
      stripe(0, '#d83a3a')
      stripe(1, '#2f63d8')
      stripe(16, '#d83a3a')
      stripe(17, '#2f63d8')
      drawText(c, '+', -G + 6, 0 * G - 4, { color: '#d83a3a' })
      drawText(c, '-', -G + 6, 1 * G - 4, { color: '#2f63d8' })
      drawText(c, '+', -G + 6, 16 * G - 4, { color: '#d83a3a' })
      drawText(c, '-', -G + 6, 17 * G - 4, { color: '#2f63d8' })
      // column numbers + row letters
      for (let i = 0; i < cols; i++) {
        if ((i + 1) % 5 === 0 || i === 0) {
          drawText(c, String(i + 1), i * G, 2.2 * G - 9, { color: '#7d7966', align: 'center' })
          drawText(c, String(i + 1), i * G, 15.0 * G - 9 + 10, { color: '#7d7966', align: 'center' })
        }
      }
      const letters = ['J', 'I', 'H', 'G', 'F', 'E', 'D', 'C', 'B', 'A']
      const rows = [...ROWS_TOP, ...ROWS_BOTTOM]
      rows.forEach((r, k) => drawText(c, letters[k], -G + 6, r * G - 4, { color: '#7d7966' }))
      // holes
      for (const hole of boardHoles(p)) {
        const x = hole.pos.x - p.x
        const y = hole.pos.y - p.y
        const used = scene.used.has(pointKey(hole.pos))
        c.fillStyle = used ? '#ffffff' : '#2b2a33'
        c.fillRect(x - 3.5, y - 3.5, 7, 7)
        if (!used) {
          c.fillStyle = '#4c4a59'
          c.fillRect(x - 3.5, y + 2, 7, 1.5)
        }
      }
    },
    fields: () => [],
    summary: () => `${cols} columns, 2 power rails each side`,
  }
}

export const breadboardFull = board('breadboard', 'Breadboard (830)', 30)
export const breadboardMini = board('breadboard-mini', 'Breadboard (mini)', 17)
