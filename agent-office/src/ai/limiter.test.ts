// A fake clock: sleeping just moves time forward, so these tests run instantly and touch no network.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RateLimiter, limitClient } from './limiter.ts';
import type { LimiterOptions, LimiterStatus } from './limiter.ts';
import { ModelError } from './model-client.ts';
import type { GenerateRequest, ModelClient } from './model-client.ts';

function setup(opts: LimiterOptions = {}) {
  let time = 1_000_000;
  const slept: number[] = [];
  const limiter = new RateLimiter({
    startGapMs: 1000,
    floorGapMs: 400,
    now: () => time,
    sleep: async (ms, signal) => {
      if (signal?.aborted) throw new ModelError('cancelled', 'cancelled');
      slept.push(ms);
      time += ms;
    },
    ...opts,
  });
  return { limiter, slept, now: () => time, advance: (ms: number) => void (time += ms) };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));
const rateLimit =(retryAfterMs?: number): ModelError => new ModelError('rate-limit', 'quota', { status: 429, retryAfterMs });

test('calls start at least one gap apart', async () => {
  const { limiter, now } = setup();
  const starts: number[] = [];
  for (let i = 0; i < 3; i++) await limiter.run(async () => void starts.push(now()));
  assert.deepEqual(starts.map((t) => t - starts[0]), [0, 1000, 2000]);
});

test('calls run one at a time, in the order they were queued', async () => {
  const { limiter } = setup();
  const log: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const a = limiter.run(async () => {
    log.push('a start');
    await gate;
    log.push('a end');
    return 'A';
  });
  const b = limiter.run(async () => {
    log.push('b start');
    return 'B';
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(log, ['a start'], 'b must wait for a');
  assert.equal(limiter.status.queued, 1);
  release();
  assert.deepEqual(await Promise.all([a, b]), ['A', 'B']);
  assert.deepEqual(log, ['a start', 'a end', 'b start']);
});

test('a 429 pauses for the time Google asked plus a margin, then the call is tried again', async () => {
  const { limiter, slept, now } = setup();
  const seen: LimiterStatus[] = [];
  limiter.onStatus((s) => seen.push(s));
  let n = 0;
  const t0 = now();
  const result = await limiter.run(async () => {
    if (n++ === 0) throw rateLimit(5000);
    return 'ok';
  });
  assert.equal(result, 'ok');
  assert.equal(n, 2);
  assert.ok(slept.some((ms) => ms >= 6000), 'waited 5 s + 1 s margin');
  assert.ok(now() - t0 >= 6000);
  const quota = seen.find((s) => s.phase === 'quota-wait');
  assert.ok(quota && quota.waitUntil !== null && quota.waitUntil > t0, 'the status showed a quota wait with an end time');
  await tick(); // the queue reports "idle" a moment after the last call's promise settles
  assert.equal(limiter.status.phase, 'idle');
});

test('after a 429 the pace slows down, and a run of successes speeds it up again', async () => {
  const { limiter } = setup();
  let n = 0;
  await limiter.run(async () => {
    if (n++ === 0) throw rateLimit(100);
  });
  assert.equal(limiter.status.gapMs, 1500, 'slowed by half again');
  for (let i = 0; i < 8; i++) await limiter.run(async () => {});
  assert.equal(limiter.status.gapMs, Math.round(1500 * 0.85), 'one step faster after 8 good calls');
  for (let i = 0; i < 80; i++) await limiter.run(async () => {});
  assert.equal(limiter.status.gapMs, 400, 'never faster than the floor');
});

test('with no retry time from Google the wait is a guess that doubles: 15 s, then 30 s', async () => {
  const { limiter, slept } = setup();
  let n = 0;
  await limiter.run(async () => {
    if (n++ < 2) throw rateLimit();
  });
  const long = slept.filter((ms) => ms >= 10_000);
  assert.ok(long[0] >= 15_000 && long[0] < 16_000);
  assert.ok(long[1] >= 30_000 && long[1] < 31_000);
});

test('a very long wait means the quota is probably gone: the error is passed on without waiting', async () => {
  const { limiter, slept } = setup();
  let n = 0;
  await assert.rejects(
    limiter.run(async () => {
      n++;
      throw rateLimit(600_000);
    }),
    (e: unknown) => e instanceof ModelError && e.kind === 'rate-limit',
  );
  assert.equal(n, 1);
  assert.equal(slept.filter((ms) => ms > 5000).length, 0, 'it did not sit through the 10 minutes');
  await tick();
  assert.equal(limiter.status.phase, 'idle');
});

test('it gives up after a few pauses on the same call', async () => {
  const { limiter } = setup();
  let n = 0;
  await assert.rejects(
    limiter.run(async () => {
      n++;
      throw rateLimit(1000);
    }),
    (e: unknown) => e instanceof ModelError && e.kind === 'rate-limit',
  );
  assert.equal(n, 4, 'first try plus three pauses');
});

test('other errors go straight through with no pause, and the next call still runs', async () => {
  const { limiter, slept } = setup();
  await assert.rejects(limiter.run(async () => Promise.reject(new ModelError('bad-key', 'x'))), (e: unknown) => e instanceof ModelError && e.kind === 'bad-key');
  assert.equal(await limiter.run(async () => 'fine'), 'fine');
  assert.equal(slept.filter((ms) => ms > 1000).length, 0);
});

test('a call cancelled while queued never runs, and the one running is not disturbed', async () => {
  const { limiter } = setup();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let ranB = false;
  const a = limiter.run(async () => {
    await gate;
    return 'A';
  });
  const ctl = new AbortController();
  const b = limiter.run(async () => void (ranB = true), { signal: ctl.signal });
  ctl.abort();
  await assert.rejects(b, (e: unknown) => e instanceof ModelError && e.kind === 'cancelled');
  release();
  assert.equal(await a, 'A');
  assert.equal(ranB, false);
  assert.equal(limiter.status.queued, 0);
});

test('a call whose signal is already aborted is refused at once', async () => {
  const { limiter } = setup();
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(limiter.run(async () => 'x', { signal: ctl.signal }), (e: unknown) => e instanceof ModelError && e.kind === 'cancelled');
});

test('limitClient retries temporary failures inside the slot and leaves 429 to the limiter', async () => {
  const { limiter } = setup();
  const script: (Error | string)[] = [new ModelError('network', 'blip'), rateLimit(100), 'hello'];
  let calls = 0;
  const inner: ModelClient = {
    async generate(_req: GenerateRequest) {
      const step = script[calls++];
      if (step instanceof Error) throw step;
      return { text: step };
    },
  };
  const client = limitClient(inner, limiter);
  // withRetry uses real sleep for the network blip; keep it fast by only checking the end result and call count.
  const r = await client.generate({ history: [{ role: 'user', text: 'hi' }] });
  assert.equal(r.text, 'hello');
  assert.equal(calls, 3);
});
