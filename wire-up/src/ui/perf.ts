import type { HideKind } from '../render/renderer.ts'

// Frame meter: how long every frame takes and where the time goes, plus buttons that load a big test circuit.

export interface FrameSample {
  /** Time since the previous frame started (what the player feels). */
  gap: number
  /** Work inside the frame, in ms. */
  sim: number
  draw: number
  other: number
}

export interface MeterHooks {
  /** Load a test circuit with about this many parts (the player's own lab is kept safe). */
  bench: (parts: number) => void
  /** Give the player's own lab back. */
  back: () => void
  /** One line about the circuit on the board. */
  info: () => string
  /** Leave a kind of drawing out (or put it back) to measure what it costs. */
  hide: (what: HideKind, off: boolean) => void
  /** Use the saved picture of the board (on) or paint everything every frame (off). */
  cache: (on: boolean) => void
}

const WINDOW = 120 // frames the numbers are taken over
const SLOW_MS = 20 // a frame longer than this is a visible stutter

type Kind = HideKind
const KINDS: Kind[] = ['grid', 'parts', 'wires', 'bodies', 'caps', 'dots', 'selection']
/** What the automatic test leaves out, one run each. */
const RUNS: { name: string; off: Kind[] }[] = [
  { name: 'nothing hidden', off: [] },
  { name: 'grid hidden', off: ['grid'] },
  { name: 'parts hidden', off: ['parts'] },
  { name: 'wires hidden', off: ['wires'] },
  { name: 'wire bodies hidden', off: ['bodies'] },
  { name: 'wire caps hidden', off: ['caps'] },
  { name: 'dots hidden', off: ['dots'] },
  { name: 'selection hidden', off: ['selection'] },
  { name: 'only wire bodies', off: ['grid', 'parts', 'caps', 'dots'] },
  { name: 'only wire caps', off: ['grid', 'parts', 'bodies', 'dots'] },
  { name: 'only parts', off: ['grid', 'wires', 'dots'] },
  { name: 'everything hidden', off: ['grid', 'parts', 'wires', 'dots'] },
]
const SETTLE_MS = 600 // let the frames settle after a switch
const RUN_MS = 2000 // how long each run is measured

export class FrameMeter {
  private samples: FrameSample[] = []
  private root: HTMLElement
  private text: HTMLElement
  private hooks: MeterHooks
  private lastPaint = 0
  private on = false
  private hideButtons = new Map<Kind, HTMLButtonElement>()
  private cacheButton: HTMLButtonElement | null = null
  private cacheWas = true
  private result: HTMLElement
  /** The automatic test, while it is running. */
  private auto: { index: number; since: number; gaps: number[]; lines: string[] } | null = null

  constructor(root: HTMLElement, hooks: MeterHooks) {
    this.root = root
    this.hooks = hooks
    this.text = document.createElement('pre')
    root.appendChild(this.text)
    this.result = document.createElement('pre')
    this.result.style.color = 'var(--amber)'
    root.appendChild(this.result)
    const row = document.createElement('div')
    row.className = 'perf-row'
    for (const n of [250, 500, 1000]) row.appendChild(this.button(`${n}`, () => hooks.bench(n), `Load a test circuit with about ${n} parts`))
    row.appendChild(this.button('my lab', () => hooks.back(), 'Put your own lab back'))
    root.appendChild(row)
    const cut = document.createElement('div')
    cut.className = 'perf-row'
    cut.appendChild(this.label('hide:'))
    for (const what of KINDS) {
      const b = this.button(what, () => this.setHidden(what, !b.classList.contains('on')), `Leave out the ${what} and see what the frame time does`)
      this.hideButtons.set(what, b)
      cut.appendChild(b)
    }
    this.cacheButton = this.button('cache', () => this.setCache(!this.cacheButton?.classList.contains('on')), 'The saved picture of the board: on = copy it each frame, off = paint everything each frame')
    this.cacheButton.classList.add('on')
    cut.appendChild(this.cacheButton)
    cut.appendChild(this.button('measure all', () => this.startAuto(), 'Test every combination for a few seconds each (about 35 s) and list the frame times'))
    root.appendChild(cut)
  }

  private setCache(on: boolean): void {
    this.cacheButton?.classList.toggle('on', on)
    this.hooks.cache(on)
  }

  private setHidden(what: Kind, off: boolean): void {
    this.hideButtons.get(what)?.classList.toggle('on', off)
    this.hooks.hide(what, off)
  }

  private startAuto(): void {
    this.cacheWas = this.cacheButton?.classList.contains('on') ?? true
    this.setCache(false) // measure the cost of painting everything, not of copying the saved picture
    this.auto = { index: -1, since: 0, gaps: [], lines: [] }
    this.result.textContent = 'measuring... keep the mouse still'
  }

  /** Move the automatic test on: collect the frame gaps of the run in progress, then switch to the next run. */
  private stepAuto(gap: number, now: number): void {
    const a = this.auto!
    if (a.index >= 0 && now - a.since >= SETTLE_MS) a.gaps.push(gap)
    if (a.index >= 0 && now - a.since < SETTLE_MS + RUN_MS) return
    if (a.index >= 0) {
      const g = a.gaps.sort((x, y) => x - y)
      const avg = g.reduce((t, x) => t + x, 0) / Math.max(g.length, 1)
      a.lines.push(`${RUNS[a.index].name.padEnd(18)} ${avg.toFixed(1).padStart(5)} ms  ${(1000 / avg).toFixed(0).padStart(3)} fps`)
      this.result.textContent = a.lines.join('\n')
    }
    a.index++
    a.gaps = []
    a.since = now
    if (a.index >= RUNS.length) {
      for (const k of KINDS) this.setHidden(k, false)
      this.result.textContent = a.lines.join('\n')
      this.setCache(this.cacheWas)
      this.auto = null
      return
    }
    for (const k of KINDS) this.setHidden(k, RUNS[a.index].off.includes(k))
  }

  private label(text: string): HTMLElement {
    const s = document.createElement('span')
    s.textContent = text
    s.style.alignSelf = 'center'
    return s
  }

  get visible(): boolean {
    return this.on
  }

  setVisible(v: boolean): void {
    this.on = v
    this.root.hidden = !v
    this.samples = []
  }

  private button(label: string, fn: () => void, tip: string): HTMLButtonElement {
    const b = document.createElement('button')
    b.textContent = label
    b.title = tip
    b.onclick = fn
    return b
  }

  record(s: FrameSample, now: number): void {
    if (!this.on) return
    if (this.auto) this.stepAuto(s.gap, now)
    this.samples.push(s)
    if (this.samples.length > WINDOW) this.samples.shift()
    if (now - this.lastPaint < 250 || this.samples.length < 5) return
    this.lastPaint = now
    const n = this.samples.length
    const avg = (f: (x: FrameSample) => number): number => this.samples.reduce((a, x) => a + f(x), 0) / n
    const gaps = this.samples.map((x) => x.gap).sort((a, b) => a - b)
    const gap = avg((x) => x.gap)
    const slow = this.samples.filter((x) => x.gap > SLOW_MS).length
    const work = avg((x) => x.sim + x.draw + x.other)
    this.text.textContent = [
      `${(1000 / gap).toFixed(0)} fps   frame ${gap.toFixed(1)} ms   p95 ${gaps[Math.floor(n * 0.95)].toFixed(0)}   worst ${gaps[n - 1].toFixed(0)}`,
      `slow frames (>${SLOW_MS} ms): ${((100 * slow) / n).toFixed(0)}%`,
      `work ${work.toFixed(1)} ms = solve ${avg((x) => x.sim).toFixed(1)} + draw ${avg((x) => x.draw).toFixed(1)} + ui ${avg((x) => x.other).toFixed(1)}`,
      this.hooks.info(),
    ].join('\n')
  }
}
