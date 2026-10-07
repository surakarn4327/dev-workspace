import { describe, expect, it } from 'vitest'
import { keyName } from './keys.ts'

describe('keyName', () => {
  it('reads letters from the physical key, so a Thai layout still gives latin letters', () => {
    expect(keyName({ key: 'แ', code: 'KeyC' })).toBe('c')
    expect(keyName({ key: 'ฟ', code: 'KeyA' })).toBe('a')
    expect(keyName({ key: 'Z', code: 'KeyZ' })).toBe('z')
  })

  it('reads the panel brackets from the physical key', () => {
    expect(keyName({ key: 'ฃ', code: 'BracketLeft' })).toBe('[')
    expect(keyName({ key: ']', code: 'BracketRight' })).toBe(']')
  })

  it('leaves other keys to e.key', () => {
    expect(keyName({ key: 'Delete', code: 'Delete' })).toBe('delete')
    expect(keyName({ key: 'Escape', code: 'Escape' })).toBe('escape')
  })
})
