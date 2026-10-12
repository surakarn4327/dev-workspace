import { describe, expect, it } from 'vitest'
import { compile } from '../mcu/compile.ts'
import { contrastLook, LCD_SKETCH } from './lcd.ts'

describe('LCD part', () => {
  it('the contrast screw: nothing at the bottom, text with a faint grid in the middle, a wash of dots at the top', () => {
    const low = contrastLook(0)
    expect(low.text).toBe(0)
    expect(low.grid).toBe(0)
    const mid = contrastLook(50)
    expect(mid.text).toBe(1)
    expect(mid.grid).toBeGreaterThan(0.9)
    expect(mid.wash).toBe(0)
    const high = contrastLook(100)
    expect(high.wash).toBe(1)
    // a few steps give a smooth change, not a jump
    expect(contrastLook(25).text).toBeGreaterThan(0.3)
    expect(contrastLook(25).text).toBeLessThan(0.6)
  })

  it('the example sketch compiles', () => {
    expect(() => compile(LCD_SKETCH)).not.toThrow()
  })
})
