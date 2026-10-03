// Furniture and walls for the rooms of the building, drawn in the same 3/4 view as the desks.

import type { Rect } from '../core/world.ts';
import { rect, shadow } from './furniture.ts';

const PAPER = '#f4f1e8';

// ---------- half-height partition walls ----------

const WALL = {
  top: '#cdd6e8',
  topHi: '#eef2fb',
  topSh: '#a7b3cf',
  front: '#6f81ab',
  frontHi: '#8798c0',
  base: '#4a5780',
};

export interface WallFlags {
  n: boolean;
  s: boolean;
  e: boolean;
  w: boolean;
}

/**
 * One 8x8 cell of a waist-high partition: a lit top surface and, where nothing continues to
 * the south, a front face. Neighbour flags join runs together seamlessly.
 */
export function drawWallCell(g: CanvasRenderingContext2D, col: number, row: number, f: WallFlags): void {
  const x = col * 8;
  const y = row * 8;
  const topH = f.s ? 8 : 6;
  rect(g, x, y - 3, 8, topH, WALL.top);
  if (!f.s) {
    rect(g, x, y + 3, 8, 5, WALL.front);
    rect(g, x, y + 3, 8, 1, WALL.frontHi);
    rect(g, x, y + 7, 8, 1, WALL.base);
    rect(g, x + 3, y + 4, 1, 3, WALL.frontHi);
    rect(g, x + 6, y + 4, 1, 3, WALL.frontHi);
    if (!f.w) rect(g, x, y + 3, 1, 5, WALL.frontHi);
    if (!f.e) rect(g, x + 7, y + 3, 1, 5, WALL.base);
  }
  if (!f.n) rect(g, x, y - 3, 8, 1, WALL.topHi);
  if (!f.w) rect(g, x, y - 3, 1, topH, WALL.topSh);
  if (!f.e) rect(g, x + 7, y - 3, 1, topH, WALL.topSh);
}

// ---------- lobby ----------

export function drawSofa(g: CanvasRenderingContext2D, r: Rect): void {
  const { x, y, w, h } = r;
  shadow(g, x + 2, y + h, w, 3);
  rect(g, x, y, w, 9, '#2f5a85');
  rect(g, x, y, w, 1, '#4d7fb0');
  for (const s of [15, 29]) rect(g, x + s, y + 1, 1, 8, '#26496d');
  rect(g, x + 4, y + 9, w - 8, h - 9, '#4a80b5');
  rect(g, x + 4, y + 9, w - 8, 1, '#6ba0d4');
  for (const s of [15, 29]) rect(g, x + s, y + 10, 1, h - 10, '#3d6a95');
  rect(g, x, y + 3, 5, h - 3, '#2f5a85');
  rect(g, x + w - 5, y + 3, 5, h - 3, '#2f5a85');
  rect(g, x, y + 3, 5, 1, '#4d7fb0');
  rect(g, x + w - 5, y + 3, 5, 1, '#4d7fb0');
  rect(g, x, y + h - 1, w, 1, '#1f3d5b');
  rect(g, x + 7, y + 3, 7, 6, '#e8c46a');
  rect(g, x + 7, y + 3, 7, 1, '#f6dc92');
  rect(g, x + w - 14, y + 3, 7, 6, '#d96c8c');
  rect(g, x + w - 14, y + 3, 7, 1, '#eb97ae');
}

export function drawCoffeeTable(g: CanvasRenderingContext2D, r: Rect): void {
  const { x, y, w, h } = r;
  shadow(g, x + 2, y + h, w, 2);
  rect(g, x, y, w, 6, '#c9955f');
  rect(g, x, y, w, 1, '#e3b27c');
  rect(g, x, y + 6, w, h - 6, '#8f6238');
  rect(g, x + 2, y + 6, 2, h - 6, '#6d4728');
  rect(g, x + w - 4, y + 6, 2, h - 6, '#6d4728');
  rect(g, x + 5, y + 1, 3, 3, PAPER);
  rect(g, x + 5, y + 1, 3, 1, '#6b3f1d');
  rect(g, x + 13, y + 1, 9, 4, '#e5484d');
  rect(g, x + 14, y + 2, 7, 1, '#f4f1e8');
}

// ---------- restroom ----------

export function drawStall(g: CanvasRenderingContext2D, r: Rect, occupied: boolean): void {
  const { x, y, w, h } = r;
  // stall floor (darker tile) so the white toilet stands out
  rect(g, x + 2, y + 2, w - 4, h - 2, '#a9bdd6');
  rect(g, x + 2, y + 2, w - 4, 1, '#8fa5c2');
  // toilet: tank against the wall, bowl in front
  rect(g, x + 7, y + 3, 10, 6, '#f4f8fc');
  rect(g, x + 7, y + 3, 10, 1, '#ffffff');
  rect(g, x + 7, y + 8, 10, 1, '#c9d6e6');
  rect(g, x + 8, y + 9, 8, 8, '#eef3f9');
  rect(g, x + 9, y + 10, 6, 5, '#ffffff');
  rect(g, x + 10, y + 11, 4, 3, '#cfdcec');
  rect(g, x + 8, y + 16, 8, 1, '#b5c4d8');
  // side panels
  rect(g, x, y, 2, h, '#5f7aa3');
  rect(g, x + w - 2, y, 2, h, '#5f7aa3');
  rect(g, x, y, 2, 1, '#9db5d6');
  rect(g, x + w - 2, y, 2, 1, '#9db5d6');
  // half-height door in a fresh teal so each stall reads at a glance
  rect(g, x + 2, y + h - 12, w - 4, 12, '#5fb3a1');
  rect(g, x + 2, y + h - 12, w - 4, 1, '#9be0d0');
  for (const dy of [h - 8, h - 5]) rect(g, x + 4, y + dy, w - 8, 1, '#478f80');
  rect(g, x + w - 7, y + h - 9, 2, 2, occupied ? '#e5484d' : '#f2f6fb');
  rect(g, x + 2, y + h - 1, w - 4, 1, '#37705f');
}

// ---------- pantry ----------

export function drawCounter(g: CanvasRenderingContext2D, r: Rect, steaming: boolean): void {
  const { x, y, w, h } = r;
  shadow(g, x + 1, y + h, w, 3);
  rect(g, x, y, w, 7, '#d7c8a8');
  rect(g, x, y, w, 1, '#efe3c8');
  rect(g, x, y + 7, w, h - 7, '#8c6a46');
  rect(g, x, y + 7, w, 1, '#a88259');
  rect(g, x + Math.floor(w / 2), y + 8, 1, h - 8, '#6d5236');
  rect(g, x + 4, y + 10, 3, 1, '#e8c97e');
  rect(g, x + w - 8, y + 10, 3, 1, '#e8c97e');
  rect(g, x, y + h - 1, w, 1, '#5a4129');
  // sink
  rect(g, x + 2, y + 2, 8, 4, '#7f93ab');
  rect(g, x + 3, y + 3, 6, 2, '#5d7089');
  rect(g, x + 5, y - 1, 2, 3, '#c9d0dd');
  // coffee machine
  rect(g, x + 13, y - 8, 8, 12, '#2a2f3d');
  rect(g, x + 13, y - 8, 8, 2, '#4a5166');
  rect(g, x + 15, y - 5, 2, 2, steaming ? '#2fb36a' : '#e5484d');
  rect(g, x + 14, y + 2, 6, 2, '#11151d');
  rect(g, x + 16, y, 3, 3, PAPER);
  rect(g, x + 16, y, 3, 1, '#6b3f1d');
}

export function drawFridge(g: CanvasRenderingContext2D, r: Rect): void {
  const { x, y, w, h } = r;
  shadow(g, x + 1, y + h, w, 3);
  rect(g, x, y, w, h, '#dfe5ee');
  rect(g, x + w - 2, y, 2, h, '#b9c3d2');
  rect(g, x, y, w, 1, '#ffffff');
  rect(g, x, y + 9, w, 1, '#9aa6b8');
  rect(g, x + 2, y + 3, 1, 4, '#6f7889');
  rect(g, x + 2, y + 12, 1, 6, '#6f7889');
  rect(g, x + 6, y + 4, 3, 3, '#e5484d');
  rect(g, x + 8, y + 14, 3, 2, '#f2c14e');
  rect(g, x, y + h - 1, w, 1, '#8895a8');
}

export function drawPantryTable(g: CanvasRenderingContext2D, r: Rect): void {
  const { x, y, w, h } = r;
  shadow(g, x + 2, y + h, w, 2);
  rect(g, x + 2, y, w - 4, 9, '#e2cfa8');
  rect(g, x, y + 1, w, 7, '#e2cfa8');
  rect(g, x + 2, y, w - 4, 1, '#f1e3c2');
  rect(g, x + 2, y + 8, w - 4, 1, '#b9a57e');
  rect(g, x + 10, y + 9, 4, 5, '#8f6238');
  rect(g, x + 6, y + 14, 12, 2, '#6d4728');
  rect(g, x + 8, y + 2, 3, 3, '#e5484d');
  rect(g, x + 14, y + 3, 5, 3, PAPER);
  // two stools
  for (const sx of [x - 7, x + w + 1]) {
    rect(g, sx, y + 5, 6, 4, '#c25a60');
    rect(g, sx, y + 5, 6, 1, '#de8086');
    rect(g, sx + 2, y + 9, 2, 5, '#6f7889');
    rect(g, sx, y + 14, 6, 1, '#4a5166');
  }
}

// ---------- server room ----------

/** What the real machinery is doing, as a rack shows it. */
export interface RackNet {
  /** 0..1: a model call is (or just was) running. */
  traffic: number;
  /** The free AI quota is used up: the racks overheat. */
  hot: boolean;
}

/** A server rack whose LEDs blink faster the busier the office is, and flicker with every real model call. */
export function drawRack(g: CanvasRenderingContext2D, r: Rect, t: number, load: number, error: boolean, seed: number, net: RackNet = { traffic: 0, hot: false }): void {
  const { x, y, w, h } = r;
  shadow(g, x + 1, y + h, w, 3);
  rect(g, x, y, w, h, '#1f2430');
  rect(g, x, y, w, 1, '#3b4256');
  rect(g, x + w - 1, y, 1, h, '#151a24');
  for (let i = 0; i < 5; i++) {
    const uy = y + 3 + i * 5;
    rect(g, x + 1, uy, w - 2, 4, '#2d3446');
    rect(g, x + 1, uy, w - 2, 1, '#3c455c');
    rect(g, x + 10, uy + 2, 4, 1, '#151a24');
    for (let k = 0; k < 3; k++) {
      const phase = Math.floor(t * (1.5 + load * 3.5 + net.traffic * 6) + i * 3 + k * 5 + seed * 7);
      const on = load > 0 || net.traffic > 0 ? phase % 3 !== 0 : phase % 11 === 0 || k === 0;
      let color = on ? '#2fb36a' : '#17402a';
      if (k === 1 && on && (load > 1 || net.traffic > 0.4)) color = '#f2c14e';
      if (net.hot) color = (Math.floor(t * 3) + i + k + seed) % 2 ? '#f2c14e' : '#7a4a12'; // overheating: amber flicker
      if (error && ((i + seed) % 3 === 0 || k === 2)) color = Math.floor(t * 4) % 2 ? '#e5484d' : '#6b1d21';
      rect(g, x + 2 + k * 3, uy + 1, 2, 2, color);
    }
  }
  rect(g, x, y + h - 2, w, 2, '#11151d');
}

// ---------- archive ----------

const BOX_COLORS = ['#e5484d', '#4a8fd9', '#f2c14e', '#2fb36a', '#d96c8c', '#f09a3e'];
export const SHELF_CAPACITY = 16;

/** Archive shelf unit; `filled` file boxes sit on it (bottom shelf first). */
export function drawShelf(g: CanvasRenderingContext2D, r: Rect, filled: number): void {
  const { x, y, w, h } = r;
  shadow(g, x + 1, y + h, w, 3);
  rect(g, x, y, w, h, '#7a5230');
  rect(g, x + 1, y + 1, w - 2, h - 2, '#3f2b1a');
  rect(g, x, y, w, 1, '#a06c3c');
  for (let level = 0; level < 4; level++) {
    const boardY = y + 10 + level * 10 - (level === 3 ? 1 : 0);
    rect(g, x + 1, boardY, w - 2, 1, '#9c6a3b');
    for (let s = 0; s < 4; s++) {
      const idx = (3 - level) * 4 + s;
      if (idx >= filled) continue;
      const bx = x + 2 + s * 4;
      const top = boardY - 8;
      const tall = 6 + ((idx * 5) % 3);
      const c = BOX_COLORS[(idx * 7 + level) % BOX_COLORS.length];
      rect(g, bx, boardY - tall, 3, tall, c);
      rect(g, bx, boardY - tall, 3, 1, '#ffffff22');
      rect(g, bx + 1, top + 4, 1, 1, PAPER);
    }
  }
}
