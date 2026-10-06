// The static part of the scene is painted once into an offscreen canvas that covers the
// whole window. It is always the inside of the company: the real building (rooms, floors,
// back wall) in the middle, and more of the same building - more rooms,
// partitions and corridor - around it, lit exactly like the office.
// Everything is in office coordinates (the canvas is translated by the office offset).
// Partition walls, furniture and people of the real building are dynamic and drawn by
// the view on top.

import { DOORS, ROOMS, WALL_H, type Rect, type RoomId } from '../core/world.ts';
import { paintInterior, type Range } from './decor.ts';
import { carpet, parquet, serverFloor, tiles } from './floors.ts';
import { rect } from './furniture.ts';

/** Where the whiteboard, clock and pigeonholes live on the back wall. */
export const BOARD = { x: 180, y: 8, w: 96, h: 30 };
export const CLOCK = { x: 292, y: 20 };
export const HOLES = { x: 300, y: 12, cols: 4, rows: 3, cw: 10, ch: 8 };

type Ctx = CanvasRenderingContext2D;

export function buildBackground(cw: number, ch: number, ox: number, oy: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const g = c.getContext('2d');
  if (!g) throw new Error('2d canvas unavailable');
  const r: Range = { x0: -ox, x1: cw - ox, y0: -oy, y1: ch - oy };

  g.save();
  g.translate(ox, oy);
  // corridor tile everywhere first; the rooms (real and decorative) are painted over it
  tiles(g, { x: r.x0, y: WALL_H, w: r.x1 - r.x0, h: r.y1 - WALL_H }, 16, '#8996ab', '#8391a7');
  paintInterior(g, r);
  paintBuildingFloors(g);
  paintBackWall(g, r);
  paintRugs(g);
  paintLight(g);
  g.restore();
  return c;
}

// ---------- floors of the real rooms ----------

function paintBuildingFloors(g: Ctx): void {
  const by = (id: RoomId): Rect => (ROOMS.find((rm) => rm.id === id) as { rect: Rect }).rect;
  tiles(g, by('restroom'), 8, '#cfdbe8', '#c2d0e0');
  carpet(g, by('exec'), '#4a3d6b', 3, '#6d5a99');
  carpet(g, by('meeting'), '#43507f', 5);
  tiles(g, by('mail'), 16, '#8e949f', '#868c97');
  tiles(g, by('qa'), 16, '#6aa08a', '#639883');
  serverFloor(g, by('server'));
  parquet(g, by('archive'));
  carpet(g, by('research'), '#3f8790', 9, '#6bb6bf');
  carpet(g, by('production'), '#b08455', 11, '#d4a773');
  tiles(g, by('pantry'), 8, '#e0d2b4', '#d6c7a7');
  // the lobby keeps the corridor tile (it is part of the same open space)
  tiles(g, by('lobby'), 16, '#8996ab', '#8391a7');
  // doorsills: a strip of corridor tile where each door meets its room
  for (const d of DOORS) rect(g, d.cx - 12, d.y, 24, 8, '#a7b2c6');
}

function paintRugs(g: Ctx): void {
  // meeting-room rug under the table
  rect(g, 172, 52, 112, 42, '#2f3a68');
  rect(g, 174, 54, 108, 38, '#3c4880');
  rect(g, 178, 58, 100, 30, '#4a5798');
  // lobby rug under the sofa and coffee table
  rect(g, 190, 172, 96, 50, '#3b2f57');
  rect(g, 192, 174, 92, 46, '#5a4b78');
  rect(g, 196, 178, 84, 38, '#6d5c8f');
  for (let x = 200; x < 276; x += 6) rect(g, x, 180, 3, 34, '#5d4d80');
  // owner's rug
  rect(g, 78, 76, 46, 16, '#2e2250');
  rect(g, 80, 78, 42, 12, '#6d5a99');
}

// ---------- back wall ----------

function paintBackWall(g: Ctx, r: Range): void {
  const x0 = r.x0;
  const width = r.x1 - r.x0;
  rect(g, x0, r.y0, width, WALL_H - r.y0, '#5d6c94');
  // panel seams only on the real wall; the tall part above and beside it is plain wall
  const seamTop = Math.max(r.y0, 0);
  for (let x = Math.ceil(x0 / 24) * 24; x < r.x1; x += 24) rect(g, x, seamTop, 1, WALL_H - 14 - seamTop, '#55638a');
  // wainscot + trims
  rect(g, x0, WALL_H - 14, width, 14, '#46537a');
  rect(g, x0, WALL_H - 15, width, 1, '#8e9cc4');
  rect(g, x0, WALL_H - 3, width, 3, '#2a2f4d');
  rect(g, x0, WALL_H - 4, width, 1, '#3b4468');
  for (let x = Math.ceil(x0 / 24) * 24; x < r.x1; x += 24) rect(g, x, WALL_H - 14, 1, 11, '#3d4970');
  rect(g, x0, r.y0, width, 2, '#6f7fa8');

  // executive suite and QA lab windows
  windowAt(g, 84, 8);
  windowAt(g, 356, 8);
  bookshelf(g, 132, 12);

  // restroom: frosted window
  rect(g, 17, 9, 30, 22, '#2a2f4d');
  rect(g, 19, 11, 26, 18, '#cfe6f5');
  rect(g, 19, 11, 26, 4, '#e6f3fb');
  rect(g, 31, 11, 2, 18, '#2a2f4d');
  rect(g, 17, 31, 30, 3, '#8e9cc4');

  // meeting room: whiteboard
  rect(g, BOARD.x - 2, BOARD.y - 2, BOARD.w + 4, BOARD.h + 4, '#c4cada');
  rect(g, BOARD.x, BOARD.y, BOARD.w, BOARD.h, '#f4f6fa');
  rect(g, BOARD.x - 2, BOARD.y + BOARD.h + 2, BOARD.w + 4, 2, '#9aa3b5');
  rect(g, BOARD.x + 6, BOARD.y + BOARD.h - 5, 9, 2, '#e5484d');
  rect(g, BOARD.x + 17, BOARD.y + BOARD.h - 5, 9, 2, '#4a8fd9');

  // mail room: pigeonholes (mail slots)
  const { x, y, cols, rows, cw, ch } = HOLES;
  rect(g, x - 2, y - 2, cols * cw + 3, rows * ch + 3, '#2a2f4d');
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      rect(g, x + col * cw, y + row * ch, cw - 1, ch - 1, '#1a1d33');
      rect(g, x + col * cw, y + row * ch + ch - 2, cw - 1, 1, '#2f3558');
    }
  }

  // poster in the QA lab
  rect(g, 340, 12, 12, 18, '#2a2f4d');
  rect(g, 341, 13, 10, 16, '#f2d9a0');
  rect(g, 343, 16, 6, 6, '#4a8fd9');
  rect(g, 343, 24, 6, 1, '#9a7a3a');
}

function bookshelf(g: Ctx, x: number, y: number): void {
  rect(g, x, y, 16, 22, '#6d4728');
  for (const sy of [6, 14]) rect(g, x, y + sy, 16, 1, '#4a2f18');
  const colors = ['#e5484d', '#f2c14e', '#4a8fd9', '#2fb36a', '#d96c8c'];
  for (let i = 0; i < 5; i++) {
    rect(g, x + 1 + i * 3, y + 1 + (i % 2), 2, 4 - (i % 2), colors[i]);
    rect(g, x + 1 + i * 3, y + 8 + ((i + 1) % 2), 2, 5 - ((i + 1) % 2), colors[(i + 2) % 5]);
    rect(g, x + 1 + i * 3, y + 16, 2, 5, colors[(i + 4) % 5]);
  }
}

function windowAt(g: Ctx, x: number, y: number): void {
  rect(g, x - 2, y - 2, 40, 28, '#2a2f4d');
  rect(g, x, y, 36, 22, '#a9dcff');
  rect(g, x, y + 12, 36, 10, '#8fcaf5');
  rect(g, x + 4, y + 3, 8, 3, '#ffffff');
  rect(g, x + 22, y + 6, 8, 3, '#ffffff');
  rect(g, x + 17, y, 2, 22, '#2a2f4d');
  rect(g, x, y + 10, 36, 2, '#2a2f4d');
  rect(g, x - 3, y + 22, 42, 3, '#8e9cc4');
}

// ---------- light and shadow ----------

function paintLight(g: Ctx): void {
  g.globalAlpha = 0.06;
  g.fillStyle = '#ffffff';
  for (const wx of [84, 356]) {
    g.beginPath();
    g.moveTo(wx, WALL_H);
    g.lineTo(wx + 36, WALL_H);
    g.lineTo(wx + 70, WALL_H + 56);
    g.lineTo(wx + 34, WALL_H + 56);
    g.closePath();
    g.fill();
  }
  g.globalAlpha = 1;
}
