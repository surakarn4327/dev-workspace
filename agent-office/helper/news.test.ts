import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BATCH_URL,
  batchBody,
  googleNewsId,
  isGoogleNewsLink,
  newsUrl,
  parseArticleToken,
  parseBatchResponse,
  parseNews,
  resolveNewsLink,
} from './news.ts';
import type { PageGetter } from './news.ts';

const item = (title: string, source: string, link: string, date: string): string =>
  `<item><title>${title}</title><link>${link}</link><guid isPermaLink="false">g</guid><pubDate>${date}</pubDate>` +
  `<description>&lt;a href="${link}"&gt;${title}&lt;/a&gt;</description><source url="https://${source}">${source}</source></item>`;

const FEED = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>"ราคาทองคำ" - Google News</title>${[
  item('ราคาทองวันนี้ ร่วง 500 บาท - Sanook', 'Sanook', 'https://news.google.com/rss/articles/CBMiAAA?oc=5', 'Sat, 03 Oct 2026 02:10:00 GMT'),
  item('Gold &amp; silver slide - Reuters', 'Reuters', 'https://news.google.com/rss/articles/CBMiBBB?oc=5', 'Fri, 02 Oct 2026 19:30:00 GMT'),
  item('ราคาทองวันนี้ ร่วง 500 บาท - Sanook', 'Sanook', 'https://news.google.com/rss/articles/CBMiAAA?oc=5', 'Sat, 03 Oct 2026 02:10:00 GMT'),
  item('ไม่มีวันที่', 'Matichon', 'https://news.google.com/rss/articles/CBMiCCC?oc=5', 'not a date'),
].join('')}</channel></rss>`;

test('the feed address carries the query, the Thai or English edition and an optional day filter', () => {
  const th = new URL(newsUrl('ราคาทองคำ', 'th'));
  assert.equal(th.searchParams.get('q'), 'ราคาทองคำ');
  assert.equal(th.searchParams.get('hl'), 'th');
  assert.equal(th.searchParams.get('ceid'), 'TH:th');
  assert.equal(new URL(newsUrl('gold', 'en')).searchParams.get('gl'), 'US');
  assert.equal(new URL(newsUrl('gold', 'en', 2)).searchParams.get('q'), 'gold when:2d');
  assert.equal(new URL(newsUrl('gold', 'en', 99999)).searchParams.get('q'), 'gold when:365d');
  assert.equal(new URL(newsUrl('gold', 'en', 0)).searchParams.get('q'), 'gold');
});

test('items are read with title, publisher, ISO time and link; the publisher suffix and entities are cleaned', () => {
  const items = parseNews(FEED);
  assert.equal(items.length, 3, 'the duplicate title is dropped');
  assert.deepEqual(items[0], {
    title: 'ราคาทองวันนี้ ร่วง 500 บาท',
    source: 'Sanook',
    published: '2026-10-03T02:10:00.000Z',
    link: 'https://news.google.com/rss/articles/CBMiAAA?oc=5',
  });
  assert.equal(items[1].title, 'Gold & silver slide', 'the publisher Google appends after " - " is removed, and entities are decoded');
  assert.equal(items[2].published, '', 'an unreadable date becomes empty, not an error');
});

test('the limit is honoured, and items with no title or link are skipped', () => {
  assert.equal(parseNews(FEED, 1).length, 1);
  assert.deepEqual(parseNews('<rss><channel><item><title></title><link>x</link></item><item><title>t</title></item></channel></rss>'), []);
  assert.deepEqual(parseNews('not xml at all'), []);
});

test('CDATA titles are unwrapped', () => {
  const xml = '<item><title><![CDATA[ข่าว <ด่วน> & อื่นๆ - Matichon]]></title><link>https://x.example/</link><source url="https://m">Matichon</source></item>';
  assert.equal(parseNews(xml)[0].title, 'ข่าว <ด่วน> & อื่นๆ');
});

// ---------- turning a Google News link into the publisher's address ----------

test('only Google News article links are recognised, and their id is extracted', () => {
  assert.equal(isGoogleNewsLink('https://news.google.com/rss/articles/CBMiAAA?oc=5'), true);
  assert.equal(isGoogleNewsLink('https://news.google.com/articles/CBMiAAA'), true);
  assert.equal(isGoogleNewsLink('https://www.sanook.com/money/1/'), false);
  assert.equal(isGoogleNewsLink('https://evil.example/https://news.google.com/rss/articles/x'), false);
  assert.equal(googleNewsId('https://news.google.com/rss/articles/CBMi_a-B9?oc=5'), 'CBMi_a-B9');
  assert.equal(googleNewsId('https://example.com/'), null);
});

test('the signature and timestamp are read from the article page', () => {
  assert.deepEqual(parseArticleToken('<c-wiz><div data-n-a-sg="AZ5abc_DEF" data-n-a-ts="1791019059" data-n-a-id="x"></div></c-wiz>'), {
    signature: 'AZ5abc_DEF',
    timestamp: '1791019059',
  });
  assert.equal(parseArticleToken('<html>nothing here</html>'), null);
  assert.equal(parseArticleToken('<div data-n-a-sg="only-signature"></div>'), null);
});

test('the exchange request has the shape Google expects', () => {
  const form = new URLSearchParams(batchBody('CBMiAAA', { signature: 'SIG', timestamp: '1791019059' }));
  const outer = JSON.parse(form.get('f.req') ?? '[]') as [[[string, string, null, string]]];
  const [rpc, inner, , kind] = outer[0][0];
  assert.equal(rpc, 'Fbv4je');
  assert.equal(kind, 'generic');
  const args = JSON.parse(inner) as unknown[];
  assert.equal(args[0], 'garturlreq');
  assert.equal(args[2], 'CBMiAAA');
  assert.equal(args[3], 1791019059, 'the timestamp is a number');
  assert.equal(args[4], 'SIG');
});

const REPLY = ')]}\'\n\n105\n[["wrb.fr","Fbv4je","[\\"garturlres\\",\\"https://www.sanook.com/money/958635/?a\\\\u003db\\\\u0026c\\\\u003dd\\",1]",null,null,null,"generic"]]\n';

test('the publisher address is read out of the reply, including escaped characters', () => {
  assert.equal(parseBatchResponse(REPLY), 'https://www.sanook.com/money/958635/?a=b&c=d');
  assert.equal(parseBatchResponse(')]}\'\n[["er",null,null]]'), null);
  assert.equal(parseBatchResponse(''), null);
});

function getter(handlers: { page?: string | Error; reply?: string | Error }): { get: PageGetter; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    get: async (url) => {
      calls.push(url);
      const answer = url === BATCH_URL ? handlers.reply : handlers.page;
      if (answer instanceof Error) throw answer;
      return { body: answer ?? '' };
    },
  };
}

test('a Google News link is resolved in two requests; any other link is returned untouched without a request', async () => {
  const ok = getter({ page: '<div data-n-a-sg="SIG" data-n-a-ts="123"></div>', reply: REPLY });
  assert.equal(await resolveNewsLink('https://news.google.com/rss/articles/CBMiAAA?oc=5', ok.get), 'https://www.sanook.com/money/958635/?a=b&c=d');
  assert.deepEqual(ok.calls, ['https://news.google.com/rss/articles/CBMiAAA', BATCH_URL]);

  const none = getter({});
  assert.equal(await resolveNewsLink('https://www.thairath.co.th/news/1', none.get), 'https://www.thairath.co.th/news/1');
  assert.deepEqual(none.calls, []);
});

test('every way the undocumented exchange can fail gives null, never an exception', async () => {
  const link = 'https://news.google.com/rss/articles/CBMiAAA';
  assert.equal(await resolveNewsLink(link, getter({ page: '<html>changed layout</html>' }).get), null, 'no token on the page');
  assert.equal(await resolveNewsLink(link, getter({ page: '<div data-n-a-sg="S" data-n-a-ts="1"></div>', reply: ')]}\'\n[["er"]]' }).get), null, 'no address in the reply');
  assert.equal(await resolveNewsLink(link, getter({ page: new Error('network down') }).get), null);
  assert.equal(await resolveNewsLink(link, getter({ page: '<div data-n-a-sg="S" data-n-a-ts="1"></div>', reply: new Error('boom') }).get), null);
});
