// How much of today's free AI quota this app has used. Google gives no "remaining" figure to a caller, so this
// counts what the app itself asked for (calls and the tokens the model reported), keeps the day's tally in the
// browser, and starts again when the daily quota resets (midnight Pacific time, as Google documents). The one
// thing it can learn is the daily limit: the number of calls made the last time the quota ran out.

import type { AgentId, UsageView } from './types.ts';

const ZONE = 'America/Los_Angeles';
const KEY = 'agent-office.usage';

const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** The quota day a moment belongs to ("2026-10-06" in Pacific time). */
export const quotaDay = (ms: number): string => dayFormat.format(ms);

/** The first moment of the next quota day (the next midnight in Pacific time), found to the millisecond. */
export function nextReset(ms: number): number {
  const day = quotaDay(ms);
  let lo = ms;
  let hi = ms + 26 * 3_600_000; // a day is 23 to 25 hours long around daylight saving changes
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (quotaDay(mid) === day) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** Where the day's tally is kept. A browser's localStorage fits; tests pass their own. */
export interface UsageStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface Stored {
  day: string;
  calls: number;
  tokens: number;
  byAgent: Partial<Record<AgentId, number>>;
  exhausted: boolean;
  cap: number | null;
}

const fresh = (day: string, cap: number | null): Stored => ({ day, calls: 0, tokens: 0, byAgent: {}, exhausted: false, cap });

function defaultStorage(): UsageStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // blocked storage: the tally lives for this tab only
  }
}

function load(storage: UsageStorage | null): Stored | null {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Stored>;
    if (typeof d.day !== 'string' || typeof d.calls !== 'number' || typeof d.tokens !== 'number') return null;
    return {
      day: d.day,
      calls: d.calls,
      tokens: d.tokens,
      byAgent: d.byAgent && typeof d.byAgent === 'object' ? d.byAgent : {},
      exhausted: d.exhausted === true,
      cap: typeof d.cap === 'number' ? d.cap : null,
    };
  } catch {
    return null;
  }
}

/** How worn out someone looks: 0 fresh .. 3 exhausted. It follows the calls they made today, and everybody is spent when the quota ran out. */
export function tiredLevel(callsToday: number, exhausted: boolean): 0 | 1 | 2 | 3 {
  if (exhausted) return 3;
  if (callsToday >= 25) return 3;
  if (callsToday >= 12) return 2;
  return callsToday >= 5 ? 1 : 0;
}

/** Seconds between yawns at each level (0 = never). */
export const YAWN_EVERY: readonly number[] = [0, 14, 8, 4];

export class UsageMeter {
  private state: Stored;
  private readonly storage: UsageStorage | null;
  private readonly now: () => number;
  private changeListeners = new Set<() => void>();
  private rolloverListeners = new Set<() => void>();

  constructor(opts: { storage?: UsageStorage | null; now?: () => number } = {}) {
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.now = opts.now ?? Date.now;
    const today = quotaDay(this.now());
    const saved = load(this.storage);
    // A tally from an earlier day is dropped (its daily limit guess is kept: it is about the key, not the day).
    this.state = saved && saved.day === today ? saved : fresh(today, saved?.cap ?? null);
  }

  /** The tally now. Rolls over first if the quota day has changed. */
  view(): UsageView {
    this.tick();
    const s = this.state;
    return { calls: s.calls, tokens: s.tokens, byAgent: { ...s.byAgent }, exhausted: s.exhausted, cap: s.cap, resetAt: nextReset(this.now()) };
  }

  /** One answered model call by `agent`, with the tokens the model reported. An answer means the quota is back. */
  record(agent: AgentId, tokens: number): void {
    this.tick();
    const s = this.state;
    s.calls += 1;
    s.tokens += Math.max(0, Math.round(tokens) || 0);
    s.byAgent[agent] = (s.byAgent[agent] ?? 0) + 1;
    s.exhausted = false;
    this.save();
    this.emitChange();
  }

  /** The free quota ran out: what was used so far is the best guess at the daily limit. */
  markExhausted(): void {
    this.tick();
    const s = this.state;
    if (s.exhausted) return;
    s.exhausted = true;
    if (s.calls > 0) s.cap = s.calls;
    this.save();
    this.emitChange();
  }

  /** Starts a new tally when the quota day has changed. Returns true when it did. Call it now and then. */
  tick(): boolean {
    const today = quotaDay(this.now());
    if (today === this.state.day) return false;
    this.state = fresh(today, this.state.cap);
    this.save();
    for (const fn of [...this.rolloverListeners]) fn();
    this.emitChange();
    return true;
  }

  onChange(fn: () => void): () => void {
    this.changeListeners.add(fn);
    return () => this.changeListeners.delete(fn);
  }

  /** Told when the daily quota resets while the app is open. */
  onRollover(fn: () => void): () => void {
    this.rolloverListeners.add(fn);
    return () => this.rolloverListeners.delete(fn);
  }

  private emitChange(): void {
    for (const fn of [...this.changeListeners]) fn();
  }

  private save(): void {
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.state));
    } catch {
      /* storage full or blocked: the tally still works for this tab */
    }
  }
}
