// Mission-style lessons. Data-driven: each step is a live check against the real simulation.

import type { Simulation } from '../board/simulation.ts'
import { leadPins } from '../board/obstacles.ts'
import { routeVia } from '../board/router.ts'
import { G, HANGING_LEG_PARTS } from '../board/world.ts'
import type { PartInstance, Vec, World } from '../board/world.ts'
import { boardHoles } from '../parts/breadboard.ts'
import { newPart, pinWorld } from '../parts/index.ts'
import type { PartLive } from '../parts/types.ts'

export interface LessonCtx {
  world: World
  sim: Simulation
  memo: Record<string, number | boolean>
  parts(type: string): PartInstance[]
  live(part: PartInstance): PartLive
  nodes(part: PartInstance): number[]
  onBoard(part: PartInstance): boolean
  ledsLit(): PartInstance[]
}

export interface LessonStep {
  text: string
  hint: string
  check(ctx: LessonCtx): boolean
}

export interface Lesson {
  id: string
  title: string
  tagline: string
  story: string
  steps: LessonStep[]
  setup(b: SceneBuilder): void
}

export class SceneBuilder {
  boardAt: Vec = { x: 0, y: 0 }
  readonly world: World

  constructor(world: World) {
    this.world = world
  }

  /** Position of breadboard hole (column 1..30, row index in the layout). */
  hole(col: number, row: number): Vec {
    return { x: this.boardAt.x + (col - 1) * G, y: this.boardAt.y + row * G }
  }

  place(type: string, x: number, y: number, params: Record<string, number | string | boolean> = {}): PartInstance {
    const p = newPart(this.world.nextId('p'), type, x, y)
    Object.assign(p.params, params)
    // missions and tests keep the original geometry: spread:n becomes legs = n - 2, and parts without a leg
    // length keep their old short legs
    if (type === 'resistor' || type === 'diode') {
      if (typeof p.params.spread === 'number') {
        p.params.legs = p.params.spread - 2
        delete p.params.spread
      } else if (typeof params.legs !== 'number') p.params.legs = 2
    } else if (HANGING_LEG_PARTS.has(type) && typeof params.legs !== 'number') p.params.legs = 0
    if (type.startsWith('breadboard')) this.world.parts.unshift(p)
    else this.world.parts.push(p)
    return p
  }

  board(): PartInstance {
    const b = this.place('breadboard', this.boardAt.x, this.boardAt.y)
    return b
  }

  wire(a: Vec, b: Vec, color = '#ff4a4a'): void {
    this.world.addWire(a, b, color, routeVia(a, b, this.world.wires, [], leadPins(this.world)))
  }

  /** Wire a two-pin part's pins to two points, replacing any wires already on those pins (test and mission helper). */
  connect(part: PartInstance, a: Vec, b: Vec): void {
    const pins = pinWorld(part)
    const onPin = (v: Vec) => pins.some((p) => p.x === v.x && p.y === v.y)
    this.world.wires = this.world.wires.filter((w) => !onPin(w.a) && !onPin(w.b))
    this.wire(pins[0], a)
    this.wire(pins[1], b, '#2f6fe0')
  }
}

// Breadboard rows: rails 0 (+) and 1 (-) on top, 16/17 at the bottom; top half 3..7; bottom half 10..14.

function lit(ctx: LessonCtx, lo = 0.004, hi = 0.028): boolean {
  return ctx.ledsLit().some((l) => {
    const i = ctx.live(l).i ?? 0
    return i >= lo && i <= hi
  })
}

function meters(ctx: LessonCtx): PartInstance[] {
  return ctx.parts('meter')
}

function probesConnected(ctx: LessonCtx, m: PartInstance): boolean {
  const n = ctx.nodes(m)
  return n.length === 2 && n[0] !== n[1] && ctx.sim.net.nodeAt(m.leads![0]) !== undefined && ctx.sim.net.nodeAt(m.leads![1]) !== undefined
}

export const LESSONS: Lesson[] = [
  {
    id: 'first-light',
    title: '1. First light',
    tagline: 'Light an LED the safe way',
    story:
      'An LED is a diode: current flows one way and nothing limits it except you. A resistor in series keeps the current at a safe level. Build the loop: battery +, resistor, LED, battery -.',
    setup(b) {
      b.board()
      b.place('battery', -320, 80, { volts: 9 })
    },
    steps: [
      {
        text: 'Plug a resistor into the breadboard (any value from 220 to 1k works).',
        hint: 'Open the Passive tab on the left and drag a Resistor onto the board. Its two legs must land in holes.',
        check: (c) => c.parts('resistor').some((r) => c.onBoard(r)),
      },
      {
        text: 'Plug an LED in so one leg shares a column with the resistor.',
        hint: 'Holes in the same column of five (A-E or F-J) are connected under the board. The LED leg and a resistor leg must sit in the same column.',
        check: (c) =>
          c.parts('led').some((l) => c.onBoard(l) && c.parts('resistor').some((r) => c.nodes(r).some((n) => c.nodes(l).includes(n)))),
      },
      {
        text: 'Wire the battery: its left terminal (+) and right terminal (-) so the LED glows.',
        hint: 'The longer LED leg (anode, marked +) must face the battery +. Drag from a battery terminal to a hole to pull a wire. Current path: + -> resistor -> LED -> -.',
        check: (c) => lit(c),
      },
    ],
  },
  {
    id: 'too-much',
    title: '2. Smoke test',
    tagline: 'See what no resistor does',
    story:
      'Everything breaks if you push it past its rating. Here you will break something on purpose, read the explanation, then fix the circuit.',
    setup(b) {
      b.board()
      b.place('battery', -320, 80, { volts: 9 })
      b.place('led', 200, 80, { color: 'red' })
    },
    steps: [
      {
        text: 'Wire the LED straight across the 9 V battery, with no resistor, and burn it.',
        hint: 'Put the LED on the board and connect + to the anode, - to the cathode. Nothing limits the current, so it will be far above 30 mA.',
        check: (c) => c.parts('led').some((l) => l.state.failed) && !!(c.memo.burnt = true),
      },
      {
        text: 'Read the incident message, then select the dead LED and press Replace part.',
        hint: 'Click the burnt LED. In the right panel press "Replace part" to put in a fresh one.',
        check: (c) => !!c.memo.burnt && c.parts('led').length > 0 && c.parts('led').every((l) => !l.state.failed),
      },
      {
        text: 'Add a resistor so the new LED lights and survives.',
        hint: 'Insert a 470 ohm resistor in series. Current = (9 V - 1.9 V) / 470 = about 15 mA.',
        check: (c) => c.parts('resistor').length > 0 && lit(c),
      },
    ],
  },
  {
    id: 'pick-resistor',
    title: '3. Pick the resistor',
    tagline: 'Ohm\'s law in practice',
    story:
      'Which resistor gives exactly 10 mA? Use R = (Vsupply - Vf) / I. Red LED Vf is about 1.9 V.',
    setup(b) {
      b.board()
      b.place('battery', -320, 80, { volts: 9 })
      b.place('led', 200, 80, { color: 'red' })
      b.place('resistor', 200, 220, { value: 1000 })
    },
    steps: [
      {
        text: 'Build a working LED circuit (the LED must glow).',
        hint: 'Resistor and LED in series between battery + and -.',
        check: (c) => lit(c),
      },
      {
        text: 'Make the LED current between 8 and 12 mA.',
        hint: '(9 - 1.9) / 0.010 = 710 ohm. The nearest standard value is 680 ohm. Select the resistor and change its value in the right panel.',
        check: (c) => lit(c, 0.008, 0.012),
      },
      {
        text: 'Select the LED and read its current in the inspector to confirm.',
        hint: 'The inspector lists live current and voltage for the selected part.',
        check: (c) => lit(c, 0.0085, 0.0115),
      },
    ],
  },
  {
    id: 'switch-it',
    title: '4. Switch it',
    tagline: 'Open and close the loop',
    story: 'A switch just opens or closes the loop. No loop, no current.',
    setup(b) {
      b.board()
      b.place('battery', -320, 80, { volts: 9 })
      b.place('led', 200, 80, { color: 'green' })
      b.place('resistor', 200, 200, { value: 470 })
      b.place('switch', 340, 100)
    },
    steps: [
      {
        text: 'Build the LED circuit with the slide switch in series, switch ON: LED glows.',
        hint: 'Chain: battery + -> switch -> resistor -> LED -> battery -. Click the switch to flip it.',
        check: (c) => c.parts('switch').some((s) => s.params.on === true) && lit(c) && !!(c.memo.sawOn = true),
      },
      {
        text: 'Flip the switch OFF: the LED goes dark.',
        hint: 'Click the switch body.',
        check: (c) => c.parts('switch').some((s) => s.params.on !== true) && c.parts('led').length > 0 && c.ledsLit().length === 0 && !!c.memo.sawOn,
      },
    ],
  },
  {
    id: 'divider',
    title: '5. Voltage divider',
    tagline: 'Measure with the multimeter',
    story:
      'Two resistors in series split the voltage: Vout = Vin x R2 / (R1 + R2). Build a divider on the 9 V battery that gives about 3 V and prove it with the meter.',
    setup(b) {
      b.board()
      b.place('battery', -320, 80, { volts: 9 })
      b.place('resistor', 160, 200, { value: 10000 })
      b.place('resistor', 160, 260, { value: 4700 })
      b.place('meter', 640, 40, { mode: 'V' })
    },
    steps: [
      {
        text: 'Wire both resistors in series across the battery (current must flow).',
        hint: 'Battery + -> R1 -> R2 -> battery -. Put R1 and R2 so they share one column.',
        check: (c) => c.parts('resistor').filter((r) => Math.abs(c.live(r).i ?? 0) > 1e-5).length >= 2,
      },
      {
        text: 'Put the meter probes on the two ends of the lower resistor.',
        hint: 'Meter in DC Volts mode. Red probe on the middle point, black probe on the battery - side. Drag the probe tips onto holes.',
        check: (c) => meters(c).some((m) => m.params.mode === 'V' && probesConnected(c, m)),
      },
      {
        text: 'Read between 2.7 V and 3.3 V on the meter.',
        hint: 'Vout = 9 x R2 / (R1 + R2). With R1 = 10k, R2 = 4.7k you get 2.9 V.',
        check: (c) =>
          meters(c).some((m) => {
            const v = Math.abs(c.live(m).v ?? 0)
            return m.params.mode === 'V' && probesConnected(c, m) && v >= 2.7 && v <= 3.3
          }),
      },
    ],
  },
  {
    id: 'ammeter',
    title: '6. Current in series',
    tagline: 'Measure amps, protect the fuse',
    story:
      'To measure current the meter must become part of the loop. It acts like a wire, so connecting it across a battery shorts it and blows the 200 mA fuse. This circuit has a jumper wire: remove it and let the meter take its place.',
    setup(b) {
      b.board()
      b.place('battery', -320, 80, { volts: 9 })
      b.place('meter', 640, 40, { mode: 'A' })
      b.place('resistor', b.hole(5, 7).x, b.hole(5, 7).y, { value: 470, spread: 4 })
      b.place('led', b.hole(10, 7).x, b.hole(10, 7).y, { color: 'yellow' })
      b.wire(b.hole(9, 6), b.hole(10, 6), '#f2d21b')
      b.wire(b.hole(11, 5), b.hole(11, 1), '#2f6fe0')
    },
    steps: [
      {
        text: 'Connect the battery + to the resistor and the battery - so the LED glows.',
        hint: 'Left terminal (+) to column 5 (the resistor left end). Right terminal (-) to any hole of the top blue (-) rail; the blue wire already links the LED cathode to that rail.',
        check: (c) => lit(c),
      },
      {
        text: 'Put the meter in series so it reads the LED current in AMPS mode.',
        hint: 'Select the yellow jumper wire and press Delete. Then touch the red probe to one side of the gap and the black probe to the other.',
        check: (c) =>
          meters(c).some((m) => {
            const i = Math.abs(c.live(m).i ?? 0)
            return m.params.mode === 'A' && !m.state.failed && probesConnected(c, m) && i > 0.001 && i < 0.03
          }) && lit(c),
      },
    ],
  },
  {
    id: 'transistor',
    title: '7. Transistor switch',
    tagline: 'Small current controls a big one',
    story:
      'An NPN transistor lets a tiny base current switch a bigger collector current. Wire an LED with its resistor between + and the collector, tie the emitter to -, and feed the base through a 10k resistor from + when you press the button.',
    setup(b) {
      b.board()
      b.place('battery', -320, 80, { volts: 9 })
      b.place('bc547', 220, 300)
      b.place('button', 400, 280)
      b.place('led', 560, 280, { color: 'blue' })
    },
    steps: [
      {
        text: 'Wire the LED + 470 ohm resistor + transistor collector-to-emitter path across the battery.',
        hint: 'Battery + -> resistor -> LED anode; LED cathode -> collector (C); emitter (E) -> battery -.',
        check: (c) => c.parts('bc547').some((q) => c.onBoard(q)) && c.parts('resistor').length > 0 && c.parts('led').length > 0,
      },
      {
        text: 'Feed the base through a 10k resistor and the push button from battery +.',
        hint: 'Battery + -> button -> 10k -> base (B). Hold the mouse on the button to press it.',
        check: (c) => c.parts('button').length > 0 && c.parts('resistor').some((r) => (r.params.value as number) >= 4700),
      },
      {
        text: 'Hold the button: the LED lights and collector current is far bigger than base current.',
        hint: 'Select the transistor while holding the button (or watch the LED). Ic = hFE x Ib in the active region.',
        check: (c) =>
          c.parts('bc547').some((q) => {
            const l = c.live(q)
            return Math.abs(l.ic ?? 0) > 0.004 && Math.abs(l.ib ?? 0) > 1e-5 && Math.abs(l.ic ?? 0) > 10 * Math.abs(l.ib ?? 0)
          }) && lit(c),
      },
    ],
  },
  {
    id: 'light-sensor',
    title: '8. Light sensor',
    tagline: 'A divider that sees',
    story:
      'A light-dependent resistor changes resistance with brightness. Put it in a divider with a 10k resistor and the output voltage follows the light. Slide the light level and watch the meter.',
    setup(b) {
      b.board()
      b.place('battery', -320, 80, { volts: 9 })
      b.place('ldr', 160, 200, { lux: 100 })
      b.place('resistor', 160, 280, { value: 10000 })
      b.place('meter', 640, 40, { mode: 'V' })
    },
    steps: [
      {
        text: 'Wire the light sensor and the 10k resistor in series across the battery.',
        hint: 'Battery + -> LDR -> 10k -> battery -. Make sure they share a column.',
        check: (c) => c.parts('ldr').some((l) => Math.abs(c.live(l).i ?? 0) > 1e-6),
      },
      {
        text: 'Meter (Volts) across the 10k resistor: read the voltage at dim light (under 3 V).',
        hint: 'Select the LDR and set Light level low (e.g. 5 lx). Dark = high LDR resistance = low voltage on the 10k.',
        check: (c) =>
          meters(c).some((m) => {
            if (m.params.mode !== 'V' || !probesConnected(c, m)) return false
            const v = Math.abs(c.live(m).v ?? 0)
            if (v < 3) c.memo.dim = true
            if (v > 6) c.memo.bright = true
            return !!c.memo.dim
          }),
      },
      {
        text: 'Now make it bright (set the light level high): the reading jumps above 6 V.',
        hint: 'Light level 5000 lx or more. The LDR drops to a few hundred ohm.',
        check: (c) => !!c.memo.dim && !!c.memo.bright,
      },
    ],
  },
  {
    id: 'diode',
    title: '9. One-way street',
    tagline: 'Diodes block reverse current',
    story: 'A diode conducts one direction only. The band marks the cathode. Put one in the LED loop, then flip it.',
    setup(b) {
      b.board()
      b.place('battery', -320, 80, { volts: 9 })
      b.place('led', 200, 80, { color: 'red' })
      b.place('resistor', 200, 200, { value: 470 })
      b.place('diode', 200, 320)
    },
    steps: [
      {
        text: 'Connect battery, resistor, LED and the diode in series, band toward battery -: LED glows.',
        hint: 'Current enters the diode at the anode (no band) and leaves at the cathode (band).',
        check: (c) => lit(c) && c.parts('diode').some((d) => (c.live(d).i ?? 0) > 0.001) && !!(c.memo.fwd = true),
      },
      {
        text: 'Turn the diode around so the band faces the battery +: the LED goes dark.',
        hint: 'Select the diode, press R twice to rotate it 180 degrees, then drag it so its legs sit in the right columns again. With the band toward +, current is blocked.',
        check: (c) => !!c.memo.fwd && c.ledsLit().length === 0 && c.parts('diode').some((d) => Math.abs(c.live(d).i ?? 0) < 1e-6 && (c.live(d).v ?? 0) < -1),
      },
    ],
  },
]

export function makeCtx(world: World, sim: Simulation, memo: Record<string, number | boolean>): LessonCtx {
  const holeKeys = new Set<string>()
  for (const p of world.parts) if (p.type.startsWith('breadboard')) for (const h of boardHoles(p)) holeKeys.add(`${Math.round(h.pos.x)},${Math.round(h.pos.y)}`)
  return {
    world,
    sim,
    memo,
    parts: (type) => world.parts.filter((p) => p.type === type),
    live: (p) => sim.live.get(p.id) ?? {},
    nodes: (p) => sim.net.partPins.get(p.id) ?? [],
    onBoard(p) {
      const pins = sim.net.partPins.get(p.id)
      if (!pins) return false
      return pinKeysOf(p).every((k) => holeKeys.has(k))
    },
    ledsLit: () => world.parts.filter((p) => p.type === 'led' && !p.state.failed && (sim.live.get(p.id)?.i ?? 0) > 0.0005),
  }
}


function pinKeysOf(p: PartInstance): string[] {
  return pinWorld(p).map((v) => `${Math.round(v.x)},${Math.round(v.y)}`)
}
