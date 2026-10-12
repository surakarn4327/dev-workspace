import { describe, expect, it } from 'vitest'
import { Hd44780Backpack } from './hd44780.ts'
import { errorOf, run } from './testkit.ts'

const lines = (s: string): string[] => s.split('\r\n')

describe('Wire', () => {
  it('sends a transmission and reports who answered', () => {
    const { log, m } = run(
      `void setup() { Serial.begin(9600); Wire.begin();
         Wire.beginTransmission(0x50); Wire.write(1); Wire.write(0x80); Wire.write("ab"); byte data[] = {7, 8, 9}; Wire.write(data, 2);
         Serial.println(Wire.endTransmission());
         Wire.beginTransmission(0x10); Serial.println(Wire.endTransmission());
       } void loop() {}`,
      0.1,
      (l) => {
        l.i2c[0x50] = { received: [], reply: [] }
      },
    )
    expect(m.error).toBeNull()
    expect(log.i2c[0x50].received).toEqual([[1, 0x80, 97, 98, 7, 8]])
    expect(lines(log.serial).slice(0, 2)).toEqual(['0', '2'])
  })

  it('reads bytes back with requestFrom, available and read', () => {
    const { log } = run(
      `void setup() { Serial.begin(9600); Wire.begin();
         byte n = Wire.requestFrom(0x68, 3);
         Serial.println(n); Serial.println(Wire.available());
         while (Wire.available()) Serial.println(Wire.read());
         Serial.println(Wire.read());
         Serial.println(Wire.requestFrom(0x11, 2));
       } void loop() {}`,
      0.1,
      (l) => {
        l.i2c[0x68] = { received: [], reply: [10, 20, 30, 40] }
      },
    )
    expect(lines(log.serial).slice(0, 7)).toEqual(['3', '3', '10', '20', '30', '-1', '0'])
  })

  it('a transmission takes the time of its bits on the bus: faster with setClock(400000)', () => {
    const t = (clock: string): number => {
      const { log } = run(
        `void setup() { Serial.begin(9600); Wire.begin(); ${clock} unsigned long a = micros();
           for (int i = 0; i < 10; i++) { Wire.beginTransmission(0x50); Wire.write(1); Wire.write(2); Wire.endTransmission(); }
           Serial.println(micros() - a); } void loop() {}`,
        0.3,
        (l) => {
          l.i2c[0x50] = { received: [], reply: [] }
        },
      )
      return Number(lines(log.serial)[0])
    }
    const slow = t('')
    const fast = t('Wire.setClock(400000);')
    // 3 bytes = 29 clocks a transmission: 290 us at 100 kHz
    expect(slow).toBeGreaterThan(2800)
    expect(slow).toBeLessThan(3300)
    expect(fast).toBeLessThan(slow / 3)
  })

  it('without Wire.begin() nothing is sent, and the buffer holds 32 bytes', () => {
    const quiet = run(`void setup() { Serial.begin(9600); Wire.beginTransmission(0x50); Wire.write(1); Serial.println(Wire.endTransmission()); } void loop() {}`, 0.1, (l) => {
      l.i2c[0x50] = { received: [], reply: [] }
    })
    expect(quiet.log.i2c[0x50].received).toEqual([])
    expect(lines(quiet.log.serial)[0]).toBe('4')
    const big = run(
      `void setup() { Serial.begin(9600); Wire.begin(); Wire.beginTransmission(0x50); int n = 0; for (int i = 0; i < 40; i++) n += Wire.write(i); Serial.println(n); Wire.endTransmission(); } void loop() {}`,
      0.1,
      (l) => {
        l.i2c[0x50] = { received: [], reply: [] }
      },
    )
    expect(lines(big.log.serial)[0]).toBe('32')
    expect(big.log.i2c[0x50].received[0].length).toBe(32)
  })

  it('an I2C scanner finds the device', () => {
    const { log } = run(
      `void setup() { Serial.begin(9600); Wire.begin();
         for (byte a = 1; a < 127; a++) { Wire.beginTransmission(a); if (Wire.endTransmission() == 0) { Serial.print("found 0x"); Serial.println(a, HEX); } } }
       void loop() {}`,
      0.5,
      (l) => {
        l.devices[0x27] = new Hd44780Backpack(0x27)
        l.i2c[0x3c] = { received: [], reply: [] }
      },
    )
    expect(lines(log.serial).filter((x) => x !== '')).toEqual(['found 0x27', 'found 0x3C'])
  })

  it('mistakes are explained', () => {
    expect(errorOf('void setup() { Wire.begin(8); } void loop() {}').message).toContain('slave')
    expect(errorOf('void setup() { Wire.onReceive(0); } void loop() {}').message).toContain('master')
    expect(errorOf('void setup() { Wire.foo(); } void loop() {}').message).toContain("'Wire.foo'")
  })
})

describe('LiquidCrystal_I2C on a 1602 backpack', () => {
  const lcdRun = (body: string, secs = 2, decl = 'LiquidCrystal_I2C lcd(0x27, 16, 2);') => {
    const dev = new Hd44780Backpack(0x27)
    const out = run(`${decl} void setup() { ${body} } void loop() {}`, secs, (l) => {
      l.devices[0x27] = dev
    })
    expect(out.m.error).toBeNull()
    return { dev, ...out }
  }

  it('init, backlight and print put text on the screen', () => {
    const { dev } = lcdRun('lcd.init(); lcd.backlight(); lcd.setCursor(0, 0); lcd.print("Hello, world!"); lcd.setCursor(2, 1); lcd.print("Wire-Up");')
    expect(dev.text()).toEqual(['Hello, world!   ', '  Wire-Up       '])
    const s = dev.snapshot()
    expect(s.on).toBe(true)
    expect(s.backlight).toBe(true)
    expect(s.boxes).toBe(false)
  })

  it('the backlight stays off until backlight() is called, as with the real library', () => {
    const { dev } = lcdRun('lcd.init(); lcd.print("hi");')
    expect(dev.snapshot().backlight).toBe(false)
    expect(dev.text()[0]).toBe('hi              ')
    const on = lcdRun('lcd.init(); lcd.backlight(); lcd.print("hi"); lcd.noBacklight();')
    expect(on.dev.snapshot().backlight).toBe(false)
  })

  it('init() takes about a second and every character about a millisecond and a half', () => {
    const { log } = lcdRun(
      'unsigned long a = micros(); lcd.init(); unsigned long b = micros(); lcd.backlight(); lcd.print("0123456789ABCDEF"); unsigned long c = micros(); Serial.begin(9600); Serial.println(b - a); Serial.println(c - b);',
    )
    const [init, print] = lines(log.serial).map(Number)
    expect(init).toBeGreaterThan(1.05e6)
    expect(init).toBeLessThan(1.15e6)
    expect(print / 16).toBeGreaterThan(1200)
    expect(print / 16).toBeLessThan(2200)
  })

  it('prints numbers, floats, characters and bases the way Serial.print does', () => {
    const { dev } = lcdRun('lcd.init(); lcd.print(42); lcd.print(" "); lcd.print(3.14159, 3); lcd.print(" "); lcd.print(255, HEX); lcd.print((char)65); lcd.setCursor(0, 1); lcd.print(String("S=") + 7); lcd.write(66);')
    expect(dev.text()).toEqual(['42 3.142 FFA    ', 'S=7B            '])
  })

  it('clear, home, display, cursor and blink', () => {
    const { dev } = lcdRun('lcd.init(); lcd.print("abc"); lcd.cursor(); lcd.blink(); lcd.noDisplay(); lcd.clear(); lcd.print("z"); lcd.display(); lcd.noBlink(); lcd.noCursor();')
    expect(dev.text()[0]).toBe('z               ')
    const s = dev.snapshot()
    expect(s.on).toBe(true)
    expect(s.cursorOn).toBe(false)
    expect(s.blinkOn).toBe(false)
    expect(s.cursor).toEqual({ col: 1, row: 0 })
    const off = lcdRun('lcd.init(); lcd.print("abc"); lcd.noDisplay();')
    expect(off.dev.snapshot().on).toBe(false)
    expect(off.dev.text()[0]).toBe('abc             ') // the text is still in the chip while the display is off
  })

  it('scrolls the display and the entry direction can be changed', { timeout: 30000 }, () => {
    const { dev } = lcdRun('lcd.init(); lcd.print("ABCDEFGHIJKLMNOP"); lcd.scrollDisplayLeft(); lcd.scrollDisplayLeft();')
    expect(dev.text()[0]).toBe('CDEFGHIJKLMNOP  ')
    const r = lcdRun('lcd.init(); lcd.setCursor(5, 0); lcd.rightToLeft(); lcd.print("abc");')
    expect(r.dev.text()[0]).toBe('   cba          ')
    const sr = lcdRun('lcd.init(); lcd.print("ABCD"); lcd.scrollDisplayRight();')
    expect(sr.dev.text()[0]).toBe(' ABCD           ')
  })

  it('autoscroll shifts the display as characters are written', () => {
    const { dev } = lcdRun('lcd.init(); lcd.setCursor(15, 0); lcd.autoscroll(); lcd.print("xyz");')
    // each character shifts the window one place, so they all end up on the same cell they were written to, three places along
    expect(dev.text()[0]).toBe('            xyz ')
  })

  it('custom characters are stored in the CGRAM', () => {
    const { dev } = lcdRun(
      'byte heart[8] = {0, 10, 31, 31, 31, 14, 4, 0}; lcd.init(); lcd.createChar(0, heart); lcd.setCursor(0, 0); lcd.write(byte(0)); lcd.print("!");',
    )
    expect(dev.snapshot().chars[0]).toBe(0)
    expect(dev.snapshot().cgram[0]).toEqual([0, 10, 31, 31, 31, 14, 4, 0])
    expect(dev.text()[0].charCodeAt(1)).toBe(33)
  })

  it('a 20x4 display uses all four rows with their odd address order', () => {
    const dev = new Hd44780Backpack(0x3f, 20, 4)
    run(`LiquidCrystal_I2C lcd(0x3F, 20, 4); void setup() { lcd.init(); lcd.backlight(); for (int r = 0; r < 4; r++) { lcd.setCursor(0, r); lcd.print("row "); lcd.print(r); } lcd.setCursor(17, 3); lcd.print("end"); } void loop() {}`, 3, (l) => {
      l.devices[0x3f] = dev
    })
    expect(dev.text()).toEqual(['row 0               ', 'row 1               ', 'row 2               ', 'row 3            end'])
  })

  it('a display that is never initialised shows the dark blocks of a fresh controller, and a wrong address shows nothing', () => {
    const fresh = new Hd44780Backpack(0x27)
    expect(fresh.snapshot().boxes).toBe(true)
    const wrong = new Hd44780Backpack(0x27)
    run(`LiquidCrystal_I2C lcd(0x20, 16, 2); void setup() { lcd.init(); lcd.backlight(); lcd.print("lost"); } void loop() {}`, 3, (l) => {
      l.devices[0x27] = wrong
    })
    expect(wrong.snapshot().boxes).toBe(true)
  })

  it('power loss resets the display', () => {
    const { dev } = lcdRun('lcd.init(); lcd.backlight(); lcd.print("hi");')
    dev.reset()
    expect(dev.snapshot().boxes).toBe(true)
    expect(dev.text()[0].trim()).toBe('')
  })

  it('works with Wire used at the same time, and with the object in a function', () => {
    const { dev } = lcdRun(
      'Wire.begin(); lcd.begin(16, 2); lcd.backlight(); show(5); delay(10);',
      3,
      'LiquidCrystal_I2C lcd(0x27, 16, 2); void show(int n) { lcd.setCursor(0, 1); lcd.print(n * 2); }',
    )
    expect(dev.text()[1]).toBe('10              ')
  })

  it('library mistakes are explained', () => {
    expect(errorOf('LiquidCrystal_I2C lcd(0x27, 16, 2); void setup() { lcd.fly(); } void loop() {}').message).toContain("no member 'fly'")
    expect(errorOf('LiquidCrystal_I2C lcd(0x27, 16, 2); void setup() { LiquidCrystal_I2C b = lcd; } void loop() {}').message).toContain('cannot be copied')
    expect(errorOf('LiquidCrystal_I2C lcd(0x27, 16, 2); void setup() { int x = lcd; } void loop() {}').message).toContain('cannot')
    expect(errorOf('Servo s; void setup() {} void loop() {}').message).toContain("'Servo'")
  })
})
