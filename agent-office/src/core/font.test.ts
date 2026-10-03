import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const css = readFileSync(`${ROOT}src/style.css`, 'utf8');

test('the Thai pixel font is shipped, declared, credited and scaled to the English x-height without changing any layout size', () => {
  assert.ok(existsSync(`${ROOT}public/fonts/Silver.ttf`), 'public/fonts/Silver.ttf is missing');
  assert.match(css, /@font-face\s*{[^}]*font-family:\s*'Silver'[^}]*\/fonts\/Silver\.ttf/s);
  assert.match(css, /--font-th:\s*'Silver'/);
  // glyphs are enlarged with font-size-adjust; element sizes are NOT overridden in Thai (that distorted boxes)
  assert.match(css, /html\[lang='th'\] \*\s*{[^}]*font-size-adjust:\s*0\.5/s, 'must reach every element: the font shorthand resets it');
  assert.doesNotMatch(css, /html\[lang='th'\][^{]*{[^}]*font-size:/s, 'no forced Thai font sizes');
  const third = readFileSync(`${ROOT}THIRD-PARTY.md`, 'utf8');
  assert.ok(third.includes('Silver') && third.includes('CC BY 4.0'), 'the font must be listed in THIRD-PARTY.md');
});
