import { WIRE_COLORS } from '../board/world.ts'
import { defOf } from '../parts/index.ts'
import type { Field } from '../parts/types.ts'
import { eng } from '../sim/models.ts'
import type { Workspace } from './workspace.ts'

const READOUTS: Record<string, [string, string]> = {
  i: ['Current', 'A'],
  v: ['Voltage', 'V'],
  p: ['Power', 'W'],
  pd: ['Dissipation', 'W'],
  ic: ['Collector current', 'A'],
  ib: ['Base current', 'A'],
  vce: ['Vce', 'V'],
  vbe: ['Vbe', 'V'],
  r: ['Resistance now', 'Ω'],
  i1: ['Current (1-W)', 'A'],
  i2: ['Current (W-2)', 'A'],
  vw: ['Wiper to 2', 'V'],
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
}

export class Inspector {
  private readouts: HTMLElement | null = null
  private builtFor = ''
  private lastLogLen = -1

  private ws: Workspace
  private root: HTMLElement

  constructor(ws: Workspace, root: HTMLElement) {
    this.ws = ws
    this.root = root
  }

  rebuild(): void {
    const ws = this.ws
    const part = ws.selectedPart ? ws.world.getPart(ws.selectedPart) : undefined
    const wire = ws.selectedWire ? ws.world.getWire(ws.selectedWire) : undefined
    this.root.innerHTML = ''
    this.readouts = null
    this.builtFor = ''
    if (part) {
      const def = defOf(part.type)
      this.builtFor = `${part.id}|${part.state.failed}|${JSON.stringify(part.params)}`
      const h = document.createElement('div')
      h.innerHTML = `<h3>${esc(def.name)}</h3><div class="sub">${esc(def.summary(part))}<br>${esc(def.blurb)}</div>`
      this.root.appendChild(h)
      if (part.state.failed) {
        const f = document.createElement('div')
        f.className = 'failbox'
        f.innerHTML = `<b>BURNT OUT.</b> ${esc(part.state.failMsg)}`
        this.root.appendChild(f)
      }
      this.readouts = document.createElement('div')
      this.readouts.className = 'readouts'
      this.root.appendChild(this.readouts)
      for (const f of def.fields(part)) this.root.appendChild(this.fieldEl(part.id, f))
      const row = document.createElement('div')
      row.className = 'row'
      if (!def.fixedRot) row.appendChild(this.btn('Rotate (R)', () => ws.rotateSelected()))
      if (part.state.failed || part.state.heat > 0.05) {
        row.appendChild(
          this.btn(part.type === 'meter' ? 'Replace fuse' : 'Replace part', () => {
            ws.sim.replace(part.id)
            this.rebuild()
            ws.onEdit()
          }),
        )
      }
      row.appendChild(this.btn('Delete', () => ws.deleteSelected()))
      this.root.appendChild(row)
      this.update()
    } else if (wire) {
      const h = document.createElement('div')
      h.innerHTML = '<h3>Wire</h3><div class="sub">Drag an end to stretch it, drag a corner or the middle handle to reshape it.</div>'
      this.root.appendChild(h)
      const sw = document.createElement('div')
      sw.className = 'swatches'
      for (const col of WIRE_COLORS) {
        const b = document.createElement('button')
        b.className = `swatch${col === wire.color ? ' sel' : ''}`
        b.style.background = col
        b.onclick = () => {
          wire.color = col
          ws.world.commit()
          ws.onEdit()
          this.rebuild()
        }
        sw.appendChild(b)
      }
      this.root.appendChild(sw)
      this.root.appendChild(this.btn('Delete wire', () => ws.deleteSelected()))
    } else if (ws.groupSize() > 0) {
      const np = ws.group.parts.size
      const nw = ws.group.wires.size
      const h = document.createElement('div')
      const what = [np > 0 ? `${np} part${np === 1 ? '' : 's'}` : '', nw > 0 ? `${nw} wire${nw === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ')
      h.innerHTML = `<h3>${what} selected</h3><div class="sub">Drag any of them to move the lot. Arrow keys nudge one grid step. Ctrl+click adds or removes one. Ctrl+C / Ctrl+V copy and paste, Ctrl+D duplicates, Delete removes.</div>`
      this.root.appendChild(h)
      const row = document.createElement('div')
      row.className = 'row'
      row.appendChild(this.btn('Duplicate (Ctrl+D)', () => ws.duplicateSelected()))
      row.appendChild(this.btn('Delete', () => ws.deleteSelected()))
      this.root.appendChild(row)
    } else {
      this.root.innerHTML = '<h3>Nothing selected</h3><div class="sub">Click a part to see its live voltage, current and settings. Drag parts in from the toolbox on the left.</div>'
    }
    this.lastLogLen = -1
    this.renderLog()
  }

  private btn(label: string, fn: () => void): HTMLButtonElement {
    const b = document.createElement('button')
    b.textContent = label
    b.onclick = fn
    return b
  }

  private fieldEl(partId: string, f: Field): HTMLElement {
    const ws = this.ws
    const part = ws.world.getPart(partId)!
    const wrap = document.createElement('div')
    wrap.className = 'field'
    const label = document.createElement('label')
    const name = document.createElement('span')
    name.textContent = f.label
    const val = document.createElement('span')
    val.className = 'val'
    label.append(name, val)
    wrap.appendChild(label)
    const set = (v: number | string | boolean, commit: boolean) => {
      part.params[f.key] = v
      if (commit) {
        ws.world.commit()
        ws.onEdit()
        this.rebuild()
      } else {
        ws.world.touch()
      }
    }
    if (f.kind === 'select') {
      const sel = document.createElement('select')
      for (const o of f.options) {
        const op = document.createElement('option')
        op.value = String(o.value)
        op.textContent = o.label
        sel.appendChild(op)
      }
      sel.value = String(part.params[f.key])
      sel.onchange = () => {
        const raw = f.options.find((o) => String(o.value) === sel.value)!.value
        set(raw, true)
      }
      wrap.appendChild(sel)
    } else if (f.kind === 'toggle') {
      const b = document.createElement('button')
      const on = part.params[f.key] === true
      b.textContent = on ? 'ON' : 'OFF'
      b.className = on ? 'on' : ''
      b.onclick = () => set(!on, true)
      wrap.appendChild(b)
    } else {
      const r = document.createElement('input')
      r.type = 'range'
      const cur = Number(part.params[f.key])
      const toPos = (v: number) => (f.log ? (Math.log(v) - Math.log(f.min)) / (Math.log(f.max) - Math.log(f.min)) : (v - f.min) / (f.max - f.min))
      const fromPos = (p: number) => (f.log ? Math.exp(Math.log(f.min) + p * (Math.log(f.max) - Math.log(f.min))) : f.min + p * (f.max - f.min))
      r.min = '0'
      r.max = '1000'
      r.value = String(Math.round(toPos(Math.max(cur, f.min)) * 1000))
      const show = (v: number) => {
        val.textContent = f.unit ? eng(v, f.unit, 3) : f.key === 'pos' ? `${(v * 100).toFixed(0)}%` : String(Number(v.toFixed(3)))
      }
      show(cur)
      r.oninput = () => {
        let v = fromPos(Number(r.value) / 1000)
        v = f.log ? v : Math.round(v / f.step) * f.step
        v = Math.min(Math.max(Number(v.toPrecision(4)), f.min), f.max)
        show(v)
        set(v, false)
      }
      r.onchange = () => {
        ws.world.commit()
        ws.onEdit()
      }
      wrap.appendChild(r)
    }
    if (f.kind === 'select') val.textContent = ''
    return wrap
  }

  /** Refresh live numbers (called a few times a second). */
  update(): void {
    const ws = this.ws
    const part = ws.selectedPart ? ws.world.getPart(ws.selectedPart) : undefined
    if (part) {
      const key = `${part.id}|${part.state.failed}|${JSON.stringify(part.params)}`
      if (key !== this.builtFor && !this.root.contains(document.activeElement)) {
        this.rebuild()
        return
      }
      if (this.readouts) {
        const live = ws.sim.live.get(part.id) ?? {}
        let html = ''
        for (const [k, v] of Object.entries(live)) {
          const info = READOUTS[k]
          if (!info) continue
          html += `<span>${info[0]}</span><span class="v">${eng(v, info[1])}</span>`
        }
        if (part.state.heat > 0.02 && !part.state.failed) html += `<span>Stress</span><span class="v" style="color:var(--amber)">${(part.state.heat * 100).toFixed(0)}%</span>`
        this.readouts.innerHTML = html || '<span>No readings</span><span></span>'
      }
    }
    this.renderLog()
  }

  private renderLog(): void {
    const log = this.ws.sim.log
    if (log.length === this.lastLogLen) return
    this.lastLogLen = log.length
    this.root.querySelector('.log')?.remove()
    if (log.length === 0) return
    const el = document.createElement('div')
    el.className = 'log'
    el.innerHTML =
      '<div><b>Incidents</b></div>' +
      log
        .slice(-5)
        .reverse()
        .map((l) => `<div><b>${esc(l.partName)}:</b> ${esc(l.message)}</div>`)
        .join('')
    this.root.appendChild(el)
  }
}
