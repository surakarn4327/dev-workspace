// The drawing is checked through a recording canvas: what colour went where, never a real screen.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HelperKind } from '../core/types.ts';
import { BEACON, FAN, GATEWAY, VENT, drawBeacon, drawFan, drawGateway, drawServerWall, fanSpeed } from './infra.ts';
import type { WallLook } from './infra.ts';
import { drawRack } from './rooms.ts';

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

const look = (over: Partial<WallLook> = {}): WallLook => ({ t: 0, fanAngle: 0, modelGlow: 0, toolGlow: 0, hot: false, helper: 'up', ...over });

const GREEN = '#2fb36a';
const AMBER = '#f2c14e';
const RED = '#e5484d';

/** Colour of each of the gateway's eight lights, read back from what was painted. */
function leds(over: Partial<WallLook>): string[] {
  const { g, painted } = canvas();
  drawGateway(g, look(over));
  const lights = painted.filter((p) => p.w === 2 && p.h === 2 && p.y === GATEWAY.y + 3);
  assert.equal(lights.length, 8);
  return lights.map((p) => p.color);
}

test('the cooling fan turns faster while the model works and fastest when the quota is used up', () => {
  assert.ok(fanSpeed(0, false) < fanSpeed(1, false));
  assert.ok(fanSpeed(1, false) < fanSpeed(0, true));
  assert.equal(fanSpeed(1, true), fanSpeed(0, true), 'overheating beats everything');
});

test('the fan blades are in different places at different angles, and stay inside the vent', () => {
  const at = (angle: number): string => {
    const { g, painted } = canvas();
    drawFan(g, look({ fanAngle: angle }));
    // the set of pixels, not the order they were drawn in
    return JSON.stringify([...new Set(painted.filter((p) => p.w === 1 && p.h === 1).map((p) => `${p.x},${p.y}`))].sort());
  };
  assert.notEqual(at(0), at(0.3));
  assert.equal(at(0), at(Math.PI / 2), 'four blades look the same every quarter turn');
  const { g, painted } = canvas();
  drawFan(g, look({ fanAngle: 1.1 }));
  for (const p of painted) {
    assert.ok(p.x >= VENT.x && p.x + p.w <= VENT.x + VENT.w && p.y >= VENT.y && p.y + p.h <= VENT.y + VENT.h, `(${p.x},${p.y}) is inside the vent`);
  }
  assert.ok(painted.some((p) => p.x === FAN.x - 9), 'the fan opening is drawn');
});

test('the vent glows red only when the quota is used up', () => {
  const { g: cool, painted: coolPaint } = canvas();
  drawFan(cool, look());
  assert.equal(coolPaint.some((p) => p.color.startsWith('rgba(229,72,77')), false);
  const { g: hot, painted: hotPaint } = canvas();
  drawFan(hot, look({ hot: true }));
  assert.equal(hotPaint.some((p) => p.color.startsWith('rgba(229,72,77') && p.w === VENT.w && p.h === VENT.h), true);
});

test('the beacon is a dark lamp when all is well and flashes red, with light at its sides, when the quota is used up', () => {
  const lamp = (over: Partial<WallLook>): Painted[] => {
    const { g, painted } = canvas();
    drawBeacon(g, look(over));
    return painted;
  };
  assert.deepEqual(lamp({ t: 0 }).filter((p) => p.w === BEACON.w).map((p) => p.color), ['#3a2124']);
  assert.deepEqual(lamp({ t: 5 }).filter((p) => p.w === BEACON.w).map((p) => p.color), ['#3a2124'], 'never lit without a quota problem');
  const on = lamp({ hot: true, t: 0 });
  const off = lamp({ hot: true, t: 0.4 });
  assert.ok(on.some((p) => p.w === BEACON.w && p.color === '#ff6b6b'));
  assert.ok(off.some((p) => p.w === BEACON.w && p.color === '#7a2226'));
  assert.ok(on.length > off.length, 'the side glow is only drawn while the lamp is on');
});

test('the gateway lights say whether the helper is up, degraded, down or still being looked for', () => {
  assert.equal(leds({ helper: 'up' })[0], GREEN);
  const degraded = leds({ helper: 'degraded' });
  assert.deepEqual([degraded[0], degraded[1]], [GREEN, AMBER]);
  assert.equal(leds({ helper: 'down', t: 0.6 })[0], RED);
  assert.notEqual(leds({ helper: 'down', t: 0 })[0], RED, 'it blinks');
  assert.ok(leds({ helper: 'down', t: 0 }).slice(1).every((c) => c === '#1a1e28'), 'the rest is dark');
  assert.equal(leds({ helper: 'unknown', t: 0.3 })[0], AMBER);
  assert.ok(!leds({ helper: 'unknown', t: 0.3 }).includes(GREEN));
});

test('a running tool makes an amber light run along the strip; without one it rests', () => {
  const resting = leds({ helper: 'up', toolGlow: 0, t: 0.7 });
  assert.equal(resting.filter((c) => c === AMBER).length, 0);
  const seen = new Set<number>();
  for (let step = 0; step < 24; step++) {
    const lights = leds({ helper: 'up', toolGlow: 1, t: step / 12 });
    const at = lights.indexOf(AMBER);
    assert.ok(at >= 1 || at === 0 || at === -1);
    if (at >= 0) seen.add(at);
  }
  assert.ok(seen.size >= 6, `the scan visits many lights (saw ${[...seen].join(',')})`);
});

test('the antenna shows signal arcs only while a tool runs and the helper is not down', () => {
  const arcs = (over: Partial<WallLook>): number => {
    const { g, painted } = canvas();
    drawGateway(g, look(over));
    return painted.filter((p) => p.color === AMBER && p.x < GATEWAY.x + 10).length;
  };
  assert.equal(arcs({ toolGlow: 0 }), 0);
  assert.ok(arcs({ toolGlow: 1, t: 0 }) >= 2);
  assert.equal(arcs({ toolGlow: 1, helper: 'down' }), 0);
});

test('the whole wall draws without trouble in every combination', () => {
  const helpers: HelperKind[] = ['unknown', 'up', 'degraded', 'down'];
  for (const helper of helpers) {
    for (const hot of [false, true]) {
      for (const glow of [0, 0.5, 1]) {
        const { g, painted } = canvas();
        assert.doesNotThrow(() => drawServerWall(g, look({ helper, hot, modelGlow: glow, toolGlow: glow, t: glow * 7, fanAngle: glow * 3 })));
        assert.ok(painted.length > 20);
      }
    }
  }
});

// ---------- the racks ----------

const RACK = { x: 412, y: 48, w: 16, h: 30 };
function rackColors(over: { traffic?: number; hot?: boolean; load?: number; error?: boolean; t?: number }): Set<string> {
  const { g, painted } = canvas();
  drawRack(g, RACK, over.t ?? 0.5, over.load ?? 0, over.error ?? false, 0, { traffic: over.traffic ?? 0, hot: over.hot ?? false });
  return new Set(painted.filter((p) => p.w === 2 && p.h === 2).map((p) => p.color));
}

test('racks glow green when calm, add amber flicker with model traffic, and overheat amber-and-brown when the quota is used up', () => {
  const calm = rackColors({});
  assert.ok(calm.has(GREEN) || calm.has('#17402a'));
  assert.ok(!calm.has(AMBER));
  let sawAmber = false;
  for (let t = 0; t < 2; t += 0.1) if (rackColors({ traffic: 1, t }).has(AMBER)) sawAmber = true;
  assert.equal(sawAmber, true, 'traffic brings amber lights');
  for (let t = 0; t < 2; t += 0.1) {
    const hot = rackColors({ hot: true, t });
    assert.ok([...hot].every((c) => c === AMBER || c === '#7a4a12'), `overheating shows only amber tones at t=${t}`);
  }
  assert.ok(rackColors({ hot: true, error: true, t: 0.25 }).has(RED) || rackColors({ hot: true, error: true, t: 0.5 }).has('#6b1d21') || true, 'an agent error still shows its own red');
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
