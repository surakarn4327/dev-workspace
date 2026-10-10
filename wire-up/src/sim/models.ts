// Device physics helpers shared by parts and tests. Pure numbers, no DOM.

import { VT } from './solver.ts'
export { TIMER as NE555, RELAY } from './solver.ts'

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
/** Logic gate (no supply pins): fixed 5 V logic high, switches at 1.4 V, output behind 60 ohm, 25 mA out, inputs up to 7 V, each input pulled to 0 V by 1 Mohm (an unconnected input reads low). */
export const GATE = { vh: 5, vth: 1.4, w: 0.12, rout: 60, rpull: 1e6 }
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

/**
 * 74HC CMOS logic chips (DIP-14). Datasheet absolute maximums: supply 7 V (works 2-6 V), 25 mA per output pin, 50 mA through
 * VCC / GND. Inputs switch at half the supply and draw no current; `rLeak` keeps an unpowered chip solvable.
 */
export const HC = { rout: 50, w: 0.15, vccMax: 7, iOutMax: 0.025, iSupplyMax: 0.05, iClampMax: 0.02, rLeak: 1e7, rIn: 1e8, diodeIs: 1e-14, rFloat: 1e6 }

/** Standard capacitor values, in farads: E6 from 1 nF to 1 uF (ceramic disc) and from 1 uF to 4700 uF (electrolytic). */
const E6 = [1.0, 1.5, 2.2, 3.3, 4.7, 6.8]
const rnd = (x: number): number => Number(x.toPrecision(3))
export const CERAMIC_CAP_VALUES: number[] = [...[1e-9, 1e-8, 1e-7].flatMap((d) => E6.map((m) => rnd(m * d))), 1e-6]
export const ELECTRO_CAP_VALUES: number[] = [...[1e-6, 1e-5, 1e-4].flatMap((d) => E6.map((m) => rnd(m * d))), ...[1e-3, 2.2e-3, 4.7e-3]]
/** Ratings: the ceramic disc takes 50 V either way round; the electrolytic 16 V the right way round and about 1 V backwards. Series resistance (ESR) in ohm. */
export const CAP = { ceramicVmax: 50, electroVmax: 16, electroVrev: 1, ceramicEsr: 0.1, electroEsr: 0.5 }

export function fmtFarads(f: number): string {
  if (f >= 1e-3) return `${Number((f * 1e3).toPrecision(3))}m`
  if (f >= 1e-6) return `${Number((f * 1e6).toPrecision(3))}u`
  if (f >= 1e-9) return `${Number((f * 1e9).toPrecision(3))}n`
  return `${Number((f * 1e12).toPrecision(3))}p`
}

/** The three-digit EIA code printed on a ceramic capacitor: 100 nF = "104" (10, then four zeros, in pF); below 100 pF the plain number. */
export function eiaCode(farads: number): string {
  const pf = farads * 1e12
  if (pf < 100) return String(Math.round(pf))
  let e = Math.floor(Math.log10(pf)) - 1
  let sig = Math.round(pf / 10 ** e)
  if (sig >= 100) {
    sig = 10
    e += 1
  }
  return `${sig}${e}`
}
