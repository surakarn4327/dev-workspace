// Furniture drawn in a 3/4 top-down view: a lighter top face and a darker front face.

import type { Rect } from '../core/world.ts';

const WOOD = {
  top: '#cf9a5f',
  topHi: '#e6b878',
  topEdge: '#a8743f',
  front: '#a06c3c',
  frontHi: '#b97f4a',
  frontLow: '#7a5230',
  drawer: '#8c5d33',
  handle: '#e8c97e',
};

function rect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string): void {
  g.fillStyle = c;
  g.fillRect(Math.round(x), Math.round(y), w, h);
}

function shadow(g: CanvasRenderingContext2D, x: number, y: number, w: number, h = 3): void {
  g.globalAlpha = 0.22;
  rect(g, x, y, w, h, '#0c0a18');
  g.globalAlpha = 1;
}

export interface DeskOpts {
  accent: string;
  /** Hands tap the keyboard. */
  typing: boolean;
  /** Typing animation frame (0/1). */
  frame: number;
  /** Papers stacked in the inbox. */
  inbox: number;
  skin: string;
  /** Laptop screen is lit. */
  active: boolean;
}

export function drawChair(g: CanvasRenderingContext2D, d: Rect): void {
  const cx = d.x + d.w / 2;
  rect(g, cx - 8, d.y - 11, 16, 13, '#3b4a78');
  rect(g, cx - 8, d.y - 11, 16, 1, '#5a6fa6');
  rect(g, cx - 7, d.y - 10, 1, 11, '#4a5c92');
}

export function drawDesk(g: CanvasRenderingContext2D, d: Rect, o: DeskOpts): void {
  const { x, y, w, h } = d;
  const cx = x + w / 2;
  shadow(g, x + 2, y + h, w);

  // top face
  rect(g, x, y, w, 8, WOOD.top);
  rect(g, x, y, w, 1, WOOD.topHi);
  rect(g, x, y + 7, w, 1, WOOD.topEdge);

  // keyboard
  rect(g, cx - 6, y + 2, 12, 4, '#2d3347');
  rect(g, cx - 5, y + 3, 10, 1, '#4a5373');
  rect(g, cx - 5, y + 5, 10, 1, '#3a4260');

  // inbox stack
  if (o.inbox > 0) {
    const n = Math.min(o.inbox, 4);
    rect(g, x + 3, y + 5 - n, 9, n + 1, '#f4f1e8');
    rect(g, x + 3, y + 5 - n, 9, 1, '#ffffff');
    rect(g, x + 3, y + 5, 9, 1, '#b9b4a3');
    rect(g, x + 5, y + 4 - n, 5, 1, '#4a8fd9');
  }

  // hands on the keyboard
  if (o.typing) {
    const a = o.frame === 0 ? 0 : 1;
    rect(g, cx - 5, y + 2 + a, 2, 2, o.skin);
    rect(g, cx + 3, y + 3 - a, 2, 2, o.skin);
  }

  // front panel
  rect(g, x, y + 8, w, h - 8, WOOD.front);
  rect(g, x, y + 8, w, 1, WOOD.frontHi);
  rect(g, x, y + h - 1, w, 1, WOOD.frontLow);
  rect(g, x, y + 8, 1, h - 8, WOOD.frontHi);
  rect(g, x + w - 1, y + 8, 1, h - 8, WOOD.frontLow);
  const dw = Math.floor((w - 12) / 2);
  rect(g, x + 3, y + 11, dw, h - 14, WOOD.drawer);
  rect(g, x + w - 3 - dw, y + 11, dw, h - 14, WOOD.drawer);
  rect(g, x + 3 + Math.floor(dw / 2) - 1, y + 13, 3, 1, WOOD.handle);
  rect(g, x + w - 3 - Math.floor(dw / 2) - 2, y + 13, 3, 1, WOOD.handle);
  // department name plate
  rect(g, cx - 5, y + 10, 10, 3, '#1d1b2e');
  rect(g, cx - 4, y + 11, 8, 1, o.accent);

  // laptop (back of the lid faces the camera)
  const lx = x + w - 15;
  rect(g, lx + 1, y + 3, 12, 2, '#6f7889');
  rect(g, lx + 1, y - 5, 11, 8, '#8d96a5');
  rect(g, lx + 1, y - 5, 11, 1, '#b2bacb');
  rect(g, lx + 1, y + 2, 11, 1, '#6f7889');
  rect(g, lx + 5, y - 2, 3, 3, o.active ? '#7cd6ff' : '#5b6578');
  if (o.active) {
    g.globalAlpha = 0.18;
    rect(g, lx - 1, y - 7, 15, 12, '#7cd6ff');
    g.globalAlpha = 1;
  }
}

export function drawTable(g: CanvasRenderingContext2D, r: Rect): void {
  const { x, y, w, h } = r;
  shadow(g, x + 3, y + h, w, 4);
  rect(g, x + 1, y, w - 2, 18, '#bf8b55');
  rect(g, x, y + 1, w, 16, '#bf8b55');
  rect(g, x + 1, y, w - 2, 1, '#dfb27b');
  rect(g, x + 2, y + 2, w - 4, 1, '#cc9a63');
  rect(g, x + 1, y + 17, w - 2, 1, '#97663a');
  rect(g, x, y + 18, w, h - 18, '#8f6238');
  rect(g, x, y + 18, w, 1, '#a8774a');
  rect(g, x, y + h - 1, w, 1, '#6d4728');
  for (const lx of [x + 4, x + w - 8]) rect(g, lx, y + 20, 4, h - 20, '#6d4728');
  // things on the table
  rect(g, x + 14, y + 5, 10, 7, '#f4f1e8');
  rect(g, x + 15, y + 7, 8, 1, '#9aa3b5');
  rect(g, x + 15, y + 9, 6, 1, '#9aa3b5');
  rect(g, x + 38, y + 4, 8, 6, '#4a8fd9');
  rect(g, x + 38, y + 4, 8, 1, '#7ab0ee');
  rect(g, x + 58, y + 6, 4, 4, '#f4f1e8');
  rect(g, x + 59, y + 7, 2, 2, '#6b3f1d');
  rect(g, x + 70, y + 5, 12, 7, '#f2c14e');
  rect(g, x + 71, y + 7, 10, 1, '#c99a2c');
}

export function drawPlant(g: CanvasRenderingContext2D, r: Rect): void {
  const { x, y, w, h } = r;
  shadow(g, x + 1, y + h - 1, w, 2);
  const potH = 7;
  rect(g, x + 2, y + h - potH, w - 4, potH, '#b5683a');
  rect(g, x + 1, y + h - potH, w - 2, 2, '#cf8050');
  rect(g, x + 2, y + h - 1, w - 4, 1, '#8a4d28');
  const leafH = h - potH;
  rect(g, x + 2, y + 3, w - 4, leafH - 2, '#3f9b52');
  rect(g, x + 1, y + 5, w - 2, leafH - 6, '#3f9b52');
  rect(g, x + 4, y, w - 8, 5, '#4fb563');
  rect(g, x + 3, y + 4, 3, 2, '#6fd07f');
  rect(g, x + w - 6, y + 7, 3, 2, '#2f7a41');
  rect(g, x + 5, y + 8, 2, 3, '#2f7a41');
}

export function drawCooler(g: CanvasRenderingContext2D, r: Rect): void {
  const { x, y, w } = r;
  shadow(g, x + 1, y + r.h - 1, w, 2);
  rect(g, x + 1, y, w - 2, 9, '#8fd3ff');
  rect(g, x + 2, y + 1, 2, 6, '#c8ecff');
  rect(g, x, y + 9, w, 11, '#d9e4ef');
  rect(g, x, y + 9, w, 1, '#ffffff');
  rect(g, x + 3, y + 12, 3, 2, '#4a8fd9');
  rect(g, x + 7, y + 12, 3, 2, '#e5484d');
  rect(g, x, y + 19, w, 1, '#9fb0c4');
}

export function drawPrinter(g: CanvasRenderingContext2D, r: Rect, busy: boolean): void {
  const { x, y, w } = r;
  shadow(g, x + 1, y + r.h - 1, w, 2);
  rect(g, x + 3, y, w - 6, 5, '#f4f1e8');
  rect(g, x, y + 5, w, 10, '#9aa3b5');
  rect(g, x, y + 5, w, 1, '#c9d0dd');
  rect(g, x + 3, y + 8, w - 6, 3, '#2d3347');
  rect(g, x + w - 5, y + 12, 2, 2, busy ? '#2fb36a' : '#4a5373');
  rect(g, x, y + 14, w, 2, '#6f7889');
}

/** A tall filing cabinet that stands against the wall. */
export function drawCabinet(g: CanvasRenderingContext2D, x: number, y: number): void {
  shadow(g, x + 1, y + 21, 16, 2);
  rect(g, x, y, 16, 22, '#8f98ab');
  rect(g, x, y, 16, 1, '#c3cad9');
  rect(g, x, y + 21, 16, 1, '#5f6879');
  for (const dy of [2, 8, 14]) {
    rect(g, x + 2, y + dy, 12, 5, '#a9b2c4');
    rect(g, x + 2, y + dy + 4, 12, 1, '#6f7889');
    rect(g, x + 6, y + dy + 2, 4, 1, '#e8c97e');
  }
}
