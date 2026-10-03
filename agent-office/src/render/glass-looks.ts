// Candidate looks for the full-height glass partitions. Used by the preview page
// (glass-preview.html) so the owner can compare them; the chosen one then replaces the
// drawing in rooms.ts.

import { rect } from './furniture.ts';

type Ctx = CanvasRenderingContext2D;

export interface GlassLook {
  id: string;
  title: string;
  note: string;
  /** Rail and post colours. */
  frame: string;
  frameHi: string;
  frameSh: string;
  railH: number;
  /** Mullion every N cells (0 = only at the ends) and their width. */
  postEvery: number;
  postW: number;
  tint: string;
  tintAlpha: number;
  /** Denser glass towards the bottom. */
  gradient?: boolean;
  /** Fine checker over the glass instead of a flat tint. */
  dither?: boolean;
  /** Frosted band (heights measured up from the floor). */
  frost?: { from: number; to: number; alpha: number };
  /** Horizontal bars across the glass (heights up from the floor). */
  bars?: number[];
  /** Solid plate at the foot of the wall. */
  kick?: { h: number; color: string; hi: string };
  /** 1px outline round the glass, pixel-art style. */
  outline?: string;
  glintEvery: number;
}

export const LOOKS: GlassLook[] = [
  {
    id: 'A',
    title: 'A · Pixel outline',
    note: 'Clear glass drawn the classic pixel-art way: a dark navy outline, almost no tint, tiny glints.',
    frame: '#1f2d4d',
    frameHi: '#8fb3e8',
    frameSh: '#141d36',
    railH: 4,
    postEvery: 3,
    postW: 2,
    tint: '#d4f0ff',
    tintAlpha: 0.1,
    outline: '#1f2d4d',
    glintEvery: 4,
  },
  {
    id: 'B',
    title: 'B · Blue gradient',
    note: 'Cool blue glass that gets denser towards the floor, light steel frame. Looks like tinted office glass.',
    frame: '#c4d4ec',
    frameHi: '#ffffff',
    frameSh: '#8fa3c4',
    railH: 4,
    postEvery: 0,
    postW: 2,
    tint: '#6fb9e6',
    tintAlpha: 0.4,
    gradient: true,
    glintEvery: 3,
  },
  {
    id: 'C',
    title: 'C · Black steel grid',
    note: 'Loft style: slim black steel frames with bars, very clear glass, dark kick plate.',
    frame: '#202838',
    frameHi: '#5a6a88',
    frameSh: '#10151f',
    railH: 3,
    postEvery: 3,
    postW: 2,
    tint: '#d7efff',
    tintAlpha: 0.1,
    bars: [11, 21],
    kick: { h: 4, color: '#2a3446', hi: '#44546f' },
    glintEvery: 3,
  },
  {
    id: 'D',
    title: 'D · Frosted lower half',
    note: 'The typical meeting-room look: frosted lower half for privacy, clear glass above, aluminium frame.',
    frame: '#e6ecf5',
    frameHi: '#ffffff',
    frameSh: '#b9c4d6',
    railH: 4,
    postEvery: 0,
    postW: 2,
    tint: '#bfe6f6',
    tintAlpha: 0.14,
    frost: { from: 3, to: 15, alpha: 0.62 },
    kick: { h: 3, color: '#9aa8c2', hi: '#c1cce0' },
    glintEvery: 4,
  },
  {
    id: 'E',
    title: 'E · Department tint',
    note: 'White frame, glass tinted with the department colour (here the executive purple), so rooms are told apart at a glance.',
    frame: '#ffffff',
    frameHi: '#ffffff',
    frameSh: '#d8c9f0',
    railH: 3,
    postEvery: 3,
    postW: 1,
    tint: '#b48cff',
    tintAlpha: 0.3,
    gradient: true,
    glintEvery: 4,
  },
  {
    id: 'F',
    title: 'F · Warm wood frame',
    note: 'Clear glass in a wooden frame with a wood kick panel, to match the desks and make the office feel warmer.',
    frame: '#a86f3c',
    frameHi: '#d9a066',
    frameSh: '#7a4f28',
    railH: 5,
    postEvery: 3,
    postW: 2,
    tint: '#e8f6ff',
    tintAlpha: 0.13,
    kick: { h: 8, color: '#8f6238', hi: '#b97f4a' },
    glintEvery: 3,
  },
  {
    id: 'G',
    title: 'G · Dithered glass',
    note: 'Very 8-bit: the glass is a fine white checker (retro "see-through" dither) with a thin pale frame.',
    frame: '#cfd8ea',
    frameHi: '#ffffff',
    frameSh: '#9aa8c2',
    railH: 3,
    postEvery: 0,
    postW: 2,
    tint: '#ffffff',
    tintAlpha: 0.0,
    dither: true,
    kick: { h: 3, color: '#8896b2', hi: '#aab6cf' },
    glintEvery: 0,
  },
];

/** A run of `cells` 8px cells of glass wall, standing on `base`, `fh` pixels tall. */
export function drawGlassRun(
  g: Ctx,
  look: GlassLook,
  x0: number,
  base: number,
  cells: number,
  fh = 30,
  splitPost = false,
): void {
  const w = cells * 8;
  const kick = look.kick?.h ?? 0;
  const top = base - fh;
  const glassTop = top;
  const glassBottom = base - kick;
  const glassH = glassBottom - glassTop;

  // glass body
  if (look.dither) {
    g.globalAlpha = 0.3;
    for (let y = 0; y < glassH; y++) {
      for (let x = 0; x < w; x++) {
        if ((x + y) % 2 === 0) rect(g, x0 + x, glassTop + y, 1, 1, '#eaf6ff');
      }
    }
    g.globalAlpha = 1;
  } else if (look.gradient) {
    const bands = Math.ceil(glassH / 3);
    for (let b = 0; b < bands; b++) {
      g.globalAlpha = look.tintAlpha * (0.45 + (b / bands) * 1.05);
      rect(g, x0, glassTop + b * 3, w, 3, look.tint);
    }
    g.globalAlpha = 1;
  } else {
    g.globalAlpha = look.tintAlpha;
    rect(g, x0, glassTop, w, glassH, look.tint);
    g.globalAlpha = 1;
  }

  // frosted band
  if (look.frost) {
    const fy1 = base - kick - look.frost.from;
    const fy0 = base - kick - look.frost.to;
    g.globalAlpha = look.frost.alpha * 0.55;
    rect(g, x0, fy0, w, fy1 - fy0, '#f4f8ff');
    g.globalAlpha = look.frost.alpha;
    for (let y = fy0; y < fy1; y++) {
      for (let x = 0; x < w; x++) {
        if ((x + y) % 3 === 0) rect(g, x0 + x, y, 1, 1, '#ffffff');
      }
    }
    g.globalAlpha = 1;
    rect(g, x0, fy0, w, 1, look.frameHi);
    rect(g, x0, fy1 - 1, w, 1, look.frameHi);
  }

  // bars
  for (const h of look.bars ?? []) rect(g, x0, base - kick - h, w, 1, look.frame);

  // glints
  if (look.glintEvery > 0) {
    g.globalAlpha = 0.5;
    for (let c = 1; c < cells; c += look.glintEvery) {
      const gx = x0 + c * 8 - 2;
      for (let i = 0; i < 6; i++) rect(g, gx + i, glassTop + 4 + i, 2, 1, '#ffffff');
    }
    g.globalAlpha = 1;
  }

  // outline round the glass (pixel-art style)
  if (look.outline) {
    rect(g, x0, glassBottom - 1, w, 1, look.outline);
    rect(g, x0, glassTop, w, 1, look.outline);
  }

  // mullions
  const post = (px: number, pw: number): void => {
    rect(g, px, top - look.railH, pw, fh + look.railH - kick, look.frame);
    rect(g, px, top - look.railH, 1, fh + look.railH - kick, look.frameHi);
    rect(g, px + pw - 1, top - look.railH, 1, fh + look.railH - kick, look.frameSh);
  };
  post(x0, 2);
  post(x0 + w - 2, 2);
  if (look.postEvery > 0) for (let c = look.postEvery; c < cells; c += look.postEvery) post(x0 + c * 8, look.postW);
  if (splitPost) post(x0 + w / 2 - 1, 2);

  // rail on top
  rect(g, x0, top - look.railH, w, look.railH, look.frame);
  rect(g, x0, top - look.railH, w, 1, look.frameHi);
  rect(g, x0, top - 1, w, 1, look.frameSh);

  // kick plate
  if (look.kick) {
    rect(g, x0, base - kick, w, kick, look.kick.color);
    rect(g, x0, base - kick, w, 1, look.kick.hi);
    rect(g, x0, base - 1, w, 1, look.frameSh);
  }
}

/** A closed pair of doors in the same look (a 24px doorway). */
export function drawDoorPair(g: Ctx, look: GlassLook, cx: number, base: number, fh = 30): void {
  drawGlassRun(g, look, cx - 12, base, 3, fh, true);
  const hy = base - Math.floor(fh / 2) - 2;
  rect(g, cx - 4, hy, 2, 4, '#e8c97e');
  rect(g, cx + 2, hy, 2, 4, '#e8c97e');
}
