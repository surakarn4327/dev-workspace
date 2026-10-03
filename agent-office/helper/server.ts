// The helper's HTTP face: a tiny JSON API on 127.0.0.1 that the app calls for web search, news and page text.
// It must stay private to the page that owns it, so every request is checked: the Host header (blocks DNS
// rebinding), the Origin (only the app's own pages), and a custom header that a foreign web page cannot send
// without a preflight the helper refuses. The helper never touches the user's API key.

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { CLIENT_HEADER, DEFAULT_ORIGINS, HELPER_NAME, HELPER_PORT, HELPER_PROTOCOL } from './config.ts';
import { ServiceError } from './service.ts';
import type { ServiceErrorCode, WebService } from './service.ts';

export interface HelperServerOptions {
  service: WebService;
  /** Pages allowed to call the helper. Mutable so the dev server can add its real address once it is known. */
  origins?: Set<string>;
  log?: (line: string) => void;
}

const STATUS: Record<ServiceErrorCode, number> = {
  'bad-request': 400,
  'not-found': 404,
  unsupported: 415,
  blocked: 422,
  'rate-limited': 429,
  upstream: 502,
  unavailable: 503,
  timeout: 504,
};

const MAX_QUERY = 300;
const MAX_URL = 2048;

function send(res: http.ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extra,
  });
  res.end(text);
}

const fail = (res: http.ServerResponse, status: number, code: string, message: string, headers: Record<string, string> = {}, retryAfterMs?: number): void =>
  send(res, status, { ok: false, error: { code, message, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) } }, headers);

const int = (value: string | null): number | undefined => {
  if (value === null || value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

export function createHelperServer(opts: HelperServerOptions): http.Server {
  const origins = opts.origins ?? new Set(DEFAULT_ORIGINS);
  const log = opts.log ?? (() => undefined);

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    const finish = (): void => log(`${req.method} ${(req.url ?? '').split('?')[0]} ${res.statusCode} ${Date.now() - started}ms`);
    res.on('finish', finish);

    // 1. Host: only our own address, so a hostile name that points at 127.0.0.1 cannot reach us (DNS rebinding).
    const port = (req.socket.localPort ?? HELPER_PORT).toString();
    const host = String(req.headers.host ?? '').toLowerCase();
    if (![`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host)) {
      fail(res, 403, 'forbidden', 'This address is not allowed.');
      return;
    }

    // 2. Origin: pages other than the app's own are turned away, and get no CORS permission.
    const origin = req.headers.origin;
    const cors: Record<string, string> = {};
    if (origin !== undefined) {
      if (!origins.has(origin)) {
        fail(res, 403, 'forbidden', 'This page is not allowed to use the helper.');
        return;
      }
      cors['access-control-allow-origin'] = origin;
      cors.vary = 'Origin';
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...cors,
        'access-control-allow-methods': 'GET',
        'access-control-allow-headers': CLIENT_HEADER,
        'access-control-max-age': '600',
        ...(req.headers['access-control-request-private-network'] === 'true' ? { 'access-control-allow-private-network': 'true' } : {}),
      });
      res.end();
      return;
    }
    if (req.method !== 'GET') {
      fail(res, 405, 'method-not-allowed', 'Only GET is supported.', { ...cors, allow: 'GET, OPTIONS' });
      return;
    }

    const url = new URL(req.url ?? '/', 'http://helper');
    const q = url.searchParams;
    try {
      if (url.pathname === '/health') {
        send(res, 200, { ok: true, data: { name: HELPER_NAME, protocol: HELPER_PROTOCOL, tools: ['search', 'news', 'page'], engines: opts.service.engineStatus() } }, cors);
        return;
      }

      // 3. The client header: a cross-site page cannot add it without a preflight, which it will not get.
      if (!String(req.headers[CLIENT_HEADER] ?? '').trim()) {
        fail(res, 403, 'forbidden', `The ${CLIENT_HEADER} header is required.`, cors);
        return;
      }

      let data: unknown;
      if (url.pathname === '/search') {
        const query = q.get('q') ?? '';
        if (query.length > MAX_QUERY * 4) throw new ServiceError('bad-request', 'The search is far too long.');
        data = await opts.service.search(query, { region: q.get('region') ?? undefined, limit: int(q.get('limit')) });
      } else if (url.pathname === '/news') {
        const query = q.get('q') ?? '';
        if (query.length > MAX_QUERY * 4) throw new ServiceError('bad-request', 'The search is far too long.');
        data = await opts.service.news(query, { lang: q.get('lang') ?? undefined, days: int(q.get('days')), limit: int(q.get('limit')) });
      } else if (url.pathname === '/page') {
        const target = q.get('url') ?? '';
        if (target.length > MAX_URL) throw new ServiceError('bad-request', 'The address is too long.');
        data = await opts.service.page(target, { maxChars: int(q.get('max')) });
      } else {
        fail(res, 404, 'not-found', 'Unknown path.', cors);
        return;
      }
      send(res, 200, { ok: true, data }, cors);
    } catch (err) {
      if (err instanceof ServiceError) {
        const headers = { ...cors, ...(err.retryAfterMs ? { 'retry-after': String(Math.max(1, Math.ceil(err.retryAfterMs / 1000))) } : {}) };
        fail(res, STATUS[err.code] ?? 500, err.code, err.message, headers, err.retryAfterMs);
      } else {
        fail(res, 500, 'internal', 'The helper hit an unexpected problem.', cors); // no details: they could leak paths
      }
    }
  });

  server.headersTimeout = 10_000;
  server.requestTimeout = 60_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 50;
  return server;
}

export interface RunningHelper {
  server: http.Server;
  port: number;
  origins: Set<string>;
  close(): Promise<void>;
}

/** Starts the helper on 127.0.0.1 only. Resolves to null when the port is already taken (another helper is probably running). */
export function startHelper(options: HelperServerOptions & { port?: number }): Promise<RunningHelper | null> {
  const origins = options.origins ?? new Set(DEFAULT_ORIGINS);
  const server = createHelperServer({ ...options, origins });
  return new Promise((resolve, reject) => {
    server.once('error', (err: NodeJS.ErrnoException) => (err.code === 'EADDRINUSE' ? resolve(null) : reject(err)));
    server.listen(options.port ?? HELPER_PORT, '127.0.0.1', () => {
      resolve({
        server,
        port: (server.address() as AddressInfo).port,
        origins,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
