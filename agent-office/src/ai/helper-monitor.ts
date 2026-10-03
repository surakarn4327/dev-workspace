// Keeps track of whether the local helper is there, for the Menu and for the agents ("can I search right now?").

import { ToolError } from './toolbox.ts';
import type { Toolbox } from './toolbox.ts';

/**
 * - checking: asking
 * - ready: everything works
 * - degraded: running, but every search engine is resting (news and page reading still work)
 * - missing: not running
 * - blocked: running but refusing this page (restart the dev server so the helper learns its address)
 * - outdated: running but older or newer than this app
 */
export type HelperState = 'checking' | 'ready' | 'degraded' | 'missing' | 'blocked' | 'outdated';

export interface HelperStatus {
  state: HelperState;
  /** Search engines currently resting. */
  resting: string[];
}

export interface HelperMonitor {
  readonly status: HelperStatus;
  /** Ask the helper now. Safe to call often; overlapping checks share one request. */
  check(): Promise<HelperStatus>;
  /** A tool call just showed the helper is gone (or back): update without asking. */
  report(state: HelperState): void;
  onChange(fn: (status: HelperStatus) => void): () => void;
  /** True when web tools can be offered to the agents. */
  canUseTools(): boolean;
}

export function createHelperMonitor(toolbox: Pick<Toolbox, 'health'>, now: () => number = Date.now): HelperMonitor {
  let status: HelperStatus = { state: 'checking', resting: [] };
  let inFlight: Promise<HelperStatus> | null = null;
  const listeners = new Set<(s: HelperStatus) => void>();

  function set(next: HelperStatus): void {
    const changed = next.state !== status.state || next.resting.join() !== status.resting.join();
    status = next;
    if (changed) for (const fn of [...listeners]) fn(status);
  }

  async function run(): Promise<HelperStatus> {
    try {
      const h = await toolbox.health();
      const resting = h.engines.filter((e) => e.restingUntil !== null && e.restingUntil > now()).map((e) => e.name);
      set({ state: resting.length > 0 && resting.length === h.engines.length ? 'degraded' : 'ready', resting });
    } catch (err) {
      const kind = err instanceof ToolError ? err.kind : 'missing';
      set({ state: kind === 'forbidden' ? 'blocked' : kind === 'outdated' ? 'outdated' : 'missing', resting: [] });
    }
    return status;
  }

  return {
    get status() {
      return status;
    },
    check() {
      inFlight ??= run().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    report(state) {
      set({ state, resting: state === 'ready' ? status.resting : [] });
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    canUseTools: () => status.state === 'ready' || status.state === 'degraded',
  };
}
