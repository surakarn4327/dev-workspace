// The lobby printer's paper as the office state keeps it: the pile follows the day's calls, the tray runs empty when
// the free quota runs out, and after the daily reset both stay until Zip brings fresh paper.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OfficeStore, describeEvent } from './state.ts';
import { IDLE_INFRA } from './types.ts';
import type { OfficeEvent, UsageView } from './types.ts';

const usage = (over: Partial<UsageView>): UsageView => ({ calls: 0, tokens: 0, byAgent: {}, exhausted: false, cap: null, resetAt: 0, ...over });
const infra = (u: Partial<UsageView>): OfficeEvent => ({ type: 'infra', infra: { ...IDLE_INFRA, usage: usage(u) } });

test('a new office has a clean printer', () => {
  assert.deepEqual(new OfficeStore().state.paper, { printed: 0, empty: false, due: false });
});

test('the pile follows the day\'s calls', () => {
  const s = new OfficeStore();
  s.apply(infra({ calls: 3 }));
  s.apply(infra({ calls: 9 }));
  assert.deepEqual(s.state.paper, { printed: 9, empty: false, due: false });
});

test('the tray is empty while the quota is out, and full again when an answer comes back', () => {
  const s = new OfficeStore();
  s.apply(infra({ calls: 40, exhausted: true }));
  assert.equal(s.state.paper.empty, true);
  s.apply(infra({ calls: 41, exhausted: false }));
  assert.equal(s.state.paper.empty, false);
});

test('after the daily reset the old pile and the empty tray stay until fresh paper arrives', () => {
  const s = new OfficeStore();
  s.apply(infra({ calls: 40, exhausted: true }));
  s.apply(infra({ calls: 0, exhausted: false })); // the tally started over
  assert.deepEqual(s.state.paper, { printed: 40, empty: true, due: true }, 'nothing changes on the printer yet');
  s.apply(infra({ calls: 2, exhausted: false }));
  assert.deepEqual(s.state.paper, { printed: 40, empty: true, due: true }, 'new calls do not hide the old pile either');
  s.apply({ type: 'paper.restocked' });
  assert.deepEqual(s.state.paper, { printed: 2, empty: false, due: false }, 'the pile restarts from today\'s calls');
  s.apply(infra({ calls: 3 }));
  assert.equal(s.state.paper.printed, 3);
});

test('a recording made before the usage tally existed still plays', () => {
  const s = new OfficeStore();
  const old = { type: 'infra', infra: { model: 1, tools: 0, quota: false, helper: 'up' } } as unknown as OfficeEvent;
  assert.doesNotThrow(() => s.apply(old));
  assert.equal(s.state.infra.usage.calls, 0);
  assert.equal(s.state.infra.model, 1);
});

test('the feed tells when fresh paper arrived', () => {
  assert.match(describeEvent({ type: 'paper.restocked' }) ?? '', /fresh paper/);
});
