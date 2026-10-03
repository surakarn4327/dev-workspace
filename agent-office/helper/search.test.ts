// Fixtures mirror the structure of the real result pages (checked against live pages on 2026-10-03) but hold
// invented content.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SEARCH_ENGINES, SearchBlockedError, bingUrl, decodeBingUrl, parseBing, parseSearch, realUrl, searchBody } from './search.ts';

const ddgResult = (href: string, title: string, snippet: string, cls = 'result results_links results_links_deep web-result'): string =>
  `<div class="${cls}"><div class="links_main links_deep result__body"><h2 class="result__title"><a rel="nofollow" class="result__a" href="${href}">${title}</a></h2>` +
  `<div class="result__extras"><a class="result__url" href="${href}">example.com</a></div><a class="result__snippet" href="${href}">${snippet}</a></div></div>`;

const uddg = (url: string): string => `//duckduckgo.com/l/?uddg=${encodeURIComponent(url)}&amp;rut=abc123`;

test('DuckDuckGo results: titles, real addresses (unwrapped), snippets, with markup and entities cleaned', () => {
  const html = `<html><body>${[
    ddgResult(uddg('https://www.goldtraders.or.th/'), '<b>ราคาทองคำ</b> วันนี้ &amp; ข่าว', 'ราคา <b>ทอง</b> ตามประกาศ'),
    ddgResult('https://th.investing.com/currencies/xau-usd', 'XAU USD', 'Spot gold'),
  ].join('')}</body></html>`;
  const hits = parseSearch(html);
  assert.deepEqual(hits, [
    { title: 'ราคาทองคำ วันนี้ & ข่าว', url: 'https://www.goldtraders.or.th/', snippet: 'ราคา ทอง ตามประกาศ' },
    { title: 'XAU USD', url: 'https://th.investing.com/currencies/xau-usd', snippet: 'Spot gold' },
  ]);
});

test('ads, internal links, duplicates and non-web schemes are dropped; the limit is honoured', () => {
  const html = [
    ddgResult('//duckduckgo.com/y.js?ad_provider=bingv7aa&u3=https%3A%2F%2Fadvertiser.example', 'An ad', 'buy now', 'result result--ad'),
    ddgResult(uddg('https://a.example/1'), 'First', 's1'),
    ddgResult(uddg('https://a.example/1'), 'First again', 'dup'),
    ddgResult('javascript:alert(1)', 'Bad scheme', 'x'),
    ddgResult(uddg('https://b.example/2'), 'Second', 's2'),
    ddgResult(uddg('https://c.example/3'), 'Third', 's3'),
  ].join('');
  assert.deepEqual(parseSearch(html).map((h) => h.url), ['https://a.example/1', 'https://b.example/2', 'https://c.example/3']);
  assert.equal(parseSearch(html, 2).length, 2);
});

test('a result without a snippet is still a result', () => {
  const html = `<a class="result__a" href="${uddg('https://a.example/')}">Only a title</a>`;
  assert.deepEqual(parseSearch(html), [{ title: 'Only a title', url: 'https://a.example/', snippet: '' }]);
});

test('an anti-bot page raises "blocked"; a normal page with no results is just empty', () => {
  assert.throws(() => parseSearch('<html><body>Unfortunately, bots use DuckDuckGo too. Please complete the following challenge. anomaly-modal</body></html>'), SearchBlockedError);
  assert.deepEqual(parseSearch('<html><body><div class="no-results">No results.</div></body></html>'), []);
});

test('realUrl unwraps, keeps direct links and refuses everything else', () => {
  assert.equal(realUrl(uddg('https://x.example/a?b=c')), 'https://x.example/a?b=c');
  assert.equal(realUrl('https://direct.example/page'), 'https://direct.example/page');
  assert.equal(realUrl('//duckduckgo.com/y.js?x=1'), null);
  assert.equal(realUrl('https://duckduckgo.com/about'), null);
  assert.equal(realUrl('javascript:void(0)'), null);
  assert.equal(realUrl('/relative/path'), null);
  assert.equal(realUrl(`//duckduckgo.com/l/?uddg=${encodeURIComponent('ftp://files.example/x')}`), null);
  assert.equal(realUrl(''), null);
});

test('the form body carries the query and the region', () => {
  const body = new URLSearchParams(searchBody('ราคาทอง & ข่าว', 'th-th'));
  assert.equal(body.get('q'), 'ราคาทอง & ข่าว');
  assert.equal(body.get('kl'), 'th-th');
});

// ---------- Bing ----------

const bing = (url: string): string => `https://www.bing.com/ck/a?!&amp;&amp;p=0123abcd&amp;ptn=3&amp;ver=2&amp;hsh=4&amp;u=a1${Buffer.from(url).toString('base64url')}&amp;ntb=1`;
const bingResult = (url: string, title: string, snippet: string, extra = ''): string =>
  `<li class="b_algo" data-id iid=SERP.5327><link rel="stylesheet" href="https://r.bing.com/x.css" type="text/css"/><div class="b_tpcn"><a class="tilk" href="${bing(url)}"><cite>${url}</cite></a></div>` +
  `<h2 class=""><a target="_blank" href="${bing(url)}" h="ID=SERP,5123.2">${title}</a></h2><div class="b_caption"><p class="b_lineclamp2">${extra}${snippet}</p></div></li>`;

test('Bing results: real addresses decoded from the redirect, titles and snippets cleaned', () => {
  const html = `<ol id="b_results">${[
    bingResult('https://www.goldtraders.or.th/', '<strong>ราคาทอง</strong>วันนี้ &amp; ข่าว …', 'ประกาศ <strong>ราคา</strong> …'),
    bingResult('https://goldthai.com/', 'Gold Price', 'Real time', '<span class="news_dt">9 ชั่วโมงที่ผ่านมา</span>&nbsp;&#0183;&#32;'),
  ].join('')}</ol>`;
  const hits = parseBing(html);
  assert.equal(hits.length, 2);
  assert.deepEqual(hits[0], { title: 'ราคาทองวันนี้ & ข่าว …', url: 'https://www.goldtraders.or.th/', snippet: 'ประกาศ ราคา …' });
  assert.equal(hits[1].url, 'https://goldthai.com/');
  assert.match(hits[1].snippet, /9 ชั่วโมงที่ผ่านมา/);
  assert.equal(parseBing(html, 1).length, 1);
});

test('Bing: undecodable links and duplicates are dropped, and a captcha page raises "blocked"', () => {
  const broken = `<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u=zzzz">No decode</a></h2></li>`;
  const dup = bingResult('https://a.example/', 'A', 's') + bingResult('https://a.example/', 'A again', 's');
  assert.deepEqual(parseBing(broken + dup).map((h) => h.url), ['https://a.example/']);
  assert.throws(() => parseBing('<html><body><div id="b_captcha">Please solve</div></body></html>'), SearchBlockedError);
  assert.deepEqual(parseBing('<html><body><ol id="b_results"></ol></body></html>'), []);
});

test('decodeBingUrl handles the redirect form, direct addresses and rubbish', () => {
  assert.equal(decodeBingUrl(bing('https://xn--42cah7d0cxcvbbb9x.com/path?q=1')), 'https://xn--42cah7d0cxcvbbb9x.com/path?q=1');
  assert.equal(decodeBingUrl('https://example.com/direct'), 'https://example.com/direct');
  assert.equal(decodeBingUrl('https://www.bing.com/ck/a?u=b2Jhc2U'), null, 'missing the a1 prefix');
  assert.equal(decodeBingUrl(`https://www.bing.com/ck/a?u=a1${Buffer.from('javascript:alert(1)').toString('base64url')}`), null);
  assert.equal(decodeBingUrl('not a url'), null);
});

test('the Bing address carries the query and a Thai or English market', () => {
  const th = new URL(bingUrl('ราคาทอง', 'th-th'));
  assert.equal(th.searchParams.get('q'), 'ราคาทอง');
  assert.equal(th.searchParams.get('setlang'), 'th');
  assert.equal(new URL(bingUrl('gold', 'us-en')).searchParams.get('cc'), 'US');
  assert.equal(new URL(bingUrl('gold')).searchParams.get('setlang'), null);
});

test('engines are tried in order: DuckDuckGo first, Bing second, each building its own request', () => {
  assert.deepEqual(SEARCH_ENGINES.map((e) => e.name), ['duckduckgo', 'bing']);
  const [ddg, bg] = SEARCH_ENGINES;
  assert.equal(ddg.request('x', 'th-th').method, 'POST');
  assert.ok(ddg.request('x', 'th-th').body?.includes('q=x'));
  assert.equal(bg.request('x', 'th-th').method, 'GET');
  assert.ok(bg.request('x', 'th-th').url.startsWith('https://www.bing.com/search?q=x'));
});
