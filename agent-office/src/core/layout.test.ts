import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeLayout } from './layout.ts';
import { H, W } from './world.ts';

const SCREENS: [string, number, number][] = [
  ['full HD minus bars', 1920, 980],
  ['ultrawide', 2560, 980],
  ['4K', 3840, 2000],
  ['laptop', 1366, 560],
  ['portrait monitor', 1080, 1790],
  ['phone portrait', 375, 548],
  ['phone landscape', 812, 300],
  ['tiny', 200, 120],
];

test('the canvas always covers the whole window', () => {
  for (const [name, aw, ah] of SCREENS) {
    const l = computeLayout(aw, ah, W, H);
    assert.ok(l.cw * l.scale >= aw - 1e-6, `${name}: canvas narrower than window`);
    assert.ok(l.ch * l.scale >= ah - 1e-6, `${name}: canvas shorter than window`);
  }
});

test('the office always fits fully inside the canvas and is centred', () => {
  for (const [name, aw, ah] of SCREENS) {
    const l = computeLayout(aw, ah, W, H);
    assert.ok(l.ox >= 0 && l.oy >= 0, `${name}: negative offset`);
    assert.ok(l.ox + W <= l.cw && l.oy + H <= l.ch, `${name}: office sticks out`);
    assert.ok(Math.abs(l.cw - W - 2 * l.ox) <= 1 && Math.abs(l.ch - H - 2 * l.oy) <= 1, `${name}: not centred`);
  }
});

test('scale is a whole number whenever the office fits at 1x or larger', () => {
  for (const [name, aw, ah] of SCREENS) {
    const l = computeLayout(aw, ah, W, H);
    if (aw >= W && ah >= H) assert.equal(l.scale, Math.floor(l.scale), `${name}: fractional scale`);
  }
});

// Growing the building must not make characters smaller on common screens.
// Sizes are the browser viewport (the controls are an overlay, so the whole viewport is used).
const OLD = { w: 384, h: 224 };
const COMMON: [string, number, number][] = [
  ['1080p fullscreen', 1920, 1080],
  ['1080p browser', 1920, 945],
  ['1200p browser', 1920, 1050],
  ['1440p browser', 2560, 1290],
  ['4K browser', 3840, 2000],
  ['ultrawide 1080p', 2560, 945],
  ['1600x900 browser', 1600, 790],
  ['1536x864 laptop', 1536, 740],
  ['1440x900 laptop', 1440, 780],
  ['1366x768 laptop', 1366, 650],
  ['1280x720 laptop', 1280, 600],
];

test('the bigger building keeps the same pixel scale on common screens', () => {
  for (const [name, vw, vh] of COMMON) {
    const before = computeLayout(vw, vh, OLD.w, OLD.h).scale;
    const after = computeLayout(vw, vh, W, H).scale;
    assert.equal(after, before, `${name}: scale dropped from ${before} to ${after}`);
  }
});

test('on the few screens where the scale does drop, it drops by at most one step', () => {
  const RARE: [string, number, number][] = [
    ['1680x1050 browser', 1680, 900],
    ['1280x1024 monitor', 1280, 900],
  ];
  for (const [name, vw, vh] of RARE) {
    const before = computeLayout(vw, vh, OLD.w, OLD.h).scale;
    const after = computeLayout(vw, vh, W, H).scale;
    assert.ok(before - after <= 1, `${name}: dropped from ${before} to ${after}`);
  }
});

test('the office is as large as the window allows', () => {
  const l = computeLayout(1920, 980, W, H);
  assert.equal(l.scale, 4);
  assert.equal(computeLayout(W, H, W, H).scale, 1);
  assert.ok(computeLayout(375, 548, W, H).scale < 1);
});
