// Turns a web page into the plain text a model can read. The helper does this itself (instead of letting Gemini
// fetch the page) so the size is under our control: a news front page can be a megabyte of markup but only a few
// thousand characters of words. Order of preference for the body: the article's own JSON-LD text, then <article>,
// then <main>, then the whole <body> with navigation and footers removed.

export interface PageText {
  title: string;
  description: string;
  text: string;
  /** Characters in the text before it was cut to `maxChars`. */
  chars: number;
  truncated: boolean;
  /** 'th' when most letters are Thai, else 'en'. */
  language: 'th' | 'en';
}

export interface ExtractOptions {
  maxChars?: number;
}

const MAX_INPUT = 3_000_000;
export const DEFAULT_MAX_CHARS = 6000;

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', sbquo: '‚', bdquo: '„',
  copy: '©', reg: '®', trade: '™', bull: '•', middot: '·', laquo: '«', raquo: '»', euro: '€', pound: '£', yen: '¥',
  cent: '¢', deg: '°', plusmn: '±', times: '×', divide: '÷', frac12: '½', para: '¶', sect: '§', larr: '←', rarr: '→',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '';
      return String.fromCodePoint(code);
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

/**
 * Plain text of a short fragment (a title, a snippet). Block tags and line breaks separate words; inline tags
 * (<b>, <span>, <a> ...) vanish without leaving a space, because Thai has none and <b>ราคา</b>ทอง is one word.
 */
export function stripTags(html: string): string {
  const separated = html.replace(/<\/?(?:br|p|div|li|ul|ol|tr|td|th|table|h[1-6]|section|article|hr)\b[^>]*>/gi, ' ');
  return decodeEntities(separated.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

const metaContent = (html: string, attr: 'name' | 'property', value: string): string => {
  const tag = new RegExp(`<meta\\b[^>]*\\b${attr}\\s*=\\s*["']${value}["'][^>]*>`, 'i').exec(html)?.[0];
  if (!tag) return '';
  const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
  return decodeEntities(content?.[1] ?? content?.[2] ?? '').replace(/\s+/g, ' ').trim();
};

function pageTitle(html: string): string {
  const t = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  return (t ? stripTags(t) : '') || metaContent(html, 'property', 'og:title');
}

/** Finds the first `articleBody` / `headline` strings anywhere in parsed JSON-LD. */
function findLd(node: unknown, key: 'articleBody' | 'headline', depth = 0): string {
  if (depth > 6 || node === null || typeof node !== 'object') return '';
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findLd(item, key, depth + 1);
      if (hit) return hit;
    }
    return '';
  }
  const record = node as Record<string, unknown>;
  if (typeof record[key] === 'string' && record[key]) return record[key] as string;
  for (const value of Object.values(record)) {
    const hit = findLd(value, key, depth + 1);
    if (hit) return hit;
  }
  return '';
}

function jsonLdArticle(html: string): { body: string; headline: string } {
  let body = '';
  let headline = '';
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data: unknown = JSON.parse(m[1].trim());
      const b = findLd(data, 'articleBody');
      if (b.length > body.length) body = b;
      if (!headline) headline = findLd(data, 'headline');
    } catch {
      /* not valid JSON: ignore this block */
    }
  }
  return { body: decodeEntities(body), headline: decodeEntities(headline) };
}

const DROP_ALWAYS = ['script', 'style', 'noscript', 'svg', 'template', 'iframe', 'canvas', 'object', 'embed', 'video', 'audio', 'select', 'button'];
const DROP_CHROME = ['nav', 'footer', 'aside', 'form', 'header', 'menu'];

function dropElements(html: string, names: string[]): string {
  let out = html;
  for (const n of names) out = out.replace(new RegExp(`<${n}\\b[^>]*>[\\s\\S]*?<\\/${n}\\s*>`, 'gi'), ' ');
  return out;
}

/** The largest <article> if it holds real text, else <main>, else <body>, else everything. */
function pickRoot(html: string): { html: string; whole: boolean } {
  let best = '';
  for (const m of html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article\s*>/gi)) if (m[1].length > best.length) best = m[1];
  if (stripTags(best).length >= 400) return { html: best, whole: false };
  const main = /<main\b[^>]*>([\s\S]*?)<\/main\s*>/i.exec(html)?.[1];
  if (main && stripTags(main).length >= 400) return { html: main, whole: false };
  const body = /<body\b[^>]*>([\s\S]*)<\/body\s*>/i.exec(html)?.[1];
  return { html: body ?? html, whole: true };
}

const BLOCK_END = /<\/(p|div|section|article|blockquote|tr|table|ul|ol|dl|dt|dd|figure|figcaption|pre|h[1-6])\s*>/gi;

function htmlToLines(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<hr\s*\/?>/gi, '\n\n')
      .replace(/<\/a>\s*(?=<a\b)/gi, '\n') // links side by side are menu items, not one sentence
      .replace(/<\/t[dh]\s*>/gi, ' | ') // table cells
      .replace(/<li\b[^>]*>/gi, '\n- ')
      .replace(/<\/li\s*>/gi, '')
      .replace(/<h[1-6]\b[^>]*>/gi, '\n\n')
      .replace(BLOCK_END, '\n')
      .replace(/<[^>]*>/g, ''),
  );
}

function tidy(text: string): string {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/[\t  ]+/g, ' ').replace(/(\s*\|)+\s*$/, '').trim())
    .filter((l, i, all) => l !== '' || (all[i - 1] ?? '') !== ''); // collapse blank runs
  const out: string[] = [];
  for (const l of lines) if (l === '' || l !== out[out.length - 1]) out.push(l); // drop immediate repeats
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function cut(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const window = text.slice(0, max);
  const breaks = [window.lastIndexOf('\n\n'), window.lastIndexOf('\n'), window.lastIndexOf('. '), window.lastIndexOf(' ')];
  const at = breaks.find((i) => i >= max * 0.6) ?? max;
  return { text: `${window.slice(0, at).trimEnd()} …`, truncated: true };
}

export function guessLanguage(text: string): 'th' | 'en' {
  const thai = (text.match(/[฀-๿]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  return thai > latin ? 'th' : 'en';
}

export function extractText(input: string, opts: ExtractOptions = {}): PageText {
  const max = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const html = input.length > MAX_INPUT ? input.slice(0, MAX_INPUT) : input;

  const ld = jsonLdArticle(html);
  const title = pageTitle(html) || ld.headline;
  const description = metaContent(html, 'name', 'description') || metaContent(html, 'property', 'og:description');

  const cleaned = dropElements(html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i, ' '), DROP_ALWAYS);
  const root = pickRoot(cleaned);
  const bodyText = tidy(htmlToLines(dropElements(root.html, root.whole ? DROP_CHROME : ['nav', 'footer', 'aside', 'form'])));

  // A JSON-LD article body is the cleanest text a page offers: use it when it is about as long as what we found.
  const ldText = tidy(ld.body.replace(/\r/g, ''));
  const chosen = ldText.length > 300 && ldText.length >= bodyText.length * 0.8 ? ldText : bodyText;

  const { text, truncated } = cut(chosen, max);
  return { title, description, text, chars: chosen.length, truncated, language: guessLanguage(chosen || title) };
}
