// The lobby printer shows the day's quota: a pile of printed pages and, when it ran out, a bare tray and a red light.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PILE_MAX, drawPrinter, pileHeight } from './furniture.ts';

interface Painted {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}
function canvas(): { g: CanvasRenderingContext2D; painted: Painted[] } {
  const painted: Painted[] = [];
  let color = '';
  const g = {
    globalAlpha: 1,
    set fillStyle(c: string) {
      color = c;
    },
    get fillStyle() {
      return color;
    },
    fillRect(x: number, y: number, w: number, h: number) {
      painted.push({ x, y, w, h, color });
    },
  } as unknown as CanvasRenderingContext2D;
  return { g, painted };
}

const R = { x: 186, y: 160, w: 22, h: 16 };

test('the pile starts at nothing, shows any use, and never grows past its height', () => {
  assert.equal(pileHeight(0, null), 0);
  assert.equal(pileHeight(1, null), 1);
  assert.equal(pileHeight(6, null), 1);
  assert.equal(pileHeight(7, null), 2);
  assert.equal(pileHeight(10_000, null), PILE_MAX);
});

test('once the daily limit is known the pile is a share of it, full at the limit', () => {
  assert.equal(pileHeight(50, 100), PILE_MAX / 2);
  assert.equal(pileHeight(100, 100), PILE_MAX);
  assert.equal(pileHeight(150, 100), PILE_MAX);
  assert.equal(pileHeight(1, 1000), 1);
});

test('printed pages are drawn beside the printer, one pixel row each, and none when nothing was printed', () => {
  const pile = (n: number): Painted[] => {
    const { g, painted } = canvas();
    drawPrinter(g, R, false, { pile: n, empty: false, t: 0 });
    return painted.filter((p) => p.x === R.x + R.w + 1 && p.w === 6);
  };
  assert.equal(pile(0).length, 0);
  assert.ok(pile(5).length >= 5);
  assert.ok(pile(10).length > pile(5).length);
  const tops = pile(7).map((p) => p.y);
  assert.ok(Math.min(...tops) >= R.y + 15 - 7 - 1, 'the pile is as tall as asked');
});

test('with the paper gone the tray is bare and the light blinks red; otherwise it is green while working', () => {
  const light = (over: { empty: boolean; busy: boolean; t: number }): string => {
    const { g, painted } = canvas();
    drawPrinter(g, R, over.busy, { pile: 0, empty: over.empty, t: over.t });
    const l = painted.find((p) => p.x === R.x + R.w - 5 && p.y === R.y + 12 && p.w === 2);
    return l?.color ?? '';
  };
  assert.equal(light({ empty: false, busy: true, t: 0 }), '#2fb36a');
  assert.equal(light({ empty: false, busy: false, t: 0 }), '#4a5373');
  const blink = new Set([0, 0.2, 0.4, 0.6].map((t) => light({ empty: true, busy: true, t })));
  assert.deepEqual([...blink].sort(), ['#4a1a1c', '#e5484d']);

  const tray = (empty: boolean): boolean => {
    const { g, painted } = canvas();
    drawPrinter(g, R, false, { pile: 0, empty, t: 0 });
    return painted.some((p) => p.x === R.x + 3 && p.y === R.y && p.h === 5 && p.color === '#f4f1e8');
  };
  assert.equal(tray(false), true, 'a sheet sits in the tray');
  assert.equal(tray(true), false, 'the sheet is gone');
});

test('the printer still draws with no paper information at all', () => {
  const { g, painted } = canvas();
  assert.doesNotThrow(() => drawPrinter(g, R, true));
  assert.ok(painted.length > 5);
});
