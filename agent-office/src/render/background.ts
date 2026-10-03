// The static part of the scene is painted once into an offscreen canvas that covers
// the whole window: the fixed 384x224 office in the middle, and the same office
// "continuing" around it (floor, wall, windows, plants, cabinets) so any screen shape
// is filled. Everything here is in office coordinates (the canvas is translated).

import { DESKS, H, W, WALL_H } from '../core/world.ts';
import { drawCabinet, drawPlant } from './furniture.ts';

/** Where the whiteboard, clock and pigeonholes live on the wall. */
export const BOARD = { x: 128, y: 8, w: 96, h: 30 };
export const CLOCK = { x: 240, y: 20 };
export const HOLES = { x: 256, y: 12, cols: 4, rows: 3, cw: 10, ch: 8 };

/** Visible area in office coordinates. */
interface Range {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

function rect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string): void {
  g.fillStyle = c;
  g.fillRect(x, y, w, h);
}

/** Small deterministic PRNG so textures and decor are stable between runs. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function buildBackground(cw: number, ch: number, ox: number, oy: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const g = c.getContext('2d');
  if (!g) throw new Error('2d canvas unavailable');
  const r: Range = { x0: -ox, x1: cw - ox, y0: -oy, y1: ch - oy };

  g.save();
  g.translate(ox, oy);
  paintFloor(g, r);
  paintWall(g, r);
  paintRugs(g);
  paintMargins(g, r);
  paintLight(g, r);
  g.restore();
  return c;
}

function paintFloor(g: CanvasRenderingContext2D, r: Range): void {
  const rand = rng(7);
  const startX = Math.floor(r.x0 / 16) * 16;
  for (let y = WALL_H; y < r.y1; y += 16) {
    for (let x = startX; x < r.x1; x += 16) {
      const alt = (Math.floor(x / 16) + Math.floor((y - WALL_H) / 16)) % 2 === 0;
      rect(g, x, y, 16, 16, alt ? '#74869f' : '#6e809a');
    }
  }
  // carpet speckle, same density wherever the floor extends
  const speckles = Math.floor(((r.x1 - r.x0) * (r.y1 - WALL_H)) / 100);
  for (let i = 0; i < speckles; i++) {
    const x = r.x0 + Math.floor(rand() * (r.x1 - r.x0));
    const y = WALL_H + Math.floor(rand() * (r.y1 - WALL_H));
    rect(g, x, y, 1, 1, rand() < 0.5 ? '#7f92ab' : '#657792');
  }
}

/** Windows on the wall: the office's own three, then the same rhythm continuing outwards. */
function windowXs(r: Range): number[] {
  const xs = [18, 62, 330];
  for (let x = 18 - 44; x + 40 > r.x0; x -= 44) xs.push(x);
  for (let x = W + 8; x < r.x1; x += 44) xs.push(x);
  return xs;
}

function paintWall(g: CanvasRenderingContext2D, r: Range): void {
  const width = r.x1 - r.x0;
  rect(g, r.x0, r.y0, width, WALL_H - r.y0, '#5d6c94');
  for (let x = Math.ceil(r.x0 / 24) * 24; x < r.x1; x += 24) rect(g, x, r.y0, 1, WALL_H - 14 - r.y0, '#55638a');
  // wainscot + trims
  rect(g, r.x0, WALL_H - 14, width, 14, '#46537a');
  rect(g, r.x0, WALL_H - 15, width, 1, '#8e9cc4');
  rect(g, r.x0, WALL_H - 3, width, 3, '#2a2f4d');
  rect(g, r.x0, WALL_H - 4, width, 1, '#3b4468');
  for (let x = Math.ceil(r.x0 / 24) * 24; x < r.x1; x += 24) rect(g, x, WALL_H - 14, 1, 11, '#3d4970');
  rect(g, r.x0, r.y0, width, 2, '#6f7fa8');
  // a crown moulding line when the wall is tall (extra room above the office)
  if (r.y0 < -8) rect(g, r.x0, 2, width, 1, '#4d5b83');

  for (const x of windowXs(r)) windowAt(g, x, 8);
  // tall screens get a taller wall: more rows of windows stacked above the office
  const lattice = 18 + Math.floor((r.x0 - 18) / 44) * 44;
  for (let y = -36; y >= r.y0 + 6; y -= 36) {
    for (let x = lattice; x < r.x1; x += 44) windowAt(g, x, y);
  }

  // whiteboard
  rect(g, BOARD.x - 2, BOARD.y - 2, BOARD.w + 4, BOARD.h + 4, '#c4cada');
  rect(g, BOARD.x, BOARD.y, BOARD.w, BOARD.h, '#f4f6fa');
  rect(g, BOARD.x - 2, BOARD.y + BOARD.h + 2, BOARD.w + 4, 2, '#9aa3b5');
  rect(g, BOARD.x + 6, BOARD.y + BOARD.h - 5, 9, 2, '#e5484d');
  rect(g, BOARD.x + 17, BOARD.y + BOARD.h - 5, 9, 2, '#4a8fd9');

  // pigeonholes (mail slots)
  const { x, y, cols, rows, cw, ch } = HOLES;
  rect(g, x - 2, y - 2, cols * cw + 3, rows * ch + 3, '#2a2f4d');
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      rect(g, x + col * cw, y + row * ch, cw - 1, ch - 1, '#1a1d33');
      rect(g, x + col * cw, y + row * ch + ch - 2, cw - 1, 1, '#2f3558');
    }
  }
  // a poster near the QA desk
  rect(g, 300, 10, 18, 22, '#2a2f4d');
  rect(g, 301, 11, 16, 20, '#f2d9a0');
  rect(g, 304, 14, 10, 8, '#4a8fd9');
  rect(g, 304, 24, 10, 1, '#9a7a3a');
  rect(g, 304, 27, 7, 1, '#9a7a3a');
  bookshelf(g, 104, 12);
}

function bookshelf(g: CanvasRenderingContext2D, x: number, y: number): void {
  rect(g, x, y, 16, 22, '#6d4728');
  for (const sy of [6, 14]) rect(g, x, y + sy, 16, 1, '#4a2f18');
  const colors = ['#e5484d', '#f2c14e', '#4a8fd9', '#2fb36a', '#d96c8c'];
  for (let i = 0; i < 5; i++) {
    rect(g, x + 1 + i * 3, y + 1 + (i % 2), 2, 4 - (i % 2), colors[i]);
    rect(g, x + 1 + i * 3, y + 8 + ((i + 1) % 2), 2, 5 - ((i + 1) % 2), colors[(i + 2) % 5]);
    rect(g, x + 1 + i * 3, y + 16, 2, 5, colors[(i + 4) % 5]);
  }
}

function windowAt(g: CanvasRenderingContext2D, x: number, y: number): void {
  rect(g, x - 2, y - 2, 40, 28, '#2a2f4d');
  rect(g, x, y, 36, 22, '#a9dcff');
  rect(g, x, y + 12, 36, 10, '#8fcaf5');
  rect(g, x + 4, y + 3, 8, 3, '#ffffff');
  rect(g, x + 22, y + 6, 8, 3, '#ffffff');
  rect(g, x + 17, y, 2, 22, '#2a2f4d');
  rect(g, x, y + 10, 36, 2, '#2a2f4d');
  rect(g, x - 3, y + 22, 42, 3, '#8e9cc4');
}

function paintRugs(g: CanvasRenderingContext2D): void {
  // central rug
  rect(g, 140, 126, 104, 56, '#2a4f58');
  rect(g, 142, 128, 100, 52, '#3b6f78');
  rect(g, 146, 132, 92, 44, '#4a8590');
  for (let x = 150; x < 234; x += 6) rect(g, x, 134, 3, 40, '#438089');
  rect(g, 152, 148, 80, 12, '#2a4f58');
  rect(g, 154, 150, 76, 8, '#3b6f78');
  // meeting-table rug
  rect(g, 118, 54, 116, 50, '#4a4f7c');
  rect(g, 120, 56, 112, 46, '#5a609a');
  // department zones
  g.globalAlpha = 0.2;
  rect(g, 2, 98, 98, 94, '#3fb6c6');
  rect(g, 284, 98, 98, 94, '#f09a3e');
  g.globalAlpha = 1;
  for (const [zx, c] of [
    [2, '#3fb6c6'],
    [284, '#f09a3e'],
  ] as const) {
    g.globalAlpha = 0.55;
    rect(g, zx, 98, 98, 1, c);
    rect(g, zx, 191, 98, 1, c);
    rect(g, zx, 98, 1, 94, c);
    rect(g, zx + 97, 98, 1, 94, c);
    g.globalAlpha = 1;
  }
  // executive area runner under the top desks
  g.globalAlpha = 0.18;
  rect(g, DESKS.owner.x - 8, 48, 104, 44, '#8f6bd9');
  g.globalAlpha = 1;
}

/** Scenery around the fixed office: an entrance runner, rugs, cabinets and plants. */
function paintMargins(g: CanvasRenderingContext2D, r: Range): void {
  const rand = rng(11);
  const outside = (x: number, y: number, w: number, h: number): boolean =>
    x + w <= -4 || x >= W + 4 || y >= H + 4 || y + h <= 0;

  // Entrance: a glass door in a front wall along the bottom edge, when the window leaves room for it.
  const hasDoor = r.y1 - H >= 30;
  const floorBottom = hasDoor ? r.y1 - DOOR_WALL_H : r.y1;
  if (hasDoor) paintDoorWall(g, r);

  // soft rugs in wide side margins
  g.globalAlpha = 0.55;
  for (const side of [-1, 1]) {
    const w = side < 0 ? -r.x0 : r.x1 - W;
    if (w < 56) continue;
    const x = side < 0 ? r.x0 + 8 : W + 8;
    rect(g, x, 112, Math.min(w - 16, 72), 54, '#4a4f7c');
    rect(g, x + 2, 114, Math.min(w - 16, 72) - 4, 50, '#5a609a');
  }
  g.globalAlpha = 1;

  // filing cabinets against the extended wall
  for (let x = Math.floor(r.x0 / 52) * 52 + 6; x < r.x1 - 16; x += 52) {
    if (!outside(x, WALL_H - 10, 16, 22) || x + 16 > r.x1) continue;
    if (rand() < 0.5) drawCabinet(g, x, WALL_H - 10);
  }

  // plants dotted around the edges of the floor
  const plantAt = (x: number, y: number): void => {
    if (!outside(x, y, 14, 18) || x < r.x0 + 2 || x + 14 > r.x1 - 2 || y + 18 > floorBottom - 2) return;
    if (x + 14 > 150 && x < 202 && y >= H - 12) return; // keep the way to the door clear
    drawPlant(g, { x, y, w: 14, h: 18 });
  };
  for (let y = 78; y < floorBottom - 20; y += 58) {
    for (let x = r.x0 + 6; x < r.x1 - 18; x += 46) {
      if (rand() < 0.42) plantAt(x + Math.floor(rand() * 10), y + Math.floor(rand() * 12));
    }
  }
}

const DOOR_WALL_H = 22;

/** The front wall along the bottom edge, with a glass door in the middle. */
function paintDoorWall(g: CanvasRenderingContext2D, r: Range): void {
  const top = r.y1 - DOOR_WALL_H;
  const width = r.x1 - r.x0;
  rect(g, r.x0, top, width, DOOR_WALL_H, '#46537a');
  rect(g, r.x0, top, width, 2, '#8e9cc4');
  rect(g, r.x0, top + 2, width, 1, '#2a2f4d');
  rect(g, r.x0, r.y1 - 4, width, 4, '#2a2f4d');
  for (let x = Math.ceil(r.x0 / 24) * 24; x < r.x1; x += 24) rect(g, x, top + 3, 1, DOOR_WALL_H - 7, '#3d4970');
  // door frame, two glass leaves and push bars
  const dx = 150;
  const dw = 52;
  rect(g, dx - 2, top - 2, dw + 4, DOOR_WALL_H + 2, '#2a2f4d');
  rect(g, dx, top, dw, DOOR_WALL_H - 3, '#a9dcff');
  rect(g, dx, top + 9, dw, DOOR_WALL_H - 12, '#8fcaf5');
  rect(g, dx + dw / 2 - 1, top, 2, DOOR_WALL_H - 3, '#2a2f4d');
  rect(g, dx + 6, top + 2, 8, 2, '#ffffff');
  rect(g, dx + dw / 2 + 8, top + 5, 8, 2, '#ffffff');
  rect(g, dx + dw / 2 - 6, top + 8, 3, 1, '#e8c97e');
  rect(g, dx + dw / 2 + 3, top + 8, 3, 1, '#e8c97e');
  rect(g, dx - 3, r.y1 - 4, dw + 6, 4, '#8e9cc4');
}

function paintLight(g: CanvasRenderingContext2D, r: Range): void {
  g.globalAlpha = 0.07;
  g.fillStyle = '#ffffff';
  for (const wx of windowXs(r)) {
    g.beginPath();
    g.moveTo(wx, WALL_H);
    g.lineTo(wx + 36, WALL_H);
    g.lineTo(wx + 78, WALL_H + 70);
    g.lineTo(wx + 42, WALL_H + 70);
    g.closePath();
    g.fill();
  }
  g.globalAlpha = 1;
}
