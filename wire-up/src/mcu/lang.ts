// The Arduino C++ subset the Uno runs: a lexer with #define / #include, and a recursive-descent parser. No DOM, no imports from
// the rest of the app, so the language can be tested on its own.
//
// Supported: global and local variables and arrays, const / static / unsigned, int types, float, bool, char, String; functions with
// parameters and return values (recursion included); if / else, for, while, do-while, switch, break, continue, return; the C
// operators with C precedence, casts, ++ / --, compound assignment, ?: ; object-like #define; Serial and the Arduino core calls.

export type Type = 'void' | 'bool' | 'char' | 'byte' | 'int' | 'uint' | 'long' | 'ulong' | 'float' | 'String'

export class CompileError extends Error {
  readonly line: number
  constructor(message: string, line: number) {
    super(message)
    this.line = line
  }
}

// ---------------------------------------------------------------- lexer

export interface Token {
  /** id, num, str, chr, op, eof */
  t: 'id' | 'num' | 'str' | 'chr' | 'op' | 'eof'
  v: string
  n: number
  float: boolean
  line: number
}

const OPS3 = ['<<=', '>>=', '...']
const OPS2 = ['++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '::', '->']

const ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', '0': '\0', '\\': '\\', "'": "'", '"': '"' }

/** Turn source text into tokens, applying `#define NAME value` and ignoring `#include`. */
export function lex(source: string): { tokens: Token[]; includes: string[] } {
  const raw: Token[] = []
  const includes: string[] = []
  const macros = new Map<string, Token[]>()
  let i = 0
  let line = 1
  const n = source.length
  const push = (t: Token['t'], v: string, num = 0, float = false): void => {
    raw.push({ t, v, n: num, float, line })
  }
  let lineStart = true
  while (i < n) {
    const c = source[i]
    if (c === '\n') {
      line++
      i++
      lineStart = true
      continue
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++
      continue
    }
    if (c === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') i++
      continue
    }
    if (c === '/' && source[i + 1] === '*') {
      i += 2
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') line++
        i++
      }
      i += 2
      continue
    }
    if (c === '#' && lineStart) {
      let j = i + 1
      while (j < n && source[j] !== '\n') j++
      const text = source.slice(i + 1, j).trim()
      const at = line
      i = j
      const m = /^(\w+)\s*(.*)$/.exec(text)
      if (!m) continue
      if (m[1] === 'include') {
        includes.push(m[2].replace(/[<>"]/g, '').trim())
      } else if (m[1] === 'define') {
        const d = /^(\w+)(\(?)\s*(.*)$/.exec(m[2])
        if (!d) throw new CompileError("macro names must be identifiers: '#define' needs a name", at)
        if (d[2] === '(') throw new CompileError('function-like #define macros are not supported: use a function instead', at)
        const body = lex(d[3]).tokens
        body.pop() // eof
        for (const t of body) t.line = at
        macros.set(d[1], body)
      }
      continue
    }
    lineStart = false
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1
      while (j < n && /[A-Za-z0-9_]/.test(source[j])) j++
      push('id', source.slice(i, j))
      i = j
      continue
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
      let j = i
      let float = false
      let value: number
      if (c === '0' && /[xX]/.test(source[i + 1] ?? '')) {
        j = i + 2
        while (j < n && /[0-9a-fA-F]/.test(source[j])) j++
        value = parseInt(source.slice(i + 2, j), 16)
      } else if (c === '0' && /[bB]/.test(source[i + 1] ?? '')) {
        j = i + 2
        while (j < n && /[01]/.test(source[j])) j++
        value = parseInt(source.slice(i + 2, j), 2)
      } else {
        while (j < n && /[0-9]/.test(source[j])) j++
        if (source[j] === '.') {
          float = true
          j++
          while (j < n && /[0-9]/.test(source[j])) j++
        }
        if (/[eE]/.test(source[j] ?? '') && /[-+0-9]/.test(source[j + 1] ?? '')) {
          float = true
          j += 2
          while (j < n && /[0-9]/.test(source[j])) j++
        }
        value = parseFloat(source.slice(i, j))
      }
      // suffixes: u, l, ul, f
      while (j < n && /[uUlLfF]/.test(source[j])) {
        if (/[fF]/.test(source[j])) float = true
        j++
      }
      push('num', source.slice(i, j), value, float)
      i = j
      continue
    }
    if (c === '"') {
      let j = i + 1
      let s = ''
      while (j < n && source[j] !== '"') {
        if (source[j] === '\n') throw new CompileError('missing terminating " character', line)
        if (source[j] === '\\') {
          j++
          s += ESCAPES[source[j]] ?? source[j]
        } else s += source[j]
        j++
      }
      push('str', s)
      i = j + 1
      continue
    }
    if (c === "'") {
      let j = i + 1
      let ch = source[j]
      if (ch === '\\') {
        j++
        ch = ESCAPES[source[j]] ?? source[j]
      }
      j++
      if (source[j] !== "'") throw new CompileError('missing terminating \' character', line)
      push('chr', ch, ch.charCodeAt(0))
      i = j + 1
      continue
    }
    const three = source.slice(i, i + 3)
    const two = source.slice(i, i + 2)
    if (OPS3.includes(three)) {
      push('op', three)
      i += 3
    } else if (OPS2.includes(two)) {
      push('op', two)
      i += 2
    } else if ('+-*/%=<>!&|^~?:;,.(){}[]'.includes(c)) {
      push('op', c)
      i++
    } else {
      throw new CompileError(`stray '${c}' in program`, line)
    }
  }
  raw.push({ t: 'eof', v: '', n: 0, float: false, line })
  // macro expansion (object-like, nested a few levels)
  if (macros.size === 0) return { tokens: raw, includes }
  const out: Token[] = []
  const expand = (t: Token, depth: number): void => {
    const body = t.t === 'id' ? macros.get(t.v) : undefined
    if (body && depth < 8) for (const b of body) expand({ ...b, line: t.line }, depth + 1)
    else out.push(t)
  }
  for (const t of raw) expand(t, 0)
  return { tokens: out, includes }
}

// ---------------------------------------------------------------- syntax tree

export type Expr =
  | { k: 'num'; v: number; float: boolean; line: number }
  | { k: 'str'; v: string; line: number }
  | { k: 'chr'; v: number; line: number }
  | { k: 'id'; name: string; line: number }
  | { k: 'idx'; arr: Expr; i: Expr; line: number }
  | { k: 'call'; name: string; args: Expr[]; line: number }
  | { k: 'method'; obj: Expr; name: string; args: Expr[]; line: number }
  | { k: 'un'; op: '-' | '!' | '~' | '+'; e: Expr; line: number }
  | { k: 'bin'; op: string; a: Expr; b: Expr; line: number }
  | { k: 'asg'; op: string; target: Expr; v: Expr; line: number }
  | { k: 'inc'; op: '++' | '--'; prefix: boolean; target: Expr; line: number }
  | { k: 'cond'; c: Expr; a: Expr; b: Expr; line: number }
  | { k: 'cast'; type: Type; e: Expr; line: number }

export type Stmt =
  | { k: 'decl'; type: Type; name: string; array: boolean; len: Expr | null; init: Expr | Expr[] | null; isStatic: boolean; isConst: boolean; line: number }
  | { k: 'expr'; e: Expr; line: number }
  | { k: 'if'; c: Expr; t: Stmt; f: Stmt | null; line: number }
  | { k: 'for'; init: Stmt | null; c: Expr | null; step: Expr | null; body: Stmt; line: number }
  | { k: 'while'; c: Expr; body: Stmt; line: number }
  | { k: 'do'; body: Stmt; c: Expr; line: number }
  | { k: 'switch'; e: Expr; cases: { v: Expr | null; body: Stmt[] }[]; line: number }
  | { k: 'break'; line: number }
  | { k: 'continue'; line: number }
  | { k: 'return'; e: Expr | null; line: number }
  | { k: 'block'; body: Stmt[]; line: number }
  | { k: 'empty'; line: number }

export interface Param {
  type: Type
  name: string
  array: boolean
}

export interface FuncDef {
  name: string
  ret: Type
  params: Param[]
  body: Stmt[] | null // null = a prototype
  line: number
}

export interface Ast {
  globals: Extract<Stmt, { k: 'decl' }>[]
  funcs: FuncDef[]
  includes: string[]
}

// ---------------------------------------------------------------- parser

const TYPE_WORDS: Record<string, Type> = {
  void: 'void',
  bool: 'bool',
  boolean: 'bool',
  char: 'char',
  byte: 'byte',
  int: 'int',
  short: 'int',
  long: 'long',
  float: 'float',
  double: 'float',
  String: 'String',
  uint8_t: 'byte',
  int8_t: 'char',
  uint16_t: 'uint',
  int16_t: 'int',
  uint32_t: 'ulong',
  int32_t: 'long',
  word: 'uint',
  size_t: 'uint',
}
const MODIFIERS = new Set(['const', 'static', 'volatile', 'unsigned', 'signed', 'register', 'inline'])

const BIN_PREC: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '|': 3,
  '^': 4,
  '&': 5,
  '==': 6,
  '!=': 6,
  '<': 7,
  '<=': 7,
  '>': 7,
  '>=': 7,
  '<<': 8,
  '>>': 8,
  '+': 9,
  '-': 9,
  '*': 10,
  '/': 10,
  '%': 10,
}

const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>='])

class Parser {
  private p = 0
  private toks: Token[]
  constructor(toks: Token[]) {
    this.toks = toks
  }

  private get cur(): Token {
    return this.toks[this.p]
  }
  private peek(k = 1): Token {
    return this.toks[Math.min(this.p + k, this.toks.length - 1)]
  }
  private next(): Token {
    return this.toks[this.p++]
  }
  private isOp(v: string): boolean {
    return this.cur.t === 'op' && this.cur.v === v
  }
  private accept(v: string): boolean {
    if (this.isOp(v)) {
      this.p++
      return true
    }
    return false
  }
  private describe(t: Token): string {
    return t.t === 'eof' ? 'end of file' : `'${t.t === 'str' ? `"${t.v}"` : t.v}'`
  }
  private expect(v: string, what = `'${v}'`): Token {
    if (!this.isOp(v)) throw new CompileError(`expected ${what} before ${this.describe(this.cur)}`, this.cur.line)
    return this.next()
  }
  private ident(what = 'a name'): string {
    if (this.cur.t !== 'id') throw new CompileError(`expected ${what} before ${this.describe(this.cur)}`, this.cur.line)
    return this.next().v
  }

  /** Is the next thing the start of a declaration (a type, perhaps with modifiers)? */
  private atType(): boolean {
    let k = 0
    while (this.peek(k).t === 'id' && MODIFIERS.has(this.peek(k).v)) k++
    const t = this.peek(k)
    if (t.t !== 'id') return false
    if (k > 0 && (t.v === 'unsigned' || t.v === 'signed')) return true
    if (TYPE_WORDS[t.v] !== undefined) {
      // `int(x)` is a call-style cast, not a declaration
      return !(this.peek(k + 1).t === 'op' && this.peek(k + 1).v === '(')
    }
    return k > 0 && (this.cur.v === 'unsigned' || this.cur.v === 'signed')
  }

  /** Modifiers and a type word: returns the type and whether `static` was given. */
  private parseType(): { type: Type; isStatic: boolean; isConst: boolean } {
    let unsigned = false
    let isStatic = false
    let isConst = false
    let base: Type | null = null
    let longs = 0
    for (;;) {
      const t = this.cur
      if (t.t !== 'id') break
      if (t.v === 'unsigned') unsigned = true
      else if (t.v === 'static') isStatic = true
      else if (t.v === 'const') isConst = true
      else if (t.v === 'volatile' || t.v === 'signed' || t.v === 'register' || t.v === 'inline') {
        // no effect here
      } else if (t.v === 'long') {
        longs++
        base = 'long'
      } else if (TYPE_WORDS[t.v] !== undefined) {
        if (base !== null && !(base === 'long' && (t.v === 'int'))) break
        base = TYPE_WORDS[t.v]
      } else break
      this.p++
    }
    if (base === null) {
      if (unsigned) base = 'uint'
      else throw new CompileError(`expected a type before ${this.describe(this.cur)}`, this.cur.line)
    }
    if (unsigned) {
      if (base === 'int') base = 'uint'
      else if (base === 'long') base = 'ulong'
      else if (base === 'char') base = 'byte'
    }
    void longs
    return { type: base, isStatic, isConst }
  }

  parseProgram(includes: string[]): Ast {
    const ast: Ast = { globals: [], funcs: [], includes }
    while (this.cur.t !== 'eof') {
      if (this.accept(';')) continue
      const line = this.cur.line
      if (!this.atType()) {
        if (this.cur.t === 'id' && this.peek().t === 'id') throw this.unknownType(this.cur)
        throw new CompileError(`expected a declaration before ${this.describe(this.cur)}`, line)
      }
      const { type, isStatic, isConst } = this.parseType()
      const name = this.ident()
      if (this.isOp('(')) {
        ast.funcs.push(this.parseFunction(type, name, line))
      } else {
        this.parseDeclRest(type, name, isStatic, isConst, line, ast.globals)
        this.expect(';')
      }
    }
    return ast
  }

  private parseFunction(ret: Type, name: string, line: number): FuncDef {
    this.expect('(')
    const params: Param[] = []
    if (!this.isOp(')')) {
      if (this.cur.t === 'id' && this.cur.v === 'void' && this.peek().t === 'op' && this.peek().v === ')') this.p++
      else {
        do {
          const { type } = this.parseType()
          const pname = this.cur.t === 'id' ? this.next().v : ''
          let array = false
          if (this.accept('[')) {
            this.expect(']')
            array = true
          }
          params.push({ type, name: pname, array })
        } while (this.accept(','))
      }
    }
    this.expect(')')
    if (this.accept(';')) return { name, ret, params, body: null, line }
    this.expect('{', "'{'")
    const body = this.parseBlockBody()
    return { name, ret, params, body, line }
  }

  /** After the type and first name: array suffix, initialiser, further `, name = ...` declarators. */
  private parseDeclRest(type: Type, first: string, isStatic: boolean, isConst: boolean, line: number, out: Extract<Stmt, { k: 'decl' }>[]): void {
    let name = first
    for (;;) {
      let array = false
      let len: Expr | null = null
      if (this.accept('[')) {
        array = true
        if (!this.isOp(']')) len = this.parseExpr()
        this.expect(']')
        if (this.isOp('[')) throw new CompileError('arrays with more than one dimension are not supported', this.cur.line)
      }
      let init: Expr | Expr[] | null = null
      if (this.accept('=')) {
        if (array && this.isOp('{')) {
          this.p++
          const items: Expr[] = []
          if (!this.isOp('}')) {
            do {
              if (this.isOp('}')) break
              items.push(this.parseAssign())
            } while (this.accept(','))
          }
          this.expect('}')
          init = items
        } else if (array && this.cur.t === 'str') {
          const s = this.next()
          init = [...s.v].map((ch) => ({ k: 'chr', v: ch.charCodeAt(0), line: s.line }) as Expr)
          init.push({ k: 'chr', v: 0, line: s.line })
        } else init = this.parseAssign()
      }
      out.push({ k: 'decl', type, name, array, len, init, isStatic, isConst, line })
      if (!this.accept(',')) break
      name = this.ident()
    }
  }

  private parseBlockBody(): Stmt[] {
    const body: Stmt[] = []
    while (!this.isOp('}')) {
      if (this.cur.t === 'eof') throw new CompileError("expected '}' at end of input", this.cur.line)
      body.push(...this.parseStmtList())
    }
    this.p++
    return body
  }

  /** One statement (a declaration can make several). */
  private parseStmtList(): Stmt[] {
    if (this.atType()) {
      const line = this.cur.line
      const { type, isStatic, isConst } = this.parseType()
      const name = this.ident()
      const out: Extract<Stmt, { k: 'decl' }>[] = []
      this.parseDeclRest(type, name, isStatic, isConst, line, out)
      this.expect(';')
      return out
    }
    return [this.parseStmt()]
  }

  /** `Servo myServo;` and the like: a name where a type was expected. */
  private unknownType(t: Token): CompileError {
    return new CompileError(`'${t.v}' does not name a type here (libraries such as Servo, Wire and LiquidCrystal are not available in this simulator yet)`, t.line)
  }

  private parseStmt(): Stmt {
    const t = this.cur
    const line = t.line
    if (t.t === 'id' && this.peek().t === 'id' && !MODIFIERS.has(t.v) && TYPE_WORDS[t.v] === undefined && !['else', 'case', 'default', 'return', 'do'].includes(t.v)) throw this.unknownType(t)
    if (t.t === 'op') {
      if (t.v === '{') {
        this.p++
        return { k: 'block', body: this.parseBlockBody(), line }
      }
      if (t.v === ';') {
        this.p++
        return { k: 'empty', line }
      }
    }
    if (t.t === 'id') {
      switch (t.v) {
        case 'if': {
          this.p++
          this.expect('(')
          const c = this.parseExpr()
          this.expect(')')
          const th = this.parseStmt()
          let f: Stmt | null = null
          if (this.cur.t === 'id' && this.cur.v === 'else') {
            this.p++
            f = this.parseStmt()
          }
          return { k: 'if', c, t: th, f, line }
        }
        case 'while': {
          this.p++
          this.expect('(')
          const c = this.parseExpr()
          this.expect(')')
          return { k: 'while', c, body: this.parseStmt(), line }
        }
        case 'do': {
          this.p++
          const body = this.parseStmt()
          if (!(this.cur.t === 'id' && this.cur.v === 'while')) throw new CompileError(`expected 'while' before ${this.describe(this.cur)}`, this.cur.line)
          this.p++
          this.expect('(')
          const c = this.parseExpr()
          this.expect(')')
          this.expect(';')
          return { k: 'do', body, c, line }
        }
        case 'for': {
          this.p++
          this.expect('(')
          let init: Stmt | null = null
          if (!this.isOp(';')) {
            if (this.atType()) {
              const list = this.parseStmtList() // consumes ';'
              init = list.length === 1 ? list[0] : { k: 'block', body: list, line }
              // parseStmtList consumed the ';'
              return this.finishFor(init, line, true)
            }
            init = { k: 'expr', e: this.parseExpr(), line }
          }
          return this.finishFor(init, line, false)
        }
        case 'switch': {
          this.p++
          this.expect('(')
          const e = this.parseExpr()
          this.expect(')')
          this.expect('{')
          const cases: { v: Expr | null; body: Stmt[] }[] = []
          while (!this.isOp('}')) {
            if (this.cur.t === 'id' && this.cur.v === 'case') {
              this.p++
              const v = this.parseTernary()
              this.expect(':')
              cases.push({ v, body: [] })
            } else if (this.cur.t === 'id' && this.cur.v === 'default') {
              this.p++
              this.expect(':')
              cases.push({ v: null, body: [] })
            } else {
              if (cases.length === 0) throw new CompileError(`expected 'case' before ${this.describe(this.cur)}`, this.cur.line)
              cases[cases.length - 1].body.push(...this.parseStmtList())
            }
            if (this.cur.t === 'eof') throw new CompileError("expected '}' at end of input", this.cur.line)
          }
          this.p++
          return { k: 'switch', e, cases, line }
        }
        case 'break':
          this.p++
          this.expect(';')
          return { k: 'break', line }
        case 'continue':
          this.p++
          this.expect(';')
          return { k: 'continue', line }
        case 'return': {
          this.p++
          let e: Expr | null = null
          if (!this.isOp(';')) e = this.parseExpr()
          this.expect(';')
          return { k: 'return', e, line }
        }
        default:
          break
      }
    }
    const e = this.parseExpr()
    this.expect(';')
    return { k: 'expr', e, line }
  }

  private finishFor(init: Stmt | null, line: number, semiConsumed: boolean): Stmt {
    if (!semiConsumed) this.expect(';')
    const c = this.isOp(';') ? null : this.parseExpr()
    this.expect(';')
    const step = this.isOp(')') ? null : this.parseExpr()
    this.expect(')')
    return { k: 'for', init, c, step, body: this.parseStmt(), line }
  }

  // ---- expressions

  parseExpr(): Expr {
    let e = this.parseAssign()
    while (this.accept(',')) {
      // the comma operator: evaluate both, keep the right
      const b = this.parseAssign()
      e = { k: 'bin', op: ',', a: e, b, line: e.line }
    }
    return e
  }

  private parseAssign(): Expr {
    const left = this.parseTernary()
    if (this.cur.t === 'op' && ASSIGN_OPS.has(this.cur.v)) {
      const op = this.next()
      if (left.k !== 'id' && left.k !== 'idx') throw new CompileError(`lvalue required as left operand of assignment`, op.line)
      return { k: 'asg', op: op.v, target: left, v: this.parseAssign(), line: op.line }
    }
    return left
  }

  private parseTernary(): Expr {
    const c = this.parseBinary(1)
    if (this.isOp('?')) {
      const line = this.next().line
      const a = this.parseAssign()
      this.expect(':')
      const b = this.parseAssign()
      return { k: 'cond', c, a, b, line }
    }
    return c
  }

  private parseBinary(minPrec: number): Expr {
    let left = this.parseUnary()
    for (;;) {
      const t = this.cur
      if (t.t !== 'op') break
      const prec = BIN_PREC[t.v]
      if (prec === undefined || prec < minPrec) break
      this.p++
      const right = this.parseBinary(prec + 1)
      left = { k: 'bin', op: t.v, a: left, b: right, line: t.line }
    }
    return left
  }

  private parseUnary(): Expr {
    const t = this.cur
    if (t.t === 'op') {
      if (t.v === '-' || t.v === '!' || t.v === '~' || t.v === '+') {
        this.p++
        return { k: 'un', op: t.v, e: this.parseUnary(), line: t.line }
      }
      if (t.v === '++' || t.v === '--') {
        this.p++
        const target = this.parseUnary()
        if (target.k !== 'id' && target.k !== 'idx') throw new CompileError('lvalue required as increment operand', t.line)
        return { k: 'inc', op: t.v, prefix: true, target, line: t.line }
      }
      if (t.v === '(' && this.isCastAhead()) {
        this.p++
        const { type } = this.parseType()
        this.expect(')')
        return { k: 'cast', type, e: this.parseUnary(), line: t.line }
      }
    }
    return this.parsePostfix()
  }

  private isCastAhead(): boolean {
    let k = 1
    let sawType = false
    while (this.peek(k).t === 'id' && (MODIFIERS.has(this.peek(k).v) || TYPE_WORDS[this.peek(k).v] !== undefined)) {
      sawType = true
      k++
    }
    return sawType && this.peek(k).t === 'op' && this.peek(k).v === ')'
  }

  private parsePostfix(): Expr {
    let e = this.parsePrimary()
    for (;;) {
      const t = this.cur
      if (t.t !== 'op') break
      if (t.v === '[') {
        this.p++
        const i = this.parseExpr()
        this.expect(']')
        e = { k: 'idx', arr: e, i, line: t.line }
      } else if (t.v === '++' || t.v === '--') {
        this.p++
        if (e.k !== 'id' && e.k !== 'idx') throw new CompileError('lvalue required as increment operand', t.line)
        e = { k: 'inc', op: t.v, prefix: false, target: e, line: t.line }
      } else if (t.v === '.') {
        this.p++
        const name = this.ident('a member name')
        this.expect('(')
        const args = this.parseArgs()
        e = { k: 'method', obj: e, name, args, line: t.line }
      } else break
    }
    return e
  }

  private parseArgs(): Expr[] {
    const args: Expr[] = []
    if (!this.isOp(')')) {
      do args.push(this.parseAssign())
      while (this.accept(','))
    }
    this.expect(')')
    return args
  }

  private parsePrimary(): Expr {
    const t = this.next()
    switch (t.t) {
      case 'num':
        return { k: 'num', v: t.n, float: t.float, line: t.line }
      case 'chr':
        return { k: 'chr', v: t.n, line: t.line }
      case 'str': {
        // adjacent string literals join, as in C
        let s = t.v
        while (this.cur.t === 'str') s += this.next().v
        return { k: 'str', v: s, line: t.line }
      }
      case 'id': {
        if (this.isOp('(')) {
          // `int(x)` style cast
          if (TYPE_WORDS[t.v] !== undefined && t.v !== 'String') {
            this.p++
            const e = this.parseExpr()
            this.expect(')')
            return { k: 'cast', type: TYPE_WORDS[t.v], e, line: t.line }
          }
          this.p++
          return { k: 'call', name: t.v, args: this.parseArgs(), line: t.line }
        }
        return { k: 'id', name: t.v, line: t.line }
      }
      case 'op':
        if (t.v === '(') {
          const e = this.parseExpr()
          this.expect(')')
          return e
        }
        break
      default:
        break
    }
    throw new CompileError(`expected an expression before ${this.describe(t)}`, t.line)
  }
}

export function parse(source: string): Ast {
  const { tokens, includes } = lex(source)
  return new Parser(tokens).parseProgram(includes)
}
