// The code panel of an Arduino board: a terminal-looking floating panel with the sketch editor on the left and, on the right, the
// messages of Verify / Upload and the Serial Monitor of the selected board. It never holds the running program: `Upload` copies
// the text into the board's `program`, and the simulation runs that.

import { CompileError, compile } from '../mcu/compile.ts'
import { BLINK_SKETCH } from '../parts/arduino.ts'
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

export class CodePanel {
  private root: HTMLElement
  private ws: Workspace
  private ta: HTMLTextAreaElement
  private gutter: HTMLElement
  private log: HTMLElement
  private serial: HTMLElement
  private state: HTMLElement
  private title: HTMLElement
  private part: PartInstance | null = null
  private logs = new Map<string, Line[]>()
  private shownTotal = -1
  private shownText = ''
  private shownState = ''
  private shownError = ''
  private errLine = 0
  private folded = false
  private lineCount = 0
  private drawnErr = -1

  constructor(root: HTMLElement, ws: Workspace) {
    this.root = root
    this.ws = ws
    const q = <T extends HTMLElement>(id: string): T => root.querySelector(`#${id}`) as T
    this.ta = q<HTMLTextAreaElement>('cp-code')
    this.gutter = q('cp-gutter')
    this.log = q('cp-log')
    this.serial = q('cp-serial')
    this.state = q('cp-state')
    this.title = q('cp-title')

    this.ta.addEventListener('input', () => this.typed())
    this.ta.addEventListener('scroll', () => {
      this.gutter.scrollTop = this.ta.scrollTop
    })
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
    q('cp-verify').onclick = () => this.verify()
    q('cp-upload').onclick = () => this.upload()
    q('cp-clear').onclick = () => {
      if (this.part) this.ws.sim.boards.clearSerial(this.part.id)
      this.shownTotal = -1
    }
    q('cp-fold').onclick = () => {
      this.folded = !this.folded
      this.root.classList.toggle('folded', this.folded)
      q('cp-fold').textContent = this.folded ? '▴' : '▾'
    }
    q('cp-example').onclick = () => {
      if (!this.part) return
      this.ta.value = BLINK_SKETCH
      this.typed()
    }
    const form = q<HTMLFormElement>('cp-send')
    const input = q<HTMLInputElement>('cp-input')
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      if (!this.part || input.value === '') return
      this.ws.sim.boards.serialInput(this.part.id, `${input.value}\n`)
      input.value = ''
    })
  }

  /** Show the panel for the selected part when it is an Arduino board, hide it otherwise. */
  setPart(part: PartInstance | undefined): void {
    const p = part && part.type === 'arduino-uno' ? part : null
    if (p === this.part && p !== null) return
    this.part = p
    this.root.hidden = p === null
    this.shownTotal = -1
    this.shownState = ''
    this.shownError = ''
    this.errLine = 0
    if (!p) return
    this.title.textContent = `ARDUINO UNO  ${p.id}`
    this.syncText(true)
    this.renderLog()
  }

  /** The program text changed behind the panel's back (undo, a new file): show it. */
  refresh(): void {
    if (this.part) this.syncText(false)
  }

  private syncText(force: boolean): void {
    if (!this.part) return
    const code = typeof this.part.params.code === 'string' ? this.part.params.code : ''
    if (force || (code !== this.ta.value && document.activeElement !== this.ta)) {
      this.ta.value = code
      this.drawGutter()
    }
  }

  private typed(): void {
    if (!this.part) return
    this.part.params.code = this.ta.value
    this.ws.onRuntime()
    this.errLine = 0
    this.drawGutter()
  }

  private drawGutter(): void {
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
    if (!this.part) return
    const list = this.logs.get(this.part.id) ?? []
    list.push({ cls, text })
    while (list.length > 8) list.shift()
    this.logs.set(this.part.id, list)
    this.renderLog()
  }

  private renderLog(): void {
    const list = this.part ? (this.logs.get(this.part.id) ?? []) : []
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
    if (!this.part) return false
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
    if (!this.part || !this.check()) return
    this.part.params.program = this.ta.value
    this.part.params.code = this.ta.value
    this.ws.onRuntime()
    this.ws.sim.boards.clearSerial(this.part.id)
    this.shownTotal = -1
    this.say('ok', 'Uploaded. The board restarts with the new sketch.')
  }

  /** Per frame: the board's state and its Serial output. */
  frame(): void {
    const p = this.part
    if (!p || this.root.hidden) return
    const info = this.ws.sim.boards.info(p.id)
    const key = info.state
    if (key !== this.shownState) {
      this.shownState = key
      const [text, cls] = STATE_TEXT[key] ?? [key.toUpperCase(), 'warn']
      this.state.textContent = text
      this.state.className = `cp-state ${cls}`
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
    // the sketch text shown follows the part when it is changed elsewhere (undo, import)
    this.syncText(false)
  }
}
