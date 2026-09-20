// One-off generator for PWA PNG icons (power-button glyph on solid background).
// Run manually with `node scripts/gen-icons.mjs` if icons ever need regenerating;
// not part of the build pipeline.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const BG = [0x16, 0x1a, 0x23]; // dark slate
const FG = [0x35, 0xd0, 0x7f]; // green (matches "online" accent)

function drawPowerGlyph(size) {
  const cx = size / 2;
  const cy = size / 2;
  const ringR = size * 0.28;
  const ringW = size * 0.07;
  const lineW = size * 0.07;
  const lineTop = size * 0.16;
  const lineBottom = size * 0.5;

  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const onRing = dist > ringR - ringW / 2 && dist < ringR + ringW / 2 && y > cy - ringR * 0.3;
      const onLine = Math.abs(dx) < lineW / 2 && y > lineTop && y < lineBottom;
      const fg = onRing || onLine;
      const [r, g, b] = fg ? FG : BG;
      const o = (y * size + x) * 4;
      pixels[o] = r;
      pixels[o + 1] = g;
      pixels[o + 2] = b;
      pixels[o + 3] = 255;
    }
  }
  return pixels;
}

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(size) {
  const raw = drawPowerGlyph(size);
  const stride = size * 4;
  const withFilters = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    withFilters[y * (stride + 1)] = 0; // filter type 0 (none)
    raw.copy(withFilters, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = deflateSync(withFilters);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

for (const size of [192, 512]) {
  writeFileSync(new URL(`../public/icon-${size}.png`, import.meta.url), encodePng(size));
  console.log(`wrote public/icon-${size}.png`);
}
