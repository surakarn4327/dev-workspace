// Canvas renderer: dark neon backdrop, true-to-life parts, wires, leads, smoke.

import type { Simulation } from '../board/simulation.ts'
import { G, pointKey, rotVec, wirePath } from '../board/world.ts'
import type { PartInstance, Vec, World, Wire } from '../board/world.ts'
import { defOf, layerOf, pinWorld, stackOrder } from '../parts/index.ts'
import { effectiveColors, socketKeys, tapEnds } from '../board/wireJoin.ts'
import { paintBurnt, canBurn } from './burnt.ts'
import { ringOf } from './outline.ts'
import { PX } from './pixel.ts'
import { COL, drawLabelAt, drawText, LABEL_GAP, labelBoxSize, mix, radialGlow, rrect } from './draw.ts'
import { straightMid } from '../board/wireEdit.ts'
import { cableShape, drawCableBase, drawCableBody, drawCableCaps, junctionShape, pixelProbeHead } from './pixelwire.ts'
import type { CableShape } from './pixelwire.ts'
import { scene } from './scene.ts'

/** Pin names shown on the pin label: an LED or diode lead reads + or - instead of A or K. */
/** The dot grid never packs its dots closer than this many screen px (see drawGrid). */
const GRID_MIN_PX = 24
/** Overall strength of the dot grid (1 = full `COL.grid`). */
const GRID_ALPHA = 0.5

const PIN_SHOWN: Record<string, string | undefined> = { A: '+', K: '-' }

export interface View {
  /** World coordinate at the top-left of the canvas. */
  camX: number
  camY: number
  zoom: number
}

export interface Overlay {
  selectedPart: string | null
  selectedWire: string | null
  /** Multi-selection (several parts and wires at once), empty sets when none. */
  group: { parts: Set<string>; wires: Set<string> }
  /** Selection rectangle being dragged, in world coordinates. */
  box: { x0: number; y0: number; x1: number; y1: number } | null
  hoverPart: string | null
  /** Part the pointer has rested on long enough to show its labels. */
  labelPart: string | null
  hoverPoint: Vec | null
  draft: Vec[] | null
  /** The wire being drawn cannot be made (it would end inside a part or cut through one). */
  draftBad: boolean
  ghost: { type: string; x: number; y: number } | null
  wireMode: boolean
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  size: number
  color: string
  spark: boolean
}

export class Renderer {
  /** Context every draw method paints into. Points at the pixel layer while it is being drawn. */
  ctx: CanvasRenderingContext2D
  private readonly main: CanvasRenderingContext2D
  /** Use hand-made pixel sprites where they exist (parts without a sprite still draw as vectors). */
  pixelMode = true
  /** Device pixels per world unit while drawing (sets the resolution of the burnt-part scratch canvas). */
  private scale = 1
  private scratch: HTMLCanvasElement | null = null
  private particles: Particle[] = []
  private smokeUntil = new Map<string, number>()
  private emitAcc = new Map<string, number>()
  width = 0
  height = 0
  dpr = 1

  readonly canvas: HTMLCanvasElement

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    canvas.style.background = COL.bg
    this.main = canvas.getContext('2d')!
    this.ctx = this.main
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.width = this.canvas.clientWidth
    this.height = this.canvas.clientHeight
    this.canvas.width = Math.max(1, Math.round(this.width * this.dpr))
    this.canvas.height = Math.max(1, Math.round(this.height * this.dpr))
  }

  toWorld(view: View, sx: number, sy: number): Vec {
    return { x: sx / view.zoom + view.camX, y: sy / view.zoom + view.camY }
  }

  spawnFailure(x: number, y: number, partId: string, now: number): void {
    this.smokeUntil.set(partId, now + 7)
    for (let k = 0; k < 26; k++) {
      const a = Math.random() * Math.PI * 2
      const s = 30 + Math.random() * 90
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 40,
        life: 0.4 + Math.random() * 0.5,
        max: 0.9,
        size: 2 + Math.random() * 2,
        color: Math.random() < 0.5 ? '#ffb43a' : '#ff5a1f',
        spark: true,
      })
    }
  }

  private emitSmoke(x: number, y: number, strength: number): void {
    this.particles.push({
      x: x + (Math.random() - 0.5) * 14,
      y,
      vx: (Math.random() - 0.5) * 16 + 6,
      vy: -(24 + Math.random() * 26) * strength,
      life: 1.6 + Math.random() * 1.2,
      max: 2.8,
      size: 4 + Math.random() * 4,
      color: '#8d8aa0',
      spark: false,
    })
  }

  update(dt: number, world: World, sim: Simulation, now: number): void {
    for (const ev of sim.events.splice(0)) this.spawnFailure(ev.x, ev.y, ev.partId, now)
    for (const part of world.parts) {
      const smoking = (this.smokeUntil.get(part.id) ?? 0) > now
      const warm = !part.state.failed && part.state.heat > 0.45
      if (!smoking && !warm) continue
      const rate = smoking ? 14 : 4 * part.state.heat
      const acc = (this.emitAcc.get(part.id) ?? 0) + dt * rate
      const n = Math.floor(acc)
      this.emitAcc.set(part.id, acc - n)
      if (n > 0) {
        const def = defOf(part.type)
        const b = this.partCenter(part, def.bounds(part))
        for (let k = 0; k < Math.min(n, 3); k++) this.emitSmoke(b.x, b.y - 6, smoking ? 1 : 0.6)
      }
    }
    for (const p of this.particles) {
      p.life -= dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      if (p.spark) p.vy += 220 * dt
      else p.vx += (Math.random() - 0.5) * 20 * dt
    }
    this.particles = this.particles.filter((p) => p.life > 0)
  }

  private partCenter(part: PartInstance, b: { x: number; y: number; w: number; h: number }): Vec {
    const r = rotVec({ x: b.x + b.w / 2, y: b.y + b.h / 2 }, part.rot)
    return { x: part.x + r.x, y: part.y + r.y }
  }

  draw(world: World, sim: Simulation, view: View, ov: Overlay, now: number): void {
    const main = this.main
    const { zoom } = view
    scene.time = now
    scene.used = sim.net.usedKeys
    scene.labeled = new Set([ov.selectedPart, ov.labelPart].filter((x): x is string => x !== null))
    this.ctx = main
    main.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    main.fillStyle = COL.bg
    main.fillRect(0, 0, this.width, this.height)
    this.drawGrid(view)

    const sMain = this.dpr * zoom
    this.scale = sMain
    scene.pixel = this.pixelMode
    main.setTransform(sMain, 0, 0, sMain, -view.camX * sMain, -view.camY * sMain)
    main.imageSmoothingEnabled = false
    this.drawContent(world, sim, ov, now)

    // selection, handles and hints
    main.setTransform(sMain, 0, 0, sMain, -view.camX * sMain, -view.camY * sMain)
    this.drawOverlay(world, ov, now)
    main.setTransform(1, 0, 0, 1, 0, 0)
  }

  /** Things that are part of the circuit itself: parts, wires, leads, smoke. */
  private drawContent(world: World, sim: Simulation, ov: Overlay, now: number): void {
    const c = this.ctx
    // stacking: breadboard, flat parts, tall parts, then wires, then batteries and bench tools; the selected part (not the board) goes on top
    const sel = ov.selectedPart ? world.getPart(ov.selectedPart) : undefined
    const front = sel && layerOf(sel.type) > 0 ? sel : undefined
    const stack = stackOrder(world.parts).filter((p) => p !== front)
    for (const part of stack) if (layerOf(part.type) < 4) this.drawPart(part, sim, now, 1)
    const sockets = socketKeys(world)
    const colors = effectiveColors(world, sockets)
    // every cable's shadow and outline first, then the bodies: a branch merges into its main wire with no dark seam
    const shapes = new Map<string, CableShape>()
    // a round dot wherever a branch wire joins the middle of another (same colour as the main wire)
    const dots: { at: Vec; color: string; shape?: CableShape }[] = []
    for (const w of world.wires) for (const at of tapEnds(world, w, sockets)) dots.push({ at, color: colors.get(w.id) ?? w.color })
    if (this.pixelMode) {
      for (const w of world.wires) {
        const shape = cableShape(wirePath(w))
        shapes.set(w.id, shape)
        drawCableBase(c, shape, colors.get(w.id) ?? w.color)
      }
      for (const d of dots) {
        d.shape = junctionShape(d.at)
        drawCableBase(c, d.shape, d.color)
      }
    }
    for (const w of world.wires) this.drawWire(w, w.id === ov.selectedWire || ov.group.wires.has(w.id), colors.get(w.id) ?? w.color, shapes.get(w.id), tapEnds(world, w, sockets))
    for (const d of dots) {
      if (d.shape) drawCableBody(c, d.shape, d.color)
      else {
        c.fillStyle = d.color
        c.beginPath()
        c.arc(d.at.x, d.at.y, 3, 0, Math.PI * 2) // vector look: 6 px across, 1.5 x the 4 px wire
        c.fill()
      }
    }
    for (const part of stack) if (layerOf(part.type) >= 4) this.drawPart(part, sim, now, 1)
    if (front) this.drawPart(front, sim, now, 1)

    for (const part of world.parts) {
      const def = defOf(part.type)
      if (def.freeLeads && part.leads) this.drawLeads(part, ov)
    }

    if (ov.ghost) {
      const def = defOf(ov.ghost.type)
      const tmp = {
        id: 'ghost',
        type: ov.ghost.type,
        x: ov.ghost.x,
        y: ov.ghost.y,
        rot: 0 as const,
        params: def.defaults(),
        leads: null,
        state: { heat: 0, failed: false, failMsg: '' },
      }
      c.globalAlpha = 0.8
      this.drawPart(tmp, sim, now, 0.8)
      c.globalAlpha = 1
    }
    this.drawParticles()
  }

  /** Selection, handles, hints: interface elements drawn at full resolution. */
  private drawOverlay(world: World, ov: Overlay, now: number): void {
    const c = this.ctx
    const selWire = ov.selectedWire ? world.getWire(ov.selectedWire) : undefined
    if (selWire) this.drawBendHandles(selWire)
    const sel = ov.selectedPart ? world.getPart(ov.selectedPart) : undefined
    if (sel) this.drawSelection(sel, now)
    for (const id of ov.group.parts) {
      const gp = world.getPart(id)
      if (gp) this.drawSelection(gp, now)
    }
    if (ov.box) {
      const b = ov.box
      c.fillStyle = 'rgba(0,229,255,0.10)'
      c.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0)
      c.strokeStyle = COL.cyan
      c.lineWidth = 1.5
      c.setLineDash([6, 4])
      c.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0)
      c.setLineDash([])
    }
    const hov = ov.hoverPart && ov.hoverPart !== ov.selectedPart ? world.getPart(ov.hoverPart) : undefined
    if (hov) this.drawPinLabels(hov)
    if (sel) this.drawPinLabels(sel)

    if (ov.draft) {
      c.setLineDash([6, 5])
      c.strokeStyle = ov.draftBad ? COL.red : COL.cyan
      c.lineWidth = 2
      this.tracePath(ov.draft)
      c.stroke()
      c.setLineDash([])
    }
    if (ov.hoverPoint) {
      c.strokeStyle = COL.cyan
      c.lineWidth = 2
      c.shadowColor = COL.cyan
      c.shadowBlur = 8
      c.beginPath()
      c.arc(ov.hoverPoint.x, ov.hoverPoint.y, 8, 0, Math.PI * 2)
      c.stroke()
      c.shadowBlur = 0
    }
  }

  /**
   * Dot grid with level of detail: when zooming out the dots would pack closer than GRID_MIN_PX, so only every 2nd, 4th, 8th...
   * grid point is drawn (always a multiple of the snap grid), and the dots of the finer level fade in as the coarse step grows.
   */
  private drawGrid(view: View): void {
    const c = this.ctx
    let mult = 1
    while (G * view.zoom * mult < GRID_MIN_PX) mult *= 2
    const half = (G * mult) / 2
    const coarse = half * 2
    const fine = mult > 1 ? Math.min(Math.max((coarse * view.zoom - GRID_MIN_PX) / GRID_MIN_PX, 0), 1) : 0
    c.fillStyle = COL.grid
    const j0x = Math.floor(view.camX / half)
    const j0y = Math.floor(view.camY / half)
    const jx1 = Math.ceil((view.camX + this.width / view.zoom) / half)
    const jy1 = Math.ceil((view.camY + this.height / view.zoom) / half)
    const prev = c.globalAlpha
    for (let jx = j0x; jx <= jx1; jx++) {
      for (let jy = j0y; jy <= jy1; jy++) {
        const isCoarse = jx % 2 === 0 && jy % 2 === 0
        if (!isCoarse && fine === 0) continue
        if (mult === 1 && !isCoarse) continue
        c.globalAlpha = prev * GRID_ALPHA * (isCoarse ? 1 : fine)
        c.fillRect(Math.round((jx * half - view.camX) * view.zoom), Math.round((jy * half - view.camY) * view.zoom), 2, 2)
      }
    }
    c.globalAlpha = prev
  }

  private drawPart(part: PartInstance, sim: Simulation, now: number, alpha: number): void {
    const c = this.ctx
    const def = defOf(part.type)
    const live = sim.live.get(part.id) ?? {}
    c.save()
    c.translate(part.x, part.y)
    c.rotate((part.rot * Math.PI) / 2)
    if (part.state.failed && alpha === 1 && canBurn(part.type)) {
      this.scratch ??= document.createElement('canvas')
      const a = paintBurnt(this.scratch, (sc) => def.draw(sc, part, live, now), def.bounds(part), part.id, now, this.scale)
      c.drawImage(this.scratch, a.x, a.y, a.w, a.h)
    } else {
      def.draw(c, part, live, now)
      this.drawHeat(part, def.bounds(part), alpha)
    }
    c.restore()
  }

  private drawHeat(part: PartInstance, b: { x: number; y: number; w: number; h: number }, alpha: number): void {
    const c = this.ctx
    if (alpha < 1) return
    const st = part.state
    if (!st.failed && st.heat > 0.04) {
      radialGlow(c, b.x + b.w / 2, b.y + b.h / 2, Math.max(b.w, b.h) * 0.8, '#ff5a1f', Math.min(st.heat, 1) * 0.75)
      if (st.heat > 0.4) drawText(c, 'HOT', b.x + b.w / 2, b.y - 10, { color: COL.amber, align: 'center' })
    }
  }

  private drawBendHandles(w: Wire): void {
    const c = this.ctx
    for (const v of w.via) {
      if (w.taps?.some((t) => t.x === v.x && t.y === v.y)) continue // a plug is not a handle
      c.fillStyle = COL.bg
      c.strokeStyle = COL.cyan
      c.lineWidth = 2
      c.fillRect(v.x - 5, v.y - 5, 10, 10)
      c.strokeRect(v.x - 5, v.y - 5, 10, 10)
    }
    // a wire with no corner gets a round handle in the middle: drag it to bend the wire
    if (w.via.length === 0) {
      const mid = straightMid(w.a, w.b)
      if (mid) {
        c.fillStyle = COL.bg
        c.strokeStyle = COL.cyan
        c.lineWidth = 2
        c.beginPath()
        c.arc(mid.x, mid.y, 6, 0, Math.PI * 2)
        c.fill()
        c.stroke()
        c.fillStyle = COL.cyan
        c.fillRect(mid.x - 1.5, mid.y - 1.5, 3, 3)
      }
    }
  }

  private tracePath(path: Vec[], dy = 0): void {
    const c = this.ctx
    c.beginPath()
    path.forEach((p, i) => (i === 0 ? c.moveTo(p.x, p.y + dy) : c.lineTo(p.x, p.y + dy)))
  }

  private drawWire(w: Wire, selected: boolean, color: string, shape: CableShape | undefined, bare: Vec[]): void {
    const c = this.ctx
    const path = wirePath(w)
    c.lineCap = 'round'
    c.lineJoin = 'round'
    if (selected) {
      c.strokeStyle = COL.cyan
      c.shadowColor = COL.cyan
      c.shadowBlur = 12
      c.lineWidth = 8
      this.tracePath(path)
      c.stroke()
      c.shadowBlur = 0
    }
    if (this.pixelMode) {
      c.shadowBlur = 0
      if (shape) drawCableBody(c, shape, color)
      drawCableCaps(c, path, w.taps ?? [], bare)
      if (selected) {
        for (const e of [w.a, w.b]) {
          c.strokeStyle = COL.cyan
          c.lineWidth = 1.5
          c.beginPath()
          c.arc(e.x, e.y, 8, 0, Math.PI * 2)
          c.stroke()
        }
      }
      c.lineCap = 'butt'
      c.lineJoin = 'miter'
      return
    }
    c.strokeStyle = 'rgba(0,0,0,0.55)'
    c.lineWidth = 6
    this.tracePath(path, 1.5)
    c.stroke()
    c.strokeStyle = color
    c.lineWidth = 4
    this.tracePath(path)
    c.stroke()
    c.strokeStyle = 'rgba(255,255,255,0.25)'
    c.lineWidth = 1
    this.tracePath(path, -1)
    c.stroke()
    for (const e of [w.a, w.b, ...(w.taps ?? [])]) {
      if (bare.some((q) => q.x === e.x && q.y === e.y)) continue // a branch end gets the round junction dot, not a metal pin
      c.fillStyle = COL.metal
      c.beginPath()
      c.arc(e.x, e.y, 3.6, 0, Math.PI * 2)
      c.fill()
      c.fillStyle = '#6b707b'
      c.beginPath()
      c.arc(e.x, e.y, 1.6, 0, Math.PI * 2)
      c.fill()
      if (selected) {
        c.strokeStyle = COL.cyan
        c.lineWidth = 1.5
        c.beginPath()
        c.arc(e.x, e.y, 8, 0, Math.PI * 2)
        c.stroke()
      }
    }
    c.lineCap = 'butt'
    c.lineJoin = 'miter'
  }

  private drawLeads(part: PartInstance, ov: Overlay): void {
    const c = this.ctx
    const def = defOf(part.type)
    const anchors = def.anchors?.(part) ?? []
    const b = def.bounds(part)
    anchors.forEach((a, i) => {
      const tip = part.leads![i]
      const A = { x: part.x + a.x, y: part.y + a.y }
      const dir = a.y < b.h / 2 ? -1 : 1
      const dist = Math.hypot(tip.x - A.x, tip.y - A.y)
      const k = Math.min(60, 20 + dist * 0.3)
      const c1 = { x: A.x, y: A.y + dir * k }
      const c2 = { x: tip.x, y: tip.y - dir * k }
      const col = def.leadColors?.[i] ?? '#888'
      c.lineCap = 'round'
      if (this.pixelMode) {
        // same look as the jumper wires (shadow, dark outline, lit top-left, shaded bottom-right) but smooth
        const stroke = (dx: number, dy: number, width: number, color: string) => {
          c.strokeStyle = color
          c.lineWidth = width
          c.beginPath()
          c.moveTo(A.x + dx, A.y + dy)
          c.bezierCurveTo(c1.x + dx, c1.y + dy, c2.x + dx, c2.y + dy, tip.x + dx, tip.y + dy)
          c.stroke()
        }
        stroke(2, 2, 8, 'rgba(0,0,0,0.38)')
        stroke(0, 0, 8, mix(col, '#000000', 0.78))
        stroke(0, 0, 6, mix(col, '#000000', 0.35))
        stroke(-0.5, -0.5, 4.5, col)
        stroke(-1, -1, 1.6, mix(col, '#ffffff', 0.4))
      } else {
        c.strokeStyle = 'rgba(0,0,0,0.6)'
        c.lineWidth = 6
        c.beginPath()
        c.moveTo(A.x, A.y)
        c.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, tip.x, tip.y)
        c.stroke()
        c.strokeStyle = col
        c.lineWidth = 3.6
        c.stroke()
      }
      const ang = Math.atan2(tip.y - c2.y, tip.x - c2.x)
      c.save()
      c.translate(tip.x, tip.y)
      c.rotate(ang)
      if (def.leadTip === 'probe' && this.pixelMode) {
        c.restore()
        pixelProbeHead(c, tip, tip.y - c2.y > 0 ? -1 : 1, col)
        c.save()
      } else if (def.leadTip === 'probe') {
        c.fillStyle = col
        rrect(c, -34, -5.5, 28, 11, 3)
        c.fill()
        c.strokeStyle = '#000'
        c.lineWidth = 1
        c.stroke()
        c.fillStyle = 'rgba(255,255,255,0.25)'
        c.fillRect(-32, -4.5, 24, 2)
        c.fillStyle = COL.metal
        c.fillRect(-6, -1.6, 6, 3.2)
      } else {
        c.fillStyle = '#d98a4a'
        c.fillRect(-9, -1.6, 9, 3.2)
        c.fillStyle = '#ffc48a'
        c.fillRect(-9, -1.6, 9, 1)
      }
      c.restore()
      c.lineCap = 'butt'
      if (ov.hoverPoint && pointKey(ov.hoverPoint) === pointKey(tip)) {
        c.strokeStyle = COL.cyan
        c.lineWidth = 1.5
        c.beginPath()
        c.arc(tip.x, tip.y, 10, 0, Math.PI * 2)
        c.stroke()
      }
    })
  }

  /** Outline that follows the part's own shape, one art pixel thick, its dashes crawling round it. */
  private drawSelection(part: PartInstance, now: number): void {
    const c = this.ctx
    const ring = ringOf(part, defOf(part.type))
    const phase = Math.floor(now * 8)
    c.save()
    c.translate(part.x, part.y)
    c.rotate((part.rot * Math.PI) / 2)
    c.fillStyle = COL.cyan
    c.shadowColor = COL.cyan
    c.shadowBlur = 6
    c.beginPath()
    for (const [x, y] of ring.cells) {
      if (((x + y) / PX + phase) % 4 === 0) continue // a gap, so the line reads as dashes
      c.rect(x, y, PX, PX)
    }
    c.fill()
    c.restore()
  }

  private drawPinLabels(part: PartInstance): void {
    const def = defOf(part.type)
    if (def.pinLabels.length === 0 || def.hidePinLabels || !def.pinLabelPlace) return
    const c = this.ctx
    const pins = pinWorld(part)
    const mid = { x: pins.reduce((s, p) => s + p.x, 0) / pins.length, y: pins.reduce((s, p) => s + p.y, 0) / pins.length }
    pins.forEach((p, i) => {
      const label = (def.type === 'led' || def.type === 'diode' ? PIN_SHOWN[def.pinLabels[i]] : undefined) ?? def.pinLabels[i] ?? ''
      // the label sits at the visible lead tip, with the same gap from its box edge on every side
      let dx = 0
      let dy = 0
      if (def.pinLabelPlace === 'lead' && def.pinLeadDir) {
        // out along the pin's own lead, whatever the part's rotation
        const d = def.pinLeadDir(i)
        const r = (part.rot * Math.PI) / 2
        dx = Math.round(d.x * Math.cos(r) - d.y * Math.sin(r))
        dy = Math.round(d.x * Math.sin(r) + d.y * Math.cos(r))
      } else if (def.pinLabelPlace === 'axis' || def.pinLabelPlace === 'side') {
        dx = Math.sign(p.x - mid.x)
        dy = def.pinLabelPlace === 'axis' ? Math.sign(p.y - mid.y) : 0
      } else {
        // 'below' = past the lead tips in the part's own frame, 'above' = the opposite; either way measured from the visible tip
        const a = (part.rot * Math.PI) / 2
        const sign = def.pinLabelPlace === 'below' ? 1 : -1
        dx = Math.round(-Math.sin(a)) * sign
        dy = Math.round(Math.cos(a)) * sign
      }
      const tip = def.pinTipPast ? def.pinTipPast(i, this.pixelMode) : ((this.pixelMode ? def.tipPastPin : (def.tipPastPinVector ?? def.tipPastPin)) ?? 0)
      const { w, h } = labelBoxSize(c, label, 10)
      const tx = p.x + dx * tip
      const ty = p.y + dy * tip
      const left = dx > 0 ? tx + LABEL_GAP : dx < 0 ? tx - LABEL_GAP - w : tx - w / 2
      const top = dy > 0 ? ty + LABEL_GAP : dy < 0 ? ty - LABEL_GAP - h : ty - h / 2
      drawLabelAt(c, label, left, top, 10)
    })
  }

  private drawParticles(): void {
    const c = this.ctx
    for (const p of this.particles) {
      const t = Math.max(p.life / p.max, 0)
      if (p.spark) {
        c.fillStyle = p.color
        c.globalAlpha = Math.min(1, t * 2)
        c.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size)
      } else {
        c.fillStyle = p.color
        c.globalAlpha = 0.5 * Math.min(t * 1.5, 1)
        const s = p.size * (1.6 - t)
        c.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), s, s)
      }
    }
    c.globalAlpha = 1
  }
}
