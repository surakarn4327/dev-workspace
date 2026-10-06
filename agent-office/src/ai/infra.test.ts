import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInfra } from './infra.ts';
import type { InfraDeps } from './infra.ts';
import type { HelperState } from './helper-monitor.ts';
import type { GenerateRequest, ModelClient } from './model-client.ts';
import type { Toolbox } from './toolbox.ts';
import { IDLE_USAGE } from '../core/types.ts';
import type { Infra } from '../core/types.ts';

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

function fakeLimiter() {
  const listeners = new Set<() => void>();
  const state = { phase: 'idle' as 'idle' | 'working' | 'quota-wait' };
  return {
    state,
    limiter: {
      get status() {
        return { phase: state.phase, queued: 0, waitUntil: null, gapMs: 0 };
      },
      onStatus(fn: () => void): () => void {
        listeners.add(fn);
        return () => void listeners.delete(fn);
      },
    },
    set(phase: 'idle' | 'working' | 'quota-wait') {
      state.phase = phase;
      for (const fn of listeners) fn();
    },
  };
}

function fakeHelper(initial: HelperState = 'checking') {
  const listeners = new Set<() => void>();
  let state: HelperState = initial;
  return {
    helper: {
      get status() {
        return { state, resting: [] };
      },
      onChange(fn: () => void): () => void {
        listeners.add(fn);
        return () => void listeners.delete(fn);
      },
    },
    set(next: HelperState) {
      state = next;
      for (const fn of listeners) fn();
    },
  };
}

test('with nothing connected the picture is the quiet default', () => {
  assert.deepEqual(createInfra().snapshot(), { model: 0, tools: 0, quota: false, helper: 'unknown', usage: IDLE_USAGE });
});

test('model calls are counted while they run, and listeners hear the start and the end', async () => {
  const infra = createInfra();
  const heard: Infra[] = [];
  infra.subscribe((i) => heard.push(i));
  const releases: (() => void)[] = [];
  const slow: ModelClient = { generate: () => new Promise((resolve) => void releases.push(() => resolve({ text: 'ok' }))) };
  const metered = infra.meterClient(slow);
  const a = metered.generate({ history: [{ role: 'user', text: 'x' }] });
  const b = metered.generate({ history: [{ role: 'user', text: 'y' }] });
  assert.equal(infra.snapshot().model, 2);
  releases[0]();
  await a;
  await settle();
  assert.equal(infra.snapshot().model, 1, 'the second call is still running');
  releases[1]();
  await b;
  assert.equal(infra.snapshot().model, 0);
  assert.deepEqual(heard.map((h) => h.model), [1, 2, 1, 0]);
});

test('a call that fails is still counted out, and its error passes through untouched', async () => {
  const infra = createInfra();
  const boom = new Error('boom');
  const metered = infra.meterClient({ generate: async (_r: GenerateRequest) => Promise.reject(boom) });
  await assert.rejects(metered.generate({ history: [{ role: 'user', text: 'x' }] }), (e: unknown) => e === boom);
  assert.equal(infra.snapshot().model, 0);
});

test('the toolbox is metered call by call and results pass through; the health check is not counted', async () => {
  const infra = createInfra();
  const heard: number[] = [];
  infra.subscribe((i) => heard.push(i.tools));
  const raw: Toolbox = {
    health: async () => ({ name: 'h', protocol: 1, tools: [], engines: [] }),
    search: async () => ({ engine: 'bing', hits: [], cached: false }),
    news: async () => ({ items: [], cached: false }),
    page: async () => {
      throw new Error('page failed');
    },
  };
  const tb = infra.meterToolbox(raw);
  assert.equal((await tb.search('x')).engine, 'bing');
  await tb.news('x');
  await assert.rejects(tb.page('https://x.example/'));
  assert.equal(infra.snapshot().tools, 0);
  assert.deepEqual(heard, [1, 0, 1, 0, 1, 0]);
  heard.length = 0;
  await tb.health();
  assert.deepEqual(heard, [], 'checking on the helper is not a tool call');
});

test('the quota flag follows the rate limiter', async () => {
  const lim = fakeLimiter();
  const infra = createInfra({ limiter: lim.limiter as unknown as InfraDeps['limiter'] });
  const heard: boolean[] = [];
  infra.subscribe((i) => heard.push(i.quota));
  lim.set('working');
  assert.deepEqual(heard, [], 'working is not news here');
  lim.set('quota-wait');
  assert.equal(infra.snapshot().quota, true);
  lim.set('idle');
  assert.equal(infra.snapshot().quota, false);
  assert.deepEqual(heard, [true, false]);
});

test('the helper kind follows the helper monitor: checking, ready, degraded and every way of being gone', () => {
  const h = fakeHelper();
  const infra = createInfra({ helper: h.helper as unknown as InfraDeps['helper'] });
  const kinds: string[] = [];
  infra.subscribe((i) => kinds.push(i.helper));
  for (const state of ['ready', 'degraded', 'missing', 'blocked', 'outdated', 'checking'] as HelperState[]) h.set(state);
  assert.deepEqual(kinds, ['up', 'degraded', 'down', 'unknown'], 'repeats of the same kind are not announced');
});

test('subscribers can leave, and an unchanged picture is never announced twice', async () => {
  const infra = createInfra();
  let n = 0;
  const off = infra.subscribe(() => n++);
  await infra.meterClient({ generate: async () => ({ text: '' }) }).generate({ history: [{ role: 'user', text: 'x' }] });
  assert.equal(n, 2);
  off();
  await infra.meterClient({ generate: async () => ({ text: '' }) }).generate({ history: [{ role: 'user', text: 'x' }] });
  assert.equal(n, 2);
});
