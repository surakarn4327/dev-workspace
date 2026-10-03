// Fake fetch only: no helper, no network.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHelperMonitor } from './helper-monitor.ts';
import { ToolError, createToolbox } from './toolbox.ts';
import type { HelperHealth } from './toolbox.ts';

const ok = (data: unknown): Response => new Response(JSON.stringify({ ok: true, data }), { status: 200 });
const bad = (status: number, code: string, message = 'because', retryAfterMs?: number): Response =>
  new Response(JSON.stringify({ ok: false, error: { code, message, ...(retryAfterMs ? { retryAfterMs } : {}) } }), { status });

const HEALTH: HelperHealth = { name: 'agent-office-helper', protocol: 1, tools: ['search', 'news', 'page'], engines: [{ name: 'duckduckgo', restingUntil: null }, { name: 'bing', restingUntil: null }] };

function toolbox(handler: (url: URL, init: RequestInit) => Response | Promise<Response>, timeoutMs = {}) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const t = createToolbox({
    baseUrl: 'http://127.0.0.1:8071',
    timeoutMs,
    fetchFn: async (input, init) => {
      const url = new URL(String(input));
      calls.push({ url, init: init ?? {} });
      return handler(url, init ?? {});
    },
  });
  return { t, calls };
}

async function kindOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'resolved';
  } catch (err) {
    assert.ok(err instanceof ToolError, `expected a ToolError, got ${String(err)}`);
    return err.kind;
  }
}

test('each call goes to its path with the client header and only the parameters that were given', async () => {
  const { t, calls } = toolbox((url) => ok(url.pathname === '/search' ? { engine: 'bing', hits: [], cached: false } : { items: [], cached: false }));
  await t.search('ราคาทอง', { region: 'th-th', limit: 5 });
  await t.news('gold', { lang: 'en', days: 2 });
  await t.search('plain');
  assert.equal(calls[0].url.pathname, '/search');
  assert.equal(calls[0].url.searchParams.get('q'), 'ราคาทอง');
  assert.equal(calls[0].url.searchParams.get('region'), 'th-th');
  assert.equal(calls[0].url.searchParams.get('limit'), '5');
  assert.equal(calls[1].url.pathname, '/news');
  assert.equal(calls[1].url.searchParams.get('days'), '2');
  assert.equal(calls[2].url.searchParams.has('region'), false, 'unset options are not sent');
  assert.deepEqual((calls[0].init.headers as Record<string, string>)['x-agent-office'], '1');
});

test('a page request carries the address and the length wanted; the result keeps the real address', async () => {
  const { t, calls } = toolbox(() => ok({ title: 'T', description: '', text: 'x', chars: 1, truncated: false, language: 'th', url: 'https://real.example/a', requestedUrl: 'https://news.google.com/x', fetchedAt: '2026-10-03T00:00:00.000Z', cached: false }));
  const p = await t.page('https://news.google.com/x', { maxChars: 800 });
  assert.equal(calls[0].url.searchParams.get('url'), 'https://news.google.com/x');
  assert.equal(calls[0].url.searchParams.get('max'), '800');
  assert.equal(p.url, 'https://real.example/a');
});

test('health returns the helper\'s description, and an incompatible protocol is "outdated"', async () => {
  assert.deepEqual(await toolbox(() => ok(HEALTH)).t.health(), HEALTH);
  assert.equal(await kindOf(toolbox(() => ok({ ...HEALTH, protocol: 2 })).t.health()), 'outdated');
});

test('every helper error code becomes the right kind, keeping the retry time', async () => {
  const cases: [string, number, string][] = [
    ['bad-request', 400, 'bad-request'], ['forbidden', 403, 'forbidden'], ['not-found', 404, 'not-found'], ['unsupported', 415, 'unsupported'],
    ['blocked', 422, 'blocked'], ['rate-limited', 429, 'rate-limited'], ['upstream', 502, 'upstream'], ['unavailable', 503, 'busy'],
    ['timeout', 504, 'timeout'], ['internal', 500, 'upstream'], ['something-new', 500, 'upstream'],
  ];
  for (const [code, status, kind] of cases) {
    const { t } = toolbox(() => bad(status, code, 'because', 12_000));
    await assert.rejects(t.search('x'), (e: unknown) => e instanceof ToolError && e.kind === kind && e.retryAfterMs === 12_000, `${code} -> ${kind}`);
  }
});

test('a helper that is not running is "missing", and a reply that is not JSON is an upstream problem', async () => {
  const gone = createToolbox({ fetchFn: async () => { throw new TypeError('Failed to fetch'); } });
  assert.equal(await kindOf(gone.search('x')), 'missing');
  assert.equal(await kindOf(gone.health()), 'missing');
  assert.equal(await kindOf(toolbox(() => new Response('<html>oops</html>', { status: 200 })).t.search('x')), 'upstream');
  assert.equal(await kindOf(toolbox(() => new Response('{"hello":1}', { status: 200 })).t.search('x')), 'upstream');
});

const hang: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));

test('a helper that does not answer in time: search times out, but a silent health check means "missing"', async () => {
  const t = createToolbox({ fetchFn: hang, timeoutMs: { search: 30, health: 30 } });
  assert.equal(await kindOf(t.search('x')), 'timeout');
  assert.equal(await kindOf(t.health()), 'missing');
});

test('the caller can cancel a call in flight or before it starts', async () => {
  const t = createToolbox({ fetchFn: hang });
  const ctl = new AbortController();
  const pending = kindOf(t.page('https://x.example/', { signal: ctl.signal }));
  setTimeout(() => ctl.abort(), 10);
  assert.equal(await pending, 'cancelled');
  assert.equal(await kindOf(t.search('x', { signal: ctl.signal })), 'cancelled');
});

// ---------- the monitor ----------

const monitorFor = (health: () => Promise<HelperHealth>) => createHelperMonitor({ health }, () => 1000);

test('the monitor says ready, degraded (every engine resting), missing, blocked or outdated', async () => {
  assert.equal((await monitorFor(async () => HEALTH).check()).state, 'ready');
  const oneResting = { ...HEALTH, engines: [{ name: 'duckduckgo', restingUntil: 5000 }, { name: 'bing', restingUntil: null }] };
  const some = await monitorFor(async () => oneResting).check();
  assert.deepEqual([some.state, some.resting], ['ready', ['duckduckgo']], 'one engine resting is still fine');
  const allResting = { ...HEALTH, engines: HEALTH.engines.map((e) => ({ ...e, restingUntil: 5000 })) };
  assert.equal((await monitorFor(async () => allResting).check()).state, 'degraded');
  assert.equal((await monitorFor(async () => { throw new ToolError('missing', 'x'); }).check()).state, 'missing');
  assert.equal((await monitorFor(async () => { throw new ToolError('forbidden', 'x'); }).check()).state, 'blocked');
  assert.equal((await monitorFor(async () => { throw new ToolError('outdated', 'x'); }).check()).state, 'outdated');
  assert.equal((await monitorFor(async () => { throw new Error('weird'); }).check()).state, 'missing');
});

test('listeners hear only real changes, overlapping checks share one request, and tools are offered only when usable', async () => {
  let asked = 0;
  let healthy = true;
  const m = monitorFor(async () => {
    asked++;
    await new Promise((r) => setTimeout(r, 5));
    if (!healthy) throw new ToolError('missing', 'gone');
    return HEALTH;
  });
  const heard: string[] = [];
  m.onChange((s) => heard.push(s.state));
  assert.equal(m.status.state, 'checking');
  assert.equal(m.canUseTools(), false);
  await Promise.all([m.check(), m.check(), m.check()]);
  assert.equal(asked, 1);
  assert.deepEqual(heard, ['ready']);
  assert.equal(m.canUseTools(), true);
  await m.check();
  assert.deepEqual(heard, ['ready'], 'same state again is not news');
  healthy = false;
  await m.check();
  m.report('missing');
  assert.deepEqual(heard, ['ready', 'missing']);
  assert.equal(m.canUseTools(), false);
  m.report('ready');
  assert.equal(m.canUseTools(), true);
});
