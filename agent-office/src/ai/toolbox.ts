// The app's side of the local helper: typed calls for web search, news and page text. The helper does the
// downloading (browsers cannot, CORS), this file only asks nicely and turns every failure into something the
// agents and the screen can act on. No API key ever goes through here.

import { CLIENT_HEADER, HELPER_PORT, HELPER_PROTOCOL } from '../../helper/config.ts';

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}
export interface SearchResult {
  engine: string;
  hits: SearchHit[];
  cached: boolean;
}
export interface NewsItem {
  title: string;
  source: string;
  /** ISO time, or '' when unknown. */
  published: string;
  link: string;
}
export interface NewsResult {
  items: NewsItem[];
  cached: boolean;
}
export interface PageResult {
  title: string;
  description: string;
  text: string;
  /** Length of the text before it was cut to the size asked for. */
  chars: number;
  truncated: boolean;
  language: 'th' | 'en';
  /** The address the text really came from (after redirects, or a Google News link's real article). */
  url: string;
  requestedUrl: string;
  fetchedAt: string;
  cached: boolean;
}
export interface HelperHealth {
  name: string;
  protocol: number;
  tools: string[];
  engines: { name: string; restingUntil: number | null }[];
}

/**
 * - missing: nothing answers at the helper's address (it is not running)
 * - forbidden: it runs but refuses this page (the app is on an address the helper was not told about)
 * - busy: the search engines are not answering right now; try again later
 * - blocked / unsupported / not-found / timeout / upstream: the page itself could not be read
 */
export type ToolErrorKind =
  | 'missing'
  | 'forbidden'
  | 'bad-request'
  | 'blocked'
  | 'unsupported'
  | 'not-found'
  | 'rate-limited'
  | 'timeout'
  | 'upstream'
  | 'busy'
  | 'outdated'
  | 'cancelled';

/** `message` is an English diagnostic for logs; the screen shows text chosen by `kind`. */
export class ToolError extends Error {
  kind: ToolErrorKind;
  retryAfterMs?: number;
  constructor(kind: ToolErrorKind, message: string, retryAfterMs?: number) {
    super(message);
    this.name = 'ToolError';
    this.kind = kind;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface Toolbox {
  health(signal?: AbortSignal): Promise<HelperHealth>;
  search(query: string, opts?: { region?: 'th-th' | 'us-en' | 'wt-wt'; limit?: number; signal?: AbortSignal }): Promise<SearchResult>;
  news(query: string, opts?: { lang?: 'th' | 'en'; days?: number; limit?: number; signal?: AbortSignal }): Promise<NewsResult>;
  page(url: string, opts?: { maxChars?: number; signal?: AbortSignal }): Promise<PageResult>;
}

export interface ToolboxOptions {
  baseUrl?: string;
  fetchFn?: typeof fetch;
  /** Time allowed per call. A download can take a while: these are generous. */
  timeoutMs?: { health?: number; search?: number; news?: number; page?: number };
}

/** The helper's error codes, as the app names them. */
const KIND: Record<string, ToolErrorKind> = {
  'bad-request': 'bad-request',
  forbidden: 'forbidden',
  'not-found': 'not-found',
  unsupported: 'unsupported',
  blocked: 'blocked',
  'rate-limited': 'rate-limited',
  upstream: 'upstream',
  unavailable: 'busy',
  timeout: 'timeout',
  internal: 'upstream',
};

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; retryAfterMs?: number };
}

export function createToolbox(options: ToolboxOptions = {}): Toolbox {
  const base = options.baseUrl ?? `http://127.0.0.1:${HELPER_PORT}`;
  const timeouts = { health: 3000, search: 25_000, news: 25_000, page: 35_000, ...options.timeoutMs };

  async function ask<T>(path: string, params: Record<string, string | number | undefined>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
    const url = new URL(path, base);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    if (signal?.aborted) throw new ToolError('cancelled', 'Cancelled before sending.');

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = (): void => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      let res: Response;
      try {
        res = await (options.fetchFn ?? fetch)(url, { headers: { [CLIENT_HEADER]: '1' }, signal: controller.signal });
      } catch (err) {
        if (timedOut) throw new ToolError(path === '/health' ? 'missing' : 'timeout', 'The helper did not answer in time.');
        if (signal?.aborted) throw new ToolError('cancelled', 'Cancelled.');
        throw new ToolError('missing', `The helper is not reachable (${String(err)}).`);
      }
      let body: Envelope<T> | null = null;
      try {
        body = (await res.json()) as Envelope<T>;
      } catch {
        if (timedOut) throw new ToolError('timeout', 'The helper did not finish in time.');
        if (signal?.aborted) throw new ToolError('cancelled', 'Cancelled.');
      }
      if (!body || typeof body.ok !== 'boolean') throw new ToolError('upstream', `The helper sent something unexpected (status ${res.status}).`);
      if (!body.ok || body.data === undefined) {
        const e = body.error;
        throw new ToolError(KIND[e?.code ?? ''] ?? 'upstream', e?.message ?? `The helper answered with status ${res.status}.`, e?.retryAfterMs);
      }
      return body.data;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  return {
    async health(signal) {
      const h = await ask<HelperHealth>('/health', {}, timeouts.health, signal);
      if (h.protocol !== HELPER_PROTOCOL) throw new ToolError('outdated', `The helper speaks protocol ${h.protocol}, the app expects ${HELPER_PROTOCOL}.`);
      return h;
    },
    search: (query, o = {}) => ask<SearchResult>('/search', { q: query, region: o.region, limit: o.limit }, timeouts.search, o.signal),
    news: (query, o = {}) => ask<NewsResult>('/news', { q: query, lang: o.lang, days: o.days, limit: o.limit }, timeouts.news, o.signal),
    page: (url, o = {}) => ask<PageResult>('/page', { url, max: o.maxChars }, timeouts.page, o.signal),
  };
}
