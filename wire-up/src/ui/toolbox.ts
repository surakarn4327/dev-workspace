import { ALL_PARTS, CATEGORY_LABELS, newPart } from '../parts/index.ts'
import type { Category, PartDef } from '../parts/types.ts'
import { COL } from '../render/draw.ts'
import type { Workspace } from './workspace.ts'

/** An empty drag image, so the browser shows nothing of the toolbox card while dragging. */
const BLANK = document.createElement('canvas')
BLANK.width = 1
BLANK.height = 1

function icon(def: PartDef): HTMLCanvasElement {
  const W = 92
  const H = 64
  const dpr = 2
  const cv = document.createElement('canvas')
  cv.width = W * dpr
  cv.height = H * dpr
  const c = cv.getContext('2d')!
  const part = newPart('icon', def.type, 0, 0)
  const b = def.bounds(part)
  const s = Math.min((W - 10) / b.w, (H - 10) / b.h, 0.9)
  c.setTransform(dpr * s, 0, 0, dpr * s, dpr * (W / 2 - (b.x + b.w / 2) * s), dpr * (H / 2 - (b.y + b.h / 2) * s))
  c.imageSmoothingEnabled = false
  def.draw(c, part, {}, 0)
  c.fillStyle = COL.bg
  return cv
}

export function buildToolbox(ws: Workspace, tabsEl: HTMLElement, itemsEl: HTMLElement): void {
  let active: Category = 'power'
  const render = () => {
    tabsEl.innerHTML = ''
    for (const [cat, label] of CATEGORY_LABELS) {
      const b = document.createElement('button')
      b.textContent = label
      b.className = cat === active ? 'active' : ''
      b.onclick = () => {
        active = cat
        render()
      }
      tabsEl.appendChild(b)
    }
    itemsEl.innerHTML = ''
    for (const def of ALL_PARTS.filter((d) => d.category === active)) {
      const el = document.createElement('div')
      el.className = 'tool'
      el.draggable = true
      el.title = def.blurb
      el.appendChild(icon(def))
      const nm = document.createElement('div')
      nm.className = 'nm'
      nm.textContent = def.name
      el.appendChild(nm)
      el.addEventListener('dragstart', (e) => {
        ws.draggingType = def.type
        e.dataTransfer?.setData('text/plain', def.type)
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'copy'
          // no toolbox card under the pointer: the part itself follows it (the canvas draws it, snapped to the grid)
          e.dataTransfer.setDragImage(BLANK, 0, 0)
        }
      })
      el.addEventListener('dragend', () => {
        ws.draggingType = null
      })
      el.addEventListener('click', () => ws.addPart(def.type))
      itemsEl.appendChild(el)
    }
  }
  render()
}
