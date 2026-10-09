// SPICE-style DC solver: Modified Nodal Analysis + Newton-Raphson.
// Pure numeric code. No DOM, no canvas. Node 0 is the reference (ground).

export const VT = 0.025852 // thermal voltage at ~300 K
const GMIN = 1e-12
const MAX_ITER = 150

export type Element =
  | { kind: 'R'; id: string; a: number; b: number; r: number }
  /** Ideal voltage source. a = +, b = -. Optional current limit (constant-current mode). */
  | { kind: 'V'; id: string; a: number; b: number; v: number; iLimit?: number }
  /** Real battery: ideal EMF with series resistance (Norton form). a = +, b = -. */
  | { kind: 'B'; id: string; a: number; b: number; v: number; r: number }
  /** Current source. Current flows a -> b through the element. */
  | { kind: 'I'; id: string; a: number; b: number; i: number }
  /** Junction diode. a = anode, b = cathode. */
  | { kind: 'D'; id: string; a: number; b: number; is: number; n: number }
  /** Bipolar transistor (Ebers-Moll). pol = +1 NPN, -1 PNP. */
  | { kind: 'Q'; id: string; c: number; b: number; e: number; pol: 1 | -1; is: number; bf: number; br: number }
  /** Capacitor. Open circuit in a plain DC solve; in a transient step a conductance `c / dt` plus a source holding last step's voltage. */
  | { kind: 'K'; id: string; a: number; b: number; c: number }
  | GateElement
  | CmosGateElement

export type GateFn = 'not' | 'and' | 'or' | 'nand' | 'nor' | 'xor' | 'xnor'

/**
 * Logic gate with no supply pins. The inputs only sense (they draw no current); the output Y is a voltage source `vh * f(inputs)`
 * behind `rout`. Each input goes through a smooth step at `vth` (width `w`) so Newton can follow it.
 */
export interface GateElement {
  kind: 'G'
  id: string
  fn: GateFn
  /** Input A node, input B node (not used by NOT), output node. */
  a: number
  b?: number
  y: number
  vh: number
  vth: number
  w: number
  rout: number
  /** Node the gate measures its inputs against and drives Y relative to (default 0, ground). */
  ref?: number
}

/**
 * One gate inside a real CMOS chip (74HC). It works off the chip's own VCC and GND pins: Y is joined to VCC through
 * `f * g` and to GND through `(1 - f) * g` (`g = 1 / rout`), where `f` is the logic result of the inputs, each judged
 * against half the supply. Inputs draw no current. With no supply the output just floats between the two rails.
 */
export interface CmosGateElement {
  kind: 'C'
  id: string
  fn: GateFn
  a: number
  b?: number
  y: number
  vcc: number
  gnd: number
  rout: number
  /** Width of the input switching step, in volts. */
  w: number
}

/** One time step of a transient solve: `dt` seconds, with each capacitor's voltage (a minus b) at the start of the step, by element id. */
export interface Transient {
  dt: number
  vPrev: Map<string, number>
}

export interface Circuit {
  /** Number of nodes including ground (node 0). */
  nodeCount: number
  elements: Element[]
}

export interface ElementCurrent {
  /** a -> b through the element (Q: collector current into the device; C: current from Y into VCC). */
  i: number
  /** Q: base current into the device. C: current from Y into GND. */
  ib?: number
}

export interface SolveResult {
  /** Node voltages, index = node number, v[0] = 0. */
  v: Float64Array
  cur: Map<string, ElementCurrent>
  /** Ids of voltage sources currently limited (constant-current mode). */
  ccIds: Set<string>
  converged: boolean
  iterations: number
}

export function expSafe(x: number): number {
  return Math.exp(Math.min(x, 80))
}

function step(v: number, vth: number, w: number): number {
  return 1 / (1 + Math.exp(-Math.max(Math.min((v - vth) / w, 60), -60)))
}

/** Gate output as a fraction of `vh` and its slopes with respect to the two (smoothed) inputs. */
function gateLogic(fn: GateFn, sa: number, sb: number): { f: number; da: number; db: number } {
  switch (fn) {
    case 'not':
      return { f: 1 - sa, da: -1, db: 0 }
    case 'and':
      return { f: sa * sb, da: sb, db: sa }
    case 'nand':
      return { f: 1 - sa * sb, da: -sb, db: -sa }
    case 'or':
      return { f: sa + sb - sa * sb, da: 1 - sb, db: 1 - sa }
    case 'nor':
      return { f: 1 - (sa + sb - sa * sb), da: -(1 - sb), db: -(1 - sa) }
    case 'xor':
      return { f: sa + sb - 2 * sa * sb, da: 1 - 2 * sb, db: 1 - 2 * sa }
    case 'xnor':
      return { f: 1 - (sa + sb - 2 * sa * sb), da: -(1 - 2 * sb), db: -(1 - 2 * sa) }
  }
}

const CMOS_DV = 1e-6

/** Currents leaving a CMOS gate's Y: [to VCC, to GND]. */
function cmosBranches(e: CmosGateElement, v: (node: number) => number): [number, number] {
  const vg = v(e.gnd)
  const half = (v(e.vcc) - vg) / 2
  const vy = v(e.y)
  const sa = step(v(e.a) - vg, half, e.w)
  const sb = e.b === undefined ? 0 : step(v(e.b) - vg, half, e.w)
  const { f } = gateLogic(e.fn, sa, sb)
  const g = 1 / Math.max(e.rout, 1e-6)
  return [g * f * (vy - v(e.vcc)), g * (1 - f) * (vy - vg)]
}

function pnjlim(vnew: number, vold: number, vt: number, vcrit: number): number {
  if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / vt
      vnew = arg > 0 ? vold + vt * Math.log(arg) : vcrit
    } else {
      vnew = vt * Math.log(vnew / vt)
    }
  }
  return vnew
}

function vcritOf(nVt: number, is: number): number {
  return nVt * Math.log(nVt / (Math.SQRT2 * is))
}

/** Dense Gaussian elimination with partial pivoting. Solves in place, returns false if singular. */
export function gauss(A: Float64Array, z: Float64Array, n: number): boolean {
  for (let col = 0; col < n; col++) {
    let piv = col
    let best = Math.abs(A[col * n + col])
    for (let r = col + 1; r < n; r++) {
      const m = Math.abs(A[r * n + col])
      if (m > best) {
        best = m
        piv = r
      }
    }
    if (best < 1e-30) return false
    if (piv !== col) {
      for (let k = col; k < n; k++) {
        const t = A[col * n + k]
        A[col * n + k] = A[piv * n + k]
        A[piv * n + k] = t
      }
      const t = z[col]
      z[col] = z[piv]
      z[piv] = t
    }
    const d = A[col * n + col]
    for (let r = col + 1; r < n; r++) {
      const f = A[r * n + col] / d
      if (f === 0) continue
      for (let k = col; k < n; k++) A[r * n + k] -= f * A[col * n + k]
      z[r] -= f * z[col]
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = z[r]
    for (let k = r + 1; k < n; k++) s -= A[r * n + k] * z[k]
    z[r] = s / A[r * n + r]
  }
  return true
}

interface Newton {
  x: Float64Array
  ok: boolean
  iters: number
}

class Problem {
  readonly nNodes: number
  readonly vsrc: Element[] = []
  readonly vIndex = new Map<string, number>()
  readonly size: number
  /** Limited junction voltages from the previous Newton iteration. */
  readonly junction = new Map<string, [number, number]>()

  readonly circuit: Circuit
  /** Voltage sources forced into constant-current mode. */
  readonly cc: Map<string, number>
  readonly tran?: Transient

  constructor(circuit: Circuit, cc: Map<string, number>, tran?: Transient) {
    this.circuit = circuit
    this.cc = cc
    this.tran = tran
    this.nNodes = circuit.nodeCount - 1
    for (const e of circuit.elements) {
      if (e.kind === 'V' && !cc.has(e.id)) {
        this.vIndex.set(e.id, this.nNodes + this.vsrc.length)
        this.vsrc.push(e)
      }
    }
    this.size = this.nNodes + this.vsrc.length
  }

  idx(node: number): number {
    return node - 1
  }

  newton(x0: Float64Array, scale: number): Newton {
    const n = this.size
    let x = Float64Array.from(x0)
    this.junction.clear()
    for (let iter = 1; iter <= MAX_ITER; iter++) {
      const A = new Float64Array(n * n)
      const z = new Float64Array(n)
      const limited = this.stamp(A, z, x, scale)
      const xn = Float64Array.from(z)
      if (!gauss(A, xn, n)) return { x, ok: false, iters: iter }
      let conv = !limited
      for (let k = 0; k < n; k++) {
        if (!Number.isFinite(xn[k])) return { x, ok: false, iters: iter }
        const tol = 1e-7 + 1e-5 * Math.max(Math.abs(xn[k]), Math.abs(x[k]))
        if (Math.abs(xn[k] - x[k]) > tol) conv = false
      }
      x = xn
      if (conv && iter > 1) return { x, ok: true, iters: iter }
    }
    return { x, ok: false, iters: MAX_ITER }
  }

  private nv(x: Float64Array, node: number): number {
    return node === 0 ? 0 : x[node - 1]
  }

  private stampG(A: Float64Array, a: number, b: number, g: number): void {
    const n = this.size
    if (a > 0) A[(a - 1) * n + (a - 1)] += g
    if (b > 0) A[(b - 1) * n + (b - 1)] += g
    if (a > 0 && b > 0) {
      A[(a - 1) * n + (b - 1)] -= g
      A[(b - 1) * n + (a - 1)] -= g
    }
  }

  /** Current i flowing a -> b through an element (leaves node a, enters node b). */
  /** A nonlinear current i(x) flowing p -> q, linearised at the present x: `partials` are [node, d i / d v(node)]. */
  private stampBranch(A: Float64Array, z: Float64Array, p: number, q: number, i0: number, partials: [number, number][], v0: (node: number) => number): void {
    const n = this.size
    let known = i0
    for (const [node, j] of partials) known -= j * v0(node)
    for (const [node, j] of partials) {
      if (node === 0) continue
      if (p > 0) A[(p - 1) * n + (node - 1)] += j
      if (q > 0) A[(q - 1) * n + (node - 1)] -= j
    }
    if (p > 0) z[p - 1] -= known
    if (q > 0) z[q - 1] += known
  }

  private stampI(z: Float64Array, a: number, b: number, i: number): void {
    if (a > 0) z[a - 1] -= i
    if (b > 0) z[b - 1] += i
  }

  private stamp(A: Float64Array, z: Float64Array, x: Float64Array, scale: number): boolean {
    const n = this.size
    let limited = false
    for (let k = 0; k < this.nNodes; k++) A[k * n + k] += GMIN
    for (const e of this.circuit.elements) {
      switch (e.kind) {
        case 'R':
          this.stampG(A, e.a, e.b, 1 / Math.max(e.r, 1e-6))
          break
        case 'K':
          if (this.tran) {
            // backward Euler: i = C (v - vPrev) / dt, a conductance with a constant current in parallel
            const g = e.c / this.tran.dt
            this.stampG(A, e.a, e.b, g)
            this.stampI(z, e.a, e.b, -g * (this.tran.vPrev.get(e.id) ?? 0))
          }
          break
        case 'B': {
          const g = 1 / Math.max(e.r, 1e-6)
          this.stampG(A, e.a, e.b, g)
          // EMF pushes current out of the + terminal: through-element current b -> a
          this.stampI(z, e.b, e.a, e.v * scale * g)
          break
        }
        case 'I':
          this.stampI(z, e.a, e.b, e.i * scale)
          break
        case 'V': {
          const lim = this.cc.get(e.id)
          if (lim !== undefined) {
            this.stampI(z, e.a, e.b, lim * scale)
            break
          }
          const row = this.vIndex.get(e.id)!
          if (e.a > 0) {
            A[(e.a - 1) * n + row] += 1
            A[row * n + (e.a - 1)] += 1
          }
          if (e.b > 0) {
            A[(e.b - 1) * n + row] -= 1
            A[row * n + (e.b - 1)] -= 1
          }
          z[row] += e.v * scale
          break
        }
        case 'D': {
          const nVt = e.n * VT
          const vraw = this.nv(x, e.a) - this.nv(x, e.b)
          const prev = this.junction.get(e.id)
          const vold = prev ? prev[0] : 0
          const vd = pnjlim(vraw, vold, nVt, vcritOf(nVt, e.is))
          if (Math.abs(vd - vraw) > 1e-9) limited = true
          this.junction.set(e.id, [vd, 0])
          const ex = expSafe(vd / nVt)
          const id = e.is * (ex - 1)
          const g = (e.is / nVt) * ex + GMIN
          this.stampG(A, e.a, e.b, g)
          this.stampI(z, e.a, e.b, id - g * vd)
          break
        }
        case 'G': {
          const ref = e.ref ?? 0
          const vr = this.nv(x, ref)
          const va = this.nv(x, e.a) - vr
          const vb = e.b === undefined ? 0 : this.nv(x, e.b) - vr
          const sa = step(va, e.vth, e.w)
          const sb = e.b === undefined ? 0 : step(vb, e.vth, e.w)
          const { f, da, db } = gateLogic(e.fn, sa, sb)
          const amp = e.vh * scale
          const ta = amp * da * ((sa * (1 - sa)) / e.w)
          const tb = e.b === undefined ? 0 : amp * db * ((sb * (1 - sb)) / e.w)
          const g = 1 / Math.max(e.rout, 1e-6)
          // current out of Y into the gate: g * (vy - vref - amp * f(va - vref, vb - vref)), linearised; the reference node gets the opposite
          const rhs = g * (amp * f - ta * va - tb * vb)
          const stamp = (row: number, sign: number) => {
            if (row <= 0) return
            const r = (row - 1) * n
            const put = (col: number, v: number) => {
              if (col > 0) A[r + (col - 1)] += sign * v
            }
            put(e.y, g)
            put(ref, -g + g * ta + (e.b === undefined ? 0 : g * tb))
            put(e.a, -g * ta)
            if (e.b !== undefined) put(e.b, -g * tb)
            z[row - 1] += sign * rhs
          }
          stamp(e.y, 1)
          stamp(ref, -1)
          break
        }
        case 'C': {
          // two nonlinear branches (Y -> VCC, Y -> GND) of up to five node voltages, differentiated numerically
          const v0 = (node: number) => this.nv(x, node)
          const base = cmosBranches(e, v0)
          const nodes = new Set([e.y, e.a, e.b ?? 0, e.vcc, e.gnd])
          ;[e.vcc, e.gnd].forEach((to, k) => {
            const partials: [number, number][] = []
            for (const node of nodes) {
              if (node === 0) continue
              const bumped = cmosBranches(e, (m) => v0(m) + (m === node ? CMOS_DV : 0))[k]
              partials.push([node, (bumped - base[k]) / CMOS_DV])
            }
            this.stampBranch(A, z, e.y, to, base[k], partials, v0)
          })
          break
        }
        case 'Q': {
          const nVt = VT
          const vcrit = vcritOf(nVt, e.is)
          const vbeRaw = this.nv(x, e.b) - this.nv(x, e.e)
          const vbcRaw = this.nv(x, e.b) - this.nv(x, e.c)
          const prev = this.junction.get(e.id) ?? [0, 0]
          const u1 = pnjlim(e.pol * vbeRaw, prev[0], nVt, vcrit)
          const u2 = pnjlim(e.pol * vbcRaw, prev[1], nVt, vcrit)
          if (Math.abs(u1 - e.pol * vbeRaw) > 1e-9 || Math.abs(u2 - e.pol * vbcRaw) > 1e-9) limited = true
          this.junction.set(e.id, [u1, u2])
          const e1 = expSafe(u1 / nVt)
          const e2 = expSafe(u2 / nVt)
          const IF = e.is * (e1 - 1)
          const IR = e.is * (e2 - 1)
          const gF = (e.is / nVt) * e1 + GMIN
          const gR = (e.is / nVt) * e2 + GMIN
          const ic = e.pol * (IF - IR * (1 + 1 / e.br))
          const ib = e.pol * (IF / e.bf + IR / e.br)
          const ie = -(ic + ib)
          const aC = gF
          const bC = -gR * (1 + 1 / e.br)
          const aB = gF / e.bf
          const bB = gR / e.br
          const vbe0 = e.pol * u1
          const vbc0 = e.pol * u2
          const rows: [number, number, number, number][] = [
            [e.c, aC, bC, ic],
            [e.b, aB, bB, ib],
            [e.e, -(aC + aB), -(bC + bB), ie],
          ]
          for (const [node, a, b, i0] of rows) {
            if (node === 0) continue
            const r = (node - 1) * n
            if (e.b > 0) A[r + (e.b - 1)] += a + b
            if (e.e > 0) A[r + (e.e - 1)] -= a
            if (e.c > 0) A[r + (e.c - 1)] -= b
            z[node - 1] -= i0 - a * vbe0 - b * vbc0
          }
          break
        }
      }
    }
    return limited
  }

  currents(x: Float64Array): Map<string, ElementCurrent> {
    const out = new Map<string, ElementCurrent>()
    const nv = (node: number) => this.nv(x, node)
    for (const e of this.circuit.elements) {
      switch (e.kind) {
        case 'R':
          out.set(e.id, { i: (nv(e.a) - nv(e.b)) / Math.max(e.r, 1e-6) })
          break
        case 'K':
          out.set(e.id, { i: this.tran ? (e.c / this.tran.dt) * (nv(e.a) - nv(e.b) - (this.tran.vPrev.get(e.id) ?? 0)) : 0 })
          break
        case 'B': {
          const g = 1 / Math.max(e.r, 1e-6)
          // through-element a -> b current: (Va - Vb)*g - V*g
          out.set(e.id, { i: (nv(e.a) - nv(e.b) - e.v) * g })
          break
        }
        case 'I':
          out.set(e.id, { i: e.i })
          break
        case 'V': {
          const lim = this.cc.get(e.id)
          out.set(e.id, { i: lim !== undefined ? lim : x[this.vIndex.get(e.id)!] })
          break
        }
        case 'D': {
          const nVt = e.n * VT
          out.set(e.id, { i: e.is * (expSafe((nv(e.a) - nv(e.b)) / nVt) - 1) })
          break
        }
        case 'G': {
          const vr = nv(e.ref ?? 0)
          const sa = step(nv(e.a) - vr, e.vth, e.w)
          const sb = e.b === undefined ? 0 : step(nv(e.b) - vr, e.vth, e.w)
          const { f } = gateLogic(e.fn, sa, sb)
          // current the gate pushes out of Y into the circuit
          out.set(e.id, { i: (e.vh * f - (nv(e.y) - vr)) / Math.max(e.rout, 1e-6) })
          break
        }
        case 'C': {
          const [toVcc, toGnd] = cmosBranches(e, nv)
          out.set(e.id, { i: toVcc, ib: toGnd })
          break
        }
        case 'Q': {
          const u1 = e.pol * (nv(e.b) - nv(e.e))
          const u2 = e.pol * (nv(e.b) - nv(e.c))
          const IF = e.is * (expSafe(u1 / VT) - 1)
          const IR = e.is * (expSafe(u2 / VT) - 1)
          out.set(e.id, {
            i: e.pol * (IF - IR * (1 + 1 / e.br)),
            ib: e.pol * (IF / e.bf + IR / e.br),
          })
          break
        }
      }
    }
    return out
  }
}

function solveWith(circuit: Circuit, cc: Map<string, number>, warm?: Float64Array, tran?: Transient): { x: Float64Array; ok: boolean; iters: number; p: Problem } {
  const p = new Problem(circuit, cc, tran)
  const zero: Float64Array = new Float64Array(p.size)
  const start: Float64Array = warm && warm.length === p.size ? warm : zero
  let r = p.newton(start, 1)
  let iters = r.iters
  if (!r.ok && start !== zero) {
    r = p.newton(zero, 1)
    iters += r.iters
  }
  if (!r.ok) {
    // source stepping
    let x: Float64Array = zero
    let ok = true
    for (let k = 1; k <= 20; k++) {
      const s = p.newton(x, k / 20)
      iters += s.iters
      x = s.x
      if (!s.ok && k === 20) ok = false
    }
    r = { x, ok, iters }
  }
  return { x: r.x, ok: r.ok, iters, p }
}

export function solve(circuit: Circuit, warm?: Float64Array, tran?: Transient): SolveResult & { raw: Float64Array } {
  const cc = new Map<string, number>()
  let out = solveWith(circuit, cc, warm, tran)
  let total = out.iters
  for (let pass = 0; pass < 4; pass++) {
    let changed = false
    const cur = out.p.currents(out.x)
    for (const e of circuit.elements) {
      if (e.kind === 'V' && e.iLimit !== undefined && !cc.has(e.id)) {
        const i = cur.get(e.id)!.i
        if (Math.abs(i) > e.iLimit) {
          cc.set(e.id, Math.sign(i) * e.iLimit)
          changed = true
        }
      }
    }
    if (!changed) break
    out = solveWith(circuit, cc, undefined, tran)
    total += out.iters
  }
  const v = new Float64Array(circuit.nodeCount)
  for (let k = 1; k < circuit.nodeCount; k++) v[k] = out.x[k - 1]
  return {
    v,
    raw: out.x,
    cur: out.p.currents(out.x),
    ccIds: new Set(cc.keys()),
    converged: out.ok,
    iterations: total,
  }
}

/**
 * The longest step that follows the fastest capacitor of `circuit` well: a fortieth of the smallest `C / (conductance of the
 * resistors touching it)`. Infinity when there is no capacitor. (Backward Euler never goes unstable at a bigger step, it only
 * gets less exact.)
 */
export function transientStep(circuit: Circuit): number {
  let best = Infinity
  for (const k of circuit.elements) {
    if (k.kind !== 'K') continue
    let g = 0
    for (const e of circuit.elements) {
      if ((e.kind !== 'R' && e.kind !== 'B') || e.id.endsWith(':esr')) continue // a capacitor's own series resistance is not what it charges through
      if (e.a === k.a || e.a === k.b || e.b === k.a || e.b === k.b) g += 1 / Math.max(e.r, 1e-6)
    }
    if (g > 0) best = Math.min(best, k.c / g / 40)
  }
  return best
}

/** Most sub-steps one call of `advance` takes; a capacitor faster than that settles inside a step anyway. */
const MAX_SUBSTEPS = 200

/**
 * Let `seconds` of real time pass in a circuit with capacitors: `charge` holds each capacitor's voltage (by element id) and is
 * updated in place. Returns the solve at the end of the time. A circuit without capacitors needs no stepping and gets one
 * plain solve.
 */
export function advance(circuit: Circuit, charge: Map<string, number>, seconds: number, warm?: Float64Array): SolveResult & { raw: Float64Array } {
  const caps = circuit.elements.filter((e) => e.kind === 'K')
  if (caps.length === 0 || seconds <= 0) return solve(circuit, warm, caps.length > 0 ? { dt: 1e-9, vPrev: charge } : undefined)
  const n = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(seconds / transientStep(circuit))))
  const dt = seconds / n
  let res = solve(circuit, warm, { dt, vPrev: charge })
  for (let k = 0; ; k++) {
    // commit the step just solved
    for (const e of caps) charge.set(e.id, res.v[e.a] - res.v[e.b])
    if (k + 1 >= n) return res
    res = solve(circuit, res.raw, { dt, vPrev: charge })
  }
}
