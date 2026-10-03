import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDemoSource } from '../core/types.ts';
import type { OfficeSource } from '../core/types.ts';
import { MockOffice } from '../sim/simulator.ts';
import { showDemoControls } from './demo-controls.ts';
import { setupDom } from './test-dom.ts';

const t = setupDom();
const doc = t.window.document;
const hidden = (sel: string): boolean => (doc.querySelector(sel) as HTMLElement).hasAttribute('hidden');

test('rehearsal controls are hidden without a demo source and shown with one', () => {
  showDemoControls(false);
  for (const sel of ['#auto', '#btn-reject', '#btn-error', '#btn-jam', '.speed']) {
    assert.equal((doc.querySelector(sel) as HTMLElement).closest('[data-demo]')?.hasAttribute('hidden'), true, `${sel} should be hidden`);
  }
  showDemoControls(true);
  for (const sel of ['#auto', '#btn-reject', '#btn-error', '#btn-jam', '.speed']) {
    assert.equal((doc.querySelector(sel) as HTMLElement).closest('[data-demo]')?.hasAttribute('hidden'), false, `${sel} should be visible`);
  }
});

test('controls every source needs are never marked as demo-only', () => {
  showDemoControls(false);
  for (const sel of ['#btn-start', '#btn-reset', '#btn-panels', 'button[data-lang]', '#btn-zoom-in', '#btn-zoom-fit', '#ai-key', '#ai-save']) {
    assert.equal(doc.querySelector(sel)?.closest('[data-demo]') ?? null, null, `${sel} must stay available`);
    assert.equal(hidden(sel), false);
  }
});

test('only a source with the rehearsal knobs counts as a demo source', () => {
  const office = new MockOffice({ ambient: false });
  assert.equal(isDemoSource(office), true);
  const real: OfficeSource = {
    subscribe: () => () => {},
    answer: () => {},
    cancel: () => {},
    isRunning: false,
    start: () => {},
    reset: () => {},
  };
  assert.equal(isDemoSource(real), false);
  office.dispose();
});

test.after(() => t.stop());
