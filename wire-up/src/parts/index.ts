import { rotVec, G, snap } from '../board/world.ts'
import type { PartInstance, Rot, Vec } from '../board/world.ts'
import { breadboardFull, breadboardMini } from './breadboard.ts'
import { meter } from './instruments.ts'
import { ldr, ntc, potentiometer, resistor } from './passives.ts'
import { battery, supply } from './power.ts'
import { bc547, bc557, diode, led } from './semis.ts'
import { pushButton, slideSwitch } from './switches.ts'
import type { Category, PartDef } from './types.ts'

export const ALL_PARTS: PartDef[] = [
  breadboardFull,
  breadboardMini,
  battery,
  supply,
  resistor,
  led,
  diode,
  bc547,
  bc557,
  slideSwitch,
  pushButton,
  potentiometer,
  ldr,
  ntc,
  meter,
]

const byType = new Map<string, PartDef>(ALL_PARTS.map((d) => [d.type, d]))

export const KNOWN_TYPES = new Set(byType.keys())

export function defOf(type: string): PartDef {
  const d = byType.get(type)
  if (!d) throw new Error(`Unknown part type: ${type}`)
  return d
}

export const CATEGORY_LABELS: [Category, string][] = [
  ['power', 'Power'],
  ['passive', 'Passive'],
  ['semiconductor', 'Semis'],
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
