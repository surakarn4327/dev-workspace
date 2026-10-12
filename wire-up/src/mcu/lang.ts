// The Arduino C++ subset the Uno runs: a lexer with #define / #include, and a recursive-descent parser. No DOM, no imports from
// the rest of the app, so the language can be tested on its own.
//
// Supported: global and local variables and arrays, const / static / unsigned, int types, float, bool, char, String; functions with
// parameters and return values (recursion included); if / else, for, while, do-while, switch, break, continue, return; the C
// operators with C precedence, casts, ++ / --, compound assignment, ?: ; object-like #define; Serial and the Arduino core calls.

export type Type = 'void' | 'bool' | 'char' | 'byte' | 'int' | 'uint' | 'long' | 'ulong' | 'float' | 'String' | `struct:${string}` | `lib:${string}`

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
  const macros = new Map<string, { params: string[] | null; body: Token[] }>()
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
        // `#define NAME(a, b) body` is function-like only when the ( touches the name
        const fn = /^(\w+)\(([^)]*)\)\s*(.*)$/.exec(m[2])
        if (!fn && /^\w+\(/.test(m[2])) throw new CompileError("missing ')' in macro parameter list", at)
        const d = fn ?? /^(\w+)\s*(.*)$/.exec(m[2])
        if (!d) throw new CompileError("macro names must be identifiers: '#define' needs a name", at)
        const params = fn
          ? fn[2]
              .split(',')
              .map((x) => x.trim())
              .filter((x) => x !== '')
          : null
        if (params?.some((x) => !/^[A-Za-z_]\w*$/.test(x))) throw new CompileError(`bad parameter list in the macro '${d[1]}'`, at)
        const body = lex(fn ? fn[3] : d[2]).tokens
        body.pop() // eof
        for (const t of body) t.line = at
        macros.set(d[1], { params, body })
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
  // macro expansion (nested a few levels); a function-like macro takes the arguments in the parentheses after its name
  if (macros.size === 0) return { tokens: raw, includes }
  const expand = (list: Token[], depth: number): Token[] => {
    const out: Token[] = []
    for (let k = 0; k < list.length; k++) {
      const t = list[k]
      const macro = t.t === 'id' && depth < 8 ? macros.get(t.v) : undefined
      if (!macro) {
        out.push(t)
        continue
      }
      if (macro.params === null) {
        out.push(...expand(macro.body.map((b) => ({ ...b, line: t.line })), depth + 1))
        continue
      }
      const open = list[k + 1]
      if (!(open && open.t === 'op' && open.v === '(')) {
        out.push(t) // the bare name of a function-like macro is just a name
        continue
      }
      const args: Token[][] = [[]]
      let nest = 0
      let j = k + 2
      for (; j < list.length; j++) {
        const x = list[j]
        if (x.t === 'eof') break
        if (x.t === 'op' && x.v === '(') nest++
        if (x.t === 'op' && x.v === ')') {
          if (nest === 0) break
          nest--
        }
        if (x.t === 'op' && x.v === ',' && nest === 0) args.push([])
        else args[args.length - 1].push(x)
      }
      if (j >= list.length || list[j].t === 'eof') throw new CompileError(`unterminated argument list invoking macro '${t.v}'`, t.line)
      const none = macro.params.length === 0 && args.length === 1 && args[0].length === 0
      if (!none && args.length !== macro.params.length) {
        throw new CompileError(`macro '${t.v}' requires ${macro.params.length} argument${macro.params.length === 1 ? '' : 's'}, but ${args.length} given`, t.line)
      }
      const filled = args.map((a) => expand(a, depth + 1))
      const body: Token[] = []
      for (const b of macro.body) {
        const at = b.t === 'id' ? macro.params.indexOf(b.v) : -1
        if (at >= 0) body.push(...filled[at].map((x) => ({ ...x, line: t.line })))
        else body.push({ ...b, line: t.line })
      }
      out.push(...expand(body, depth + 1))
      k = j
    }
    return out
  }
  return { tokens: expand(raw, 0), includes }
}

// ---------------------------------------------------------------- syntax tree

export type Expr =
  | { k: 'num'; v: number; float: boolean; line: number }
  | { k: 'str'; v: string; line: number }
  | { k: 'chr'; v: number; line: number }
  | { k: 'id'; name: string; line: number }
  | { k: 'idx'; arr: Expr; i: Expr; line: number }
  | { k: 'member'; obj: Expr; name: string; line: number }
  | { k: 'sizeof'; type: Type | null; e: Expr | null; line: number }
  | { k: 'call'; name: string; args: Expr[]; line: number }
  | { k: 'method'; obj: Expr; name: string; args: Expr[]; line: number }
  | { k: 'un'; op: '-' | '!' | '~' | '+'; e: Expr; line: number }
  | { k: 'bin'; op: string; a: Expr; b: Expr; line: number }
  | { k: 'asg'; op: string; target: Expr; v: Expr; line: number }
  | { k: 'inc'; op: '++' | '--'; prefix: boolean; target: Expr; line: number }
  | { k: 'cond'; c: Expr; a: Expr; b: Expr; line: number }
  | { k: 'cast'; type: Type; e: Expr; line: number }

export type Stmt =
  | {
      k: 'decl'
      type: Type
      name: string
      array: boolean
      /** 1 for a plain array, 2 for `a[rows][cols]` (len is the rows, len2 the columns). */
      rank: 1 | 2
      len: Expr | null
      len2: Expr | null
      /** A value, a `{...}` list, or null. */
      init: Expr | Expr[] | null
      /** The arguments of a library object's constructor: `LiquidCrystal_I2C lcd(0x27, 16, 2);` */
      ctor: Expr[] | null
      /** A `{{...}, {...}}` list of rows (2-D arrays and arrays of structs). */
      rows: Expr[][] | null
      isStatic: boolean
      isConst: boolean
      line: number
    }
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
  rank: 1 | 2
}

export interface StructDef {
  name: string
  fields: { name: string; type: Type }[]
}

export interface FuncDef {
  name: string
  ret: Type
  params: Param[]
  body: Stmt[] | null // null = a prototype
  line: number
}

export interface Ast {
  structs: StructDef[]
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
/** Library classes a sketch can declare objects of. */
export const LIB_TYPES = new Set(['LiquidCrystal_I2C'])

const MODIFIERS = new Set(['const', 'static', 'volatile', 'unsigned', 'signed', 'register', 'inline', 'PROGMEM'])

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
  private structs = new Map<string, StructDef>()
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

  /** The type a word names: a built-in type word or a struct declared earlier. */
  private typeWord(v: string): Type | undefined {
    return TYPE_WORDS[v] ?? (this.structs.has(v) ? (`struct:${v}` as Type) : LIB_TYPES.has(v) ? (`lib:${v}` as Type) : undefined)
  }

  /** Is the next thing the start of a declaration (a type, perhaps with modifiers)? */
  private atType(): boolean {
    let k = 0
    while (this.peek(k).t === 'id' && MODIFIERS.has(this.peek(k).v)) k++
    const t = this.peek(k)
    if (t.t !== 'id') return false
    if (k > 0 && (t.v === 'unsigned' || t.v === 'signed')) return true
    if (t.v === 'struct') return true
    if (this.typeWord(t.v) !== undefined) {
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
      else if (t.v === 'volatile' || t.v === 'signed' || t.v === 'register' || t.v === 'inline' || t.v === 'PROGMEM') {
        // no effect here
      } else if (t.v === 'long') {
        longs++
        base = 'long'
      } else if (t.v === 'struct' && base === null && this.peek().t === 'id' && this.structs.has(this.peek().v)) {
        this.p++ // `struct Point p;` names the type the same way `Point p;` does
        base = `struct:${this.cur.v}` as Type
      } else if (this.typeWord(t.v) !== undefined) {
        if (base !== null && !(base === 'long' && (t.v === 'int'))) break
        base = this.typeWord(t.v)!
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
    const ast: Ast = { structs: [], globals: [], funcs: [], includes }
    while (this.cur.t !== 'eof') {
      if (this.accept(';')) continue
      const line = this.cur.line
      if (this.atStructDef()) {
        ast.structs.push(this.parseStruct())
        continue
      }
      if (!this.atType()) {
        if (this.cur.t === 'id' && this.peek().t === 'id') throw this.unknownType(this.cur)
        throw new CompileError(`expected a declaration before ${this.describe(this.cur)}`, line)
      }
      const { type, isStatic, isConst } = this.parseType()
      const name = this.ident()
      if (this.isOp('(') && !type.startsWith('lib:')) {
        ast.funcs.push(this.parseFunction(type, name, line))
      } else {
        this.parseDeclRest(type, name, isStatic, isConst, line, ast.globals)
        this.expect(';')
      }
    }
    return ast
  }

  /** `struct Name {` or `typedef struct`: a struct definition rather than a variable or function of a struct type. */
  private atStructDef(): boolean {
    const t = this.cur
    if (t.t !== 'id') return false
    if (t.v === 'typedef') return true
    return t.v === 'struct' && ((this.peek().t === 'id' && this.peek(2).t === 'op' && this.peek(2).v === '{') || (this.peek().t === 'op' && this.peek().v === '{'))
  }

  /** `struct Name { int a; byte b, c; };` and `typedef struct [Name] { ... } Name;` */
  private parseStruct(): StructDef {
    const line = this.cur.line
    const typedef = this.cur.v === 'typedef'
    if (typedef) this.p++
    if (!(this.cur.t === 'id' && this.cur.v === 'struct')) throw new CompileError("only 'typedef struct' is supported here", line)
    this.p++
    let name = this.cur.t === 'id' ? this.next().v : ''
    this.expect('{', "'{'")
    const fields: StructDef['fields'] = []
    while (!this.isOp('}')) {
      if (this.peek(0).t === 'eof') throw new CompileError("expected '}' at end of input", this.cur.line)
      const fline = this.cur.line
      if (!this.atType()) throw new CompileError(`expected a member type before ${this.describe(this.cur)}`, fline)
      const { type } = this.parseType()
      if (type === 'void') throw new CompileError('a struct member cannot be void', fline)
      if (type.startsWith('struct:')) throw new CompileError('a struct inside a struct is not supported by this simulator', fline)
      do {
        const fname = this.ident('a member name')
        if (this.isOp('[')) throw new CompileError('array members in a struct are not supported by this simulator', this.cur.line)
        if (fields.some((f) => f.name === fname)) throw new CompileError(`duplicate member '${fname}'`, fline)
        fields.push({ name: fname, type })
      } while (this.accept(','))
      this.expect(';')
    }
    this.p++
    if (typedef) name = this.ident('the type name')
    else if (name === '') throw new CompileError('a struct needs a name', line)
    this.expect(';')
    if (this.structs.has(name)) throw new CompileError(`redefinition of 'struct ${name}'`, line)
    const def: StructDef = { name, fields }
    this.structs.set(name, def)
    return def
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
          let rank: 1 | 2 = 1
          if (this.accept('[')) {
            if (!this.isOp(']')) this.parseExpr() // the size of a parameter array means nothing
            this.expect(']')
            array = true
            if (this.accept('[')) {
              this.parseExpr()
              this.expect(']')
              rank = 2
            }
          }
          params.push({ type, name: pname, array, rank })
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
      let rank: 1 | 2 = 1
      let len: Expr | null = null
      let len2: Expr | null = null
      if (this.accept('[')) {
        array = true
        if (!this.isOp(']')) len = this.parseExpr()
        this.expect(']')
        if (this.accept('[')) {
          rank = 2
          if (this.isOp(']')) throw new CompileError(`the second size of array '${name}' must be given`, this.cur.line)
          len2 = this.parseExpr()
          this.expect(']')
          if (this.isOp('[')) throw new CompileError('arrays with more than two dimensions are not supported', this.cur.line)
        }
      }
      if (this.cur.t === 'id' && this.cur.v === 'PROGMEM') this.p++
      let ctor: Expr[] | null = null
      if (type.startsWith('lib:') && !array) {
        // `LiquidCrystal_I2C lcd(0x27, 16, 2);` or just `LiquidCrystal_I2C lcd;`
        if (this.accept('(')) ctor = this.parseArgs()
        else ctor = []
      }
      let init: Expr | Expr[] | null = null
      let rows: Expr[][] | null = null
      if (this.accept('=')) {
        if (this.isOp('{') && (array || type.startsWith('struct:'))) {
          this.p++
          const items: Expr[] = []
          if (!this.isOp('}')) {
            do {
              if (this.isOp('}')) break
              if (this.isOp('{')) {
                // a row of a 2-D array or one struct of an array of structs
                this.p++
                const row: Expr[] = []
                if (!this.isOp('}')) {
                  do {
                    if (this.isOp('}')) break
                    row.push(this.parseAssign())
                  } while (this.accept(','))
                }
                this.expect('}')
                ;(rows ??= []).push(row)
              } else if (array && rank === 2 && this.cur.t === 'str') {
                const st = this.next()
                const chars = [...st.v].map((ch) => ({ k: 'chr', v: ch.charCodeAt(0), line: st.line }) as Expr)
                chars.push({ k: 'chr', v: 0, line: st.line })
                ;(rows ??= []).push(chars)
              } else items.push(this.parseAssign())
            } while (this.accept(','))
          }
          this.expect('}')
          if (rows !== null && items.length > 0) throw new CompileError(`mixed braces in the initialiser of '${name}'`, this.cur.line)
          init = rows !== null ? null : items
        } else if (array && this.cur.t === 'str') {
          const st = this.next()
          init = [...st.v].map((ch) => ({ k: 'chr', v: ch.charCodeAt(0), line: st.line }) as Expr)
          init.push({ k: 'chr', v: 0, line: st.line })
        } else init = this.parseAssign()
      }
      out.push({ k: 'decl', type, name, array, rank, len, len2, init, ctor, rows, isStatic, isConst, line })
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
    return new CompileError(`'${t.v}' does not name a type here (this simulator has Wire, EEPROM and LiquidCrystal_I2C; other libraries such as Servo are not available yet)`, t.line)
  }

  private parseStmt(): Stmt {
    const t = this.cur
    const line = t.line
    if (t.t === 'id' && this.peek().t === 'id' && !MODIFIERS.has(t.v) && this.typeWord(t.v) === undefined && t.v !== 'struct' && !['else', 'case', 'default', 'return', 'do'].includes(t.v)) throw this.unknownType(t)
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
      if (left.k !== 'id' && left.k !== 'idx' && left.k !== 'member') throw new CompileError(`lvalue required as left operand of assignment`, op.line)
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
      if (t.v === '&') {
        // there are no pointers: `&x` is the value itself, which is all `pgm_read_byte(&table[i])` needs
        this.p++
        return this.parseUnary()
      }
      if (t.v === '++' || t.v === '--') {
        this.p++
        const target = this.parseUnary()
        if (target.k !== 'id' && target.k !== 'idx' && target.k !== 'member') throw new CompileError('lvalue required as increment operand', t.line)
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
    while (this.peek(k).t === 'id' && (MODIFIERS.has(this.peek(k).v) || this.typeWord(this.peek(k).v) !== undefined)) {
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
        if (e.k !== 'id' && e.k !== 'idx' && e.k !== 'member') throw new CompileError('lvalue required as increment operand', t.line)
        e = { k: 'inc', op: t.v, prefix: false, target: e, line: t.line }
      } else if (t.v === '.') {
        this.p++
        const name = this.ident('a member name')
        if (this.isOp('(')) {
          this.p++
          e = { k: 'method', obj: e, name, args: this.parseArgs(), line: t.line }
        } else e = { k: 'member', obj: e, name, line: t.line }
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
        if (t.v === 'sizeof') {
          if (this.accept('(')) {
            if (this.atType()) {
              const { type } = this.parseType()
              this.expect(')')
              return { k: 'sizeof', type, e: null, line: t.line }
            }
            const e = this.parseExpr()
            this.expect(')')
            return { k: 'sizeof', type: null, e, line: t.line }
          }
          return { k: 'sizeof', type: null, e: this.parseUnary(), line: t.line }
        }
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
