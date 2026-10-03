import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getLang, setLang } from '../core/i18n.ts';
import { applyStatic, mountLanguageSwitch } from './i18n-dom.ts';
import { setupDom } from './test-dom.ts';

const t = setupDom();
const doc = t.window.document;
const text = (sel: string): string => doc.querySelector(sel)?.textContent?.trim() ?? '';

test('static page text, titles and aria labels follow the language', () => {
  setLang('en', false);
  applyStatic();
  assert.equal(doc.documentElement.lang, 'en');
  assert.equal(text('#btn-panels'), 'Menu');
  assert.equal((doc.getElementById('btn-reject') as HTMLElement).title, 'The next QA review sends the work back once');
  assert.equal(doc.getElementById('drawer')?.getAttribute('aria-label'), 'Controls and details');
  setLang('th', false);
  applyStatic();
  assert.equal(doc.documentElement.lang, 'th');
  assert.equal(text('#btn-panels'), 'เมนู');
  assert.equal(text('#btn-reset'), 'รีเซ็ต');
  assert.equal(doc.getElementById('drawer')?.getAttribute('aria-label'), 'ปุ่มควบคุมและรายละเอียด');
  assert.equal(text('#dlg-form button'), 'ส่ง');
});

test('the language buttons in the Menu switch at once and show which one is active', () => {
  setLang('en', false);
  applyStatic();
  mountLanguageSwitch();
  const th = doc.querySelector('button[data-lang="th"]') as HTMLButtonElement;
  const en = doc.querySelector('button[data-lang="en"]') as HTMLButtonElement;
  assert.equal(en.getAttribute('aria-pressed'), 'true');
  th.click();
  assert.equal(getLang(), 'th');
  applyStatic(); // main.ts does this from its onLangChange listener
  assert.equal(th.getAttribute('aria-pressed'), 'true');
  assert.equal(en.getAttribute('aria-pressed'), 'false');
  assert.equal(th.textContent, 'ไทย');
  assert.equal(en.textContent, 'English', 'language names stay in their own language');
  en.click();
  assert.equal(getLang(), 'en');
});

test.after(() => t.stop());