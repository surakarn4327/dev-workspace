import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const css = readFileSync(`${ROOT}src/style.css`, 'utf8');

test('the Thai pixel font is shipped, declared, credited and used at its native 16px only', () => {
  assert.ok(existsSync(`${ROOT}public/fonts/Silver.ttf`), 'public/fonts/Silver.ttf is missing');
  assert.match(css, /@font-face\s*{[^}]*font-family:\s*'Silver'[^}]*\/fonts\/Silver\.ttf/s);
  assert.match(css, /--font-th:\s*'Silver'/);
  // every size inside Thai mode is forced to 16px (a pixel font blurs at any other size)
  assert.match(css, /html\[lang='th'\] body \*\s*{[^}]*font-size:\s*16px\s*!important/s);
  const third = readFileSync(`${ROOT}THIRD-PARTY.md`, 'utf8');
  assert.ok(third.includes('Silver') && third.includes('CC BY 4.0'), 'the font must be listed in THIRD-PARTY.md');
});
