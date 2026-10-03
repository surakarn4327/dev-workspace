import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const css = readFileSync(`${ROOT}src/style.css`, 'utf8');

test('the Thai pixel font is shipped, declared, credited and scaled to the English x-height without changing any layout size', () => {
  assert.ok(existsSync(`${ROOT}public/fonts/Silver.ttf`), 'public/fonts/Silver.ttf is missing');
  assert.match(css, /@font-face\s*{[^}]*font-family:\s*'Silver'[^}]*\/fonts\/Silver\.ttf/s);
  // Silver is enlarged by size-adjust on the font itself, so English glyphs are never scaled
  assert.match(css, /@font-face\s*{[^}]*size-adjust:\s*1[56]\d%/s);
  // the English font comes first: digits/Latin keep their normal look, Thai falls through to Silver
  const stack = css.match(/--font-th:\s*([^;]+);/)?.[1] ?? '';
  assert.ok(stack.indexOf("'Cascadia Mono'") >= 0 && stack.indexOf("'Cascadia Mono'") < stack.indexOf("'Silver'"), 'English font must precede Silver');
  // no forced Thai font sizes (that distorted boxes) and no font-size-adjust hack
  assert.doesNotMatch(css, /html\[lang='th'\][^{]*{[^}]*font-size:/s, 'no forced Thai font sizes');
  assert.doesNotMatch(css, /font-size-adjust/);
  const third = readFileSync(`${ROOT}THIRD-PARTY.md`, 'utf8');
  assert.ok(third.includes('Silver') && third.includes('CC BY 4.0'), 'the font must be listed in THIRD-PARTY.md');
});
