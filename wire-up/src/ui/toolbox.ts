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
  let active: Category | 'all' = 'all'
  let query = ''
  const labelOf = new Map(CATEGORY_LABELS)

  // search box between the tabs and the list: it looks through every category, whichever tab is open
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
    tabsEl.innerHTML = ''
    const tabs: [Category | 'all', string][] = [['all', 'All'], ...CATEGORY_LABELS]
    for (const [cat, label] of tabs) {
      const b = document.createElement('button')
      b.textContent = label
      b.className = !searching && cat === active ? 'active' : ''
      b.onclick = () => {
        active = cat
        query = ''
        search.value = ''
        render()
      }
      tabsEl.appendChild(b)
    }
    itemsEl.innerHTML = ''
    const shown = searching ? ALL_PARTS.filter((d) => matches(d, words)) : ALL_PARTS.filter((d) => active === 'all' || d.category === active)
    if (searching && shown.length === 0) {
      const none = document.createElement('div')
      none.className = 'tool-none'
      none.textContent = 'No parts match.'
      itemsEl.appendChild(none)
    }
    for (const def of shown) {
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
