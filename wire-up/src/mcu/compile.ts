// Compiler: the syntax tree of an Arduino sketch to a small stack-machine program. Types are worked out here (C's integer widths
// of the 16-bit AVR, integer division, String concatenation) so the machine only has to wrap and do the arithmetic. No DOM.

import { CompileError, parse } from './lang.ts'
import type { Ast, Expr, FuncDef, Stmt, StructDef, Type } from './lang.ts'

export { CompileError } from './lang.ts'
export type { Type } from './lang.ts'

// op codes (no enum: the project builds with erasableSyntaxOnly)
export const OP = {
  PUSH: 0,
  LGET: 1,
  LSET: 2,
  GGET: 3,
  GSET: 4,
  AGET: 5,
  ASET: 6,
  POP: 7,
  ARITH: 8,
  CMP: 9,
  NEG: 10,
  NOT: 11,
  BNOT: 12,
  CAST: 13,
  JMP: 14,
  JZ: 15,
  JNZ: 16,
  JZK: 17,
  JNZK: 18,
  CALL: 19,
  RET: 20,
  CALLB: 21,
  NEWARR: 22,
  DUP: 23,
  BOOL: 24,
  CONCAT: 25,
  CALLM: 26,
  COPY: 27,
}

export interface Op {
  o: number
  a?: number | string
  b?: number | string
  /** Keep the value on the stack after a store. */
  k?: boolean
  /** Static types of call arguments, for the lettering of Serial.print and String(). */
  ts?: string[]
  /** A third operand: the columns of a 2-D array or the members of an array of structs (NEWARR). */
  c?: number
  l: number
}

export interface FnInfo {
  name: string
  ret: Type
  nParams: number
  nLocals: number
  code: Op[]
}

export interface Program {
  fns: FnInfo[]
  init: number
  setup: number
  loop: number
  nGlobals: number
  includes: string[]
}

interface VarInfo {
  slot: number
  type: Type
  array: boolean
  global: boolean
  /** 1 for a plain array, 2 for a 2-D one (only meaningful when `array`). */
  rank: 1 | 2
  /** A global `const` integer with a value known at compile time (usable as an array size or a case label). */
  constVal?: number
}

interface Ty {
  t: Type
  arr: boolean
  /** For arrays: 1 (default) or 2. */
  rank?: 1 | 2
}

function isStruct(t: Type): boolean {
  return t.startsWith('struct:')
}

const BOOL: Ty = { t: 'bool', arr: false }
const STR: Ty = { t: 'String', arr: false }

const CONSTANTS: Record<string, [number, Type]> = {
  HIGH: [1, 'int'],
  LOW: [0, 'int'],
  INPUT: [0, 'int'],
  OUTPUT: [1, 'int'],
  INPUT_PULLUP: [2, 'int'],
  LED_BUILTIN: [13, 'int'],
  A0: [14, 'int'],
  A1: [15, 'int'],
  A2: [16, 'int'],
  A3: [17, 'int'],
  A4: [18, 'int'],
  A5: [19, 'int'],
  true: [1, 'bool'],
  false: [0, 'bool'],
  PI: [Math.PI, 'float'],
  HALF_PI: [Math.PI / 2, 'float'],
  TWO_PI: [Math.PI * 2, 'float'],
  DEC: [10, 'int'],
  HEX: [16, 'int'],
  OCT: [8, 'int'],
  BIN: [2, 'int'],
  LSBFIRST: [0, 'int'],
  MSBFIRST: [1, 'int'],
}

type RetRule = Type | 'same0' | 'promote'
const BUILTINS: Record<string, { ret: RetRule; min: number; max: number }> = {
  pinMode: { ret: 'void', min: 2, max: 2 },
  digitalWrite: { ret: 'void', min: 2, max: 2 },
  digitalRead: { ret: 'int', min: 1, max: 1 },
  analogRead: { ret: 'int', min: 1, max: 1 },
  analogWrite: { ret: 'void', min: 2, max: 2 },
  analogReference: { ret: 'void', min: 1, max: 1 },
  delay: { ret: 'void', min: 1, max: 1 },
  delayMicroseconds: { ret: 'void', min: 1, max: 1 },
  millis: { ret: 'ulong', min: 0, max: 0 },
  micros: { ret: 'ulong', min: 0, max: 0 },
  random: { ret: 'long', min: 1, max: 2 },
  randomSeed: { ret: 'void', min: 1, max: 1 },
  map: { ret: 'long', min: 5, max: 5 },
  constrain: { ret: 'promote', min: 3, max: 3 },
  min: { ret: 'promote', min: 2, max: 2 },
  max: { ret: 'promote', min: 2, max: 2 },
  abs: { ret: 'same0', min: 1, max: 1 },
  sq: { ret: 'same0', min: 1, max: 1 },
  sqrt: { ret: 'float', min: 1, max: 1 },
  pow: { ret: 'float', min: 2, max: 2 },
  sin: { ret: 'float', min: 1, max: 1 },
  cos: { ret: 'float', min: 1, max: 1 },
  tan: { ret: 'float', min: 1, max: 1 },
  exp: { ret: 'float', min: 1, max: 1 },
  log: { ret: 'float', min: 1, max: 1 },
  floor: { ret: 'float', min: 1, max: 1 },
  ceil: { ret: 'float', min: 1, max: 1 },
  round: { ret: 'long', min: 1, max: 1 },
  bitRead: { ret: 'int', min: 2, max: 2 },
  bit: { ret: 'ulong', min: 1, max: 1 },
  pgm_read_byte: { ret: 'byte', min: 1, max: 1 },
  pgm_read_word: { ret: 'uint', min: 1, max: 1 },
  pgm_read_dword: { ret: 'ulong', min: 1, max: 1 },
  pgm_read_float: { ret: 'float', min: 1, max: 1 },
  tone: { ret: 'void', min: 2, max: 3 },
  noTone: { ret: 'void', min: 1, max: 1 },
  pulseIn: { ret: 'ulong', min: 2, max: 3 },
  pulseInLong: { ret: 'ulong', min: 2, max: 3 },
  shiftOut: { ret: 'void', min: 4, max: 4 },
  shiftIn: { ret: 'byte', min: 3, max: 3 },
  lowByte: { ret: 'byte', min: 1, max: 1 },
  highByte: { ret: 'byte', min: 1, max: 1 },
  String: { ret: 'String', min: 1, max: 2 },
  F: { ret: 'String', min: 1, max: 1 },
  radians: { ret: 'float', min: 1, max: 1 },
  degrees: { ret: 'float', min: 1, max: 1 },
}

const UNSUPPORTED = new Set(['attachInterrupt', 'detachInterrupt', 'interrupts', 'noInterrupts'])

const SERIAL: Record<string, { ret: Type; min: number; max: number }> = {
  begin: { ret: 'void', min: 1, max: 2 },
  end: { ret: 'void', min: 0, max: 0 },
  print: { ret: 'void', min: 1, max: 2 },
  println: { ret: 'void', min: 0, max: 2 },
  write: { ret: 'void', min: 1, max: 2 },
  available: { ret: 'int', min: 0, max: 0 },
  availableForWrite: { ret: 'int', min: 0, max: 0 },
  readString: { ret: 'String', min: 0, max: 0 },
  readStringUntil: { ret: 'String', min: 1, max: 1 },
  read: { ret: 'int', min: 0, max: 0 },
  peek: { ret: 'int', min: 0, max: 0 },
  parseInt: { ret: 'long', min: 0, max: 0 },
  parseFloat: { ret: 'float', min: 0, max: 0 },
  flush: { ret: 'void', min: 0, max: 0 },
  setTimeout: { ret: 'void', min: 1, max: 1 },
}

const EEPROM_METHODS: Record<string, { ret: Type; min: number; max: number }> = {
  read: { ret: 'byte', min: 1, max: 1 },
  write: { ret: 'void', min: 2, max: 2 },
  update: { ret: 'void', min: 2, max: 2 },
  length: { ret: 'int', min: 0, max: 0 },
  put: { ret: 'void', min: 2, max: 2 },
  get: { ret: 'void', min: 2, max: 2 },
}

const STRING_METHODS: Record<string, { ret: Type; min: number; max: number }> = {
  length: { ret: 'int', min: 0, max: 0 },
  charAt: { ret: 'char', min: 1, max: 1 },
  toInt: { ret: 'long', min: 0, max: 0 },
  toFloat: { ret: 'float', min: 0, max: 0 },
  indexOf: { ret: 'int', min: 1, max: 1 },
  substring: { ret: 'String', min: 1, max: 2 },
  toUpperCase: { ret: 'String', min: 0, max: 0 },
  toLowerCase: { ret: 'String', min: 0, max: 0 },
  equals: { ret: 'bool', min: 1, max: 1 },
}

function isInt(t: Type): boolean {
  return t === 'bool' || t === 'char' || t === 'byte' || t === 'int' || t === 'uint' || t === 'long' || t === 'ulong'
}

/** The type of an arithmetic result: C's usual promotions with 16-bit int. */
function promote(a: Type, b: Type): Type {
  if (a === 'String' || b === 'String') return 'String'
  if (a === 'float' || b === 'float') return 'float'
  const rank = (t: Type): number => (t === 'ulong' ? 4 : t === 'long' ? 3 : t === 'uint' ? 2 : 1)
  const r = Math.max(rank(a), rank(b))
  return r === 4 ? 'ulong' : r === 3 ? 'long' : r === 2 ? 'uint' : 'int'
}

class FnCompiler {
  code: Op[] = []
  private scopes: Map<string, VarInfo>[] = [new Map()]
  private nextSlot = 0
  maxSlot = 0
  private loops: { breaks: number[]; conts: number[]; isSwitch: boolean }[] = []

  private unit: Unit
  private fn: FuncDef | null
  private fnName: string

  constructor(unit: Unit, fn: FuncDef | null, fnName: string) {
    this.unit = unit
    this.fn = fn
    this.fnName = fnName
  }

  // ---- emit helpers
  emit(o: number, line: number, a?: number | string, b?: number | string): number {
    this.code.push({ o, a, b, l: line })
    return this.code.length - 1
  }
  private here(): number {
    return this.code.length
  }
  private patch(at: number, to = this.here()): void {
    this.code[at].a = to
  }

  // ---- variables
  private slotFor(): number {
    const s = this.nextSlot++
    if (this.nextSlot > this.maxSlot) this.maxSlot = this.nextSlot
    return s
  }
  declareLocal(name: string, type: Type, array: boolean, line: number, rank: 1 | 2 = 1): VarInfo {
    const scope = this.scopes[this.scopes.length - 1]
    if (scope.has(name)) throw new CompileError(`redeclaration of '${name}'`, line)
    const v: VarInfo = { slot: this.slotFor(), type, array, global: false, rank }
    scope.set(name, v)
    return v
  }
  private alias(name: string, v: VarInfo): void {
    this.scopes[this.scopes.length - 1].set(name, v)
  }
  private lookup(name: string): VarInfo | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const v = this.scopes[i].get(name)
      if (v) return v
    }
    return this.unit.globals.get(name)
  }
  private temp(): number {
    return this.slotFor()
  }
  private push(): void {
    this.scopes.push(new Map())
  }
  private pop(): void {
    this.scopes.pop()
  }

  // ---- function body
  compileBody(): void {
    const fn = this.fn
    if (fn) {
      for (const p of fn.params) this.declareLocal(p.name || `_${this.nextSlot}`, p.type, p.array, fn.line, p.rank)
      this.push()
      for (const s of fn.body ?? []) this.stmt(s)
      this.pop()
      const endLine = fn.body && fn.body.length > 0 ? fn.body[fn.body.length - 1].line : fn.line
      this.emit(OP.PUSH, endLine, 0)
      this.emit(OP.RET, endLine, fn.ret)
    }
  }

  // ---- statements
  stmt(s: Stmt): void {
    switch (s.k) {
      case 'empty':
        return
      case 'block':
        this.push()
        for (const x of s.body) this.stmt(x)
        this.pop()
        return
      case 'decl':
        this.decl(s)
        return
      case 'expr':
        this.expr(s.e, false)
        return
      case 'if': {
        this.condition(s.c)
        const jElse = this.emit(OP.JZ, s.line, 0)
        this.stmt(s.t)
        if (s.f) {
          const jEnd = this.emit(OP.JMP, s.line, 0)
          this.patch(jElse)
          this.stmt(s.f)
          this.patch(jEnd)
        } else this.patch(jElse)
        return
      }
      case 'while': {
        const top = this.here()
        this.condition(s.c)
        const jOut = this.emit(OP.JZ, s.line, 0)
        this.loops.push({ breaks: [], conts: [], isSwitch: false })
        this.stmt(s.body)
        const lp = this.loops.pop()!
        for (const c of lp.conts) this.patch(c, top)
        this.emit(OP.JMP, s.line, top)
        this.patch(jOut)
        for (const b of lp.breaks) this.patch(b)
        return
      }
      case 'do': {
        const top = this.here()
        this.loops.push({ breaks: [], conts: [], isSwitch: false })
        this.stmt(s.body)
        const lp = this.loops.pop()!
        const test = this.here()
        for (const c of lp.conts) this.patch(c, test)
        this.condition(s.c)
        this.emit(OP.JNZ, s.line, top)
        for (const b of lp.breaks) this.patch(b)
        return
      }
      case 'for': {
        this.push()
        if (s.init) this.stmt(s.init)
        const top = this.here()
        let jOut = -1
        if (s.c) {
          this.condition(s.c)
          jOut = this.emit(OP.JZ, s.line, 0)
        }
        this.loops.push({ breaks: [], conts: [], isSwitch: false })
        this.stmt(s.body)
        const lp = this.loops.pop()!
        const stepAt = this.here()
        for (const c of lp.conts) this.patch(c, stepAt)
        if (s.step) this.expr(s.step, false)
        this.emit(OP.JMP, s.line, top)
        if (jOut >= 0) this.patch(jOut)
        for (const b of lp.breaks) this.patch(b)
        this.pop()
        return
      }
      case 'switch': {
        const t = this.expr(s.e, true)
        if (!isInt(t.t) || t.arr) throw new CompileError('switch quantity not an integer', s.line)
        const tmp = this.temp()
        this.emit(OP.LSET, s.line, tmp, 'int')
        this.push()
        this.loops.push({ breaks: [], conts: [], isSwitch: true })
        const caseJumps: number[] = []
        let defaultIdx = -1
        s.cases.forEach((c, i) => {
          if (c.v === null) {
            defaultIdx = i
            caseJumps.push(-1)
            return
          }
          this.emit(OP.LGET, s.line, tmp)
          this.expr(c.v, true)
          this.emit(OP.CMP, s.line, '==')
          caseJumps.push(this.emit(OP.JNZ, s.line, 0))
        })
        const jNone = this.emit(OP.JMP, s.line, 0)
        const starts: number[] = []
        s.cases.forEach((c) => {
          starts.push(this.here())
          for (const x of c.body) this.stmt(x)
        })
        const end = this.here()
        caseJumps.forEach((j, i) => {
          if (j >= 0) this.patch(j, starts[i])
        })
        this.patch(jNone, defaultIdx >= 0 ? starts[defaultIdx] : end)
        const lp = this.loops.pop()!
        for (const b of lp.breaks) this.patch(b, end)
        this.pop()
        return
      }
      case 'break': {
        if (this.loops.length === 0) throw new CompileError('break statement not within loop or switch', s.line)
        this.loops[this.loops.length - 1].breaks.push(this.emit(OP.JMP, s.line, 0))
        return
      }
      case 'continue': {
        for (let i = this.loops.length - 1; i >= 0; i--) {
          if (!this.loops[i].isSwitch) {
            this.loops[i].conts.push(this.emit(OP.JMP, s.line, 0))
            return
          }
        }
        throw new CompileError('continue statement not within a loop', s.line)
      }
      case 'return': {
        const ret = this.fn?.ret ?? 'void'
        if (s.e) {
          if (ret === 'void') throw new CompileError("return-statement with a value, in function returning 'void'", s.line)
          const t = this.expr(s.e, true)
          this.convert(t, { t: ret, arr: false }, s.line)
        } else {
          if (ret !== 'void') throw new CompileError("return-statement with no value, in function returning a value", s.line)
          this.emit(OP.PUSH, s.line, 0)
        }
        this.emit(OP.RET, s.line, ret)
        return
      }
    }
  }

  private condition(e: Expr): void {
    const t = this.expr(e, true)
    if (t.arr) throw new CompileError('an array cannot be used as a condition', e.line)
    if (isStruct(t.t)) throw new CompileError('a struct cannot be used as a condition', e.line)
  }

  private decl(s: Extract<Stmt, { k: 'decl' }>): void {
    if (s.type === 'void') throw new CompileError(`variable or field '${s.name}' declared void`, s.line)
    if (s.isStatic) {
      // a static local keeps its value between calls: a global with a private name
      const gname = `${this.fnName}.${s.name}`
      const v = this.unit.addGlobal(gname, s.type, s.array, s.line, s.rank)
      this.unit.initDecl(v, s, this.fnName)
      this.alias(s.name, v)
      return
    }
    const v = this.declareLocal(s.name, s.type, s.array, s.line, s.rank)
    this.initVar(v, s)
  }

  initVar(v: VarInfo, s: Extract<Stmt, { k: 'decl' }>): void {
    const set = (): void => {
      // an array or struct reference is stored as it is (no integer wrap)
      this.emit(v.global ? OP.GSET : OP.LSET, s.line, v.slot, s.array || isStruct(v.type) ? 'float' : v.type)
    }
    const load = (): void => {
      this.emit(v.global ? OP.GGET : OP.LGET, s.line, v.slot)
    }
    const fields = isStruct(v.type) ? this.unit.structOf(v.type, s.line).fields : null
    if (s.array) {
      const rows = s.rows
      const items = Array.isArray(s.init) ? s.init : null
      let len = -1
      if (s.len) len = this.unit.constEval(s.len, this)
      else if (rows) len = rows.length
      else if (items && v.rank === 1) len = items.length
      if (len < 0) throw new CompileError(`array size missing in '${s.name}'`, s.line)
      if (len <= 0) throw new CompileError(`size of array '${s.name}' is not positive`, s.line)
      const cols = v.rank === 2 ? this.unit.constEval(s.len2!, this) : fields ? fields.length : 0
      if (v.rank === 2 && cols <= 0) throw new CompileError(`size of array '${s.name}' is not positive`, s.line)
      if (len * Math.max(cols, 1) > 2048) throw new CompileError(`array '${s.name}' is too big for the Uno's 2 kB of memory`, s.line)
      if (fields && fields.some((f) => f.type === 'String')) throw new CompileError('arrays of structs with String members are not supported by this simulator', s.line)
      if (v.rank === 2 && items && items.length > 0) throw new CompileError(`'${s.name}' is a 2-D array: write the initialiser as {{...}, {...}}`, s.line)
      const op = this.emit(OP.NEWARR, s.line, len, v.type)
      if (cols > 0) this.code[op].c = cols
      set()
      if (rows) {
        if (!fields && v.rank !== 2) throw new CompileError(`'${s.name}' is a 1-D array: write the initialiser as {...}`, s.line)
        if (rows.length > len) throw new CompileError(`too many initializers for '${s.name}'`, s.line)
        rows.forEach((row, i) => {
          if (row.length > cols) throw new CompileError(`too many initializers for a row of '${s.name}'`, s.line)
          row.forEach((it, j) => {
            const type = fields ? fields[j].type : v.type
            load()
            this.emit(OP.PUSH, s.line, i)
            this.emit(OP.AGET, s.line)
            this.emit(OP.PUSH, s.line, j)
            const t = this.expr(it, true)
            this.convert(t, { t: type, arr: false }, s.line)
            this.emit(OP.ASET, s.line, type)
          })
        })
      } else if (items) {
        if (fields) throw new CompileError(`'${s.name}' is an array of structs: write the initialiser as {{...}, {...}}`, s.line)
        if (items.length > len) throw new CompileError(`too many initializers for '${s.name}'`, s.line)
        items.forEach((it, i) => {
          load()
          this.emit(OP.PUSH, s.line, i)
          const t = this.expr(it, true)
          this.convert(t, { t: v.type, arr: false }, s.line)
          this.emit(OP.ASET, s.line, v.type)
        })
      }
      return
    }
    if (fields) {
      if (s.init !== null && !Array.isArray(s.init)) {
        // Point b = a; makes a copy
        const t = this.expr(s.init, true)
        this.convert(t, { t: v.type, arr: false }, s.line)
        set()
        return
      }
      this.emit(OP.NEWARR, s.line, fields.length, 'int')
      set()
      fields.forEach((f, j) => {
        if (f.type !== 'String') return
        load()
        this.emit(OP.PUSH, s.line, j)
        this.emit(OP.PUSH, s.line, '')
        this.emit(OP.ASET, s.line, 'String')
      })
      const items = Array.isArray(s.init) ? s.init : []
      if (items.length > fields.length) throw new CompileError(`too many initializers for '${s.name}'`, s.line)
      items.forEach((it, j) => {
        load()
        this.emit(OP.PUSH, s.line, j)
        const t = this.expr(it, true)
        this.convert(t, { t: fields[j].type, arr: false }, s.line)
        this.emit(OP.ASET, s.line, fields[j].type)
      })
      return
    }
    if (s.init !== null && !Array.isArray(s.init)) {
      const t = this.expr(s.init, true)
      if (t.arr) throw new CompileError(`invalid conversion from an array to '${v.type}'`, s.line)
      this.convert(t, { t: v.type, arr: false }, s.line)
    } else {
      this.emit(OP.PUSH, s.line, v.type === 'String' ? '' : 0)
    }
    set()
  }

  /** Convert the value on top of the stack from type `from` to type `to`. */
  private convert(from: Ty, to: Ty, line: number): void {
    if (from.arr !== to.arr) throw new CompileError('invalid conversion between an array and a value', line)
    if (isStruct(from.t) || isStruct(to.t)) {
      if (from.t !== to.t) throw new CompileError(`cannot convert '${from.t.replace('struct:', '')}' to '${to.t.replace('struct:', '')}'`, line)
      if (!to.arr) this.emit(OP.COPY, line) // a struct is passed and assigned by value
      return
    }
    if (from.t === 'String' && to.t !== 'String') throw new CompileError(`cannot convert 'String' to '${to.t}'`, line)
    if (to.t === 'String' && from.t !== 'String') {
      // String s = 5; makes the number's text
      this.emit(OP.CALLB, line, 'String', 1)
      this.code[this.code.length - 1].ts = [from.t]
      return
    }
    if (from.t !== to.t && to.t !== 'void') this.emit(OP.CAST, line, to.t)
  }

  // ---- expressions: returns the static type; pushes one value (or nothing when `need` is false)
  expr(e: Expr, need: boolean): Ty {
    switch (e.k) {
      case 'num': {
        const t: Type = e.float ? 'float' : e.v > 2147483647 ? 'ulong' : e.v > 32767 ? 'long' : 'int'
        if (need) this.emit(OP.PUSH, e.line, e.v)
        return { t, arr: false }
      }
      case 'chr':
        if (need) this.emit(OP.PUSH, e.line, e.v)
        return { t: 'char', arr: false }
      case 'str':
        if (need) this.emit(OP.PUSH, e.line, e.v)
        return STR
      case 'id': {
        const v = this.lookup(e.name)
        if (v) {
          if (need) this.emit(v.global ? OP.GGET : OP.LGET, e.line, v.slot)
          return { t: v.type, arr: v.array, rank: v.rank }
        }
        const c = CONSTANTS[e.name]
        if (c) {
          if (need) this.emit(OP.PUSH, e.line, c[0])
          return { t: c[1], arr: false }
        }
        if (e.name === 'Serial') throw new CompileError("'Serial' needs a call such as Serial.begin(9600)", e.line)
        throw new CompileError(`'${e.name}' was not declared in this scope`, e.line)
      }
      case 'idx': {
        const a = this.expr(e.arr, true)
        if (!a.arr) {
          if (a.t === 'String') throw new CompileError("use s.charAt(i) to read a character of a String", e.line)
          throw new CompileError("invalid types for array subscript", e.line)
        }
        const i = this.expr(e.i, true)
        if (!isInt(i.t) || i.arr) throw new CompileError('array subscript is not an integer', e.line)
        this.emit(OP.AGET, e.line)
        if (!need) this.emit(OP.POP, e.line)
        // the first index of a 2-D array gives a row, which is an array again
        if (a.rank === 2) return { t: a.t, arr: true, rank: 1 }
        return { t: a.t, arr: false }
      }
      case 'sizeof': {
        // bytes as the AVR counts them; an array is its length times the size of an element
        let type: Type
        let arr = false
        let rank: 1 | 2 = 1
        if (e.type) type = e.type
        else {
          const t = this.typeOf(e.e!)
          type = t.t
          arr = t.arr
          rank = t.rank ?? 1
        }
        const size = this.unit.sizeOf(type, e.line)
        if (arr) {
          this.expr(e.e!, true)
          this.emit(OP.PUSH, e.line, size)
          this.emit(OP.PUSH, e.line, rank)
          this.emit(OP.CALLB, e.line, '__sizeof', 3)
        } else this.emit(OP.PUSH, e.line, size)
        if (!need) this.emit(OP.POP, e.line)
        return { t: 'uint', arr: false }
      }
      case 'member': {
        const f = this.fieldOf(e)
        this.expr(e.obj, true)
        this.emit(OP.PUSH, e.line, f.index)
        this.emit(OP.AGET, e.line)
        if (!need) this.emit(OP.POP, e.line)
        return { t: f.type, arr: false }
      }
      case 'un': {
        const t = this.expr(e.e, true)
        if (t.arr || isStruct(t.t)) throw new CompileError('invalid operand to unary operator', e.line)
        let r: Ty
        if (e.op === '-') {
          if (t.t === 'String') throw new CompileError("invalid operand 'String' to unary minus", e.line)
          r = { t: t.t === 'float' ? 'float' : promote(t.t, 'int'), arr: false }
          this.emit(OP.NEG, e.line, r.t)
        } else if (e.op === '+') r = { t: t.t === 'float' ? 'float' : promote(t.t, 'int'), arr: false }
        else if (e.op === '!') {
          this.emit(OP.NOT, e.line)
          r = BOOL
        } else {
          if (t.t === 'float' || t.t === 'String') throw new CompileError("invalid operand to '~'", e.line)
          r = { t: promote(t.t, 'int'), arr: false }
          this.emit(OP.BNOT, e.line, r.t)
        }
        if (!need) this.emit(OP.POP, e.line)
        return r
      }
      case 'bin':
        return this.binary(e, need)
      case 'cond': {
        this.condition(e.c)
        const jElse = this.emit(OP.JZ, e.line, 0)
        const a = this.expr(e.a, true)
        const jEnd = this.emit(OP.JMP, e.line, 0)
        this.patch(jElse)
        const b = this.expr(e.b, true)
        this.patch(jEnd)
        const t: Type = a.t === b.t ? a.t : promote(a.t, b.t)
        if (!need) this.emit(OP.POP, e.line)
        return { t, arr: false }
      }
      case 'cast': {
        const t = this.expr(e.e, true)
        if (t.arr || isStruct(t.t)) throw new CompileError('invalid cast of an array or struct', e.line)
        if (t.t === 'String') throw new CompileError("invalid cast from type 'String'", e.line)
        if (e.type === 'String') throw new CompileError("use String(x) to make text of a number", e.line)
        this.emit(OP.CAST, e.line, e.type)
        if (!need) this.emit(OP.POP, e.line)
        return { t: e.type, arr: false }
      }
      case 'asg':
        return this.assign(e, need)
      case 'inc':
        return this.increment(e, need)
      case 'call':
        return this.call(e, need)
      case 'method':
        return this.method(e, need)
    }
  }

  private binary(e: Extract<Expr, { k: 'bin' }>, need: boolean): Ty {
    const op = e.op
    if (op === ',') {
      this.expr(e.a, false)
      return this.expr(e.b, need)
    }
    if (op === '&&' || op === '||') {
      this.condition(e.a)
      const j = this.emit(op === '&&' ? OP.JZK : OP.JNZK, e.line, 0)
      this.condition(e.b)
      this.patch(j)
      this.emit(OP.BOOL, e.line)
      if (!need) this.emit(OP.POP, e.line)
      return BOOL
    }
    const a = this.expr(e.a, true)
    const b = this.expr(e.b, true)
    if (a.arr || b.arr) throw new CompileError(`invalid operands to binary ${op}: arrays cannot be used here`, e.line)
    if (isStruct(a.t) || isStruct(b.t)) throw new CompileError(`invalid operands to binary ${op}: a struct cannot be used here (use its members)`, e.line)
    let r: Ty
    if (op === '==' || op === '!=' || op === '<' || op === '<=' || op === '>' || op === '>=') {
      if ((a.t === 'String') !== (b.t === 'String')) throw new CompileError(`invalid operands of types '${a.t}' and '${b.t}' to binary '${op}'`, e.line)
      this.emit(OP.CMP, e.line, op)
      r = BOOL
    } else if (a.t === 'String' || b.t === 'String') {
      if (op !== '+') throw new CompileError(`invalid operands of type 'String' to binary '${op}'`, e.line)
      this.emit(OP.CONCAT, e.line, a.t, b.t)
      r = STR
    } else {
      const rt = op === '<<' || op === '>>' ? promote(a.t, 'int') : promote(a.t, b.t)
      if (rt === 'float' && (op === '%' || op === '&' || op === '|' || op === '^' || op === '<<' || op === '>>')) {
        throw new CompileError(`invalid operands of types '${a.t}' and '${b.t}' to binary '${op}'`, e.line)
      }
      this.emit(OP.ARITH, e.line, op, rt)
      r = { t: rt, arr: false }
    }
    if (!need) this.emit(OP.POP, e.line)
    return r
  }

  /** The static type of an expression, found without keeping the code that was made for it. */
  private typeOf(e: Expr): Ty {
    const mark = this.code.length
    const t = this.expr(e, true)
    this.code.length = mark
    return t
  }

  /** Which slot of its struct a `.name` reaches, and the type of that member. */
  private fieldOf(e: Extract<Expr, { k: 'member' }>): { index: number; type: Type } {
    const o = this.typeOf(e.obj)
    if (o.arr || !isStruct(o.t)) throw new CompileError(`request for member '${e.name}' in something that is not a struct`, e.line)
    const def = this.unit.structOf(o.t, e.line)
    const index = def.fields.findIndex((f) => f.name === e.name)
    if (index < 0) throw new CompileError(`'${def.name}' has no member named '${e.name}'`, e.line)
    return { index, type: def.fields[index].type }
  }

  /** Load the current value of an lvalue; for array elements the array and index are first saved in temps. */
  private lvalue(target: Expr): { type: Type; load: () => void; store: (keep: boolean, line: number) => void; prepare: () => void } {
    if (target.k === 'id') {
      const v = this.lookup(target.name)
      if (!v) throw new CompileError(`'${target.name}' was not declared in this scope`, target.line)
      if (v.array) throw new CompileError(`invalid use of array '${target.name}'`, target.line)
      if (v.constVal !== undefined) throw new CompileError(`assignment of read-only variable '${target.name}'`, target.line)
      return {
        type: v.type,
        prepare: () => {},
        load: () => {
          this.emit(v.global ? OP.GGET : OP.LGET, target.line, v.slot)
        },
        store: (keep, line) => {
          const at = this.emit(v.global ? OP.GSET : OP.LSET, line, v.slot, v.type)
          this.code[at].k = keep
        },
      }
    }
    if (target.k === 'member') {
      const f = this.fieldOf(target)
      const objTemp = this.temp()
      return {
        type: f.type,
        prepare: () => {
          this.expr(target.obj, true)
          this.emit(OP.LSET, target.line, objTemp, 'float') // the struct reference: no integer wrap
        },
        load: () => {
          this.emit(OP.LGET, target.line, objTemp)
          this.emit(OP.PUSH, target.line, f.index)
          this.emit(OP.AGET, target.line)
        },
        store: (keep, line) => {
          const val = this.temp()
          this.emit(OP.LSET, line, val, 'float')
          this.emit(OP.LGET, line, objTemp)
          this.emit(OP.PUSH, line, f.index)
          this.emit(OP.LGET, line, val)
          const at = this.emit(OP.ASET, line, f.type)
          this.code[at].k = keep
        },
      }
    }
    if (target.k === 'idx') {
      const arrTemp = this.temp()
      const idxTemp = this.temp()
      let elem: Type = 'int'
      return {
        get type() {
          return elem
        },
        prepare: () => {
          const a = this.expr(target.arr, true)
          if (!a.arr) throw new CompileError('invalid types for array subscript', target.line)
          if (a.rank === 2) throw new CompileError('a 2-D array needs both indexes: a[row][column]', target.line)
          elem = a.t
          this.emit(OP.LSET, target.line, arrTemp, 'float') // the array reference: no integer wrap
          const i = this.expr(target.i, true)
          if (!isInt(i.t) || i.arr) throw new CompileError('array subscript is not an integer', target.line)
          this.emit(OP.LSET, target.line, idxTemp, 'long')
        },
        load: () => {
          this.emit(OP.LGET, target.line, arrTemp)
          this.emit(OP.LGET, target.line, idxTemp)
          this.emit(OP.AGET, target.line)
        },
        store: (keep, line) => {
          // stack: value -> [arr, idx, value] order needed, so save the value in a temp
          const val = this.temp()
          this.emit(OP.LSET, line, val, 'float')
          this.emit(OP.LGET, line, arrTemp)
          this.emit(OP.LGET, line, idxTemp)
          this.emit(OP.LGET, line, val)
          const at = this.emit(OP.ASET, line, elem)
          this.code[at].k = keep
        },
      } as ReturnType<FnCompiler['lvalue']>
    }
    throw new CompileError('lvalue required as left operand of assignment', target.line)
  }

  private assign(e: Extract<Expr, { k: 'asg' }>, need: boolean): Ty {
    const lv = this.lvalue(e.target)
    lv.prepare()
    const target: Ty = { t: lv.type, arr: false }
    if (e.op === '=') {
      const t = this.expr(e.v, true)
      if (t.arr) throw new CompileError('invalid conversion from an array', e.line)
      this.convert(t, { t: lv.type, arr: false }, e.line)
    } else {
      const op = e.op.slice(0, -1)
      lv.load()
      const t = this.expr(e.v, true)
      if (t.arr) throw new CompileError('invalid operand: an array', e.line)
      if (lv.type === 'String') {
        if (op !== '+') throw new CompileError(`invalid operands to binary '${op}' for 'String'`, e.line)
        this.emit(OP.CONCAT, e.line, 'String', t.t)
      } else {
        if (t.t === 'String') throw new CompileError(`cannot use a 'String' with '${e.op}'`, e.line)
        const rt = op === '<<' || op === '>>' ? promote(lv.type, 'int') : promote(lv.type, t.t)
        this.emit(OP.ARITH, e.line, op, rt)
      }
    }
    lv.store(need, e.line)
    return target
  }

  private increment(e: Extract<Expr, { k: 'inc' }>, need: boolean): Ty {
    const lv = this.lvalue(e.target)
    lv.prepare()
    if (lv.type === 'String') throw new CompileError("invalid operand 'String' to '++'", e.line)
    const t: Ty = { t: lv.type, arr: false }
    lv.load()
    if (need && !e.prefix) this.emit(OP.DUP, e.line) // the old value stays as the result
    this.emit(OP.PUSH, e.line, 1)
    this.emit(OP.ARITH, e.line, e.op === '++' ? '+' : '-', promote(lv.type, 'int'))
    lv.store(need && e.prefix, e.line)
    return t
  }

  private call(e: Extract<Expr, { k: 'call' }>, need: boolean): Ty {
    const fn = this.unit.fnTable.get(e.name)
    if (fn) {
      if (e.args.length !== fn.params.length) {
        throw new CompileError(`too ${e.args.length < fn.params.length ? 'few' : 'many'} arguments to function '${e.name}' (it takes ${fn.params.length})`, e.line)
      }
      e.args.forEach((a, i) => {
        const p = fn.params[i]
        const t = this.expr(a, true)
        if (p.array) {
          if (!t.arr) throw new CompileError(`argument ${i + 1} of '${e.name}' must be an array`, e.line)
          if ((t.rank ?? 1) !== p.rank) throw new CompileError(`argument ${i + 1} of '${e.name}' must be a ${p.rank === 2 ? '2-D' : '1-D'} array`, e.line)
        } else this.convert(t, { t: p.type, arr: false }, e.line)
      })
      if (fn.ret === 'void' && need) throw new CompileError(`void value not ignored as it ought to be`, e.line)
      this.emit(OP.CALL, e.line, fn.index, e.args.length)
      // a call always leaves one value (a void function leaves 0)
      if (!need) this.emit(OP.POP, e.line)
      return { t: fn.ret, arr: false }
    }
    if (e.name === 'EEPROM.get') {
      // built by `method`: the address, then the name of the type being read
      this.expr(e.args[0], true)
      const tag = (e.args[1] as Extract<Expr, { k: 'str' }>).v
      this.emit(OP.PUSH, e.line, tag)
      this.emit(OP.CALLB, e.line, 'EEPROM.get', 2)
      if (!need) this.emit(OP.POP, e.line)
      return { t: tag as Type, arr: false }
    }
    if (e.name === 'bitSet' || e.name === 'bitClear' || e.name === 'bitWrite') return this.bitStore(e, need)
    if (UNSUPPORTED.has(e.name)) throw new CompileError(`${e.name}() is not supported by this simulator yet`, e.line)
    const b = BUILTINS[e.name]
    if (!b) throw new CompileError(`'${e.name}' was not declared in this scope`, e.line)
    if (e.args.length < b.min || e.args.length > b.max) {
      throw new CompileError(`wrong number of arguments to ${e.name}(): it takes ${b.min === b.max ? b.min : `${b.min} to ${b.max}`}`, e.line)
    }
    const types: Type[] = []
    for (const a of e.args) {
      const t = this.expr(a, true)
      if (t.arr) throw new CompileError(`an array cannot be passed to ${e.name}()`, e.line)
      if (isStruct(t.t)) throw new CompileError(`a struct cannot be passed to ${e.name}()`, e.line)
      types.push(t.t)
    }
    const at = this.emit(OP.CALLB, e.line, e.name, e.args.length)
    this.code[at].ts = types
    let ret: Type
    if (b.ret === 'same0') ret = types[0] === 'float' ? 'float' : promote(types[0], 'int')
    else if (b.ret === 'promote') ret = types.reduce((x, y) => promote(x, y))
    else ret = b.ret
    if (ret === 'void' && need) throw new CompileError(`void value not ignored as it ought to be`, e.line)
    // a built-in always leaves one value (a void one leaves 0)
    if (!need) this.emit(OP.POP, e.line)
    return { t: ret, arr: false }
  }

  /** bitSet / bitClear / bitWrite change their first argument, so they become an assignment to it: x = x | (1UL << n) and so on. */
  private bitStore(e: Extract<Expr, { k: 'call' }>, need: boolean): Ty {
    const want = e.name === 'bitWrite' ? 3 : 2
    if (e.args.length !== want) throw new CompileError(`wrong number of arguments to ${e.name}(): it takes ${want}`, e.line)
    const x = e.args[0]
    if (x.k !== 'id' && x.k !== 'idx') throw new CompileError(`the first argument of ${e.name}() must be a variable`, e.line)
    const line = e.line
    const one: Expr = { k: 'cast', type: 'ulong', e: { k: 'num', v: 1, float: false, line }, line }
    const mask: Expr = { k: 'bin', op: '<<', a: one, b: e.args[1], line }
    const set: Expr = { k: 'bin', op: '|', a: x, b: mask, line }
    const clear: Expr = { k: 'bin', op: '&', a: x, b: { k: 'un', op: '~', e: mask, line }, line }
    const v: Expr = e.name === 'bitSet' ? set : e.name === 'bitClear' ? clear : { k: 'cond', c: e.args[2], a: set, b: clear, line }
    return this.expr({ k: 'asg', op: '=', target: x, v, line }, need)
  }

  private eeprom(e: Extract<Expr, { k: 'method' }>, need: boolean): Ty {
    const m = EEPROM_METHODS[e.name]
    if (!m) throw new CompileError(`'EEPROM.${e.name}' is not supported by this simulator`, e.line)
    if (e.args.length < m.min || e.args.length > m.max) throw new CompileError(`wrong number of arguments to EEPROM.${e.name}()`, e.line)
    if (e.name === 'get') {
      const target = e.args[1]
      const v = target.k === 'id' ? this.lookup(target.name) : undefined
      if (target.k !== 'id' || !v || v.array || v.type === 'String') throw new CompileError('EEPROM.get() fills a plain number variable: EEPROM.get(address, variable)', e.line)
      const read: Expr = { k: 'call', name: 'EEPROM.get', args: [e.args[0], { k: 'str', v: v.type, line: e.line }], line: e.line }
      this.expr({ k: 'asg', op: '=', target, v: read, line: e.line }, false)
      if (need) throw new CompileError('void value not ignored as it ought to be', e.line)
      return { t: 'void', arr: false }
    }
    const types: Type[] = []
    for (const a of e.args) {
      const t = this.expr(a, true)
      if (t.arr || t.t === 'String') throw new CompileError(`EEPROM.${e.name}() stores numbers: not ${t.arr ? 'an array' : 'a String'}`, e.line)
      types.push(t.t)
    }
    const at = this.emit(OP.CALLB, e.line, `EEPROM.${e.name}`, e.args.length)
    this.code[at].ts = types
    if (need && m.ret === 'void') throw new CompileError('void value not ignored as it ought to be', e.line)
    if (!need) this.emit(OP.POP, e.line)
    return { t: m.ret, arr: false }
  }

  private method(e: Extract<Expr, { k: 'method' }>, need: boolean): Ty {
    if (e.obj.k === 'id' && e.obj.name === 'Serial' && !this.lookup('Serial')) {
      const m = SERIAL[e.name]
      if (!m) throw new CompileError(`'Serial.${e.name}' is not supported by this simulator`, e.line)
      if (e.args.length < m.min || e.args.length > m.max) throw new CompileError(`wrong number of arguments to Serial.${e.name}()`, e.line)
      const types: Type[] = []
      for (const a of e.args) {
        const t = this.expr(a, true)
        if (isStruct(t.t)) throw new CompileError(`Serial.${e.name}() cannot print a struct: print its members`, e.line)
        if (t.arr) {
          // a char array prints as text; handled by the machine
          types.push(t.t === 'char' || t.t === 'byte' ? 'String' : t.t)
          continue
        }
        types.push(t.t)
      }
      const at = this.emit(OP.CALLB, e.line, `Serial.${e.name}`, e.args.length)
      this.code[at].ts = types
      if (need && m.ret === 'void') throw new CompileError(`void value not ignored as it ought to be`, e.line)
      if (!need) this.emit(OP.POP, e.line)
      return { t: m.ret, arr: false }
    }
    if (e.obj.k === 'id' && e.obj.name === 'EEPROM' && !this.lookup('EEPROM')) return this.eeprom(e, need)
    const o = this.expr(e.obj, true)
    if (o.t !== 'String' || o.arr) throw new CompileError(`request for member '${e.name}' in something that is not a String`, e.line)
    const m = STRING_METHODS[e.name]
    if (!m) throw new CompileError(`'String' has no member '${e.name}' in this simulator`, e.line)
    if (e.args.length < m.min || e.args.length > m.max) throw new CompileError(`wrong number of arguments to String.${e.name}()`, e.line)
    const types: Type[] = ['String']
    for (const a of e.args) types.push(this.expr(a, true).t)
    const at = this.emit(OP.CALLM, e.line, e.name, e.args.length)
    this.code[at].ts = types
    if (!need) this.emit(OP.POP, e.line)
    return { t: m.ret, arr: false }
  }
}

interface FnEntry {
  index: number
  ret: Type
  params: { type: Type; array: boolean; rank: 1 | 2 }[]
}

class Unit {
  globals = new Map<string, VarInfo>()
  fnTable = new Map<string, FnEntry>()
  structs = new Map<string, StructDef>()
  nGlobals = 0
  /** Initialisers of globals (and statics) in order, compiled into `__init`. */
  private inits: { v: VarInfo; d: Extract<Stmt, { k: 'decl' }>; fnName: string }[] = []
  /** Names of the globals that are plain `const` integers with a constant initialiser. */

  /** `sizeof` of a type on the AVR: int 2, long and float 4, a struct the sum of its members. */
  sizeOf(type: Type, line: number): number {
    switch (type) {
      case 'bool':
      case 'char':
      case 'byte':
        return 1
      case 'int':
      case 'uint':
        return 2
      case 'long':
      case 'ulong':
      case 'float':
        return 4
      case 'String':
        return 6
      case 'void':
        return 1
      default:
        return this.structOf(type, line).fields.reduce((n, f) => n + this.sizeOf(f.type, line), 0)
    }
  }

  structOf(type: Type, line: number): StructDef {
    const def = this.structs.get(type.slice('struct:'.length))
    if (!def) throw new CompileError(`'${type}' is not a known struct`, line)
    return def
  }

  addGlobal(name: string, type: Type, array: boolean, line: number, rank: 1 | 2 = 1): VarInfo {
    if (this.globals.has(name)) throw new CompileError(`redeclaration of '${name}'`, line)
    const v: VarInfo = { slot: this.nGlobals++, type, array, global: true, rank }
    this.globals.set(name, v)
    return v
  }

  initDecl(v: VarInfo, d: Extract<Stmt, { k: 'decl' }>, fnName: string): void {
    this.inits.push({ v, d, fnName })
  }

  /** Evaluate a constant expression (array sizes, case labels need this; so do `const int` globals). */
  constEval(e: Expr, cx: FnCompiler | null): number {
    void cx
    switch (e.k) {
      case 'num':
      case 'chr':
        return e.v
      case 'id': {
        const v = this.globals.get(e.name)
        if (v && v.constVal !== undefined) return v.constVal
        throw new CompileError(`'${e.name}' is not a constant (use a #define or a const int for array sizes)`, e.line)
      }
      case 'un':
        if (e.op === '-') return -this.constEval(e.e, cx)
        if (e.op === '+') return this.constEval(e.e, cx)
        break
      case 'bin': {
        const a = this.constEval(e.a, cx)
        const b = this.constEval(e.b, cx)
        switch (e.op) {
          case '+':
            return a + b
          case '-':
            return a - b
          case '*':
            return a * b
          case '/':
            return b === 0 ? 0 : Math.trunc(a / b)
          case '%':
            return b === 0 ? 0 : a % b
          case '<<':
            return a << b
          case '>>':
            return a >> b
          default:
            break
        }
        break
      }
      default:
        break
    }
    throw new CompileError('the size of an array must be a constant', e.line)
  }

  flushInits(): FnInfo {
    const c = new FnCompiler(this, null, '__init')
    for (const { v, d, fnName } of this.inits) {
      void fnName
      c.initVar(v, d)
    }
    c.emit(OP.PUSH, 0, 0)
    c.emit(OP.RET, 0, 'void')
    return { name: '__init', ret: 'void', nParams: 0, nLocals: c.maxSlot, code: c.code }
  }
}

/** Compile a sketch. Throws a `CompileError` with the line of the first problem. */
export function compile(source: string): Program {
  const ast: Ast = parse(source)
  const unit = new Unit()
  for (const d of ast.structs) unit.structs.set(d.name, d)
  // functions first, so calls can come before definitions and prototypes work
  const defs = new Map<string, FuncDef>()
  const order: FuncDef[] = []
  for (const f of ast.funcs) {
    const prev = unit.fnTable.get(f.name)
    const sig = { ret: f.ret, params: f.params.map((p) => ({ type: p.type, array: p.array, rank: p.rank })) }
    if (prev) {
      if (f.body !== null && defs.has(f.name)) throw new CompileError(`redefinition of '${f.name}'`, f.line)
      if (f.body !== null) {
        defs.set(f.name, f)
        order[prev.index] = f
      }
      continue
    }
    const index = order.length
    unit.fnTable.set(f.name, { index, ...sig })
    order.push(f)
    if (f.body !== null) defs.set(f.name, f)
  }
  for (const f of order) {
    if (f.body === null) throw new CompileError(`'${f.name}' was declared but never defined`, f.line)
  }
  if (!defs.has('setup')) throw new CompileError("'setup' was not declared: every sketch needs void setup()", 1)
  if (!defs.has('loop')) throw new CompileError("'loop' was not declared: every sketch needs void loop()", 1)
  for (const name of ['setup', 'loop']) {
    const f = defs.get(name)!
    if (f.params.length > 0 || f.ret !== 'void') throw new CompileError(`'${name}' must be 'void ${name}()'`, f.line)
  }
  // globals
  for (const g of ast.globals) {
    const v = unit.addGlobal(g.name, g.type, g.array, g.line, g.rank)
    if (g.isConst && !g.array && g.init !== null && !Array.isArray(g.init) && g.type !== 'float' && g.type !== 'String') {
      try {
        v.constVal = unit.constEval(g.init, null)
      } catch {
        // not a constant: an ordinary variable
      }
    }
    unit.initDecl(v, g, '')
  }
  const fns: FnInfo[] = order.map((f) => {
    const c = new FnCompiler(unit, f, f.name)
    c.compileBody()
    return { name: f.name, ret: f.ret, nParams: f.params.length, nLocals: Math.max(c.maxSlot, f.params.length), code: c.code }
  })
  const init = unit.flushInits()
  fns.push(init)
  return {
    fns,
    init: fns.length - 1,
    setup: unit.fnTable.get('setup')!.index,
    loop: unit.fnTable.get('loop')!.index,
    nGlobals: unit.nGlobals,
    includes: ast.includes,
  }
}

