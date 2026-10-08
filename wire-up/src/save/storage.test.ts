import { describe, expect, it } from 'vitest'
import { parseImport } from './storage.ts'

const file = (parts: unknown[], wires: unknown[] = [], counter = 1) => JSON.stringify({ version: 1, counter, parts, wires })
const part = (id: string, type: string, params: Record<string, unknown> = {}) => ({ id, type, x: 0, y: 0, rot: 0, params })

describe('importing an edited file', () => {
  it('puts a 0 ohm or negative resistor back to its default', () => {
    for (const value of [0, -5]) {
      const r = parseImport(file([part('p1', 'resistor', { value })]))
      expect(r.ok && r.lab.data.parts[0].params.value).toBe(330)
    }
  })

  it('clamps a slider value into its range and fixes a bad switch value', () => {
    const r = parseImport(file([part('p1', 'supply', { volts: 9999, limit: -3, on: 'yes' })]))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.lab.data.parts[0].params.volts).toBe(30)
      expect(r.lab.data.parts[0].params.limit).toBe(0.01)
      expect(r.lab.data.parts[0].params.on).toBe(true)
    }
  })

  it('rejects two wires with the same id', () => {
    const w = (y: number) => ({ id: 'w1', a: { x: 0, y }, b: { x: 20, y } })
    const r = parseImport(file([], [w(0), w(20)]))
    expect(r.ok).toBe(false)
  })

  it('keeps the id counter ahead of the ids in the file', () => {
    const r = parseImport(file([part('p5', 'resistor')], [{ id: 'w9', a: { x: 0, y: 0 }, b: { x: 20, y: 0 } }], 1))
    expect(r.ok && r.lab.data.counter).toBe(10)
  })
})
