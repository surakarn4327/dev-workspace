// Pixel-art sprites for the parts that have been redrawn by hand. One art pixel = PX (2) world px.
// Each builder returns a cached bitmap; moving details (pointers, lamps) are drawn on top by the part.

import { mix } from '../render/draw.ts'
import { PixelGrid, sprite } from '../render/pixel.ts'
import type { Sprite } from '../render/pixel.ts'


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

// ---------------------------------------------------------------- breadboard

/** Art-pixel offset of hole (col, row) top-left inside the board sprite; holes are 4 x 4, 10 art px apart. */
export const BB_HOLE = 4

/**
 * Cream plastic slab: lit top and left edges, shaded right and bottom, a recessed centre channel, red/blue
 * rail stripes and empty square holes. Labels and "used" hole plugs are drawn on top by the part.
 * Sprite cell (0, 0) sits at world (-G, -G).
 */
export function breadboardSprite(cols: number, holeRows: number[]): Sprite {
  return sprite(`breadboard:${cols}`, () => {
    const w = (cols + 1) * 10
    const h = 190
    const g = new PixelGrid(w, h)
    g.rrect(0, 0, w, h, 4, 'B')
    // bevel: light from the top left, shade on the right and bottom
    g.paint(0, 0, w, 1, 'h', 'B')
    g.paint(0, 1, w, 1, 'L', 'B')
    g.paint(0, 0, 1, h, 'h', 'BL')
    g.paint(1, 2, 1, h - 4, 'L', 'B')
    g.paint(w - 2, 0, 2, h, 'S', 'BL')
    g.paint(w - 1, 0, 1, h, 'D', 'S')
    g.paint(0, h - 3, w, 3, 'S', 'BLh')
    g.paint(0, h - 1, w, 1, 'D', 'SBLh')
    // centre channel: shadowed top lip, recessed floor, lit bottom lip
    g.rect(3, 91, w - 6, 1, 'D')
    g.rect(3, 92, w - 6, 1, 'S')
    g.rect(3, 93, w - 6, 5, 'C')
    g.rect(3, 98, w - 6, 1, 'h')
    // rail stripes: + (red) above the first rail row, - (blue) beside the second
    const stripe = (y: number, hi: string, lo: string) => {
      g.rect(4, y, w - 8, 1, hi)
      g.rect(4, y + 1, w - 8, 1, lo)
    }
    stripe(4, 'R', 'r')
    stripe(25, 'U', 'u')
    stripe(154, 'R', 'r')
    stripe(175, 'U', 'u')
    // holes
    for (let i = 0; i < cols; i++) {
      for (const r of holeRows) {
        const x = 8 + i * 10
        const y = 8 + r * 10
        g.rect(x, y, BB_HOLE, BB_HOLE, 'N')
        g.rect(x, y, BB_HOLE, 1, 'Q')
        g.rect(x, y, 1, BB_HOLE, 'Q')
        g.rect(x + 1, y + BB_HOLE - 1, BB_HOLE - 1, 1, 'E')
        g.rect(x + BB_HOLE - 1, y + 1, 1, BB_HOLE - 1, 'E')
      }
    }
    return g.build(
      {
        B: '#e3ddc4',
        h: '#fbf7e8',
        L: '#f0ead3',
        S: '#cbc4a8',
        D: '#aaa387',
        C: '#bcb59a',
        R: '#e04646',
        r: '#a82a2a',
        U: '#3f72e0',
        u: '#27499c',
        N: '#2b2a33',
        Q: '#14131b',
        E: '#8a846c',
      },
      '#5a553f',
    )
  })
}

// ---------------------------------------------------------------- LED

/**
 * 5 mm LED seen from the side: tinted epoxy dome and barrel shaded around a light at the top left,
 * a flange with the flat spot on the cathode (right) side, and the leadframe (post, anvil, die) inside.
 * 24 x 25 art pixels; grid cell (0, 0) sits at world (-14, -62) so the flange ends 12 px above the pin row.
 */
export function ledSprite(body: string, lit: boolean): Sprite {
  return sprite(`led:${body}:${lit ? 1 : 0}`, () => {
    const g = new PixelGrid(24, 25)
    g.disc(12, 10, 10, 'B')
    g.rect(2, 10, 20, 11, 'B')
    g.rrect(0, 21, 22, 4, 2, 'B')
    // shade by distance from a light at the top left; the flange by row, with the flat spot darker
    const flange = ['L', 'T', 'M', 'D']
    const facet = ['M', 'S', 'D', 'D']
    for (let y = 0; y < 25; y++) {
      for (let x = 0; x < 24; x++) {
        if (g.get(x, y) === '.') continue
        if (y >= 21) {
          g.set(x, y, (x >= 19 ? facet : flange)[y - 21])
          continue
        }
        const d = Math.hypot(x + 0.5 - 7, y + 0.5 - 7)
        g.set(x, y, d < 1.5 ? 'h' : d < 5.5 ? 'L' : d < 10.5 ? 'T' : d < 15 ? 'M' : d < 19 ? 'S' : 'D')
      }
    }
    g.paint(0, 20, 24, 1, 'D', 'LTMS')
    // leadframe inside the epoxy: post, cathode post, anvil cup and the die
    // each inner cell remembers the epoxy tone under it so it can be shown at 30% strength
    const TONES = 'hLTMSD'
    const KINDS = 'pPqk'
    const inner = (x: number, y: number, w: number, h: number, kind: string) => {
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          const t = TONES.indexOf(g.get(x + i, y + j))
          if (t >= 0) g.set(x + i, y + j, String.fromCharCode(0x100 + KINDS.indexOf(kind) * 8 + t))
        }
      }
    }
    inner(9, 10, 2, 11, 'p')
    inner(9, 10, 1, 11, 'P')
    inner(15, 12, 1, 9, 'q')
    inner(7, 8, 8, 2, 'p')
    inner(7, 9, 8, 1, 'q')
    inner(10, 7, 2, 1, 'k')
    // specular glints
    g.set(6, 3, 'w')
    g.set(5, 4, 'w')
    g.set(5, 5, 'w')
    g.rect(4, 11, 1, 6, 'h')
    // mix() returns rgb(), which it cannot mix again, so the unlit base is turned back into hex first
    const hex = (rgb: string) => rgb.startsWith('#') ? rgb : '#' + (rgb.match(/\d+/g) ?? []).map((n) => Number(n).toString(16).padStart(2, '0')).join('')
    const base = lit ? body : hex(mix(body, '#8a8a96', 0.28))
    const pal: Record<string, string> = {
      h: mix(base, '#ffffff', 0.7),
      L: mix(base, '#ffffff', 0.35),
      T: base,
      M: mix(base, '#000000', 0.2),
      S: mix(base, '#000000', 0.38),
      D: mix(base, '#000000', 0.55),
      B: base,
      w: '#ffffff',
    }
    const metal: Record<string, string> = { p: '#d7dbe3', P: '#f4f6fa', q: '#8a909c', k: lit ? '#ffffff' : '#e6c93a' }
    const INNER_STRENGTH = 0.3
    for (let k = 0; k < KINDS.length; k++) {
      for (let t = 0; t < TONES.length; t++) {
        pal[String.fromCharCode(0x100 + k * 8 + t)] = mix(hex(pal[TONES[t]]), metal[KINDS[k]], INNER_STRENGTH)
      }
    }
    return g.build(pal, mix(body, '#000000', 0.72))
  })
}

// ---------------------------------------------------------------- diode

/**
 * 1N4007 seen from the side: charcoal plastic cylinder with rounded ends and a wide silver band on the
 * cathode (right) end. 22 x 10 art pixels, light from the top left; the metal legs are drawn by the part.
 */
export function diodeSprite(): Sprite {
  return sprite('diode', () => {
    const g = new PixelGrid(22, 10)
    g.rrect(0, 0, 22, 10, 2, 'T')
    const bodyRows = ['h', 'L', 'L', 'T', 'T', 'M', 'M', 'S', 'S', 'D']
    const bandRows = ['H', 'I', 'I', 'J', 'J', 'K', 'K', 'N', 'N', 'O']
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 22; x++) {
        if (g.get(x, y) === '.') continue
        g.set(x, y, x >= 16 ? bandRows[y] : bodyRows[y])
      }
    }
    // dark seam where the band starts, and a soft specular dot on the plastic
    g.rect(16, 1, 1, 8, 'D')
    g.set(3, 2, 'g')
    g.set(4, 2, 'g')
    return g.build(
      {
        h: '#6a6a74',
        L: '#4a4a54',
        T: '#33333b',
        M: '#26262d',
        S: '#1b1b21',
        D: '#121217',
        g: '#8e8e9a',
        H: '#f3f5f8',
        I: '#dde1e8',
        J: '#c4c9d1',
        K: '#a7adb8',
        N: '#8a909c',
        O: '#6f7582',
      },
      '#08080c',
    )
  })
}

// ---------------------------------------------------------------- BC547 / BC557 (TO-92)

/**
 * TO-92 seen from the flat face: black epoxy, half-round top, straight sides, slightly chamfered bottom.
 * 20 x 18 art pixels; grid cell (0, 0) sits at world (0, -44) so the bottom edge is 8 px above the pin row.
 * The type text is drawn on top by the part.
 */
export function to92Sprite(): Sprite {
  return sprite('to92', () => {
    const W = 20
    const H = 18
    const g = new PixelGrid(W, H)
    g.disc(10, 10, 10, 'F')
    g.rect(0, 10, W, H - 10, 'F')
    g.set(0, H - 1, '.')
    g.set(W - 1, H - 1, '.')
    // face tone drifts a little darker toward the bottom; the edge is lit top-left and shaded bottom-right
    const face = (y: number) => (y < 6 ? 'a' : y < 13 ? 'b' : 'c')
    const cells: Array<[number, number]> = []
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g.get(x, y) !== '.') cells.push([x, y])
    for (const [x, y] of cells) {
      const litEdge = g.get(x - 1, y) === '.' || g.get(x, y - 1) === '.'
      const darkEdge = g.get(x + 1, y) === '.' || g.get(x, y + 1) === '.'
      const inner = g.get(x - 2, y) === '.' || g.get(x, y - 2) === '.'
      g.set(x, y, litEdge && !darkEdge ? 'L' : darkEdge && !litEdge ? 'D' : inner ? 'M' : face(y))
    }
    g.rect(4, 5, 1, 4, 'w')
    g.rect(5, 4, 3, 1, 'w')
    return g.build({ a: '#34343d', b: '#2b2b33', c: '#212128', L: '#62626f', M: '#45454f', D: '#121217', w: '#8a8a99' }, '#07070a')
  })
}

// ---------------------------------------------------------------- potentiometer

/**
 * Blue trimmer pot seen from above: square body with a round, lighter blue knob. 30 x 27 art pixels,
 * grid cell (0, 0) at world (-10, -62) so the body's bottom edge is 8 px above the pin row.
 * The groove and pointer on the knob move with the setting and are drawn on top by the part.
 */
export function potSprite(): Sprite {
  return sprite('pot', () => {
    const g = new PixelGrid(30, 27)
    g.rrect(0, 0, 30, 27, 3, 'T')
    // body: lit top and left, shaded bottom and right
    g.paint(0, 0, 30, 1, 'h', 'T')
    g.paint(0, 1, 30, 1, 'L', 'T')
    g.paint(0, 0, 1, 27, 'h', 'TL')
    g.paint(1, 2, 1, 23, 'L', 'T')
    g.paint(28, 0, 2, 27, 'S', 'TLh')
    g.paint(29, 0, 1, 27, 'D', 'S')
    g.paint(0, 24, 30, 3, 'S', 'TLh')
    g.paint(0, 26, 30, 1, 'D', 'SLTh')
    // knob: dark ring, then a dome shaded around a light at the top left
    g.disc(15, 13.5, 9, 'R')
    g.disc(15, 13.5, 8, 'K')
    for (let y = 0; y < 27; y++) {
      for (let x = 0; x < 30; x++) {
        if (g.get(x, y) !== 'K') continue
        const d = Math.hypot(x + 0.5 - 11.5, y + 0.5 - 9.5)
        g.set(x, y, d < 2 ? 'a' : d < 5 ? 'b' : d < 9 ? 'c' : d < 13 ? 'd' : 'e')
      }
    }
    return g.build(
      {
        h: '#8fb8ff',
        L: '#5f93e8',
        T: '#3f78d0',
        S: '#2c5aa8',
        D: '#1e407e',
        R: '#173769',
        a: '#d3e5ff',
        b: '#8db9fa',
        c: '#5b95ee',
        d: '#437dd8',
        e: '#3167bd',
      },
      '#0c1c3a',
    )
  })
}

// ---------------------------------------------------------------- LDR

/**
 * Light-dependent resistor seen from above: red-brown resin ring around a tan ceramic face with a silver
 * serpentine track and two pads. 22 x 22 art pixels, grid cell (0, 0) at world (-2, -48), light at the top left.
 */
export function ldrSprite(): Sprite {
  return sprite('ldr', () => {
    const g = new PixelGrid(22, 22)
    g.disc(11, 11, 10.5, 'R')
    g.disc(11, 11, 8.5, 'F')
    // ring and face shade by distance from the light
    for (let y = 0; y < 22; y++) {
      for (let x = 0; x < 22; x++) {
        const ch = g.get(x, y)
        if (ch === '.') continue
        const d = Math.hypot(x + 0.5 - 7, y + 0.5 - 7)
        if (ch === 'R') g.set(x, y, d < 8 ? 'A' : d < 13 ? 'B' : d < 18 ? 'C' : 'D')
        else g.set(x, y, d < 3 ? 'a' : d < 7 ? 'b' : d < 11 ? 'c' : d < 15 ? 'd' : 'e')
      }
    }
    // serpentine track with a dark relief row under every horizontal run, then the pads
    const onFace = (x: number, y: number) => 'abcde'.includes(g.get(x, y))
    for (let k = 0; k < 5; k++) {
      const y = 5 + k * 3
      for (let x = 5; x <= 16; x++) if (onFace(x, y + 1)) g.set(x, y + 1, 'g')
    }
    for (let k = 0; k < 5; k++) {
      const y = 5 + k * 3
      for (let x = 5; x <= 16; x++) if (onFace(x, y)) g.set(x, y, 'k')
      if (k < 4) {
        const x = k % 2 === 0 ? 16 : 5
        for (let j = 1; j <= 2; j++) if (onFace(x, y + j)) g.set(x, y + j, 'k')
      }
    }
    g.rect(4, 4, 2, 2, 'p')
    g.rect(16, 16, 2, 2, 'p')
    g.set(4, 4, 'q')
    g.set(16, 16, 'q')
    return g.build(
      {
        A: '#c8644a',
        B: '#a8452e',
        C: '#8a3322',
        D: '#6a261a',
        a: '#f6e6c4',
        b: '#ecd6ab',
        c: '#e0c391',
        d: '#d1b07d',
        e: '#bd9a68',
        g: '#8a6c42',
        k: '#c3c8d2',
        p: '#aeb3bd',
        q: '#f1f4f9',
      },
      '#2e120c',
    )
  })
}

// ---------------------------------------------------------------- NTC thermistor

/**
 * Epoxy-coated NTC bead: a glossy blue dome shaded around a light at the top left. 22 x 22 art pixels, the same
 * size and placement as the LDR: grid cell (0, 0) at world (-2, -48) so the bead is centred on (20, -26); the
 * legs are drawn under it by the part.
 */
export function ntcSprite(): Sprite {
  return sprite('ntc', () => {
    const g = new PixelGrid(22, 22)
    g.disc(11, 11, 10.5, 'e')
    for (let y = 0; y < 22; y++) {
      for (let x = 0; x < 22; x++) {
        if (g.get(x, y) === '.') continue
        const d = Math.hypot(x + 0.5 - 7.5, y + 0.5 - 7.5)
        g.set(x, y, d < 2.8 ? 'a' : d < 6.2 ? 'b' : d < 10.3 ? 'c' : d < 14.4 ? 'd' : d < 17.9 ? 'e' : 'f')
      }
    }
    g.rect(5, 5, 3, 1, 'w')
    g.rect(5, 6, 1, 2, 'w')
    return g.build(
      { a: '#cfe4ff', b: '#7fb2ff', c: '#3f86e8', d: '#2b69c4', e: '#1f4f98', f: '#173b75', w: '#ffffff' },
      '#0a1d3f',
    )
  })
}

// ---------------------------------------------------------------- slide switch

/**
 * Slide switch seen from above: brushed-steel shell with a dark slot. 28 x 17 art pixels, grid cell (0, 0)
 * at world (-8, -17). The white lever that rides in the slot is drawn on top by the part.
 */
export function slideSwitchSprite(): Sprite {
  return sprite('slide-switch', () => {
    const W = 28
    const H = 17
    const g = new PixelGrid(W, H)
    g.rrect(0, 0, W, H, 2, 'T')
    const rows = ['h', 'L', 'L', 'T', 'T', 'T', 'T', 'M', 'M', 'M', 'M', 'S', 'S', 'S', 'S', 'D', 'D']
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g.get(x, y) !== '.') g.set(x, y, rows[y])
    // lit left edge, shaded right edge
    g.paint(0, 1, 1, H - 2, 'h', 'LTMS')
    g.paint(1, 3, 1, H - 6, 'L', 'TMS')
    g.paint(W - 1, 1, 1, H - 2, 'D', 'LTMS')
    g.paint(W - 2, 3, 1, H - 6, 'S', 'TM')
    // slot: dark with a shadowed top row and a lit lip underneath
    g.rect(4, 6, 20, 5, 'K')
    g.rect(4, 6, 20, 1, 'Z')
    g.rect(4, 11, 20, 1, 'h')
    // two small mounting dimples
    g.rect(2, 2, 2, 2, 'D')
    g.rect(W - 4, H - 4, 2, 2, 'D')
    return g.build(
      {
        h: '#f4f6fa',
        L: '#dde1e8',
        T: '#c4c9d1',
        M: '#a7adb8',
        S: '#8a909c',
        D: '#6f7582',
        K: '#15151a',
        Z: '#08080b',
      },
      '#2a2d36',
    )
  })
}

// ---------------------------------------------------------------- rocker switch

/** Rocker switch symbols are drawn on top at these art cells (sprite grid, origin world (-2, -30)). */
export const ROCKER_O = { x: 11, y: 8 }
export const ROCKER_I = { x: 11, y: 21 }

/**
 * Black snap-in rocker switch seen from above: bevelled frame, dark opening, and a rocker whose pressed end
 * has dipped into the opening (ON = the I end at the bottom is down, OFF = the O end at the top is down).
 * 22 x 30 art pixels, grid cell (0, 0) at world (-2, -30). The O and I marks are drawn on top by the part.
 */
export function rockerSwitchSprite(on: boolean): Sprite {
  return sprite(`rocker:${on ? 1 : 0}`, () => {
    const W = 22
    const H = 30
    const g = new PixelGrid(W, H)
    g.rrect(0, 0, W, H, 2, 'c')
    // bevelled frame: four trapezoids meeting on the diagonals
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (g.get(x, y) === '.') continue
        const top = y < 2 && y <= x && y <= W - 1 - x
        const left = x < 2 && x < y && x <= H - 1 - y
        const bottom = y >= H - 2 && H - 1 - y <= x && H - 1 - y <= W - 1 - x
        g.set(x, y, top ? 'a' : left ? 'b' : bottom ? 'd' : 'c')
      }
    }
    g.rect(2, 2, W - 4, H - 4, 'O')
    // rocker: 16 wide, 24 tall; the dipped half is darker and one end is lowered into the opening
    const top = on ? 2 : 4
    const bottom = top + 23
    const seam = top + 12
    const rx0 = 3
    const rx1 = rx0 + 15
    g.rect(rx0, top, 16, 24, 'r')
    const raisedTop = on
    for (let y = top; y <= bottom; y++) {
      const raised = raisedTop ? y < seam : y >= seam
      for (let x = rx0; x <= rx1; x++) g.set(x, y, raised ? (x === rx0 ? 'l' : x === rx1 ? 'x' : 'r') : x === rx1 ? 'k' : 's')
    }
    g.rect(rx0, seam, 16, 1, 'k')
    if (raisedTop) g.rect(rx0, top, 16, 1, 'h')
    g.rect(rx0, raisedTop ? bottom : top, 16, 1, 'k')
    return g.build(
      {
        a: '#44444c',
        b: '#34343b',
        c: '#26262c',
        d: '#1a1a1f',
        O: '#08080b',
        r: '#2b2b32',
        l: '#3a3a42',
        x: '#202026',
        s: '#16161a',
        k: '#0b0b0e',
        h: '#55555e',
      },
      '#050507',
    )
  })
}

// ---------------------------------------------------------------- tactile push button

/**
 * 6 mm tactile switch from above: brushed-steel shell with a round black plastic cap. 26 x 26 art pixels,
 * grid cell (0, 0) at world (4, 4). Pressed, the cap sits lower and smaller in its opening.
 */
export function tactSprite(down: boolean): Sprite {
  return sprite(`tact:${down ? 1 : 0}`, () => {
    const N = 26
    const g = new PixelGrid(N, N)
    g.rrect(0, 0, N, N, 2, 'T')
    const steel = ['h', 'L', 'T', 'M', 'S', 'D']
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (g.get(x, y) !== '.') g.set(x, y, steel[Math.min(5, Math.floor((y * 6) / N))])
    g.paint(0, 1, 1, N - 2, 'h', 'LTMS')
    g.paint(1, 3, 1, N - 6, 'L', 'TMS')
    g.paint(N - 1, 1, 1, N - 2, 'D', 'LTMS')
    // rivets in the corners
    for (const [x, y] of [
      [2, 2],
      [N - 4, 2],
      [2, N - 4],
      [N - 4, N - 4],
    ])
      g.rect(x, y, 2, 2, 'D')
    // dark opening, then the cap shaded around a light at the top left
    g.disc(13, 13, 10, 'O')
    const r = down ? 8 : 9
    g.disc(down ? 13.5 : 13, down ? 13.5 : 13, r, 'K')
    const shift = down ? 4 : 0
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (g.get(x, y) !== 'K') continue
        const d = Math.hypot(x + 0.5 - 9.5, y + 0.5 - 9.5) + shift
        g.set(x, y, d < 2 ? 'a' : d < 5 ? 'b' : d < 9 ? 'c' : d < 13 ? 'd' : 'e')
      }
    }
    return g.build(
      {
        h: '#f4f6fa',
        L: '#dde1e8',
        T: '#c4c9d1',
        M: '#a7adb8',
        S: '#8a909c',
        D: '#6f7582',
        O: '#0b0b0e',
        a: '#6e6e7a',
        b: '#4c4c57',
        c: '#35353d',
        d: '#26262c',
        e: '#17171c',
      },
      '#2a2d36',
    )
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

/**
 * The two terminals of each battery type: columns in art px, and the sprite's world x offset, chosen so both
 * terminals sit on grid points (they are the part's pins). The sprite is drawn with its top on the pin row.
 */
export function batteryTerminals(volts: string): { a: [number, number]; ox: number } {
  switch (volts) {
    case '1.5':
      return { a: [6, 16], ox: 8 }
    case '3':
      return { a: [10, 30], ox: 0 }
    case '4.5':
      return { a: [9, 49], ox: 2 }
    default:
      return { a: [8, 28], ox: 4 }
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
    // terminals: metal studs with a bright top row; the 9 V (PP3) has a round snap and a hex snap like the real one
    anchorsArt.forEach((ax, i) => {
      if (volts === '9') {
        g.rect(ax - 3, 0, 6, top + 1, 'M')
        g.rect(ax - 3, 0, 6, 1, 'm')
        g.rect(ax + 2, 1, 1, top, 'n')
        g.set(ax - 3, 0, '.')
        g.set(ax + 2, 0, '.')
        if (i === 0) {
          // round snap: rounded top, dot in the middle
          g.set(ax - 3, 1, '.')
          g.set(ax + 2, 1, '.')
          g.rect(ax - 1, 2, 2, 2, 'n')
        } else {
          // hex snap: flat top, square socket
          g.rect(ax - 2, 1, 4, 3, 'n')
          g.rect(ax - 1, 2, 2, 1, 'u')
        }
        return
      }
      // cell packs: the + terminal is red, the - terminal dark grey, so the polarity reads at a glance
      const [tb, , ts] = i === 0 ? ['F', 'G', 'H'] : ['I', 'J', 'L']
      g.rect(ax - 2, 0, 4, top + 1, tb)
      g.rect(ax + 1, 1, 1, top, ts)
      // silver tip: the top two rows of the stud are bare metal
      g.rect(ax - 2, 0, 4, 2, 'M')
      g.rect(ax - 2, 0, 4, 1, 'm')
      g.set(ax + 1, 1, 'n')
      if (i === 0) g.set(ax - 2, 0, '.')
    })
    const extra: Record<string, string> = {}
    // gold-to-red metal: the colour drifts down the rows (shared by the 9 V can and the AA cells)
    const stops: Array<[number, string]> = [
      [0, '#ecd070'],
      [0.42, '#d6aa38'],
      [0.72, '#e2802a'],
      [1, '#b82a18'],
    ]
    const colorAt = (t: number): string => {
      for (let k = 1; k < stops.length; k++) {
        if (t <= stops[k][0]) return mix(stops[k - 1][1], stops[k][1], (t - stops[k - 1][0]) / (stops[k][0] - stops[k - 1][0]))
      }
      return stops[stops.length - 1][1]
    }
    const hexOf = (rgb: string) => '#' + (rgb.match(/\d+/g) ?? []).map((n) => Number(n).toString(16).padStart(2, '0')).join('')
    if (volts === '9') {
      for (let y = 0; y < h; y++) {
        const base = hexOf(colorAt(y / (h - 1)))
        extra[String.fromCharCode(0x300 + y * 3)] = base
        extra[String.fromCharCode(0x300 + y * 3 + 1)] = mix(base, '#ffffff', y === 0 ? 0.45 : 0.22)
        extra[String.fromCharCode(0x300 + y * 3 + 2)] = mix(base, '#000000', 0.28)
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!'Kkq'.includes(g.get(x, top + y))) continue
          const v = y === 0 || x <= 1 ? 1 : x >= w - 2 ? 2 : 0
          g.set(x, top + y, String.fromCharCode(0x300 + y * 3 + v))
        }
      }
      // thin navy rule across the can, then the tapered navy label panel
      g.rect(1, top + 11, w - 2, 1, 'D')
      for (let y = top + 12; y < top + 58; y++) {
        const inset = y > top + 44 ? Math.floor((y - (top + 44)) / 3) : 0
        for (let x = 12 + inset; x <= 26 - inset; x++) g.set(x, y, x === 12 + inset ? 'B' : x >= 25 - inset ? 'C' : 'A')
      }
      // polarity marks above the label: left + (ringed, matches the red lead), right -
      const [ta, tb] = anchorsArt
      g.disc(ta, top + 7, 3.9, 'E')
      g.disc(ta, top + 7, 3.1, 'A')
      g.rect(ta - 2, top + 7, 5, 1, 'E')
      g.rect(ta, top + 5, 1, 5, 'E')
      g.disc(tb, top + 7, 3.5, 'A')
      g.rect(tb - 2, top + 7, 5, 1, 'E')
    } else {
      const cells = volts === '1.5' ? 1 : volts === '3' ? 2 : 3
      const ch = h - 10
      for (let yy = 0; yy < ch; yy++) {
        const base = hexOf(colorAt(yy / (ch - 1)))
        const code = 0x500 + yy * 5
        extra[String.fromCharCode(code)] = mix(base, '#ffffff', 0.3)
        extra[String.fromCharCode(code + 1)] = base
        extra[String.fromCharCode(code + 2)] = mix(base, '#000000', 0.28)
        extra[String.fromCharCode(code + 3)] = mix(base, '#000000', 0.45)
        extra[String.fromCharCode(code + 4)] = mix(base, '#ffffff', 0.5)
      }
      for (let k = 0; k < cells; k++) {
        const x0 = 3 + k * 18
        g.rrect(x0 - 1, top + 5, 18, h - 8, 5, 'u')
        g.rrect(x0, top + 6, 16, ch, 4, 'Y')
        // gold-to-red cylinder: lit on the left, shaded on the right, bright top row
        for (let yy = 0; yy < ch; yy++) {
          for (let xx = 0; xx < 16; xx++) {
            if (g.get(x0 + xx, top + 6 + yy) !== 'Y') continue
            const v = yy === 0 ? 4 : xx <= 2 ? 0 : xx >= 14 ? 3 : xx >= 12 ? 2 : 1
            g.set(x0 + xx, top + 6 + yy, String.fromCharCode(0x500 + yy * 5 + v))
          }
        }
        // positive nub on top, navy label panel with a rule above it, and the + mark
        g.rect(x0 + 5, top + 3, 6, 3, 'M')
        g.rect(x0 + 5, top + 3, 6, 1, 'm')
        g.rect(x0 + 1, top + 13, 14, 1, 'D')
        // same tapered shape and reach as the 9 V label: it narrows over its last 13 rows, one pixel per side every 3 rows
        const pend = top + h - 8
        for (let y = top + 14; y < pend; y++) {
          const inset = y >= pend - 13 ? Math.floor((y - (pend - 13)) / 3) : 0
          for (let x = x0 + 3 + inset; x <= x0 + 12 - inset; x++) g.set(x, y, x === x0 + 3 + inset ? 'B' : x >= x0 + 11 - inset ? 'C' : 'A')
        }
        g.rect(x0 + 6, top + 10, 5, 1, 'E')
        g.rect(x0 + 8, top + 8, 1, 5, 'E')
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
        A: '#1f2c6e',
        B: '#2e3f8c',
        C: '#141c4f',
        D: '#2a2f6b',
        E: '#e8e8f0',
        F: '#d8303d',
        G: '#ff7d86',
        H: '#8f1a24',
        I: '#35353d',
        J: '#5a5a66',
        L: '#1a1a20',
        ...extra,
      },
      volts === '9' ? '#3a2410' : '#0d0c14',
    )
  })
  return { sprite: s, lift: top * 2 }
}

// ---------------------------------------------------------------- multimeter

/**
 * Hobby multimeter from the front: orange case with a groove around the front panel, a pale LCD in a black
 * bezel, a dial plate with a black knob, and two shaded jacks. 60 x 95 art pixels. The knob pointer, display
 * text and labels are drawn on top.
 */
export function meterSprite(): Sprite {
  return sprite('meter', () => {
    const W = 60
    const H = 95
    const g = new PixelGrid(W, H)
    g.rrect(0, 0, W, H, 5, 'T')
    // case: orange cylinder-ish shading by row, lit left edge, shaded right edge
    const tones = ['h', 'L', 'L', 'T', 'T', 'T', 'T', 'T', 'T', 'T', 'T', 'T', 'T', 'T', 'M', 'M', 'M', 'S', 'S', 'D']
    for (let y = 0; y < H; y++) {
      const t = tones[Math.min(tones.length - 1, Math.floor((y * tones.length) / H))]
      for (let x = 0; x < W; x++) if (g.get(x, y) !== '.') g.set(x, y, t)
    }
    g.paint(0, 2, 1, H - 4, 'h', 'LTMSD')
    g.paint(1, 4, 1, H - 8, 'L', 'TMSD')
    g.paint(W - 1, 2, 1, H - 4, 'D', 'hLTMS')
    g.paint(W - 2, 4, 1, H - 8, 'S', 'hLTM')
    // groove around the front panel
    g.rrect(3, 3, W - 6, H - 6, 4, 'g')
    g.rrect(4, 4, W - 8, H - 8, 3, 'T')
    for (let y = 4; y < H - 4; y++) {
      const t = tones[Math.min(tones.length - 1, Math.floor((y * tones.length) / H))]
      for (let x = 4; x < W - 4; x++) if (g.get(x, y) === 'T') g.set(x, y, t === 'h' ? 'L' : t === 'D' ? 'S' : t)
    }
    // LCD in a black bezel, the glass pale green-grey with an inset shadow
    g.rrect(6, 6, 48, 25, 2, 'B')
    g.rect(6, 6, 48, 1, 'b')
    g.rect(6, 6, 1, 25, 'b')
    g.rect(7, 30, 47, 1, 'z')
    g.rect(53, 7, 1, 24, 'z')
    g.rect(8, 8, 44, 21, 'l')
    g.rect(8, 8, 44, 1, 'm')
    g.rect(8, 8, 1, 21, 'm')
    g.rect(8, 28, 44, 1, 'n')
    // black knob shaded around a light at the top left, with a thin groove ring around it
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d = Math.hypot(x + 0.5 - 30, y + 0.5 - 56)
        if (d > 19) continue
        const dl = Math.hypot(x + 0.5 - 22, y + 0.5 - 48)
        if (d <= 12) g.set(x, y, dl < 3 ? 'a' : dl < 8 ? 'u' : dl < 14 ? 'c' : dl < 19 ? 'd' : 'e')
        else if (d > 17.6) g.set(x, y, 'g')
      }
    }
    // jacks: coloured ring, steel collar, hole
    const jack = (cx: number, cy: number, ring: string, hole: string) => {
      g.disc(cx, cy, 5.2, ring)
      g.disc(cx, cy, 3.9, 'q')
      for (let y = cy - 5; y <= cy + 5; y++) for (let x = cx - 5; x <= cx + 5; x++) if (g.get(x, y) === 'q' && x + y > cx + cy + 1) g.set(x, y, 'Q')
      g.disc(cx, cy, 2.3, hole)
      g.set(cx - 1, cy - 1, 'w')
    }
    jack(17, 88, 'K', 'R')
    jack(43, 88, 'k', 'N')
    return g.build(
      {
        h: '#ffd96a',
        L: '#f7bd3c',
        T: '#f0a21f',
        M: '#d98c12',
        S: '#b87008',
        D: '#8f5504',
        g: '#a86a08',
        B: '#1c1c22',
        b: '#4a4a56',
        z: '#0b0b0f',
        l: '#a9b996',
        m: '#85957a',
        n: '#c4d1b0',
        P: '#3a3a44',
        p: '#26262c',
        o: '#17171c',
        a: '#6e6e7a',
        u: '#4c4c57',
        c: '#35353d',
        d: '#26262c',
        e: '#17171c',
        K: '#d8303d',
        k: '#35353d',
        q: '#c9ced6',
        Q: '#7d838f',
        R: '#a82030',
        N: '#0b0b0e',
        w: '#ffffff',
      },
      '#4a2c05',
    )
  })
}

// ---------------------------------------------------------------- bench supply

/** Same 60 x 95 art-pixel footprint as the multimeter (120 x 190 world px). */
export const SUPPLY_W = 60
export const SUPPLY_H = 95

/**
 * Bench power supply front, upright like the common 30 V adjustable units: two red LED displays stacked on
 * top, a CC lamp, two knobs with the output button between them, and the binding posts along the bottom
 * (at world (40, 160) and (80, 160), the part's pins). Knob pointers, the output button state, the lamp and
 * the readout are drawn on top.
 */
export function supplySprite(): Sprite {
  return sprite('supply', () => {
    const W = SUPPLY_W
    const H = SUPPLY_H
    const g = new PixelGrid(W, H)
    g.rrect(0, 0, W, H, 5, 'T')
    const tones = ['h', 'L', 'L', ...Array<string>(40).fill('T'), ...Array<string>(26).fill('M'), ...Array<string>(14).fill('S'), 'D', 'D', 'D', 'D']
    const rowTone = (y: number) => tones[Math.min(tones.length - 1, Math.floor((y * tones.length) / H))]
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g.get(x, y) !== '.') g.set(x, y, rowTone(y))
    g.paint(0, 2, 1, H - 4, 'h', 'LTMSD')
    g.paint(1, 4, 1, H - 8, 'L', 'TMSD')
    g.paint(W - 1, 2, 1, H - 4, 'D', 'hLTMS')
    // groove around the front panel, panel re-toned by row
    g.rrect(2, 2, W - 4, H - 4, 4, 'g')
    g.rrect(3, 3, W - 6, H - 6, 3, 'T')
    for (let y = 3; y < H - 3; y++) for (let x = 3; x < W - 3; x++) if (g.get(x, y) === 'T') g.set(x, y, rowTone(y) === 'h' ? 'L' : rowTone(y))
    // two displays: black bezel, dark red-black glass with an inset shadow and a lit lip underneath
    for (const y0 of [6, 27]) {
      g.rrect(4, y0, 52, 19, 2, 'B')
      g.rect(4, y0, 52, 1, 'b')
      g.rect(4, y0, 1, 19, 'b')
      g.rect(5, y0 + 18, 51, 1, 'z')
      g.rect(55, y0 + 1, 1, 18, 'z')
      g.rect(6, y0 + 2, 48, 15, 'G')
      g.rect(6, y0 + 2, 48, 1, 'H')
      g.rect(6, y0 + 2, 1, 15, 'H')
      g.rect(6, y0 + 16, 48, 1, 'I')
    }
    // knobs: dark ring, black body shaded around a light at the top left
    for (const cx of [14, 46]) {
      g.disc(cx, 58, 9.5, 'o')
      for (let y = 47; y <= 69; y++) {
        for (let x = cx - 10; x <= cx + 10; x++) {
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - 58)
          if (d > 8.4) continue
          const dl = Math.hypot(x + 0.5 - (cx - 2.8), y + 0.5 - 55.2)
          g.set(x, y, dl < 2.2 ? 'a' : dl < 5 ? 'u' : dl < 8.8 ? 'c' : dl < 12 ? 'd' : 'e')
        }
      }
    }
    // round output button recess between the knobs (the power symbol is drawn on top)
    g.disc(30, 61.5, 6, 'o') // 12 px across; bottom edge (61.5 + 6) matches the knobs (58 + 9.5)
    g.disc(30, 61.5, 5.2, 'B')
    // binding posts: dark ring, coloured collar, steel centre with a hole
    const post = (cx: number, cy: number, collar: string, lit: string) => {
      g.disc(cx, cy, 6.8, 'o')
      g.disc(cx, cy, 5.9, collar)
      for (let y = cy - 6; y <= cy + 6; y++) for (let x = cx - 6; x <= cx + 6; x++) if (g.get(x, y) === collar && Math.hypot(x + 0.5 - (cx - 1.8), y + 0.5 - (cy - 1.8)) < 3) g.set(x, y, lit)
      g.disc(cx, cy, 3.6, 'q')
      for (let y = cy - 4; y <= cy + 4; y++) for (let x = cx - 4; x <= cx + 4; x++) if (g.get(x, y) === 'q' && x + y > cx + cy) g.set(x, y, 'Q')
      g.disc(cx, cy, 2.1, 'N')
      g.set(cx - 2, cy - 2, 'w')
    }
    post(20, 80, 'K', 'l')
    post(40, 80, 'k', 'm')
    return g.build(
      {
        h: '#6b7088',
        L: '#545a72',
        T: '#434860',
        M: '#363a4e',
        S: '#2b2e40',
        D: '#1e2030',
        g: '#161826',
        B: '#0d0e14',
        b: '#3a3d4e',
        z: '#06060a',
        G: '#1a0709',
        H: '#0a0204',
        I: '#3a1218',
        a: '#7a7a86',
        u: '#52525d',
        c: '#3a3a42',
        d: '#2a2a31',
        e: '#1b1b21',
        o: '#0a0a0e',
        K: '#d8303d',
        l: '#ff7d86',
        k: '#2f2f38',
        m: '#5a5a66',
        q: '#c9ced6',
        Q: '#7d838f',
        N: '#0b0b0e',
        w: '#ffffff',
      },
      '#0a0b12',
    )
  })
}

// ---------------------------------------------------------------- logic gates

export type GateShape = 'not' | 'and' | 'or' | 'nand' | 'nor' | 'xor' | 'xnor'

/** Gate disc: 44 x 44 art pixels (88 world px). Grid cell (0, 0) sits at world (-4, -24); the disc centre is world (40, 20). */
export const GATE_ART = 44
export const GATE_ORIGIN = { x: -4, y: -24 }
export const GATE_CENTRE = { x: 40, y: 20 }
/** World px per geometry unit (the disc radius is 40 units = 44 world px). */
export const GATE_UNIT = 1.1

type Pt = [number, number]

export interface GateGeometry {
  /** Strokes (open or closed polylines) in geometry units, centre at (0, 0), y down. */
  polys: Pt[][]
  /** Output bubbles: centre x, centre y, radius. */
  circles: [number, number, number][]
}

function quad(p0: Pt, c: Pt, p1: Pt, n = 14): Pt[] {
  const out: Pt[] = []
  for (let k = 0; k <= n; k++) {
    const t = k / n
    out.push([(1 - t) ** 2 * p0[0] + 2 * t * (1 - t) * c[0] + t * t * p1[0], (1 - t) ** 2 * p0[1] + 2 * t * (1 - t) * c[1] + t * t * p1[1]])
  }
  return out
}

function arc(cx: number, cy: number, r: number, a0: number, a1: number, n = 18): Pt[] {
  const out: Pt[] = []
  for (let k = 0; k <= n; k++) {
    const a = a0 + ((a1 - a0) * k) / n
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return out
}

/** Where the pins sit, in units from the disc centre (the 20 px pin grid puts the inputs at +-18.2 units, the output at the right rim). */
export const GATE_PIN_UNITS = { inY: 18.2, inX: -36.4, outX: 36.4 }

/**
 * The classic logic-gate symbol with its own input and output legs, drawn inside the disc: AND = flat back and round front,
 * OR = curved back and pointed front, NOT = triangle, XOR = OR plus a second back arc, and a small bubble on the output of the
 * inverting gates. The body is tall enough (+-26 units) that the two input legs, 36.4 units apart on the pin grid, run straight
 * from the rim to the back edge of the body: no bends.
 */
export function gateGeometry(shape: GateShape): GateGeometry {
  const { inY, inX, outX } = GATE_PIN_UNITS
  const polys: Pt[][] = []
  const circles: [number, number, number][] = []
  const H = 26
  let backAt = -24 // x of the body's back edge at the input rows (y = +-18.2)
  let outFrom = 26 // x where the output leg leaves the body
  switch (shape) {
    case 'not':
      polys.push([[-22, -24], [20, 0], [-22, 24], [-22, -24]])
      circles.push([24, 0, 4])
      outFrom = 28
      break
    case 'and':
      polys.push([[-24, -H], [0, -H], ...arc(0, 0, H, -Math.PI / 2, Math.PI / 2), [-24, H], [-24, -H]])
      break
    case 'nand':
      polys.push([[-26, -H], [-6, -H], ...arc(-6, 0, H, -Math.PI / 2, Math.PI / 2), [-26, H], [-26, -H]])
      circles.push([24, 0, 4])
      backAt = -26
      outFrom = 28
      break
    case 'or':
    case 'nor':
    case 'xor':
    case 'xnor': {
      const sharp = shape === 'or' || shape === 'xor'
      const tip = sharp ? 24 : 16
      const x0 = shape === 'xor' || shape === 'xnor' ? -20 : -26
      const ctrl = sharp ? 4 : 0
      polys.push([...quad([x0, -H], [ctrl, -H], [tip, 0]), ...quad([tip, 0], [ctrl, H], [x0, H]), ...quad([x0, H], [x0 + 13, 0], [x0, -H])])
      backAt = x0 + 3.3
      outFrom = tip
      if (shape === 'xor' || shape === 'xnor') {
        polys.push(quad([-27, -H], [-18, 0], [-27, H]))
        backAt = -27 + 2.3
      }
      if (shape === 'nor' || shape === 'xnor') {
        circles.push([tip + 5, 0, 4])
        outFrom = tip + 9
      }
      break
    }
  }
  // centre the body (symbol plus output bubble, without legs) in the disc; only the legs get longer or shorter
  let lo = Infinity
  let hi = -Infinity
  for (const poly of polys) for (const [x] of poly) (lo = Math.min(lo, x)), (hi = Math.max(hi, x))
  for (const [x, , r] of circles) (lo = Math.min(lo, x - r)), (hi = Math.max(hi, x + r))
  const shift = -(lo + hi) / 2
  for (const poly of polys) for (const pt of poly) pt[0] += shift
  for (const circle of circles) circle[0] += shift
  backAt += shift
  outFrom += shift
  if (shape === 'not') polys.push([[inX, 0], [-22 + shift, 0]])
  else for (const y of [-inY, inY]) polys.push([[inX, y], [backAt, y]])
  polys.push([[outFrom, 0], [outX, 0]])
  return { polys, circles }
}

const DISC_TONES = ['#ffffff', '#f3f5fa', '#e6e9f1', '#d6dae6']

/** The white disc only (light from the top left), 44 x 44 art pixels. The symbol is drawn on top as smooth strokes by the part. */
export function gateSprite(shape: GateShape): Sprite {
  return sprite(`gate-${shape}`, () => {
    const N = GATE_ART
    const g = new PixelGrid(N, N)
    const R = N / 2
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dx = x + 0.5 - R
        const dy = y + 0.5 - R
        if (dx * dx + dy * dy > R * R) continue
        const lit = (dx + dy) / (R * 2.8) // -0.5 (top left) .. +0.5 (bottom right)
        g.set(x, y, String(Math.min(3, Math.max(0, Math.floor((lit + 0.5) * 4)))))
      }
    }
    return g.build({ '0': DISC_TONES[0], '1': DISC_TONES[1], '2': DISC_TONES[2], '3': DISC_TONES[3] }, '#08080c')
  })
}

// ---------------------------------------------------------------- DIP-14 chip

/**
 * Black DIP-14 package seen from above, notch on the left, pin-1 dimple bottom left. 70 x 30 art pixels; cell (0, 0) sits at
 * world (-10, 0) so the 2-pixel legs centre on the pin points (pins at x = 0..120 step 20, y = 0 and 60). Body rows 4..25.
 */
/** Chip package colours (style.md 2.8): the sprite and the vector look both read them from here. */
export const DIP_COLORS = { a: '#2c2c33', b: '#26262c', c: '#202026', L: '#5a5a66', M: '#3c3c45', D: '#111115', p: '#16161b', S: '#c9ced6', T: '#7d838f', edge: '#07070a' }

export function dipSprite(): Sprite {
  return sprite('dip14', () => {
    const W = 70
    const H = 30
    const g = new PixelGrid(W, H)
    g.rrect(0, 4, W, 22, 1, 'F')
    g.disc(0, 15, 3, '.') // notch
    const face = (y: number) => (y < 11 ? 'a' : y < 19 ? 'b' : 'c')
    const cells: Array<[number, number]> = []
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g.get(x, y) !== '.') cells.push([x, y])
    for (const [x, y] of cells) {
      const litEdge = g.get(x - 1, y) === '.' || g.get(x, y - 1) === '.'
      const darkEdge = g.get(x + 1, y) === '.' || g.get(x, y + 1) === '.'
      const inner = g.get(x - 2, y) === '.' || g.get(x, y - 2) === '.'
      g.set(x, y, litEdge && !darkEdge ? 'L' : darkEdge && !litEdge ? 'D' : inner ? 'M' : face(y))
    }
    g.disc(6, 21, 1, 'p') // pin-1 dimple
    for (let i = 0; i < 7; i++) {
      const x = 4 + 10 * i
      for (const y of [0, 26]) {
        g.rect(x, y, 2, 4, 'S')
        g.rect(x + 1, y, 1, 4, 'T')
      }
    }
    const { edge, ...tones } = DIP_COLORS
    return g.build(tones, edge)
  })
}

// ---------------------------------------------------------------- capacitors

/**
 * Ceramic disc capacitor seen from the front (reference: Wikimedia Commons "Electronic-Component-Ceramic-Capacitor.jpg"):
 * a flat orange-tan disc, 5.5 mm across, with two small bulges at the bottom where the legs come out. 22 x 24 art pixels,
 * grid cell (0, 0) at world (-2, -52), disc centre (20, -30). The EIA code is drawn on top by the part.
 */
export function ceramicCapSprite(): Sprite {
  return sprite('cap-ceramic', () => {
    const g = new PixelGrid(22, 24)
    g.disc(11, 11, 10.5, 'f')
    // the two bulges at the bottom edge, one over each leg
    g.rect(6, 20, 3, 4, 'f')
    g.rect(14, 20, 3, 4, 'f')
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 22; x++) {
        if (g.get(x, y) === '.') continue
        // shade by distance from the light spot at the upper left; the bulges are in the shade
        const d = y >= 21 ? 99 : Math.hypot(x + 0.5 - 7.5, y + 0.5 - 7.5)
        g.set(x, y, d < 2.4 ? 'a' : d < 5 ? 'b' : d < 8.2 ? 'c' : d < 11.6 ? 'd' : d < 14.6 ? 'e' : d < 17.2 ? 'f' : 'g')
      }
    }
    g.rect(4, 4, 3, 1, 'w')
    g.rect(4, 5, 1, 2, 'w')
    return g.build(
      { a: '#ffe9b0', b: '#f6c76a', c: '#e9a23b', d: '#d58a2a', e: '#b8701f', f: '#965816', g: '#6f410f', w: '#ffffff' },
      '#3d2408',
    )
  })
}

/**
 * Radial electrolytic capacitor standing on its legs (reference: Wikimedia Commons "CAPE-TH-X-UF100-VA (16237030527).jpg" and
 * "47uf Electrolytic Capacitor.jpg"): a glossy black sleeve, 6 mm wide and 10 mm tall, a wide silver stripe down the negative
 * side (the right) with minus signs and arrows pointing at the negative leg, a lit strip on the left, and the dark rubber
 * seal narrowing the bottom. 24 x 40 art pixels, grid cell (0, 0) at world (-14, -88): the legs (x = 0 and 20) come straight
 * down from the bottom edge (y = -8). The value is printed on the sleeve by the part.
 */
export function electroCapSprite(): Sprite {
  return sprite('cap-electro', () => {
    const W = 24
    const H = 40
    const g = new PixelGrid(W, H)
    g.rrect(0, 0, W, H, 4, 'T')
    // sleeve: a lit strip on the left falling off to the right, one tone per column
    const cols = 'DSMTLhhLTTMMSSSMMTTTSSD'
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g.get(x, y) !== '.') g.set(x, y, cols[Math.min(x, cols.length - 1)])
    // the sleeve stops short of the bottom: a narrower rubber seal under it
    g.rect(0, 36, W, 4, '.')
    g.rect(1, 36, W - 2, 4, 'R')
    g.rect(1, 36, W - 2, 1, 'B')
    g.rect(1, 39, W - 2, 1, 'N')
    g.paint(0, 0, W, 1, 'U', 'DSMTLh')
    g.paint(2, 1, W - 4, 1, 'U', 'DSMTLh')
    g.paint(0, 3, W, 1, 'N', 'DSMTLh') // the crimp groove under the top
    // silver stripe on the negative side, shaded like the sleeve
    const stripe = ['I', 'J', 'K', 'P', 'Q', 'O']
    for (let y = 5; y < 36; y++) for (let i = 0; i < 6; i++) g.set(15 + i, y, stripe[i])
    // minus signs and arrows pointing at the negative leg
    for (const y of [8, 17, 26]) {
      g.rect(16, y, 4, 1, 'X')
      g.set(16, y + 3, 'X')
      g.set(19, y + 3, 'X')
      g.set(17, y + 4, 'X')
      g.set(18, y + 4, 'X')
    }
    // the shine: a thin broken strip on the lit side
    for (let y = 6; y < 33; y++) if (y % 9 !== 8) g.set(4, y, 'g')
    for (let y = 8; y < 31; y++) if (y % 9 !== 8) g.set(5, y, 'G')
    return g.build(
      {
        h: '#5a5a66', L: '#44444f', T: '#32323b', M: '#25252c', S: '#1b1b21', D: '#121217', N: '#0b0b0f',
        U: '#4b4b57', g: '#9a9aaa', G: '#6c6c7a',
        R: '#2a2018', B: '#46382b',
        I: '#e6eaf0', J: '#cfd4dc', K: '#b4bac5', P: '#989faa', Q: '#7c8390', O: '#5f6572', X: '#2a2f3a',
      },
      '#05050a',
    )
  })
}
