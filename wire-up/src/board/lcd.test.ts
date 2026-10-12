import { describe, expect, it } from 'vitest'
import { SceneBuilder } from '../lessons/lessons.ts'
import { lcdFromLive } from '../mcu/hd44780.ts'
import { padOf } from '../parts/arduino.ts'
import { pinWorld } from '../parts/index.ts'
import { Simulation } from './simulation.ts'
import { World } from './world.ts'

const GND = 3
const V5 = 22

const HELLO = `#include <Wire.h>
#include <LiquidCrystal_I2C.h>
LiquidCrystal_I2C lcd(0x27, 16, 2);
void setup() { lcd.init(); lcd.backlight(); lcd.print("Hello"); lcd.setCursor(0, 1); lcd.print("Wire-Up"); }
void loop() {}`

/** A Uno and a 1602 LCD module wired as in every tutorial; `swap` crosses SDA and SCL, `skip` leaves a named wire out. */
function lab(program: string, opts: { swap?: boolean; skip?: string; addr?: number; volts?: number } = {}) {
  const w = new World()
  const b = new SceneBuilder(w)
  const uno = b.place('arduino-uno', 700, 100, { usb: true, program })
  const lcd = b.place('lcd1602-i2c', 100, 100, { addr: opts.addr ?? 0x27 })
  const u = pinWorld(uno)
  const l = pinWorld(lcd)
  const wire = (name: string, a: { x: number; y: number }, c: { x: number; y: number }): void => {
    if (opts.skip !== name) b.wire(a, c, '#2f6fe0')
  }
  wire('vcc', l[1], u[V5])
  wire('gnd', l[0], u[GND])
  wire('sda', l[2], u[padOf(opts.swap ? 19 : 18)])
  wire('scl', l[3], u[padOf(opts.swap ? 18 : 19)])
  w.commit()
  return { w, sim: new Simulation(w), uno, lcd }
}

function run(sim: Simulation, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / 0.016); i++) sim.step(0.016)
}

function screen(sim: Simulation, id: string): string[] {
  const s = lcdFromLive(sim.live.get(id) ?? {})
  const out: string[] = []
  for (let r = 0; r < s.rows; r++) out.push(String.fromCharCode(...s.chars.slice(r * s.cols, (r + 1) * s.cols)))
  return out
}

describe('LCD 1602 on the I2C bus of an Uno', { timeout: 30000 }, () => {
  it('the classic tutorial wiring shows the text after the one second the library waits', () => {
    const s = lab(HELLO)
    run(s.sim, 0.5)
    // init() is still waiting (a second in the library): the controller has seen nothing yet
    expect(lcdFromLive(s.sim.live.get(s.lcd.id)!).boxes).toBe(true)
    run(s.sim, 1.5)
    expect(screen(s.sim, s.lcd.id)).toEqual(['Hello           ', 'Wire-Up         '])
    const snap = lcdFromLive(s.sim.live.get(s.lcd.id)!)
    expect(snap.boxes).toBe(false)
    expect(snap.backlight).toBe(true)
    expect(snap.on).toBe(true)
    expect(s.sim.live.get(s.lcd.id)!.up).toBe(1)
  })

  it('draws about 25 mA with the backlight on and about 2 mA with it off', () => {
    const s = lab(HELLO)
    run(s.sim, 2)
    const on = s.sim.live.get(s.lcd.id)!.i
    expect(on).toBeGreaterThan(0.015)
    expect(on).toBeLessThan(0.035)
    s.uno.params.program = HELLO.replace('lcd.backlight();', 'lcd.noBacklight();')
    s.w.touch()
    run(s.sim, 2.2)
    const off = s.sim.live.get(s.lcd.id)!.i
    expect(off).toBeGreaterThan(0.0005)
    expect(off).toBeLessThan(0.004)
    expect(lcdFromLive(s.sim.live.get(s.lcd.id)!).backlight).toBe(false)
  })

  it('a display nobody has set up has its backlight on and shows the blocks', () => {
    const s = lab('void setup() {} void loop() {}')
    run(s.sim, 1)
    const snap = lcdFromLive(s.sim.live.get(s.lcd.id)!)
    expect(snap.boxes).toBe(true)
    expect(snap.backlight).toBe(true)
    expect(s.sim.live.get(s.lcd.id)!.i).toBeGreaterThan(0.015)
  })

  it('SDA and SCL crossed, or one of them missing, and nothing is displayed', () => {
    for (const opts of [{ swap: true }, { skip: 'sda' }, { skip: 'scl' }]) {
      const s = lab(HELLO, opts)
      run(s.sim, 2)
      expect(lcdFromLive(s.sim.live.get(s.lcd.id)!).boxes).toBe(true)
    }
  })

  it('without the supply the module is dark and says nothing, and Wire sees a NACK', () => {
    const s = lab(
      `#include <Wire.h>
       void setup() { Serial.begin(9600); Wire.begin(); Wire.beginTransmission(0x27); Serial.println(Wire.endTransmission()); } void loop() {}`,
      { skip: 'vcc' },
    )
    run(s.sim, 1)
    expect(s.sim.live.get(s.lcd.id)!.up).toBe(0)
    expect(s.sim.boards.info(s.uno.id).text.trim()).toBe('2')
  })

  it('the address of the module decides who answers: 0x3F does not hear 0x27, and the scanner finds it', () => {
    const scan = `#include <Wire.h>
      void setup() { Serial.begin(9600); Wire.begin(); for (byte a = 1; a < 127; a++) { Wire.beginTransmission(a); if (Wire.endTransmission() == 0) { Serial.print("0x"); Serial.println(a, HEX); } } }
      void loop() {}`
    const s = lab(scan, { addr: 0x3f })
    run(s.sim, 2)
    expect(s.sim.boards.info(s.uno.id).text.trim()).toBe('0x3F')
    const wrong = lab(HELLO, { addr: 0x3f })
    run(wrong.sim, 2)
    expect(lcdFromLive(wrong.sim.live.get(wrong.lcd.id)!).boxes).toBe(true)
  })

  it('the display forgets everything when its power goes, and shows blocks again when it comes back', () => {
    const s = lab('#include <Wire.h>\nvoid setup() { Serial.begin(9600); } void loop() {}')
    s.uno.params.program = HELLO
    s.w.touch()
    run(s.sim, 2.2)
    expect(screen(s.sim, s.lcd.id)[0]).toBe('Hello           ')
    // pull the USB plug of the Uno: the module loses its 5 V
    s.uno.params.usb = false
    s.w.touch()
    run(s.sim, 0.5)
    expect(s.sim.live.get(s.lcd.id)!.up).toBe(0)
    s.uno.params.usb = true
    s.w.touch()
    run(s.sim, 0.3)
    // the sketch starts again too, but its init() takes a second: the blocks come first
    expect(lcdFromLive(s.sim.live.get(s.lcd.id)!).boxes).toBe(true)
  })

  it('a supply of 9 V burns the module and says why', () => {
    const w = new World()
    const b = new SceneBuilder(w)
    const lcd = b.place('lcd1602-i2c', 100, 100, {})
    const bat = b.place('battery', -300, 100, { volts: 9 })
    const l = pinWorld(lcd)
    const [a, c] = pinWorld(bat)
    b.wire(a, l[1], '#e03030')
    b.wire(c, l[0], '#2f6fe0')
    w.commit()
    const sim = new Simulation(w)
    for (let i = 0; i < 400 && !lcd.state.failed; i++) sim.step(0.016)
    expect(lcd.state.failed).toBe(true)
    expect(lcd.state.failMsg).toContain('made for 5 V')
  })
})
