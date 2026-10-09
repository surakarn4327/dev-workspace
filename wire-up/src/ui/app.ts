import { World } from '../board/world.ts'
import type { WorldData } from '../board/world.ts'
import { SceneBuilder } from '../lessons/lessons.ts'
import { exportFile, loadLab, parseImport, saveLab } from '../save/storage.ts'
import { History } from '../save/history.ts'
import { defOf, isRuntimeState } from '../parts/index.ts'
import { updateChipSheet } from './icSheet.ts'
import { Inspector } from './inspector.ts'
import { LessonPanel } from './lessonPanel.ts'
import { buildToolbox } from './toolbox.ts'
import { untangle } from '../board/untangle.ts'
import { keyName } from './keys.ts'
import { Workspace } from './workspace.ts'

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Missing #${id}`)
  return el as T
}

export class App {
  readonly world = new World()
  readonly ws: Workspace
  private history = new History()
  private inspector: Inspector
  private lessons: LessonPanel
  private lastRev = 0
  private saveTimer: number | undefined
  private inLesson = false
  private labBackup: { data: WorldData; view: Workspace['view'] } | null = null
  private logSeen = 0
  private uiAcc = 0

  constructor() {
    const canvas = $<HTMLCanvasElement>('canvas')
    const saved = loadLab()
    if (saved) {
      this.world.load(saved.data)
      untangle(this.world)
    } else this.starterScene()
    this.ws = new Workspace(canvas, this.world)
    if (saved?.view) this.ws.view = saved.view
    else window.setTimeout(() => this.ws.fitView(), 80)

    this.inspector = new Inspector(this.ws, $('panel-inspect'))
    this.lessons = new LessonPanel(this.ws, $('panel-lessons'), {
      enter: (setup) => this.enterLesson(setup),
      exit: () => this.exitLesson(),
      toast: (t, b, good) => this.toast(t, b, good),
    })
    buildToolbox(this.ws, $('tool-head'), $('tool-tabs'), $('tool-items'))

    this.ws.onSelect = () => {
      this.followSelection()
      this.inspector.rebuild()
      updateChipSheet($<HTMLCanvasElement>('ic-sheet'), this.ws.selectedPart ? this.world.getPart(this.ws.selectedPart) : undefined)
      $('btn-wire').classList.toggle('on', this.ws.wireMode)
    }
    this.ws.onEdit = () => this.afterEdit()
    this.ws.onRuntime = () => this.scheduleSave()
    this.ws.onHover = (h) => {
      $('status-text').textContent = h.text || 'Drag parts from the left onto the board. Drag from any hole or pin to pull a wire.'
    }
    this.ws.onFrame = (dt) => this.frame(dt)

    this.history.reset(JSON.stringify(this.world.serialize()))
    this.lastRev = this.world.revision
    this.inspector.rebuild()
    this.bindTopbar()
    window.addEventListener('keydown', (e) => this.keys(e))
    ;(window as unknown as { __wireup: unknown }).__wireup = { app: this, world: this.world, ws: this.ws, sim: this.ws.sim }
  }

  private starterScene(): void {
    const b = new SceneBuilder(this.world)
    b.board()
    b.place('supply', -340, 40, { volts: 5, limit: 0.3 })
    b.place('meter', 680, 40, { mode: 'V' })
    this.world.commit()
  }

  private bindTopbar(): void {
    $('btn-new').onclick = () => {
      if (!window.confirm('Clear the whole lab? (You can undo this.)')) return
      if (this.inLesson) this.lessons.exit()
      this.world.clear()
      this.ws.select(null)
      this.afterEdit()
    }
    $('btn-undo').onclick = () => this.undo()
    $('btn-redo').onclick = () => this.redo()
    $('btn-wire').onclick = () => this.ws.setWireMode(!this.ws.wireMode)
    $('btn-fit').onclick = () => this.ws.fitView()
    const pixelKey = 'wire-up:pixel'
    try {
      if (localStorage.getItem(pixelKey) === 'off') this.ws.renderer.pixelMode = false
    } catch {
      // no storage: pixel look stays on
    }
    $('btn-pixel').classList.toggle('on', this.ws.renderer.pixelMode)
    $('btn-pixel').onclick = () => {
      this.ws.renderer.pixelMode = !this.ws.renderer.pixelMode
      $('btn-pixel').classList.toggle('on', this.ws.renderer.pixelMode)
      try {
        localStorage.setItem(pixelKey, this.ws.renderer.pixelMode ? 'on' : 'off')
      } catch {
        // ignore
      }
    }
    $('btn-pause').onclick = () => {
      this.ws.setPaused(!this.ws.isPaused)
      $('btn-pause').textContent = this.ws.isPaused ? 'Resume' : 'Pause'
      $('btn-pause').classList.toggle('on', this.ws.isPaused)
    }
    $('btn-export').onclick = () => exportFile(this.world.serialize())
    const file = $<HTMLInputElement>('file-import')
    $('btn-import').onclick = () => file.click()
    file.onchange = async () => {
      const f = file.files?.[0]
      file.value = ''
      if (!f) return
      const res = parseImport(await f.text())
      if (!res.ok) {
        this.toast('Import failed', res.error, false)
        return
      }
      if (this.inLesson) this.lessons.exit()
      this.world.load(res.lab.data)
      untangle(this.world)
      this.world.commit()
      this.ws.select(null)
      if (res.lab.view) this.ws.view = res.lab.view
      else this.ws.fitView()
      this.afterEdit()
      this.toast('Imported', f.name, true)
    }
    this.bindPanels()
    $('btn-help').onclick = () => $<HTMLDialogElement>('help').showModal()
    const tabs = $('side-tabs').querySelectorAll('button')
    tabs.forEach((t) => {
      t.onclick = () => {
        this.tabBeforeSelect = null // the player chose a tab: leave it alone when the selection goes away
        this.openedBySelect = false
        this.showSideTab(t.dataset.tab ?? 'inspect')
      }
    })
  }

  private sideTab = 'inspect'
  /** Tab that was open when a selection pulled the side panel to the Inspector; shown again when nothing is selected. */
  private tabBeforeSelect: string | null = null
  private hadSelection = false

  private showSideTab(tab: string): void {
    this.sideTab = tab
    $('side-tabs').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.dataset.tab === tab))
    $('panel-inspect').hidden = tab !== 'inspect'
    $('panel-lessons').hidden = tab !== 'lessons'
  }

  /**
   * Selecting something shows the Inspector: if the right panel is hidden it slides open, otherwise the Inspector tab replaces
   * the tab that was open. Letting go of the selection undoes exactly that: the panel hides again, or the earlier tab returns.
   * Touching the panel by hand in between (tab or toggle) leaves it alone.
   */
  private followSelection(): void {
    // a lone part with nothing to adjust (a gate, a chip, a battery, a push button...) does not call the panel up
    const part = this.ws.selectedPart ? this.world.getPart(this.ws.selectedPart) : undefined
    const settings = part ? defOf(part.type).fields(part).length > 0 : false
    const has = settings || this.ws.selectedWire !== null || this.ws.groupSize() > 0
    if (has === this.hadSelection) return
    this.hadSelection = has
    if (has) {
      if (this.isRightHidden()) {
        this.openedBySelect = true
        this.setRightHidden(false)
      }
      if (this.sideTab !== 'inspect') {
        this.tabBeforeSelect = this.sideTab
        this.showSideTab('inspect')
      }
    } else {
      if (this.tabBeforeSelect) {
        this.showSideTab(this.tabBeforeSelect)
        this.tabBeforeSelect = null
      }
      if (this.openedBySelect) this.setRightHidden(true)
      this.openedBySelect = false
    }
  }

  /** The right panel was hidden and a selection opened it. */
  private openedBySelect = false
  private isRightHidden = (): boolean => $('app').classList.contains('hide-right')
  private setRightHidden: (hidden: boolean) => void = () => {}

  private togglePanel: (side: 'left' | 'right') => void = () => {}

  private bindPanels(): void {
    const app = $('app')
    const key = 'wire-up:panels'
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? '{}') as { left?: boolean; right?: boolean }
      app.classList.toggle('hide-left', saved.left === true)
      app.classList.toggle('hide-right', saved.right === true)
    } catch {
      // no storage: panels start open
    }
    const sync = () => {
      const left = app.classList.contains('hide-left')
      const right = app.classList.contains('hide-right')
      $('toggle-left').textContent = left ? '›' : '‹'
      this.ws.setLeftInset(left ? 0 : $('toolbox').offsetWidth)
      this.ws.setRightInset(right ? 0 : $('side').offsetWidth)
      $('toggle-right').textContent = right ? '‹' : '›'
      try {
        localStorage.setItem(key, JSON.stringify({ left, right }))
      } catch {
        // ignore
      }
    }
    this.setRightHidden = (hidden) => {
      app.classList.toggle('hide-right', hidden)
      sync()
    }
    this.togglePanel = (side) => {
      if (side === 'right') this.openedBySelect = false // the player took over the panel
      app.classList.toggle(side === 'left' ? 'hide-left' : 'hide-right')
      sync()
    }
    $('toggle-left').onclick = () => this.togglePanel('left')
    $('toggle-right').onclick = () => this.togglePanel('right')
    sync()
  }

  private keys(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return
    const k = keyName(e)
    if (k === '[') this.togglePanel('left')
    else if (k === ']') this.togglePanel('right')
    else if ((e.ctrlKey || e.metaKey) && k === 'z') {
      e.preventDefault()
      if (e.shiftKey) this.redo()
      else this.undo()
    } else if ((e.ctrlKey || e.metaKey) && k === 'y') {
      e.preventDefault()
      this.redo()
    }
  }

  private restore(json: string | null): void {
    if (!json) return
    // switches keep the position they have now: undo and redo only walk through edits, not through flipped switches
    const switches = new Map(this.world.parts.filter((p) => isRuntimeState(p, 'on')).map((p) => [p.id, p.params.on === true]))
    this.world.load(JSON.parse(json) as WorldData)
    for (const p of this.world.parts) if (switches.has(p.id) && isRuntimeState(p, 'on')) p.params.on = switches.get(p.id) === true
    this.ws.select(null)
    this.lastRev = this.world.revision
    this.inspector.rebuild()
    this.syncButtons()
    this.scheduleSave()
  }

  undo(): void {
    this.restore(this.history.undo())
  }

  redo(): void {
    this.restore(this.history.redo())
  }

  private afterEdit(): void {
    if (this.world.revision === this.lastRev) return
    this.lastRev = this.world.revision
    this.history.push(JSON.stringify(this.world.serialize()))
    this.syncButtons()
    this.scheduleSave()
  }

  private syncButtons(): void {
    ;($('btn-undo') as HTMLButtonElement).disabled = !this.history.canUndo
    ;($('btn-redo') as HTMLButtonElement).disabled = !this.history.canRedo
  }

  private scheduleSave(): void {
    if (this.inLesson) return
    window.clearTimeout(this.saveTimer)
    $('save-state').textContent = 'saving...'
    this.saveTimer = window.setTimeout(() => {
      const ok = saveLab(this.world.serialize(), this.ws.view)
      $('save-state').textContent = ok ? 'autosaved' : 'autosave failed (storage full or blocked)'
    }, 350)
  }

  private enterLesson(setup: (b: SceneBuilder) => void): void {
    if (!this.inLesson) this.labBackup = { data: this.world.serialize(), view: { ...this.ws.view } }
    this.inLesson = true
    this.world.clear()
    setup(new SceneBuilder(this.world))
    this.world.commit()
    this.ws.select(null)
    this.lastRev = this.world.revision
    this.history.reset(JSON.stringify(this.world.serialize()))
    this.syncButtons()
    this.ws.fitView()
    $('save-state').textContent = 'mission (lab is kept safe)'
  }

  private exitLesson(): void {
    if (this.labBackup) {
      this.world.load(this.labBackup.data)
      this.ws.view = this.labBackup.view
    }
    this.labBackup = null
    this.inLesson = false
    this.world.commit()
    this.ws.select(null)
    this.lastRev = this.world.revision
    this.history.reset(JSON.stringify(this.world.serialize()))
    this.syncButtons()
    $('save-state').textContent = 'autosave on'
  }

  /** Toasts on screen by their text: the same message again counts up on the one box instead of piling a new box on top. */
  private toasts = new Map<string, { el: HTMLElement; title: HTMLElement; label: string; count: number; timer: number }>()

  toast(title: string, body: string, good: boolean): void {
    const key = `${title}|${body}`
    const old = this.toasts.get(key)
    const ms = good ? 6000 : 12000
    if (old && old.el.isConnected) {
      old.count++
      old.title.textContent = `${old.label} (x${old.count})`
      window.clearTimeout(old.timer)
      old.timer = window.setTimeout(() => old.el.remove(), ms)
      return
    }
    const el = document.createElement('div')
    el.className = `toast${good ? ' good' : ''}`
    const b = document.createElement('b')
    b.textContent = title
    el.appendChild(b)
    el.appendChild(document.createTextNode(body))
    el.onclick = () => {
      el.remove()
      this.toasts.delete(key)
    }
    const host = $('toasts')
    host.appendChild(el)
    while (host.children.length > 2) host.firstElementChild?.remove()
    this.toasts.set(key, { el, title: b, label: title, count: 1, timer: window.setTimeout(() => el.remove(), ms) })
  }

  private frame(dt: number): void {
    this.afterEdit()
    const log = this.ws.sim.log
    while (this.logSeen < log.length) {
      const l = log[this.logSeen++]
      // the box keeps to the one sentence that says what went wrong in numbers; the whole advice is in the Inspector under Incidents
      const first = l.message.split(/(?<=[.!?])\s/)[0]
      this.toast(`${l.partName} burnt out`, first.length > 150 ? `${first.slice(0, 147).replace(/\s+\S*$/, '')}...` : first, false)
    }
    this.lessons.update(dt)
    this.uiAcc += dt
    if (this.uiAcc > 0.12) {
      this.uiAcc = 0
      this.inspector.update()
      const res = this.ws.sim.result
      $('status-right').textContent = res
        ? res.converged
          ? `${res.v.length - 1} nets, solved in ${res.iterations} iterations`
          : 'solver did not converge'
        : ''
    }
  }
}
