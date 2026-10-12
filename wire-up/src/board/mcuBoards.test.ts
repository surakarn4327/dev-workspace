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

  it('tone() swings the pin: a LED on it shines at about half the current, and the pin reports its frequency', () => {
    const steady = lab(LED_ON)
    run(steady.sim, 0.3)
    const full = steady.sim.live.get(steady.led.id)!.i
    const s = lab('void setup() { tone(8, 440); } void loop() {}')
    run(s.sim, 0.3)
    const half = s.sim.live.get(s.led.id)!.i
    expect(half).toBeGreaterThan(full * 0.3)
    expect(half).toBeLessThan(full * 0.7)
    expect(s.sim.boards.toneOf(s.uno.id, 8)).toBe(440)
    s.uno.params.program = 'void setup() { tone(8, 440, 100); delay(300); } void loop() {}'
    s.w.touch()
    run(s.sim, 0.5)
    expect(s.sim.boards.toneOf(s.uno.id, 8)).toBe(0)
    expect(s.sim.live.get(s.led.id)!.i).toBeLessThan(0.0005)
  })

  it('EEPROM writes are kept in the board, survive a reset and a fresh simulation, and ask for a save', () => {
    const s = lab('void setup() { Serial.begin(9600); EEPROM.write(5, 77); EEPROM.write(6, 1); Serial.println(EEPROM.read(5)); } void loop() {}')
    let saves = 0
    s.sim.boards.onPersist = () => saves++
    run(s.sim, 0.3)
    expect(s.sim.boards.info(s.uno.id).text).toBe('77\r\n')
    expect(typeof s.uno.params.eeprom).toBe('string')
    expect(s.uno.params.eeprom).toBe('ffffffffff4d01')
    expect(saves).toBe(1)
    // a new simulation of the same world (reload of the page / file): the sketch finds the cells as they were
    s.uno.params.program = 'void setup() { Serial.begin(9600); Serial.println(EEPROM.read(5)); Serial.println(EEPROM.read(6)); Serial.println(EEPROM.read(7)); } void loop() {}'
    const again = new Simulation(s.w)
    run(again, 0.3)
    expect(again.boards.info(s.uno.id).text).toBe('77\r\n1\r\n255\r\n')
    expect(saves).toBe(1)
  })

  it('analogWrite makes the pin an output by itself, and only pins 3 5 6 9 10 11 do PWM: the others are on at 128 and above', () => {
    const half = lab('void setup() {} void loop() { analogWrite(8, 128); }')
    run(half.sim, 0.3)
    const full = lab(LED_ON)
    run(full.sim, 0.3)
    // pin 8 has no PWM: 128 is simply HIGH
    expect(half.sim.live.get(half.led.id)!.i).toBeCloseTo(full.sim.live.get(full.led.id)!.i, 4)
    const low = lab('void setup() {} void loop() { analogWrite(8, 127); }')
    run(low.sim, 0.3)
    expect(low.sim.live.get(low.led.id)!.i).toBeLessThan(0.0005)
  })

  it('a PWM pin lights the LED at about its duty of the full current', () => {
    const w = new World()
    const b = new SceneBuilder(w)
    const uno = b.place('arduino-uno', 400, 100, { usb: true, program: 'void setup() { analogWrite(9, 64); } void loop() {}' })
    const led = b.place('led', 800, 100, { color: 'red' })
    const r = b.place('resistor', 800, 300, { value: 330 })
    const pins = pinWorld(uno)
    const [la, lk] = pinWorld(led)
    const [r0, r1] = pinWorld(r)
    b.wire(pins[padOf(9)], la)
    b.wire(lk, r0, '#2f6fe0')
    b.wire(r1, pins[GND], '#2f6fe0')
    w.commit()
    const sim = new Simulation(w)
    run(sim, 0.5)
    const quarter = sim.live.get(led.id)!.i
    uno.params.program = 'void setup() { digitalWrite(9, HIGH); pinMode(9, OUTPUT); } void loop() {}'
    w.touch()
    run(sim, 0.3)
    const fullI = sim.live.get(led.id)!.i
    expect(quarter / fullI).toBeGreaterThan(0.2)
    expect(quarter / fullI).toBeLessThan(0.3)
  })

  it('PWM into an RC filter charges the capacitor to duty x 5 V, on a 490 Hz pin and on a 976 Hz pin', () => {
    for (const pin of [9, 5]) {
      const w = new World()
      const b = new SceneBuilder(w)
      const uno = b.place('arduino-uno', 400, 100, { usb: true, program: `void setup() { analogWrite(${pin}, 128); } void loop() {}` })
      const r = b.place('resistor', 800, 100, { value: 10000 })
      const c = b.place('cap-ceramic', 800, 300, { value: 1e-6 })
      const pins = pinWorld(uno)
      const [r0, r1] = pinWorld(r)
      const [c0, c1] = pinWorld(c)
      b.wire(pins[padOf(pin)], r0)
      b.wire(r1, c0, '#2f6fe0')
      b.wire(c1, pins[GND], '#2f6fe0')
      w.commit()
      const sim = new Simulation(w)
      run(sim, 0.6)
      // the capacitor holds the average: 128/255 of 5 V
      const v = sim.live.get(c.id)!.v
      expect(v).toBeGreaterThan(2.35)
      expect(v).toBeLessThan(2.65)
    }
  })

  it('a scanned LED matrix lights the right LEDs: rows and columns are seen high and low together', () => {
    const w = new World()
    const b = new SceneBuilder(w)
    const program = `
      int rowPins[2] = {2, 3};
      int colPins[2] = {4, 5};
      int image[2] = {1, 2};
      void setup() {
        for (int i = 0; i < 2; i++) {
          pinMode(rowPins[i], OUTPUT); pinMode(colPins[i], OUTPUT);
          digitalWrite(rowPins[i], LOW); digitalWrite(colPins[i], HIGH);
        }
      }
      void showRow(int r) {
        for (int c = 0; c < 2; c++) digitalWrite(colPins[c], ((image[r] >> c) & 1) ? LOW : HIGH);
        digitalWrite(rowPins[r], HIGH);
        delay(2);
        digitalWrite(rowPins[r], LOW);
      }
      void loop() { for (int r = 0; r < 2; r++) showRow(r); }`
    const uno = b.place('arduino-uno', 400, 100, { usb: true, program })
    const leds = [
      [b.place('led', 800, 100, { color: 'red' }), b.place('led', 900, 100, { color: 'red' })],
      [b.place('led', 800, 300, { color: 'red' }), b.place('led', 900, 300, { color: 'red' })],
    ]
    const res = [b.place('resistor', 800, 500, { value: 330 }), b.place('resistor', 1000, 500, { value: 330 })]
    const pins = pinWorld(uno)
    // row r: Uno pin -> the first LED's anode, and on to the second one's; column c: both cathodes -> a resistor -> Uno pin
    for (let r = 0; r < 2; r++) {
      b.wire(pins[padOf(2 + r)], pinWorld(leds[r][0])[0])
      b.wire(pinWorld(leds[r][0])[0], pinWorld(leds[r][1])[0])
    }
    for (let c = 0; c < 2; c++) {
      const [r0, r1] = pinWorld(res[c])
      b.wire(pinWorld(leds[0][c])[1], r0, '#2f6fe0')
      b.wire(pinWorld(leds[1][c])[1], r0, '#2f6fe0')
      b.wire(r1, pins[padOf(4 + c)], '#2f6fe0')
    }
    w.commit()
    const sim = new Simulation(w)
    run(sim, 0.5)
    const amps = leds.map((row) => row.map((l) => sim.live.get(l.id)!.i))
    // image: row 0 has column 0 lit, row 1 has column 1 lit
    expect(amps[0][0]).toBeGreaterThan(0.002)
    expect(amps[1][1]).toBeGreaterThan(0.002)
    expect(amps[0][1]).toBeLessThan(0.0002)
    expect(amps[1][0]).toBeLessThan(0.0002)
  })

  it('a pin an interrupt watches sees a button wired to it: falling edges counted by the sketch', () => {
    const s = lab(
      'volatile int n = 0; void isr() { n++; } void setup() { Serial.begin(9600); pinMode(2, INPUT_PULLUP); attachInterrupt(0, isr, FALLING); } void loop() { Serial.println(n); delay(50); }',
      (b, uno) => {
        const pins = pinWorld(uno)
        const sw = b.place('button', 800, 400, {})
        const sp = pinWorld(sw)
        b.wire(pins[padOf(2)], sp[0])
        b.wire(sp[2], pins[GND], '#2f6fe0')
      },
    )
    run(s.sim, 0.3)
    const last = (): number => Number(s.sim.boards.info(s.uno.id).text.trim().split(/\s+/).at(-1))
    expect(last()).toBe(0)
    const sw = s.w.parts.find((p) => p.type === 'button')!
    sw.params.pressed = true
    s.w.touch()
    run(s.sim, 0.3)
    sw.params.pressed = false
    s.w.touch()
    run(s.sim, 0.3)
    expect(last()).toBe(1)
  })
})
