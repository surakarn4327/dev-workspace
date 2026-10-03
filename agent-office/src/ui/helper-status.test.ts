import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHelperMonitor } from '../ai/helper-monitor.ts';
import { ToolError } from '../ai/toolbox.ts';
import type { HelperHealth } from '../ai/toolbox.ts';
import { setLang } from '../core/i18n.ts';
import { applyStatic } from './i18n-dom.ts';
import { mountHelperStatus } from './helper-status.ts';
import { setupDom } from './test-dom.ts';

const t = setupDom();
const doc = t.window.document;

const HEALTH: HelperHealth = { name: 'h', protocol: 1, tools: ['search'], engines: [{ name: 'bing', restingUntil: null }] };
let next: () => Promise<HelperHealth> = async () => HEALTH;
const monitor = createHelperMonitor({ health: () => next() });
const panel = mountHelperStatus(monitor);

const dot = doc.getElementById('helper-dot') as HTMLElement;
const text = (): string => doc.getElementById('helper-status')?.textContent ?? '';
const button = doc.getElementById('helper-recheck') as HTMLButtonElement;
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

test('before the first answer the panel says it is looking, with the check button off', () => {
  setLang('en', false);
  applyStatic();
  panel.refresh();
  assert.equal(dot.dataset.state, 'checking');
  assert.equal(text(), 'Looking for the helper...');
  assert.equal(button.disabled, true);
});

test('a running helper shows a green "ready" with what the team can do', async () => {
  await monitor.check();
  assert.equal(dot.dataset.state, 'ready');
  assert.match(text(), /search the web, read the news and open web pages/);
  assert.equal(button.disabled, false);
});

test('a helper that is not running says how to start it, and the button looks again', async () => {
  next = async () => {
    throw new ToolError('missing', 'gone');
  };
  button.click();
  await settle();
  assert.equal(dot.dataset.state, 'missing');
  assert.match(text(), /npm run dev/);
  assert.match(text(), /says so in their work/);

  next = async () => HEALTH;
  button.click();
  await settle();
  assert.equal(dot.dataset.state, 'ready');
});

test('every state has its own words in both languages', async () => {
  const cases: [string, () => Promise<HelperHealth>][] = [
    ['degraded', async () => ({ ...HEALTH, engines: [{ name: 'bing', restingUntil: Date.now() + 60_000 }] })],
    ['blocked', async () => { throw new ToolError('forbidden', 'x'); }],
    ['outdated', async () => { throw new ToolError('outdated', 'x'); }],
    ['missing', async () => { throw new ToolError('missing', 'x'); }],
    ['ready', async () => HEALTH],
  ];
  const seen = new Set<string>();
  for (const lang of ['en', 'th'] as const) {
    setLang(lang, false);
    applyStatic();
    for (const [state, health] of cases) {
      next = health;
      await monitor.check();
      assert.equal(dot.dataset.state, state);
      assert.ok(text().length > 10 && !text().includes('helper.state'), `${lang} ${state} has text`);
      seen.add(`${lang}:${text()}`);
    }
  }
  assert.equal(seen.size, 10, 'five states x two languages, all different sentences');
});

test('switching language re-writes the sentence on the spot', async () => {
  next = async () => HEALTH;
  await monitor.check();
  setLang('en', false);
  applyStatic();
  panel.refresh();
  assert.match(text(), /Connected/);
  setLang('th', false);
  applyStatic();
  panel.refresh();
  assert.match(text(), /เชื่อมต่อแล้ว/);
  assert.equal(doc.querySelector('#helper-recheck')?.textContent, 'ตรวจอีกครั้ง');
  setLang('en', false);
});

test.after(() => t.stop());
