import './style.css';
import { OfficeStore } from './core/state.ts';
import { initLang, onLangChange, t } from './core/i18n.ts';
import { chooseBrain } from './ai/brain-factory.ts';
import { createHelperMonitor } from './ai/helper-monitor.ts';
import { createModels } from './ai/models.ts';
import { createToolbox } from './ai/toolbox.ts';
import { ROSTER, roleOf, setLiveModels } from './core/roster.ts';
import { isDemoSource } from './core/types.ts';
import type { OfficeSource } from './core/types.ts';
import { OfficeView } from './render/view.ts';
import { MockOffice } from './sim/simulator.ts';
import { el } from './ui/dom.ts';
import { mountCamera } from './ui/camera-controls.ts';
import { showDemoControls } from './ui/demo-controls.ts';
import { mountDialog } from './ui/dialog.ts';
import { mountAiSettings } from './ui/ai-settings.ts';
import { mountHelperStatus } from './ui/helper-status.ts';
import { applyStatic, mountLanguageSwitch } from './ui/i18n-dom.ts';
import { mountPanels } from './ui/panels.ts';

// Language first: saved choice, else the browser's language (Thai -> Thai, anything else -> English).
initLang();
applyStatic();
mountLanguageSwitch();
const aiSettings = mountAiSettings();

// The local helper searches the web and reads pages for the team. The Menu shows whether it is there.
const toolbox = createToolbox();
const helper = createHelperMonitor(toolbox);
const helperStatus = mountHelperStatus(helper);
void helper.check();

// The page only knows the OfficeSource interface. The office plays the choreography; for each job it asks
// chooseBrain who speaks for the owner and the secretary: Gemini if a key is saved, the demo script if not.
const models = createModels();
const source: OfficeSource = new MockOffice({ brain: () => chooseBrain(models, { onChosen: setLiveModels }) });
// Once the job is over (or abandoned) the inspector goes back to showing the roster's models.
source.subscribe((e) => {
  if (e.type === 'job.done' || e.type === 'sim.reset') setLiveModels(null);
});
// Rehearsal knobs exist only on the mock office; with any other source they are hidden.
const demo = isDemoSource(source) ? source : null;
showDemoControls(demo !== null);
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

// ---------- window sizing, zoom and camera ----------

const stage = el<HTMLDivElement>('#stage');
const area = el<HTMLElement>('#stage-area');
const camera = mountCamera(view, canvas, area);
new ResizeObserver(camera.fit).observe(area);
window.addEventListener('resize', camera.fit);
// ---------- details drawer ----------

// Two side panels share the right edge and never open together: the Menu (controls, AI settings, queue,
// feed) and the character panel (only for the character you clicked). Each has a close button.
const drawer = el<HTMLElement>('#drawer');
const charPanel = el<HTMLElement>('#char-panel');
const sidePanels = [drawer, charPanel];
const panelsBtn = el<HTMLButtonElement>('#btn-panels');
// The HUD grows taller when its step row wraps (long names, e.g. Thai at 24px). Keep the drawer below it
// whenever the two overlap sideways, instead of letting the HUD cover the drawer's top.
const hudLeft = el<HTMLElement>('.hud-left');
function placeDrawer(): void {
  const h = hudLeft.getBoundingClientRect();
  const area = el<HTMLElement>('#stage-area').getBoundingClientRect();
  const drawerLeft = area.right - 8 - Math.min(380, area.width - 16);
  const pushed = h.right > drawerLeft;
  const top = pushed ? Math.ceil(h.bottom - area.top + 8) : 58;
  for (const p of sidePanels) p.style.top = pushed ? `${top}px` : '';
  charPanel.style.maxHeight = `calc(100% - ${top + 8}px)`; // the card is as tall as its content, up to the window
}
new ResizeObserver(placeDrawer).observe(hudLeft);
window.addEventListener('resize', placeDrawer);
/** Show one side panel (or none). Closing the character panel also deselects the character. */
function showPanel(which: 'menu' | 'char' | null): void {
  drawer.classList.toggle('open', which === 'menu');
  charPanel.classList.toggle('open', which === 'char');
  if (which === 'menu') void helper.check(); // the helper may have been started or stopped since last time
  panelsBtn.setAttribute('aria-expanded', String(which === 'menu'));
  if (which !== 'char' && view.selected) {
    view.selected = null;
    panels.refresh();
  }
}
const openPanel = (): 'menu' | 'char' | null =>
  drawer.classList.contains('open') ? 'menu' : charPanel.classList.contains('open') ? 'char' : null;
panelsBtn.addEventListener('click', () => showPanel(openPanel() === 'menu' ? null : 'menu'));
for (const p of sidePanels) {
  p.querySelector<HTMLButtonElement>('[data-close]')?.addEventListener('click', () => showPanel(null));
}
window.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && openPanel()) showPanel(null);
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
  tooltip.textContent = `${def.name} · ${roleOf(id)}`;
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
  if (camera.consumeDrag()) return; // that click was the end of a drag
  const p = logical(ev);
  const id = view.pick(p.x, p.y);
  view.selected = id;
  panels.refresh();
  // Show only the character panel for whoever you clicked; clicking empty floor closes it (the menu stays).
  if (id) showPanel('char');
  else if (openPanel() === 'char') showPanel(null);
  // Clicking the owner when nothing is running opens his first question, like talking to an NPC. The job
  // itself starts only once you send an answer; closing the box (✕) cancels it.
  if (id === 'owner' && !source.isRunning) source.start();
});

// ---------- controls ----------

const startBtn = el<HTMLButtonElement>('#btn-start');
const rejectBtn = el<HTMLButtonElement>('#btn-reject');
function syncControls(): void {
  startBtn.disabled = source.isRunning;
  startBtn.textContent = source.isRunning ? t('hud.running') : t('hud.start');
  rejectBtn.classList.toggle('armed', demo?.rejectNextReview ?? false);
}
store.subscribe(syncControls);
onLangChange(() => {
  applyStatic();
  aiSettings.refresh();
  helperStatus.refresh();
  syncControls();
});
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

// ---------- rehearsal controls (mock office only) ----------

if (demo) {
  rejectBtn.addEventListener('click', () => {
    demo.rejectNextReview = !demo.rejectNextReview;
    syncControls();
  });
  el<HTMLButtonElement>('#btn-error').addEventListener('click', () => {
    demo.injectError();
  });
  el<HTMLButtonElement>('#btn-jam').addEventListener('click', () => {
    demo.jam(4);
  });
  el<HTMLInputElement>('#auto').addEventListener('change', (ev) => {
    demo.autoAnswer = (ev.target as HTMLInputElement).checked;
  });
  for (const b of document.querySelectorAll<HTMLButtonElement>('.speed')) {
    b.addEventListener('click', () => {
      demo.setSpeed(Number(b.dataset.speed));
      document.querySelectorAll('.speed').forEach((o) => o.classList.toggle('active', o === b));
    });
  }
}
