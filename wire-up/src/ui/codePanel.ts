// The code panel of the Arduino boards: a terminal-looking floating panel with the sketch editor on the left and, on the right, the
// messages of Verify / Upload and the Serial Monitor of the board being edited. The menu bar's Code button opens and closes it;
// clicking a board on the canvas (or choosing one in the panel's list) points it at that board and shows that board's name and
// program. It never holds the running program: `Upload` copies the text into the board's `program`, and the simulation runs that.

import { CompileError, compile } from '../mcu/compile.ts'
import { BLINK_SKETCH } from '../parts/arduino.ts'
import { LCD_SKETCH } from '../parts/lcd.ts'
import type { PartInstance } from '../board/world.ts'
import type { Workspace } from './workspace.ts'

interface Line {
  cls: 'ok' | 'err' | 'dim'
  text: string
}

const STATE_TEXT: Record<string, [string, string]> = {
  running: ['RUNNING', 'ok'],
  off: ['NO POWER', 'warn'],
  blank: ['NO PROGRAM', 'warn'],
  reset: ['RESET HELD', 'warn'],
  error: ['STOPPED', 'bad'],
  stalled: ['TOO BUSY', 'warn'],
}

const KEY = 'wire-up:code'

const WORDS_K = new Set(
  'void bool boolean char byte int short long float double unsigned signed const static volatile String word size_t uint8_t uint16_t uint32_t int8_t int16_t int32_t if else for while do switch case default break continue return true false HIGH LOW INPUT OUTPUT INPUT_PULLUP LED_BUILTIN A0 A1 A2 A3 A4 A5 PI DEC HEX BIN OCT'.split(' '),
)
const WORDS_F = new Set(
  'setup loop pinMode digitalWrite digitalRead analogRead analogWrite analogReference delay delayMicroseconds millis micros random randomSeed map constrain min max abs sq sqrt pow sin cos tan exp log floor ceil round bitRead lowByte highByte Serial begin end print println write available read peek parseInt parseFloat flush F'.split(' '),
)

const TOKEN = /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:\.|[^"\\n])*"?|'(?:\.|[^'\\n])*'?|^[ \t]*#[^\n]*|\b0[xX][0-9a-fA-F]+\b|\b0[bB][01]+\b|\b\d+(?:\.\d+)?(?:[eE][-+]?\d+)?[uUlLfF]*\b|[A-Za-z_]\w*/gm

function esc(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** The sketch as HTML for the layer under the editor: syntax colours as in the Arduino IDE, one line per row, the bad line tinted. */
export function highlight(src: string, errLine: number): string {
  const lines: string[] = ['']
  const put = (cls: string, text: string): void => {
    const parts = text.split('\n')
    parts.forEach((piece, i) => {
      if (i > 0) lines.push('')
      if (piece !== '') lines[lines.length - 1] += cls ? `<span class="${cls}">${esc(piece)}</span>` : esc(piece)
    })
  }
  let at = 0
  TOKEN.lastIndex = 0
  for (let m = TOKEN.exec(src); m !== null; m = TOKEN.exec(src)) {
    if (m[0] === '') {
      TOKEN.lastIndex++
      continue
    }
    if (m.index > at) put('', src.slice(at, m.index))
    const t = m[0]
    let cls = ''
    if (t.startsWith('//') || t.startsWith('/*')) cls = 'cp-hl-c'
    else if (t[0] === '"' || t[0] === "'") cls = 'cp-hl-s'
    else if (/^\s*#/.test(t)) cls = 'cp-hl-p'
    else if (/^\d/.test(t)) cls = 'cp-hl-n'
    else if (WORDS_F.has(t)) cls = 'cp-hl-f'
    else if (WORDS_K.has(t)) cls = 'cp-hl-k'
    put(cls, t)
    at = m.index + t.length
  }
  if (at < src.length) put('', src.slice(at))
  return lines.map((l, i) => (i + 1 === errLine ? `<span class="cp-hl-err">${l === '' ? ' ' : l}</span>` : l)).join('\n') + '\n'
}

export class CodePanel {
  private root: HTMLElement
  private ws: Workspace
  private ta: HTMLTextAreaElement
  private gutter: HTMLElement
  private log: HTMLElement
  private serial: HTMLElement
  private state: HTMLElement
  private pick: HTMLSelectElement
  private empty: HTMLElement
  private hl: HTMLElement
  private pos: HTMLElement
  private info: HTMLElement
  private fileTab: HTMLElement
  /** The board being edited (the last Arduino the player picked), or null while the lab has none. */
  private id: string | null = null
  private open = false
  private logs = new Map<string, Line[]>()
  private shownTotal = -1
  private shownText = ''
  private shownState = ''
  private shownError = ''
  private shownBoards = ''
  private errLine = 0
  private drawnErr = -1
  private folded = false
  private lineCount = 0
  /** Called when the panel opens or closes (the menu bar button shows it). */
  onToggle: () => void = () => {}

  constructor(root: HTMLElement, ws: Workspace) {
    this.root = root
    this.ws = ws
    const q = <T extends HTMLElement>(id: string): T => root.querySelector(`#${id}`) as T
    this.ta = q<HTMLTextAreaElement>('cp-code')
    this.gutter = q('cp-gutter')
    this.log = q('cp-log')
    this.serial = q('cp-serial')
    this.state = q('cp-state')
    this.pick = q<HTMLSelectElement>('cp-board')
    this.empty = q('cp-empty')
    this.hl = q('cp-hl')
    this.pos = q('cp-pos')
    this.info = q('cp-info')
    this.fileTab = q('cp-file')

    try {
      this.open = localStorage.getItem(KEY) === '1'
    } catch {
      // no storage: the panel starts closed
    }
    this.root.hidden = !this.open

    this.ta.addEventListener('input', () => this.typed())
    this.ta.addEventListener('scroll', () => {
      this.gutter.scrollTop = this.ta.scrollTop
      this.hl.scrollTop = this.ta.scrollTop
      this.hl.scrollLeft = this.ta.scrollLeft
    })
    for (const ev of ['keyup', 'click', 'focus']) this.ta.addEventListener(ev, () => this.updatePos())
    this.ta.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault()
        const s = this.ta.selectionStart
        this.ta.setRangeText('  ', s, this.ta.selectionEnd, 'end')
        this.typed()
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        this.upload()
      }
    })
    this.pick.addEventListener('change', () => {
      const id = this.pick.value
      if (this.ws.world.getPart(id)) this.ws.select(id)
    })
    q('cp-verify').onclick = () => this.verify()
    q('cp-upload').onclick = () => this.upload()
    q('cp-clear').onclick = () => {
      if (this.id) this.ws.sim.boards.clearSerial(this.id)
      this.shownTotal = -1
    }
    q('cp-fold').onclick = () => {
      this.folded = !this.folded
      this.root.classList.toggle('folded', this.folded)
      q('cp-fold').textContent = this.folded ? '▴' : '▾'
    }
    q('cp-close').onclick = () => this.setOpen(false)
    q('cp-example').onclick = () => {
      if (!this.id) return
      this.ta.value = BLINK_SKETCH
      this.typed()
    }
    q('cp-example-lcd').onclick = () => {
      if (!this.id) return
      this.ta.value = LCD_SKETCH
      this.typed()
    }
    const form = q<HTMLFormElement>('cp-send')
    const input = q<HTMLInputElement>('cp-input')
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      if (!this.id || input.value === '') return
      this.ws.sim.boards.serialInput(this.id, `${input.value}\n`)
      input.value = ''
    })
    this.sync(true)
  }

  get isOpen(): boolean {
    return this.open
  }

  setOpen(open: boolean): void {
    if (open === this.open) return
    this.open = open
    this.root.hidden = !open
    try {
      localStorage.setItem(KEY, open ? '1' : '0')
    } catch {
      // not remembered
    }
    if (open) this.sync(true)
    this.onToggle()
  }

  toggle(): void {
    this.setOpen(!this.open)
  }

  /** The player selected a part: if it is an Arduino board, the panel now shows that board. Any other part leaves it as it was. */
  select(part: PartInstance | undefined): void {
    if (!part || part.type !== 'arduino-uno' || part.id === this.id) return
    this.id = part.id
    this.shownTotal = -1
    this.shownState = ''
    this.shownError = ''
    this.errLine = 0
    this.sync(true)
  }

  /** The program text changed behind the panel's back (undo, a new file): show it. */
  refresh(): void {
    this.sync(false)
  }

  private boards(): PartInstance[] {
    return this.ws.world.parts.filter((p) => p.type === 'arduino-uno')
  }

  private part(): PartInstance | null {
    return this.id ? (this.ws.world.getPart(this.id) ?? null) : null
  }

  /** Keep the board list, the shown board and the editor text in step with the lab. */
  private sync(forced: boolean): void {
    let force = forced
    const boards = this.boards()
    // the board being edited was deleted, or none was chosen yet: take the selected one, else the first board
    if (!this.part()) {
      const sel = this.ws.selectedPart ? this.ws.world.getPart(this.ws.selectedPart) : undefined
      const next = sel && sel.type === 'arduino-uno' ? sel : boards[0]
      const nextId = next ? next.id : null
      if (nextId !== this.id) {
        this.id = nextId
        this.shownTotal = -1
        this.shownState = ''
        this.shownError = ''
        this.errLine = 0
        force = true
      }
    }
    const key = boards.map((b) => b.id).join(',')
    if (key !== this.shownBoards || force) {
      this.shownBoards = key
      this.pick.replaceChildren(
        ...boards.map((b) => {
          const o = document.createElement('option')
          o.value = b.id
          o.textContent = `Arduino Uno ${b.id}`
          return o
        }),
      )
    }
    if (this.id) this.pick.value = this.id
    this.fileTab.textContent = this.id ? `${this.id}.ino` : 'sketch.ino'
    const has = this.id !== null
    this.empty.hidden = has
    this.ta.disabled = !has
    this.pick.disabled = !has
    this.root.classList.toggle('no-board', !has)
    const p = this.part()
    if (!p) {
      this.ta.value = ''
      this.state.textContent = ''
      this.drawGutter()
      this.renderLog()
      return
    }
    const code = typeof p.params.code === 'string' ? p.params.code : ''
    if (force || (code !== this.ta.value && document.activeElement !== this.ta)) {
      this.ta.value = code
      this.drawGutter()
    }
    if (force) this.renderLog()
  }

  private typed(): void {
    const p = this.part()
    if (!p) return
    p.params.code = this.ta.value
    this.ws.onRuntime()
    this.errLine = 0
    this.drawGutter()
  }

  /** Line and column of the caret, in the status line. */
  private updatePos(): void {
    const upto = this.ta.value.slice(0, this.ta.selectionStart)
    const ln = upto.split('\n').length
    const col = upto.length - upto.lastIndexOf('\n')
    this.pos.textContent = `Ln ${ln}, Col ${col}`
  }

  private drawGutter(): void {
    this.hl.innerHTML = highlight(this.ta.value, this.errLine)
    this.hl.scrollTop = this.ta.scrollTop
    this.hl.scrollLeft = this.ta.scrollLeft
    const n = Math.max(1, this.ta.value.split('\n').length)
    if (n !== this.lineCount || this.errLine !== this.drawnErr || this.gutter.childElementCount === 0) {
      this.lineCount = n
      this.drawnErr = this.errLine
      const frag = document.createDocumentFragment()
      for (let i = 1; i <= n; i++) {
        const s = document.createElement('span')
        s.textContent = String(i)
        if (i === this.errLine) s.className = 'bad'
        frag.appendChild(s)
        frag.appendChild(document.createTextNode('\n'))
      }
      this.gutter.replaceChildren(frag)
    }
    this.gutter.scrollTop = this.ta.scrollTop
  }

  private say(cls: Line['cls'], text: string): void {
    if (!this.id) return
    const list = this.logs.get(this.id) ?? []
    list.push({ cls, text })
    while (list.length > 8) list.shift()
    this.logs.set(this.id, list)
    this.renderLog()
  }

  private renderLog(): void {
    const list = this.id ? (this.logs.get(this.id) ?? []) : []
    this.log.replaceChildren(
      ...list.map((l) => {
        const s = document.createElement('div')
        s.className = l.cls
        s.textContent = l.text
        return s
      }),
    )
  }

  /** Check the text; returns true when it compiles. */
  private check(): boolean {
    if (!this.part()) return false
    try {
      const prog = compile(this.ta.value)
      const ops = prog.fns.reduce((s, f) => s + f.code.length, 0)
      this.errLine = 0
      this.drawGutter()
      this.say('ok', `Verified: ${prog.fns.length - 1} functions, ${ops} instructions.`)
      return true
    } catch (e) {
      const line = e instanceof CompileError ? e.line : 0
      this.errLine = line
      this.drawGutter()
      this.say('err', `${line > 0 ? `line ${line}: ` : ''}${e instanceof Error ? e.message : String(e)}`)
      if (line > 0) {
        const lh = parseFloat(getComputedStyle(this.ta).lineHeight) || 18
        this.ta.scrollTop = Math.max(0, (line - 3) * lh)
        this.gutter.scrollTop = this.ta.scrollTop
      }
      return false
    }
  }

  private verify(): void {
    this.check()
  }

  private upload(): void {
    const p = this.part()
    if (!p || !this.check()) return
    p.params.program = this.ta.value
    p.params.code = this.ta.value
    this.ws.onRuntime()
    this.ws.sim.boards.clearSerial(p.id)
    this.shownTotal = -1
    this.say('ok', 'Uploaded. The board restarts with the new sketch.')
  }

  /** Per frame: the board list, the board's state and its Serial output. */
  frame(): void {
    if (!this.open) return
    this.sync(false)
    const p = this.part()
    if (!p) return
    const info = this.ws.sim.boards.info(p.id)
    if (info.state !== this.shownState) {
      this.shownState = info.state
      const [text, cls] = STATE_TEXT[info.state] ?? [info.state.toUpperCase(), 'warn']
      this.state.textContent = text
      this.state.className = `cp-state ${cls}`
      this.info.textContent = `Arduino Uno on ${p.id}`
    }
    if (info.error !== this.shownError) {
      this.shownError = info.error
      if (info.error !== '') this.say('err', info.error)
    }
    if (info.total !== this.shownTotal || info.text !== this.shownText) {
      this.shownTotal = info.total
      this.shownText = info.text
      const atEnd = this.serial.scrollTop + this.serial.clientHeight >= this.serial.scrollHeight - 8
      this.serial.textContent = info.text
      if (atEnd) this.serial.scrollTop = this.serial.scrollHeight
    }
  }
}
