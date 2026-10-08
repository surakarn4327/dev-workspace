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

export function buildToolbox(ws: Workspace, itemsEl: HTMLElement): void {
  let query = ''
  const labelOf = new Map(CATEGORY_LABELS)
  const order = CATEGORY_LABELS.map(([cat]) => cat)
  const catRank = (c: Category): number => order.indexOf(c)

  // search box above the list: it filters the whole list, every category at once
  const search = document.createElement('input')
  search.type = 'search'
  search.id = 'tool-search'
  search.placeholder = 'Search all parts'
  search.autocomplete = 'off'
  search.spellcheck = false
  search.addEventListener('input', () => {
    query = search.value
    render()
  })
  search.addEventListener('keydown', (e) => {
    e.stopPropagation() // typing here must not trigger canvas shortcuts (W, R, F, Del...)
    if (e.key === 'Escape') {
      search.value = ''
      query = ''
      search.blur()
      render()
    }
  })
  itemsEl.parentElement?.insertBefore(search, itemsEl)

  const matches = (d: PartDef, words: string[]): boolean => {
    const hay = `${d.name} ${d.type} ${d.blurb} ${labelOf.get(d.category) ?? ''}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  }

  const render = () => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    const searching = words.length > 0
    itemsEl.innerHTML = ''
    const shown = ALL_PARTS.filter((d) => !searching || matches(d, words))
    if (searching && shown.length === 0) {
      const none = document.createElement('div')
      none.className = 'tool-none'
      none.textContent = 'No parts match.'
      itemsEl.appendChild(none)
    }
    let lastCat: Category | null = null
    for (const def of shown.slice().sort((x, y) => catRank(x.category) - catRank(y.category))) {
      // one divider line with the category name above each group
      if (def.category !== lastCat) {
        lastCat = def.category
        const head = document.createElement('div')
        head.className = 'tool-cat'
        head.textContent = labelOf.get(def.category) ?? def.category
        itemsEl.appendChild(head)
      }
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
