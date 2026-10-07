// Device physics helpers shared by parts and tests. Pure numbers, no DOM.

import { VT } from './solver.ts'

export const E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2]

/** All standard E12 values from 1 ohm to 10 Mohm. */
export const RESISTOR_VALUES: number[] = (() => {
  const out: number[] = []
  for (let dec = 0; dec <= 6; dec++) for (const m of E12) out.push(Math.round(m * 10 ** dec * 10) / 10)
  out.push(1e7)
  return out
})()

export const BAND_COLORS = [
  '#0b0b0b', // black
  '#7a3b12', // brown
  '#d62020', // red
  '#f08a1c', // orange
  '#f2d21b', // yellow
  '#2ea043', // green
  '#2f6fe0', // blue
  '#8a45d6', // violet
  '#8a8a8a', // grey
  '#f2f2f2', // white
]
export const BAND_GOLD = '#cfa73a'
export const BAND_SILVER = '#b8bcc4'
export const BAND_NAMES = ['black', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'violet', 'grey', 'white']

/** Four-band colour code: digit, digit, multiplier. Tolerance band is always gold (5%). */
export function resistorBands(ohms: number): string[] {
  let v = Math.max(ohms, 1)
  let mult = 0
  if (v < 10) {
    // values below 10 ohm use gold/silver multipliers
    const two = Math.round(v * 10)
    const d1 = Math.floor(two / 10)
    const d2 = two % 10
    return [BAND_COLORS[d1], BAND_COLORS[d2], BAND_GOLD, BAND_GOLD]
  }
  while (v >= 100) {
    v /= 10
    mult++
  }
  const two = Math.round(v)
  const d1 = Math.floor(two / 10)
  const d2 = two % 10
  return [BAND_COLORS[d1], BAND_COLORS[d2], BAND_COLORS[Math.min(mult, 9)], BAND_GOLD]
}

export interface LedColor {
  name: string
  /** Forward voltage at 10 mA. */
  vf10: number
  body: string
  glow: string
}

export const LED_COLORS: Record<string, LedColor> = {
  red: { name: 'Red', vf10: 1.85, body: '#ff3b3b', glow: '#ff2a2a' },
  yellow: { name: 'Yellow', vf10: 2.0, body: '#ffd83b', glow: '#ffd21f' },
  green: { name: 'Green', vf10: 2.1, body: '#3bff6a', glow: '#2dff62' },
  blue: { name: 'Blue', vf10: 3.0, body: '#3b8bff', glow: '#2f7cff' },
  white: { name: 'White', vf10: 3.1, body: '#f2f6ff', glow: '#dfe9ff' },
}

export const LED_N = 2
export const LED_RS = 4 // ohm, bond wire + bulk
export const LED_I_RATED = 0.02
export const LED_I_MAX = 0.03
export const LED_VR_MAX = 5

export function ledIs(vf10: number): number {
  return 0.01 / Math.exp(vf10 / (LED_N * VT))
}

export const DIODE = { is: 1e-8, n: 1.8, rs: 0.04, iMax: 1, vrMax: 1000 }
export const BJT = { is: 1e-14, bf: 200, br: 5, icMax: 0.1, pdMax: 0.5, vceMax: 45, vebMax: 6 }

export const BATTERY_TYPES: Record<string, { r: number; iMax: number; label: string }> = {
  '1.5': { r: 0.15, iMax: 2, label: '1.5 V (AA)' },
  '3': { r: 0.3, iMax: 2, label: '3 V (2xAA)' },
  '4.5': { r: 0.45, iMax: 2, label: '4.5 V (3xAA)' },
  '9': { r: 1.5, iMax: 0.5, label: '9 V (PP3)' },
}

export function ldrResistance(lux: number): number {
  const r = 15000 * (10 / Math.max(lux, 0.01)) ** 0.7
  return Math.min(Math.max(r, 80), 2e6)
}

export function ntcResistance(tempC: number): number {
  const t = tempC + 273.15
  return 10000 * Math.exp(3950 * (1 / t - 1 / 298.15))
}

/** Engineering notation with unit, e.g. 4700 -> "4.70 k", 0.0123 -> "12.3 m". */
export function eng(value: number, unit: string, digits = 3): string {
  if (!Number.isFinite(value)) return `-- ${unit}`
  const a = Math.abs(value)
  if (a === 0) return `0 ${unit}`
  const steps: [number, string][] = [
    [1e9, 'G'],
    [1e6, 'M'],
    [1e3, 'k'],
    [1, ''],
    [1e-3, 'm'],
    [1e-6, 'u'],
    [1e-9, 'n'],
  ]
  for (const [f, p] of steps) {
    if (a >= f * 0.9995) {
      const x = value / f
      const dec = Math.max(0, digits - 1 - Math.floor(Math.log10(Math.abs(x))))
      return `${x.toFixed(Math.min(dec, 4))} ${p}${unit}`
    }
  }
  return `${(value * 1e9).toFixed(1)} n${unit}`
}

export function fmtOhms(r: number): string {
  if (r >= 1e6) return `${trim(r / 1e6)}M`
  if (r >= 1e3) return `${trim(r / 1e3)}k`
  return trim(r)
}

function trim(x: number): string {
  return Number(x.toFixed(2)).toString()
}
