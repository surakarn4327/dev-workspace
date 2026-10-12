import { describe, expect, it } from 'vitest'
import { compile } from './compile.ts'
import { Machine } from './vm.ts'
import { errorOf, host, run } from './testkit.ts'

const lines = (s: string): string[] => s.split('\r\n')

describe('2-D arrays', () => {
  it('declare, fill, read and pass to functions', () => {
    const { log } = run(
      `#define ROWS 3
       const int COLS = 4;
       int grid[ROWS][COLS];
       byte pattern[2][3] = {{1, 2, 3}, {4, 5, 6}};
       int sum(int m[][4], int rows) { int s = 0; for (int r = 0; r < rows; r++) for (int c = 0; c < 4; c++) s += m[r][c]; return s; }
       int rowSum(int row[], int n) { int s = 0; for (int i = 0; i < n; i++) s += row[i]; return s; }
       void setup() {
         Serial.begin(9600);
         for (int r = 0; r < ROWS; r++) for (int c = 0; c < COLS; c++) grid[r][c] = r * 10 + c;
         Serial.println(grid[2][3]);
         Serial.println(sum(grid, 3));
         Serial.println(rowSum(grid[1], 4));
         Serial.println(pattern[1][2] + pattern[0][0]);
         grid[1][1] += 5; grid[1][1]++;
         Serial.println(grid[1][1]);
         int local[2][2] = {{1, 2}, {3, 4}};
         local[0][1] = local[1][0] * 10;
         Serial.println(local[0][1]);
         char names[2][6] = {"red", "green"};
         Serial.println(names[1][0]);
         Serial.println(names[0]);
       } void loop() {}`,
      0.3,
    )
    // grid = r*10+c: total over all cells = 4*(0+10+20) + 3*(0+1+2+3) = 138; row 1 = 10+11+12+13 = 46
    expect(lines(log.serial).slice(0, 8)).toEqual(['23', '138', '46', '7', '17', '30', 'g', 'red'])
  })

  it('an index out of range stops the sketch with the line', () => {
    const { m } = run(`int g[2][3]; void setup() { g[1][5] = 1; } void loop() {}`, 0.1)
    expect(m.error).toContain('out of range')
    const { m: n } = run(`int g[2][3]; void setup() { g[2][0] = 1; } void loop() {}`, 0.1)
    expect(n.error).toContain('out of range')
  })

  it('a 2-D array needs both indexes', () => {
    expect(errorOf('int g[2][3]; void setup() { g[1] = 5; } void loop() {}').message).toContain('both indexes')
    expect(errorOf('int g[2][3][4]; void setup() {} void loop() {}').message).toContain('more than two dimensions')
    expect(errorOf('int g[2][3] = {1, 2}; void setup() {} void loop() {}').message).toContain('{{...}')
  })
})

describe('function-like #define', () => {
  it('expands with arguments, nested parentheses and nested macros', () => {
    const { log } = run(
      `#define SQ(x) ((x)*(x))
       #define MAX2(a, b) ((a) > (b) ? (a) : (b))
       #define AREA(w, h) (SQ(w) + MAX2(h, 1))
       #define LED 13
       #define TWICE(x) x + x
       #define NONE() 7
       void setup() { Serial.begin(9600);
         Serial.println(SQ(3 + 1));
         Serial.println(MAX2(SQ(2), 3));
         Serial.println(AREA(2, 5));
         Serial.println(LED);
         Serial.println(2 * TWICE(3));
         Serial.println(NONE());
         Serial.println(MAX2(analogRead(A0), min(4, 9)));
       } void loop() {}`,
      0.2,
    )
    expect(lines(log.serial).slice(0, 7)).toEqual(['16', '4', '9', '13', '9', '7', '4'])
  })

  it('a bare macro name is only a name, and a bad call is explained', () => {
    expect(errorOf('#define F2(x) (x)\nvoid setup() { int a = F2; } void loop() {}').message).toContain("'F2' was not declared")
    const e = errorOf('#define SQ(x) ((x)*(x))\nvoid setup() {\n  int a = SQ(1, 2);\n}\nvoid loop() {}')
    expect(e.message).toContain("macro 'SQ' requires 1 argument")
    expect(e.line).toBe(3)
    expect(errorOf('#define SQ(x) ((x)*(x))\nvoid setup() { int a = SQ(3; } void loop() {}').message).toContain('unterminated')
  })
})

describe('struct, typedef, const, static and the integer types', () => {
  it('a struct holds members, copies by value and works in arrays and functions', () => {
    const { log } = run(
      `struct Point { int x; int y; };
       typedef struct { byte r, g, b; float level; } Colour;
       Point origin;
       Point pts[3] = {{1, 2}, {3, 4}, {5, 6}};
       Point add(Point a, Point b) { Point r; r.x = a.x + b.x; r.y = a.y + b.y; return r; }
       void bump(Point p) { p.x = 99; }
       void setup() {
         Serial.begin(9600);
         Point p = {10, 20};
         Point q = p;
         q.x = 11;
         Serial.println(p.x); Serial.println(q.x);
         bump(p); Serial.println(p.x);
         Point s = add(p, pts[2]);
         Serial.println(s.x); Serial.println(s.y);
         pts[1].y += 6; pts[1].x++;
         Serial.println(pts[1].x); Serial.println(pts[1].y);
         Serial.println(origin.x);
         Colour c = {255, 128, 0, 0.5};
         c.b = c.r + 3;
         Serial.println(c.b); Serial.println(c.level);
         struct Point z; z.y = -4; Serial.println(z.y);
       } void loop() {}`,
      0.3,
    )
    expect(lines(log.serial).slice(0, 11)).toEqual(['10', '11', '10', '15', '26', '4', '10', '0', '2', '0.50', '-4'])
  })

  it('a struct cannot be used like a number', () => {
    expect(errorOf('struct P { int x; }; void setup() { P a; int b = a; } void loop() {}').message).toContain("cannot convert 'P'")
    expect(errorOf('struct P { int x; }; void setup() { P a; a.nope = 1; } void loop() {}').message).toContain("no member named 'nope'")
    expect(errorOf('struct P { int x; }; void setup() { P a; Serial.begin(9600); Serial.println(a); } void loop() {}').message).toContain('struct')
    expect(errorOf('struct P { int x; }; void setup() { P a; if (a == a) {} } void loop() {}').message).toContain('struct')
  })

  it('const, static, byte, unsigned and long behave', () => {
    const { log } = run(
      `const int LIMIT = 3;
       const byte table[] = {1, 2, 4, 8};
       int counter() { static int n = 0; n++; return n; }
       void setup() { Serial.begin(9600);
         counter(); counter(); Serial.println(counter());
         unsigned long big = 4000000000UL; Serial.println(big);
         long neg = -70000L; Serial.println(neg);
         unsigned int u = 40000; Serial.println(u);
         byte b = 200; b += 100; Serial.println(b);
         uint8_t x = 255; x++; Serial.println(x);
         int16_t i = 32767; i++; Serial.println(i);
         uint32_t t = 0; t--; Serial.println(t);
         word w = 65535; w++; Serial.println(w);
         Serial.println(table[3] + LIMIT);
         unsigned char uc = 250; uc += 10; Serial.println(uc);
         short sh = 1000; Serial.println(sh);
       } void loop() {}`,
      0.3,
    )
    expect(lines(log.serial).slice(0, 12)).toEqual(['3', '4000000000', '-70000', '40000', '44', '0', '-32768', '4294967295', '0', '11', '4', '1000'])
    expect(errorOf('const int LIMIT = 3; void setup() { LIMIT = 4; } void loop() {}').message).toContain('read-only')
  })

  it('PROGMEM and F() pass through, and pgm_read_* read the table', () => {
    const { log } = run(
      `const char msg[] PROGMEM = "hi";
       const int table[] PROGMEM = {10, 20, 30};
       const PROGMEM byte small[] = {7, 8};
       void setup() { Serial.begin(9600);
         Serial.println(F("flash text"));
         Serial.println(pgm_read_word(&table[2]));
         Serial.println(pgm_read_byte(&small[1]));
         Serial.println(msg);
       } void loop() {}`,
      0.2,
    )
    expect(lines(log.serial).slice(0, 4)).toEqual(['flash text', '30', '8', 'hi'])
  })
})

describe('Serial.print overloads', () => {
  it('prints integers in every base the way the Arduino core does', () => {
    const { log } = run(
      `void setup() { Serial.begin(9600);
        Serial.println(255, DEC); Serial.println(255, HEX); Serial.println(255, OCT); Serial.println(5, BIN);
        Serial.println(-1, HEX);
        byte b = 255; Serial.println(b, HEX); Serial.println(b, BIN);
        unsigned int u = 65535; Serial.println(u, HEX);
        long l = -2; Serial.println(l, DEC); Serial.println(l, HEX);
        Serial.println('A', HEX); Serial.println('A', DEC); Serial.println('A');
        Serial.println(true); Serial.println(65);
      } void loop() {}`,
      0.3,
    )
    expect(lines(log.serial).slice(0, 15)).toEqual(['255', 'FF', '377', '101', 'FFFFFFFF', 'FF', '11111111', 'FFFF', '-2', 'FFFFFFFE', '41', '65', 'A', '1', '65'])
  })

  it('prints floats with the Arduino rounding, nan, inf and ovf', () => {
    const { log } = run(
      `void setup() { Serial.begin(9600);
        Serial.println(3.14159); Serial.println(3.14159, 0); Serial.println(3.14159, 4); Serial.println(2.5, 0); Serial.println(-0.5);
        Serial.println(1.0 / 3.0, 5); Serial.println(100.0); Serial.println(7.0 / 8.0, 3);
        float zero = 0; Serial.println(1.0 / zero); Serial.println(-1.0 / zero); Serial.println(zero / zero);
        float huge = 5000000000.0; Serial.println(huge);
        Serial.println(String(2.0 / 3.0)); Serial.println(String(7.5, 1));
      } void loop() {}`,
      0.3,
    )
    expect(lines(log.serial).slice(0, 14)).toEqual(['3.14', '3', '3.1416', '3', '-0.50', '0.33333', '100.00', '0.875', 'inf', 'inf', 'nan', 'ovf', '0.67', '7.5'])
  })

  it('print and println take every argument shape, write sends bytes and buffers', () => {
    const { log } = run(
      `void setup() { Serial.begin(9600);
        Serial.print("a"); Serial.print(1); Serial.print('b'); Serial.print(2.5); Serial.println();
        Serial.println("end");
        Serial.write(65); Serial.write("BC"); Serial.write('D'); Serial.println();
        byte buf[] = {69, 70, 71, 72};
        Serial.write(buf, 3); Serial.println();
        char word2[] = "text"; Serial.println(word2);
        String s = "str"; Serial.print(s); Serial.println(s.length());
      } void loop() {}`,
      0.3,
    )
    expect(lines(log.serial).slice(0, 6)).toEqual(['a1b2.50', 'end', 'ABCD', 'EFG', 'text', 'str3'])
  })

  it('readString and readStringUntil take what was sent', () => {
    const { h, log } = host()
    const m = new Machine(
      compile(
        `void setup() { Serial.begin(9600); } void loop() { if (Serial.available()) { String a = Serial.readStringUntil(','); String b = Serial.readString(); Serial.print(a); Serial.print('|'); Serial.println(b); } }`,
      ),
      h,
    )
    m.advance(0.05)
    m.serialIn('left,right')
    m.advance(0.2)
    expect(log.serial).toBe('left|right\r\n')
  })
})
