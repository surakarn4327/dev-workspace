// The fetcher is tested against real HTTP servers on this machine. The test-only `allowLoopback` rule lets it
// reach them; every other private range stays blocked, which the redirect tests rely on.

import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import zlib from 'node:zlib';
import { FetchError, fetchPage } from './fetcher.ts';

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void;

const servers: http.Server[] = [];
async function serve(handler: Handler): Promise<string> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => handler(req, res, Buffer.concat(chunks).toString('utf8')));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
test.after(() => {
  for (const s of servers) s.closeAllConnections?.();
  for (const s of servers) s.close();
});

const rules = { allowLoopback: true };
const get = (url: string, extra: Parameters<typeof fetchPage>[1] = {}) => fetchPage(url, { rules, ...extra });
const html = (res: http.ServerResponse, body: string, type = 'text/html; charset=utf-8', status = 200): void => {
  res.writeHead(status, { 'content-type': type });
  res.end(body);
};
async function failure(promise: Promise<unknown>): Promise<FetchError> {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof FetchError, `expected a FetchError, got ${String(err)}`);
    return err;
  }
  throw new Error('expected the fetch to fail');
}

test('a page is downloaded and decoded, and the request looks like a plain browser (no Origin, Referer or cookies)', async () => {
  let seen: http.IncomingHttpHeaders = {};
  const base = await serve((req, res) => {
    seen = req.headers;
    html(res, '<p>สวัสดี hello</p>');
  });
  const page = await get(`${base}/a`);
  assert.equal(page.status, 200);
  assert.equal(page.body, '<p>สวัสดี hello</p>');
  assert.equal(page.url, `${base}/a`);
  assert.equal(page.truncated, false);
  assert.match(String(seen['user-agent']), /Mozilla/);
  assert.match(String(seen['accept-encoding']), /gzip/);
  for (const h of ['origin', 'referer', 'cookie', 'authorization', 'sec-fetch-mode']) assert.equal(seen[h], undefined, `${h} must not be sent`);
});

test('gzip, deflate and brotli bodies are decompressed', async () => {
  const text = 'ราคาทองคำวันนี้ '.repeat(200);
  for (const [name, pack] of [['gzip', zlib.gzipSync], ['deflate', zlib.deflateSync], ['br', zlib.brotliCompressSync]] as const) {
    const base = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-encoding': name });
      res.end(pack(Buffer.from(text)));
    });
    assert.equal((await get(base)).body, text, name);
  }
});

test('Thai pages in the old TIS-620 / windows-874 encoding are decoded, from the header or the meta tag', async () => {
  // "สวัสดี" in windows-874
  const bytes = Buffer.from([0xca, 0xc7, 0xd1, 0xca, 0xb4, 0xd5]);
  const byHeader = await serve((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=tis-620' });
    res.end(bytes);
  });
  assert.equal((await get(byHeader)).body, 'สวัสดี');
  const byMeta = await serve((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(Buffer.concat([Buffer.from('<meta charset="windows-874">'), bytes]));
  });
  assert.equal((await get(byMeta)).body, '<meta charset="windows-874">สวัสดี');
  const unknown = await serve((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=not-a-charset' });
    res.end('plain ascii');
  });
  assert.equal((await get(unknown)).body, 'plain ascii', 'an unknown charset falls back to UTF-8');
});

test('redirects are followed (relative ones too) and the chain is reported', async () => {
  const base = await serve((req, res) => {
    if (req.url === '/a') { res.writeHead(301, { location: '/b' }); res.end(); }
    else if (req.url === '/b') { res.writeHead(302, { location: `${base}/c` }); res.end(); }
    else html(res, 'arrived');
  });
  const page = await get(`${base}/a`);
  assert.equal(page.body, 'arrived');
  assert.equal(page.url, `${base}/c`);
  assert.deepEqual(page.redirects, [`${base}/b`, `${base}/c`]);
});

test('a redirected POST becomes a GET (302) but stays a POST with its body on 307', async () => {
  const seen: string[] = [];
  const base = await serve((req, res, body) => {
    seen.push(`${req.method} ${req.url} ${body}`);
    if (req.url === '/start302') { res.writeHead(302, { location: '/end' }); res.end(); }
    else if (req.url === '/start307') { res.writeHead(307, { location: '/end' }); res.end(); }
    else html(res, 'ok');
  });
  await get(`${base}/start302`, { method: 'POST', body: 'q=1' });
  await get(`${base}/start307`, { method: 'POST', body: 'q=2' });
  assert.deepEqual(seen, ['POST /start302 q=1', 'GET /end ', 'POST /start307 q=2', 'POST /end q=2']);
});

test('a POST sends its body as a form by default', async () => {
  let type = '';
  let length = '';
  let payload = '';
  const base = await serve((req, res, body) => {
    type = String(req.headers['content-type']);
    length = String(req.headers['content-length']);
    payload = body;
    html(res, 'ok');
  });
  await get(base, { method: 'POST', body: 'q=ราคา' });
  assert.equal(type, 'application/x-www-form-urlencoded');
  assert.equal(payload, 'q=ราคา');
  assert.equal(length, String(Buffer.byteLength('q=ราคา')));
});

test('too many redirects, and a redirect loop, are stopped', async () => {
  const base = await serve((_req, res) => { res.writeHead(302, { location: '/again' }); res.end(); });
  const err = await failure(get(`${base}/start`, { maxRedirects: 3 }));
  assert.equal(err.code, 'too-many-redirects');
});

test('a redirect into a private network, or to a non-web scheme, is refused at the hop', async () => {
  for (const [target, reason] of [
    ['http://169.254.169.254/latest/meta-data/', 'blocked-address'],
    ['http://10.0.0.5/admin', 'blocked-address'],
    ['http://192.168.1.1/', 'blocked-address'],
    ['file:///etc/passwd', 'bad-scheme'],
    ['http://example.com:6379/', 'bad-port'],
    ['http://user:pw@example.com/', 'credentials'],
    ['http://printer.local/', 'blocked-host'],
  ] as const) {
    const base = await serve((_req, res) => { res.writeHead(302, { location: target }); res.end(); });
    const err = await failure(get(base));
    assert.equal(err.code, 'blocked', target);
    assert.equal(err.reason, reason, target);
  }
});

test('without the test-only rule even this machine is refused', async () => {
  const base = await serve((_req, res) => html(res, 'secret'));
  assert.equal((await failure(fetchPage(base))).code, 'blocked');
  assert.equal((await failure(fetchPage('http://localhost/'))).code, 'blocked');
  assert.equal((await failure(fetchPage('not a url'))).code, 'blocked');
  assert.equal((await failure(fetchPage('ftp://example.com/x'))).reason, 'bad-scheme');
});

test('a page larger than the limit is cut and flagged, not refused', async () => {
  const base = await serve((_req, res) => html(res, 'x'.repeat(100_000)));
  const page = await get(base, { maxBytes: 10_000 });
  assert.equal(page.truncated, true);
  assert.equal(page.bytes, 10_000);
  assert.equal(page.body.length, 10_000);
});

test('a small compressed page that expands to a huge one cannot exhaust memory', async () => {
  const bomb = zlib.gzipSync(Buffer.alloc(60_000_000, 0x61)); // ~60 KB on the wire, 60 MB when unpacked
  const base = await serve((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
    res.end(bomb);
  });
  const started = Date.now();
  const page = await get(base, { maxBytes: 1_000_000 });
  assert.equal(page.truncated, true);
  assert.equal(page.bytes, 1_000_000);
  assert.ok(Date.now() - started < 5000);
});

test('a server that never answers is given up on at the deadline', async () => {
  const base = await serve(() => { /* never respond */ });
  const started = Date.now();
  const err = await failure(get(base, { timeoutMs: 250 }));
  assert.equal(err.code, 'timeout');
  assert.ok(Date.now() - started < 3000);
});

test('a server that starts answering and then stalls is also given up on at the deadline', async () => {
  const base = await serve((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.write('<p>first part</p>'); // ... and never ends the response
  });
  const started = Date.now();
  const err = await failure(get(base, { timeoutMs: 300 }));
  assert.equal(err.code, 'timeout');
  assert.ok(Date.now() - started < 3000);
});

test('error statuses, non-text content and unreachable servers each give their own error', async () => {
  const base = await serve((req, res) => {
    if (req.url === '/404') html(res, 'nope', 'text/html', 404);
    else if (req.url === '/500') html(res, 'boom', 'text/html', 500);
    else if (req.url === '/png') html(res, 'x', 'image/png');
    else if (req.url === '/pdf') html(res, 'x', 'application/pdf');
    else if (req.url === '/json') html(res, '{"a":1}', 'application/json');
    else if (req.url === '/rss') html(res, '<rss/>', 'application/rss+xml');
    else if (req.url === '/plain') html(res, 'plain text', 'text/plain');
    else { res.writeHead(200); res.end('no content type'); }
  });
  const e404 = await failure(get(`${base}/404`));
  assert.deepEqual([e404.code, e404.status], ['status', 404]);
  assert.equal((await failure(get(`${base}/500`))).status, 500);
  assert.equal((await failure(get(`${base}/png`))).code, 'bad-type');
  assert.equal((await failure(get(`${base}/pdf`))).code, 'bad-type');
  assert.equal((await get(`${base}/json`)).body, '{"a":1}');
  assert.equal((await get(`${base}/rss`)).body, '<rss/>');
  assert.equal((await get(`${base}/plain`)).body, 'plain text');
  assert.equal((await get(`${base}/none`)).body, 'no content type');

  const closed = await serve(() => undefined);
  const port = new URL(closed).port;
  servers[servers.length - 1].close();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await failure(get(`http://127.0.0.1:${port}/`))).code, 'network');
});
