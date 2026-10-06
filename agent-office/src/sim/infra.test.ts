// The office passes the real machinery's state on as `infra` events, and the store keeps the latest.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { InfraFeed } from '../ai/infra.ts';
import { IDLE_INFRA, IDLE_USAGE } from '../core/types.ts';
import type { Infra, OfficeEvent } from '../core/types.ts';
import { OfficeStore } from '../core/state.ts';
import { MockOffice } from './simulator.ts';

function feed(initial: Infra): InfraFeed & { push(next: Infra): void; listeners(): number } {
  let current = initial;
  const subs = new Set<(i: Infra) => void>();
  return {
    snapshot: () => current,
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    push(next) {
      current = next;
      for (const fn of subs) fn(next);
    },
    listeners: () => subs.size,
  };
}

const busy: Infra = { model: 1, tools: 0, quota: false, helper: 'up', usage: IDLE_USAGE };

test('the store keeps the latest picture of the machinery and starts quiet', () => {
  const store = new OfficeStore();
  assert.deepEqual(store.state.infra, IDLE_INFRA);
  store.apply({ type: 'infra', infra: busy });
  assert.deepEqual(store.state.infra, busy);
  store.apply({ type: 'infra', infra: { ...busy, quota: true } });
  assert.equal(store.state.infra.quota, true);
  assert.notEqual(store.state.infra, busy, 'the store holds its own copy');
});

test('a newcomer is told the current picture at once, and every change after that is passed on', () => {
  const f = feed(busy);
  const office = new MockOffice({ ambient: false, infra: f });
  const events: OfficeEvent[] = [];
  office.subscribe((e) => events.push(e));
  assert.deepEqual(events, [{ type: 'infra', infra: busy }]);
  f.push({ model: 0, tools: 2, quota: true, helper: 'degraded', usage: IDLE_USAGE });
  assert.deepEqual(events.at(-1), { type: 'infra', infra: { model: 0, tools: 2, quota: true, helper: 'degraded', usage: IDLE_USAGE } });
  office.dispose();
});

test('a reset clears the picture of the job but re-sends the machinery\'s real state', () => {
  const f = feed({ ...busy, helper: 'down' });
  const office = new MockOffice({ ambient: false, infra: f });
  const store = new OfficeStore();
  office.subscribe((e) => store.apply(e));
  assert.equal(store.state.infra.helper, 'down');
  office.reset();
  assert.equal(store.state.infra.helper, 'down', 'the helper is still down after a reset');
  office.dispose();
});

test('without a feed no infra events appear (the plain demo is unchanged)', () => {
  const office = new MockOffice({ ambient: false });
  const events: OfficeEvent[] = [];
  office.subscribe((e) => events.push(e));
  office.reset();
  assert.equal(events.some((e) => e.type === 'infra'), false);
  office.dispose();
});

test('disposing the office stops listening to the feed', () => {
  const f = feed(IDLE_INFRA);
  const office = new MockOffice({ ambient: false, infra: f });
  assert.equal(f.listeners(), 1);
  office.dispose();
  assert.equal(f.listeners(), 0);
});
