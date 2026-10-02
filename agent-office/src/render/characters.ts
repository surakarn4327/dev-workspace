// Procedural pixel-art characters. Each sprite is drawn from a handful of
// rectangles, then an automatic 1px outline pass gives it the 8-bit look.
// Sprites are cached per (agent, direction, pose, frame).

import type { Look } from '../core/roster.ts';

export type Dir = 'down' | 'up' | 'left' | 'right';
export type Pose =
  | 'stand'
  | 'walk'
  | 'carry'
  | 'talk'
  | 'sit'
  | 'type'
  | 'think'
  | 'wait'
  | 'review'
  | 'cheer'
  | 'alert';

export const SPR_W = 16;
export const SPR_H = 26;
/** Distance from the sprite's top edge to its feet line. */
export const SPR_FEET = 25;

const OUTLINE = '#1d1b2e';
const EYE = '#1d1b2e';
const SHOE = '#2a2438';
const PAPER = '#f4f1e8';
const GOLD = '#f2c14e';

export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number): number => Math.max(0, Math.min(255, Math.round(v * f)));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

class Pen {
  private g: CanvasRenderingContext2D;
  constructor(g: CanvasRenderingContext2D) {
    this.g = g;
  }
  /** Fill a rect in sprite space (1px outline margin on the left, 2px on top). */
  r(x: number, y: number, w: number, h: number, c: string): void {
    this.g.fillStyle = c;
    this.g.fillRect(x + 1, y + 2, w, h);
  }
}

const cache = new Map<string, HTMLCanvasElement>();

export function getSprite(key: string, look: Look, dir: Dir, pose: Pose, frame: number): HTMLCanvasElement {
  const k = `${key}|${dir}|${pose}|${frame}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = SPR_W;
  c.height = SPR_H;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('2d canvas unavailable');
  if (dir === 'right') {
    g.translate(SPR_W, 0);
    g.scale(-1, 1);
    g.drawImage(getSprite(key, look, 'left', pose, frame), 0, 0);
  } else {
    paint(new Pen(g), look, dir, pose, frame);
    addOutline(g);
  }
  cache.set(k, c);
  return c;
}

function addOutline(g: CanvasRenderingContext2D): void {
  const d = g.getImageData(0, 0, SPR_W, SPR_H).data;
  const solid = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < SPR_W && y < SPR_H && d[(y * SPR_W + x) * 4 + 3] > 0;
  g.fillStyle = OUTLINE;
  for (let y = 0; y < SPR_H; y++) {
    for (let x = 0; x < SPR_W; x++) {
      if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) {
        g.fillRect(x, y, 1, 1);
      }
    }
  }
}

function paint(p: Pen, look: Look, dir: 'down' | 'up' | 'left', pose: Pose, f: number): void {
  const walking = pose === 'walk' || pose === 'carry';
  const sleeve = shade(look.shirt, 0.85);
  const pantsD = shade(look.pants, 0.72);
  let by = 0;
  let la = 0;
  let ra = 0;
  let liftL = 0;
  let liftR = 0;
  if (walking) {
    by = f % 2 === 1 ? -1 : 0;
    if (f === 1) {
      liftL = 1;
      la = 1;
      ra = -1;
    } else if (f === 3) {
      liftR = 1;
      la = -1;
      ra = 1;
    }
  } else if (pose === 'cheer') {
    by = f % 2 === 1 ? -1 : 0;
  }
  const hb = pose === 'wait' ? 1 : by; // head offset (slumps when waiting)
  const closedEyes = pose === 'wait' || (f === 1 && (pose === 'stand' || pose === 'sit' || pose === 'think' || pose === 'review'));
  const mouthOpen = (pose === 'talk' && f === 1) || pose === 'alert';

  if (dir === 'left') {
    paintSide(p, look, pose, f, { by, hb, closedEyes, mouthOpen, sleeve, pantsD });
    return;
  }
  const back = dir === 'up';

  // legs
  p.r(4, 16, 3, 5 - liftL, look.pants);
  p.r(4, 21 - liftL, 3, 2, SHOE);
  p.r(7, 16, 3, 5 - liftR, look.pants);
  p.r(7, 21 - liftR, 3, 2, SHOE);
  p.r(7, 17, 1, 3, pantsD);

  // torso
  p.r(3, 10 + by, 8, 5 - by, look.shirt);
  p.r(3, 15, 8, 1, pantsD);

  // body accessories
  if (!back) {
    if (look.accessory === 'tie') {
      p.r(5, 10 + by, 4, 1, PAPER);
      p.r(6, 11 + by, 2, 4, look.accent);
    } else if (look.accessory === 'lanyard') {
      p.r(5, 10 + by, 1, 4, look.accent);
      p.r(8, 10 + by, 1, 4, look.accent);
      p.r(5, 14 + by, 4, 2, PAPER);
      p.r(6, 15 + by, 2, 1, look.accent);
    } else if (look.accessory === 'bag') {
      for (let i = 0; i < 5; i++) p.r(4 + i, 10 + i + by, 1, 1, look.accent);
    }
  } else if (look.accessory === 'bag') {
    p.r(4, 11 + by, 6, 5, look.accent);
    p.r(4, 11 + by, 6, 2, shade(look.accent, 0.78));
  }

  // arms
  if (pose === 'cheer' || pose === 'alert') {
    const j = f % 2;
    p.r(0, 4 - j, 2, 6, sleeve);
    p.r(0, 2 - j, 2, 2, look.skin);
    p.r(12, 4 - j, 2, 6, sleeve);
    p.r(12, 2 - j, 2, 2, look.skin);
  } else if (pose === 'type' || (pose === 'carry' && !back)) {
    p.r(2, 11, 2, 4, sleeve);
    p.r(10, 11, 2, 4, sleeve);
  } else {
    p.r(1, 10 + by + la, 2, 5, sleeve);
    p.r(1, 15 + by + la, 2, 2, look.skin);
    if (pose === 'think' && !back) {
      p.r(10, 9 + by, 2, 4, sleeve);
      p.r(9, 7 + by, 2, 2, look.skin);
    } else if (pose === 'talk' && f === 1) {
      p.r(11, 8 + by, 2, 4, sleeve);
      p.r(12, 6 + by, 2, 2, look.skin);
    } else if (pose === 'review' && !back) {
      p.r(11, 10 + by, 2, 4, sleeve);
      p.r(11, 14 + by, 2, 2, look.skin);
      p.r(10, 8, 4, 4, OUTLINE);
      p.r(11, 9, 2, 2, '#bfe9ff');
    } else {
      p.r(11, 10 + by + ra, 2, 5, sleeve);
      p.r(11, 15 + by + ra, 2, 2, look.skin);
    }
  }
  if (pose === 'carry' && !back) {
    p.r(4, 11, 6, 5, PAPER);
    p.r(5, 12, 4, 1, '#9aa3b5');
    p.r(5, 14, 3, 1, '#9aa3b5');
  }
  if (look.accessory === 'bag' && !back) p.r(10, 13 + by, 3, 4, look.accent);

  // head
  if (!back) {
    p.r(3, 5 + hb, 8, 5, look.skin);
    if (closedEyes) {
      p.r(5, 7 + hb, 1, 1, EYE);
      p.r(8, 7 + hb, 1, 1, EYE);
    } else {
      p.r(5, 6 + hb, 1, 2, EYE);
      p.r(8, 6 + hb, 1, 2, EYE);
    }
    if (mouthOpen) p.r(6, 8 + hb, 2, 2, '#6b2f33');
    else p.r(6, 8 + hb, 2, 1, '#b5655a');
  } else {
    p.r(3, 5 + hb, 8, 5, look.skin);
  }
  paintHair(p, look, back ? 'up' : 'down', hb);
  if (look.accessory === 'headset') {
    p.r(2, 2 + hb, 10, 1, SHOE);
    p.r(1, 5 + hb, 2, 3, SHOE);
    p.r(11, 5 + hb, 2, 3, SHOE);
    if (!back) p.r(3, 8 + hb, 3, 1, SHOE);
  }
  if (look.crown) paintCrown(p, hb);
}

function paintHair(p: Pen, look: Look, dir: 'down' | 'up', hb: number): void {
  const h = look.hair;
  const hd = shade(h, 0.82);
  const style = look.hairStyle;
  if (dir === 'up') {
    if (style === 'bald') {
      p.r(3, 2 + hb, 8, 8, look.skin);
    } else if (style === 'cap') {
      p.r(3, 7 + hb, 8, 3, look.skin);
      p.r(2, 1 + hb, 10, 6, h);
    } else {
      const len = style === 'long' ? 12 : style === 'bob' ? 9 : 8;
      p.r(2, 1 + hb, 10, len, h);
      p.r(2, 5 + hb, 10, 1, hd);
      if (style === 'bun') p.r(5, 0 + hb, 4, 2, h);
      if (style === 'spiky') spikes(p, hb, h);
    }
    return;
  }
  switch (style) {
    case 'bald':
      p.r(3, 2 + hb, 8, 3, look.skin);
      break;
    case 'cap':
      p.r(2, 1 + hb, 10, 4, h);
      p.r(2, 5 + hb, 10, 1, shade(h, 0.68));
      break;
    default: {
      p.r(2, 1 + hb, 10, 4, h);
      p.r(3, 4 + hb, 8, 1, hd);
      const side = style === 'long' ? 7 : style === 'bob' ? 4 : 3;
      p.r(2, 5 + hb, 1, side, h);
      p.r(11, 5 + hb, 1, side, h);
      if (style === 'bun') p.r(5, 0 + hb, 4, 2, h);
      if (style === 'spiky') spikes(p, hb, h);
    }
  }
}

function spikes(p: Pen, hb: number, c: string): void {
  for (const x of [3, 5, 7, 9]) p.r(x, 0 + hb, 1, 1, c);
}

function paintCrown(p: Pen, hb: number): void {
  p.r(4, 1 + hb, 6, 1, GOLD);
  p.r(4, 0 + hb, 1, 1, GOLD);
  p.r(9, 0 + hb, 1, 1, GOLD);
  p.r(6, 0 + hb, 2, 1, GOLD);
  p.r(6, 1 + hb, 2, 1, '#e5484d');
}

interface SideOpts {
  by: number;
  hb: number;
  closedEyes: boolean;
  mouthOpen: boolean;
  sleeve: string;
  pantsD: string;
}

/** Left-facing profile; the right-facing sprite is its mirror image. */
function paintSide(p: Pen, look: Look, pose: Pose, f: number, o: SideOpts): void {
  const walking = pose === 'walk' || pose === 'carry';
  const swing = walking ? (f === 1 ? 1 : f === 3 ? -1 : 0) : 0;
  const nearX = walking ? 5 - 2 * swing : 5;
  const farX = walking ? 6 + 2 * swing : 6;
  const { by, hb } = o;

  p.r(farX, 16, 3, 5, o.pantsD);
  p.r(farX - 1, 21, 4, 2, SHOE);
  p.r(nearX, 16, 3, 5, look.pants);
  p.r(nearX - 1, 21, 4, 2, SHOE);

  p.r(4, 10 + by, 6, 5 - by, look.shirt);
  p.r(4, 15, 6, 1, o.pantsD);
  if (look.accessory === 'tie') p.r(4, 11 + by, 1, 4, look.accent);
  if (look.accessory === 'lanyard') p.r(4, 10 + by, 1, 4, look.accent);
  if (look.accessory === 'bag') p.r(8, 12 + by, 3, 4, look.accent);

  if (pose === 'carry') {
    p.r(2, 12, 4, 3, o.sleeve);
    p.r(0, 12, 4, 4, PAPER);
    p.r(1, 13, 2, 1, '#9aa3b5');
  } else if (pose === 'talk' && f === 1) {
    p.r(3, 9, 3, 3, o.sleeve);
    p.r(2, 8, 2, 2, look.skin);
  } else {
    const ax = 5 + (walking ? -swing * 2 : 0);
    p.r(ax, 10 + by, 3, 5, o.sleeve);
    p.r(ax, 15 + by, 3, 2, look.skin);
  }

  p.r(3, 5 + hb, 6, 5, look.skin);
  p.r(2, 7 + hb, 1, 1, look.skin);
  if (o.closedEyes) p.r(4, 7 + hb, 1, 1, EYE);
  else p.r(4, 6 + hb, 1, 2, EYE);
  if (o.mouthOpen) p.r(3, 9 + hb, 1, 1, '#6b2f33');

  const h = look.hair;
  switch (look.hairStyle) {
    case 'bald':
      p.r(3, 2 + hb, 7, 3, look.skin);
      break;
    case 'cap':
      p.r(3, 1 + hb, 8, 4, h);
      p.r(0, 4 + hb, 5, 1, shade(h, 0.68));
      break;
    default: {
      p.r(3, 1 + hb, 8, 4, h);
      const back = look.hairStyle === 'long' ? 8 : look.hairStyle === 'bob' ? 5 : 4;
      p.r(8, 5 + hb, 3, back, h);
      if (look.hairStyle === 'bun') p.r(8, 0 + hb, 3, 2, h);
      if (look.hairStyle === 'spiky') spikes(p, hb, h);
    }
  }
  if (look.accessory === 'headset') {
    p.r(3, 2 + hb, 8, 1, SHOE);
    p.r(6, 5 + hb, 3, 3, SHOE);
    p.r(2, 8 + hb, 2, 1, SHOE);
  }
  if (look.crown) paintCrown(p, hb);
}
