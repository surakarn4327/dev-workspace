import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { LANGS, getLang, msg, onLangChange, pickInitialLang, raw, setLang, t, tr } from './i18n.ts';
import { AGENT_IDS } from './types.ts';
import { STRINGS } from './strings.ts';

const SRC = fileURLToPath(new URL('..', import.meta.url));
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('every key exists in both languages with the same placeholders, and nothing is empty', () => {
  const en = Object.keys(STRINGS.en);
  const th = Object.keys(STRINGS.th);
  assert.deepEqual(en.filter((k) => !(k in STRINGS.th)), [], 'keys missing from Thai');
  assert.deepEqual(th.filter((k) => !(k in STRINGS.en)), [], 'keys missing from English');
  for (const key of en) {
    for (const lang of LANGS) assert.ok(key === 'text' || STRINGS[lang][key].trim().length > 0, `${lang}.${key} is empty`);
    assert.deepEqual(placeholders(STRINGS.th[key]), placeholders(STRINGS.en[key]), `placeholders differ for ${key}`);
  }
});

test('Thai strings are really Thai (letters or untranslated brand/language names only)', () => {
  const allowedSame = new Set(['text', 'lang.en', 'lang.th']);
  for (const key of Object.keys(STRINGS.en)) {
    if (allowedSame.has(key)) continue;
    // A Thai string that is identical to the English one was almost certainly forgotten.
    assert.notEqual(STRINGS.th[key], STRINGS.en[key], `th.${key} was not translated`);
  }
});

test('every key the code and index.html refer to exists in the dictionary', () => {
  const known = new Set(Object.keys(STRINGS.en));
  const used = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    if (file.endsWith('strings.ts')) continue;
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\b(?:t|tr|msg)\(\s*'([\w.-]+)'/g)) used.add(m[1]);
    for (const m of text.matchAll(/\bchoice\(\s*'[\w-]+',\s*'([\w.-]+)'/g)) used.add(m[1]);
    for (const m of text.matchAll(/\bkey:\s*'([\w.-]+)'/g)) used.add(m[1]);
  }
  const html = new JSDOM(readFileSync(join(ROOT, 'index.html'), 'utf8')).window.document;
  for (const node of html.querySelectorAll('*')) {
    for (const attr of ['data-i18n', 'data-i18n-title', 'data-i18n-aria', 'data-i18n-placeholder']) {
      const v = node.getAttribute(attr);
      if (v) used.add(v);
    }
  }
  // keys built from a prefix at run time
  for (const id of AGENT_IDS) {
    used.add(`role.${id}`);
    used.add(`blurb.${id}`);
  }
  for (const s of ['idle', 'brief', 'approval', 'meeting', 'team', 'work', 'review', 'delivery', 'done']) used.add(`step.${s}`);
  for (const a of ['idle', 'typing', 'thinking', 'talking', 'reviewing', 'waiting', 'break', 'error', 'celebrate']) used.add(`act.${a}`);
  const missing = [...used].filter((k) => !known.has(k));
  assert.deepEqual(missing, [], 'keys used but not defined');
});

test('no user-facing words are hard-coded outside the dictionary', () => {
  // Thai characters anywhere, or a string literal made of 2+ English words, in UI/simulator code is a leak.
  // Class names and similar plain code strings are listed explicitly.
  const allowed = new Set(['btn choice', 'portrait small', 'hud hud-left', 'chip act-${st.activity}', '2d canvas unavailable']);
  const offenders: string[] = [];
  const skip = ['strings.ts', 'intent.ts']; // intent.ts holds language-aware matching patterns, not UI text
  for (const file of sourceFiles(SRC)) {
    if (skip.some((s) => file.endsWith(s))) continue;
    const code = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
    for (const m of code.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)) {
      const lit = m[1] ?? m[2] ?? m[3] ?? '';
      const stripped = lit.replace(/\$\{[^}]*\}/g, '');
      if (/[฀-๿]/.test(stripped)) offenders.push(`${relative(SRC, file)}: ${lit}`);
      else if (/[A-Za-z]{3,}\s+[A-Za-z]{2,}/.test(stripped) && !allowed.has(lit)) {
        // import paths, CSS selectors and error messages are not UI text
        if (/^(\.|\/|#|\[)/.test(lit) || /^(node:|\.\.?\/)/.test(lit)) continue;
        offenders.push(`${relative(SRC, file)}: ${lit}`);
      }
    }
  }
  const ignore = (o: string): boolean =>
    /Missing element|job failed|error flow failed|\[MockOffice\]|\(not one of the|mouse|keydown|pointer/i.test(o);
  assert.deepEqual(offenders.filter((o) => !ignore(o)), [], 'hard-coded text found; move it to strings.ts');
});

test('index.html has no visible words of its own (brand name aside)', () => {
  const doc = new JSDOM(readFileSync(join(ROOT, 'index.html'), 'utf8')).window.document;
  const bad: string[] = [];
  for (const node of doc.body.querySelectorAll('*')) {
    if (['SCRIPT', 'H1'].includes(node.tagName)) continue; // the h1 is the brand name "AGENT OFFICE"
    if (node.hasAttribute('data-i18n')) continue;
    for (const child of node.childNodes) {
      const text = child.nodeType === 3 ? (child.textContent ?? '').trim() : '';
      if (/[A-Za-z฀-๿]{2,}/.test(text) && !/^\d+x$/.test(text)) bad.push(`<${node.tagName.toLowerCase()}> ${text}`);
    }
    for (const attr of ['title', 'aria-label', 'placeholder']) {
      if (node.hasAttribute(attr)) bad.push(`<${node.tagName.toLowerCase()} ${attr}>`);
    }
  }
  assert.deepEqual(bad, []);
});

test('t() fills params, resolves nested messages, and falls back to English then the key', () => {
  assert.equal(t('feed.pass', { round: 2 }, 'en'), 'QA passed (round 2)');
  assert.equal(t('feed.pass', { round: 2 }, 'th'), 'QA ผ่าน (รอบที่ 2)');
  assert.equal(tr(msg('feed.reject', { round: 1, reason: msg('reason.noSources') }), 'en'), 'QA rejected (round 1): Section 2 has no sources');
  assert.equal(tr(raw('hello {x}'), 'th'), 'hello {x}', 'raw text is never re-interpreted');
  assert.equal(t('no.such.key', undefined, 'th'), 'no.such.key');
});

test('the same message renders in the language that is current when it is displayed', () => {
  const m = msg('say.crash');
  setLang('en', false);
  assert.equal(tr(m), 'My tool just crashed!');
  setLang('th', false);
  assert.equal(tr(m), 'เครื่องมือของฉัน เพิ่งล่ม!');
  setLang('en', false);
});

test('setLang notifies listeners only on a real change, and ignores unknown languages', () => {
  setLang('en', false);
  const seen: string[] = [];
  const off = onLangChange((l) => seen.push(l));
  setLang('en', false);
  setLang('th', false);
  setLang('fr' as 'en', false);
  setLang('en', false);
  off();
  assert.deepEqual(seen, ['th', 'en']);
  assert.equal(getLang(), 'en');
});

test('the initial language: saved choice wins, otherwise Thai browsers get Thai and the rest English', () => {
  assert.equal(pickInitialLang('en', ['th-TH']), 'en');
  assert.equal(pickInitialLang('th', ['en-US']), 'th');
  assert.equal(pickInitialLang(null, ['th-TH', 'en']), 'th');
  assert.equal(pickInitialLang(null, ['en-US', 'th']), 'th');
  assert.equal(pickInitialLang(undefined, ['en-US', 'de']), 'en');
  assert.equal(pickInitialLang('xx', ['de']), 'en', 'garbage in storage is ignored');
  assert.equal(pickInitialLang(null, []), 'en');
});

test('setLang survives blocked storage (no localStorage / throwing localStorage)', () => {
  const g = globalThis as unknown as { localStorage?: unknown };
  const saved = g.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('blocked');
    },
  });
  try {
    assert.doesNotThrow(() => setLang('th'));
    assert.equal(getLang(), 'th');
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: saved, writable: true });
    setLang('en', false);
  }
});
