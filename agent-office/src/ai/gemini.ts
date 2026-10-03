// Gemini adapter: calls Google's REST API straight from the browser with the user's own key.
// The key is read at call time, sent only in the x-goog-api-key header (never in the URL) and is
// scrubbed from every error message, so it cannot leak into the feed, console or an event.

import { ModelError } from './model-client.ts';
import type { GenerateRequest, GenerateResult, ModelClient } from './model-client.ts';

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
/** Google's rolling "latest Flash" alias, so the default does not go stale. Override per position in config. */
export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';
export const DEFAULT_TIMEOUT_MS = 60_000;

export interface GeminiOptions {
  model: string;
  /** Returns the user's key, or null when none is saved. Called on every request. */
  getKey: () => string | null;
  timeoutMs?: number;
  baseUrl?: string;
  /** Swappable for tests; defaults to the browser's fetch. */
  fetchFn?: typeof fetch;
}

interface GeminiBody {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  error?: { code?: number; message?: string; status?: string; details?: Record<string, unknown>[] };
}

/** "12s" / "0.5s" -> milliseconds. */
function parseDuration(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const m = /^(\d+(?:\.\d+)?)s$/.exec(value.trim());
  return m ? Math.round(Number(m[1]) * 1000) : undefined;
}

function retryAfter(res: Response, body: GeminiBody | null): number | undefined {
  for (const d of body?.error?.details ?? []) {
    if (String(d['@type'] ?? '').endsWith('RetryInfo')) {
      const ms = parseDuration(d.retryDelay);
      if (ms !== undefined) return ms;
    }
  }
  const header = Number(res.headers.get('retry-after'));
  return Number.isFinite(header) && header > 0 ? Math.round(header * 1000) : undefined;
}

function toBody(req: GenerateRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    contents: req.history.map((turn) => ({ role: turn.role, parts: [{ text: turn.text }] })),
  };
  if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };
  if (req.maxOutputTokens) body.generationConfig = { maxOutputTokens: req.maxOutputTokens };
  return body;
}

export function createGeminiClient(opts: GeminiOptions): ModelClient {
  const base = opts.baseUrl ?? GEMINI_BASE_URL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async generate(req: GenerateRequest): Promise<GenerateResult> {
      const key = opts.getKey()?.trim();
      if (!key) throw new ModelError('no-key', 'No Gemini API key is saved.');
      if (req.signal?.aborted) throw new ModelError('cancelled', 'Cancelled before sending.');
      if (!req.history.length) throw new ModelError('bad-request', 'Nothing to send: the history is empty.');

      const scrub = (s: string): string => s.split(key).join('[key]');
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const onCallerAbort = (): void => controller.abort();
      req.signal?.addEventListener('abort', onCallerAbort, { once: true });

      try {
        let res: Response;
        try {
          res = await (opts.fetchFn ?? fetch)(`${base}/models/${encodeURIComponent(opts.model)}:generateContent`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
            body: JSON.stringify(toBody(req)),
            signal: controller.signal,
          });
        } catch (err) {
          if (timedOut) throw new ModelError('timeout', `No answer within ${Math.round(timeoutMs / 1000)} s.`);
          if (req.signal?.aborted) throw new ModelError('cancelled', 'Cancelled.');
          // A blocked request and a dead network look the same to the page.
          throw new ModelError('network', scrub(`Could not reach Google: ${String(err)}`));
        }

        let body: GeminiBody | null = null;
        try {
          body = (await res.json()) as GeminiBody;
        } catch {
          if (timedOut) throw new ModelError('timeout', `No answer within ${Math.round(timeoutMs / 1000)} s.`);
          if (req.signal?.aborted) throw new ModelError('cancelled', 'Cancelled.');
          /* not JSON: handled below by status */
        }

        if (!res.ok) throw httpError(res, body, scrub);

        if (body?.promptFeedback?.blockReason) {
          throw new ModelError('blocked', `The request was blocked (${body.promptFeedback.blockReason}).`);
        }
        const candidate = body?.candidates?.[0];
        const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? '').join('');
        if (!text.trim()) {
          if (candidate?.finishReason && candidate.finishReason !== 'STOP' && candidate.finishReason !== 'MAX_TOKENS') {
            throw new ModelError('blocked', `The reply was stopped (${candidate.finishReason}).`);
          }
          throw new ModelError('empty', 'The model returned no text.');
        }

        const u = body?.usageMetadata;
        return {
          text,
          usage: u
            ? {
                promptTokens: u.promptTokenCount ?? 0,
                outputTokens: u.candidatesTokenCount ?? 0,
                totalTokens: u.totalTokenCount ?? (u.promptTokenCount ?? 0) + (u.candidatesTokenCount ?? 0),
              }
            : undefined,
        };
      } finally {
        clearTimeout(timer);
        req.signal?.removeEventListener('abort', onCallerAbort);
      }
    },
  };
}

function httpError(res: Response, body: GeminiBody | null, scrub: (s: string) => string): ModelError {
  const status = res.status;
  const detail = scrub(body?.error?.message ?? `HTTP ${status}`);
  const reasons = (body?.error?.details ?? []).map((d) => String(d.reason ?? ''));
  if (reasons.includes('API_KEY_INVALID') || status === 401 || status === 403) {
    return new ModelError('bad-key', detail, { status });
  }
  if (status === 429) return new ModelError('rate-limit', detail, { status, retryAfterMs: retryAfter(res, body) });
  if (status >= 500) return new ModelError('server', detail, { status });
  return new ModelError('bad-request', detail, { status });
}
