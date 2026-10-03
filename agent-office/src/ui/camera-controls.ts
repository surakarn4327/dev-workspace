// Window sizing, zoom and panning. The view always fits the window; zooming in makes the
// building bigger than the window, and then the camera can be moved to look at other rooms:
// mouse to the screen edge, WASD / arrow keys, or dragging. It never leaves the real building.

import { anchoredCentre, zoomLevels } from '../core/camera.ts';
import { computeLayout, layoutForScale } from '../core/layout.ts';
import { H, W } from '../core/world.ts';
import type { OfficeView } from '../render/view.ts';
import { el } from './dom.ts';

const EDGE_ZONE = 40; // px from the window edge where edge-scrolling starts
const PAN_SPEED = 520; // screen px per second
const DRAG_THRESHOLD = 5; // px before a press becomes a drag

export interface CameraControls {
  /** Recompute the layout for the current window size (call on resize). */
  fit(): void;
  /** True once after a drag, so the click that ends it does not select anything. */
  consumeDrag(): boolean;
}

const PAN_KEYS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  a: [-1, 0],
  d: [1, 0],
  w: [0, -1],
  s: [0, 1],
};

export function mountCamera(view: OfficeView, canvas: HTMLCanvasElement, area: HTMLElement): CameraControls {
  const zoomIn = el<HTMLButtonElement>('#btn-zoom-in');
  const zoomOut = el<HTMLButtonElement>('#btn-zoom-out');
  const zoomFit = el<HTMLButtonElement>('#btn-zoom-fit');

  let levels = [1];
  let zoomIdx = 0;
  let scale = 1;
  let lastSize = '';

  function apply(): void {
    const aw = area.clientWidth;
    const ah = area.clientHeight;
    const fitLayout = computeLayout(aw, ah, W, H);
    levels = zoomLevels(fitLayout.scale);
    zoomIdx = Math.min(zoomIdx, levels.length - 1);
    scale = levels[zoomIdx];
    const l = zoomIdx === 0 ? fitLayout : layoutForScale(aw, ah, scale);
    const key = `${l.cw}x${l.ch}`;
    if (key !== lastSize) {
      lastSize = key;
      view.resize(l.cw, l.ch);
    }
    canvas.style.width = `${Math.round(l.cw * scale)}px`;
    canvas.style.height = `${Math.round(l.ch * scale)}px`;
    document.documentElement.style.setProperty('--scale', scale.toFixed(3));
    zoomOut.disabled = zoomIdx === 0;
    zoomFit.disabled = zoomIdx === 0;
    zoomIn.disabled = zoomIdx === levels.length - 1;
  }

  /** Zoom to a level, keeping the office point under (cx, cy) (client px) where it is. */
  function setZoom(idx: number, cx?: number, cy?: number): void {
    const next = Math.max(0, Math.min(levels.length - 1, idx));
    if (next === zoomIdx) return;
    const rect = area.getBoundingClientRect();
    const fromX = (cx ?? rect.left + rect.width / 2) - (rect.left + rect.width / 2);
    const fromY = (cy ?? rect.top + rect.height / 2) - (rect.top + rect.height / 2);
    const anchorX = view.camX + fromX / scale;
    const anchorY = view.camY + fromY / scale;
    zoomIdx = next;
    apply();
    view.setCamera(anchoredCentre(anchorX, fromX, scale), anchoredCentre(anchorY, fromY, scale));
  }

  zoomIn.addEventListener('click', () => setZoom(zoomIdx + 1));
  zoomOut.addEventListener('click', () => setZoom(zoomIdx - 1));
  zoomFit.addEventListener('click', () => setZoom(0));

  // mouse wheel zooms around the pointer
  let wheelAcc = 0;
  canvas.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault();
      wheelAcc += ev.deltaY;
      if (Math.abs(wheelAcc) < 60) return;
      setZoom(zoomIdx + (wheelAcc < 0 ? 1 : -1), ev.clientX, ev.clientY);
      wheelAcc = 0;
    },
    { passive: false },
  );

  // keys: pan with WASD / arrows, zoom with + - and fit with 0
  const held = new Set<string>();
  const typing = (t: EventTarget | null): boolean =>
    t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
  window.addEventListener('keydown', (ev) => {
    if (typing(ev.target) || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    if (k in PAN_KEYS) {
      held.add(k);
      ev.preventDefault();
    } else if (k === '+' || k === '=') setZoom(zoomIdx + 1);
    else if (k === '-' || k === '_') setZoom(zoomIdx - 1);
    else if (k === '0') setZoom(0);
  });
  window.addEventListener('keyup', (ev) => {
    held.delete(ev.key.length === 1 ? ev.key.toLowerCase() : ev.key);
  });
  window.addEventListener('blur', () => held.clear());

  // edge scrolling: only while the pointer is over the office itself (not over a panel or the HUD)
  let edgeX = 0;
  let edgeY = 0;
  const edge = (pos: number, size: number): number => {
    if (pos < EDGE_ZONE) return -(1 - pos / EDGE_ZONE);
    if (pos > size - EDGE_ZONE) return 1 - (size - pos) / EDGE_ZONE;
    return 0;
  };
  canvas.addEventListener('mousemove', (ev) => {
    const r = area.getBoundingClientRect();
    edgeX = edge(ev.clientX - r.left, r.width);
    edgeY = edge(ev.clientY - r.top, r.height);
  });
  canvas.addEventListener('mouseleave', () => {
    edgeX = 0;
    edgeY = 0;
  });

  // dragging pans (a short press is still a click)
  let pressed = false;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  let suppressClick = false;
  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    pressed = true;
    dragging = false;
    startX = lastX = ev.clientX;
    startY = lastY = ev.clientY;
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!pressed) return;
    if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
    if (!dragging) {
      dragging = true;
      canvas.setPointerCapture(ev.pointerId);
      canvas.style.cursor = 'grabbing';
    }
    view.panBy(-(ev.clientX - lastX) / scale, -(ev.clientY - lastY) / scale);
    lastX = ev.clientX;
    lastY = ev.clientY;
  });
  const endPress = (): void => {
    if (dragging) suppressClick = true;
    pressed = false;
    dragging = false;
    canvas.style.cursor = '';
  };
  canvas.addEventListener('pointerup', endPress);
  canvas.addEventListener('pointercancel', endPress);

  // one loop moves the camera from keys and from the screen edge
  let last = 0;
  const loop = (now: number): void => {
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    let vx = edgeX;
    let vy = edgeY;
    for (const k of held) {
      vx += PAN_KEYS[k][0];
      vy += PAN_KEYS[k][1];
    }
    if ((vx || vy) && zoomIdx > 0) view.panBy(((vx * PAN_SPEED) / scale) * dt, ((vy * PAN_SPEED) / scale) * dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  apply();
  return {
    fit: apply,
    consumeDrag(): boolean {
      const was = suppressClick;
      suppressClick = false;
      return was;
    },
  };
}
