// Auto-save in the browser plus export/import of plain JSON files. No accounts, no server.

import { validateWorldData } from '../board/world.ts'
import type { WorldData } from '../board/world.ts'
import { KNOWN_TYPES, sanitizeParams } from '../parts/index.ts'
import type { View } from '../render/renderer.ts'

const LAB_KEY = 'wire-up:lab:v1'
const PROGRESS_KEY = 'wire-up:progress:v1'

export interface SavedLab {
  data: WorldData
  view: View | null
}

/** 2 = the toolbox floats over the canvas, so a saved view is measured from the window edge. Older saves (no marker) were measured from beside the toolbox, so their view is dropped and the board is fitted instead. */
const VIEW_LAYOUT = 2

function isView(v: unknown): v is View {
  const o = v as View
  return typeof o === 'object' && o !== null && Number.isFinite(o.camX) && Number.isFinite(o.camY) && Number.isFinite(o.zoom) && o.zoom > 0
}

export function saveLab(data: WorldData, view: View): boolean {
  try {
    localStorage.setItem(LAB_KEY, JSON.stringify({ app: 'wire-up', data, view, layout: VIEW_LAYOUT }))
    return true
  } catch {
    return false
  }
}

export function loadLab(): SavedLab | null {
  try {
    const raw = localStorage.getItem(LAB_KEY)
    if (!raw) return null
    return parseSave(JSON.parse(raw))
  } catch {
    return null
  }
}

/** Accepts both the autosave wrapper and a bare exported file. */
export function parseSave(raw: unknown): SavedLab | null {
  const o = raw as { data?: unknown; view?: unknown; version?: unknown; layout?: unknown }
  const body = o && typeof o === 'object' && 'data' in o ? o.data : raw
  const data = validateWorldData(body, KNOWN_TYPES)
  if (typeof data === 'string') return null
  sanitizeParams(data.parts)
  return { data, view: o?.layout === VIEW_LAYOUT && isView(o?.view) ? o.view : null }
}

export function parseImport(text: string): { ok: true; lab: SavedLab } | { ok: false; error: string } {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' }
  }
  const o = json as { data?: unknown; view?: unknown }
  const body = o && typeof o === 'object' && 'data' in o ? o.data : json
  const data = validateWorldData(body, KNOWN_TYPES)
  if (typeof data === 'string') return { ok: false, error: data }
  sanitizeParams(data.parts)
  return { ok: true, lab: { data, view: isView(o?.view) ? o.view : null } }
}

export function exportFile(data: WorldData, name = 'wire-up-lab'): void {
  const blob = new Blob([JSON.stringify({ app: 'wire-up', data }, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function loadProgress(): Set<string> {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

export function saveProgress(done: Set<string>): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify([...done]))
  } catch {
    // storage unavailable: progress simply is not remembered
  }
}
