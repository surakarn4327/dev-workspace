import type { PartInstance } from '../board/world.ts'
import type { Stress } from './types.ts'

export const U = 20

export function eid(p: PartInstance, suffix: string): string {
  return `${p.id}:${suffix}`
}

export function stress(ratio: number, reason: () => string): Stress {
  return { ratio, reason }
}

export function num(p: PartInstance, key: string, fallback = 0): number {
  const v = p.params[key]
  return typeof v === 'number' ? v : fallback
}

export function str(p: PartInstance, key: string, fallback = ''): string {
  const v = p.params[key]
  return typeof v === 'string' ? v : fallback
}

export function flag(p: PartInstance, key: string): boolean {
  return p.params[key] === true
}

/**
 * Leg length shown to the user as 1-5. For parts whose legs hang down (LED, transistors, pot, LDR, NTC) the
 * value is the number of holes the legs reach: 1 = 2 holes, so the pins sit `legs` grid steps below the body.
 * A part without the param (an old save) or with 0 keeps the original short legs (pins on the body's row).
 */
export function legGrid(p: PartInstance): number {
  const v = p.params.legs
  return typeof v === 'number' ? Math.max(0, Math.min(5, Math.round(v))) : 0
}

/** The same in world px: how far below its body the part's pins sit. */
export function legDrop(p: PartInstance): number {
  return legGrid(p) * U
}

/** Pin spacing in holes of the axial parts (resistor, diode): shown as leg length 1-5, 1 = 3 holes apart. */
export function spreadOf(p: PartInstance): number {
  const v = p.params.legs
  return typeof v === 'number' ? Math.round(v) + 2 : 4
}

export const LEG_FIELD = { kind: 'range', key: 'legs', label: 'Leg length', min: 1, max: 5, step: 1 } as const
