// Measures the real machinery behind the agents so the server room can show it: how many model calls and tool
// calls are running right now, whether the free quota is resting, and whether the search helper is up. The
// counters wrap the model client and the toolbox; the quota comes from the rate limiter and the helper's health
// from its monitor. Nothing here is pretend: every blink in the server room is a real call.

import type { HelperKind, Infra } from '../core/types.ts';
import { IDLE_INFRA } from '../core/types.ts';
import type { UsageMeter } from '../core/usage.ts';
import type { HelperMonitor, HelperState } from './helper-monitor.ts';
import type { RateLimiter } from './limiter.ts';
import type { GenerateRequest, GenerateResult, ModelClient } from './model-client.ts';
import type { Toolbox } from './toolbox.ts';

export interface InfraFeed {
  snapshot(): Infra;
  /** Called with the new snapshot whenever any part of it changes. Returns an unsubscribe. */
  subscribe(listener: (infra: Infra) => void): () => void;
}

export interface InfraMeter extends InfraFeed {
  /** Counts calls while they run. Put it inside the rate limiter so queued calls do not count as running. */
  meterClient(client: ModelClient): ModelClient;
  meterToolbox<T extends Pick<Toolbox, 'search' | 'news' | 'page'>>(toolbox: T): T;
}

const HELPER_KIND: Record<HelperState, HelperKind> = {
  checking: 'unknown',
  ready: 'up',
  degraded: 'degraded',
  missing: 'down',
  blocked: 'down',
  outdated: 'down',
};

export interface InfraDeps {
  limiter?: Pick<RateLimiter, 'onStatus' | 'status'>;
  helper?: Pick<HelperMonitor, 'status' | 'onChange'>;
  /** Today's tally of model calls and tokens (the lobby printer's paper). */
  usage?: Pick<UsageMeter, 'view' | 'onChange'>;
}

export function createInfra(deps: InfraDeps = {}): InfraMeter {
  let model = 0;
  let tools = 0;
  const listeners = new Set<(infra: Infra) => void>();
  let last = '';

  const snapshot = (): Infra => ({
    model,
    tools,
    quota: deps.limiter?.status.phase === 'quota-wait',
    helper: deps.helper ? HELPER_KIND[deps.helper.status.state] : IDLE_INFRA.helper,
    usage: deps.usage ? deps.usage.view() : IDLE_INFRA.usage,
  });

  function changed(): void {
    const now = snapshot();
    const key = JSON.stringify(now);
    if (key === last) return;
    last = key;
    for (const fn of [...listeners]) fn(now);
  }
  last = JSON.stringify(snapshot());
  deps.limiter?.onStatus(changed);
  deps.helper?.onChange(changed);
  deps.usage?.onChange(changed);

  async function counted<T>(bump: (by: number) => void, run: () => Promise<T>): Promise<T> {
    bump(1);
    changed();
    try {
      return await run();
    } finally {
      bump(-1);
      changed();
    }
  }
  const bumpModel = (by: number): void => void (model += by);
  const bumpTools = (by: number): void => void (tools += by);

  return {
    snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    meterClient: (client) => ({
      generate: (req: GenerateRequest): Promise<GenerateResult> => counted(bumpModel, () => client.generate(req)),
    }),
    meterToolbox: (toolbox) => ({
      ...toolbox,
      search: (...a: Parameters<Toolbox['search']>) => counted(bumpTools, () => toolbox.search(...a)),
      news: (...a: Parameters<Toolbox['news']>) => counted(bumpTools, () => toolbox.news(...a)),
      page: (...a: Parameters<Toolbox['page']>) => counted(bumpTools, () => toolbox.page(...a)),
    }),
  };
}
