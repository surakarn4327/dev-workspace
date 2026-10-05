import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import data from '../data/data.full.json';
import { checkMenu, parseInput } from './check';
import type { Data, Verdict } from './types';

// @ts-expect-error plain JS helper shared with the build scripts
import { parseCsv } from '../../scripts/csv.mjs';

const d = data as unknown as Data;
const cases = parseCsv(readFileSync('docs/test-cases.csv', 'utf8')) as Record<string, string>[];
const EXPECT: Record<string, Verdict> = { '✅': 'ok', '❌': 'no', '❓': 'unsure' };

describe('menu check against docs/test-cases.csv', () => {
  for (const c of cases.filter((x) => x.chip === 'กลืนแร่')) {
    it(`${c.id} ${c.input} = ${c.expected}`, () => {
      const parsed = parseInput(d, c.input);
      if (c.id !== 'T24') expect(parsed, `menu not found: ${c.input}`).not.toBeNull();
      const verdict: Verdict = parsed ? checkMenu(d, parsed.menu, parsed.protein).verdict : 'unsure';
      expect(verdict).toBe(EXPECT[c.expected]);
    });
  }
});
