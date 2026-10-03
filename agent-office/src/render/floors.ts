// Floor textures shared by the main building and the decorative rooms around it.

import type { Rect } from '../core/world.ts';
import { shade } from './characters.ts';
import { rect } from './furniture.ts';

type Ctx = CanvasRenderingContext2D;

/** Small deterministic PRNG so textures and decor are stable between runs. */
export function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function carpet(g: Ctx, rc: Rect, color: string, seed: number, border?: string): void {
  const rand = rng(seed);
  rect(g, rc.x, rc.y, rc.w, rc.h, color);
  for (let i = 0; i < (rc.w * rc.h) / 70; i++) {
    rect(
      g,
      rc.x + Math.floor(rand() * rc.w),
      rc.y + Math.floor(rand() * rc.h),
      1,
      1,
      rand() < 0.5 ? shade(color, 1.12) : shade(color, 0.9),
    );
  }
  if (border) {
    rect(g, rc.x + 1, rc.y + 1, rc.w - 2, 1, border);
    rect(g, rc.x + 1, rc.y + rc.h - 2, rc.w - 2, 1, border);
    rect(g, rc.x + 1, rc.y + 1, 1, rc.h - 2, border);
    rect(g, rc.x + rc.w - 2, rc.y + 1, 1, rc.h - 2, border);
  }
}

/** Checkerboard tiles of `size` px; the pattern is anchored to the rectangle. */
export function tiles(g: Ctx, rc: Rect, size: number, a: string, b: string): void {
  for (let y = 0; y < rc.h; y += size) {
    for (let x = 0; x < rc.w; x += size) {
      const alt = (Math.floor(x / size) + Math.floor(y / size)) % 2 === 0;
      rect(g, rc.x + x, rc.y + y, Math.min(size, rc.w - x), Math.min(size, rc.h - y), alt ? a : b);
    }
  }
}

export function parquet(g: Ctx, rc: Rect): void {
  rect(g, rc.x, rc.y, rc.w, rc.h, '#9a7650');
  for (let y = 0; y < rc.h; y += 4) {
    rect(g, rc.x, rc.y + y, rc.w, 1, '#86643f');
    const off = (y / 4) % 2 ? 7 : 0;
    for (let x = off; x < rc.w; x += 14) rect(g, rc.x + x, rc.y + y, 1, 4, '#86643f');
  }
}

export function serverFloor(g: Ctx, rc: Rect): void {
  rect(g, rc.x, rc.y, rc.w, rc.h, '#2d3340');
  for (let x = 0; x < rc.w; x += 8) rect(g, rc.x + x, rc.y, 1, rc.h, '#3a4252');
  for (let y = 0; y < rc.h; y += 8) rect(g, rc.x, rc.y + y, rc.w, 1, '#3a4252');
  // a cable tray in front of the racks
  rect(g, rc.x, rc.y + 32, rc.w, 4, '#1a1e28');
  rect(g, rc.x, rc.y + 33, rc.w, 1, '#f2c14e');
}
