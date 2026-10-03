// News search through Google News' public RSS feed (free, no key, covers Thai and English publishers).
// The feed lists title, publisher, time and a link; the full article is a second step (the page tool).

import { decodeEntities } from './extract.ts';

export interface NewsItem {
  title: string;
  source: string;
  /** ISO time, or '' when the feed gave none we could read. */
  published: string;
  link: string;
}

export type NewsLang = 'th' | 'en';

const EDITIONS: Record<NewsLang, string> = {
  th: 'hl=th&gl=TH&ceid=TH:th',
  en: 'hl=en-US&gl=US&ceid=US:en',
};

/** `days` keeps only the last N days (Google's `when:Nd` operator). */
export function newsUrl(query: string, lang: NewsLang = 'th', days?: number): string {
  const q = days && days > 0 ? `${query} when:${Math.min(Math.floor(days), 365)}d` : query;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&${EDITIONS[lang]}`;
}

const cdata = (s: string): string => s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');
const text = (xml: string, tag: string): string => {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(xml);
  return m ? decodeEntities(cdata(m[1])).replace(/\s+/g, ' ').trim() : '';
};

export function parseNews(xml: string, limit = 10): NewsItem[] {
  const out: NewsItem[] = [];
  const seen = new Set<string>();
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    if (out.length >= limit) break;
    const item = m[1];
    const source = text(item, 'source');
    let title = text(item, 'title');
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)).trim(); // Google appends the publisher
    const link = text(item, 'link');
    const time = Date.parse(text(item, 'pubDate'));
    if (!title || !link || seen.has(title)) continue;
    seen.add(title);
    out.push({ title, source, published: Number.isNaN(time) ? '' : new Date(time).toISOString(), link });
  }
  return out;
}

// ---------- Google News article links ----------
// News items link to news.google.com/rss/articles/<id>, a page that only forwards the browser with JavaScript.
// Turning it into the publisher's real address takes two requests: the article page carries a signature and a
// timestamp, which a batchexecute call exchanges for the address. This is not a documented interface, so every
// step may fail; the caller then simply keeps the Google link and finds the article another way (a web search).

const GNEWS_ARTICLE = /^https:\/\/news\.google\.com\/(?:rss\/)?articles\/([A-Za-z0-9_-]+)/;

export const isGoogleNewsLink = (link: string): boolean => GNEWS_ARTICLE.test(link);

export const googleNewsId = (link: string): string | null => GNEWS_ARTICLE.exec(link)?.[1] ?? null;

export function parseArticleToken(html: string): { signature: string; timestamp: string } | null {
  const signature = /data-n-a-sg="([^"]+)"/.exec(html)?.[1];
  const timestamp = /data-n-a-ts="(\d+)"/.exec(html)?.[1];
  return signature && timestamp ? { signature, timestamp } : null;
}

export const BATCH_URL = 'https://news.google.com/_/DotsSplashUi/data/batchexecute';

export function batchBody(id: string, token: { signature: string; timestamp: string }): string {
  const inner = JSON.stringify([
    'garturlreq',
    [['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1], 'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
    id,
    Number(token.timestamp),
    token.signature,
  ]);
  return new URLSearchParams({ 'f.req': JSON.stringify([[['Fbv4je', inner, null, 'generic']]]) }).toString();
}

export function parseBatchResponse(response: string): string | null {
  // The address sits inside a JSON string inside JSON, so characters such as = and & arrive as \\u003d and \\u0026
  // (two backslashes), and slashes may be escaped too.
  const found = /garturlres\\",\\"(https?:(?:[^"\\]|\\\\u[0-9a-fA-F]{4}|\\\\\/)+)/.exec(response)?.[1];
  if (!found) return null;
  const address = found
    .replace(/\\\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\\\\//g, '/');
  try {
    return new URL(address).toString();
  } catch {
    return null;
  }
}

export type PageGetter = (url: string, init?: { method?: 'GET' | 'POST'; body?: string; headers?: Record<string, string> }) => Promise<{ body: string }>;

/** The publisher's address for a Google News link, or null when any step fails. Other links are returned as they are. */
export async function resolveNewsLink(link: string, get: PageGetter): Promise<string | null> {
  const id = googleNewsId(link);
  if (!id) return link;
  try {
    const token = parseArticleToken((await get(`https://news.google.com/rss/articles/${id}`)).body);
    if (!token) return null;
    const reply = await get(BATCH_URL, {
      method: 'POST',
      body: batchBody(id, token),
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    });
    return parseBatchResponse(reply.body);
  } catch {
    return null;
  }
}
