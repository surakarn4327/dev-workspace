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
