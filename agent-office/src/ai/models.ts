// Which model each position uses: one line per position, so changing a model never touches the UI.
// `null` means the position never calls a model (the courier is plain code).
// All positions share one rate limiter, because the free quota belongs to the user's key, not to a position.

import { loadKey } from '../core/ai-settings.ts';
import type { AgentId } from '../core/types.ts';
import { DEFAULT_GEMINI_MODEL, createGeminiClient } from './gemini.ts';
import { RateLimiter, limitClient } from './limiter.ts';
import type { ModelClient } from './model-client.ts';

export const MODEL_FOR: Record<AgentId, string | null> = {
  owner: DEFAULT_GEMINI_MODEL,
  secretary: DEFAULT_GEMINI_MODEL,
  'research-head': DEFAULT_GEMINI_MODEL,
  'research-1': DEFAULT_GEMINI_MODEL,
  'research-2': DEFAULT_GEMINI_MODEL,
  'prod-head': DEFAULT_GEMINI_MODEL,
  'prod-1': DEFAULT_GEMINI_MODEL,
  'prod-2': DEFAULT_GEMINI_MODEL,
  qa: DEFAULT_GEMINI_MODEL,
  courier: null,
};

export interface Models {
  /** The client for a position (paced by the shared limiter). Throws for positions without a model. */
  clientFor(agent: AgentId): ModelClient;
  /** Watch this to show "thinking" / "waiting for quota" in the office. */
  limiter: RateLimiter;
}

export function createModels(
  config: Record<AgentId, string | null> = MODEL_FOR,
  getKey: () => string | null = () => loadKey(),
  opts: { fetchFn?: typeof fetch; limiter?: RateLimiter; meter?: (client: ModelClient) => ModelClient } = {},
): Models {
  const limiter = opts.limiter ?? new RateLimiter();
  const cache = new Map<string, ModelClient>();
  return {
    limiter,
    clientFor(agent) {
      const model = config[agent];
      if (!model) throw new Error(`${agent} does not use a model`);
      let client = cache.get(model);
      if (!client) {
        // The meter sits inside the limiter, so only calls that are really on the wire are counted as running.
        const raw = createGeminiClient({ model, getKey, fetchFn: opts.fetchFn });
        client = limitClient(opts.meter ? opts.meter(raw) : raw, limiter);
        cache.set(model, client);
      }
      return client;
    },
  };
}
