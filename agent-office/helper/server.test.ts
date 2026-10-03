// The server is tested over real HTTP on a free port with a fake service behind it.

import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { CLIENT_HEADER, DEFAULT_ORIGINS } from './config.ts';
import { startHelper } from './server.ts';
import type { RunningHelper } from './server.ts';
import { ServiceError } from './service.ts';
import type { WebService } from './service.ts';

const APP = 'http://localhost:5171';

interface Seen {
  search: [string, { region?: string; limit?: number } | undefined][];
  news: [string, { lang?: string; days?: number; limit?: number } | undefined][];
  page: [string, { maxChars?: number } | undefined][];
}

function fakeService(behaviour: { fail?: Error } = {}): { service: WebService; seen: Seen } {
  const seen: Seen = { search: [], news: [], page: [] };
  const maybeFail = (): void => {
    if (behaviour.fail) throw behaviour.fail;
  };
  const service: WebService = {
    engineStatus: () => [{ name: 'duckduckgo', restingUntil: null }],
    async search(q, o) {
      seen.search.push([q, o]);
      maybeFail();
      return { engine: 'duckduckgo', hits: [{ title: 't', url: 'https://x.example/', snippet: 's' }], cached: false };
    },
    async news(q, o) {
      seen.news.push([q, o]);
      maybeFail();
      return { items: [], cached: false };
    },
    async page(u, o) {
      seen.page.push([u, o]);
      maybeFail();
      return { title: 'T', description: '', text: 'body', chars: 4, truncated: false, language: 'en', url: u, requestedUrl: u, fetchedAt: '2026-10-03T00:00:00.000Z', cached: false };
    },
  };
  return { service, seen };
}

const running: RunningHelper[] = [];
async function boot(behaviour: { fail?: Error } = {}) {
  const { service, seen } = fakeService(behaviour);
  const helper = await startHelper({ service, port: 0 });
  assert.ok(helper);
  running.push(helper);
  return { helper, seen, port: helper.port };
}
test.after(async () => {
  for (const h of running) await h.close();
});

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  json: { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string; retryAfterMs?: number } } | null;
  text: string;
}

function call(port: number, path: string, opts: { method?: string; headers?: Record<string, string> } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: opts.method ?? 'GET', headers: { host: `127.0.0.1:${port}`, ...opts.headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json: Reply['json'] = null;
        try {
          json = JSON.parse(text);
        } catch {
          /* empty body */
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, json, text });
      });
    });
    req.on('error', reject);
    req.end();
  });
}
const asApp = { origin: APP, [CLIENT_HEADER]: '1' };

test('the helper listens on this machine only', async () => {
  const { helper } = await boot();
  assert.equal((helper.server.address() as { address: string }).address, '127.0.0.1');
});

test('health answers without the client header, names the tools and lists the engines', async () => {
  const { port } = await boot();
  const r = await call(port, '/health');
  assert.equal(r.status, 200);
  assert.equal(r.json?.ok, true);
  assert.deepEqual(r.json?.data?.tools, ['search', 'news', 'page']);
  assert.equal(r.json?.data?.protocol, 1);
  assert.equal(r.headers['access-control-allow-origin'], undefined, 'no origin, no CORS header');
});

test('every response is JSON, never cached and never sniffed', async () => {
  const { port } = await boot();
  const r = await call(port, '/search?q=gold', { headers: asApp });
  assert.match(String(r.headers['content-type']), /application\/json/);
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
});

test('the app\'s own pages get CORS permission, other pages are refused and get none', async () => {
  const { port } = await boot();
  for (const origin of DEFAULT_ORIGINS) {
    const ok = await call(port, '/search?q=x', { headers: { origin, [CLIENT_HEADER]: '1' } });
    assert.equal(ok.status, 200, origin);
    assert.equal(ok.headers['access-control-allow-origin'], origin);
    assert.equal(ok.headers.vary, 'Origin');
  }
  for (const origin of ['https://evil.example', 'http://localhost:5555', 'http://localhost', 'null', 'http://localhost:5171.evil.example']) {
    const bad = await call(port, '/search?q=x', { headers: { origin, [CLIENT_HEADER]: '1' } });
    assert.equal(bad.status, 403, origin);
    assert.equal(bad.headers['access-control-allow-origin'], undefined, origin);
  }
});

test('the preflight is approved for the app and refused for everyone else', async () => {
  const { port } = await boot();
  const ok = await call(port, '/search', { method: 'OPTIONS', headers: { origin: APP, 'access-control-request-method': 'GET', 'access-control-request-headers': CLIENT_HEADER, 'access-control-request-private-network': 'true' } });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers['access-control-allow-origin'], APP);
  assert.equal(ok.headers['access-control-allow-headers'], CLIENT_HEADER);
  assert.equal(ok.headers['access-control-allow-methods'], 'GET');
  assert.equal(ok.headers['access-control-allow-private-network'], 'true');
  const bad = await call(port, '/search', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } });
  assert.equal(bad.status, 403);
  assert.equal(bad.headers['access-control-allow-origin'], undefined);
});

test('a request with a hostile Host header (DNS rebinding) is refused', async () => {
  const { port } = await boot();
  for (const host of ['evil.example', `evil.example:${port}`, '127.0.0.1', `127.0.0.1.evil.example:${port}`, `127.0.0.1:${port + 1}`]) {
    const r = await call(port, '/health', { headers: { host } });
    assert.equal(r.status, 403, `host "${host}"`);
  }
  assert.equal((await call(port, '/health', { headers: { host: `localhost:${port}` } })).status, 200);
});

test('the tools need the client header; without it a foreign page that slipped through still gets nothing', async () => {
  const { port, seen } = await boot();
  for (const path of ['/search?q=x', '/news?q=x', '/page?url=https://x.example/']) {
    const r = await call(port, path, { headers: { origin: APP } });
    assert.equal(r.status, 403, path);
    assert.equal(r.json?.error?.code, 'forbidden');
  }
  assert.equal((await call(port, '/search?q=x', { headers: { [CLIENT_HEADER]: ' ' } })).status, 403, 'a blank header does not count');
  assert.deepEqual([seen.search.length, seen.news.length, seen.page.length], [0, 0, 0], 'the service was never reached');
});

test('only GET and OPTIONS are accepted', async () => {
  const { port } = await boot();
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const r = await call(port, '/search?q=x', { method, headers: asApp });
    assert.equal(r.status, 405, method);
    assert.equal(r.headers.allow, 'GET, OPTIONS');
  }
});

test('the three tools pass their parameters to the service as numbers and strings', async () => {
  const { port, seen } = await boot();
  const s = await call(port, `/search?q=${encodeURIComponent('ราคาทอง')}&region=th-th&limit=5`, { headers: asApp });
  assert.equal(s.status, 200);
  assert.equal((s.json?.data?.hits as unknown[]).length, 1);
  assert.deepEqual(seen.search[0], ['ราคาทอง', { region: 'th-th', limit: 5 }]);

  await call(port, '/news?q=gold&lang=en&days=2&limit=3', { headers: asApp });
  assert.deepEqual(seen.news[0], ['gold', { lang: 'en', days: 2, limit: 3 }]);

  const p = await call(port, `/page?url=${encodeURIComponent('https://x.example/a?b=c')}&max=800`, { headers: asApp });
  assert.equal(p.json?.data?.text, 'body');
  assert.deepEqual(seen.page[0], ['https://x.example/a?b=c', { maxChars: 800 }]);

  await call(port, '/search?q=x&limit=abc', { headers: asApp });
  assert.equal(seen.search[1][1]?.limit, undefined, 'a number that is not a number is ignored');
});

test('absurdly long input is refused before reaching the service', async () => {
  const { port, seen } = await boot();
  assert.equal((await call(port, `/search?q=${'a'.repeat(5000)}`, { headers: asApp })).status, 400);
  assert.equal((await call(port, `/page?url=https://x.example/${'a'.repeat(3000)}`, { headers: asApp })).status, 400);
  assert.equal(seen.search.length + seen.page.length, 0);
});

test('every service error code becomes the right HTTP status, with a retry time when there is one', async () => {
  const expected: [ConstructorParameters<typeof ServiceError>[0], number][] = [
    ['bad-request', 400], ['not-found', 404], ['unsupported', 415], ['blocked', 422], ['rate-limited', 429], ['upstream', 502], ['unavailable', 503], ['timeout', 504],
  ];
  for (const [code, status] of expected) {
    const { port } = await boot({ fail: new ServiceError(code, `because ${code}`, code === 'rate-limited' ? 12_400 : undefined) });
    const r = await call(port, '/search?q=x', { headers: asApp });
    assert.equal(r.status, status, code);
    assert.deepEqual([r.json?.ok, r.json?.error?.code, r.json?.error?.message], [false, code, `because ${code}`]);
    if (code === 'rate-limited') {
      assert.equal(r.json?.error?.retryAfterMs, 12_400);
      assert.equal(r.headers['retry-after'], '13');
    }
  }
});

test('an unexpected failure gives a plain 500 that leaks nothing', async () => {
  const { port } = await boot({ fail: new Error('ENOENT: C:\\Users\\someone\\secret.txt') });
  const r = await call(port, '/search?q=x', { headers: asApp });
  assert.equal(r.status, 500);
  assert.equal(r.json?.error?.code, 'internal');
  assert.ok(!r.text.includes('secret') && !r.text.includes('C:\\'));
});

test('unknown paths are a JSON 404, and the log line never contains the search words', async () => {
  const lines: string[] = [];
  const { service } = fakeService();
  const helper = await startHelper({ service, port: 0, log: (l) => lines.push(l) });
  assert.ok(helper);
  running.push(helper);
  assert.equal((await call(helper.port, '/nope', { headers: asApp })).json?.error?.code, 'not-found');
  await call(helper.port, `/search?q=${encodeURIComponent('my private question')}`, { headers: asApp });
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(lines.some((l) => /^GET \/search 200 \d+ms$/.test(l)), lines.join('|'));
  assert.ok(!lines.join('\n').includes('private'));
});

test('origins can be added while the helper runs (the dev server does this once it knows its port)', async () => {
  const { helper, port } = await boot();
  const custom = 'http://localhost:5199';
  assert.equal((await call(port, '/search?q=x', { headers: { origin: custom, [CLIENT_HEADER]: '1' } })).status, 403);
  helper.origins.add(custom);
  assert.equal((await call(port, '/search?q=x', { headers: { origin: custom, [CLIENT_HEADER]: '1' } })).status, 200);
});

test('starting twice on one port: the second gets null instead of crashing', async () => {
  const { port } = await boot();
  const second = await startHelper({ service: fakeService().service, port });
  assert.equal(second, null);
});
