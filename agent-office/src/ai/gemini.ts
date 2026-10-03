// Gemini adapter: calls Google's REST API straight from the browser with the user's own key.
// The key is read at call time, sent only in the x-goog-api-key header (never in the URL) and is
// scrubbed from every error message, so it cannot leak into the feed, console or an event.

import { ModelError } from './model-client.ts';
import type { ChatTurn, GenerateRequest, GenerateResult, ModelClient } from './model-client.ts';

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
/**
 * Google's rolling "latest Flash-Lite" alias. Flash-Lite answers fast and does not spend a long thinking phase
 * first; plain "gemini-flash-latest" thinks at length by default, which made short replies slow (10 s+) and cut
 * them off (thinking tokens count against maxOutputTokens). Override per position in models.ts.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-flash-lite-latest';
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

interface GeminiPart {
  text?: string;
  /** Present when the model's thinking part was returned (not asked for); never shown to the user. */
  thought?: boolean;
  functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
  thoughtSignature?: string;
}

interface GeminiBody {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    thoughtsTokenCount?: number;
  };
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

function partsOf(turn: ChatTurn): unknown[] {
  if (turn.toolAnswers?.length) {
    return turn.toolAnswers.map((a) => ({ functionResponse: { name: a.name, ...(a.id ? { id: a.id } : {}), response: { result: a.response } } }));
  }
  return [{ text: turn.text }];
}

function toBody(req: GenerateRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    // A turn carrying the provider's own parts (tool calls with their signatures, tool answers) goes back untouched.
    contents: req.history.map((turn) => ({ role: turn.role, parts: turn.parts ?? partsOf(turn) })),
  };
  if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };
  if (req.maxOutputTokens) body.generationConfig = { maxOutputTokens: req.maxOutputTokens };
  if (req.tools?.length) {
    body.tools = [{ functionDeclarations: req.tools }];
    body.toolConfig = { functionCallingConfig: { mode: req.toolMode === 'none' ? 'NONE' : 'AUTO' } };
  }
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
        const parts = candidate?.content?.parts ?? [];
        const text = parts.filter((p) => !p.thought).map((p) => p.text ?? '').join('');
        const toolCalls = parts
          .filter((p) => p.functionCall?.name)
          .map((p) => ({ ...(p.functionCall?.id ? { id: p.functionCall.id } : {}), name: String(p.functionCall?.name), args: p.functionCall?.args ?? {} }));
        if (!text.trim() && toolCalls.length === 0) {
          if (candidate?.finishReason && candidate.finishReason !== 'STOP' && candidate.finishReason !== 'MAX_TOKENS') {
            throw new ModelError('blocked', `The reply was stopped (${candidate.finishReason}).`);
          }
          // Out of tokens before any text came out (thinking used them all): let the caller retry with more room.
          if (candidate?.finishReason !== 'MAX_TOKENS') throw new ModelError('empty', 'The model returned no text.');
        }

        const u = body?.usageMetadata;
        return {
          text,
          usage: u
            ? {
                promptTokens: u.promptTokenCount ?? 0,
                outputTokens: u.candidatesTokenCount ?? 0,
                totalTokens: u.totalTokenCount ?? (u.promptTokenCount ?? 0) + (u.candidatesTokenCount ?? 0),
                ...(u.thoughtsTokenCount !== undefined ? { thoughtTokens: u.thoughtsTokenCount } : {}),
              }
            : undefined,
          finishReason: candidate?.finishReason,
          ...(toolCalls.length ? { toolCalls, parts } : {}),
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
