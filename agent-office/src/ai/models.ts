// Which model each position uses: one line per position, so changing a model never touches the UI.
// `null` means the position never calls a model (the courier is plain code).

import { loadKey } from '../core/ai-settings.ts';
import type { AgentId } from '../core/types.ts';
import { DEFAULT_GEMINI_MODEL, createGeminiClient } from './gemini.ts';
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

/** A client per position; positions that share a model name share one client. */
export function createModels(
  config: Record<AgentId, string | null> = MODEL_FOR,
  getKey: () => string | null = () => loadKey(),
  fetchFn?: typeof fetch,
): (agent: AgentId) => ModelClient {
  const cache = new Map<string, ModelClient>();
  return (agent) => {
    const model = config[agent];
    if (!model) throw new Error(`${agent} does not use a model`);
    let client = cache.get(model);
    if (!client) {
      client = createGeminiClient({ model, getKey, fetchFn });
      cache.set(model, client);
    }
    return client;
  };
}
