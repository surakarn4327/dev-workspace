import { arduinoUno } from './arduino.ts'
import { seg7, seg7x4 } from './display.ts'
import { lcd1602i2c } from './lcd.ts'
import { hc00, hc02, hc04, hc08, hc32, hc86, ne555 } from './ic.ts'
import { rotVec, G, snap } from '../board/world.ts'
import type { PartInstance, Rot, Vec } from '../board/world.ts'
import { breadboardFull, breadboardMini } from './breadboard.ts'
import { meter } from './instruments.ts'
import { relayModule } from './relay.ts'
import { gateAnd, gateNand, gateNor, gateNot, gateOr, gateXnor, gateXor } from './logic.ts'
import { ceramicCap, electroCap, ldr, ntc, potentiometer, resistor } from './passives.ts'
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
  ceramicCap,
  electroCap,
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
  hc00,
  hc02,
  hc04,
  hc08,
  hc32,
  hc86,
  ne555,
  relayModule,
  arduinoUno,
  seg7,
  seg7x4,
  lcd1602i2c,
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

/** Switch position (and a board's USB plug, `PartDef.runtimeKeys`) is a live action like pressing a button on a real board: it is saved, but never an undo / redo step. */
export function isRuntimeState(p: PartInstance, key: string): boolean {
  const def = defOf(p.type)
  return (def.category === 'switch' && key === 'on') || (def.runtimeKeys?.includes(key) ?? false)
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

/** The names of a part's pins: per instance when the number of pins follows a setting (a relay module's channels). */
export function pinNamesOf(p: PartInstance): string[] {
  const def = defOf(p.type)
  return def.pinLabelsOf ? def.pinLabelsOf(p) : def.pinLabels
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

/** Which side of the part lead `i` hangs from: -1 when its anchor is in the top half of the body, 1 in the bottom half. */
export function leadDir(p: PartInstance, i: number): -1 | 1 {
  const def = defOf(p.type)
  const a = def.anchors?.(p)[i]
  return a && a.y >= def.bounds(p).h / 2 ? 1 : -1
}

export function rotatePart(p: PartInstance): void {
  const def = defOf(p.type)
  if (def.fixedRot) return
  p.rot = ((p.rot + 1) % 4) as Rot
}

// ---------------------------------------------------------------- stacking order

/**
 * Stacking is by birth: everything (parts and wires alike) is drawn in the order it was created, so what was placed, pasted or
 * drawn later lies over what came before. The one exception is the breadboard (layer 0), which is always the ground under
 * everything. The selected part is drawn on top. Hit testing uses the same order.
 */
export function layerOf(type: string): number {
  return type.startsWith('breadboard') ? 0 : 1
}

/** When a part or wire was born: the number in its id (ids come from one counter, so this is the order across both kinds). */
export function seqOf(id: string): number {
  const n = /(\d+)$/.exec(id)
  return n ? Number(n[1]) : 0
}

/**
 * Where each wire sits in the birth order. Wires keep the order of the wire list among themselves (as before); against parts a
 * wire counts as born no earlier than the wires before it in the list, so the order never goes backwards along the list.
 */
export function wireSeqs(wires: { id: string }[]): Map<string, number> {
  const out = new Map<string, number>()
  let top = 0
  for (const w of wires) {
    top = Math.max(top, seqOf(w.id))
    out.set(w.id, top)
  }
  return out
}

/** Parts from bottom to top: the breadboards, then by birth. */
export function stackOrder(parts: PartInstance[]): PartInstance[] {
  return parts
    .map((p, i) => ({ p, i }))
    .sort((a, b) => layerOf(a.p.type) - layerOf(b.p.type) || seqOf(a.p.id) - seqOf(b.p.id) || a.i - b.i)
    .map((e) => e.p)
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
