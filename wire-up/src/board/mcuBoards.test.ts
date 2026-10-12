import { describe, expect, it } from 'vitest'
import { SceneBuilder } from '../lessons/lessons.ts'
import { padOf } from '../parts/arduino.ts'
import { pinWorld } from '../parts/index.ts'
import { Simulation } from './simulation.ts'
import { World } from './world.ts'

const GND = 3
const V5 = 22
const A0 = padOf(14)

/** A board with an LED (+ 330 ohm to GND) on pin D8, running `program`. */
function lab(program: string, extra?: (b: SceneBuilder, uno: ReturnType<SceneBuilder['place']>) => void, params: Record<string, string | number | boolean> = {}) {
  const w = new World()
  const b = new SceneBuilder(w)
  const uno = b.place('arduino-uno', 400, 100, { usb: true, program, ...params })
  const led = b.place('led', 800, 100, { color: 'red' })
  const r = b.place('resistor', 800, 300, { value: 330 })
  const pins = pinWorld(uno)
  const [la, lk] = pinWorld(led)
  const [r0, r1] = pinWorld(r)
  b.wire(pins[padOf(8)], la)
  b.wire(lk, r0, '#2f6fe0')
  b.wire(r1, pins[GND], '#2f6fe0')
  extra?.(b, uno)
  w.commit()
  const sim = new Simulation(w)
  return { w, sim, uno, led, r }
}

function run(sim: Simulation, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / 0.016); i++) sim.step(0.016)
}

const LED_ON = 'void setup() { pinMode(8, OUTPUT); digitalWrite(8, HIGH); } void loop() {}'

describe('sketches on the board', () => {
  it('a new Uno blinks its L lamp: Blink is the factory sketch', () => {
    const w = new World()
    const b = new SceneBuilder(w)
    const uno = b.place('arduino-uno', 400, 100, {})
    w.commit()
    const sim = new Simulation(w)
    const seen: number[] = []
    for (let i = 0; i < 160; i++) {
      sim.step(0.016)
      seen.push(sim.live.get(uno.id)!.l)
    }
    // 2.56 s: lit for the first second, dark for the next, then lit again
    expect(seen[30]).toBe(1)
    expect(seen[100]).toBe(0)
    expect(seen[158]).toBe(1)
    expect(sim.boards.info(uno.id).state).toBe('running')
  })

  it('digitalWrite HIGH drives the LED with the pin current (about 5 mA ... 8 mA through 330 ohm)', () => {
    const s = lab(LED_ON)
    run(s.sim, 0.3)
    const i = s.sim.live.get(s.led.id)!.i
    expect(i).toBeGreaterThan(0.005)
    expect(i).toBeLessThan(0.012)
  })

  it('analogWrite dims by the average current, not by the average voltage', () => {
    const full = lab(LED_ON)
    run(full.sim, 0.3)
    const iFull = full.sim.live.get(full.led.id)!.i
    const dim = lab('void setup() { pinMode(8, OUTPUT); analogWrite(8, 64); } void loop() {}')
    // pin 8 has no PWM: it is on from 128 up; use pin 9
    const dim9 = lab('void setup() { pinMode(9, OUTPUT); analogWrite(9, 64); } void loop() {}', (b, uno) => {
      const led = b.place('led', 1000, 100, { color: 'green' })
      const r = b.place('resistor', 1000, 300, { value: 330 })
      const pins = pinWorld(uno)
      b.wire(pins[padOf(9)], pinWorld(led)[0])
      b.wire(pinWorld(led)[1], pinWorld(r)[0], '#2f6fe0')
      b.wire(pinWorld(r)[1], pins[GND], '#2f6fe0')
    })
    run(dim.sim, 0.3)
    run(dim9.sim, 0.5)
    const iDim8 = dim.sim.live.get(dim.led.id)!.i
    expect(iDim8).toBeLessThan(0.001) // 64 on a non-PWM pin is below half: off
    const greens = dim9.w.parts.filter((p) => p.type === 'led' && p.params.color === 'green')
    const iDim = dim9.sim.live.get(greens[0].id)!.i
    // green has a higher forward voltage than red, so compare with the steady-state duty share only loosely: about 25 % of full drive
    expect(iDim).toBeGreaterThan(0.0006)
    expect(iDim).toBeLessThan(iFull * 0.5)
  })

  it('analogRead sees a divider on A0 and Serial prints it', () => {
    const s = lab(
      'void setup() { Serial.begin(9600); } void loop() { Serial.println(analogRead(A0)); delay(100); }',
      (b, uno) => {
        const top = b.place('resistor', 1000, 100, { value: 10000 })
        const bot = b.place('resistor', 1000, 300, { value: 10000 })
        const pins = pinWorld(uno)
        b.wire(pins[V5], pinWorld(top)[0])
        b.wire(pinWorld(top)[1], pinWorld(bot)[0], '#2f6fe0')
        b.wire(pinWorld(bot)[1], pins[GND], '#2f6fe0')
        b.wire(pinWorld(top)[1], pins[A0], '#f2d21b')
      },
    )
    run(s.sim, 0.5)
    const out = s.sim.boards.info(s.uno.id).text.trim().split('\r\n')
    const v = Number(out[out.length - 1])
    expect(v).toBeGreaterThan(490)
    expect(v).toBeLessThan(530)
  })

  it('reset restarts the sketch; no power stops it and lets the pins go', () => {
    const s = lab('void setup() { Serial.begin(9600); Serial.println("boot"); pinMode(8, OUTPUT); digitalWrite(8, HIGH); } void loop() {}')
    run(s.sim, 0.2)
    expect(s.sim.boards.info(s.uno.id).text).toBe('boot\r\n')
    expect(s.sim.live.get(s.led.id)!.i).toBeGreaterThan(0.005)
    s.uno.params.pressed = true
    s.w.touch()
    run(s.sim, 0.1)
    expect(s.sim.boards.info(s.uno.id).state).toBe('reset')
    expect(s.sim.live.get(s.led.id)!.i).toBeLessThan(0.0005)
    s.uno.params.pressed = false
    s.w.touch()
    run(s.sim, 0.2)
    expect(s.sim.boards.info(s.uno.id).text).toBe('boot\r\nboot\r\n')
    s.uno.params.usb = false
    s.w.touch()
    run(s.sim, 0.2)
    expect(s.sim.boards.info(s.uno.id).state).toBe('off')
    expect(s.sim.live.get(s.led.id)!.i).toBeLessThan(0.0005)
  })

  it('flashing a new program restarts the board with it; a broken program shows its error and drives nothing', () => {
    const s = lab(LED_ON)
    run(s.sim, 0.2)
    expect(s.sim.live.get(s.led.id)!.i).toBeGreaterThan(0.005)
    s.uno.params.program = 'void setup() { pinMode(8, OUTPUT); digitalWrite(8 LOW); } void loop() {}'
    s.w.touch()
    run(s.sim, 0.2)
    const info = s.sim.boards.info(s.uno.id)
    expect(info.state).toBe('error')
    expect(info.error).toContain('line 1')
    expect(s.sim.live.get(s.led.id)!.i).toBeLessThan(0.0005)
    s.uno.params.program = 'void setup() { pinMode(8, OUTPUT); digitalWrite(8, LOW); } void loop() {}'
    s.w.touch()
    run(s.sim, 0.2)
    expect(s.sim.boards.info(s.uno.id).state).toBe('running')
  })

  it('a short on the pin burns the board even while the sketch is driving it', () => {
    const s = lab(LED_ON, (b, uno) => {
      const pins = pinWorld(uno)
      b.wire(pins[padOf(7)], pins[GND], '#2f6fe0')
    })
    s.uno.params.program = 'void setup() { pinMode(7, OUTPUT); digitalWrite(7, HIGH); } void loop() {}'
    s.w.touch()
    for (let i = 0; i < 200 && !s.uno.state.failed; i++) s.sim.step(0.016)
    expect(s.uno.state.failed).toBe(true)
    expect(s.uno.state.failMsg).toContain('D7')
  })
})
