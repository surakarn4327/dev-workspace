// Runs whole jobs (every user path: revise, QA reject, agent crash, courier jam, request changes) in each
// language while scanning EVERYTHING the page renders: no English word may leak into Thai mode, no Thai into
// English mode, and no unfilled {placeholder} / undefined may ever show. The user shouldn't have to find these.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setLang } from '../core/i18n.ts';
import type { Lang } from '../core/i18n.ts';
import { ROSTER } from '../core/roster.ts';
import { OfficeStore } from '../core/state.ts';
import type { AgentId, OfficeEvent } from '../core/types.ts';
import { AGENT_IDS } from '../core/types.ts';
import type { OfficeView } from '../render/view.ts';
import { MockOffice } from '../sim/simulator.ts';
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

test.after(() => {
  setLang('en', false);
  t.stop();
});
