// The interactive canvas: pan/zoom, drag parts, draw wires, keyboard shortcuts, main loop.

import { applyFollow, planFollow, planGroup } from '../board/follow.ts'
import type { FollowPlan } from '../board/follow.ts'
import { clipWidth, copyOut, itemsInBox, normBox, pasteIn } from '../board/group.ts'
import type { Clip } from '../board/group.ts'
import { hitTest } from '../board/hit.ts'
import type { Hit } from '../board/hit.ts'
import { partObstacles, pathHitsRects, segmentHitsRect, insideRects } from '../board/obstacles.ts'
import { untangle } from '../board/untangle.ts'
import { routeVia } from '../board/router.ts'
import { Simulation } from '../board/simulation.ts'
import { branchesOfParts } from '../board/wireJoin.ts'
import { dragEnd, moveBend, tidy, wireOverlaps } from '../board/wireEdit.ts'
import type { WireShape } from '../board/wireEdit.ts'
import { G, snap, unrotVec, WIRE_COLORS } from '../board/world.ts'
import type { PartInstance, Vec, World, Wire } from '../board/world.ts'
import { holeNear } from '../parts/breadboard.ts'
import { defOf, newPart, pinWorld, rotatePart } from '../parts/index.ts'
import { keyName } from './keys.ts'
import { Renderer } from '../render/renderer.ts'
import type { Overlay, View } from '../render/renderer.ts'

type Mode =
  | { t: 'pan'; sx: number; sy: number; camX: number; camY: number }
  | { t: 'part'; part: PartInstance; grab: Vec; x0: number; y0: number; leads0: Vec[] | null; moved: boolean; local: Vec; sx: number; sy: number; pressing: boolean; follow: FollowPlan }
  | { t: 'lead'; part: PartInstance; index: number }
  | { t: 'dragEnd'; wire: Wire; end: 'a' | 'b'; plugOld: boolean; base: WireShape }
  | { t: 'bend'; wire: Wire; index: number; via0: Vec[] }
  | { t: 'newWire'; a: Vec; b: Vec; via: Vec[]; clickWire?: string; bad?: boolean }
  | { t: 'box'; a: Vec; b: Vec; sx: number; sy: number; add: boolean; moved: boolean }
  | { t: 'group'; grab: Vec; sx: number; sy: number; moved: boolean; plan: FollowPlan; clickPart: string | null; clickWire: string | null }

const ARROWS: Record<string, [number, number] | undefined> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

/** Pointer travel (screen px) before a press turns into a drag. */
const DRAG_PX = 4

function emptyGroup(): { parts: Set<string>; wires: Set<string> } {
  return { parts: new Set(), wires: new Set() }
}

export interface HoverInfo {
  text: string
}

export class Workspace {
  readonly renderer: Renderer
  readonly sim: Simulation
  view: View = { camX: -60, camY: -60, zoom: 1 }
  /** Width of the toolbox floating over the left edge of the canvas: the part of the canvas that is covered. */
  leftInset = 0
  /** The same for the inspector floating over the right edge. */
  rightInset = 0
  selectedPart: string | null = null
  selectedWire: string | null = null
  /** Several parts/wires selected at once. Only used for 2 or more items; a single item is `selectedPart`/`selectedWire`. */
  group = emptyGroup()
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
  private hoverPoint: Vec | null = null
  private ghost: { type: string; x: number; y: number } | null = null
  private last = performance.now()
  private time = 0
  private paused = false
  private clip: Clip | null = null
  private pasteCount = 0

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
      group: this.group,
      box: m && m.t === 'box' && m.moved ? normBox(m.a, m.b) : null,
      hoverPart: this.hoverPart,
      labelPart: this.hoverPart,
      hoverPoint: this.hoverPoint,
      draft: m && m.t === 'newWire' ? [m.a, ...m.via, m.b] : null,
      draftBad: !!(m && m.t === 'newWire' && m.bad),
      ghost: this.ghost,
      wireMode: this.wireMode,
    }
  }

  // ------------------------------------------------------------ helpers

  private world2(e: { clientX: number; clientY: number }): Vec {
    const r = this.canvas.getBoundingClientRect()
    return this.renderer.toWorld(this.view, e.clientX - r.left, e.clientY - r.top)
  }

  /** Is this wire end plugged into a pin, a breadboard hole or the end of another wire? */
  private isPlugged(pt: Vec, wire: Wire): boolean {
    for (const part of this.world.parts) {
      if (part.type.startsWith('breadboard')) {
        if (holeNear(part, pt, 1)) return true
      } else if (pinWorld(part).some((q) => q.x === pt.x && q.y === pt.y)) return true
    }
    return this.world.wires.some((o) => o !== wire && [o.a, o.b, ...(o.taps ?? [])].some((q) => q.x === pt.x && q.y === pt.y))
  }

  private snapPt(p: Vec): Vec {
    return { x: snap(p.x), y: snap(p.y) }
  }

  select(part: string | null, wire: string | null = null): void {
    const hadGroup = this.groupSize() > 0
    if (!hadGroup && this.selectedPart === part && this.selectedWire === wire) return
    this.group = emptyGroup()
    this.selectedPart = part
    this.selectedWire = wire
    this.onSelect()
  }

  groupSize(): number {
    return this.group.parts.size + this.group.wires.size
  }

  /** Select exactly these items: none clears, one becomes the ordinary single selection, more form a group. */
  setSelection(parts: Set<string>, wires: Set<string>): void {
    const n = parts.size + wires.size
    if (n === 0) this.select(null)
    else if (n === 1) this.select(parts.size === 1 ? [...parts][0] : null, wires.size === 1 ? [...wires][0] : null)
    else {
      this.selectedPart = null
      this.selectedWire = null
      this.group = { parts, wires }
      this.onSelect()
    }
  }

  /** Everything currently selected, whether a single item or a group. */
  private selection(): { parts: Set<string>; wires: Set<string> } {
    if (this.groupSize() > 0) return { parts: new Set(this.group.parts), wires: new Set(this.group.wires) }
    return {
      parts: new Set(this.selectedPart ? [this.selectedPart] : []),
      wires: new Set(this.selectedWire ? [this.selectedWire] : []),
    }
  }

  private toggle(item: { part?: string; wire?: string }): void {
    const s = this.selection()
    const set = item.part ? s.parts : s.wires
    const id = (item.part ?? item.wire)!
    if (set.has(id)) set.delete(id)
    else set.add(id)
    this.setSelection(s.parts, s.wires)
  }

  selectAll(): void {
    this.setSelection(new Set(this.world.parts.map((p) => p.id)), new Set(this.world.wires.map((w) => w.id)))
  }

  /** The toolbox floats over the canvas: tell the view how much of the left side it covers (the board itself never moves). */
  setLeftInset(px: number): void {
    this.leftInset = px
  }

  setRightInset(px: number): void {
    this.rightInset = px
  }

  centerOfView(): Vec {
    return this.renderer.toWorld(this.view, this.leftInset + (this.renderer.width - this.leftInset - this.rightInset) / 2, this.renderer.height / 2)
  }

  fitView(): void {
    const w = this.world
    if (w.parts.length === 0 && w.wires.length === 0) {
      this.view = { camX: -80 - this.leftInset, camY: -80, zoom: 1 }
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
    const visibleW = this.renderer.width - this.leftInset - this.rightInset
    const zw = visibleW / (x1 - x0 + pad * 2)
    const zh = this.renderer.height / (y1 - y0 + pad * 2)
    const zoom = Math.min(Math.max(Math.min(zw, zh), 0.3), 1.4)
    this.view = {
      zoom,
      camX: (x0 + x1) / 2 - (this.leftInset + visibleW / 2) / zoom,
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
    untangle(this.world)
    this.world.commit()
    this.select(part.id)
    this.onEdit()
    return part
  }

  deleteSelected(): void {
    const s = this.selection()
    if (s.parts.size + s.wires.size === 0) return
    // wires branching off another wire from one of these parts go with them
    const gone = branchesOfParts(this.world, this.world.parts.filter((p) => s.parts.has(p.id)))
    for (const id of s.parts) this.world.removePart(id)
    for (const id of new Set([...s.wires, ...gone])) this.world.removeWire(id)
    this.select(null)
    this.world.commit()
    this.onSelect()
    this.onEdit()
  }

  /** Move everything selected by whole grid steps (arrow keys). */
  moveSelected(gx: number, gy: number): void {
    const s = this.selection()
    if (s.parts.size + s.wires.size === 0) return
    const plan = planGroup(this.world, s.parts, s.wires)
    applyFollow(this.world, plan, gx * G, gy * G)
    untangle(this.world)
    this.world.commit()
    this.onEdit()
  }

  copySelected(): boolean {
    const s = this.selection()
    if (s.parts.size + s.wires.size === 0) return false
    this.clip = copyOut(this.world, s.parts, s.wires)
    this.pasteCount = 0
    return true
  }

  /**
   * Paste the clipboard two grid steps down-right of where it was (and a bit further each time it is pasted again).
   * A copy that includes a breadboard goes beside the original instead, so the two boards never share holes.
   */
  paste(): void {
    if (!this.clip) return
    this.pasteCount++
    const hasBoard = this.clip.parts.some((p) => p.type.startsWith('breadboard'))
    const dx = hasBoard ? this.pasteCount * (clipWidth(this.clip) + 2 * G) : this.pasteCount * 2 * G
    const dy = hasBoard ? 0 : dx
    const made = pasteIn(this.world, this.clip, dx, dy)
    untangle(this.world)
    this.world.commit()
    this.setSelection(made.parts, made.wires)
    this.onEdit()
  }

  duplicateSelected(): void {
    if (!this.copySelected()) return
    this.paste()
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
      // middle or right button (or Space + left): drag the view
      this.mode = { t: 'pan', sx: e.clientX, sy: e.clientY, camX: this.view.camX, camY: this.view.camY }
      return
    }
    const ctrl = e.ctrlKey || e.metaKey
    if (e.button !== 0) return
    const hit = hitTest(this.world, w, this.view.zoom, this.selectedWire, false, this.selectedPart)

    // Ctrl+click adds to / removes from the selection
    if (ctrl) {
      if (hit.kind === 'wire') return this.toggle({ wire: hit.wire.id })
      if (hit.kind === 'part' || hit.kind === 'board' || hit.kind === 'pin' || hit.kind === 'lead') return this.toggle({ part: hit.part.id })
    }
    // pressing something that belongs to a multi-selection drags the whole selection
    if (this.groupSize() > 0 && !ctrl && (hit.kind === 'part' || hit.kind === 'board' || hit.kind === 'wire')) {
      const part = hit.kind === 'wire' ? null : hit.part.id
      const wire = hit.kind === 'wire' ? hit.wire.id : null
      if ((part && this.group.parts.has(part)) || (wire && this.group.wires.has(wire))) {
        this.mode = {
          t: 'group',
          grab: w,
          sx: e.clientX,
          sy: e.clientY,
          moved: false,
          plan: planGroup(this.world, this.group.parts, this.group.wires),
          clickPart: part,
          clickWire: wire,
        }
        return
      }
    }

    if (hit.kind === 'lead') {
      this.select(hit.part.id)
      this.mode = { t: 'lead', part: hit.part, index: hit.index }
      return
    }
    if (hit.kind === 'wireEnd') {
      // an end never moves: dragging it grows the wire out from it (the old end stays put as a corner, and keeps its
      // hold if it was plugged in). Everything earlier in the wire stays where it was.
      const wire = hit.wire
      const base: WireShape = { a: { ...wire.a }, b: { ...wire.b }, via: wire.via.map((v) => ({ ...v })), taps: (wire.taps ?? []).map((v) => ({ ...v })) }
      this.mode = { t: 'dragEnd', wire, end: hit.end, plugOld: this.isPlugged(hit.point, wire), base }
      return
    }
    if (hit.kind === 'bend') {
      // a straight wire has no corner yet: the middle handle adds one at its position, then drags it
      if (hit.index === -1) hit.wire.via = [{ ...hit.point }]
      this.mode = { t: 'bend', wire: hit.wire, index: Math.max(hit.index, 0), via0: hit.wire.via.map((v) => ({ ...v })) }
      return
    }
    if (this.wireMode && hit.kind !== 'wire') {
      const a = hit.kind === 'pin' || hit.kind === 'hole' ? hit.point : this.snapPt(w)
      if (hit.kind !== 'pin' && hit.kind !== 'hole' && insideRects(a, partObstacles(this.world))) return // a wire cannot start inside a part
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
        // a wire cannot be dragged around: a click only selects it (reshape it from its ends and corners)
        return
      }
      case 'part':
      case 'board': {
        const part = hit.part
        this.select(part.id)
        let pressing = false
        const def = defOf(part.type)
        if (def.press && hit.kind === 'part' && (!def.pressZone || def.pressZone(hit.local))) {
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
          follow: planFollow(this.world, part),
        }
        return
      }
      default:
        // empty canvas: drag a selection box (a plain click just deselects; Ctrl keeps the current selection and adds to it)
        this.mode = { t: 'box', a: w, b: w, sx: e.clientX, sy: e.clientY, add: ctrl, moved: false }
    }
  }

  /**
   * May the wire take this shape? It must not run over itself or through the body of a part. A wire that already does
   * (an old one) may still be reshaped.
   */
  private shapeOk(next: { a: Vec; via: Vec[]; b: Vec }, cur: Wire): boolean {
    const rects = partObstacles(this.world)
    const folds = (s: { a: Vec; via: Vec[]; b: Vec }) => wireOverlaps(s.a, s.via, s.b)
    const cuts = (s: { a: Vec; via: Vec[]; b: Vec }) => pathHitsRects([s.a, ...s.via, s.b], rects)
    return (!folds(next) || folds(cur)) && (!cuts(next) || cuts(cur))
  }

  /**
   * The corners for `shape` with every stretch that would cut through a part sent around it instead (the router finds the
   * way), so dragging a corner or an end across a part makes the wire wrap round it. Returns the shape unchanged when
   * nothing is in the way; it may still end up not ok (a corner dropped inside a part has no way round).
   */
  private wrapAround<S extends { a: Vec; via: Vec[]; b: Vec }>(shape: S, cur: Wire): S {
    const rects = partObstacles(this.world)
    const pts = [shape.a, ...shape.via, shape.b]
    if (!pathHitsRects(pts, rects)) return shape
    const others = this.world.wires.filter((x) => x !== cur)
    const out: Vec[] = [pts[0]]
    for (let i = 0; i + 1 < pts.length; i++) {
      if (rects.some((r) => segmentHitsRect(pts[i], pts[i + 1], r))) out.push(...routeVia(pts[i], pts[i + 1], others, rects))
      out.push(pts[i + 1])
    }
    return { ...shape, via: out.slice(1, -1) }
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
      case 'box':
        if (!m.moved && Math.hypot(e.clientX - m.sx, e.clientY - m.sy) < DRAG_PX) return
        m.moved = true
        m.b = w
        break
      case 'group': {
        if (!m.moved && Math.hypot(e.clientX - m.sx, e.clientY - m.sy) < DRAG_PX) return
        m.moved = true
        applyFollow(this.world, m.plan, snap(w.x - m.grab.x), snap(w.y - m.grab.y))
        this.world.touch()
        break
      }
      case 'part': {
        if (!m.moved && Math.hypot(e.clientX - m.sx, e.clientY - m.sy) < DRAG_PX) return
        if (m.pressing) return
        m.moved = true
        const nx = snap(m.x0 + (w.x - m.grab.x))
        const ny = snap(m.y0 + (w.y - m.grab.y))
        const dx = nx - m.x0
        const dy = ny - m.y0
        m.part.x = nx
        m.part.y = ny
        if (m.leads0 && m.part.leads) m.part.leads = m.leads0.map((l) => ({ x: l.x + dx, y: l.y + dy }))
        applyFollow(this.world, m.follow, dx, dy) // wires on its pins, and everything on a breadboard, go along
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
        const next = this.wrapAround({ a: m.wire.a, via: moveBend(m.wire.a, m.via0, m.wire.b, m.index, s, m.wire.taps ?? []), b: m.wire.b }, m.wire)
        // a shape that would run the wire over itself or through a part is not taken (the wire stays as it last was)
        if (this.shapeOk(next, m.wire)) m.wire.via = next.via
        this.hoverPoint = s
        this.world.touch()
        break
      }
      case 'dragEnd': {
        const s = this.snapPt(w)
        const plug = m.end === 'b' ? m.base.b : m.base.a
        const use = this.wrapAround(s.x === plug.x && s.y === plug.y ? m.base : dragEnd(m.base, m.end, s, m.plugOld), m.wire)
        if (this.shapeOk(use, m.wire)) {
          m.wire.a = use.a
          m.wire.b = use.b
          m.wire.via = use.via
          m.wire.taps = use.taps.length > 0 ? use.taps : undefined
        }
        this.hoverPoint = s
        this.world.touch()
        break
      }
      case 'newWire': {
        const hit = hitTest(this.world, w, this.view.zoom, null)
        const nb = hit.kind === 'pin' || hit.kind === 'hole' ? hit.point : this.snapPt(w)
        if (nb.x !== m.b.x || nb.y !== m.b.y) {
          const rects = partObstacles(this.world)
          m.b = nb
          m.via = routeVia(m.a, m.b, this.world.wires, rects)
          // an end inside a part, or no way round one, makes a wire that cannot be made: the draft turns red and is dropped
          m.bad = insideRects(nb, rects) || pathHitsRects([m.a, ...m.via, m.b], rects)
        }
        this.hoverPoint = m.b
        break
      }
    }
    // dragging anything but a wire shows the closed hand (a press that has not moved yet keeps the hover cursor)
    const dragged = m.t === 'pan' || m.t === 'lead' || ((m.t === 'part' || m.t === 'group' || m.t === 'box') && m.moved)
    if (dragged) this.canvas.style.cursor = 'grabbing'
  }

  private up(e: PointerEvent): void {
    this.finishUp(e)
    this.hover(this.world2(e)) // the cursor goes back to what is under the pointer
  }

  private finishUp(e: PointerEvent): void {
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
          untangle(this.world) // a part dropped on a wire sends it round
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
      case 'dragEnd':
      case 'bend':
        // a corner dropped back onto the straight line (or a bare click on the middle handle) is not a corner
        if (m.t === 'bend' || m.t === 'dragEnd') m.wire.via = tidy([m.wire.a, ...m.wire.via, m.wire.b], m.wire.taps ?? [])
        this.world.commit()
        this.onEdit()
        break
      case 'newWire':
        if (m.bad) break
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
      case 'box': {
        if (!m.moved) {
          if (!m.add) this.select(null) // a plain click on empty canvas just deselects
          break
        }
        const found = itemsInBox(this.world, normBox(m.a, m.b))
        if (m.add) {
          const cur = this.selection()
          for (const id of found.parts) cur.parts.add(id)
          for (const id of found.wires) cur.wires.add(id)
          this.setSelection(cur.parts, cur.wires)
        } else this.setSelection(found.parts, found.wires)
        break
      }
      case 'group':
        if (m.moved) {
          untangle(this.world)
          this.world.commit()
          this.onEdit()
        } else if (m.clickPart) this.select(m.clickPart) // a click (no drag) on one member narrows the selection to it
        else if (m.clickWire) this.select(null, m.clickWire)
        break
      case 'pan':
        break
    }
    this.hoverPoint = null
  }

  private hover(w: Vec): void {
    const hit = hitTest(this.world, w, this.view.zoom, this.selectedWire, false, this.selectedPart)
    this.hoverPoint = null
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
        cursor = 'pointer'
        text = `${defOf(hit.part.type).pinLabels[hit.index]} lead, drag to move. ${point(hit.point)}`
        break
      case 'wireEnd':
        this.hoverPoint = hit.point
        cursor = 'pointer'
        text = `Wire end stays plugged in. Drag it to pull the wire out into a corner. ${point(hit.point)}`
        break
      case 'bend':
        this.hoverPoint = hit.point
        cursor = 'grab'
        text = hit.index === -1 ? 'Drag the middle of the wire to bend it.' : 'Wire corner: drag to reshape the wire.'
        break
      case 'pin':
        this.hoverPoint = hit.point
        this.hoverPart = hit.part.id
        cursor = 'pointer'
        text = `${defOf(hit.part.type).name} pin ${defOf(hit.part.type).pinLabels[hit.index]}: drag to wire. ${point(hit.point)}`
        break
      case 'hole':
        this.hoverPoint = hit.point
        cursor = 'pointer'
        text = `Breadboard hole: drag to wire. ${point(hit.point)}`
        break
      case 'wire':
        cursor = 'pointer'
        text = 'Wire: click to select, Delete to remove. Selected: drag an end to stretch it, drag a corner to reshape it.'
        break
      case 'part': {
        this.hoverPart = hit.part.id
        const d = defOf(hit.part.type)
        // the pressable cap of a push button is a button (pointer); the rest of a part is a handle (grab)
        cursor = d.press && (!d.pressZone || d.pressZone(hit.local)) ? 'pointer' : 'grab'
        text = `${d.name}: ${d.summary(hit.part)}`
        break
      }
      case 'board':
        cursor = 'grab'
        text = 'Breadboard: drag to move.'
        break
      default:
        cursor = this.wireMode ? 'crosshair' : 'grab'
        text = 'Left-drag draws a selection box. Right-drag moves the view. Ctrl adds to the selection.'
    }
    this.canvas.style.cursor = cursor
    this.onHover({ text })
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault()
    const w = this.world2(e)
    if (e.shiftKey) {
      const hit = hitTest(this.world, w, this.view.zoom, this.selectedWire, false, this.selectedPart)
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
    const k = keyName(e)
    const mod = e.ctrlKey || e.metaKey
    if (mod && !e.shiftKey && !e.altKey && (k === 'a' || k === 'c' || k === 'v' || k === 'd')) {
      e.preventDefault()
      if (k === 'a') this.selectAll()
      else if (k === 'c') this.copySelected()
      else if (k === 'v') this.paste()
      else this.duplicateSelected()
      return
    }
    const arrow = ARROWS[e.key]
    if (arrow && !mod && !e.altKey) {
      e.preventDefault()
      this.moveSelected(arrow[0], arrow[1])
      return
    }
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
    return hitTest(this.world, w, this.view.zoom, this.selectedWire, false, this.selectedPart)
  }
}
