import { describe, expect, it } from 'vitest'
import { compile, CompileError } from './compile.ts'
import { Machine } from './vm.ts'
import type { McuHost } from './vm.ts'

interface Log {
  writes: [number, number, number][] // pin, value, time
  modes: [number, number][]
  serial: string
  analog: Record<number, number>
  digital: Record<number, number>
  pwm: [number, number, number][]
}

function host(): { h: McuHost; log: Log } {
  const log: Log = { writes: [], modes: [], serial: '', analog: {}, digital: {}, pwm: [] }
  const h: McuHost = {
    pinMode: (p, m) => log.modes.push([p, m]),
    digitalWrite: (p, v, t) => log.writes.push([p, v, t]),
    digitalRead: (p) => log.digital[p] ?? 0,
    analogRead: (p) => log.analog[p] ?? 0,
    analogWrite: (p, v, t) => log.pwm.push([p, v, t]),
    serialWrite: (s) => {
      log.serial += s
    },
  }
  return { h, log }
}

function run(src: string, seconds: number, setup?: (log: Log) => void): { m: Machine; log: Log } {
  const { h, log } = host()
  setup?.(log)
  const m = new Machine(compile(src), h)
  // advance in 16 ms frames like the simulation does
  for (let t = 0.016; t <= seconds + 1e-9; t += 0.016) m.advance(t)
  return { m, log }
}

function errorOf(src: string): CompileError {
  try {
    compile(src)
  } catch (e) {
    if (e instanceof CompileError) return e
    throw e
  }
  throw new Error('expected a compile error')
}

const BLINK = `
void setup() { pinMode(LED_BUILTIN, OUTPUT); }
void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(1000);
  digitalWrite(LED_BUILTIN, LOW);
  delay(1000);
}`

describe('Arduino sketches', () => {
  it('runs Blink in real time: pin 13 flips every second', () => {
    const { log } = run(BLINK, 4.5)
    expect(log.modes).toEqual([[13, 1]])
    const flips = log.writes.map(([, v, t]) => [v, Math.round(t * 10) / 10])
    expect(flips[0]).toEqual([1, 0])
    expect(flips[1][0]).toBe(0)
    expect(flips[1][1]).toBeGreaterThan(0.99)
    expect(flips[1][1]).toBeLessThan(1.01)
    expect(flips[2][1]).toBeGreaterThan(1.99)
    expect(flips[2][1]).toBeLessThan(2.01)
    expect(flips.length).toBe(5)
  })

  it('does int arithmetic like the AVR: 16-bit wrap and integer division', () => {
    const { log } = run(
      `void setup() { Serial.begin(9600);
        int a = 32767; a = a + 1; Serial.println(a);
        Serial.println(7 / 2); Serial.println(-7 / 2); Serial.println(7 % 3);
        float f = 7 / 2.0; Serial.println(f);
        long big = 100000L * 3; Serial.println(big);
        unsigned int u = 65535; u++; Serial.println(u);
        byte b = 250; b += 10; Serial.println(b);
        Serial.println(1 << 4); Serial.println(0xFF & 0x0F); Serial.println(5 > 3 && 2 > 1);
      } void loop() {}`,
      0.1,
    )
    expect(log.serial.split('\r\n').slice(0, 11)).toEqual(['-32768', '3', '-3', '1', '3.50', '300000', '0', '4', '16', '15', '1'])
  })

  it('supports functions, recursion, arrays, for and while loops, switch and #define', () => {
    const { log } = run(
      `#define N 5
       const int scale = 2;
       int squares[N];
       int fact(int n) { if (n <= 1) return 1; return n * fact(n - 1); }
       int total(int a[], int len) { int s = 0; for (int i = 0; i < len; i++) s += a[i]; return s; }
       void setup() {
         Serial.begin(9600);
         for (int i = 0; i < N; i++) squares[i] = i * i * scale;
         Serial.println(total(squares, N));
         Serial.println(fact(5));
         int k = 0; while (k < 3) { k++; if (k == 2) continue; Serial.print(k); }
         Serial.println();
         switch (k) { case 1: Serial.println("one"); break; case 3: Serial.println("three"); break; default: Serial.println("other"); }
         int arr[] = {4, 5, 6};
         Serial.println(arr[1] + arr[2]);
         Serial.println(k > 2 ? "big" : "small");
       }
       void loop() {}`,
      0.2,
    )
    expect(log.serial).toBe('60\r\n120\r\n13\r\nthree\r\n11\r\nbig\r\n')
  })

  it('reads and writes pins: a button turns an LED on', () => {
    const src = `
      const int button = 2; const int led = 8;
      void setup() { pinMode(button, INPUT_PULLUP); pinMode(led, OUTPUT); }
      void loop() { if (digitalRead(button) == LOW) digitalWrite(led, HIGH); else digitalWrite(led, LOW); }`
    const { log } = run(src, 0.05, (l) => {
      l.digital[2] = 0
    })
    expect(log.modes).toEqual([[2, 2], [8, 1]])
    expect(log.writes.at(-1)).toEqual([8, 1, expect.any(Number)])
    const idle = run(src, 0.05, (l) => {
      l.digital[2] = 1
    })
    expect(idle.log.writes.at(-1)![1]).toBe(0)
  })

  it('analogRead scales, map and analogWrite make a dimmer', () => {
    const { log } = run(
      `void setup() { pinMode(9, OUTPUT); }
       void loop() { int v = analogRead(A0); analogWrite(9, map(v, 0, 1023, 0, 255)); }`,
      0.05,
      (l) => {
        l.analog[14] = 512
      },
    )
    expect(log.pwm.at(-1)![0]).toBe(9)
    expect(log.pwm.at(-1)![1]).toBe(127)
  })

  it('millis agrees with delay, and Serial prints floats with 2 decimals', () => {
    const { log } = run(
      `void setup() { Serial.begin(9600); delay(250); Serial.println(millis()); Serial.println(3.14159, 3); Serial.println('A'); Serial.println(255, HEX); }
       void loop() {}`,
      0.5,
    )
    const lines = log.serial.split('\r\n')
    expect(Number(lines[0])).toBeGreaterThanOrEqual(250)
    expect(Number(lines[0])).toBeLessThan(252)
    expect(lines.slice(1, 4)).toEqual(['3.142', 'A', 'FF'])
  })

  it('does String concatenation with numbers', () => {
    const { log } = run(
      `void setup() { Serial.begin(9600); String s = "T="; s += 21; s = s + "C"; Serial.println(s); Serial.println(s.length()); }
       void loop() {}`,
      0.1,
    )
    expect(log.serial).toBe('T=21C\r\n5\r\n')
  })

  it('reads text sent to Serial', () => {
    const { h, log } = host()
    const m = new Machine(
      compile(`void setup() { Serial.begin(9600); } void loop() { if (Serial.available() > 0) { int c = Serial.read(); Serial.write(c + 1); } }`),
      h,
    )
    m.advance(0.05)
    m.serialIn('abc')
    m.advance(0.1)
    expect(log.serial).toBe('bcd')
  })

  it('a loop with no delay takes machine time, and a runaway loop does not hang', () => {
    const { m } = run(`void setup() {} void loop() { while (true) { } }`, 0.2)
    expect(m.time).toBeGreaterThan(0.19)
    expect(m.error).toBeNull()
  })

  it('stops with a message on division by zero and on a bad array index', () => {
    const a = run(`int z = 0; void setup() { Serial.begin(9600); Serial.println(5 / z); } void loop() {}`, 0.1)
    expect(a.m.error).toContain('division by zero')
    const b = run(`int v[3]; void setup() { v[5] = 1; } void loop() {}`, 0.1)
    expect(b.m.error).toContain('out of range')
    expect(b.m.error).toContain('line 1')
  })

  it('names the line and the problem for the usual mistakes', () => {
    expect(errorOf('void setup() {\n  pinMod(13, OUTPUT);\n}\nvoid loop() {}').line).toBe(2)
    expect(errorOf('void setup() {\n  pinMod(13, OUTPUT);\n}\nvoid loop() {}').message).toContain("'pinMod' was not declared")
    const semi = errorOf('void setup() {\n  int a = 5\n  a++;\n}\nvoid loop() {}')
    expect(semi.line).toBe(3)
    expect(semi.message).toContain("expected ';'")
    expect(errorOf('void setup() {}').message).toContain("'loop' was not declared")
    expect(errorOf('void setup() { x = 1; } void loop() {}').message).toContain("'x' was not declared")
    expect(errorOf('void setup() { tone(8, 440); } void loop() {}').message).toContain('not supported')
    expect(errorOf('int f(int a) { return a; } void setup() { f(1, 2); } void loop() {}').message).toContain('too many arguments')
  })

  it('blinks without delay using millis, as the examples do', () => {
    const { log } = run(
      `const int led = 13; unsigned long previous = 0; const long interval = 250; int state = LOW;
       void setup() { pinMode(led, OUTPUT); }
       void loop() {
         unsigned long now = millis();
         if (now - previous >= interval) { previous = now; state = state == LOW ? HIGH : LOW; digitalWrite(led, state); }
       }`,
      1.05,
    )
    expect(log.writes.length).toBeGreaterThanOrEqual(4)
    expect(log.writes.length).toBeLessThanOrEqual(5)
    expect(log.writes.map(([, v]) => v).slice(0, 4)).toEqual([1, 0, 1, 0])
  })

  it('a library the simulator does not have is named, not a mystery', () => {
    const e = errorOf(['#include <Servo.h>', 'Servo myServo;', 'void setup() {}', 'void loop() {}'].join('\n'))
    expect(e.line).toBe(2)
    expect(e.message).toContain("'Servo'")
    expect(e.message).toContain('not available')
  })

  it('no output before Serial.begin, like the real chip', () => {
    const { log } = run(`void setup() { Serial.println("hi"); } void loop() {}`, 0.1)
    expect(log.serial).toBe('')
  })
})
