// The server racks show the real machinery. The drawing is checked through a recording canvas:
// what colour went where, never a real screen.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HelperKind } from '../core/types.ts';
import { drawRack, linkLights } from './rooms.ts';

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

const GREEN = '#2fb36a';
const GREEN_DIM = '#17402a';
const AMBER = '#f2c14e';
const RED = '#e5484d';

const RACK = { x: 412, y: 48, w: 16, h: 30 };
function rackColors(over: { traffic?: number; hot?: boolean; load?: number; error?: boolean; t?: number }): Set<string> {
  const { g, painted } = canvas();
  drawRack(g, RACK, over.t ?? 0.5, over.load ?? 0, over.error ?? false, 0, { traffic: over.traffic ?? 0, hot: over.hot ?? false });
  return new Set(painted.filter((p) => p.w === 2 && p.h === 2).map((p) => p.color));
}

test('racks glow green when calm, add amber flicker with model traffic, and overheat amber-and-brown when the quota is used up', () => {
  const calm = rackColors({});
  assert.ok(calm.has(GREEN) || calm.has(GREEN_DIM));
  assert.ok(!calm.has(AMBER));
  let sawAmber = false;
  for (let t = 0; t < 2; t += 0.1) if (rackColors({ traffic: 1, t }).has(AMBER)) sawAmber = true;
  assert.equal(sawAmber, true, 'traffic brings amber lights');
  for (let t = 0; t < 2; t += 0.1) {
    const hot = rackColors({ hot: true, t });
    assert.ok([...hot].every((c) => c === AMBER || c === '#7a4a12'), `overheating shows only amber tones at t=${t}`);
  }
});

test('model traffic speeds the rack lights up compared with a quiet rack', () => {
  const frames = (traffic: number): string[] => {
    const out: string[] = [];
    for (let i = 0; i < 12; i++) {
      const { g, painted } = canvas();
      drawRack(g, RACK, i * 0.09, 0, false, 0, { traffic, hot: false });
      out.push(painted.filter((p) => p.w === 2 && p.h === 2).map((p) => p.color).join());
    }
    return out;
  };
  const changes = (f: string[]): number => f.filter((v, i) => i > 0 && v !== f[i - 1]).length;
  assert.ok(changes(frames(1)) > changes(frames(0)), 'a busy rack flickers more');
});

// ---------- the link unit: the search helper's health and activity ----------

test('the first light of the link unit is the helper\'s health: green up, amber degraded, blinking amber while unknown, blinking red when down', () => {
  assert.equal(linkLights(0, { helper: 'up', tools: 0 })[0], GREEN);
  assert.equal(linkLights(0, { helper: 'degraded', tools: 0 })[0], AMBER);
  const seen = (helper: HelperKind): Set<string> => new Set([0, 0.3, 0.6, 0.9].map((t) => linkLights(t, { helper, tools: 0 })[0]));
  assert.ok(seen('down').has(RED) && seen('down').size === 2, 'down blinks red');
  assert.ok(seen('unknown').has(AMBER) && seen('unknown').size === 2, 'unknown blinks amber');
});

test('while a web tool runs, a light scans along the unit; at rest it only keeps a slow heartbeat; with the helper down the other lights are off', () => {
  const at = (t: number) => linkLights(t, { helper: 'up', tools: 1 });
  const bright = new Set<number>();
  for (let step = 0; step < 24; step++) at(step / 8).forEach((c, k) => c === AMBER && bright.add(k));
  assert.deepEqual([...bright].sort(), [1, 2], 'the scan visits both activity lights');
  assert.ok(at(0)[1] !== linkLights(0, { helper: 'up', tools: 0 })[1] || at(0.13)[2] !== linkLights(0.13, { helper: 'up', tools: 0 })[2]);
  const rest = new Set<string>();
  for (let t = 0; t < 3; t += 0.2) linkLights(t, { helper: 'up', tools: 0 }).slice(1).forEach((c) => rest.add(c));
  assert.ok(!rest.has(AMBER), 'no amber at rest');
  const down = linkLights(0, { helper: 'down', tools: 1 });
  assert.equal(down[1], down[2]);
  assert.equal(down[1], '#1a1e28');
});

test('only the rack given a link shows it, in its bottom unit, and overheating or an agent error does not hide the helper\'s health', () => {
  const unit = (net: Parameters<typeof drawRack>[6], opts: { error?: boolean } = {}): string[] => {
    const { g, painted } = canvas();
    drawRack(g, RACK, 0.5, 0, opts.error ?? false, 0, net);
    // the bottom unit's three lights sit at y = rack.y + 3 + 4*5 + 1
    return painted.filter((p) => p.w === 2 && p.h === 2 && p.y === RACK.y + 3 + 20 + 1).map((p) => p.color);
  };
  const plain = unit({ traffic: 0, hot: false });
  const linked = unit({ traffic: 0, hot: false, link: { helper: 'down', tools: 0 } });
  assert.equal(linked.length, 3);
  assert.ok(linked.includes(RED) || linked.includes('#4a1a1c'), 'a down helper is red on the link unit');
  assert.ok(!plain.includes(RED) && !plain.includes('#4a1a1c'));
  const hotLinked = unit({ traffic: 0, hot: true, link: { helper: 'up', tools: 0 } }, { error: true });
  assert.equal(hotLinked[0], GREEN, 'quota heat and agent errors do not repaint the helper light');
});
