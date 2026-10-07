// Canvas renderer: dark neon backdrop, true-to-life parts, wires, leads, smoke.

import type { Simulation } from '../board/simulation.ts'
import { G, pointKey, rotVec, wirePath } from '../board/world.ts'
import type { PartInstance, Vec, World, Wire } from '../board/world.ts'
import { defOf, layerOf, pinWorld, stackOrder } from '../parts/index.ts'
import { COL, drawText, mix, radialGlow, rrect } from './draw.ts'
import { straightMid } from '../board/wireEdit.ts'
import { pixelCable, pixelProbeHead } from './pixelwire.ts'
import { scene } from './scene.ts'

export interface View {
  /** World coordinate at the top-left of the canvas. */
  camX: number
  camY: number
  zoom: number
}

export interface Overlay {
  selectedPart: string | null
  selectedWire: string | null
  hoverPart: string | null
  /** Part the pointer has rested on long enough to show its labels. */
  labelPart: string | null
  hoverPoint: Vec | null
  draft: Vec[] | null
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
    for (const w of world.wires) this.drawWire(w, w.id === ov.selectedWire)
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
      c.globalAlpha = 0.55
      this.drawPart(tmp, sim, now, 0.55)
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
    const hov = ov.hoverPart && ov.hoverPart !== ov.selectedPart ? world.getPart(ov.hoverPart) : undefined
    if (hov) this.drawPinLabels(hov)
    if (sel) this.drawPinLabels(sel)

    if (ov.draft) {
      c.setLineDash([6, 5])
      c.strokeStyle = COL.cyan
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

  private drawGrid(view: View): void {
    const c = this.ctx
    const step = G * view.zoom
    if (step < 8) return
    c.fillStyle = COL.grid
    const ox = -((view.camX * view.zoom) % step)
    const oy = -((view.camY * view.zoom) % step)
    for (let x = ox; x < this.width; x += step) for (let y = oy; y < this.height; y += step) c.fillRect(Math.round(x), Math.round(y), 2, 2)
  }

  private drawPart(part: PartInstance, sim: Simulation, now: number, alpha: number): void {
    const c = this.ctx
    const def = defOf(part.type)
    const live = sim.live.get(part.id) ?? {}
    c.save()
    c.translate(part.x, part.y)
    c.rotate((part.rot * Math.PI) / 2)
    def.draw(c, part, live, now)
    this.drawHeat(part, def.bounds(part), now, alpha)
    c.restore()
  }

  private drawHeat(part: PartInstance, b: { x: number; y: number; w: number; h: number }, now: number, alpha: number): void {
    const c = this.ctx
    if (alpha < 1) return
    const st = part.state
    if (st.failed) {
      c.save()
      c.globalAlpha = 0.62
      c.fillStyle = '#050304'
      rrect(c, b.x + 2, b.y + 2, b.w - 4, b.h - 4, 5)
      c.fill()
      c.globalAlpha = 1
      c.strokeStyle = '#2a1a14'
      c.lineWidth = 2
      c.beginPath()
      c.moveTo(b.x + b.w * 0.2, b.y + b.h * 0.3)
      c.lineTo(b.x + b.w * 0.45, b.y + b.h * 0.55)
      c.lineTo(b.x + b.w * 0.35, b.y + b.h * 0.8)
      c.moveTo(b.x + b.w * 0.45, b.y + b.h * 0.55)
      c.lineTo(b.x + b.w * 0.8, b.y + b.h * 0.4)
      c.stroke()
      const flick = 0.35 + 0.25 * Math.sin(now * 9 + b.x)
      c.fillStyle = `rgba(255,120,40,${flick})`
      c.fillRect(b.x + b.w * 0.45, b.y + b.h * 0.55, 3, 3)
      drawText(c, 'BURNT', b.x + b.w / 2, b.y + b.h + 6, { color: COL.red, align: 'center' })
      c.restore()
    } else if (st.heat > 0.04) {
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

  private drawWire(w: Wire, selected: boolean): void {
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
      pixelCable(c, path, w.color, true, w.taps ?? [])
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
    c.strokeStyle = w.color
    c.lineWidth = 4
    this.tracePath(path)
    c.stroke()
    c.strokeStyle = 'rgba(255,255,255,0.25)'
    c.lineWidth = 1
    this.tracePath(path, -1)
    c.stroke()
    for (const e of [w.a, w.b, ...(w.taps ?? [])]) {
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

  private drawSelection(part: PartInstance, now: number): void {
    const c = this.ctx
    const def = defOf(part.type)
    const b = def.bounds(part)
    c.save()
    c.translate(part.x, part.y)
    c.rotate((part.rot * Math.PI) / 2)
    c.strokeStyle = COL.cyan
    c.lineWidth = 1.5
    c.setLineDash([5, 4])
    c.lineDashOffset = -now * 12
    c.shadowColor = COL.cyan
    c.shadowBlur = 6
    c.strokeRect(b.x - 3, b.y - 3, b.w + 6, b.h + 6)
    c.restore()
  }

  private drawPinLabels(part: PartInstance): void {
    const def = defOf(part.type)
    if (def.pinLabels.length === 0 || def.type === 'resistor') return
    const c = this.ctx
    const pins = pinWorld(part)
    pins.forEach((p, i) => {
      c.fillStyle = 'rgba(7,6,13,0.85)'
      const label = def.pinLabels[i] ?? ''
      c.fillRect(p.x - 7, p.y + 10, 14, 11)
      drawText(c, label, p.x, p.y + 12, { color: COL.cyan, align: 'center' })
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
