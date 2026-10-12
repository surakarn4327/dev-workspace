import { describe, expect, it } from 'vitest'
import { errorOf, run } from './testkit.ts'

const lines = (s: string): string[] => s.split('\r\n')

describe('bits: bitRead bitSet bitClear bitWrite bit lowByte highByte', () => {
  it('work on bytes, ints, longs and array elements and wrap to the variable type', () => {
    const { log } = run(
      `void setup() { Serial.begin(9600);
        byte b = 0; bitSet(b, 3); bitSet(b, 0); Serial.println(b);
        bitClear(b, 0); Serial.println(b);
        bitWrite(b, 7, 1); Serial.println(b); bitWrite(b, 7, 0); Serial.println(b);
        Serial.println(bitRead(b, 3)); Serial.println(bitRead(b, 2));
        Serial.println(bit(5));
        unsigned long big = 0; bitSet(big, 31); Serial.println(big);
        int a[2] = {0, 0}; bitSet(a[1], 9); Serial.println(a[1]);
        unsigned int w = 0xABCD; Serial.println(lowByte(w), HEX); Serial.println(highByte(w), HEX);
        int s = 0; bitSet(s, 15); Serial.println(s);
      } void loop() {}`,
      0.2,
    )
    expect(lines(log.serial).slice(0, 12)).toEqual(['9', '8', '136', '8', '1', '0', '32', '2147483648', '512', 'CD', 'AB', '-32768'])
  })

  it('bitSet needs a variable as its first argument', () => {
    expect(errorOf('void setup() { bitSet(5, 1); } void loop() {}').message).toContain('must be a variable')
  })
})

describe('shiftOut / shiftIn', () => {
  it('shiftOut clocks the byte out MSB or LSB first, a bit and two clock edges at a time', () => {
    const { log } = run(
      `void setup() { pinMode(2, OUTPUT); pinMode(3, OUTPUT); shiftOut(2, 3, MSBFIRST, 0xA5); shiftOut(2, 3, LSBFIRST, 0x01); } void loop() {}`,
      0.05,
    )
    const data = log.writes.filter(([p]) => p === 2).map(([, v]) => v)
    expect(data.slice(0, 8)).toEqual([1, 0, 1, 0, 0, 1, 0, 1])
    expect(data.slice(8, 16)).toEqual([1, 0, 0, 0, 0, 0, 0, 0])
    const clock = log.writes.filter(([p]) => p === 3).map(([, v]) => v)
    expect(clock.length).toBe(32)
    expect(clock.slice(0, 4)).toEqual([1, 0, 1, 0])
    const ts = log.writes.map(([, , t]) => t)
    expect(ts[ts.length - 1]).toBeGreaterThan(ts[0])
  })

  it('shiftIn reads one bit per clock pulse', () => {
    const bits = [1, 0, 1, 1, 0, 0, 1, 0]
    const { log } = run(
      `void setup() { Serial.begin(9600); Serial.println(shiftIn(4, 5, MSBFIRST)); Serial.println(shiftIn(4, 5, LSBFIRST)); } void loop() {}`,
      0.05,
      (l) => {
        let reads = 0
        l.level = () => bits[reads++ % 8]
      },
    )
    expect(lines(log.serial).slice(0, 2)).toEqual([String(0b10110010), String(0b01001101)])
  })
})

describe('tone / noTone', () => {
  it('a tone swings the pin until noTone or until its duration runs out, even while the sketch sleeps', () => {
    const { log } = run(
      `void setup() { tone(8, 440); delay(100); noTone(8); delay(50); tone(9, 1000, 200); delay(500); tone(8, 262, 100); } void loop() { while (true) {} }`,
      0.8,
    )
    const ev = log.tones.map(([p, f, t]) => [p, f, t])
    expect(ev[0].slice(0, 2)).toEqual([8, 440])
    expect(ev[0][2]).toBeLessThan(0.001)
    expect(ev[1][0]).toBe(8)
    expect(ev[1][1]).toBe(0)
    expect(ev[1][2]).toBeCloseTo(0.1, 2)
    expect(ev[2][0]).toBe(9)
    expect(ev[2][1]).toBe(1000)
    expect(ev[3][0]).toBe(9)
    expect(ev[3][1]).toBe(0)
    expect(ev[3][2]).toBeCloseTo(0.15 + 0.2, 2)
    expect(ev[4][0]).toBe(8)
    expect(ev[4][1]).toBe(262)
    expect(ev[5][1]).toBe(0)
    expect(ev[5][2]).toBeCloseTo(0.65 + 0.1, 2)
  })
})

describe('pulseIn', () => {
  it('measures a high pulse in microseconds', () => {
    const { log } = run(`void setup() { Serial.begin(9600); } void loop() { unsigned long d = pulseIn(7, HIGH); Serial.println(d); }`, 0.5, (l) => {
      l.level = (_p, t) => (t >= 0.1 && t < 0.1123 ? 1 : 0)
    })
    const first = Number(lines(log.serial)[0])
    expect(first).toBeGreaterThan(12200)
    expect(first).toBeLessThan(12400)
  })

  it('gives 0 when no pulse comes before the timeout', () => {
    const { log } = run(`void setup() { Serial.begin(9600); Serial.println(pulseIn(7, HIGH, 5000)); Serial.println(pulseIn(7, LOW, 5000)); } void loop() {}`, 0.2, (l) => {
      l.level = () => 0
    })
    // LOW is already there, so it waits for the pulse to end first: no full LOW pulse either
    expect(lines(log.serial).slice(0, 2)).toEqual(['0', '0'])
  })

  it('a pulse already running when the call starts does not count', () => {
    const { log } = run(`void setup() { Serial.begin(9600); Serial.println(pulseIn(7, LOW)); } void loop() {}`, 0.5, (l) => {
      // high until 50 ms; low 50-130 ms is the pulse; high after
      l.level = (_p, t) => (t < 0.05 ? 0 : t < 0.08 ? 1 : t < 0.13 ? 0 : 1)
    })
    // starts LOW (ignored), goes HIGH 30 ms, then LOW for 50 ms
    const v = Number(lines(log.serial)[0])
    expect(v).toBeGreaterThan(49800)
    expect(v).toBeLessThan(50200)
  })
})

describe('EEPROM', () => {
  it('reads 255 when erased, keeps what is written, update skips equal bytes, put/get keep numbers', () => {
    const { m, log } = run(
      `void setup() { Serial.begin(9600);
        Serial.println(EEPROM.read(0));
        EEPROM.write(0, 42); EEPROM.update(1, 7); EEPROM.update(1, 7);
        Serial.println(EEPROM.read(0)); Serial.println(EEPROM.read(1));
        Serial.println(EEPROM.length());
        int x = -1234; EEPROM.put(10, x); int y = 0; EEPROM.get(10, y); Serial.println(y);
        float f = 3.5; EEPROM.put(20, f); float g = 0; EEPROM.get(20, g); Serial.println(g);
        long l = 100000L; EEPROM.put(30, l); long k = 0; EEPROM.get(30, k); Serial.println(k);
      } void loop() {}`,
      0.3,
    )
    expect(lines(log.serial).slice(0, 7)).toEqual(['255', '42', '7', '1024', '-1234', '3.50', '100000'])
    expect(m.eeprom[0]).toBe(42)
    expect(m.eeprom[10]).toBe(0x2e) // -1234 = 0xFB2E, little endian
    expect(m.eeprom[11]).toBe(0xfb)
    expect(m.eepromDirty).toBe(true)
  })

  it('writes cost real time: 3.3 ms each when back to back', () => {
    const { log } = run(`void setup() { Serial.begin(9600); for (int i = 0; i < 100; i++) EEPROM.write(i, i); Serial.println(millis()); } void loop() {}`, 1)
    const ms = Number(lines(log.serial)[0])
    expect(ms).toBeGreaterThan(320)
    expect(ms).toBeLessThan(345)
  })
})
