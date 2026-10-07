// The interactive canvas: pan/zoom, drag parts, draw wires, keyboard shortcuts, main loop.

import { hitTest } from '../board/hit.ts'
import type { Hit } from '../board/hit.ts'
import { routeVia } from '../board/router.ts'
import { Simulation } from '../board/simulation.ts'
import { moveBend } from '../board/wireEdit.ts'
import { G, snap, unrotVec, WIRE_COLORS } from '../board/world.ts'
import type { PartInstance, Vec, World, Wire } from '../board/world.ts'
import { defOf, newPart, rotatePart } from '../parts/index.ts'
import { Renderer } from '../render/renderer.ts'
import type { Overlay, View } from '../render/renderer.ts'

type Mode =
  | { t: 'pan'; sx: number; sy: number; camX: number; camY: number }
  | { t: 'part'; part: PartInstance; grab: Vec; x0: number; y0: number; leads0: Vec[] | null; moved: boolean; local: Vec; sx: number; sy: number; pressing: boolean }
  | { t: 'lead'; part: PartInstance; index: number }
  | { t: 'wireEnd'; wire: Wire; end: 'a' | 'b' }
  | { t: 'bend'; wire: Wire; index: number; via0: Vec[] }
  | { t: 'wire'; wire: Wire; grab: Vec; a0: Vec; b0: Vec; via0: Vec[]; moved: boolean }
  | { t: 'newWire'; a: Vec; b: Vec; via: Vec[]; clickWire?: string }

/** How long the pointer must rest on a part before its value labels appear. */
const HOVER_LABEL_MS = 1000

export interface HoverInfo {
  text: string
}

export class Workspace {
  readonly renderer: Renderer
  readonly sim: Simulation
  view: View = { camX: -60, camY: -60, zoom: 1 }
  selectedPart: string | null = null
  selectedWire: string | null = null
  wireMode = false
  /** Called when selection or any user edit happens. */
  onSelect: () => void = () => {}
  onEdit: () => void = () => {}
  onHover: (info: HoverInfo) => void = () => {}
  onFrame: (dt: number) => void = () => {}
  draggingType: string | null = null

  private mode: Mode | null = null
  private space = false
  private hoverPart: string | null = null
  private hoverSince = 0
  private hoverPoint: Vec | null = null
  private ghost: { type: string; x: number; y: number } | null = null
  private last = performance.now()
  private time = 0
  private paused = false

  readonly canvas: HTMLCanvasElement
  readonly world: World

  constructor(canvas: HTMLCanvasElement, world: World) {
    this.canvas = canvas
    this.world = world
    this.renderer = new Renderer(canvas)
    this.sim = new Simulation(world)
    this.bind()
    this.renderer.resize()
    new ResizeObserver(() => {
      this.renderer.resize()
      this.redrawNow()
    }).observe(canvas)
    requestAnimationFrame((t) => this.frame(t))
  }

  // ------------------------------------------------------------ main loop

  private frame(t: number): void {
    const dt = Math.min((t - this.last) / 1000, 0.05)
    this.last = t
    if (!this.paused) {
      this.time += dt
      this.sim.step(dt)
    }
    this.renderer.update(dt, this.world, this.sim, this.time)
    this.renderer.draw(this.world, this.sim, this.view, this.overlay(), this.time)
    this.onFrame(dt)
    requestAnimationFrame((n) => this.frame(n))
  }

  /** Draw one frame immediately (resizing a canvas clears it; waiting for the next frame shows a black flash). */
  private redrawNow(): void {
    this.renderer.draw(this.world, this.sim, this.view, this.overlay(), this.time)
  }

  private overlay(): Overlay {
    const m = this.mode
    return {
      selectedPart: this.selectedPart,
      selectedWire: this.selectedWire,
      hoverPart: this.hoverPart,
      labelPart: this.hoverPart && performance.now() - this.hoverSince >= HOVER_LABEL_MS ? this.hoverPart : null,
      hoverPoint: this.hoverPoint,
      draft: m && m.t === 'newWire' ? [m.a, ...m.via, m.b] : null,
      ghost: this.ghost,
      wireMode: this.wireMode,
    }
  }

  // ------------------------------------------------------------ helpers

  private world2(e: { clientX: number; clientY: number }): Vec {
    const r = this.canvas.getBoundingClientRect()
    return this.renderer.toWorld(this.view, e.clientX - r.left, e.clientY - r.top)
  }

  private othersOf(w: Wire): Wire[] {
    return this.world.wires.filter((x) => x !== w)
  }

  private snapPt(p: Vec): Vec {
    return { x: snap(p.x), y: snap(p.y) }
  }

  select(part: string | null, wire: string | null = null): void {
    if (this.selectedPart === part && this.selectedWire === wire) return
    this.selectedPart = part
    this.selectedWire = wire
    this.onSelect()
  }

  centerOfView(): Vec {
    return this.renderer.toWorld(this.view, this.renderer.width / 2, this.renderer.height / 2)
  }

  fitView(): void {
    const w = this.world
    if (w.parts.length === 0 && w.wires.length === 0) {
      this.view = { camX: -80, camY: -80, zoom: 1 }
      return
    }
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const p of w.parts) {
      const b = defOf(p.type).bounds(p)
      x0 = Math.min(x0, p.x + b.x)
      y0 = Math.min(y0, p.y + b.y)
      x1 = Math.max(x1, p.x + b.x + b.w)
      y1 = Math.max(y1, p.y + b.y + b.h)
      for (const l of p.leads ?? []) {
        x0 = Math.min(x0, l.x)
        y0 = Math.min(y0, l.y)
        x1 = Math.max(x1, l.x)
        y1 = Math.max(y1, l.y)
      }
    }
    const pad = 60
    const zw = this.renderer.width / (x1 - x0 + pad * 2)
    const zh = this.renderer.height / (y1 - y0 + pad * 2)
    const zoom = Math.min(Math.max(Math.min(zw, zh), 0.3), 1.4)
    this.view = {
      zoom,
      camX: (x0 + x1) / 2 - this.renderer.width / zoom / 2,
      camY: (y0 + y1) / 2 - this.renderer.height / zoom / 2,
    }
  }

  setPaused(p: boolean): void {
    this.paused = p
  }

  get isPaused(): boolean {
    return this.paused
  }

  // ------------------------------------------------------------ editing API

  addPart(type: string, at?: Vec): PartInstance {
    const def = defOf(type)
    const b = def.bounds({ ...newPart('tmp', type, 0, 0) })
    const c = at ?? this.centerOfView()
    const part = newPart(this.world.nextId('p'), type, c.x - (b.x + b.w / 2), c.y - (b.y + b.h / 2))
    if (def.freeLeads) part.leads = def.pins(part).map((v) => ({ x: part.x + v.x * G, y: part.y + v.y * G }))
    if (type.startsWith('breadboard')) this.world.parts.unshift(part)
    else this.world.parts.push(part)
    this.world.commit()
    this.select(part.id)
    this.onEdit()
    return part
  }

  deleteSelected(): void {
    if (this.selectedPart) this.world.removePart(this.selectedPart)
    else if (this.selectedWire) this.world.removeWire(this.selectedWire)
    else return
    this.selectedPart = null
    this.selectedWire = null
    this.world.commit()
    this.onSelect()
    this.onEdit()
  }

  rotateSelected(): void {
    const p = this.selectedPart ? this.world.getPart(this.selectedPart) : undefined
    if (!p) return
    rotatePart(p)
    this.world.commit()
    this.onEdit()
  }

  setWireMode(on: boolean): void {
    this.wireMode = on
    this.canvas.style.cursor = on ? 'crosshair' : 'default'
    this.onSelect()
  }

  // ------------------------------------------------------------ events

  private bind(): void {
    const cv = this.canvas
    cv.addEventListener('pointerdown', (e) => this.down(e))
    cv.addEventListener('pointermove', (e) => this.move(e))
    cv.addEventListener('pointerup', (e) => this.up(e))
    cv.addEventListener('pointercancel', (e) => this.up(e))
    cv.addEventListener('pointerleave', () => {
      this.hoverPoint = null
      this.hoverPart = null
    })
    cv.addEventListener('contextmenu', (e) => e.preventDefault())
    cv.addEventListener('wheel', (e) => this.wheel(e), { passive: false })
    cv.addEventListener('dragover', (e) => {
      if (!this.draggingType) return
      e.preventDefault()
      const p = this.dropPoint(e, this.draggingType)
      this.ghost = { type: this.draggingType, x: p.x, y: p.y }
    })
    cv.addEventListener('dragleave', () => {
      this.ghost = null
    })
    cv.addEventListener('drop', (e) => {
      e.preventDefault()
      const type = this.draggingType
      this.ghost = null
      this.draggingType = null
      if (!type) return
      const w = this.world2(e)
      this.addPart(type, w)
    })
    window.addEventListener('keydown', (e) => this.key(e, true))
    window.addEventListener('keyup', (e) => this.key(e, false))
  }

  private dropPoint(e: DragEvent, type: string): Vec {
    const w = this.world2(e)
    const tmp = newPart('tmp', type, 0, 0)
    const b = defOf(type).bounds(tmp)
    return this.snapPt({ x: w.x - (b.x + b.w / 2), y: w.y - (b.y + b.h / 2) })
  }

  private down(e: PointerEvent): void {
    this.canvas.setPointerCapture(e.pointerId)
    const w = this.world2(e)
    if (e.button === 1 || e.button === 2 || this.space) {
      this.mode = { t: 'pan', sx: e.clientX, sy: e.clientY, camX: this.view.camX, camY: this.view.camY }
      return
    }
    if (e.button !== 0) return
    const hit = hitTest(this.world, w, this.view.zoom, this.selectedWire)

    if (hit.kind === 'lead') {
      this.select(hit.part.id)
      this.mode = { t: 'lead', part: hit.part, index: hit.index }
      return
    }
    if (hit.kind === 'wireEnd') {
      this.mode = { t: 'wireEnd', wire: hit.wire, end: hit.end }
      return
    }
    if (hit.kind === 'bend') {
      this.mode = { t: 'bend', wire: hit.wire, index: hit.index, via0: hit.wire.via.map((v) => ({ ...v })) }
      return
    }
    if (this.wireMode && hit.kind !== 'wire') {
      const a = hit.kind === 'pin' || hit.kind === 'hole' ? hit.point : this.snapPt(w)
      this.mode = { t: 'newWire', a, b: a, via: [] }
      return
    }
    switch (hit.kind) {
      case 'pin':
      case 'hole':
        this.mode = { t: 'newWire', a: hit.point, b: hit.point, via: [] }
        this.select(null)
        return
      case 'wire': {
        // a wire passing over a hole or pin: dragging pulls a new wire, a plain click selects the wire
        const under = hitTest(this.world, w, this.view.zoom, null, true)
        if ((under.kind === 'pin' || under.kind === 'hole') && this.selectedWire !== hit.wire.id) {
          this.mode = { t: 'newWire', a: under.point, b: under.point, via: [], clickWire: hit.wire.id }
          return
        }
        this.select(null, hit.wire.id)
        this.mode = { t: 'wire', wire: hit.wire, grab: w, a0: { ...hit.wire.a }, b0: { ...hit.wire.b }, via0: hit.wire.via.map((v) => ({ ...v })), moved: false }
        return
      }
      case 'part':
      case 'board': {
        const part = hit.part
        this.select(part.id)
        let pressing = false
        const def = defOf(part.type)
        if (def.press && hit.kind === 'part') {
          pressing = def.press(part, true)
          if (pressing) this.world.touch()
        }
        this.mode = {
          t: 'part',
          part,
          grab: w,
          x0: part.x,
          y0: part.y,
          leads0: part.leads ? part.leads.map((l) => ({ ...l })) : null,
          moved: false,
          local: hit.local,
          sx: e.clientX,
          sy: e.clientY,
          pressing,
        }
        return
      }
      default:
        this.select(null)
        this.mode = { t: 'pan', sx: e.clientX, sy: e.clientY, camX: this.view.camX, camY: this.view.camY }
    }
  }

  private move(e: PointerEvent): void {
    const w = this.world2(e)
    const m = this.mode
    if (!m) {
      this.hover(w)
      return
    }
    switch (m.t) {
      case 'pan':
        this.view.camX = m.camX - (e.clientX - m.sx) / this.view.zoom
        this.view.camY = m.camY - (e.clientY - m.sy) / this.view.zoom
        break
      case 'part': {
        if (!m.moved && Math.hypot(e.clientX - m.sx, e.clientY - m.sy) < 4) return
        if (m.pressing) return
        m.moved = true
        const nx = snap(m.x0 + (w.x - m.grab.x))
        const ny = snap(m.y0 + (w.y - m.grab.y))
        const dx = nx - m.x0
        const dy = ny - m.y0
        m.part.x = nx
        m.part.y = ny
        if (m.leads0 && m.part.leads) m.part.leads = m.leads0.map((l) => ({ x: l.x + dx, y: l.y + dy }))
        this.world.touch()
        break
      }
      case 'lead': {
        const s = this.snapPt(w)
        m.part.leads![m.index] = s
        this.hoverPoint = s
        this.world.touch()
        break
      }
      case 'bend': {
        const s = this.snapPt(w)
        m.wire.via = moveBend(m.wire.a, m.via0, m.wire.b, m.index, s)
        this.hoverPoint = s
        this.world.touch()
        break
      }
      case 'wireEnd': {
        const s = this.snapPt(w)
        m.wire[m.end] = s
        m.wire.via = routeVia(m.wire.a, m.wire.b, this.othersOf(m.wire))
        this.hoverPoint = s
        this.world.touch()
        break
      }
      case 'wire': {
        const dx = snap(w.x - m.grab.x)
        const dy = snap(w.y - m.grab.y)
        if (dx !== 0 || dy !== 0) m.moved = true
        m.wire.a = { x: m.a0.x + dx, y: m.a0.y + dy }
        m.wire.b = { x: m.b0.x + dx, y: m.b0.y + dy }
        m.wire.via = m.via0.map((v) => ({ x: v.x + dx, y: v.y + dy }))
        this.world.touch()
        break
      }
      case 'newWire': {
        const hit = hitTest(this.world, w, this.view.zoom, null)
        const nb = hit.kind === 'pin' || hit.kind === 'hole' ? hit.point : this.snapPt(w)
        if (nb.x !== m.b.x || nb.y !== m.b.y) {
          m.b = nb
          m.via = routeVia(m.a, m.b, this.world.wires)
        }
        this.hoverPoint = m.b
        break
      }
    }
  }

  private up(e: PointerEvent): void {
    const m = this.mode
    this.mode = null
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId)
    if (!m) return
    switch (m.t) {
      case 'part': {
        const def = defOf(m.part.type)
        if (m.pressing && def.press) {
          def.press(m.part, false)
          this.world.touch()
        } else if (m.moved) {
          this.world.commit()
          this.onEdit()
        } else if (def.click && def.click(m.part, m.local)) {
          this.world.commit()
          this.onEdit()
          this.onSelect()
        }
        break
      }
      case 'lead':
      case 'wireEnd':
      case 'bend':
        this.world.commit()
        this.onEdit()
        break
      case 'wire':
        if (m.moved) {
          this.world.commit()
          this.onEdit()
        }
        break
      case 'newWire':
        if (m.a.x !== m.b.x || m.a.y !== m.b.y) {
          const color = WIRE_COLORS[this.world.wires.length % 4]
          const wire = this.world.addWire(m.a, m.b, color, m.via)
          this.world.commit()
          this.select(null, wire.id)
          this.onEdit()
        } else if (m.clickWire) {
          this.select(null, m.clickWire)
        }
        break
      case 'pan':
        break
    }
    this.hoverPoint = null
  }

  private hover(w: Vec): void {
    const hit = hitTest(this.world, w, this.view.zoom, this.selectedWire)
    this.hoverPoint = null
    const prevHover = this.hoverPart
    this.hoverPart = null
    let cursor = this.wireMode ? 'crosshair' : 'default'
    let text = ''
    const point = (p: Vec): string => {
      const n = this.sim.net.nodeAt(p)
      const res = this.sim.result
      if (n === undefined || !res) return 'floating (nothing connected)'
      return `net ${n === 0 ? 'GND (reference)' : n}: ${res.v[n].toFixed(3)} V`
    }
    switch (hit.kind) {
      case 'lead':
        this.hoverPoint = hit.point
        this.hoverPart = hit.part.id
        cursor = 'grab'
        text = `${defOf(hit.part.type).pinLabels[hit.index]} lead, drag to move. ${point(hit.point)}`
        break
      case 'wireEnd':
        this.hoverPoint = hit.point
        cursor = 'grab'
        text = `Wire end, drag to move. ${point(hit.point)}`
        break
      case 'bend':
        this.hoverPoint = hit.point
        cursor = 'grab'
        text = 'Wire corner: drag to reshape the wire.'
        break
      case 'pin':
        this.hoverPoint = hit.point
        this.hoverPart = hit.part.id
        cursor = 'crosshair'
        text = `${defOf(hit.part.type).name} pin ${defOf(hit.part.type).pinLabels[hit.index]}: drag to wire. ${point(hit.point)}`
        break
      case 'hole':
        this.hoverPoint = hit.point
        cursor = 'crosshair'
        text = `Breadboard hole: drag to wire. ${point(hit.point)}`
        break
      case 'wire':
        cursor = 'move'
        text = 'Wire: click to select, drag to move, Delete to remove.'
        break
      case 'part': {
        this.hoverPart = hit.part.id
        cursor = 'move'
        const d = defOf(hit.part.type)
        text = `${d.name}: ${d.summary(hit.part)}`
        break
      }
      case 'board':
        cursor = 'move'
        text = 'Breadboard: drag to move.'
        break
      default:
        cursor = this.wireMode ? 'crosshair' : 'grab'
    }
    if (this.hoverPart !== prevHover) this.hoverSince = performance.now()
    this.canvas.style.cursor = cursor
    this.onHover({ text })
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault()
    const w = this.world2(e)
    if (e.shiftKey) {
      const hit = hitTest(this.world, w, this.view.zoom, this.selectedWire)
      if (hit.kind === 'part' || hit.kind === 'pin') {
        const part = hit.part
        const def = defOf(part.type)
        const f = def.fields(part).find((x) => x.kind === 'range' && x.key === def.wheelKey)
        if (f && f.kind === 'range') {
          const cur = Number(part.params[f.key] ?? f.min)
          const dir = e.deltaY < 0 ? 1 : -1
          let next: number
          if (f.log) next = cur * (dir > 0 ? 1.25 : 0.8)
          else next = cur + dir * (f.max - f.min) / 50
          part.params[f.key] = Math.min(Math.max(Number(next.toFixed(3)), f.min), f.max)
          this.world.commit()
          this.onEdit()
          this.onSelect()
        }
        return
      }
    }
    const r = this.canvas.getBoundingClientRect()
    const sx = e.clientX - r.left
    const sy = e.clientY - r.top
    const before = this.renderer.toWorld(this.view, sx, sy)
    const z = Math.min(Math.max(this.view.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 0.25), 3)
    this.view.zoom = z
    this.view.camX = before.x - sx / z
    this.view.camY = before.y - sy / z
  }

  private key(e: KeyboardEvent, down: boolean): void {
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return
    if (e.code === 'Space') {
      this.space = down
      if (down) e.preventDefault()
      return
    }
    if (!down) return
    const k = e.key.toLowerCase()
    if (k === 'delete' || k === 'backspace') {
      this.deleteSelected()
      e.preventDefault()
    } else if (k === 'r' && !e.ctrlKey && !e.metaKey) {
      this.rotateSelected()
    } else if (k === 'w' && !e.ctrlKey && !e.metaKey) {
      this.setWireMode(!this.wireMode)
    } else if (k === 'escape') {
      this.mode = null
      this.setWireMode(false)
      this.select(null)
    } else if (k === 'f' && !e.ctrlKey && !e.metaKey) {
      this.fitView()
    }
  }

  /** Pixel position of the tip of a part's pin, relative to the canvas, for tests and tools. */
  screenOf(p: Vec): Vec {
    return { x: (p.x - this.view.camX) * this.view.zoom, y: (p.y - this.view.camY) * this.view.zoom }
  }

  localOf(part: PartInstance, w: Vec): Vec {
    return unrotVec({ x: w.x - part.x, y: w.y - part.y }, part.rot)
  }

  hitAt(w: Vec): Hit {
    return hitTest(this.world, w, this.view.zoom, this.selectedWire)
  }
}
