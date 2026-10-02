import './style.css';
import { OfficeStore } from './core/state.ts';
import { ROSTER } from './core/roster.ts';
import { W, H } from './core/world.ts';
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

// ---------- canvas sizing: integer pixel scale where possible ----------

const stage = el<HTMLDivElement>('#stage');
function fit(): void {
  const col = stage.parentElement;
  if (!col) return;
  const availW = col.clientWidth;
  const availH = Math.max(200, window.innerHeight - stage.getBoundingClientRect().top - 96);
  const raw = Math.min(availW / W, availH / H);
  const scale = raw >= 1 ? Math.floor(raw) : raw;
  canvas.style.width = `${Math.round(W * scale)}px`;
  canvas.style.height = `${Math.round(H * scale)}px`;
  stage.style.width = `${Math.round(W * scale)}px`;
}
new ResizeObserver(fit).observe(document.body);
window.addEventListener('resize', fit);
fit();

// ---------- pointer: hover tooltip + click to select ----------

const tooltip = el<HTMLDivElement>('#tooltip');
function logical(ev: MouseEvent): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return { x: ((ev.clientX - r.left) * W) / r.width, y: ((ev.clientY - r.top) * H) / r.height };
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
for (const b of document.querySelectorAll<HTMLButtonElement>('.speed')) {
  b.addEventListener('click', () => {
    source.setSpeed(Number(b.dataset.speed));
    document.querySelectorAll('.speed').forEach((o) => o.classList.toggle('active', o === b));
  });
}
