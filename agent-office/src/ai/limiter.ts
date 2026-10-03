// Keeps us inside the free quota without asking the user for any numbers. It runs one call at a time,
// spaces them out, and learns from Google: a 429 pauses everything for as long as Google asked and
// slows the pace; a run of successes speeds it up again (slow down fast, speed up carefully).
// If Google asks for a very long wait (most likely the daily quota is used up) it gives up and lets the
// error through, so the office can tell the user instead of waiting forever.

import { ModelError } from './model-client.ts';
import type { GenerateRequest, GenerateResult, ModelClient } from './model-client.ts';
import { withRetry } from './retry.ts';

export type LimiterPhase = 'idle' | 'working' | 'quota-wait';

export interface LimiterStatus {
  phase: LimiterPhase;
  /** Calls waiting for their turn (not counting the one running). */
  queued: number;
  /** While in quota-wait: the clock time (ms) the pause ends. */
  waitUntil: number | null;
  /** Current minimum spacing between call starts. */
  gapMs: number;
}

export interface LimiterOptions {
  /** Starting spacing between calls. Deliberately cautious: ~10 calls a minute. */
  startGapMs?: number;
  /** Never go faster than this. */
  floorGapMs?: number;
  /** Never go slower than this. */
  maxGapMs?: number;
  /** A wait longer than this is treated as "quota used up" and the error is passed on. */
  maxWaitMs?: number;
  /** How many quota pauses one call may sit through before giving up. */
  maxWaits?: number;
  /** Clock and sleeper, swappable for tests. */
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

interface Job {
  start: () => Promise<void>;
  cancel: (err: ModelError) => void;
  signal?: AbortSignal;
}

const SUCCESSES_TO_SPEED_UP = 8;
const SPEED_UP = 0.85;
const SLOW_DOWN = 1.5;
const FIRST_GUESS_WAIT_MS = 15_000; // when Google gives no retry time: 15 s, 30 s, 60 s ...
const MAX_GUESS_WAIT_MS = 60_000;
const MARGIN_MS = 1000; // a little past what Google said, to be safe

function realSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ModelError('cancelled', 'Cancelled while waiting.'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new ModelError('cancelled', 'Cancelled while waiting.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class RateLimiter {
  private gapMs: number;
  private readonly floorGapMs: number;
  private readonly maxGapMs: number;
  private readonly maxWaitMs: number;
  private readonly maxWaits: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;

  private lastStart = Number.NEGATIVE_INFINITY;
  private pausedUntil = 0;
  private streak = 0;
  private strikes = 0;
  private queue: Job[] = [];
  private draining = false;
  private phase: LimiterPhase = 'idle';
  private waitUntil: number | null = null;
  private listeners = new Set<(s: LimiterStatus) => void>();

  constructor(opts: LimiterOptions = {}) {
    this.gapMs = opts.startGapMs ?? 6000;
    this.floorGapMs = opts.floorGapMs ?? 4000;
    this.maxGapMs = opts.maxGapMs ?? 30_000;
    this.maxWaitMs = opts.maxWaitMs ?? 120_000;
    this.maxWaits = opts.maxWaits ?? 3;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? realSleep;
  }

  get status(): LimiterStatus {
    return { phase: this.phase, queued: this.queue.length, waitUntil: this.waitUntil, gapMs: this.gapMs };
  }

  onStatus(fn: (s: LimiterStatus) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Queue a model call. Calls run one at a time, in order, at a safe pace. */
  run<T>(call: () => Promise<T>, opts: { signal?: AbortSignal } = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const { signal } = opts;
      if (signal?.aborted) return reject(new ModelError('cancelled', 'Cancelled before it started.'));
      const job: Job = {
        signal,
        start: async () => {
          try {
            resolve(await this.execute(call, signal));
          } catch (err) {
            reject(err);
          }
        },
        cancel: reject,
      };
      signal?.addEventListener(
        'abort',
        () => {
          const i = this.queue.indexOf(job);
          if (i < 0) return; // already running: the call itself sees the abort
          this.queue.splice(i, 1);
          job.cancel(new ModelError('cancelled', 'Cancelled while queued.'));
          this.emit();
        },
        { once: true },
      );
      this.queue.push(job);
      this.emit();
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      for (let job = this.queue.shift(); job; job = this.queue.shift()) {
        this.emit();
        await job.start();
      }
    } finally {
      this.draining = false;
      this.phase = 'idle';
      this.waitUntil = null;
      this.emit();
    }
  }

  private async execute<T>(call: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    let waits = 0;
    for (;;) {
      await this.waitForSlot(signal);
      this.lastStart = this.now();
      this.setPhase('working', null);
      try {
        const result = await call();
        this.streak += 1;
        this.strikes = 0;
        if (this.streak >= SUCCESSES_TO_SPEED_UP) {
          this.gapMs = Math.max(this.floorGapMs, Math.round(this.gapMs * SPEED_UP));
          this.streak = 0;
        }
        return result;
      } catch (err) {
        if (!(err instanceof ModelError) || err.kind !== 'rate-limit') throw err;
        const wait = this.learnFromRateLimit(err);
        if (wait > this.maxWaitMs || waits >= this.maxWaits) throw err; // quota is probably gone for now
        waits += 1;
        this.pausedUntil = this.now() + wait;
      }
    }
  }

  private learnFromRateLimit(err: ModelError): number {
    this.strikes += 1;
    this.streak = 0;
    this.gapMs = Math.min(this.maxGapMs, Math.round(this.gapMs * SLOW_DOWN));
    if (err.retryAfterMs !== undefined) return err.retryAfterMs + MARGIN_MS;
    return Math.min(MAX_GUESS_WAIT_MS, FIRST_GUESS_WAIT_MS * 2 ** (this.strikes - 1));
  }

  private async waitForSlot(signal?: AbortSignal): Promise<void> {
    const now = this.now();
    const delay = Math.max(this.lastStart + this.gapMs, this.pausedUntil) - now;
    if (delay <= 0) return;
    if (this.pausedUntil > now) this.setPhase('quota-wait', this.pausedUntil);
    await this.sleep(delay, signal);
  }

  private setPhase(phase: LimiterPhase, waitUntil: number | null): void {
    if (phase === this.phase && waitUntil === this.waitUntil) return;
    this.phase = phase;
    this.waitUntil = waitUntil;
    this.emit();
  }

  private emit(): void {
    const s = this.status;
    for (const fn of [...this.listeners]) fn(s);
  }
}

/** Wraps a client so every call goes through the limiter, and temporary failures are retried inside the slot. */
export function limitClient(client: ModelClient, limiter: RateLimiter): ModelClient {
  return {
    generate(req: GenerateRequest): Promise<GenerateResult> {
      return limiter.run(() => withRetry(() => client.generate(req), { signal: req.signal }), { signal: req.signal });
    },
  };
}
