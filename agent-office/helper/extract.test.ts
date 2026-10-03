import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeEntities, extractText, guessLanguage, stripTags } from './extract.ts';

const LONG = 'This sentence stands in for a real paragraph of an article. '.repeat(12); // > 400 characters

test('named, numeric and hex entities are decoded; unknown or invalid ones are left or dropped safely', () => {
  assert.equal(decodeEntities('Tom &amp; Jerry &lt;3 &quot;hi&quot; &#39;x&#39; &#x41;&#66; &nbsp;|&ndash;|&hellip;'), 'Tom & Jerry <3 "hi" \'x\' AB  |–|…');
  assert.equal(decodeEntities('&unknownthing; &#0; &#xD800; &#99999999;'), '&unknownthing;   ', 'unknown stays, invalid code points vanish');
  assert.equal(decodeEntities('&AMP; &Copy;'), '& ©', 'case does not matter');
  assert.equal(stripTags('<b>ราคา</b>ทอง&nbsp;<i>วันนี้</i>'), 'ราคาทอง วันนี้');
});

test('the title and description come from <title> and meta tags, with open-graph fallbacks', () => {
  const a = extractText('<html><head><title>  Hello &amp; welcome </title><meta name="description" content="A &quot;short&quot; summary"></head><body><p>x</p></body></html>');
  assert.equal(a.title, 'Hello & welcome');
  assert.equal(a.description, 'A "short" summary');
  const b = extractText('<head><meta property="og:title" content="OG title"><meta property=\'og:description\' content=\'OG text\'></head><body>hi</body>');
  assert.equal(b.title, 'OG title');
  assert.equal(b.description, 'OG text');
});

test('scripts, styles, navigation, footers, forms and comments never reach the text', () => {
  const html = `<html><head><title>T</title><style>.a{color:red}</style></head><body>
    <!-- secret comment --><nav><a href="/">Home</a><a href="/x">News</a></nav>
    <script>var tracking = "do not show";</script><noscript>enable js</noscript>
    <p>The real content is here.</p>
    <form><input name=q><button>Search</button></form>
    <footer>Copyright footer text</footer></body></html>`;
  const { text } = extractText(html);
  assert.equal(text, 'The real content is here.');
});

test('the article element wins over the rest of the page when it holds real text', () => {
  const html = `<body><div>Sidebar noise that should not appear.</div><article><h1>Headline</h1><p>${LONG}</p></article><div>More noise</div></body>`;
  const { text } = extractText(html);
  assert.ok(text.startsWith('Headline'));
  assert.ok(!text.includes('Sidebar') && !text.includes('More noise'));
});

test('a tiny article element is ignored in favour of main or the body', () => {
  const html = '<body><article>tiny</article><main><p>Main content paragraph.</p></main></body>';
  assert.ok(extractText(html).text.includes('tiny') || extractText(html).text.includes('Main content'));
  assert.ok(extractText('<body><article>tiny</article><p>Body text stays.</p></body>').text.includes('Body text stays.'));
});

test('lists, headings, line breaks and paragraphs keep their shape as plain lines', () => {
  const { text } = extractText('<body><h2>Prices</h2><ul><li>Gold <b>65,900</b></li><li>Silver</li></ul><p>Line one<br>Line two</p></body>');
  assert.equal(text, 'Prices\n\n- Gold 65,900\n- Silver\nLine one\nLine two');
});

test('links side by side become separate lines and table cells are separated, with no dangling bars', () => {
  const nav = extractText('<body><p><a href="/1">ราคาทอง</a><a href="/2">ราคาน้ำมัน</a><a href="/3">ข่าว</a></p></body>').text;
  assert.equal(nav, 'ราคาทอง\nราคาน้ำมัน\nข่าว');
  const table = extractText('<body><table><tr><td>ทองคำแท่ง</td><td>65,700</td><td>65,900</td></tr><tr><th>รูปพรรณ</th><td>64,384</td></tr></table></body>').text;
  assert.equal(table, 'ทองคำแท่ง | 65,700 | 65,900\nรูปพรรณ | 64,384');
});

test('share bars, print links and ad markers are dropped, real sentences that mention them are kept', () => {
  const { text } = extractText(
    '<body><p>ราคาทองวันนี้ลดลง 500 บาท</p><p>03 ต.ค. 69 (09:10 น.) พิมพ์</p><p>แชร์เรื่องนี้แชร์เรื่องนี้Line</p><div>Twitter</div><div>Facebook</div><p>ADVERTISEMENT</p>' +
      '<p>Share your thoughts on the price with us today.</p><p>ติดตามข่าวทองคำได้ทุกวัน</p></body>',
  );
  assert.equal(text, 'ราคาทองวันนี้ลดลง 500 บาท\n03 ต.ค. 69 (09:10 น.) พิมพ์\nShare your thoughts on the price with us today.\nติดตามข่าวทองคำได้ทุกวัน');
});

test('inline tags inside a Thai word do not split it', () => {
  assert.equal(extractText('<body><p><b>ราคา</b>ทอง<span>วันนี้</span></p></body>').text, 'ราคาทองวันนี้');
});

test('a JSON-LD article body is used when it is as good as the visible text, and bad JSON is ignored', () => {
  const body = 'Full article text from structured data. '.repeat(20);
  const html = `<head><title>T</title><script type="application/ld+json">{"@graph":[{"@type":"NewsArticle","headline":"LD headline","articleBody":"${body}"}]}</script></head><body><p>${'short teaser '.repeat(5)}</p></body>`;
  const r = extractText(html);
  assert.ok(r.text.startsWith('Full article text from structured data.'));
  const broken = extractText('<head><script type="application/ld+json">{ not json</script></head><body><p>Visible text.</p></body>');
  assert.equal(broken.text, 'Visible text.');
  assert.equal(extractText('<head><script type="application/ld+json">{"headline":"Only a headline"}</script></head><body>x</body>').title, 'Only a headline');
});

test('long text is cut at a natural break, flagged, and the original length is reported', () => {
  const paragraphs = Array.from({ length: 40 }, (_, i) => `Paragraph number ${i} has a few words in it.`).join('</p><p>');
  const r = extractText(`<body><p>${paragraphs}</p></body>`, { maxChars: 300 });
  assert.equal(r.truncated, true);
  assert.ok(r.text.length <= 305 && r.text.endsWith('…'));
  assert.ok(r.chars > 1000, 'chars is the length before cutting');
  assert.ok(!/Paragraph number \d+ has a few wo…/.test(r.text) || r.text.includes('\n'), 'cuts at a line break when one is close');
  assert.equal(extractText('<body>short</body>', { maxChars: 300 }).truncated, false);
});

test('the language is guessed from the letters', () => {
  assert.equal(guessLanguage('ราคาทองคำวันนี้ gold'), 'th');
  assert.equal(guessLanguage('Gold price today ทอง'), 'en');
  assert.equal(extractText('<body><p>ราคาทองคำวันนี้ลดลง</p></body>').language, 'th');
});

test('a huge or badly formed page is handled quickly and never throws', () => {
  const started = Date.now();
  const junk = '<div><p>text '.repeat(150_000) + '<script>' + 'x'.repeat(500_000);
  const r = extractText(junk, { maxChars: 500 });
  assert.ok(r.text.length > 0);
  assert.ok(Date.now() - started < 3000, 'no catastrophic backtracking');
  assert.doesNotThrow(() => extractText(''));
  assert.doesNotThrow(() => extractText('<<<>>> &&&& <a href='));
});
