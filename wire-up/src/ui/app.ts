import { World } from '../board/world.ts'
import type { WorldData } from '../board/world.ts'
import { SceneBuilder } from '../lessons/lessons.ts'
import { exportFile, loadLab, parseImport, saveLab } from '../save/storage.ts'
import { History } from '../save/history.ts'
import { Inspector } from './inspector.ts'
import { LessonPanel } from './lessonPanel.ts'
import { buildToolbox } from './toolbox.ts'
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
    if (saved) this.world.load(saved.data)
    else this.starterScene()
    this.ws = new Workspace(canvas, this.world)
    if (saved?.view) this.ws.view = saved.view
    else window.setTimeout(() => this.ws.fitView(), 80)

    this.inspector = new Inspector(this.ws, $('panel-inspect'))
    this.lessons = new LessonPanel(this.ws, $('panel-lessons'), {
      enter: (setup) => this.enterLesson(setup),
      exit: () => this.exitLesson(),
      toast: (t, b, good) => this.toast(t, b, good),
    })
    buildToolbox(this.ws, $('tool-tabs'), $('tool-items'))

    this.ws.onSelect = () => {
      this.inspector.rebuild()
      $('btn-wire').classList.toggle('on', this.ws.wireMode)
    }
    this.ws.onEdit = () => this.afterEdit()
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
        tabs.forEach((x) => x.classList.toggle('active', x === t))
        $('panel-inspect').hidden = t.dataset.tab !== 'inspect'
        $('panel-lessons').hidden = t.dataset.tab !== 'lessons'
      }
    })
  }

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
      $('toggle-right').textContent = right ? '‹' : '›'
      try {
        localStorage.setItem(key, JSON.stringify({ left, right }))
      } catch {
        // ignore
      }
    }
    this.togglePanel = (side) => {
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
    if (e.key === '[') this.togglePanel('left')
    else if (e.key === ']') this.togglePanel('right')
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) this.redo()
      else this.undo()
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault()
      this.redo()
    }
  }

  private restore(json: string | null): void {
    if (!json) return
    this.world.load(JSON.parse(json) as WorldData)
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

  toast(title: string, body: string, good: boolean): void {
    const el = document.createElement('div')
    el.className = `toast${good ? ' good' : ''}`
    const b = document.createElement('b')
    b.textContent = title
    el.appendChild(b)
    el.appendChild(document.createTextNode(body))
    el.onclick = () => el.remove()
    const host = $('toasts')
    host.appendChild(el)
    while (host.children.length > 3) host.firstElementChild?.remove()
    window.setTimeout(() => el.remove(), good ? 6000 : 16000)
  }

  private frame(dt: number): void {
    this.afterEdit()
    const log = this.ws.sim.log
    while (this.logSeen < log.length) {
      const l = log[this.logSeen++]
      this.toast(`${l.partName} burnt out`, l.message, false)
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
