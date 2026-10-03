import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OfficeView } from '../render/view.ts';
import { mountCamera } from './camera-controls.ts';
import { setupDom, sizeElement, sleep } from './test-dom.ts';

const t = setupDom();
const win = t.window;
const doc = win.document;
const area = doc.getElementById('stage-area') as HTMLElement;
const canvas = doc.getElementById('office') as HTMLCanvasElement;
sizeElement(area, 1920, 980);

/** Just enough of the view for the controls to talk to. */
class FakeView {
  camX = 236;
  camY = 112;
  resizes: [number, number][] = [];
  pans: [number, number][] = [];
  cams: [number, number][] = [];
  resize(cw: number, ch: number): void {
    this.resizes.push([cw, ch]);
  }
  setCamera(x: number, y: number): void {
    this.camX = x;
    this.camY = y;
    this.cams.push([x, y]);
  }
  panBy(dx: number, dy: number): void {
    this.pans.push([dx, dy]);
  }
}
const view = new FakeView();
const camera = mountCamera(view as unknown as OfficeView, canvas, area);

const btn = (id: string): HTMLButtonElement => doc.getElementById(id) as HTMLButtonElement;
const scaleVar = (): string => doc.documentElement.style.getPropertyValue('--scale');
const key = (type: 'keydown' | 'keyup', k: string, target: EventTarget = win): void => {
  target.dispatchEvent(new win.KeyboardEvent(type, { key: k, bubbles: true, cancelable: true }));
};
const mouse = (type: string, x: number, y: number, target: EventTarget = canvas): void => {
  target.dispatchEvent(new win.MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }));
};

test('it starts fitted to the window: whole-number scale, canvas covers the window, no zoom-out', () => {
  assert.equal(scaleVar(), '4.000');
  assert.deepEqual(view.resizes.at(-1), [480, 245]);
  assert.equal(canvas.style.width, '1920px');
  assert.equal(canvas.style.height, '980px');
  assert.equal(btn('btn-zoom-out').disabled, true);
  assert.equal(btn('btn-zoom-fit').disabled, true);
  assert.equal(btn('btn-zoom-in').disabled, false);
});

test('zoom in makes the pixels bigger, shows less of the building and enables zoom out', () => {
  btn('btn-zoom-in').click();
  assert.equal(scaleVar(), '5.000');
  assert.deepEqual(view.resizes.at(-1), [384, 196]);
  assert.equal(btn('btn-zoom-out').disabled, false);
  assert.equal(btn('btn-zoom-fit').disabled, false);
  assert.deepEqual(view.cams.at(-1), [236, 112], 'zooming around the centre keeps the centre');
});

test('the Fit button goes back to seeing the whole building', () => {
  btn('btn-zoom-fit').click();
  assert.equal(scaleVar(), '4.000');
  assert.equal(btn('btn-zoom-out').disabled, true);
});

test('the mouse wheel zooms in and out, and the page does not scroll', () => {
  const up = new win.WheelEvent('wheel', { deltaY: -120, clientX: 960, clientY: 490, cancelable: true, bubbles: true });
  canvas.dispatchEvent(up);
  assert.equal(up.defaultPrevented, true);
  assert.equal(scaleVar(), '5.000');
  const down = new win.WheelEvent('wheel', { deltaY: 120, clientX: 960, clientY: 490, cancelable: true, bubbles: true });
  canvas.dispatchEvent(down);
  assert.equal(scaleVar(), '4.000');
});

test('zooming around the pointer keeps the point under the pointer', () => {
  view.camX = 236;
  view.camY = 112;
  // pointer 300px right of the window centre at scale 4: the office point is 236 + 75
  win.dispatchEvent(new win.WheelEvent('wheel', { deltaY: -120, clientX: 960 + 300, clientY: 490 }));
  canvas.dispatchEvent(new win.WheelEvent('wheel', { deltaY: -120, clientX: 960 + 300, clientY: 490, cancelable: true, bubbles: true }));
  const [cx] = view.cams.at(-1) as [number, number];
  // after zooming to 5 the same office point (311) must again be 300px from the centre
  assert.ok(Math.abs(cx + 300 / 5 - (236 + 300 / 4)) < 1e-9, `camera centre ${cx} does not keep the pointer fixed`);
  btn('btn-zoom-fit').click();
});

test('keys: + - and 0 change the zoom', () => {
  key('keydown', '+');
  assert.equal(scaleVar(), '5.000');
  key('keydown', '=');
  assert.equal(scaleVar(), '6.000');
  key('keydown', '-');
  assert.equal(scaleVar(), '5.000');
  key('keydown', '0');
  assert.equal(scaleVar(), '4.000');
});

test('the camera does not move when the whole building is on screen', async () => {
  view.pans.length = 0;
  key('keydown', 'd');
  await sleep(120);
  key('keyup', 'd');
  assert.equal(view.pans.length, 0);
});

test('WASD and arrow keys pan the camera when zoomed in, and stop when released', async () => {
  btn('btn-zoom-in').click();
  view.pans.length = 0;
  key('keydown', 'd');
  await sleep(150);
  key('keyup', 'd');
  assert.ok(view.pans.length > 0, 'holding D should pan');
  assert.ok(view.pans.every(([dx, dy]) => dx > 0 && dy === 0), 'D pans right only');
  const count = view.pans.length;
  await sleep(100);
  assert.equal(view.pans.length, count, 'releasing the key must stop the panning');

  view.pans.length = 0;
  key('keydown', 'ArrowUp');
  await sleep(100);
  key('keyup', 'ArrowUp');
  assert.ok(view.pans.length > 0 && view.pans.every(([dx, dy]) => dx === 0 && dy < 0), 'up arrow pans up');
});

test('typing in a text box never pans the camera', async () => {
  const input = doc.getElementById('dlg-input') as HTMLInputElement;
  view.pans.length = 0;
  key('keydown', 'd', input);
  key('keydown', 'w', input);
  await sleep(100);
  key('keyup', 'd', input);
  key('keyup', 'w', input);
  assert.equal(view.pans.length, 0);
});

test('moving the mouse to the edge of the screen pans towards that edge, and stops when it leaves', async () => {
  view.pans.length = 0;
  mouse('mousemove', 3, 490);
  await sleep(120);
  assert.ok(view.pans.length > 0 && view.pans.every(([dx]) => dx < 0), 'left edge pans left');
  canvas.dispatchEvent(new win.MouseEvent('mouseleave', { bubbles: true }));
  await sleep(50);
  const n = view.pans.length;
  await sleep(100);
  assert.equal(view.pans.length, n, 'leaving the canvas (e.g. onto a panel) stops the scrolling');
  view.pans.length = 0;
  mouse('mousemove', 960, 490);
  await sleep(100);
  assert.equal(view.pans.length, 0, 'the middle of the screen does not scroll');
});

test('dragging pans the camera, and the click that ends a drag is swallowed', () => {
  view.pans.length = 0;
  mouse('pointerdown', 500, 400);
  mouse('pointermove', 460, 400);
  assert.deepEqual(view.pans.at(-1), [8, -0], 'dragging 40px left at scale 5 moves the camera 8 office px right');
  mouse('pointerup', 460, 400);
  assert.equal(camera.consumeDrag(), true);
  assert.equal(camera.consumeDrag(), false, 'only the first click is swallowed');
});

test('a short press is a click, not a drag', () => {
  view.pans.length = 0;
  mouse('pointerdown', 500, 400);
  mouse('pointermove', 502, 401);
  mouse('pointerup', 502, 401);
  assert.equal(view.pans.length, 0);
  assert.equal(camera.consumeDrag(), false);
});

test.after(() => t.stop());
