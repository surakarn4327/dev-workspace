// Downloads a web page for the helper. It is written on node:https (not fetch) on purpose: fetch adds browser
// "sec-fetch-*" headers that search engines read as a bot signal, and node:https lets us pin the address check to
// the moment of connecting (guardedLookup). Redirects are followed by hand so every hop is checked again.

import http from 'node:http';
import https from 'node:https';
import { Transform } from 'node:stream';
import zlib from 'node:zlib';
import { GuardError, checkUrl, guardedLookup } from './guard.ts';
import type { UrlRules } from './guard.ts';

export type FetchErrorCode = 'blocked' | 'timeout' | 'too-many-redirects' | 'bad-type' | 'status' | 'network';

export class FetchError extends Error {
  code: FetchErrorCode;
  status?: number;
  /** For 'blocked': the guard's reason. */
  reason?: string;
  constructor(code: FetchErrorCode, message: string, extra: { status?: number; reason?: string } = {}) {
    super(message);
    this.name = 'FetchError';
    this.code = code;
    this.status = extra.status;
    this.reason = extra.reason;
  }
}

export interface FetchOptions {
  method?: 'GET' | 'POST';
  body?: string;
  headers?: Record<string, string>;
  /** Most decompressed bytes to keep. Longer pages are cut (truncated: true), not refused. */
  maxBytes?: number;
  /** Deadline for the whole download including redirects. */
  timeoutMs?: number;
  maxRedirects?: number;
  rules?: UrlRules;
}

export interface FetchedPage {
  /** The address the content came from, after redirects. */
  url: string;
  status: number;
  contentType: string;
  body: string;
  bytes: number;
  truncated: boolean;
  redirects: string[];
}

const DEFAULT_MAX_BYTES = 2_500_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_REDIRECTS = 5;

/** A plain browser-like identity. No Origin, Referer or cookies: search engines treat those as bot signals. */
const BASE_HEADERS: Record<string, string> = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'th,en;q=0.8',
  'accept-encoding': 'gzip, deflate, br',
};

const TEXT_TYPES = /^(text\/|application\/(xhtml\+xml|xml|rss\+xml|atom\+xml|json|ld\+json))/i;

/** Passes bytes through until `limit`, then drops the rest and remembers that it did. */
class Limiter extends Transform {
  seen = 0;
  cut = false;
  private readonly limit: number;
  constructor(limit: number) {
    super();
    this.limit = limit;
  }
  override _transform(chunk: Buffer, _enc: BufferEncoding, done: () => void): void {
    if (this.seen < this.limit) {
      const keep = chunk.subarray(0, this.limit - this.seen);
      this.seen += keep.length;
      this.push(keep);
      if (keep.length < chunk.length) this.cut = true;
    } else {
      this.cut = true;
    }
    done();
  }
}

function charsetOf(contentType: string, head: Buffer): string {
  const fromHeader = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType)?.[1];
  if (fromHeader) return fromHeader;
  const sniff = head.subarray(0, 2048).toString('latin1');
  return /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(sniff)?.[1] ?? 'utf-8';
}

function decode(buffer: Buffer, contentType: string): string {
  const label = charsetOf(contentType, buffer).toLowerCase();
  try {
    return new TextDecoder(label === 'tis-620' || label === 'iso-8859-11' ? 'windows-874' : label).decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

function decompressor(encoding: string | undefined): Transform | null {
  switch ((encoding ?? '').toLowerCase()) {
    case 'gzip':
    case 'x-gzip':
      return zlib.createGunzip();
    case 'deflate':
      return zlib.createInflate();
    case 'br':
      return zlib.createBrotliDecompress();
    default:
      return null;
  }
}

function once(url: URL, opts: Required<Pick<FetchOptions, 'method' | 'maxBytes'>> & FetchOptions, signal: AbortSignal): Promise<{ status: number; headers: http.IncomingHttpHeaders; buffer: Buffer; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const body = opts.body;
    const headers: Record<string, string> = { ...BASE_HEADERS, ...opts.headers };
    if (body !== undefined) {
      headers['content-type'] ??= 'application/x-www-form-urlencoded';
      headers['content-length'] = String(Buffer.byteLength(body));
    }
    const req = lib.request(
      url,
      { method: opts.method, headers, lookup: guardedLookup(opts.rules ?? {}) as never, signal },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          resolve({ status, headers: res.headers, buffer: Buffer.alloc(0), truncated: false });
          return;
        }
        const unzip = decompressor(res.headers['content-encoding']);
        const limiter = new Limiter(opts.maxBytes);
        const chunks: Buffer[] = [];
        const finish = (): void => resolve({ status, headers: res.headers, buffer: Buffer.concat(chunks), truncated: limiter.cut });
        const fail = (err: Error): void => reject(new FetchError('network', `The page could not be read: ${err.message}`));
        const source = unzip ? res.pipe(unzip) : res;
        unzip?.on('error', fail);
        res.on('error', fail);
        source.pipe(limiter);
        limiter.on('data', (c: Buffer) => chunks.push(c));
        limiter.on('end', finish);
      },
    );
    req.on('error', (err: Error & { code?: string }) => {
      if (signal.aborted) {
        reject(new FetchError('timeout', 'The page took too long to answer.')); // the deadline aborted the request
        return;
      }
      if (err instanceof GuardError) reject(new FetchError('blocked', err.message, { reason: err.code }));
      else reject(new FetchError('network', `The server could not be reached (${err.code ?? err.message}).`));
    });
    if (body !== undefined) req.write(body);
    req.end();
  });
}

export async function fetchPage(rawUrl: string, options: FetchOptions = {}): Promise<FetchedPage> {
  const rules = options.rules ?? {};
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_REDIRECTS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    let method: 'GET' | 'POST' = options.method ?? 'GET';
    let body = options.body;
    let current: URL;
    try {
      current = checkUrl(rawUrl, rules);
    } catch (err) {
      if (err instanceof GuardError) throw new FetchError('blocked', err.message, { reason: err.code });
      throw err;
    }
    const redirects: string[] = [];

    for (let hop = 0; ; hop++) {
      const r = await once(current, { ...options, method, body, maxBytes, rules }, controller.signal).catch((err: unknown) => {
        if (controller.signal.aborted) throw new FetchError('timeout', 'The page took too long to answer.');
        throw err;
      });

      if (r.status >= 300 && r.status < 400 && r.headers.location) {
        if (hop >= maxRedirects) throw new FetchError('too-many-redirects', `The page redirected more than ${maxRedirects} times.`);
        let next: URL;
        try {
          next = checkUrl(new URL(r.headers.location, current).toString(), rules); // every hop is checked again
        } catch (err) {
          if (err instanceof GuardError) throw new FetchError('blocked', err.message, { reason: err.code });
          throw new FetchError('network', 'The page redirected to an invalid address.');
        }
        redirects.push(next.toString());
        if (r.status !== 307 && r.status !== 308) {
          method = 'GET'; // browsers turn a redirected POST into a GET
          body = undefined;
        }
        current = next;
        continue;
      }

      const contentType = String(r.headers['content-type'] ?? '');
      if (r.status < 200 || r.status >= 300) throw new FetchError('status', `The site answered with status ${r.status}.`, { status: r.status });
      if (contentType && !TEXT_TYPES.test(contentType)) throw new FetchError('bad-type', `That address is not a text page (${contentType.split(';')[0]}).`);
      return {
        url: current.toString(),
        status: r.status,
        contentType,
        body: decode(r.buffer, contentType),
        bytes: r.buffer.length,
        truncated: r.truncated,
        redirects,
      };
    }
  } finally {
    clearTimeout(timer);
  }
}
