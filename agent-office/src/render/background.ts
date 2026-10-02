// The static part of the room (wall, floor, rugs, windows) is painted once into
// an offscreen canvas; the view blits it every frame and draws dynamic things on top.

import { DESKS, H, W, WALL_H } from '../core/world.ts';

/** Where the whiteboard, clock and pigeonholes live on the wall. */
export const BOARD = { x: 128, y: 8, w: 96, h: 30 };
export const CLOCK = { x: 240, y: 20 };
export const HOLES = { x: 256, y: 12, cols: 4, rows: 3, cw: 10, ch: 8 };

function rect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string): void {
  g.fillStyle = c;
  g.fillRect(x, y, w, h);
}

/** Small deterministic PRNG so the carpet texture is stable between runs. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function buildBackground(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  if (!g) throw new Error('2d canvas unavailable');

  paintFloor(g);
  paintWall(g);
  paintRugs(g);
  paintLight(g);
  return c;
}

function paintFloor(g: CanvasRenderingContext2D): void {
  const rand = rng(7);
  for (let y = WALL_H; y < H; y += 16) {
    for (let x = 0; x < W; x += 16) {
      const alt = ((x + y) / 16) % 2 === 0;
      rect(g, x, y, 16, 16, alt ? '#74869f' : '#6e809a');
    }
  }
  // carpet speckle
  for (let i = 0; i < 700; i++) {
    const x = Math.floor(rand() * W);
    const y = WALL_H + Math.floor(rand() * (H - WALL_H));
    rect(g, x, y, 1, 1, rand() < 0.5 ? '#7f92ab' : '#657792');
  }
}

function paintWall(g: CanvasRenderingContext2D): void {
  rect(g, 0, 0, W, WALL_H, '#5d6c94');
  for (let x = 0; x < W; x += 24) rect(g, x, 0, 1, WALL_H - 14, '#55638a');
  // wainscot + trims
  rect(g, 0, WALL_H - 14, W, 14, '#46537a');
  rect(g, 0, WALL_H - 15, W, 1, '#8e9cc4');
  rect(g, 0, WALL_H - 3, W, 3, '#2a2f4d');
  rect(g, 0, WALL_H - 4, W, 1, '#3b4468');
  for (let x = 0; x < W; x += 24) rect(g, x, WALL_H - 14, 1, 11, '#3d4970');
  rect(g, 0, 0, W, 2, '#6f7fa8');

  windowAt(g, 18, 8);
  windowAt(g, 62, 8);
  windowAt(g, 330, 8);

  // whiteboard
  rect(g, BOARD.x - 2, BOARD.y - 2, BOARD.w + 4, BOARD.h + 4, '#c4cada');
  rect(g, BOARD.x, BOARD.y, BOARD.w, BOARD.h, '#f4f6fa');
  rect(g, BOARD.x - 2, BOARD.y + BOARD.h + 2, BOARD.w + 4, 2, '#9aa3b5');
  rect(g, BOARD.x + 6, BOARD.y + BOARD.h - 5, 9, 2, '#e5484d');
  rect(g, BOARD.x + 17, BOARD.y + BOARD.h - 5, 9, 2, '#4a8fd9');

  // pigeonholes (mail slots)
  const { x, y, cols, rows, cw, ch } = HOLES;
  rect(g, x - 2, y - 2, cols * cw + 3, rows * ch + 3, '#2a2f4d');
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      rect(g, x + col * cw, y + r * ch, cw - 1, ch - 1, '#1a1d33');
      rect(g, x + col * cw, y + r * ch + ch - 2, cw - 1, 1, '#2f3558');
    }
  }
  // a poster and a tiny shelf near the QA desk
  rect(g, 300, 10, 18, 22, '#2a2f4d');
  rect(g, 301, 11, 16, 20, '#f2d9a0');
  rect(g, 304, 14, 10, 8, '#4a8fd9');
  rect(g, 304, 24, 10, 1, '#9a7a3a');
  rect(g, 304, 27, 7, 1, '#9a7a3a');
  // bookshelf above the owner's desk side wall
  rect(g, 104, 12, 16, 22, '#6d4728');
  for (const sy of [18, 26]) rect(g, 104, sy, 16, 1, '#4a2f18');
  const colors = ['#e5484d', '#f2c14e', '#4a8fd9', '#2fb36a', '#d96c8c'];
  for (let i = 0; i < 5; i++) {
    rect(g, 105 + i * 3, 13 + (i % 2), 2, 4 - (i % 2), colors[i]);
    rect(g, 105 + i * 3, 20 + ((i + 1) % 2), 2, 5 - ((i + 1) % 2), colors[(i + 2) % 5]);
    rect(g, 105 + i * 3, 28, 2, 5, colors[(i + 4) % 5]);
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
  // reception mat
  rect(g, 154, 196, 44, 18, '#7a2f35');
  rect(g, 156, 198, 40, 14, '#a6464d');
  rect(g, 160, 202, 32, 6, '#7a2f35');
  rect(g, 162, 203, 28, 4, '#c25a60');
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

function paintLight(g: CanvasRenderingContext2D): void {
  g.globalAlpha = 0.07;
  g.fillStyle = '#ffffff';
  for (const wx of [18, 62, 330]) {
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
