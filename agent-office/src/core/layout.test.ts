import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeLayout } from './layout.ts';

const W = 384;
const H = 224;

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

test('the office is as large as the window allows', () => {
  const l = computeLayout(1920, 980, W, H);
  assert.equal(l.scale, 4);
  assert.equal(computeLayout(W, H, W, H).scale, 1);
  assert.ok(computeLayout(375, 548, W, H).scale < 1);
});
