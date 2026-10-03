// Web search through DuckDuckGo's plain-HTML results page (free, no key). This is reading a web page, not an
// official API, so the parser is deliberately forgiving and reports "blocked" instead of returning nonsense when
// DuckDuckGo shows its anti-bot page.

import { decodeEntities, stripTags } from './extract.ts';

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export class SearchBlockedError extends Error {
  constructor(message = 'The search engine asked for a human check and gave no results.') {
    super(message);
    this.name = 'SearchBlockedError';
  }
}

export const SEARCH_ENDPOINT = 'https://html.duckduckgo.com/html/';

/** The form body DuckDuckGo's HTML page expects. `region` like 'th-th' or 'us-en'. */
export function searchBody(query: string, region = 'wt-wt'): string {
  return new URLSearchParams({ q: query, kl: region, kp: '-1' }).toString(); // kp=-1: no safe-search filtering of news
}

/** DuckDuckGo wraps result links as //duckduckgo.com/l/?uddg=<real url>; direct links are kept as they are. */
export function realUrl(href: string): string | null {
  const raw = decodeEntities(href.trim());
  const absolute = raw.startsWith('//') ? `https:${raw}` : raw;
  let url: URL;
  try {
    url = new URL(absolute);
  } catch {
    return null;
  }
  if (url.hostname.endsWith('duckduckgo.com')) {
    const target = url.searchParams.get('uddg');
    if (!target) return null; // ads (y.js) and internal links carry no target
    try {
      url = new URL(target);
    } catch {
      return null;
    }
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
}

export function parseSearch(html: string, limit = 10): SearchHit[] {
  const starts = [...html.matchAll(/<a\b[^>]*class\s*=\s*["'][^"']*\bresult__a\b[^"']*["'][^>]*>/gi)].map((m) => m.index ?? 0);
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < starts.length && hits.length < limit; i++) {
    const block = html.slice(starts[i], starts[i + 1] ?? html.length);
    const before = html.slice(Math.max(0, starts[i] - 600), starts[i]);
    if (/result--ad\b/.test(before.slice(before.lastIndexOf('<div class="result')))) continue;

    const anchor = /^<a\b([^>]*)>([\s\S]*?)<\/a>/i.exec(block);
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(anchor?.[1] ?? '');
    const url = realUrl(href?.[1] ?? href?.[2] ?? '');
    const title = stripTags(anchor?.[2] ?? '');
    if (!url || !title || seen.has(url)) continue;
    const snippet = /class\s*=\s*["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div|td)>/i.exec(block)?.[1];
    seen.add(url);
    hits.push({ title, url, snippet: snippet ? stripTags(snippet) : '' });
  }
  if (hits.length === 0 && /anomaly|captcha|challenge|unusual traffic/i.test(html)) throw new SearchBlockedError();
  return hits;
}

// ---------- Bing (second engine) ----------

/** Bing wraps result links as bing.com/ck/a?...&u=a1<base64url of the real address>. */
export function decodeBingUrl(href: string): string | null {
  const raw = decodeEntities(href.trim());
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!url.hostname.endsWith('bing.com')) return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  const u = url.searchParams.get('u');
  if (!u || !u.startsWith('a1')) return null;
  try {
    const target = new URL(Buffer.from(u.slice(2), 'base64url').toString('utf8'));
    return target.protocol === 'http:' || target.protocol === 'https:' ? target.toString() : null;
  } catch {
    return null;
  }
}

export function bingUrl(query: string, region = 'wt-wt'): string {
  const market = region === 'th-th' ? '&setlang=th&cc=TH' : region === 'us-en' ? '&setlang=en&cc=US' : '';
  return `https://www.bing.com/search?q=${encodeURIComponent(query)}${market}`;
}

export function parseBing(html: string, limit = 10): SearchHit[] {
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  const blocks = html.split(/<li\b[^>]*class\s*=\s*["']b_algo["'][^>]*>/i).slice(1);
  for (const raw of blocks) {
    if (hits.length >= limit) break;
    const block = raw.replace(/<link\b[^>]*>/gi, '');
    const heading = /<h2\b[^>]*>\s*<a\b([^>]*)>([\s\S]*?)<\/a>/i.exec(block);
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(heading?.[1] ?? '');
    const url = decodeBingUrl(href?.[1] ?? href?.[2] ?? '');
    const title = stripTags(heading?.[2] ?? '');
    if (!url || !title || seen.has(url)) continue;
    const snippet = /<div\b[^>]*class\s*=\s*["'][^"']*\bb_caption\b[^"']*["'][^>]*>[\s\S]*?<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(block)?.[1];
    seen.add(url);
    hits.push({ title, url, snippet: snippet ? stripTags(snippet) : '' });
  }
  if (hits.length === 0 && /id\s*=\s*["']b_captcha|\/challenge\/|unusual traffic/i.test(html)) throw new SearchBlockedError();
  return hits;
}

// ---------- the engines, in the order they are tried ----------

export interface SearchRequest {
  url: string;
  method: 'GET' | 'POST';
  body?: string;
}

export interface SearchEngine {
  name: 'duckduckgo' | 'bing';
  request(query: string, region: string): SearchRequest;
  parse(html: string, limit: number): SearchHit[];
}

export const SEARCH_ENGINES: readonly SearchEngine[] = [
  { name: 'duckduckgo', request: (q, region) => ({ url: SEARCH_ENDPOINT, method: 'POST', body: searchBody(q, region) }), parse: parseSearch },
  { name: 'bing', request: (q, region) => ({ url: bingUrl(q, region), method: 'GET' }), parse: parseBing },
];
