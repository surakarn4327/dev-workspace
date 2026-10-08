import { rotVec, G, snap } from '../board/world.ts'
import type { PartInstance, Rot, Vec } from '../board/world.ts'
import { breadboardFull, breadboardMini } from './breadboard.ts'
import { meter } from './instruments.ts'
import { gateAnd, gateNand, gateNor, gateNot, gateOr, gateXnor, gateXor } from './logic.ts'
import { ldr, ntc, potentiometer, resistor } from './passives.ts'
import { battery, battery15, battery3, battery45, supply } from './power.ts'
import { bc547, bc557, diode, led } from './semis.ts'
import { pushButton, rockerSwitch, slideSwitch } from './switches.ts'
import type { Category, PartDef } from './types.ts'

export const ALL_PARTS: PartDef[] = [
  breadboardFull,
  breadboardMini,
  battery,
  battery15,
  battery3,
  battery45,
  supply,
  resistor,
  led,
  diode,
  bc547,
  bc557,
  gateNot,
  gateAnd,
  gateOr,
  gateNand,
  gateNor,
  gateXor,
  gateXnor,
  rockerSwitch,
  slideSwitch,
  pushButton,
  potentiometer,
  ldr,
  ntc,
  meter,
]

const byType = new Map<string, PartDef>(ALL_PARTS.map((d) => [d.type, d]))

export const KNOWN_TYPES = new Set(byType.keys())

/** Switch position is a live action like pressing a button on a real board: it is saved, but never an undo / redo step. */
export function isRuntimeState(p: PartInstance, key: string): boolean {
  return defOf(p.type).category === 'switch' && key === 'on'
}

export function defOf(type: string): PartDef {
  const d = byType.get(type)
  if (!d) throw new Error(`Unknown part type: ${type}`)
  return d
}

export const CATEGORY_LABELS: [Category, string][] = [
  ['power', 'Power'],
  ['passive', 'Passive'],
  ['semiconductor', 'Semis'],
  ['logic', 'Logic'],
  ['switch', 'Switches'],
  ['sensor', 'Sensors'],
  ['instrument', 'Meters'],
  ['board', 'Boards'],
]

export function newPart(id: string, type: string, x: number, y: number): PartInstance {
  const def = defOf(type)
  const p: PartInstance = {
    id,
    type,
    x: snap(x),
    y: snap(y),
    rot: 0,
    params: def.defaults(),
    leads: null,
    state: { heat: 0, failed: false, failMsg: '' },
  }
  if (def.freeLeads) p.leads = def.pins(p).map((v) => ({ x: p.x + v.x * G, y: p.y + v.y * G }))
  return p
}

/** World position of every pin of a part. */
export function pinWorld(p: PartInstance): Vec[] {
  const def = defOf(p.type)
  if (def.freeLeads && p.leads) return p.leads
  return def.pins(p).map((v) => {
    const r = rotVec({ x: v.x * G, y: v.y * G }, p.rot)
    return { x: p.x + r.x, y: p.y + r.y }
  })
}

export function rotatePart(p: PartInstance): void {
  const def = defOf(p.type)
  if (def.fixedRot) return
  p.rot = ((p.rot + 1) % 4) as Rot
}

// ---------------------------------------------------------------- stacking order

const LOW_PARTS = new Set(['resistor', 'diode'])
const TALL_PARTS = new Set(['led', 'bc547', 'bc557', 'pot', 'ldr', 'ntc', 'supply'])

/**
 * Draw layer of a part: 0 breadboard, 1 flat parts, 2 tall parts, 4 bench tools and batteries.
 * Wires are drawn between layers 2 and 4; ties keep placement order. Hit testing uses the same order.
 */
export function layerOf(type: string): number {
  if (type.startsWith('breadboard')) return 0
  if (LOW_PARTS.has(type)) return 1
  if (TALL_PARTS.has(type)) return 2
  return 4
}

/** Parts from bottom to top: by layer, then by the order they were placed. */
export function stackOrder(parts: PartInstance[]): PartInstance[] {
  return parts.map((p, i) => ({ p, i })).sort((a, b) => layerOf(a.p.type) - layerOf(b.p.type) || a.i - b.i).map((e) => e.p)
}

/**
 * Pull untrusted part settings back into what the inspector could have produced: a slider value inside its range, a
 * choice among its options (a resistance must still be above 0), a switch that is true or false. Anything else goes back
 * to the part's default, so an edited file cannot hold a 0 ohm resistor or a negative voltage.
 */
export function sanitizeParams(parts: PartInstance[]): void {
  for (const p of parts) {
    const def = defOf(p.type)
    const dflt = def.defaults()
    for (const f of def.fields(p)) {
      const v = p.params[f.key]
      const d = dflt[f.key]
      if (f.kind === 'range') {
        p.params[f.key] = typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(v, f.min), f.max) : (d ?? f.min)
      } else if (f.kind === 'toggle') {
        if (typeof v !== 'boolean') p.params[f.key] = typeof d === 'boolean' ? d : false
      } else if (f.options.every((o) => typeof o.value === 'number')) {
        if (!(typeof v === 'number' && Number.isFinite(v) && v > 0)) p.params[f.key] = d ?? f.options[0].value
      } else if (!f.options.some((o) => o.value === v)) {
        p.params[f.key] = d ?? f.options[0].value
      }
    }
  }
}
