import type { Element, ElementCurrent } from '../sim/solver.ts'
import type { Params, PartInstance, Vec } from '../board/world.ts'
import type { I2cDevice } from '../mcu/i2c.ts'

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
  /** Node a symbol-level part (a logic gate, which has no ground pin) measures against: the negative of the source in its own circuit. */
  ref: number
  /** Is anything else on this pin's net? (a chip's supply pin with nothing wired to it reads false) */
  wired(pin: number): boolean
  /** Seconds on the simulation clock when this circuit was built (for parts whose behaviour wanders with time). */
  time: number
  /** Call when the part needs rebuilding as time passes (a floating input drifts): the simulation re-solves every few tenths of a second. */
  animate(): void
  newNode(): number
  add(e: Element): void
  id(suffix: string): string
}

export type PartLive = Record<string, number>

export interface Env {
  pins: number[]
  /** See `BuildCtx.ref`. */
  ref: number
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
  /** For parts whose number of pins follows a setting: the names of this instance's pins (`pinLabels` is then the default shape). */
  pinLabelsOf?(p: PartInstance): string[]
  /** No pin label boxes on hover (the part carries its own printed markings, or has none worth showing). */
  hidePinLabels?: boolean
  /** Where pin labels sit: beside each lead along the part's axis, or straight above the pin. Default: below the pin. */
  pinLabelPlace?: 'axis' | 'side' | 'lead' | 'above' | 'below'
  /** For `pinLabelPlace: 'lead'`: the direction (local frame, before rotation) pin `index` points away from the body. */
  pinLeadDir?(index: number): Vec
  /** Per-pin override of `tipPastPin` (both looks). */
  pinTipPast?(index: number, pixel: boolean): number
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
  /** A finer test than `bounds` for a click (local px, already inside `bounds`): the shape of the part, for one that is not a plain box. */
  hitAt?(p: PartInstance, local: Vec): boolean
  build(p: PartInstance, ctx: BuildCtx): void
  evaluate(p: PartInstance, env: Env): Eval
  draw(c: CanvasRenderingContext2D, p: PartInstance, live: PartLive, time: number): void
  /** A second, small pass drawn ABOVE the wires (same transform as `draw`): for the one piece that wires must seem to go into. */
  drawOver?(c: CanvasRenderingContext2D, p: PartInstance, live: PartLive, time: number): void
  fields(p: PartInstance): Field[]
  /** Short one-line summary for the inspector title. */
  summary(p: PartInstance): string
  /** Called on a plain click (no drag) with the click in local px. Return true if state changed. */
  click?(p: PartInstance, local: Vec): boolean
  /** Where in the body (local px) a plain click does something: the pointer cursor shows there. */
  clickZone?(p: PartInstance, local: Vec): boolean
  /** The ring drawn round the clickable spot while the pointer is over `clickZone` (local px centre and radius): says "this can be clicked". */
  clickHint?(p: PartInstance): { x: number; y: number; r: number }
  /** Settings flipped by `click` that are live actions like a switch: saved, but never an undo / redo step. */
  runtimeKeys?: string[]
  /** For a part that is a voltage source of its own (a board powered over USB): the pin index of its negative terminal while it is one. */
  sourceNegPin?(p: PartInstance): number | null
  /** Momentary parts: mouse down / up on the body. Return true if state changed. */
  press?(p: PartInstance, down: boolean): boolean
  /** Limits `press` to part of the body (local coords); a mouse down elsewhere on the part drags it. */
  pressZone?(local: Vec): boolean
  /**
   * A part that sits on the I2C bus: which of its pins are the bus and the supply, and how to make the device that answers on it.
   * The simulation keeps one device per such part and connects it to every board whose SDA and SCL are on the same nets.
   */
  i2c?: { sda: number; scl: number; vcc: number; gnd: number; create(p: PartInstance): I2cDevice }
  /** Parameter changed by the mouse wheel while hovering the part. */
  wheelKey?: string
  /** Colors of flexible leads. */
  leadColors?: string[]
  /** How flexible leads end: a test probe or a bare wire end. */
  leadTip?: 'probe' | 'bare'
}
