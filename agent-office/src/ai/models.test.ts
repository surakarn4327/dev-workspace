// Every call is credited to the position that made it, and a rate limit that gets past the limiter reads as "out of paper".

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UsageMeter } from '../core/usage.ts';
import { MODEL_FOR, createModels } from './models.ts';
import { RateLimiter } from './limiter.ts';

const ok = (): Response =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } }), { status: 200 });
const history = [{ role: 'user' as const, text: 'Hello' }];
const fastLimiter = (): RateLimiter => new RateLimiter({ startGapMs: 0, floorGapMs: 0, sleep: async () => {}, maxWaitMs: 1000, maxWaits: 1 });

test('calls are tallied per position with the tokens the model reported', async () => {
  const usage = new UsageMeter({ storage: null });
  const models = createModels(MODEL_FOR, () => 'k', { fetchFn: async () => ok(), limiter: fastLimiter(), usage });
  await models.clientFor('owner').generate({ history });
  await models.clientFor('qa').generate({ history });
  await models.clientFor('qa').generate({ history });
  const v = usage.view();
  assert.deepEqual([v.calls, v.tokens], [3, 45]);
  assert.deepEqual(v.byAgent, { owner: 1, qa: 2 });
});

test('positions that share a model are still counted apart', async () => {
  const usage = new UsageMeter({ storage: null });
  const models = createModels(MODEL_FOR, () => 'k', { fetchFn: async () => ok(), limiter: fastLimiter(), usage });
  assert.equal(MODEL_FOR['prod-1'], MODEL_FOR['prod-2']);
  await models.clientFor('prod-1').generate({ history });
  await models.clientFor('prod-2').generate({ history });
  assert.deepEqual(usage.view().byAgent, { 'prod-1': 1, 'prod-2': 1 });
});

test('a call that fails is not a printed page; a quota that ran out marks the paper as gone, and the next answer brings it back', async () => {
  const usage = new UsageMeter({ storage: null });
  let mode: 'ok' | 'quota' | 'broken' = 'ok';
  const fetchFn: typeof fetch = async () => {
    if (mode === 'quota') return new Response(JSON.stringify({ error: { code: 429, details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '3600s' }] } }), { status: 429 });
    if (mode === 'broken') return new Response('{}', { status: 400 });
    return ok();
  };
  const models = createModels(MODEL_FOR, () => 'k', { fetchFn, limiter: fastLimiter(), usage });
  const client = models.clientFor('owner');
  await client.generate({ history });
  mode = 'broken';
  await assert.rejects(client.generate({ history }));
  assert.deepEqual([usage.view().calls, usage.view().exhausted], [1, false], 'an ordinary error is not the quota running out');
  mode = 'quota';
  await assert.rejects(client.generate({ history }));
  assert.deepEqual([usage.view().exhausted, usage.view().cap], [true, 1]);
  mode = 'ok';
  await client.generate({ history });
  assert.equal(usage.view().exhausted, false);
});

test('without a usage meter the client is the plain one', async () => {
  const models = createModels(MODEL_FOR, () => 'k', { fetchFn: async () => ok(), limiter: fastLimiter() });
  assert.equal((await models.clientFor('owner').generate({ history })).text, 'hi');
});
