import './style.css';
import { OfficeStore } from './core/state.ts';
import { ROSTER } from './core/roster.ts';
import { computeLayout } from './core/layout.ts';
import { W, H } from './core/world.ts';
import { setWallStyle, type WallStyle } from './render/rooms.ts';
import { OfficeView } from './render/view.ts';
import { MockOffice } from './sim/simulator.ts';
import { el } from './ui/dom.ts';
import { mountDialog } from './ui/dialog.ts';
import { mountPanels } from './ui/panels.ts';

const source = new MockOffice();
const store = new OfficeStore();
const canvas = el<HTMLCanvasElement>('#office');
const view = new OfficeView(canvas, store);
const panels = mountPanels(store, view);

// Order matters: the store updates first, so the view and panels read fresh state.
source.subscribe((e) => store.apply(e));
source.subscribe((e) => view.onEvent(e));
source.subscribe((e) => panels.onEvent(e));
mountDialog(store, source);
view.start();

// Handy for poking at the live office from the browser console in dev.
if (import.meta.env.DEV) Object.assign(window, { office: { source, store, view } });

// ---------- canvas sizing: the scenery fills the whole window, the office sits in the middle ----------

const stage = el<HTMLDivElement>('#stage');
const area = el<HTMLElement>('#stage-area');
let lastSize = '';
function fit(): void {
  const l = computeLayout(area.clientWidth, area.clientHeight, W, H);
  const key = `${l.cw}x${l.ch}`;
  if (key !== lastSize) {
    lastSize = key;
    view.resize(l.cw, l.ch);
  }
  canvas.style.width = `${Math.round(l.cw * l.scale)}px`;
  canvas.style.height = `${Math.round(l.ch * l.scale)}px`;
  document.documentElement.style.setProperty('--scale', l.scale.toFixed(3));
}
new ResizeObserver(fit).observe(area);
window.addEventListener('resize', fit);
fit();

// ---------- details drawer ----------

const drawer = el<HTMLElement>('#drawer');
const panelsBtn = el<HTMLButtonElement>('#btn-panels');
function setDrawer(open: boolean): void {
  drawer.classList.toggle('open', open);
  panelsBtn.setAttribute('aria-expanded', String(open));
}
panelsBtn.addEventListener('click', () => setDrawer(!drawer.classList.contains('open')));
window.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && drawer.classList.contains('open')) setDrawer(false);
});

// ---------- pointer: hover tooltip + click to select ----------

const tooltip = el<HTMLDivElement>('#tooltip');
/** Mouse position in office coordinates (the canvas is bigger than the office). */
function logical(ev: MouseEvent): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return view.toOffice(((ev.clientX - r.left) * canvas.width) / r.width, ((ev.clientY - r.top) * canvas.height) / r.height);
}

canvas.addEventListener('mousemove', (ev) => {
  const p = logical(ev);
  const id = view.pick(p.x, p.y);
  view.hover = id;
  canvas.style.cursor = id ? 'pointer' : 'default';
  if (!id) {
    tooltip.classList.add('hidden');
    return;
  }
  const def = ROSTER[id];
  tooltip.textContent = `${def.name} · ${def.role}`;
  tooltip.classList.remove('hidden');
  const sr = stage.getBoundingClientRect();
  tooltip.style.left = `${ev.clientX - sr.left + 12}px`;
  tooltip.style.top = `${ev.clientY - sr.top + 14}px`;
});
canvas.addEventListener('mouseleave', () => {
  view.hover = null;
  tooltip.classList.add('hidden');
});
canvas.addEventListener('click', (ev) => {
  const p = logical(ev);
  const id = view.pick(p.x, p.y);
  view.selected = id;
  panels.refresh();
  if (id) setDrawer(true); // show the inspector for whoever you clicked
  // Clicking the owner when nothing is running starts a job, like talking to an NPC.
  if (id === 'owner' && !source.isRunning) source.start();
});

// ---------- demo controls ----------

const startBtn = el<HTMLButtonElement>('#btn-start');
const rejectBtn = el<HTMLButtonElement>('#btn-reject');
function syncControls(): void {
  startBtn.disabled = source.isRunning;
  startBtn.textContent = source.isRunning ? 'Job running...' : 'Start job';
  rejectBtn.classList.toggle('armed', source.rejectNextReview);
}
store.subscribe(syncControls);
// The job's "running" flag flips without a store event when it finishes.
window.setInterval(syncControls, 400);
syncControls();

startBtn.addEventListener('click', () => {
  source.start();
  syncControls();
});
el<HTMLButtonElement>('#btn-reset').addEventListener('click', () => {
  source.reset();
  syncControls();
});
rejectBtn.addEventListener('click', () => {
  source.rejectNextReview = !source.rejectNextReview;
  syncControls();
});
el<HTMLButtonElement>('#btn-error').addEventListener('click', () => {
  source.injectError();
});
el<HTMLButtonElement>('#btn-jam').addEventListener('click', () => {
  source.jam(4);
});
el<HTMLInputElement>('#auto').addEventListener('change', (ev) => {
  source.autoAnswer = (ev.target as HTMLInputElement).checked;
});
// Wall height: half / mixed / full-height glass (remembered between visits)
function applyWalls(style: WallStyle): void {
  setWallStyle(style);
  view.rebuild();
  document.querySelectorAll<HTMLButtonElement>('.wall').forEach((o) => o.classList.toggle('active', o.dataset.walls === style));
  try {
    localStorage.setItem('agent-office.walls.v2', style);
  } catch {
    // storage may be unavailable (private window); the choice just won't be remembered
  }
}
for (const b of document.querySelectorAll<HTMLButtonElement>('.wall')) {
  b.addEventListener('click', () => applyWalls(b.dataset.walls as WallStyle));
}
try {
  const saved = localStorage.getItem('agent-office.walls.v2');
  if (saved === 'half' || saved === 'mixed' || saved === 'full') applyWalls(saved);
} catch {
  // ignore
}
for (const b of document.querySelectorAll<HTMLButtonElement>('.speed')) {
  b.addEventListener('click', () => {
    source.setSpeed(Number(b.dataset.speed));
    document.querySelectorAll('.speed').forEach((o) => o.classList.toggle('active', o === b));
  });
}
