// The rest of the building. When the window is bigger than the office, the extra space
// is not "outside": it is more of the same building - more rooms, partitions and a corridor
// that carry on past the edge of the screen. Nobody walks here, so it is all static scenery.
//
// The plan repeats the real one: bands of rooms (rows 6-11 and 17-27) around a corridor
// (rows 13-15) to the left and right of the office, and further blocks of rooms below it.

import { COLS, ROWS, type Rect } from '../core/world.ts';
import { drawCabinet, drawChair, drawDesk, drawPlant, drawPrinter, drawTable, rect } from './furniture.ts';
import { carpet, rng, tiles } from './floors.ts';
import { drawCoffeeTable, drawCounter, drawFridge, drawPantryTable, drawShelf, drawSofa, drawWallCell } from './rooms.ts';

type Ctx = CanvasRenderingContext2D;

type Kind = 'open' | 'lounge' | 'storage' | 'meeting' | 'copy' | 'cafe';

interface DecorRoom {
  kind: Kind;
  /** Cell range, inclusive. */
  x0: number;
  x1: number;
  r0: number;
  r1: number;
  seed: number;
}

export interface Range {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const WIDTHS = [11, 9, 13, 10, 12, 9];
const KINDS: Kind[] = ['open', 'lounge', 'storage', 'meeting', 'copy', 'cafe', 'open', 'storage'];

interface Item {
  y: number;
  draw: () => void;
}

const key = (c: number, r: number): string => `${c},${r}`;

export function paintInterior(g: Ctx, r: Range): void {
  const c0 = Math.floor(r.x0 / 8) - 2;
  const c1 = Math.ceil(r.x1 / 8) + 2;
  const rowMax = Math.ceil(r.y1 / 8) + 1;
  const walls = new Set<string>();
  const rooms: DecorRoom[] = [];
  const addWall = (c: number, rw: number): void => {
    walls.add(key(c, rw));
  };
  const gaps = new Set<string>();

  // Rooms to the left and right of the office, in the same two bands as the real ones.
  const bands = [
    { r0: 6, r1: 11, door: 12 },
    { r0: 17, r1: 27, door: 16 },
  ];
  bands.forEach((b, bi) => {
    for (const side of [-1, 1] as const) {
      const edge = side < 0 ? -1 : COLS; // first wall column (the office's own side wall)
      for (let rw = b.r0; rw <= b.r1; rw++) addWall(edge, rw);
      let c = side < 0 ? -2 : COLS + 1;
      for (let i = 0; side < 0 ? c >= c0 : c <= c1; i++) {
        const w = WIDTHS[(i + bi * 2 + (side < 0 ? 0 : 3)) % WIDTHS.length];
        const x0 = side < 0 ? c - w + 1 : c;
        const x1 = side < 0 ? c : c + w - 1;
        rooms.push({ kind: KINDS[(i * 3 + bi * 2 + (side < 0 ? 1 : 4)) % KINDS.length], x0, x1, r0: b.r0, r1: b.r1, seed: bi * 97 + i * 13 + (side < 0 ? 0 : 5) });
        const wallCol = side < 0 ? x0 - 1 : x1 + 1;
        for (let rw = b.r0; rw <= b.r1; rw++) addWall(wallCol, rw);
        const mid = Math.floor((x0 + x1) / 2);
        for (const d of [-1, 0, 1]) gaps.add(key(mid + d, b.door));
        c = side < 0 ? x0 - 2 : x1 + 2;
      }
    }
  });
  // the partitions along the corridor, with a door gap to each room
  for (const rw of [12, 16]) {
    for (let c = c0; c <= c1; c++) {
      if (c >= 0 && c < COLS) continue; // the office draws its own
      if (!gaps.has(key(c, rw))) addWall(c, rw);
    }
  }

  // Blocks of rooms below the office, repeating every 12 rows.
  for (let k = 0; ROWS + k * 12 <= rowMax; k++) {
    const wallRow = ROWS + k * 12;
    for (let c = c0; c <= c1; c++) addWall(c, wallRow);
    const r0 = wallRow + 1;
    const r1 = wallRow + 11;
    let c = c0;
    for (let i = k; c <= c1; i++) {
      const w = WIDTHS[(i + k) % WIDTHS.length];
      const x1 = c + w - 1;
      rooms.push({ kind: KINDS[(i * 5 + k * 2) % KINDS.length], x0: c, x1, r0, r1, seed: 500 + k * 31 + i });
      for (let rw = r0; rw <= r1; rw++) addWall(x1 + 1, rw);
      c = x1 + 2;
    }
  }

  const items: Item[] = [];
  for (const room of rooms) paintRoom(g, room, items);

  for (const k of walls) {
    const [c, rw] = k.split(',').map(Number);
    if (c >= 0 && c < COLS && rw >= 0 && rw < ROWS) continue;
    const flags = {
      n: walls.has(key(c, rw - 1)),
      s: walls.has(key(c, rw + 1)),
      e: walls.has(key(c + 1, rw)),
      w: walls.has(key(c - 1, rw)),
    };
    items.push({ y: flags.s ? rw * 8 + 4 : (rw + 1) * 8, draw: () => drawWallCell(g, c, rw, flags) });
  }
  items.sort((a, b) => a.y - b.y);
  for (const it of items) it.draw();
}

const rectOf = (rm: DecorRoom): Rect => ({
  x: rm.x0 * 8,
  y: rm.r0 * 8,
  w: (rm.x1 - rm.x0 + 1) * 8,
  h: (rm.r1 - rm.r0 + 1) * 8,
});

function paintRoom(g: Ctx, rm: DecorRoom, items: Item[]): void {
  const R = rectOf(rm);
  const rand = rng(rm.seed + 1);
  const push = (y: number, draw: () => void): void => {
    items.push({ y, draw });
  };

  switch (rm.kind) {
    case 'open': {
      carpet(g, R, '#55688a', rm.seed, '#7f93b5');
      const rows = R.h >= 80 ? 2 : 1;
      const n = Math.max(1, Math.floor((R.w - 8) / 38));
      const x0 = R.x + Math.floor((R.w - n * 38 + 4) / 2);
      for (let row = 0; row < rows; row++) {
        for (let i = 0; i < n; i++) {
          const d: Rect = { x: x0 + i * 38, y: R.y + 14 + row * 40, w: 34, h: 20 };
          push(d.y + 5, () => drawChair(g, d));
          push(d.y + d.h, () =>
            drawDesk(g, d, {
              accent: ['#3fb6c6', '#f09a3e', '#8f6bd9', '#4fc27a'][(i + row) % 4],
              typing: false,
              frame: 0,
              inbox: rand() < 0.4 ? 1 : 0,
              skin: '#e0a878',
              active: false,
            }),
          );
        }
      }
      const px = R.x + R.w - 18;
      push(R.y + R.h - 4, () => drawPlant(g, { x: px, y: R.y + R.h - 26, w: 14, h: 18 }));
      break;
    }
    case 'lounge': {
      carpet(g, R, '#6a4f7a', rm.seed, '#8d72a0');
      rect(g, R.x + 6, R.y + 4, R.w - 12, R.h - 8, '#58406a');
      const sofa: Rect = { x: R.x + Math.floor((R.w - 44) / 2), y: R.y + 6, w: 44, h: 18 };
      push(sofa.y + sofa.h, () => drawSofa(g, sofa));
      if (R.h >= 44) {
        const table: Rect = { x: sofa.x + 8, y: sofa.y + 26, w: 28, h: 10 };
        push(table.y + table.h, () => drawCoffeeTable(g, table));
      }
      push(R.y + R.h - 4, () => drawPlant(g, { x: R.x + 4, y: R.y + R.h - 26, w: 14, h: 18 }));
      break;
    }
    case 'storage': {
      tiles(g, R, 16, '#8e949f', '#868c97');
      const n = Math.max(1, Math.floor((R.w - 6) / 24));
      for (let i = 0; i < n; i++) {
        const sh: Rect = { x: R.x + 3 + i * 24, y: R.y + 4, w: 20, h: 40 };
        const fill = 6 + Math.floor(rand() * 10);
        push(sh.y + sh.h, () => drawShelf(g, sh, fill));
      }
      if (R.h >= 70) push(R.y + R.h - 4, () => drawCabinet(g, R.x + 8, R.y + R.h - 28));
      break;
    }
    case 'meeting': {
      carpet(g, R, '#43507f', rm.seed);
      const tw = Math.min(96, Math.floor((R.w - 20) / 2) * 2);
      const t: Rect = { x: R.x + Math.floor((R.w - tw) / 2), y: R.y + Math.floor((R.h - 26) / 2), w: tw, h: 26 };
      rect(g, t.x - 6, t.y - 6, t.w + 12, t.h + 10, '#3a4678');
      rect(g, t.x - 4, t.y - 4, t.w + 8, t.h + 6, '#4a5798');
      push(t.y + t.h, () => drawTable(g, t));
      break;
    }
    case 'copy': {
      tiles(g, R, 16, '#8996ab', '#8391a7');
      push(R.y + 26, () => drawPrinter(g, { x: R.x + 8, y: R.y + 10, w: 22, h: 16 }, rand() < 0.5));
      push(R.y + 30, () => drawCabinet(g, R.x + 40, R.y + 8));
      if (R.w >= 96) push(R.y + 30, () => drawCabinet(g, R.x + 60, R.y + 8));
      push(R.y + R.h - 4, () => drawPlant(g, { x: R.x + R.w - 20, y: R.y + R.h - 26, w: 14, h: 18 }));
      break;
    }
    case 'cafe': {
      tiles(g, R, 8, '#e0d2b4', '#d6c7a7');
      push(R.y + 26, () => drawCounter(g, { x: R.x + 6, y: R.y + 8, w: 22, h: 18 }, false));
      push(R.y + 32, () => drawFridge(g, { x: R.x + R.w - 22, y: R.y + 6, w: 14, h: 26 }));
      if (R.h >= 60) {
        const t: Rect = { x: R.x + Math.floor((R.w - 24) / 2), y: R.y + R.h - 30, w: 24, h: 16 };
        push(t.y + t.h, () => drawPantryTable(g, t));
      }
      break;
    }
  }
}
