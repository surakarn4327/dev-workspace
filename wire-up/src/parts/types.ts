import type { Element, ElementCurrent } from '../sim/solver.ts'
import type { Params, PartInstance, Vec } from '../board/world.ts'

export type Category = 'power' | 'passive' | 'semiconductor' | 'logic' | 'switch' | 'sensor' | 'instrument' | 'board'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface BuildCtx {
  /** Node number for each pin. */
  pins: number[]
  newNode(): number
  add(e: Element): void
  id(suffix: string): string
}

export type PartLive = Record<string, number>

export interface Env {
  pins: number[]
  v(node: number): number
  cur(id: string): ElementCurrent | undefined
  ccIds: Set<string>
}

export interface Stress {
  /** 1.0 = at the absolute maximum rating. */
  ratio: number
  /** Human explanation with real numbers. Built lazily. */
  reason: () => string
}

export interface Eval {
  live: PartLive
  stress?: Stress
}

export type Field =
  | { kind: 'select'; key: string; label: string; options: { value: string | number; label: string }[] }
  | { kind: 'range'; key: string; label: string; min: number; max: number; step: number; log?: boolean; unit?: string }
  | { kind: 'toggle'; key: string; label: string }

export interface PartDef {
  type: string
  name: string
  category: Category
  blurb: string
  /** Pins are flexible lead tips stored in part.leads. */
  freeLeads?: boolean
  fixedRot?: boolean
  pinLabels: string[]
  /** No pin label boxes on hover (the part carries its own printed markings, or has none worth showing). */
  hidePinLabels?: boolean
  /** Where pin labels sit: beside each lead along the part's axis, or straight above the pin. Default: below the pin. */
  pinLabelPlace?: 'axis' | 'side' | 'lead' | 'above' | 'below'
  /** For `pinLabelPlace: 'lead'`: the direction (local frame, before rotation) pin `index` points away from the body. */
  pinLeadDir?(index: number): Vec
  /** How far the visible lead tip sticks out past the pin point, in the label's direction (world px). Default 0. */
  tipPastPin?: number
  /** Same as `tipPastPin` for the plain vector look (pixel look off). Defaults to `tipPastPin`. */
  tipPastPinVector?: number
  defaults(): Params
  /** Pin positions in grid units, local, before rotation. For freeLeads: default tip offsets. */
  pins(p: PartInstance): Vec[]
  /** Local px anchors the flexible leads are drawn from. */
  anchors?(p: PartInstance): Vec[]
  bounds(p: PartInstance): Rect
  build(p: PartInstance, ctx: BuildCtx): void
  evaluate(p: PartInstance, env: Env): Eval
  draw(c: CanvasRenderingContext2D, p: PartInstance, live: PartLive, time: number): void
  fields(p: PartInstance): Field[]
  /** Short one-line summary for the inspector title. */
  summary(p: PartInstance): string
  /** Called on a plain click (no drag) with the click in local px. Return true if state changed. */
  click?(p: PartInstance, local: Vec): boolean
  /** Momentary parts: mouse down / up on the body. Return true if state changed. */
  press?(p: PartInstance, down: boolean): boolean
  /** Limits `press` to part of the body (local coords); a mouse down elsewhere on the part drags it. */
  pressZone?(local: Vec): boolean
  /** Parameter changed by the mouse wheel while hovering the part. */
  wheelKey?: string
  /** Colors of flexible leads. */
  leadColors?: string[]
  /** How flexible leads end: a test probe or a bare wire end. */
  leadTip?: 'probe' | 'bare'
}
