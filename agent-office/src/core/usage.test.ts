import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UsageMeter, nextReset, quotaDay, tiredLevel } from './usage.ts';
import type { UsageStorage } from './usage.ts';

const at = (iso: string): number => Date.parse(iso);

function memoryStorage(): UsageStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

test('the quota day follows Pacific time: it changes at 07:00 UTC in summer and 08:00 UTC in winter', () => {
  assert.equal(quotaDay(at('2026-10-07T06:59:59Z')), '2026-10-06');
  assert.equal(quotaDay(at('2026-10-07T07:00:00Z')), '2026-10-07');
  assert.equal(quotaDay(at('2026-12-07T07:59:59Z')), '2026-12-06');
  assert.equal(quotaDay(at('2026-12-07T08:00:00Z')), '2026-12-07');
});

test('the next reset is the next Pacific midnight, also across the daylight saving change', () => {
  assert.equal(nextReset(at('2026-10-06T08:00:00Z')), at('2026-10-07T07:00:00Z'));
  assert.equal(nextReset(at('2026-10-31T19:00:00Z')), at('2026-11-01T07:00:00Z'), 'the last summer day ends at midnight PDT');
  assert.equal(nextReset(at('2026-11-01T20:00:00Z')), at('2026-11-02T08:00:00Z'), 'the next day is on winter time');
  const now = at('2026-10-06T12:34:56Z');
  assert.ok(nextReset(now) > now && nextReset(now) - now <= 25 * 3_600_000);
});

test('calls, tokens and the position that made them are tallied', () => {
  const m = new UsageMeter({ storage: null, now: () => at('2026-10-06T20:00:00Z') });
  assert.deepEqual([m.view().calls, m.view().tokens], [0, 0]);
  m.record('owner', 120);
  m.record('owner', 80);
  m.record('qa', 50.4);
  const v = m.view();
  assert.deepEqual([v.calls, v.tokens, v.byAgent], [3, 250, { owner: 2, qa: 1 }]);
  assert.equal(v.resetAt, at('2026-10-07T07:00:00Z'));
  assert.equal(v.exhausted, false);
});

test('when the quota runs out, what was used is kept as the best guess at the daily limit; an answer means it is back', () => {
  const m = new UsageMeter({ storage: null, now: () => at('2026-10-06T20:00:00Z') });
  m.markExhausted();
  assert.equal(m.view().exhausted, true);
  assert.equal(m.view().cap, null, 'nothing was used yet, so nothing is learned');
  for (let i = 0; i < 7; i++) m.record('owner', 10);
  m.markExhausted();
  assert.deepEqual([m.view().exhausted, m.view().cap], [true, 7]);
  m.record('owner', 10);
  assert.equal(m.view().exhausted, false);
  assert.equal(m.view().cap, 7, 'the guess stays');
});

test('the tally survives a reload on the same day', () => {
  const storage = memoryStorage();
  const now = () => at('2026-10-06T20:00:00Z');
  const a = new UsageMeter({ storage, now });
  a.record('secretary', 100);
  a.markExhausted();
  const b = new UsageMeter({ storage, now });
  assert.deepEqual([b.view().calls, b.view().tokens, b.view().exhausted, b.view().cap], [1, 100, true, 1]);
});

test('a new quota day starts from zero but keeps the learned limit, and listeners hear the rollover once', () => {
  const storage = memoryStorage();
  let clock = at('2026-10-07T06:50:00Z');
  const m = new UsageMeter({ storage, now: () => clock });
  for (let i = 0; i < 4; i++) m.record('owner', 10);
  m.markExhausted();
  let rollovers = 0;
  let changes = 0;
  m.onRollover(() => rollovers++);
  m.onChange(() => changes++);
  assert.equal(m.tick(), false);
  clock = at('2026-10-07T07:00:01Z');
  assert.equal(m.tick(), true);
  assert.equal(m.tick(), false, 'only once');
  assert.deepEqual([rollovers, changes], [1, 1]);
  const v = m.view();
  assert.deepEqual([v.calls, v.tokens, v.exhausted, v.cap, v.byAgent], [0, 0, false, 4, {}]);
  // and a reload the next morning also begins fresh with the learned limit
  const later = new UsageMeter({ storage, now: () => at('2026-10-07T15:00:00Z') });
  assert.deepEqual([later.view().calls, later.view().cap], [0, 4]);
});

test('a call recorded after the reset belongs to the new day', () => {
  let clock = at('2026-10-07T06:59:00Z');
  const m = new UsageMeter({ storage: null, now: () => clock });
  m.record('owner', 5);
  clock = at('2026-10-07T07:01:00Z');
  m.record('owner', 5);
  assert.equal(m.view().calls, 1);
});

test('broken or blocked storage never stops the tally', () => {
  const broken: UsageStorage = {
    getItem: () => '{not json',
    setItem: () => {
      throw new Error('full');
    },
  };
  const m = new UsageMeter({ storage: broken, now: () => at('2026-10-06T20:00:00Z') });
  assert.doesNotThrow(() => m.record('qa', 10));
  assert.equal(m.view().calls, 1);
});

test('tiredness grows with the calls a person made today, and everyone is spent when the quota ran out', () => {
  assert.deepEqual([0, 4, 5, 11, 12, 24, 25, 99].map((n) => tiredLevel(n, false)), [0, 0, 1, 1, 2, 2, 3, 3]);
  assert.equal(tiredLevel(0, true), 3);
});
