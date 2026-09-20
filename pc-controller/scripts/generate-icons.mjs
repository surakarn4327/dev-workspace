// Generates placeholder PWA icons (plain PNG encoder using only Node's built-in zlib —
// no image libraries available/needed). Produces a simple "power button" glyph:
// a navy square background with an orange ring that has a notch at the top and a
// short stem through the notch (the universal power-button symbol).
//
// Re-run with: node scripts/generate-icons.mjs
// Feel free to replace the generated files in public/icons/ with real artwork later —
// these exist only so the PWA manifest has valid icons and the app is installable.

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, '..', 'public', 'icons')
mkdirSync(outDir, { recursive: true })

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

/** @param {number} size @param {(x:number,y:number)=>[number,number,number,number]} draw */
function makePng(size, draw) {
  const stride = 1 + size * 4
  const raw = Buffer.alloc(size * stride)
  for (let y = 0; y < size; y++) {
    const rowStart = y * stride
    raw[rowStart] = 0 // filter type: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = draw(x, y)
      const off = rowStart + 1 + x * 4
      raw[off] = r
      raw[off + 1] = g
      raw[off + 2] = b
      raw[off + 3] = a
    }
  }
  const idat = deflateSync(raw)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

const NAVY = [15, 23, 42, 255]
const ORANGE = [249, 115, 22, 255]

function drawPowerIcon(size) {
  const cx = size / 2
  const cy = size / 2
  const ringOuter = size * 0.32
  const ringInner = size * 0.26
  const notchHalfWidth = size * 0.045
  const stemTop = cy - size * 0.4
  const stemBottom = cy - ringInner * 0.2
  const stemHalfWidth = size * 0.025

  return (x, y) => {
    const dx = x - cx
    const dy = y - cy
    const dist = Math.sqrt(dx * dx + dy * dy)

    const inStem = Math.abs(dx) <= stemHalfWidth && y >= stemTop && y <= stemBottom
    if (inStem) return ORANGE

    const inNotch = Math.abs(dx) <= notchHalfWidth && dy < 0
    const inRing = dist >= ringInner && dist <= ringOuter
    if (inRing && !inNotch) return ORANGE

    return NAVY
  }
}

const targets = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'icon-512-maskable.png', size: 512 },
]

for (const { file, size } of targets) {
  const png = makePng(size, drawPowerIcon(size))
  writeFileSync(join(outDir, file), png)
  console.log(`wrote ${file} (${size}x${size})`)
}
