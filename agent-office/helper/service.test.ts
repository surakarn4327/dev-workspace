// The service is tested with a fake download function and a fake clock: no network, no waiting.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FetchError } from './fetcher.ts';
import type { FetchedPage, FetchOptions } from './fetcher.ts';
import { BATCH_URL } from './news.ts';
import { SearchBlockedError } from './search.ts';
import type { SearchEngine, SearchHit } from './search.ts';
import { ServiceError, createWebService } from './service.ts';
import type { ServiceOptions } from './service.ts';

const page = (url: string, body: string, contentType = 'text/html; charset=utf-8'): FetchedPage => ({
  url, status: 200, contentType, body, bytes: body.length, truncated: false, redirects: [],
});

/** An engine whose result is chosen by what its fake server answers: HITS, EMPTY or BLOCK. */
const engine = (name: string): SearchEngine => ({
  name: name as SearchEngine['name'],
  request: (q) => ({ url: `https://${name}.example/search?q=${encodeURIComponent(q)}`, method: 'GET' }),
  parse: (body, limit): SearchHit[] => {
    if (body === 'BLOCK') throw new SearchBlockedError();
    if (body === 'EMPTY') return [];
    return [{ title: `${name} result`, url: `https://${name}.result/`, snippet: body }].slice(0, limit);
  },
});

function rig(overrides: Partial<ServiceOptions> = {}, answers: Record<string, string | Error> = {}) {
  let time = 1_000_000;
  const calls: { url: string; options?: FetchOptions; at: number }[] = [];
  const sleeps: number[] = [];
  const service = createWebService({
    now: () => time,
    sleep: async (ms) => {
      sleeps.push(ms);
      time += ms;
    },
    engines: [engine('one'), engine('two')],
    limits: { hostGapMs: 0 },
    fetchPage: async (url, options) => {
      calls.push({ url, options, at: time });
      const host = new URL(url).hostname.split('.')[0];
      const answer = answers[host] ?? 'HITS';
      if (answer instanceof Error) throw answer;
      return page(url, answer);
    },
    ...overrides,
  });
  return { service, calls, sleeps, answers, advance: (ms: number) => void (time += ms), now: () => time };
}

test('a search returns the first engine\'s results and remembers them: the same question costs no second request', async () => {
  const r = rig();
  const a = await r.service.search('ราคาทอง');
  assert.equal(a.engine, 'one');
  assert.equal(a.cached, false);
  assert.equal(a.hits[0].title, 'one result');
  const b = await r.service.search('  ราคาทอง ');
  assert.equal(b.cached, true, 'spaces do not make it a new question');
  assert.equal(r.calls.length, 1);
  r.advance(11 * 60_000);
  assert.equal((await r.service.search('ราคาทอง')).cached, false, 'the memory expires after ten minutes');
});

test('an engine that blocks us is left alone for a while and the next engine answers', async () => {
  const r = rig({}, { one: 'BLOCK' });
  const a = await r.service.search('gold');
  assert.equal(a.engine, 'two');
  assert.deepEqual(r.service.engineStatus().map((e) => [e.name, e.restingUntil !== null]), [['one', true], ['two', false]]);

  const before = r.calls.length;
  await r.service.search('silver');
  assert.deepEqual(r.calls.slice(before).map((c) => new URL(c.url).hostname), ['two.example'], 'the resting engine is not asked');

  r.advance(5 * 60_000 + 1);
  r.answers.one = 'HITS';
  assert.equal((await r.service.search('platinum')).engine, 'one', 'after the rest it is tried again, and trusted again');
  assert.equal(r.service.engineStatus()[0].restingUntil, null);
});

test('each repeat block rests an engine longer: 5, then 15 minutes', async () => {
  const r = rig({}, { one: 'BLOCK' });
  await r.service.search('a');
  const first = r.service.engineStatus()[0].restingUntil as number;
  assert.equal(first - r.now(), 5 * 60_000);
  r.advance(5 * 60_000 + 1);
  await r.service.search('b');
  const second = r.service.engineStatus()[0].restingUntil as number;
  assert.equal(second - r.now(), 15 * 60_000);
});

test('an empty page counts as no answer: the next engine is tried, and "no results anywhere" is a normal empty answer', async () => {
  const r = rig({}, { one: 'EMPTY' });
  assert.equal((await r.service.search('x')).engine, 'two');
  const none = rig({}, { one: 'EMPTY', two: 'EMPTY' });
  const res = await none.service.search('x');
  assert.deepEqual(res.hits, []);
  assert.equal(none.service.engineStatus().every((e) => e.restingUntil === null), true, 'nobody is punished for having no results');
});

test('when every engine fails the service says "unavailable" and when to try again', async () => {
  const r = rig({}, { one: 'BLOCK', two: new FetchError('status', 'The site answered with status 429.', { status: 429 }) });
  await assert.rejects(r.service.search('x'), (e: unknown) => e instanceof ServiceError && e.code === 'unavailable' && (e.retryAfterMs ?? 0) > 0);
  // and while both are resting the next call fails at once, without any request
  const calls = r.calls.length;
  await assert.rejects(r.service.search('y'), (e: unknown) => e instanceof ServiceError && e.code === 'unavailable');
  assert.equal(r.calls.length, calls);
});

test('a blocked address is the caller\'s problem, not the engine\'s: the engine is not put to rest', async () => {
  const r = rig({}, { one: new FetchError('blocked', 'private', { reason: 'blocked-address' }) });
  await r.service.search('x');
  assert.equal(r.service.engineStatus()[0].restingUntil, null);
});

test('search words are checked and tidied; region and limit are kept inside their bounds', async () => {
  const r = rig();
  await assert.rejects(r.service.search('   '), (e: unknown) => e instanceof ServiceError && e.code === 'bad-request');
  await assert.rejects(r.service.search(undefined as unknown as string), (e: unknown) => e instanceof ServiceError && e.code === 'bad-request');
  const res = await r.service.search('a'.repeat(1000), { region: 'mars', limit: 99 });
  assert.equal(res.hits.length, 1);
  assert.equal(decodeURIComponent(new URL(r.calls[0].url).searchParams.get('q') ?? '').length, 300, 'long questions are cut');
});

test('too many searches in a minute are turned away with a time to come back, and the window slides', async () => {
  const r = rig({ limits: { hostGapMs: 0, search: 3 } });
  for (let i = 0; i < 3; i++) await r.service.search(`q${i}`);
  await assert.rejects(r.service.search('q3'), (e: unknown) => e instanceof ServiceError && e.code === 'rate-limited' && (e.retryAfterMs ?? 0) > 0 && (e.retryAfterMs ?? 0) <= 60_000);
  assert.equal((await r.service.search('q0')).cached, true, 'a remembered answer is free');
  r.advance(60_001);
  assert.equal((await r.service.search('q3')).cached, false);
});

test('two requests to the same site are spaced out; different sites are not held up', async () => {
  const r = rig({ limits: { hostGapMs: 1000 }, engines: [engine('one')] });
  await Promise.all([r.service.search('a'), r.service.search('b')]);
  assert.equal(r.calls.length, 2);
  assert.ok(r.calls[1].at - r.calls[0].at >= 1000, 'one second between them');
  const other = rig({ limits: { hostGapMs: 1000 }, engines: [engine('one'), engine('two')] }, { one: 'EMPTY' });
  await other.service.search('a'); // one then two: different hosts
  assert.ok(other.calls[1].at - other.calls[0].at < 1000);
});

test('no more than the allowed number of downloads run at once', async () => {
  let running = 0;
  let peak = 0;
  const service = createWebService({
    limits: { hostGapMs: 0, concurrent: 2, page: 100 },
    sleep: async () => undefined,
    fetchPage: async (url) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 15));
      running--;
      return page(url, '<p>x</p>');
    },
  });
  await Promise.all(Array.from({ length: 8 }, (_, i) => service.page(`https://site${i}.example/`)));
  assert.equal(peak, 2);
});

// ---------- news ----------

const FEED = '<rss><channel><item><title>ข่าวทอง - Sanook</title><link>https://news.google.com/rss/articles/CBMiAAA</link><pubDate>Sat, 03 Oct 2026 02:10:00 GMT</pubDate><source url="https://s">Sanook</source></item></channel></rss>';

test('news asks Google News for the edition and day range wanted, and remembers the answer for five minutes', async () => {
  const r = rig({}, { news: FEED });
  const a = await r.service.news('ราคาทอง', { lang: 'th', days: 2 });
  assert.equal(a.items[0].source, 'Sanook');
  const url = new URL(r.calls[0].url);
  assert.equal(url.hostname, 'news.google.com');
  assert.equal(url.searchParams.get('q'), 'ราคาทอง when:2d');
  assert.equal((await r.service.news('ราคาทอง', { lang: 'th', days: 2 })).cached, true);
  assert.equal(r.calls.length, 1);
  r.advance(5 * 60_000 + 1);
  assert.equal((await r.service.news('ราคาทอง', { lang: 'th', days: 2 })).cached, false);
  await assert.rejects(r.service.news(''), (e: unknown) => e instanceof ServiceError && e.code === 'bad-request');
});

test('a news failure is reported with a useful code', async () => {
  const r = rig({}, { news: new FetchError('timeout', 'too slow') });
  await assert.rejects(r.service.news('x'), (e: unknown) => e instanceof ServiceError && e.code === 'timeout');
});

// ---------- pages ----------

const ARTICLE = `<html><head><title>ราคาทองวันนี้</title><meta name="description" content="สรุปราคา"></head><body><article><p>${'ทองคำแท่งขายออก 65,900 บาท '.repeat(30)}</p></article></body></html>`;

test('a page comes back as title, description and readable text, and is remembered', async () => {
  const r = rig({}, { site: ARTICLE });
  const a = await r.service.page('https://site.example/a', { maxChars: 500 });
  assert.equal(a.title, 'ราคาทองวันนี้');
  assert.equal(a.description, 'สรุปราคา');
  assert.equal(a.language, 'th');
  assert.equal(a.truncated, true);
  assert.ok(a.text.length <= 505);
  assert.equal(a.requestedUrl, 'https://site.example/a');
  assert.equal((await r.service.page('https://site.example/a', { maxChars: 500 })).cached, true);
  assert.equal(r.calls.length, 1);
  assert.equal((await r.service.page('https://site.example/a', { maxChars: 9000 })).cached, false, 'a different length is a different answer');
});

test('plain text and JSON are returned as they are, trimmed to the length asked for', async () => {
  const service = createWebService({
    sleep: async () => undefined,
    limits: { hostGapMs: 0 },
    fetchPage: async (url) => page(url, url.endsWith('json') ? '  {"price": 65900}  ' : 'x'.repeat(2000), url.endsWith('json') ? 'application/json' : 'text/plain'),
  });
  assert.equal((await service.page('https://a.example/data.json')).text, '{"price": 65900}');
  const long = await service.page('https://a.example/notes.txt', { maxChars: 500 });
  assert.equal(long.text.length, 500);
  assert.equal(long.truncated, true);
});

test('a Google News link is opened through its real address, and says so when it cannot be', async () => {
  const REPLY = ')]}\'\n[["wrb.fr","Fbv4je","[\\"garturlres\\",\\"https://www.sanook.com/money/1/\\",1]",null,null,null,"generic"]]';
  const calls: string[] = [];
  const service = createWebService({
    sleep: async () => undefined,
    limits: { hostGapMs: 0 },
    fetchPage: async (url) => {
      calls.push(url);
      if (url === BATCH_URL) return page(url, REPLY);
      if (url.startsWith('https://news.google.com/rss/articles/')) return page(url, '<div data-n-a-sg="S" data-n-a-ts="1"></div>');
      return page(url, ARTICLE);
    },
  });
  const res = await service.page('https://news.google.com/rss/articles/CBMiAAA?oc=5');
  assert.equal(res.url, 'https://www.sanook.com/money/1/');
  assert.equal(res.requestedUrl, 'https://news.google.com/rss/articles/CBMiAAA?oc=5');
  assert.equal(calls.at(-1), 'https://www.sanook.com/money/1/');

  const broken = createWebService({ sleep: async () => undefined, limits: { hostGapMs: 0 }, fetchPage: async (url) => page(url, '<html>layout changed</html>') });
  await assert.rejects(broken.page('https://news.google.com/rss/articles/CBMiAAA'), (e: unknown) => e instanceof ServiceError && e.code === 'unavailable' && /search for the article title/.test(e.message));
});

test('download failures map to clear codes', async () => {
  const cases: [FetchError, string][] = [
    [new FetchError('status', 'gone', { status: 404 }), 'not-found'],
    [new FetchError('status', 'oops', { status: 500 }), 'upstream'],
    [new FetchError('timeout', 'slow'), 'timeout'],
    [new FetchError('bad-type', 'image'), 'unsupported'],
    [new FetchError('blocked', 'private', { reason: 'blocked-address' }), 'blocked'],
    [new FetchError('network', 'refused'), 'upstream'],
    [new FetchError('too-many-redirects', 'loop'), 'upstream'],
  ];
  for (const [error, code] of cases) {
    const r = rig({}, { site: error });
    await assert.rejects(r.service.page('https://site.example/x'), (e: unknown) => e instanceof ServiceError && e.code === code, `${error.code} -> ${code}`);
  }
  await assert.rejects(rig().service.page(''), (e: unknown) => e instanceof ServiceError && e.code === 'bad-request');
});
