import { LESSONS, makeCtx, SceneBuilder } from '../lessons/lessons.ts'
import type { Lesson } from '../lessons/lessons.ts'
import { loadProgress, saveProgress } from '../save/storage.ts'
import type { Workspace } from './workspace.ts'

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
}

export interface LessonHooks {
  /** Swap the lab for a lesson scene. Returns when the scene is in place. */
  enter(setup: (b: SceneBuilder) => void): void
  /** Restore the user's own lab. */
  exit(): void
  toast(title: string, body: string, good: boolean): void
}

export class LessonPanel {
  active: Lesson | null = null
  private done = loadProgress()
  private latched: boolean[] = []
  private memo: Record<string, number | boolean> = {}
  private shownHint = -1
  private acc = 0
  private completed = false

  private ws: Workspace
  private root: HTMLElement
  private hooks: LessonHooks

  constructor(ws: Workspace, root: HTMLElement, hooks: LessonHooks) {
    this.ws = ws
    this.root = root
    this.hooks = hooks
    this.renderList()
  }

  renderList(): void {
    this.root.innerHTML = '<h3>Missions</h3><div class="sub">Short guided builds. Each step is checked live against the real simulation.</div>'
    for (const l of LESSONS) {
      const card = document.createElement('div')
      card.className = `lesson-card${this.done.has(l.id) ? ' done' : ''}`
      card.innerHTML = `<div class="t">${esc(l.title)}</div><div class="d">${esc(l.tagline)}</div>`
      card.onclick = () => this.start(l)
      this.root.appendChild(card)
    }
  }

  start(l: Lesson): void {
    this.active = l
    this.latched = l.steps.map(() => false)
    this.memo = {}
    this.shownHint = -1
    this.completed = false
    this.hooks.enter((b) => l.setup(b))
    this.renderMission()
  }

  exit(): void {
    if (!this.active) return
    this.active = null
    this.hooks.exit()
    this.renderList()
  }

  private renderMission(): void {
    const l = this.active
    if (!l) return
    this.root.innerHTML = ''
    const head = document.createElement('div')
    head.innerHTML = `<h3>${esc(l.title)}</h3><div class="sub">${esc(l.story)}</div>`
    this.root.appendChild(head)
    if (this.completed) {
      const b = document.createElement('div')
      b.className = 'banner'
      b.textContent = 'Mission complete! You can keep experimenting on this board.'
      this.root.appendChild(b)
    }
    const ul = document.createElement('ul')
    ul.className = 'steps'
    const firstOpen = this.latched.findIndex((x) => !x)
    l.steps.forEach((s, i) => {
      const li = document.createElement('li')
      li.className = this.latched[i] ? 'done' : ''
      li.innerHTML = `<span class="box">${this.latched[i] ? '[x]' : '[ ]'}</span><span>${esc(s.text)}</span>`
      if (i === firstOpen && this.shownHint === i) {
        const h = document.createElement('div')
        h.className = 'hint'
        h.textContent = `Hint: ${s.hint}`
        li.appendChild(h)
      }
      ul.appendChild(li)
    })
    this.root.appendChild(ul)
    const row = document.createElement('div')
    row.className = 'row'
    const hint = document.createElement('button')
    hint.textContent = 'Show hint'
    hint.disabled = firstOpen < 0
    hint.onclick = () => {
      this.shownHint = firstOpen
      this.renderMission()
    }
    const reset = document.createElement('button')
    reset.textContent = 'Reset board'
    reset.onclick = () => this.start(l)
    const exit = document.createElement('button')
    exit.textContent = 'Back to my lab'
    exit.onclick = () => this.exit()
    row.append(hint, reset, exit)
    if (this.completed) {
      const idx = LESSONS.indexOf(l)
      const next = LESSONS[idx + 1]
      if (next) {
        const n = document.createElement('button')
        n.textContent = 'Next mission'
        n.className = 'on'
        n.onclick = () => this.start(next)
        row.appendChild(n)
      }
    }
    this.root.appendChild(row)
  }

  /** Called every frame; checks run a few times a second. */
  update(dt: number): void {
    const l = this.active
    if (!l) return
    this.acc += dt
    if (this.acc < 0.2) return
    this.acc = 0
    const ctx = makeCtx(this.ws.world, this.ws.sim, this.memo)
    let changed = false
    l.steps.forEach((s, i) => {
      if (this.latched[i]) return
      let ok = false
      try {
        ok = s.check(ctx)
      } catch {
        ok = false
      }
      if (ok) {
        this.latched[i] = true
        changed = true
      }
    })
    if (changed) {
      if (this.latched.every(Boolean) && !this.completed) {
        this.completed = true
        this.done.add(l.id)
        saveProgress(this.done)
        this.hooks.toast('Mission complete', l.title, true)
      }
      this.renderMission()
    }
  }
}
