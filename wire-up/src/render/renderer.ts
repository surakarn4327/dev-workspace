// Canvas renderer: dark neon backdrop, true-to-life parts, wires, leads, smoke.

import type { Simulation } from '../board/simulation.ts'
import { G, pointKey, rotVec, wirePath } from '../board/world.ts'
import type { PartInstance, Vec, World, Wire } from '../board/world.ts'
import { defOf, drawsOverWires, layerOf, leadDir, pinWorld, stackOrder } from '../parts/index.ts'
import { effectiveColors, socketKeys, tapEnds } from '../board/wireJoin.ts'
import { paintBurnt, canBurn } from './burnt.ts'
import { ringOf } from './outline.ts'
import { PX } from './pixel.ts'
import { COL, drawLabelAt, drawText, LABEL_GAP, labelBoxSize, mix, radialGlow, replayGlows, rrect } from './draw.ts'
import { straightMid } from '../board/wireEdit.ts'
import { SELECT_GLOW_REACH, SELECT_GLOW_STEPS, cableShape, drawCableBase, drawCableSelection, drawCableBody, drawCableCaps, junctionShape, pixelProbeHead } from './pixelwire.ts'
import type { CableShape } from './pixelwire.ts'
import { scene } from './scene.ts'
import type { GlowCall } from './scene.ts'
import { sameSigs } from './dragPlan.ts'
import type { Sigs } from './dragPlan.ts'

/** Pin names shown on the pin label: an LED or diode lead reads + or - instead of A or K. */
/** The dot grid never packs its dots closer than this many screen px (see drawGrid). */
const GRID_MIN_PX = 24
/** Below this current (A) a wire shows no flowing dots: the 1 Mohm pull-downs of a gate input leak a few uA and would only be noise. */
const MIN_FLOW = 1e-5
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
  ghost: { type: string; x: number; y: number; bad?: boolean } | null
  /** Parts whose pin sits on a wire end they were not drawn to: shown red until moved away. */
  badParts: string[]
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

/** What the frame meter can leave out of a frame. `wires` leaves out all of the wire drawing; `bodies` and `caps` only that half of it. */
export type HideKind = 'grid' | 'parts' | 'wires' | 'bodies' | 'caps' | 'dots' | 'selection'

/** How far past the screen edge (CSS px) a layer reaches, so panning does not need a repaint until it runs out. */
const LAYER_MARGIN = 256

/** How far from the tip (world px, along the housing) a pixel probe's cable ends: the middle of the housing's far end cell. */
const PROBE_CABLE_END = 16 * PX

/** A drawing context that does nothing: any call returns itself, any property reads as 0. Used to run a draw function for its labels only. */
const NO_CTX: CanvasRenderingContext2D = new Proxy(function () {}, {
  get: (_t, key) => (key === Symbol.toPrimitive ? () => 0 : NO_CTX),
  set: () => true,
  apply: () => NO_CTX,
}) as unknown as CanvasRenderingContext2D

interface Layer {
  canvas: HTMLCanvasElement
  key: string
  /** World position of the layer's top-left corner. */
  ox: number
  oy: number
  /** Nothing drawn on it: skip the copy. */
  empty: boolean
}

function makeLayer(): Layer {
  return { canvas: document.createElement('canvas'), key: '', ox: 0, oy: 0, empty: false }
}

const usedHashes = new WeakMap<Set<string>, number>()

/** A number that changes when the set of plugged holes does (the breadboard draws plugged holes differently). */
function usedHash(keys: Set<string>): number {
  let h = usedHashes.get(keys)
  if (h === undefined) {
    h = keys.size
    for (const k of keys) {
      let x = 0
      for (let i = 0; i < k.length; i++) x = (x * 31 + k.charCodeAt(i)) | 0
      h = (h + x) | 0
    }
    usedHashes.set(keys, h)
  }
  return h
}

interface RingPictures {
  /** Part-local world position of the pictures' top-left corner, and their size in art pixels. */
  x: number
  y: number
  w: number
  h: number
  /** One picture for each of the four steps of the crawl of the dashes. */
  pics: HTMLCanvasElement[]
}

const ringPictureCache = new WeakMap<object, Map<string, RingPictures>>()

/**
 * The outline of a selected part as pictures, one art pixel per picture pixel: the dashes in each of the four steps of their crawl
 * with the two steps of glow round them. Drawing the outline from thousands of little squares each frame is the slowest thing a weak
 * graphics card is asked to do; copying a picture is one operation.
 */
function ringPictures(ring: { cells: Array<[number, number]> }, color: string): RingPictures {
  let byColor = ringPictureCache.get(ring)
  if (!byColor) {
    byColor = new Map()
    ringPictureCache.set(ring, byColor)
  }
  let hit = byColor.get(color)
  if (!hit) {
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const [x, y] of ring.cells) {
      const cx = Math.round(x / PX)
      const cy = Math.round(y / PX)
      if (cx < x0) x0 = cx
      if (cx > x1) x1 = cx
      if (cy < y0) y0 = cy
      if (cy > y1) y1 = cy
    }
    x0 -= SELECT_GLOW_REACH
    y0 -= SELECT_GLOW_REACH
    x1 += SELECT_GLOW_REACH
    y1 += SELECT_GLOW_REACH
    const w = Math.max(1, x1 - x0 + 1)
    const h = Math.max(1, y1 - y0 + 1)
    const pics: HTMLCanvasElement[] = []
    for (let phase = 0; phase < 4; phase++) {
      const cv = document.createElement('canvas')
      cv.width = w
      cv.height = h
      const g = cv.getContext('2d')!
      g.fillStyle = color
      // the two layers of glow from the outside in (each a fainter, fatter copy of the outline), then the dashes
      for (const [grow, alpha] of SELECT_GLOW_STEPS) {
        g.globalAlpha = alpha
        g.beginPath()
        for (const [x, y] of ring.cells) g.rect(Math.round(x / PX) - grow - x0, Math.round(y / PX) - grow - y0, 2 * grow + 1, 2 * grow + 1)
        g.fill()
      }
      g.globalAlpha = 1
      g.beginPath()
      for (const [x, y] of ring.cells) if (((x + y) / PX + phase) % 4 !== 0) g.rect(Math.round(x / PX) - x0, Math.round(y / PX) - y0, 1, 1) // a gap, so the line reads as dashes
      g.fill()
      pics.push(cv)
    }
    hit = { x: x0 * PX, y: y0 * PX, w, h, pics }
    byColor.set(color, hit)
  }
  return hit
}

export class Renderer {
  /** Context every draw method paints into. Points at the pixel layer while it is being drawn. */
  ctx: CanvasRenderingContext2D
  private readonly main: CanvasRenderingContext2D
  /** Frame meter switches: leave a kind of drawing out to see how much frame time it costs (nothing else uses these). */
  readonly hide: Record<HideKind, boolean> = { grid: false, parts: false, wires: false, bodies: false, caps: false, dots: false, selection: false }
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
    // value labels are not painted with the parts (they would make the saved layers depend on the pointer): see drawLabels
    const labeled = new Set([ov.selectedPart, ov.labelPart].filter((x): x is string => x !== null))
    scene.labeled = new Set()
    this.ctx = main
    main.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    main.fillStyle = COL.bg
    main.fillRect(0, 0, this.width, this.height)
    if (!this.hide.grid) this.drawGrid(view)

    const sMain = this.dpr * zoom
    this.scale = sMain
    scene.pixel = this.pixelMode
    main.setTransform(sMain, 0, 0, sMain, -view.camX * sMain, -view.camY * sMain)
    main.imageSmoothingEnabled = false
    if (this.cacheable(world)) this.drawCached(world, sim, view, ov, now)
    else this.drawContent(world, sim, ov, now)

    // value labels, then selection, handles and hints
    main.setTransform(sMain, 0, 0, sMain, -view.camX * sMain, -view.camY * sMain)
    this.drawLabels(world, sim, labeled, now)
    this.drawOverlay(world, ov, now)
    main.setTransform(1, 0, 0, 1, 0, 0)
  }

  /**
   * The still part of the picture (parts and wires) is painted once into two off-screen layers (under and over the flowing dots), a
   * little larger than the screen, and each frame only copies them over: panning slides the copy, a quiet board costs almost nothing.
   *
   * Nothing is ever stretched and nothing is ever missing: a frame that cannot be made from the layers (the board is changing from
   * frame to frame, as in a drag or a zoom) is painted live, and the layers are painted again on the first frame that holds still.
   */
  private layers = [makeLayer(), makeLayer()]
  private lastTokens = ''
  private lastBase = ''
  private lastZoom = 0
  private lastSigs: Sigs | null = null
  /** Counts the frames on which the board looked different from the frame before. */
  private revision = 0
  /** What the layers were painted for: if any of it has moved on, the layers are out of date. */
  private painted: { revision: number; base: string; zoom: number } | null = null
  /** Frame meter switch: turn the layers off to see what painting everything every frame costs. */
  cacheOn = true

  /** A burnt or hot part animates with time, so the picture cannot be kept: such a frame is painted the long way. */
  private cacheable(world: World): boolean {
    return this.cacheOn && !world.parts.some((p) => p.state.failed || p.state.heat > 0.02)
  }

  private drawCached(world: World, sim: Simulation, view: View, ov: Overlay, now: number): void {
    const main = this.main
    const { zoom } = view
    const s = this.dpr * zoom
    const m = LAYER_MARGIN / zoom // margin in world units
    const base = [this.pixelMode, this.dpr, this.width, this.height, ov.selectedPart, ov.selectedWire, [...ov.group.wires].join(','), Object.values(this.hide).join(',')].join('|')
    const [below, above] = this.layers
    // fingerprint the board only when something that can change it has happened
    const tokens = `${base}|${zoom}|${world.version}|${sim.stamp}`
    let sigs = this.lastSigs
    let stable: boolean
    if (sigs && tokens === this.lastTokens) stable = true
    else {
      const fresh = this.itemSigs(world, sim)
      stable = sigs !== null && this.lastBase === base && this.lastZoom === zoom && sameSigs(fresh, sigs)
      if (!stable) this.revision++
      sigs = fresh
    }
    this.lastTokens = tokens
    this.lastBase = base
    this.lastZoom = zoom
    this.lastSigs = sigs
    const painted = this.painted
    const inView = Math.abs(view.camX - below.ox - m) <= m * 0.9 && Math.abs(view.camY - below.oy - m) <= m * 0.9
    const usable = painted !== null && painted.revision === this.revision && painted.base === base && painted.zoom === zoom && inView
    if (!usable) {
      // a board that changes from frame to frame (a drag, a zoom) is painted live, no layer is made for it; once it holds still the
      // layers take it in, in its proper place
      if (!stable) {
        main.setTransform(s, 0, 0, s, -view.camX * s, -view.camY * s)
        main.imageSmoothingEnabled = false
        this.drawContent(world, sim, ov, now)
        return
      }
      this.paintLayers(world, sim, view, ov, now)
      this.painted = { revision: this.revision, base, zoom }
    }
    this.blit(below, view)
    main.setTransform(s, 0, 0, s, -view.camX * s, -view.camY * s)
    main.imageSmoothingEnabled = false
    replayGlows(main, this.glowsBelow)
    if (!this.hide.dots) this.drawFlow(sim, now)
    if (!above.empty) {
      this.blit(above, view)
      main.setTransform(s, 0, 0, s, -view.camX * s, -view.camY * s)
      main.imageSmoothingEnabled = false
      replayGlows(main, this.glowsAbove)
    }
    main.setTransform(s, 0, 0, s, -view.camX * s, -view.camY * s)
    main.imageSmoothingEnabled = false
    this.drawLive(world, sim, ov, now)
  }

  /** Paint the two layers from scratch: everything under the flowing dots, and everything over them. */
  private paintLayers(world: World, sim: Simulation, view: View, ov: Overlay, now: number): void {
    const s = this.dpr * view.zoom
    const m = LAYER_MARGIN / view.zoom
    const w = Math.ceil((this.width + 2 * LAYER_MARGIN) * this.dpr)
    const h = Math.ceil((this.height + 2 * LAYER_MARGIN) * this.dpr)
    const [below, above] = this.layers
    for (const layer of this.layers) {
      if (layer.canvas.width !== w || layer.canvas.height !== h) {
        layer.canvas.width = w
        layer.canvas.height = h
      }
      layer.ox = view.camX - m
      layer.oy = view.camY - m
    }
    this.paintLayer(below, s, () => {
      this.glowsBelow = this.drawBelow(world, sim, ov, now)
    })
    this.paintLayer(above, s, () => {
      this.glowsAbove = this.drawAbove(world, sim, ov, now)
    })
    const { stack, front } = this.stackOf(world, ov)
    above.empty = !front && !stack.some((p) => drawsOverWires(p.type))
    below.empty = false
  }

  /** A fingerprint of every part and wire: what it looks like (`look`, the same when it only moved) and where it is (`pos`). */
  private itemSigs(world: World, sim: Simulation): Sigs {
    const look = new Map<string, string>()
    const pos = new Map<string, [number, number]>()
    const vals = new Map<string, number[]>()
    const { colors, taps } = this.wireInfo(world)
    const used = usedHash(sim.net.usedKeys)
    for (const p of world.parts) {
      const live = sim.live.get(p.id)
      const board = p.type.startsWith('breadboard') ? `,${used}` : ''
      look.set(p.id, `${p.rot},${p.state.failed ? 1 : 0},${JSON.stringify(p.params)},${p.leads ? JSON.stringify(p.leads) : ''},${live ? Object.keys(live).sort().join('|') : ''}${board}`)
      if (live) vals.set(p.id, Object.keys(live).sort().map((k) => (live as Record<string, number>)[k]))
      pos.set(p.id, [p.x, p.y])
    }
    for (const w of world.wires) {
      const rel = (v: Vec): string => `${v.x - w.a.x}:${v.y - w.a.y}`
      const list = (a: Vec[]): string => a.map(rel).join(';')
      look.set(w.id, `${rel(w.b)}|${list(w.via)}|${colors.get(w.id) ?? w.color}|${list(taps.get(w.id) ?? [])}|${list(w.taps ?? [])}`)
      pos.set(w.id, [w.a.x, w.a.y])
    }
    return { look, pos, vals }
  }

  private paintLayer(layer: Layer, s: number, paint: () => void): void {
    const lc = layer.canvas.getContext('2d')!
    lc.setTransform(1, 0, 0, 1, 0, 0)
    lc.clearRect(0, 0, layer.canvas.width, layer.canvas.height)
    lc.setTransform(s, 0, 0, s, -layer.ox * s, -layer.oy * s)
    lc.imageSmoothingEnabled = false
    this.ctx = lc
    this.scale = s
    paint()
    this.ctx = this.main
  }

  /** Copy the part of a layer that is on screen. Whole device pixels, so pixel art stays sharp while panning. */
  private blit(layer: Layer, view: View): void {
    const main = this.main
    const s = this.dpr * view.zoom
    const dx = Math.round((view.camX - layer.ox) * s)
    const dy = Math.round((view.camY - layer.oy) * s)
    main.setTransform(1, 0, 0, 1, 0, 0)
    main.imageSmoothingEnabled = false
    main.drawImage(layer.canvas, dx, dy, this.canvas.width, this.canvas.height, 0, 0, this.canvas.width, this.canvas.height)
  }

  /** Wire colours and branch joins depend only on the layout, so they are worked out when the layout changes, not every frame. */
  private wireCache: { world: World; version: number; colors: Map<string, string>; taps: Map<string, Vec[]>; dots: { at: Vec; color: string; wire: string }[] } | null = null

  private wireInfo(world: World): { colors: Map<string, string>; taps: Map<string, Vec[]>; dots: { at: Vec; color: string; wire: string }[] } {
    const hit = this.wireCache
    if (hit && hit.world === world && hit.version === world.version) return hit
    const sockets = socketKeys(world)
    const colors = effectiveColors(world, sockets)
    const taps = new Map<string, Vec[]>()
    const dots: { at: Vec; color: string; wire: string }[] = []
    for (const w of world.wires) {
      const ends = tapEnds(world, w, sockets)
      taps.set(w.id, ends)
      for (const at of ends) dots.push({ at, color: colors.get(w.id) ?? w.color, wire: w.id })
    }
    this.wireCache = { world, version: world.version, colors, taps, dots }
    return this.wireCache
  }

  /** Things that are part of the circuit itself: parts, wires, leads, smoke. */
  private drawContent(world: World, sim: Simulation, ov: Overlay, now: number): void {
    replayGlows(this.ctx, this.drawBelow(world, sim, ov, now))
    if (!this.hide.dots) this.drawFlow(sim, now)
    replayGlows(this.ctx, this.drawAbove(world, sim, ov, now))
    this.drawLive(world, sim, ov, now)
  }

  /** Stacking: every part (breadboard, flat, tall, the rest), then all wires over them, then the switches; the selected part (not the board) goes on top. */
  private stackOf(world: World, ov: Overlay): { stack: PartInstance[]; front: PartInstance | undefined } {
    const sel = ov.selectedPart ? world.getPart(ov.selectedPart) : undefined
    const front = sel && layerOf(sel.type) > 0 ? sel : undefined
    return { stack: stackOrder(world.parts).filter((p) => p !== front), front }
  }

  /** The halos of the saved layers, painted over the board after each layer (see `radialGlow`). */
  private glowsBelow: GlowCall[] = []
  private glowsAbove: GlowCall[] = []

  /** Run `paint`, taking the halos it asks for instead of painting them. */
  private collectGlows(paint: () => void): GlowCall[] {
    const sink: GlowCall[] = []
    scene.glowSink = sink
    scene.glowBase = this.ctx.getTransform().inverse()
    try {
      paint()
    } finally {
      scene.glowSink = null
      scene.glowBase = null
    }
    return sink
  }

  private drawBelow(world: World, sim: Simulation, ov: Overlay, now: number): GlowCall[] {
    return this.collectGlows(() => this.paintBelow(world, sim, ov, now))
  }

  private drawAbove(world: World, sim: Simulation, ov: Overlay, now: number): GlowCall[] {
    return this.collectGlows(() => this.paintAbove(world, sim, ov, now))
  }

  /** Everything under the flowing dots: all parts, then the wires and their junction dots. */
  private paintBelow(world: World, sim: Simulation, ov: Overlay, now: number): void {
    const c = this.ctx
    const { stack } = this.stackOf(world, ov)
    if (!this.hide.parts) for (const part of stack) if (!drawsOverWires(part.type)) this.drawPart(part, sim, now, 1)
    const { colors, taps, dots: tapDots } = this.wireInfo(world)
    // every cable's shadow and outline first, then the bodies: a branch merges into its main wire with no dark seam
    const shapes = new Map<string, CableShape>()
    // a round dot wherever a branch wire joins the middle of another (same colour as the main wire)
    const dots: { at: Vec; color: string; shape?: CableShape }[] = tapDots.map((d) => ({ ...d }))
    const wires = world.wires
    if (this.pixelMode && !this.hide.wires && !this.hide.bodies) {
      for (const w of wires) {
        const shape = cableShape(wirePath(w))
        shapes.set(w.id, shape)
        drawCableBase(c, shape, colors.get(w.id) ?? w.color)
      }
      for (const d of dots) {
        d.shape = junctionShape(d.at)
        drawCableBase(c, d.shape, d.color)
      }
    }
    if (!this.hide.wires) {
      const lit = wires.filter((w) => w.id === ov.selectedWire || ov.group.wires.has(w.id))
      if (lit.length > 0 && !this.hide.selection) this.drawWireGlow(lit)
    }
    if (!this.hide.wires) for (const w of wires) this.drawWire(w, w.id === ov.selectedWire || ov.group.wires.has(w.id), colors.get(w.id) ?? w.color, shapes.get(w.id), taps.get(w.id) ?? [])
    if (!this.hide.wires && !this.hide.bodies) for (const d of dots) {
      if (d.shape) drawCableBody(c, d.shape, d.color)
      else {
        c.fillStyle = d.color
        c.beginPath()
        c.arc(d.at.x, d.at.y, 3, 0, Math.PI * 2) // vector look: 6 px across, 1.5 x the 4 px wire
        c.fill()
      }
    }
  }

  /** Over the dots: the switches, then the selected part. */
  private paintAbove(world: World, sim: Simulation, ov: Overlay, now: number): void {
    const { stack, front } = this.stackOf(world, ov)
    if (!this.hide.parts) for (const part of stack) if (drawsOverWires(part.type)) this.drawPart(part, sim, now, 1)
    if (front && !this.hide.parts) this.drawPart(front, sim, now, 1)
  }

  /** Things that move or follow the mouse: loose leads, the part being placed, smoke. */
  private drawLive(world: World, sim: Simulation, ov: Overlay, now: number): void {
    const c = this.ctx
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
      if (ov.ghost.bad) this.drawSelection(tmp, now, COL.red)
    }
    this.drawParticles()
  }

  /** Selection, handles, hints: interface elements drawn at full resolution. */
  private drawOverlay(world: World, ov: Overlay, now: number): void {
    const c = this.ctx
    const selWire = ov.selectedWire ? world.getWire(ov.selectedWire) : undefined
    if (selWire) this.drawBendHandles(selWire)
    const sel = ov.selectedPart ? world.getPart(ov.selectedPart) : undefined
    if (sel && !this.hide.selection) this.drawSelection(sel, now)
    for (const id of ov.group.parts) {
      const gp = world.getPart(id)
      if (gp && !this.hide.selection) this.drawSelection(gp, now)
    }
    for (const id of ov.badParts) {
      const bp = world.getPart(id)
      if (bp) this.drawSelection(bp, now, COL.red)
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

  /**
   * The value label of each shown part (selected, or held under the pointer), on top of the board. A part's draw function writes its
   * label as it draws; here it runs against `NO_CTX`, which swallows every other call, while `scene.labelCtx` takes the label.
   */
  private drawLabels(world: World, sim: Simulation, shown: Set<string>, now: number): void {
    if (shown.size === 0 || this.hide.parts) return
    const c = this.ctx
    scene.labeled = shown
    scene.labelPass = true
    scene.labelCtx = c
    try {
      for (const id of shown) {
        const part = world.getPart(id)
        if (!part) continue
        c.save()
        c.translate(part.x, part.y)
        c.rotate((part.rot * Math.PI) / 2)
        defOf(part.type).draw(NO_CTX, part, sim.live.get(part.id) ?? {}, now)
        c.restore()
      }
    } finally {
      scene.labelPass = false
      scene.labelCtx = null
      scene.labeled = new Set()
    }
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
      // a burnt part is painted on a scratch canvas of its own: its halo is painted there, not recorded for the board
      const sink = scene.glowSink
      scene.glowSink = null
      let a: ReturnType<typeof paintBurnt>
      try {
        a = paintBurnt(this.scratch, (sc) => def.draw(sc, part, live, now), def.bounds(part), part.id, now, this.scale)
      } finally {
        scene.glowSink = sink
      }
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

  /** Dots drifting along each wire in the direction the current flows; faster for more current, none below 1 uA. */
  private drawFlow(sim: Simulation, now: number): void {
    const c = this.ctx
    const SPACING = 22
    c.save()
    c.fillStyle = COL.flow
    for (const { path, i } of sim.flowParts) {
      if (Math.abs(i) < MIN_FLOW) continue
      let total = 0
      for (let k = 0; k + 1 < path.length; k++) total += Math.hypot(path[k + 1].x - path[k].x, path[k + 1].y - path[k].y)
      if (total < 1) continue
      const speed = Math.min(14 + 22 * Math.log10(Math.abs(i) / 1e-6), 150) // px per second
      const shift = (((now * speed * Math.sign(i)) % SPACING) + SPACING) % SPACING
      c.globalAlpha = Math.min(0.5 + 0.12 * Math.log10(Math.abs(i) / 1e-6), 0.95)
      for (let d = shift; d < total; d += SPACING) {
        let left = d
        for (let k = 0; k + 1 < path.length; k++) {
          const a = path[k]
          const b = path[k + 1]
          const len = Math.hypot(b.x - a.x, b.y - a.y)
          if (left <= len) {
            const t = len === 0 ? 0 : left / len
            // snap to the art pixel grid so the dots look like the rest of the game
            const x = Math.round((a.x + (b.x - a.x) * t) / PX) * PX
            const y = Math.round((a.y + (b.y - a.y) * t) / PX) * PX
            c.fillRect(x - PX, y - PX, PX * 2, PX * 2)
            break
          }
          left -= len
        }
      }
    }
    c.restore()
  }

  /**
   * The mark of the selected wires: a solid pixel line round each one with the same two-step glow as the dashed outline of a
   * selected part (fainter, fatter copies of the line: no blur, which is what made selecting many things stutter).
   */
  private drawWireGlow(list: Wire[]): void {
    const c = this.ctx
    if (this.pixelMode) {
      for (const w of list) drawCableSelection(c, cableShape(wirePath(w)), COL.cyan)
      return
    }
    c.save()
    c.lineCap = 'round'
    c.lineJoin = 'round'
    c.strokeStyle = COL.cyan
    c.globalAlpha = 0.45
    c.lineWidth = 9
    for (const w of list) {
      this.tracePath(wirePath(w))
      c.stroke()
    }
    c.restore()
  }

  private drawWire(w: Wire, selected: boolean, color: string, shape: CableShape | undefined, bare: Vec[]): void {
    const c = this.ctx
    const path = wirePath(w)
    c.lineCap = 'round'
    c.lineJoin = 'round'
    if (this.pixelMode) {
      c.shadowBlur = 0
      if (shape && !this.hide.bodies) drawCableBody(c, shape, color)
      if (!this.hide.caps) drawCableCaps(c, path, w.taps ?? [], bare)
      if (selected && !this.hide.selection) {
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
      if (selected && !this.hide.selection) {
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
    anchors.forEach((a, i) => {
      const tip = part.leads![i]
      const A = { x: part.x + a.x, y: part.y + a.y }
      const dir = leadDir(part, i)
      // a pixel probe's cable ends at the far end of its housing, not at the metal tip (it would show under the tip)
      const end = def.leadTip === 'probe' && this.pixelMode ? { x: tip.x, y: tip.y - dir * PROBE_CABLE_END } : tip
      const dist = Math.hypot(end.x - A.x, end.y - A.y)
      const k = Math.min(60, 20 + dist * 0.3)
      const c1 = { x: A.x, y: A.y + dir * k }
      const c2 = { x: end.x, y: end.y - dir * k }
      const col = def.leadColors?.[i] ?? '#888'
      c.lineCap = 'round'
      if (this.pixelMode) {
        // same look as the jumper wires (shadow, dark outline, lit top-left, shaded bottom-right) but smooth
        const stroke = (dx: number, dy: number, width: number, color: string) => {
          c.strokeStyle = color
          c.lineWidth = width
          c.beginPath()
          c.moveTo(A.x + dx, A.y + dy)
          c.bezierCurveTo(c1.x + dx, c1.y + dy, c2.x + dx, c2.y + dy, end.x + dx, end.y + dy)
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
  private drawSelection(part: PartInstance, now: number, color: string = COL.cyan): void {
    const c = this.ctx
    const ring = ringOf(part, defOf(part.type))
    const phase = ((Math.floor(now * 8) % 4) + 4) % 4
    const pic = ringPictures(ring, color)
    c.save()
    c.translate(part.x, part.y)
    c.rotate((part.rot * Math.PI) / 2)
    c.imageSmoothingEnabled = false
    c.drawImage(pic.pics[phase], pic.x, pic.y, pic.w * PX, pic.h * PX)
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
