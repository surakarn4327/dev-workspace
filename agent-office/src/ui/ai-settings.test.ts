import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KeyStore } from '../core/ai-settings.ts';
import { setLang } from '../core/i18n.ts';
import { applyStatic } from './i18n-dom.ts';
import { mountAiSettings } from './ai-settings.ts';
import { setupDom } from './test-dom.ts';

const t = setupDom();
const doc = t.window.document;
const data = new Map<string, string>();
const store: KeyStore = {
  getItem: (k) => data.get(k) ?? null,
  setItem: (k, v) => void data.set(k, v),
  removeItem: (k) => void data.delete(k),
};

const input = doc.getElementById('ai-key') as HTMLInputElement;
const save = doc.getElementById('ai-save') as HTMLButtonElement;
const remove = doc.getElementById('ai-remove') as HTMLButtonElement;
const status = (): string => doc.getElementById('ai-status')?.textContent ?? '';

setLang('en', false);
applyStatic();
const panel = mountAiSettings(store);

test('with no key the panel says the office runs the demo and Remove is disabled', () => {
  assert.match(status(), /No key yet/);
  assert.equal(remove.disabled, true);
  assert.equal(input.type, 'password', 'the key is masked while typing');
});

test('saving a key stores it, clears the field and never shows the key', () => {
  input.value = 'SECRET-KEY-123';
  save.click();
  assert.equal(data.size, 1);
  assert.equal(input.value, '');
  assert.match(status(), /Key saved/);
  assert.equal(remove.disabled, false);
  assert.ok(!doc.body.textContent?.includes('SECRET-KEY-123'), 'the key text appears nowhere on the page');
});

test('saving an empty field warns and keeps the old key', () => {
  input.value = '   ';
  save.click();
  assert.match(status(), /Paste a key first/);
  assert.equal(doc.getElementById('ai-status')?.classList.contains('warn'), true);
  assert.equal(data.size, 1);
  input.dispatchEvent(new t.window.Event('input'));
  assert.match(status(), /Key saved/, 'typing clears the warning');
});

test('the status text follows the language', () => {
  setLang('th', false);
  applyStatic();
  panel.refresh();
  assert.match(status(), /บันทึกคีย์แล้ว/);
  assert.equal(doc.getElementById('ai-save')?.textContent, 'บันทึก');
  setLang('en', false);
  applyStatic();
  panel.refresh();
});

test('removing the key returns to demo mode', () => {
  remove.click();
  assert.equal(data.size, 0);
  assert.match(status(), /No key yet/);
  assert.equal(remove.disabled, true);
});

test.after(() => t.stop());
