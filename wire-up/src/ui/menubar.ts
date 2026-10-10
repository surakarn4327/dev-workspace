import { icon } from './icons.ts'
import type { IconName } from './icons.ts'

export interface MenuItem {
  icon: IconName
  label: string
  /** Shortcut text shown on the right (display only; the key handlers live elsewhere). */
  key?: string
  run: () => void
}

/** A title that opens a drop-down of rarely used commands. */
export interface Menu {
  kind: 'menu'
  label: string
  icon: IconName
  items: MenuItem[]
}

/** A frequently used command that sits right on the bar. */
export interface Action {
  kind: 'action'
  label: () => string
  icon: () => IconName
  /** Tooltip. */
  tip: string
  run: () => void
  enabled?: () => boolean
  /** The button glows while this is true (a mode is on). */
  active?: () => boolean
  danger?: boolean
}

/** '|' draws a divider between groups. */
export type BarEntry = Menu | Action | '|'

/** Row of icon-over-caption buttons: plain actions, and titles that open a drop-down. */
export class MenuBar {
  private open: HTMLElement | null = null
  private root: HTMLElement
  private actions: { el: HTMLButtonElement; a: Action }[] = []

  constructor(root: HTMLElement, entries: BarEntry[]) {
    this.root = root
    for (const e of entries) {
      if (e === '|') {
        const sep = document.createElement('div')
        sep.className = 'bar-sep'
        root.appendChild(sep)
      } else if (e.kind === 'menu') root.appendChild(this.menu(e))
      else {
        const b = document.createElement('button')
        b.className = 'menu-title' + (e.danger ? ' danger' : '')
        b.title = e.tip
        b.onclick = () => {
          this.close()
          e.run()
          this.refresh()
        }
        root.appendChild(b)
        this.actions.push({ el: b, a: e })
      }
    }
    document.addEventListener('pointerdown', (ev) => {
      if (this.open && !this.root.contains(ev.target as Node)) this.close()
    })
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') this.close()
    })
    window.addEventListener('blur', () => this.close())
    this.refresh()
  }

  /** Re-read labels, greyed-out and glowing state of the action buttons. */
  refresh(): void {
    for (const { el, a } of this.actions) {
      const html = `${icon(a.icon())}<span>${a.label()}</span>`
      if (el.innerHTML !== html) el.innerHTML = html
      el.disabled = a.enabled ? !a.enabled() : false
      el.classList.toggle('on', a.active?.() === true)
    }
  }

  private menu(m: Menu): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'menu'
    const title = document.createElement('button')
    title.className = 'menu-title'
    title.innerHTML = `${icon(m.icon)}<span>${m.label}</span>`
    const drop = document.createElement('div')
    drop.className = 'menu-drop'
    drop.hidden = true
    for (const it of m.items) {
      const b = document.createElement('button')
      b.className = 'menu-item'
      b.innerHTML = `${icon(it.icon)}<span class="lbl">${it.label}</span><kbd>${it.key ?? ''}</kbd>`
      b.onclick = () => {
        this.close()
        it.run()
        this.refresh()
      }
      drop.appendChild(b)
    }
    title.onclick = () => {
      const was = this.open === wrap
      this.close()
      if (!was) {
        drop.hidden = false
        title.classList.add('on')
        this.open = wrap
      }
    }
    title.onmouseenter = () => {
      if (this.open && this.open !== wrap) title.click()
    }
    wrap.append(title, drop)
    return wrap
  }

  private close(): void {
    if (!this.open) return
    this.open.querySelector<HTMLElement>('.menu-drop')!.hidden = true
    this.open.querySelector('.menu-title')!.classList.remove('on')
    this.open = null
  }
}
