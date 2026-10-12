import { describe, expect, it } from 'vitest'
import { errorOf, run } from './testkit.ts'

const lines = (s: string): string[] => s.split('\r\n')

/** Pin 2 level over time: starts high, then each listed time flips it. */
const flips = (...at: number[]) => (_p: number, t: number): number => (at.filter((x) => t >= x).length % 2 === 0 ? 1 : 0)

const COUNTER = (mode: string): string => `
  volatile int count = 0;
  void isr() { count++; }
  void setup() { Serial.begin(9600); pinMode(2, INPUT_PULLUP); attachInterrupt(digitalPinToInterrupt(2), isr, ${mode}); }
  void loop() { Serial.println(count); delay(100); }`

describe('attachInterrupt', () => {
  const last = (src: string, level: (p: number, t: number) => number, secs = 0.7): number => {
    const { log, m } = run(src, secs, (l) => {
      l.level = level
    })
    expect(m.error).toBeNull()
    return Number(lines(log.serial).filter((x) => x !== '').at(-1))
  }

  it('counts the edges of the mode it was given', () => {
    // two presses: low at 0.2 high at 0.3, low at 0.4 high at 0.5
    const level = flips(0.2, 0.3, 0.4, 0.5)
    expect(last(COUNTER('FALLING'), level)).toBe(2)
    expect(last(COUNTER('RISING'), level)).toBe(2)
    expect(last(COUNTER('CHANGE'), level)).toBe(4)
  })

  it('LOW fires over and over while the pin is low, and not at all while it is high', () => {
    expect(last(COUNTER('LOW'), () => 1)).toBe(0)
    // the handler runs again and again with the sketch getting one operation in between, so the sketch still prints (slowly)
    const { log, m } = run(COUNTER('LOW'), 0.7, (l) => {
      l.level = () => 0
    })
    expect(m.error).toBeNull()
    const seen = lines(log.serial).filter((x) => x !== '')
    expect(seen.length).toBeGreaterThan(2)
    expect(new Set(seen).size).toBeGreaterThan(2)
  })

  it('the main sketch loses nothing: its own timing goes on with handlers running', () => {
    const { log } = run(
      `volatile unsigned long hits = 0;
       void isr() { hits++; }
       void setup() { Serial.begin(9600); attachInterrupt(0, isr, CHANGE); }
       void loop() { delay(1000); Serial.print(millis() / 100); Serial.print(' '); Serial.println(hits); }`,
      2.1,
      (l) => {
        l.level = flips(0.2, 0.4, 0.6, 1.2)
      },
    )
    const out = lines(log.serial).filter((x) => x !== '')
    expect(out[0]).toBe('10 3') // delay(1000) ended on time (millis 1000) although three interrupts fired meanwhile
    expect(out[1].startsWith('20 ')).toBe(true)
  })

  it('a sleeping delay is interrupted and resumes', () => {
    const { log } = run(
      `volatile bool seen = false;
       void isr() { seen = true; }
       void setup() { Serial.begin(9600); attachInterrupt(0, isr, FALLING); delay(500); Serial.println(seen ? "yes" : "no"); }
       void loop() {}`,
      1,
      (l) => {
        l.level = flips(0.1)
      },
    )
    expect(lines(log.serial)[0]).toBe('yes')
  })

  it('a pin the sketch drives itself raises its interrupt at the write', () => {
    const { log, m } = run(
      `volatile int n = 0; void isr() { n++; }
       void setup() { Serial.begin(9600); pinMode(2, OUTPUT); attachInterrupt(0, isr, RISING);
         digitalWrite(2, HIGH); digitalWrite(2, LOW); digitalWrite(2, HIGH); Serial.println(n); }
       void loop() {}`,
      0.1,
    )
    expect(m.error).toBeNull()
    expect(lines(log.serial)[0]).toBe('2')
  })

  it('noInterrupts holds a handler back until interrupts()', () => {
    const { log } = run(
      `volatile int n = 0; void isr() { n++; }
       void setup() { Serial.begin(9600); pinMode(3, OUTPUT); attachInterrupt(1, isr, CHANGE);
         noInterrupts(); digitalWrite(3, HIGH); Serial.println(n); interrupts(); Serial.println(n); }
       void loop() {}`,
      0.1,
    )
    expect(lines(log.serial).slice(0, 2)).toEqual(['0', '1'])
  })

  it('detachInterrupt stops it', () => {
    const { log } = run(
      `volatile int n = 0; void isr() { n++; }
       void setup() { Serial.begin(9600); pinMode(2, OUTPUT); attachInterrupt(0, isr, CHANGE);
         digitalWrite(2, HIGH); detachInterrupt(0); digitalWrite(2, LOW); digitalWrite(2, HIGH); Serial.println(n); }
       void loop() {}`,
      0.1,
    )
    expect(lines(log.serial)[0]).toBe('1')
  })

  it('a handler cannot use delay(), and the board says so', () => {
    const { m } = run(`void isr() { delay(10); } void setup() { pinMode(2, OUTPUT); attachInterrupt(0, isr, RISING); digitalWrite(2, HIGH); } void loop() {}`, 0.1)
    expect(m.error).toContain('delay() inside an interrupt handler')
  })

  it('handlers keep their own locals and may call functions', () => {
    const { log } = run(
      `volatile long total = 0;
       int twice(int x) { return x * 2; }
       void isr() { int a = 5; total += twice(a); }
       void setup() { Serial.begin(9600); pinMode(2, OUTPUT); attachInterrupt(0, isr, CHANGE); int mine = 7;
         digitalWrite(2, HIGH); digitalWrite(2, LOW); Serial.println(total); Serial.println(mine); }
       void loop() {}`,
      0.1,
    )
    expect(lines(log.serial).slice(0, 2)).toEqual(['20', '7'])
  })

  it('mistakes are explained', () => {
    expect(errorOf('void setup() { attachInterrupt(0, nothing, RISING); } void loop() {}').message).toContain('name of a function')
    expect(errorOf('int f(int a) { return a; } void setup() { attachInterrupt(0, f, RISING); } void loop() {}').message).toContain('void f()')
    const { m } = run('void isr() {} void setup() { attachInterrupt(5, isr, RISING); } void loop() {}', 0.1)
    expect(m.error).toContain('interrupt 5 does not exist')
  })
})

describe('timing on the AVR', () => {
  it('a digitalWrite takes about 5 us: an unrolled toggle runs at roughly 100 kHz', () => {
    const { log } = run(`void setup() { pinMode(8, OUTPUT); } void loop() { digitalWrite(8, HIGH); digitalWrite(8, LOW); }`, 0.05)
    const writes = log.writes.filter(([, v]) => v === 1)
    const period = (writes.at(-1)![2] - writes[0][2]) / (writes.length - 1)
    expect(period).toBeGreaterThan(9e-6)
    expect(period).toBeLessThan(13e-6)
  })

  it('analogRead takes about 110 us and a 32-bit multiply costs more than a 16-bit one', () => {
    const t = (body: string): number => {
      const { log } = run(`void setup() { Serial.begin(9600); unsigned long a = micros(); ${body} Serial.println(micros() - a); } void loop() {}`, 0.2)
      return Number(lines(log.serial)[0])
    }
    const ar = t('for (int i = 0; i < 10; i++) analogRead(A0);')
    expect(ar).toBeGreaterThan(1000)
    expect(ar).toBeLessThan(1250)
    const small = t('int x = 3; for (int i = 0; i < 200; i++) x = x * 3;')
    const wide = t('long x = 3; for (int i = 0; i < 200; i++) x = x * 3;')
    expect(wide).toBeGreaterThan(small)
  })
})
