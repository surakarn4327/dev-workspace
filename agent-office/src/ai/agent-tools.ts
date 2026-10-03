// The web tools an agent can ask for, in the words the model sees (declarations) and the code that carries them
// out through the local helper. A tool never throws at the model: a failure becomes an answer that says what
// went wrong and what to do about it, so the agent can adapt (try another page, or admit it could not check).

import { ToolError } from './toolbox.ts';
import type { PageResult, SearchHit, NewsItem, Toolbox } from './toolbox.ts';
import type { ToolAnswer, ToolCall, ToolDeclaration } from './model-client.ts';

export const WEB_TOOLS: ToolDeclaration[] = [
  {
    name: 'web_search',
    description:
      'Search the web. Returns the titles, addresses and short snippets of the best matches. Use specific words. If the first search is not useful, search again with different words. Snippets are not enough to state facts: open the best pages with read_page.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to search for, in the language most likely to have good pages.' },
        region: { type: 'string', enum: ['th-th', 'us-en', 'wt-wt'], description: 'th-th for Thai pages, us-en for English pages, wt-wt for anywhere (default).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'news_search',
    description:
      'Search recent news articles. Returns titles, publishers and times. Use it for anything that changes from day to day: prices, events, announcements. Open the best articles with read_page (a news address from here works).',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for in the news.' },
        language: { type: 'string', enum: ['th', 'en'], description: 'Edition to search: th (Thai) or en (English).' },
        days: { type: 'integer', description: 'Only news from the last N days (1 to 365).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_page',
    description:
      'Open a web page by its address and read its text. Use it on the most relevant results to check facts and to quote numbers, dates and names exactly. Pages that load their content with JavaScript may come back nearly empty.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The full address starting with http or https.' },
        max_chars: { type: 'integer', description: 'How much text to read (500 to 8000, default 4000).' },
      },
      required: ['url'],
    },
  },
];

export const WEB_TOOL_NAMES = new Set(WEB_TOOLS.map((t) => t.name));

/** A page an agent actually opened, or a result it was shown. Used to check that cited sources are real. */
export interface Source {
  url: string;
  title: string;
  /** Which tool produced it. */
  via: 'web_search' | 'news_search' | 'read_page';
  /** The address asked for, when it differs from `url` (a news link resolved to the article). */
  requestedUrl?: string;
}

export interface ToolRun {
  answer: ToolAnswer;
  /** What the tool added to the agent's evidence. */
  read: Source[];
  seen: Source[];
  /** Set when the helper itself is gone, so the caller can stop offering tools. */
  error?: ToolError['kind'];
}

export interface ToolContext {
  toolbox: Pick<Toolbox, 'search' | 'news' | 'page'>;
  signal?: AbortSignal;
  /** Most characters of page text handed to the model per read_page. */
  maxPageChars?: number;
}

const DEFAULT_PAGE_CHARS = 4000;

/** What the model is told when a tool fails: the reason and what to do next. */
const ADVICE: Record<ToolError['kind'], string> = {
  missing: 'The web tools are not available. Do not call them again. Answer from what you know and say clearly that it could not be checked against real sources.',
  forbidden: 'The web tools are not available. Do not call them again; say clearly that nothing could be checked against real sources.',
  outdated: 'The web tools are not available. Do not call them again; say clearly that nothing could be checked against real sources.',
  busy: 'The search engines are resting. Try news_search or read_page on an address you already have, or continue and say what you could not check.',
  'rate-limited': 'Too many tool calls too fast. Continue with the evidence you already have.',
  blocked: 'That address cannot be opened. Try a different result.',
  unsupported: 'That address is not a text page (an image or a file). Try a different result.',
  'not-found': 'That page does not exist. Try a different result.',
  timeout: 'That page took too long to answer. Try a different result.',
  upstream: 'That page could not be read. Try a different result.',
  'bad-request': 'The request was not valid. Check the arguments.',
  cancelled: 'Cancelled.',
};

/** After these, the helper is gone for this run: stop offering tools. */
export const HELPER_GONE: ReadonlySet<ToolError['kind']> = new Set(['missing', 'forbidden', 'outdated']);

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function failure(name: string, call: ToolCall, kind: ToolError['kind'], message: string): ToolRun {
  return { answer: { id: call.id, name, response: { ok: false, error: kind, message, advice: ADVICE[kind] } }, read: [], seen: [], error: kind };
}

/** Carries out one tool call. Never throws except to pass on a cancel. */
export async function runTool(call: ToolCall, ctx: ToolContext): Promise<ToolRun> {
  const { name, args } = call;
  try {
    switch (name) {
      case 'web_search': {
        const query = str(args.query);
        if (!query) return failure(name, call, 'bad-request', 'web_search needs a query.');
        const region = ['th-th', 'us-en', 'wt-wt'].includes(str(args.region)) ? (str(args.region) as 'th-th' | 'us-en' | 'wt-wt') : undefined;
        const r = await ctx.toolbox.search(query, { region, limit: 6, signal: ctx.signal });
        const seen = r.hits.map((h: SearchHit): Source => ({ url: h.url, title: h.title, via: 'web_search' }));
        return { answer: { id: call.id, name, response: { ok: true, results: r.hits.map((h) => ({ title: h.title, url: h.url, snippet: h.snippet })) } }, read: [], seen };
      }
      case 'news_search': {
        const query = str(args.query);
        if (!query) return failure(name, call, 'bad-request', 'news_search needs a query.');
        const days = num(args.days);
        const r = await ctx.toolbox.news(query, { lang: str(args.language) === 'en' ? 'en' : 'th', days: days === undefined ? undefined : Math.max(1, Math.min(365, Math.floor(days))), limit: 8, signal: ctx.signal });
        const seen = r.items.map((i: NewsItem): Source => ({ url: i.link, title: i.title, via: 'news_search' }));
        return { answer: { id: call.id, name, response: { ok: true, articles: r.items.map((i) => ({ title: i.title, publisher: i.source, published: i.published, address: i.link })) } }, read: [], seen };
      }
      case 'read_page': {
        const url = str(args.url);
        if (!/^https?:\/\//i.test(url)) return failure(name, call, 'bad-request', 'read_page needs a full address starting with http or https.');
        const cap = ctx.maxPageChars ?? DEFAULT_PAGE_CHARS;
        const wanted = num(args.max_chars);
        const maxChars = Math.max(500, Math.min(cap, wanted === undefined ? cap : Math.floor(wanted)));
        const p: PageResult = await ctx.toolbox.page(url, { maxChars, signal: ctx.signal });
        const read: Source[] = [{ url: p.url, title: p.title, via: 'read_page', ...(p.url !== p.requestedUrl ? { requestedUrl: p.requestedUrl } : {}) }];
        const thin = p.chars < 200;
        return {
          answer: { id: call.id, name, response: { ok: true, address: p.url, title: p.title, language: p.language, text: p.text, truncated: p.truncated, ...(thin ? { note: 'Very little text came back; the page may load its content with JavaScript. Try another result.' } : {}) } },
          read,
          seen: [],
        };
      }
      default:
        return failure(name, call, 'bad-request', `There is no tool called "${name}".`);
    }
  } catch (err) {
    if (err instanceof ToolError) {
      if (err.kind === 'cancelled') throw err;
      return failure(name, call, err.kind, err.message);
    }
    return failure(name, call, 'upstream', 'The tool failed unexpectedly.');
  }
}

// ---------- checking cited sources ----------

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`)\]}]+/gi;

/** Web addresses written in a text, without trailing punctuation. */
export function citedUrls(text: string): string[] {
  return [...new Set((text.match(URL_IN_TEXT) ?? []).map((u) => u.replace(/[.,;:!?…]+$/, '')))];
}

function normal(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${u.search}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/** Addresses the text cites that the agent never opened or saw in a result: made up or remembered, not checked. */
export function unverifiedUrls(text: string, sources: { read: Source[]; seen: Source[] }): string[] {
  const known = new Set([...sources.read, ...sources.seen].flatMap((s) => [normal(s.url), ...(s.requestedUrl ? [normal(s.requestedUrl)] : [])]));
  return citedUrls(text).filter((u) => !known.has(normal(u)));
}
