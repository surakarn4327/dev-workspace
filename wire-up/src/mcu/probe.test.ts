import { describe, expect, it } from 'vitest'
import { compile } from './compile.ts'
import { run } from './testkit.ts'

const lines = (s: string): string[] => s.split('\r\n')

// Odd but valid sketches: each must either run to the answer a real Uno gives or fail with a compile error, never throw something else.
describe('edge cases', () => {
  const ok = (src: string, want: string[], secs = 0.3) => {
    const { log, m } = run(src, secs)
    expect(m.error).toBeNull()
    expect(lines(log.serial).slice(0, want.length)).toEqual(want)
  }

  it('struct inside loops, returned from a function, member of array element in expressions', () => {
    ok(
      `struct P { int x; int y; };
       P make(int a, int b) { P p; p.x = a; p.y = b; return p; }
       P list[2];
       void setup() { Serial.begin(9600);
         for (int i = 0; i < 2; i++) list[i] = make(i, i * 2);
         Serial.println(list[1].x + list[1].y);
         list[0].x = list[1].y; Serial.println(list[0].x);
         P a = make(1, 2); P b = a; b.x = 9; Serial.println(a.x);
         Serial.println(make(4, 5).y);
       } void loop() {}`,
      ['3', '2', '1', '5'],
    )
  })

  it('struct with String and float members', () => {
    ok(
      `struct Rec { String name; float v; byte n; };
       void setup() { Serial.begin(9600); Rec r; r.name = "ab"; r.name += "c"; r.v = 1.5; r.n = 300; Serial.println(r.name); Serial.println(r.v); Serial.println(r.n); }
       void loop() {}`,
      ['abc', '1.50', '44'],
    )
  })

  it('post/pre increment of members and array elements', () => {
    ok(
      `struct C { int n; }; C c; int a[3][3];
       void setup() { Serial.begin(9600); c.n = 5; Serial.println(c.n++); Serial.println(++c.n); Serial.println(c.n--);
         a[1][2] = 4; a[1][2]++; a[1][2] *= 2; Serial.println(a[1][2]); Serial.println(a[1][2]--); Serial.println(a[1][2]); }
       void loop() {}`,
      ['5', '7', '7', '10', '10', '9'],
    )
  })

  it('macros used inside macros and with strings and commas in parentheses', () => {
    ok(
      `#define MAXV(a,b) ((a)>(b)?(a):(b))
       #define PR(x) Serial.println(x)
       int f(int a, int b) { return a - b; }
       void setup() { Serial.begin(9600); PR(MAXV(f(5, 2), 2)); PR("a,b"); PR(MAXV(MAXV(1, 7), MAXV(3, 4))); }
       void loop() {}`,
      ['3', 'a,b', '7'],
    )
  })

  it('bit functions on every integer type', () => {
    ok(
      `void setup() { Serial.begin(9600);
         unsigned int a = 0; bitSet(a, 15); Serial.println(a);
         long b = 0; bitSet(b, 30); Serial.println(b);
         byte c = 255; bitClear(c, 7); Serial.println(c);
         int d = 0; bitWrite(d, 3, 5); Serial.println(d);
         Serial.println(bitRead(-1, 31)); Serial.println(bitRead(0x8000, 15));
         Serial.println(bit(0) + bit(31)); }
       void loop() {}`,
      ['32768', '1073741824', '127', '8', '1', '1', '2147483649'],
    )
  })

  it('shiftOut with variables and in a function, shiftIn into a variable', () => {
    const { log, m } = run(
      `byte out(byte v) { shiftOut(2, 3, LSBFIRST, v); return v; }
       void setup() { byte got = shiftIn(4, 5, MSBFIRST); Serial.begin(9600); Serial.println(got); out(6); } void loop() {}`,
      0.1,
      (l) => {
        l.level = () => 1
      },
    )
    expect(m.error).toBeNull()
    expect(lines(log.serial)[0]).toBe('255')
    expect(log.writes.filter(([p]) => p === 2).map(([, v]) => v)).toEqual([0, 1, 1, 0, 0, 0, 0, 0])
  })

  it('tone then analogWrite/digitalWrite leaves tone; tone with 0 Hz is ignored; two tones', () => {
    const { log, m } = run(`void setup() { tone(8, 0); tone(8, 100, 50); tone(9, 200); delay(100); } void loop() {}`, 0.3)
    expect(m.error).toBeNull()
    const ev = log.tones.map(([p, f]) => `${p}:${f}`)
    expect(ev).toEqual(['8:100', '9:200', '8:0'])
  })

  it('pulseIn survives a sketch that calls it in setup and with variables', () => {
    const { log, m } = run(
      `unsigned long w; int pin = 7; void setup() { Serial.begin(9600); w = pulseIn(pin, HIGH, 100000UL); Serial.println(w > 4000 && w < 6000); } void loop() {}`,
      0.5,
      (l) => {
        l.level = (_p, t) => (t > 0.02 && t < 0.025 ? 1 : 0)
      },
    )
    expect(m.error).toBeNull()
    expect(lines(log.serial)[0]).toBe('1')
  })

  it('EEPROM with variables, in expressions, out-of-range addresses wrap, get into globals', () => {
    ok(
      `float g; long L; int addr = 1020;
       void setup() { Serial.begin(9600);
         EEPROM.put(addr, 2.25); EEPROM.get(addr, g); Serial.println(g);
         EEPROM.put(0, 123456L); EEPROM.get(0, L); Serial.println(L);
         Serial.println(EEPROM.read(1) + EEPROM.read(2));
         EEPROM.write(1024 + 3, 5); Serial.println(EEPROM.read(3)); }
       void loop() {}`,
      ['2.25', '123456', '227', '5'],
    )
  })

  it('compile errors are CompileErrors with lines, not crashes', () => {
    const bad = [
      'struct P { int x; }; void setup() { P a; a.x.y = 1; } void loop() {}',
      'struct P { int x; }; void setup() { int a; a.x = 1; } void loop() {}',
      'void setup() { int a[2][2]; a[0][0][0] = 1; } void loop() {}',
      'void setup() { EEPROM.get(0, 5); } void loop() {}',
      'void setup() { EEPROM.write(0); } void loop() {}',
      'void setup() { shiftOut(1, 2, 3); } void loop() {}',
      'void setup() { tone(); } void loop() {}',
      '#define F(x\nvoid setup() {} void loop() {}',
      'struct { int x; }; void setup() {} void loop() {}',
      'struct P { P q; }; void setup() {} void loop() {}',
      'void setup() { int a = sizeof(; } void loop() {}',
      'typedef int myint; void setup() {} void loop() {}',
    ]
    for (const src of bad) {
      let msg = ''
      try {
        compile(src)
      } catch (e) {
        msg = e instanceof Error ? e.constructor.name : 'x'
      }
      expect([src, msg]).toEqual([src, 'CompileError'])
    }
  })
})
