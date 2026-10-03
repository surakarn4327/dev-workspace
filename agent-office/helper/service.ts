// The helper's tools as plain functions: search the web, search the news, read a page. This layer is what keeps
// the free engines willing to talk to us: results are cached, requests are paced per site and rate limited, and an
// engine that blocks us is left alone for a while while the next one is tried.

import { FetchError, fetchPage as realFetchPage } from './fetcher.ts';
import type { FetchedPage, FetchOptions } from './fetcher.ts';
import { DEFAULT_MAX_CHARS, extractText } from './extract.ts';
import type { PageText } from './extract.ts';
import type { UrlRules } from './guard.ts';
import { isGoogleNewsLink, newsUrl, parseNews, resolveNewsLink } from './news.ts';
import type { NewsItem, NewsLang } from './news.ts';
import { SEARCH_ENGINES, SearchBlockedError } from './search.ts';
import type { SearchEngine, SearchHit } from './search.ts';

export type ServiceErrorCode = 'bad-request' | 'blocked' | 'unsupported' | 'not-found' | 'rate-limited' | 'timeout' | 'upstream' | 'unavailable';

export class ServiceError extends Error {
  code: ServiceErrorCode;
  retryAfterMs?: number;
  constructor(code: ServiceErrorCode, message: string, retryAfterMs?: number) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

export type Region = 'th-th' | 'us-en' | 'wt-wt';
const REGIONS: readonly Region[] = ['th-th', 'us-en', 'wt-wt'];

export interface SearchResult {
  engine: string;
  hits: SearchHit[];
  cached: boolean;
}
export interface NewsResult {
  items: NewsItem[];
  cached: boolean;
}
export interface PageResult extends PageText {
  url: string;
  requestedUrl: string;
  fetchedAt: string;
  cached: boolean;
}

export interface ServiceOptions {
  fetchPage?: (url: string, options?: FetchOptions) => Promise<FetchedPage>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  rules?: UrlRules;
  engines?: readonly SearchEngine[];
  /** Requests per minute allowed through each tool, and the minimum gap between two requests to one site. */
  limits?: { search?: number; page?: number; hostGapMs?: number; concurrent?: number };
  ttlMs?: { search?: number; news?: number; page?: number };
}

const MINUTE = 60_000;
/** How long an engine that blocked us is left alone: grows with each repeat, up to an hour. */
const COOLDOWNS = [5 * MINUTE, 15 * MINUTE, 30 * MINUTE, 60 * MINUTE];

class TtlCache<T> {
  private items = new Map<string, { value: T; until: number }>();
  private readonly ttl: number;
  private readonly max: number;
  private readonly now: () => number;
  constructor(ttl: number, now: () => number, max = 200) {
    this.ttl = ttl;
    this.now = now;
    this.max = max;
  }
  get(key: string): T | undefined {
    const hit = this.items.get(key);
    if (!hit) return undefined;
    if (hit.until <= this.now()) {
      this.items.delete(key);
      return undefined;
    }
    return hit.value;
  }
  set(key: string, value: T): void {
    if (this.items.size >= this.max) this.items.delete(this.items.keys().next().value as string); // oldest first
    this.items.set(key, { value, until: this.now() + this.ttl });
  }
}

/** At most `limit` calls in any 60 seconds. */
class RateWindow {
  private stamps: number[] = [];
  private readonly limit: number;
  private readonly now: () => number;
  constructor(limit: number, now: () => number) {
    this.limit = limit;
    this.now = now;
  }
  take(): number {
    const t = this.now();
    this.stamps = this.stamps.filter((s) => s > t - MINUTE);
    if (this.stamps.length >= this.limit) return this.stamps[0] + MINUTE - t;
    this.stamps.push(t);
    return 0;
  }
}

const clean = (q: unknown, max = 300): string => (typeof q === 'string' ? q.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const clamp = (n: unknown, min: number, max: number, fallback: number): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;

export interface WebService {
  search(query: string, opts?: { region?: string; limit?: number }): Promise<SearchResult>;
  news(query: string, opts?: { lang?: string; days?: number; limit?: number }): Promise<NewsResult>;
  page(url: string, opts?: { maxChars?: number }): Promise<PageResult>;
  /** For /health: which engines are resting and until when (ms since epoch). */
  engineStatus(): { name: string; restingUntil: number | null }[];
}

export function createWebService(options: ServiceOptions = {}): WebService {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const get = options.fetchPage ?? realFetchPage;
  const rules = options.rules ?? {};
  const engines = options.engines ?? SEARCH_ENGINES;
  const hostGap = options.limits?.hostGapMs ?? 1200;
  const maxConcurrent = options.limits?.concurrent ?? 4;

  const searchCache = new TtlCache<{ engine: string; hits: SearchHit[] }>(options.ttlMs?.search ?? 10 * MINUTE, now);
  const newsCache = new TtlCache<NewsItem[]>(options.ttlMs?.news ?? 5 * MINUTE, now);
  const pageCache = new TtlCache<Omit<PageResult, 'cached'>>(options.ttlMs?.page ?? 10 * MINUTE, now);
  const searchRate = new RateWindow(options.limits?.search ?? 20, now);
  const pageRate = new RateWindow(options.limits?.page ?? 40, now);
  const resting = new Map<string, { until: number; strikes: number }>();

  // Never hit one site faster than hostGap, and never run more than maxConcurrent downloads at once.
  const nextFree = new Map<string, number>();
  let active = 0;
  const waiting: (() => void)[] = [];
  async function download(url: string, init: FetchOptions = {}): Promise<FetchedPage> {
    while (active >= maxConcurrent) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      const host = new URL(url).hostname;
      const start = Math.max(now(), nextFree.get(host) ?? 0);
      nextFree.set(host, start + hostGap);
      if (start > now()) await sleep(start - now());
      return await get(url, { rules, ...init });
    } finally {
      active--;
      waiting.shift()?.();
    }
  }

  const slow = (rate: RateWindow): void => {
    const wait = rate.take();
    if (wait > 0) throw new ServiceError('rate-limited', 'Too many requests; wait a moment.', wait);
  };

  function rest(engine: string): void {
    const prev = resting.get(engine);
    const strikes = Math.min((prev?.strikes ?? 0) + 1, COOLDOWNS.length);
    resting.set(engine, { until: now() + COOLDOWNS[strikes - 1], strikes });
  }

  function fromFetch(err: unknown, what: string): ServiceError {
    if (err instanceof ServiceError) return err;
    if (err instanceof FetchError) {
      switch (err.code) {
        case 'blocked': return new ServiceError('blocked', err.message);
        case 'timeout': return new ServiceError('timeout', err.message);
        case 'bad-type': return new ServiceError('unsupported', err.message);
        case 'status': return new ServiceError(err.status === 404 || err.status === 410 ? 'not-found' : 'upstream', err.message);
        default: return new ServiceError('upstream', err.message);
      }
    }
    return new ServiceError('upstream', `${what} failed unexpectedly.`);
  }

  return {
    engineStatus: () => engines.map((e) => ({ name: e.name, restingUntil: (resting.get(e.name)?.until ?? 0) > now() ? (resting.get(e.name)?.until ?? null) : null })),

    async search(rawQuery, opts = {}) {
      const query = clean(rawQuery);
      if (!query) throw new ServiceError('bad-request', 'The search needs some words.');
      const region = (REGIONS as readonly string[]).includes(opts.region ?? '') ? (opts.region as Region) : 'wt-wt';
      const limit = clamp(opts.limit, 1, 15, 8);
      const key = `${region}|${limit}|${query.toLowerCase()}`;
      const cached = searchCache.get(key);
      if (cached) return { ...cached, cached: true };
      slow(searchRate);

      let failed = false;
      let lastEngine = engines[0]?.name ?? 'none';
      for (const engine of engines) {
        const rest0 = resting.get(engine.name);
        if (rest0 && rest0.until > now()) {
          failed = true;
          continue;
        }
        lastEngine = engine.name;
        try {
          const req = engine.request(query, region);
          const page = await download(req.url, { method: req.method, body: req.body });
          const hits = engine.parse(page.body, limit);
          if (hits.length === 0) continue; // an empty page may be a quiet block: try the next engine
          resting.delete(engine.name);
          const result = { engine: engine.name, hits };
          searchCache.set(key, result);
          return { ...result, cached: false };
        } catch (err) {
          failed = true;
          if (err instanceof SearchBlockedError || (err instanceof FetchError && err.code !== 'blocked')) rest(engine.name);
        }
      }
      if (failed) {
        const soonest = Math.min(...[...resting.values()].map((r) => r.until - now()).filter((ms) => ms > 0), COOLDOWNS[0]);
        throw new ServiceError('unavailable', 'The search engines are not answering right now.', soonest);
      }
      return { engine: lastEngine, hits: [], cached: false };
    },

    async news(rawQuery, opts = {}) {
      const query = clean(rawQuery);
      if (!query) throw new ServiceError('bad-request', 'The news search needs some words.');
      const lang: NewsLang = opts.lang === 'en' ? 'en' : 'th';
      const days = opts.days === undefined ? undefined : clamp(opts.days, 1, 365, 7);
      const limit = clamp(opts.limit, 1, 20, 10);
      const key = `${lang}|${days ?? ''}|${limit}|${query.toLowerCase()}`;
      const cached = newsCache.get(key);
      if (cached) return { items: cached, cached: true };
      slow(searchRate);
      try {
        const items = parseNews((await download(newsUrl(query, lang, days))).body, limit);
        newsCache.set(key, items);
        return { items, cached: false };
      } catch (err) {
        throw fromFetch(err, 'The news search');
      }
    },

    async page(rawUrl, opts = {}) {
      const requestedUrl = typeof rawUrl === 'string' ? rawUrl.trim() : '';
      if (!requestedUrl) throw new ServiceError('bad-request', 'A page address is needed.');
      const maxChars = clamp(opts.maxChars, 500, 20_000, DEFAULT_MAX_CHARS);
      const key = `${maxChars}|${requestedUrl}`;
      const cached = pageCache.get(key);
      if (cached) return { ...cached, cached: true };
      slow(pageRate);

      let target = requestedUrl;
      if (isGoogleNewsLink(requestedUrl)) {
        const real = await resolveNewsLink(requestedUrl, (url, init) => download(url, init));
        if (!real) throw new ServiceError('unavailable', 'That Google News link could not be opened; search for the article title instead.');
        target = real;
      }
      try {
        const fetched = await download(target);
        const plain = /^(text\/plain|application\/(json|ld\+json))/i.test(fetched.contentType);
        const text: PageText = plain
          ? { title: '', description: '', text: fetched.body.trim().slice(0, maxChars), chars: fetched.body.trim().length, truncated: fetched.body.trim().length > maxChars, language: extractText(fetched.body.slice(0, 2000)).language }
          : extractText(fetched.body, { maxChars });
        const result = { ...text, url: fetched.url, requestedUrl, fetchedAt: new Date(now()).toISOString() };
        pageCache.set(key, result);
        return { ...result, cached: false };
      } catch (err) {
        throw fromFetch(err, 'Reading the page');
      }
    },
  };
}
