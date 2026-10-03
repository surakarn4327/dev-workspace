import assert from 'node:assert/strict';
import { test } from 'node:test';
import { anchoredCentre, clampAxis, zoomLevels } from './camera.ts';
import { layoutForScale } from './layout.ts';

test('when the whole building fits on an axis the camera stays centred', () => {
  assert.equal(clampAxis(10, 600, 472), 236);
  assert.equal(clampAxis(900, 472, 472), 236);
});

test('the camera never shows anything beyond the building when zoomed in', () => {
  // visible 200 of 472: the centre may only be between 100 and 372
  assert.equal(clampAxis(-50, 200, 472), 100);
  assert.equal(clampAxis(1000, 200, 472), 372);
  assert.equal(clampAxis(250, 200, 472), 250);
});

test('zoom levels start at the fit scale and then climb in whole steps', () => {
  assert.deepEqual(zoomLevels(4), [4, 5, 6, 7, 8]);
  assert.deepEqual(zoomLevels(0.78), [0.78, 1, 2, 3, 4]);
  assert.deepEqual(zoomLevels(2.5, 2), [2.5, 3, 4]);
});

test('zooming around the pointer keeps the point under the pointer where it was', () => {
  // Pointer 120px right of centre while the camera is at 200 with scale 4: it points at 200 + 30.
  const anchor = 200 + 120 / 4;
  const centre = anchoredCentre(anchor, 120, 6);
  // After zooming to scale 6 the same office point must again be 120px from the centre.
  assert.ok(Math.abs(centre + 120 / 6 - anchor) < 1e-9);
});

test('a zoomed-in canvas covers the whole window with fewer office pixels', () => {
  const l = layoutForScale(1920, 980, 5);
  assert.equal(l.cw, 384);
  assert.equal(l.ch, 196);
  assert.ok(l.cw * l.scale >= 1920 && l.ch * l.scale >= 980);
});
