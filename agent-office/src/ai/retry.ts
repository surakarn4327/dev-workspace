// Retries a model call when the failure is probably temporary (network blip, timeout, server hiccup,
// empty reply). Rate limits are NOT retried here: waiting for quota is the rate limiter's job, because
// it knows about every other call in flight. Key problems, blocks and cancels are never retried.

import { ModelError, isTransient } from './model-client.ts';

export interface RetryOptions {
  /** Extra attempts after the first (default 2, so up to 3 calls). */
  retries?: number;
  baseDelayMs?: number;
  /** Swappable for tests. */
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function withRetry<T>(call: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 2;
  const base = opts.baseDelayMs ?? 1000;
  const sleep = opts.sleep ?? realSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (err) {
      const retryable = err instanceof ModelError && isTransient(err.kind);
      if (!retryable || attempt >= retries || opts.signal?.aborted) throw err;
      await sleep(base * 2 ** attempt); // 1 s, 2 s, 4 s ...
      if (opts.signal?.aborted) throw new ModelError('cancelled', 'Cancelled while waiting to retry.');
    }
  }
}
