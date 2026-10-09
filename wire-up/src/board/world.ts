// Workspace data model: placed parts + free wires. No physics, no drawing.

export const G = 20 // world px between breadboard holes (0.1 inch)

export interface Vec {
  x: number
  y: number
}

export type Rot = 0 | 1 | 2 | 3
export type ParamValue = number | string | boolean
export type Params = Record<string, ParamValue>

export interface PartState {
  /** 0..1 thermal/electrical stress accumulator. 1 = burnt. */
  heat: number
  failed: boolean
  failMsg: string
}

export interface PartInstance {
  id: string
  type: string
  x: number
  y: number
  rot: Rot
  params: Params
  /** Absolute world positions of flexible lead tips (battery leads, meter probes). */
  leads: Vec[] | null
  state: PartState
}

export interface Wire {
  id: string
  a: Vec
  b: Vec
  /** Bend points between a and b. The wire runs along the grid: a -> via... -> b. */
  via: Vec[]
  /** Corners that were once plugged ends: still electrically joined to the wire (a wire pulled out from a pin keeps its hold on it). */
  taps?: Vec[]
  color: string
}

export function wirePath(w: Wire): Vec[] {
  return [w.a, ...w.via, w.b]
}

function cloneWire(w: Wire): Wire {
  const out: Wire = { id: w.id, a: cloneVec(w.a), b: cloneVec(w.b), via: w.via.map(cloneVec), color: w.color }
  if (w.taps && w.taps.length > 0) out.taps = w.taps.map(cloneVec)
  return out
}

export const WIRE_COLORS = ['#ff4a4a', '#2f6fe0', '#2ea043', '#f2d21b', '#f08a1c', '#f2f2f2', '#0b0b0b', '#8a45d6']

export function snap(v: number): number {
  return Math.round(v / G) * G
}

export function rotVec(v: Vec, rot: Rot): Vec {
  switch (rot) {
    case 0:
      return { x: v.x, y: v.y }
    case 1:
      return { x: -v.y, y: v.x }
    case 2:
      return { x: -v.x, y: -v.y }
    default:
      return { x: v.y, y: -v.x }
  }
}

export function unrotVec(v: Vec, rot: Rot): Vec {
  return rotVec(v, ((4 - rot) % 4) as Rot)
}

export function pointKey(p: Vec): string {
  return `${Math.round(p.x)},${Math.round(p.y)}`
}

export interface WorldData {
  version: number
  counter: number
  parts: PartInstance[]
  wires: Wire[]
}

function cloneVec(v: Vec): Vec {
  return { x: v.x, y: v.y }
}

function clonePart(p: PartInstance): PartInstance {
  return {
    id: p.id,
    type: p.type,
    x: p.x,
    y: p.y,
    rot: p.rot,
    params: { ...p.params },
    leads: p.leads ? p.leads.map(cloneVec) : null,
    state: { ...p.state },
  }
}

/** Parts whose legs hang below the body and have an adjustable length. */
export const HANGING_LEG_PARTS = new Set(['led', 'bc547', 'bc557', 'pot', 'ldr', 'ntc', 'cap-ceramic', 'cap-electro'])

export class World {
  parts: PartInstance[] = []
  wires: Wire[] = []
  private counter = 1
  /**
   * Parts and wires of a fresh paste (or a part clicked in) that sit on something they were not drawn to, shown red: each maps to its
   * group. Items of one group are joined to each other but to nothing outside it, until moved clear. Not saved.
   */
  isolated = new Map<string, string>()
  /** Bumped on any change that needs the circuit rebuilt. */
  version = 0
  /** Bumped on any change worth an undo step / autosave. */
  revision = 0

  nextId(prefix: string): string {
    return `${prefix}${this.counter++}`
  }

  /** Circuit changed (needs re-solve) but not a user-level edit. */
  touch(): void {
    this.version++
  }

  /** User-level edit: re-solve + undo step + autosave. */
  commit(): void {
    this.version++
    this.revision++
  }

  getPart(id: string): PartInstance | undefined {
    return this.parts.find((p) => p.id === id)
  }

  getWire(id: string): Wire | undefined {
    return this.wires.find((w) => w.id === id)
  }

  removePart(id: string): void {
    this.parts = this.parts.filter((p) => p.id !== id)
  }

  /**
   * Wires whose two ends ended up on the same point (a part dragged until both its pins met) are invisible and joined
   * nothing the shared point does not already join: drop them. Returns how many went.
   */
  dropEmptyWires(): number {
    const before = this.wires.length
    this.wires = this.wires.filter((w) => !(w.a.x === w.b.x && w.a.y === w.b.y && w.via.length === 0))
    return before - this.wires.length
  }

  removeWire(id: string): void {
    this.wires = this.wires.filter((w) => w.id !== id)
  }

  addWire(a: Vec, b: Vec, color = WIRE_COLORS[0], via: Vec[] = []): Wire {
    const w: Wire = { id: this.nextId('w'), a: cloneVec(a), b: cloneVec(b), via: via.map(cloneVec), color }
    this.wires.push(w)
    return w
  }

  clear(): void {
    this.parts = []
    this.wires = []
    this.counter = 1
    this.commit()
  }

  serialize(): WorldData {
    return {
      version: 1,
      counter: this.counter,
      parts: this.parts.map(clonePart),
      wires: this.wires.map(cloneWire),
    }
  }

  load(data: WorldData): void {
    this.parts = data.parts.map(clonePart)
    // momentary controls (push buttons) never come back held down
    for (const p of this.parts) if ('pressed' in p.params) p.params.pressed = false
    // leg length: the axial parts (resistor, diode) now store `legs` (pin spacing - 2); the hanging-leg parts keep
    // their old short legs (0) unless they carry a value
    for (const p of this.parts) {
      if (typeof p.params.legs === 'number') continue
      if (p.type === 'resistor' || p.type === 'diode') {
        p.params.legs = (typeof p.params.spread === 'number' ? p.params.spread : 4) - 2
        delete p.params.spread
      } else if (HANGING_LEG_PARTS.has(p.type)) {
        p.params.legs = 0
      }
    }
    this.wires = data.wires.map(cloneWire)
    this.counter = data.counter
    this.version++
  }
}

function isNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x)
}

function isVec(x: unknown): x is Vec {
  return typeof x === 'object' && x !== null && isNum((x as Vec).x) && isNum((x as Vec).y)
}

/** Validate untrusted JSON (import / localStorage). Returns data or an error string. */
export function validateWorldData(raw: unknown, knownTypes: Set<string>): WorldData | string {
  if (typeof raw !== 'object' || raw === null) return 'Not a Wire-Up file.'
  const d = raw as Record<string, unknown>
  if (d.version !== 1) return `Unsupported file version: ${String(d.version)}.`
  if (!isNum(d.counter) || !Array.isArray(d.parts) || !Array.isArray(d.wires)) return 'File is missing parts or wires.'
  const parts: PartInstance[] = []
  const ids = new Set<string>()
  for (const p of d.parts as Record<string, unknown>[]) {
    if (typeof p !== 'object' || p === null) return 'Bad part entry.'
    if (typeof p.id !== 'string' || ids.has(p.id)) return 'Part has a missing or duplicate id.'
    if (typeof p.type !== 'string' || !knownTypes.has(p.type)) return `Unknown part type: ${String(p.type)}.`
    if (!isNum(p.x) || !isNum(p.y) || !isNum(p.rot) || p.rot < 0 || p.rot > 3) return `Part ${p.id} has a bad position.`
    if (typeof p.params !== 'object' || p.params === null) return `Part ${p.id} has bad parameters.`
    const params: Params = {}
    for (const [k, v] of Object.entries(p.params as Record<string, unknown>)) {
      if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') params[k] = v
    }
    let leads: Vec[] | null = null
    if (p.leads !== null && p.leads !== undefined) {
      if (!Array.isArray(p.leads) || !p.leads.every(isVec)) return `Part ${p.id} has bad leads.`
      leads = (p.leads as Vec[]).map(cloneVec)
    }
    const st = (p.state ?? {}) as Record<string, unknown>
    ids.add(p.id)
    parts.push({
      id: p.id,
      type: p.type,
      x: p.x,
      y: p.y,
      rot: p.rot as Rot,
      params,
      leads,
      state: {
        heat: isNum(st.heat) ? Math.min(Math.max(st.heat, 0), 1) : 0,
        failed: st.failed === true,
        failMsg: typeof st.failMsg === 'string' ? st.failMsg : '',
      },
    })
  }
  const wires: Wire[] = []
  const wireIds = new Set<string>()
  for (const w of d.wires as Record<string, unknown>[]) {
    if (typeof w !== 'object' || w === null || typeof w.id !== 'string') return 'Bad wire entry.'
    if (wireIds.has(w.id)) return `Duplicate wire id: ${w.id}.`
    wireIds.add(w.id)
    if (!isVec(w.a) || !isVec(w.b)) return `Wire ${w.id} has bad endpoints.`
    const via = Array.isArray(w.via) && w.via.every(isVec) ? (w.via as Vec[]).map(cloneVec) : []
    wires.push({
      id: w.id,
      a: cloneVec(w.a),
      b: cloneVec(w.b),
      via,
      color: typeof w.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(w.color) ? w.color : WIRE_COLORS[0],
    })
    const taps = Array.isArray(w.taps) && w.taps.every(isVec) ? (w.taps as Vec[]).map(cloneVec) : []
    if (taps.length > 0) wires[wires.length - 1].taps = taps
  }
  // the id counter must stay ahead of every id in the file, or the next new part or wire would reuse one
  let counter = d.counter
  for (const id of [...ids, ...wireIds]) {
    const n = /([0-9]+)$/.exec(id)
    if (n) counter = Math.max(counter, Number(n[1]) + 1)
  }
  return { version: 1, counter, parts, wires }
}
