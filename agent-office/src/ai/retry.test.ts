import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ModelError } from './model-client.ts';
import type { ModelErrorKind } from './model-client.ts';
import { withRetry } from './retry.ts';
import { createModels, MODEL_FOR } from './models.ts';

/** A call that fails with the given kinds in order, then succeeds. */
function flaky(failures: ModelErrorKind[]): { call: () => Promise<string>; count: () => number } {
  let n = 0;
  return {
    call: async () => {
      const kind = failures[n++];
      if (kind) throw new ModelError(kind, kind);
      return 'done';
    },
    count: () => n,
  };
}

test('temporary failures are retried with a growing wait, then succeed', async () => {
  const waits: number[] = [];
  const f = flaky(['network', 'server']);
  const result = await withRetry(f.call, { sleep: async (ms) => void waits.push(ms), baseDelayMs: 100 });
  assert.equal(result, 'done');
  assert.equal(f.count(), 3);
  assert.deepEqual(waits, [100, 200]);
});

test('it gives up after the retry limit and throws the last error', async () => {
  const f = flaky(['timeout', 'timeout', 'timeout', 'timeout']);
  await assert.rejects(withRetry(f.call, { retries: 2, sleep: async () => {} }), (e: unknown) => e instanceof ModelError && e.kind === 'timeout');
  assert.equal(f.count(), 3, 'first try plus two retries');
});

test('rate limits, bad keys, blocks and cancels are never retried here', async () => {
  for (const kind of ['rate-limit', 'bad-key', 'no-key', 'blocked', 'bad-request', 'cancelled'] as const) {
    const f = flaky([kind, kind]);
    await assert.rejects(withRetry(f.call, { sleep: async () => {} }));
    assert.equal(f.count(), 1, `${kind} must not be retried`);
  }
});

test('a cancel during the wait stops the retry', async () => {
  const ctl = new AbortController();
  const f = flaky(['network', 'network']);
  await assert.rejects(
    withRetry(f.call, {
      signal: ctl.signal,
      sleep: async () => {
        ctl.abort();
      },
    }),
    (e: unknown) => e instanceof ModelError && e.kind === 'cancelled',
  );
  assert.equal(f.count(), 1);
});

test('every position except the courier has a model, and the courier has none', () => {
  assert.equal(MODEL_FOR.courier, null);
  for (const [agent, model] of Object.entries(MODEL_FOR)) if (agent !== 'courier') assert.ok(model, `${agent} needs a model`);
});

test('positions on the same model share one client, and the courier is refused', () => {
  const models = createModels(MODEL_FOR, () => 'k');
  assert.equal(models('owner'), models('qa'));
  assert.throws(() => models('courier'), /does not use a model/);
});
