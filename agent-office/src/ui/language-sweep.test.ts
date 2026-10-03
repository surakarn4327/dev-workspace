// Runs whole jobs (every user path: revise, QA reject, agent crash, courier jam, request changes) in each
// language while scanning EVERYTHING the page renders: no English word may leak into Thai mode, no Thai into
// English mode, and no unfilled {placeholder} / undefined may ever show. The user shouldn't have to find these.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHelperMonitor } from '../ai/helper-monitor.ts';
import { ModelError } from '../ai/model-client.ts';
import { ToolError } from '../ai/toolbox.ts';
import type { HelperHealth } from '../ai/toolbox.ts';
import type { ModelErrorKind } from '../ai/model-client.ts';
import type { KeyStore } from '../core/ai-settings.ts';
import type { BrainWait, Exchange, OwnerTurn } from '../core/brain.ts';
import { setLang } from '../core/i18n.ts';
import type { Msg } from '../core/i18n.ts';
import type { Lang } from '../core/i18n.ts';
import { ROSTER } from '../core/roster.ts';
import { OfficeStore } from '../core/state.ts';
import type { AgentId, OfficeEvent } from '../core/types.ts';
import { AGENT_IDS } from '../core/types.ts';
import type { OfficeView } from '../render/view.ts';
import { MockOffice } from '../sim/simulator.ts';
import { ScriptedBrain } from '../sim/scripted-brain.ts';
import { mountAiSettings } from './ai-settings.ts';
import { mountHelperStatus } from './helper-status.ts';
import { mountDialog } from './dialog.ts';
import { applyStatic } from './i18n-dom.ts';
import { mountPanels } from './panels.ts';
import { setupDom, sleep } from './test-dom.ts';

const t = setupDom();
const doc = t.window.document;
const store = new OfficeStore();
const view = { selected: null as AgentId | null };
const panels = mountPanels(store, view as unknown as OfficeView);

/** What the "user" types: one token that is never translated, so it can be allowed in any language. */
const TYPED = 'QTEST';
// Proper names and fixed labels that legitimately stay Latin in Thai mode.
const LATIN_OK = new Set<string>([
  ...Object.values(ROSTER).flatMap((d) => d.name.replace(/\./g, ' ').split(/\s+/)),
  'QA', 'AGENT', 'OFFICE', 'English', 'mock', 'script', 'Silver', 'Poppy', 'Works', 'CC', 'BY', 'WASD', 'Dr', TYPED,
  // product names in the AI settings panel
  'API', 'Gemini', 'Google', 'AI', 'Studio',
  // the commands the user types to start the search helper
  'npm', 'run', 'dev', 'helper',
].filter(Boolean));

/** Every string the page currently shows: visible text nodes plus title / aria-label / placeholder. */
function rendered(): string[] {
  const out: string[] = [];
  const walk = (el: Element): void => {
    if (el.classList.contains('hidden') || el.tagName === 'SCRIPT') return; // hidden dialog is not shown
    for (const attr of ['title', 'aria-label', 'placeholder']) {
      const v = el.getAttribute(attr);
      if (v) out.push(v);
    }
    for (const n of el.childNodes) {
      if (n.nodeType === 3) {
        const s = (n.textContent ?? '').trim();
        if (s) out.push(s);
      } else if (n.nodeType === 1) walk(n as Element);
    }
  };
  walk(doc.body);
  return out;
}

function problems(texts: string[], lang: Lang): string[] {
  const bad = new Set<string>();
  for (const s of texts) {
    if (/\{\w+\}|undefined|\bnull\b|NaN|\[object/.test(s)) bad.add(`unfilled/garbage: ${s}`);
    if (lang === 'th') {
      for (const w of s.match(/[A-Za-z]{3,}/g) ?? []) if (!LATIN_OK.has(w)) bad.add(`English in Thai UI: "${w}" in "${s}"`);
    } else if (/[฀-๿]/.test(s.replace(/ไทย/g, ''))) {
      bad.add(`Thai in English UI: ${s}`);
    }
  }
  return [...bad];
}

async function runEveryPath(lang: Lang): Promise<string[]> {
  setLang(lang, false);
  applyStatic();
  aiSettings.refresh(); // main.ts does this on every language change: the status line is not static text
  helperPanel.refresh();
  store.apply({ type: 'sim.reset' });
  const found = new Set<string>();
  const sweep = (): void => {
    for (const p of problems(rendered(), lang)) found.add(p);
  };
  let n = 0;
  const timer = setInterval(() => {
    view.selected = AGENT_IDS[n++ % AGENT_IDS.length]; // cycle the inspector through everybody
    store.apply({ type: 'chat.closed', id: 'none' }); // harmless: just makes the panels re-render
    sweep();
  }, 8);

  const office = new MockOffice({ timeScale: 120, ambient: true });
  office.rejectNextReview = true;
  mountDialog(store, office); // a fresh dialog listener per run is fine: it only reacts to store.state.chat
  let revised = false;
  let delivered = 0;
  let done = false;
  office.subscribe((e: OfficeEvent) => {
    store.apply(e);
    panels.onEvent(e);
    sweep();
    if (e.type === 'job.stage' && e.stage === 'work') {
      setTimeout(() => {
        office.injectError();
        office.jam(4);
      }, 30);
    }
    if (e.type === 'job.done') done = true;
    if (e.type !== 'chat.ask') return;
    setTimeout(() => {
      const k = e.text.key;
      if (k === 'ask.approve') office.answer(e.id, revised ? { choice: 'approve' } : ((revised = true), { choice: 'revise' }));
      else if (k === 'ask.deliver') office.answer(e.id, ++delivered === 1 ? { choice: 'request-changes' } : { choice: 'accept' });
      else if (k === 'ask.limits') office.answer(e.id, { choice: 'none' });
      else office.answer(e.id, { text: TYPED });
    }, 20);
  });
  office.start();
  const t0 = Date.now();
  while (!done && Date.now() - t0 < 60000) await sleep(20);
  assert.ok(done, `the job did not finish in ${lang}`);
  await sleep(150);
  // flip the language on the finished state: old feed lines and conversations must re-render cleanly
  setLang(lang === 'th' ? 'en' : 'th', false);
  setLang(lang, false);
  applyStatic();
  aiSettings.refresh();
  await sleep(50);
  sweep();
  clearInterval(timer);
  office.dispose();
  return [...found];
}

test('Thai mode: no English leaks, no unfilled placeholders, across every user path', async () => {
  const bad = await runEveryPath('th');
  assert.deepEqual(bad, []);
});

test('English mode: no Thai leaks, no unfilled placeholders, across every user path', async () => {
  const bad = await runEveryPath('en');
  assert.deepEqual(bad, []);
});

// ---------- the AI states: settings panel, thinking, quota wait, every kind of model failure ----------

const aiData = new Map<string, string>();
let aiFailing = false;
const aiStore: KeyStore = {
  getItem: (k) => aiData.get(k) ?? null,
  setItem: (k, v) => {
    if (aiFailing) throw new Error('blocked');
    aiData.set(k, v);
  },
  removeItem: (k) => void aiData.delete(k),
};
const aiSettings = mountAiSettings(aiStore);

const HELPER_OK: HelperHealth = { name: 'h', protocol: 1, tools: ['search', 'news', 'page'], engines: [{ name: 'bing', restingUntil: null }] };
const HELPER_STATES: (() => Promise<HelperHealth>)[] = [
  async () => HELPER_OK,
  async () => ({ ...HELPER_OK, engines: [{ name: 'bing', restingUntil: Date.now() + 60_000 }] }),
  async () => { throw new ToolError('missing', 'x'); },
  async () => { throw new ToolError('forbidden', 'x'); },
  async () => { throw new ToolError('outdated', 'x'); },
];
let helperNext = HELPER_STATES[0];
const helperMonitor = createHelperMonitor({ health: () => helperNext() });
const helperPanel = mountHelperStatus(helperMonitor);

const MODEL_ERRORS: ModelErrorKind[] = ['no-key', 'bad-key', 'rate-limit', 'network', 'timeout', 'server', 'empty', 'blocked', 'bad-request'];

/** Fails once with every kind of error, waits for quota once, then writes the brief slowly. */
class SweepBrain extends ScriptedBrain {
  private kinds = [...MODEL_ERRORS];
  private quotaShown = false;
  private listeners = new Set<(w: BrainWait) => void>();

  watchWait(fn: (w: BrainWait) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private wait(w: BrainWait): void {
    for (const fn of this.listeners) fn(w);
  }

  override async ownerTurn(history: readonly Exchange[], title: string): Promise<OwnerTurn> {
    if (history.length === 1) {
      const kind = this.kinds.shift();
      if (kind) throw new ModelError(kind, 'diagnostic text that must never be shown');
      if (!this.quotaShown) {
        this.quotaShown = true;
        await sleep(40);
        this.wait('quota');
        await sleep(60);
        this.wait(null);
        await sleep(40);
      }
    }
    return super.ownerTurn(history, title);
  }

  override async writeBrief(history: readonly Exchange[], title: string): Promise<Msg> {
    await sleep(60);
    return super.writeBrief(history, title);
  }
}

async function runAiStates(lang: Lang): Promise<string[]> {
  setLang(lang, false);
  applyStatic();
  store.apply({ type: 'sim.reset' });
  const found = new Set<string>();
  const sweep = (): void => {
    for (const p of problems(rendered(), lang)) found.add(p);
  };

  // the settings panel in each of its states
  const key = doc.getElementById('ai-key') as HTMLInputElement;
  const press = (id: string): void => (doc.getElementById(id) as HTMLButtonElement).click();
  aiSettings.refresh();
  helperPanel.refresh();
  sweep(); // no key yet
  key.value = '';
  press('ai-save');
  sweep(); // paste a key first
  aiFailing = true;
  key.value = 'some-key';
  press('ai-save');
  sweep(); // the browser would not save it
  aiFailing = false;
  key.value = 'some-key';
  press('ai-save');
  sweep(); // saved
  press('ai-remove');
  sweep();

  // the search helper panel in each of its states
  for (const state of HELPER_STATES) {
    helperNext = state;
    await helperMonitor.check();
    sweep();
  }
  helperNext = HELPER_STATES[0];
  await helperMonitor.check();

  // thinking, quota wait, secretary writing, and each model failure, through the real dialog
  const timer = setInterval(sweep, 4);
  const office = new MockOffice({ timeScale: 4000, ambient: false, thinkDelayMs: 5, brain: () => new SweepBrain() });
  mountDialog(store, office);
  let reachedApproval = false;
  office.subscribe((e: OfficeEvent) => {
    store.apply(e);
    panels.onEvent(e);
    sweep();
    if (e.type !== 'chat.ask') return;
    const k = e.text.key;
    if (k === 'ask.approve') {
      reachedApproval = true;
      return;
    }
    setTimeout(() => {
      if (k.startsWith('ask.modelError.')) office.answer(e.id, { choice: 'retry' });
      else if (k === 'ask.limits') office.answer(e.id, { choice: 'none' });
      else office.answer(e.id, { text: TYPED });
    }, 15);
  });
  office.start();
  const t0 = Date.now();
  while (!reachedApproval && Date.now() - t0 < 30000) await sleep(20);
  assert.ok(reachedApproval, `the AI states run did not reach the approval question in ${lang}`);
  await sleep(100);
  // flip the language on the finished state: everything left on screen must re-render cleanly
  setLang(lang === 'th' ? 'en' : 'th', false);
  setLang(lang, false);
  applyStatic();
  aiSettings.refresh();
  helperPanel.refresh();
  await sleep(50);
  sweep();
  clearInterval(timer);
  office.dispose();
  return [...found];
}

test('Thai mode: the AI settings, thinking box, quota wait and every model failure have no English leaks', async () => {
  assert.deepEqual(await runAiStates('th'), []);
});

test('English mode: the AI settings, thinking box, quota wait and every model failure have no Thai leaks', async () => {
  assert.deepEqual(await runAiStates('en'), []);
});

test.after(() => {
  setLang('en', false);
  t.stop();
});
