// Dev-only parts gallery (open /gallery.html while `npm run dev` runs). Draws every part in ALL_PARTS with its real draw()
// and pin labels at all four rotations, in pixel or vector look, with its status from style.md 1.3. Used for look review
// (compare against the reference image, show the user) and to run the label-gap check. See PARTS.md.

import './style.css'
import { Renderer } from './render/renderer.ts'
import { scene } from './render/scene.ts'
import { ALL_PARTS, newPart } from './parts/index.ts'
import type { PartDef } from './parts/types.ts'
import styleMd from '../style.md?raw'

const KMAX = 3
const CELL = 300

void document.fonts.load('16px Silver').catch(() => {})

const status = new Map<string, string>()
for (const line of styleMd.split('\n')) {
  const m = line.match(/^\|\s*`([a-z0-9.-]+)`\s*\|\s*(approved|draft)\s*\|/)
  if (m) status.set(m[1], m[2])
}

// drawPinLabels is private: borrow it the same way scripts/label-gap-harness.js does
function labelPainter(ctx: CanvasRenderingContext2D): { drawPinLabels(p: ReturnType<typeof newPart>): void; pixelMode: boolean } {
  const fake = Object.create(Renderer.prototype) as { ctx: CanvasRenderingContext2D; pixelMode: boolean; drawPinLabels(p: ReturnType<typeof newPart>): void }
  fake.ctx = ctx
  return fake
}

function drawCell(cv: HTMLCanvasElement, def: PartDef, rot: number): void {
  cv.width = CELL
  cv.height = CELL
  const c = cv.getContext('2d')!
  c.fillStyle = '#23232b'
  c.fillRect(0, 0, CELL, CELL)
  const part = newPart('g', def.type, 0, 0)
  part.rot = rot as 0 | 1 | 2 | 3
  scene.labeled = new Set([part.id])
  // fit the part (any rotation) in the cell, centred on its hit box
  const b = def.bounds(part)
  const K = Math.min(KMAX, (CELL - 100) / Math.max(b.w, b.h))
  const cx = b.x + b.w / 2
  const cy = b.y + b.h / 2
  const turned = rot % 2 === 1
  const mid = turned ? { x: -cy, y: cx } : { x: cx, y: cy }
  const o = rot === 2 ? { x: -cx, y: -cy } : rot === 3 ? { x: cy, y: -cx } : mid
  c.setTransform(K, 0, 0, K, CELL / 2 - o.x * K, CELL / 2 - o.y * K)
  c.save()
  c.translate(part.x, part.y)
  c.rotate((part.rot * Math.PI) / 2)
  def.draw(c, part, {}, 0)
  c.restore()
  const painter = labelPainter(c)
  painter.pixelMode = scene.pixel
  painter.drawPinLabels(part)
  c.setTransform(1, 0, 0, 1, 0, 0)
  c.fillStyle = '#6a6a7c'
  c.font = '11px Consolas, monospace'
  c.fillText(`rot ${rot * 90}`, 6, 14)
}

const list = document.getElementById('list')!
const cells: [HTMLCanvasElement, PartDef, number][] = []

for (const def of ALL_PARTS) {
  const box = document.createElement('section')
  box.className = 'part'
  const st = status.get(def.type) ?? 'missing'
  box.innerHTML = `<h2>${def.name} <span class="badge ${st}">${st}</span></h2><p>${def.type} · ${def.category} · ${def.blurb}</p><div class="row"></div>`
  const row = box.querySelector('.row')!
  for (let rot = 0; rot < 4; rot++) {
    const cv = document.createElement('canvas')
    row.appendChild(cv)
    cells.push([cv, def, rot])
  }
  list.appendChild(box)
}

function redraw(): void {
  for (const [cv, def, rot] of cells) drawCell(cv, def, rot)
}

// the canvas text needs the pixel font: draw again when it has loaded
redraw()
void document.fonts.ready.then(redraw)

document.getElementById('mode')!.addEventListener('click', (e) => {
  scene.pixel = !scene.pixel
  ;(e.target as HTMLButtonElement).textContent = `Look: ${scene.pixel ? 'pixel' : 'vector'}`
  redraw()
})

document.getElementById('check')!.addEventListener('click', async () => {
  const out = document.getElementById('summary')!
  out.textContent = 'checking...'
  const url = '/scripts/label-gap-harness.js'
  const harness = (await import(/* @vite-ignore */ url)) as { harness(o?: object): Promise<Record<string, string>> }
  const result = await harness.harness()
  // every number in the pixel rows must be the standard gap of 4, except what style.md 3.5 records as known (push button turned 90/270 alternates 4 and 6)
  const known = new Set(['pixel button'])
  const bad = Object.entries(result).filter(([k, v]) => k.startsWith('pixel') && !known.has(k) && v.split('!!')[0].split(/[ |]+/).some((t) => t !== '' && t !== '4'))
  out.textContent = bad.length === 0 ? 'pixel look: every label gap is 4' : `${bad.length} part(s) off 4 in pixel look`
  out.className = bad.length === 0 ? '' : 'bad'
  const pre = document.createElement('pre')
  pre.textContent = Object.entries(result).map(([k, v]) => `${k}: ${v}`).join('\n')
  document.querySelector('main')!.prepend(pre)
  scene.pixel = true
  redraw()
})
