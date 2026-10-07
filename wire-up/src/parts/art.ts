// Pixel-art sprites for the parts that have been redrawn by hand. One art pixel = PX (2) world px.
// Each builder returns a cached bitmap; moving details (pointers, lamps) are drawn on top by the part.

import { mix } from '../render/draw.ts'
import { PixelGrid, sprite } from '../render/pixel.ts'
import type { Sprite } from '../render/pixel.ts'

const CYAN = '#38f9ff'

// ---------------------------------------------------------------- resistor

/** Cylinder shading: one tone per row, light from the top left. */
const BODY_TONES = ['h', 'L', 'L', 'T', 'T', 'M', 'S', 'S', 'D']

/** 24 x 11 art pixels: dog-bone body with a shaded cylinder, specular dots and four colour bands. */
export function resistorSprite(bands: string[]): Sprite {
  return sprite(`resistor:${bands.join(',')}`, () => {
    const g = new PixelGrid(24, 11)
    // end caps are the full height, the middle is two rows slimmer
    g.rect(0, 0, 6, 11, 'T')
    g.rect(18, 0, 6, 11, 'T')
    g.rect(6, 1, 12, 9, 'T')
    g.round(2)
    // tone each column by row
    for (let y = 0; y < 11; y++) {
      const capTone = y === 0 ? 'h' : y === 1 ? 'L' : y === 2 ? 'L' : y <= 4 ? 'T' : y <= 6 ? 'M' : y <= 8 ? 'S' : 'D'
      for (let x = 0; x < 24; x++) {
        if (g.get(x, y) === '.') continue
        const inCap = x < 6 || x >= 18
        g.set(x, y, inCap ? capTone : (BODY_TONES[y - 1] ?? 'D'))
      }
    }
    // bands (top pixel lighter, bottom two darker)
    const cols = [7, 10, 13, 18]
    const widths = [2, 2, 2, 2]
    cols.forEach((x0, i) => {
      for (let y = 1; y <= 9; y++) {
        const tone = y === 1 ? 'abcd'[i].toUpperCase() : y >= 8 ? 'efgh'[i] : 'abcd'[i]
        for (let dx = 0; dx < widths[i]; dx++) g.set(x0 + dx, y, tone)
      }
    })
    // the fourth band sits on the right end cap: keep the cap round
    g.set(2, 2, 'w')
    g.set(3, 2, 'h')
    g.set(19, 2, 'w')
    const pal: Record<string, string> = {
      h: '#fff1c8',
      L: '#f1dba4',
      T: '#d9b878',
      M: '#c4a064',
      S: '#a6814a',
      D: '#80602f',
      w: '#ffffff',
    }
    bands.forEach((col, i) => {
      pal['abcd'[i]] = col
      pal['abcd'[i].toUpperCase()] = mix(col, '#ffffff', 0.35)
      pal['efgh'[i]] = mix(col, '#000000', 0.38)
    })
    return g.build(pal, '#47301a')
  })
}

// ---------------------------------------------------------------- battery

export interface BatteryArt {
  sprite: Sprite
  /** Grid cell (0, 0) sits this far above the part origin, in world px (terminals poke out of the top). */
  lift: number
}

/** Art size in pixels of the case for each battery type: [width, height]. */
export function batteryArtSize(volts: string): [number, number] {
  switch (volts) {
    case '1.5':
      return [22, 70]
    case '3':
      return [40, 70]
    case '4.5':
      return [58, 70]
    default:
      return [36, 64]
  }
}

export function batterySprite(volts: string, anchorsArt: [number, number]): BatteryArt {
  const [w, h] = batteryArtSize(volts)
  const top = 4
  const s = sprite(`battery:${volts}`, () => {
    const g = new PixelGrid(w, h + top)
    // case: rounded, lit on the left and top, darker on the right
    g.rrect(0, top, w, h, 4, 'K')
    g.paint(1, top + 1, 1, h - 2, 'k', 'K')
    g.paint(1, top, w - 2, 1, 'k', 'K')
    g.paint(w - 3, top + 1, 2, h - 2, 'q', 'K')
    // terminals: metal studs with a bright top row
    anchorsArt.forEach((ax, i) => {
      g.rect(ax - 2, 0, 4, top + 1, 'M')
      g.rect(ax - 2, 0, 4, 1, 'm')
      g.rect(ax + 1, 1, 1, top, 'n')
      if (i === 0) g.set(ax - 2, 0, '.')
    })
    if (volts === '9') {
      // silver label sits in a thin groove: dark ring, then rounded silver with shading that follows its shape
      g.rrect(1, top + 7, w - 2, h - 10, 5, 'u')
      g.rrect(2, top + 8, w - 4, h - 12, 4, 'W')
      g.paint(2, top + 8, 2, h - 12, 'X', 'W')
      g.paint(w - 6, top + 8, 4, h - 12, 'V', 'W')
      g.paint(w - 4, top + 8, 2, h - 12, 'U', 'WV')
      g.paint(2, top + h - 6, w - 4, 2, 'U', 'WVX')
      // amber band: inset from the groove so it reads as a printed stripe, with lit top and shaded bottom
      g.rrect(3, top + 26, w - 6, 13, 3, 'Y')
      g.paint(3, top + 26, w - 6, 1, 'l', 'Y')
      g.paint(3, top + 27, 2, 9, 'Z', 'Y')
      g.paint(w - 6, top + 27, 3, 9, 'y', 'Y')
      g.paint(3, top + 36, w - 6, 3, 'y', 'YZ')
      g.paint(3, top + 38, w - 6, 1, 'j', 'y')
      for (let i = 0; i < 3; i++) g.set(w / 2 - 3 + i * 3, top + h - 10, 'U')
    } else {
      const cells = volts === '1.5' ? 1 : volts === '3' ? 2 : 3
      for (let k = 0; k < cells; k++) {
        const x0 = 3 + k * 18
        g.rrect(x0 - 1, top + 5, 18, h - 8, 5, 'u')
        g.rrect(x0, top + 6, 16, h - 10, 4, 'Y')
        g.paint(x0, top + 6, 3, h - 10, 'l', 'Y')
        g.paint(x0 + 3, top + 6, 2, h - 10, 'Z', 'Y')
        g.paint(x0 + 11, top + 6, 5, h - 10, 'y', 'Y')
        g.paint(x0 + 14, top + 6, 2, h - 10, 'j', 'Yy')
        g.paint(x0, top + h - 9, 16, 3, 'j', 'Yyl')
        g.rect(x0, top + 22, 16, 13, 'K')
        g.rect(x0, top + 22, 16, 1, 'q')
        g.rect(x0 + 7, top + 25, 2, 6, 'w')
        g.rect(x0 + 5, top + 27, 6, 2, 'w')
      }
    }
    return g.build(
      {
        K: '#25252e',
        k: '#4a4a58',
        q: '#15151b',
        u: '#6b7280',
        M: '#b9c0cc',
        m: '#f1f4f9',
        n: '#7b8392',
        W: '#c9ced8',
        X: '#eef1f6',
        V: '#a2a9b6',
        U: '#7e8594',
        Y: '#e4a824',
        y: '#b97f12',
        l: '#ffd566',
        Z: '#f3bd3c',
        j: '#8a5c0a',
        w: '#ff4a58',
      },
      '#0d0c14',
    )
  })
  return { sprite: s, lift: top * 2 }
}

// ---------------------------------------------------------------- multimeter

/** 60 x 95 art pixels. The needle, display text and labels are drawn on top. */
export function meterSprite(): Sprite {
  return sprite('meter', () => {
    const g = new PixelGrid(60, 95)
    g.rect(0, 0, 60, 95, 'Y')
    g.round(3)
    g.rect(2, 2, 56, 91, 'P')
    g.rect(3, 1, 54, 1, 'L')
    g.rect(3, 93, 54, 1, 'S')
    g.rect(5, 5, 50, 25, 'K')
    g.rect(6, 6, 48, 23, 'G')
    g.disc(30, 56, 19, 'D')
    g.disc(30, 56, 12, 'E')
    g.disc(17, 88, 4.6, 'M')
    g.disc(17, 88, 3.4, 'R')
    g.disc(43, 88, 4.6, 'M')
    g.disc(43, 88, 3.4, 'N')
    return g.build(
      { Y: '#f0b02a', P: '#cf9012', L: '#ffd96a', S: '#9a6a08', K: '#07080c', G: '#0b1a10', D: '#17181f', E: '#2a2c36', M: '#c9ced6', R: '#ff3b4a', N: '#15151a' },
      CYAN,
    )
  })
}

// ---------------------------------------------------------------- bench supply

/** 80 x 50 art pixels. Knob needles, output button, CC lamp and the readout are drawn on top. */
export function supplySprite(): Sprite {
  return sprite('supply', () => {
    const g = new PixelGrid(80, 50)
    g.rect(0, 0, 80, 50, 'B')
    g.round(3)
    g.rect(2, 0, 76, 1, 'b')
    g.rect(5, 5, 48, 23, 'k')
    g.rect(6, 6, 46, 21, 'G')
    g.disc(64, 9, 6.2, 'R')
    g.disc(64, 9, 4.9, 'D')
    g.disc(64, 24, 6.2, 'R')
    g.disc(64, 24, 4.9, 'D')
    g.disc(50, 40, 4.4, 'M')
    g.disc(50, 40, 3.4, 'P')
    g.disc(50, 40, 1.4, 'N')
    g.disc(70, 40, 4.4, 'M')
    g.disc(70, 40, 3.4, 'Q')
    g.disc(70, 40, 1.4, 'N')
    return g.build(
      { B: '#2e3446', b: '#434c68', k: '#0a0c12', G: '#03140a', D: '#12141c', R: '#59607a', M: '#c9ced6', P: '#ff3b4a', Q: '#1c1c20', N: '#0b0b0e' },
      CYAN,
    )
  })
}
