// Resolves a direct image URL for every menu with status=ok in docs/menu-images.csv.
// Output: docs/menu-image-urls.json  (name -> { url, creator, license, page })
import fs from 'fs';
import { parseCsv } from './csv.mjs';

const rows = parseCsv(fs.readFileSync('docs/menu-images.csv', 'utf8')).filter((r) => r.status === 'ok');
const outPath = 'docs/menu-image-urls.json';
const out = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : {};
const UA = { 'User-Agent': 'kin-arai-dee-build/0.1 (personal non-commercial project)' };

// Retries with a long pause when Wikimedia answers with its rate-limit page instead of JSON.
async function commonsApi(q) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&prop=imageinfo&iiprop=url&iiurlwidth=640&${q}`, { headers: UA });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      console.log('rate limited, waiting 90s');
      await new Promise((s) => setTimeout(s, 90000));
    }
  }
  throw new Error('Wikimedia API kept rate limiting');
}

async function resolve(r) {
  const page = r.page;
  if (page.includes('commons.wikimedia.org/wiki/File:')) {
    const title = decodeURIComponent(page.split('/wiki/')[1]);
    const j = await commonsApi(`titles=${encodeURIComponent(title)}`);
    return Object.values(j.query.pages)[0].imageinfo?.[0]?.thumburl;
  }
  if (page.includes('commons.wikimedia.org/w/index.php?curid=')) {
    const id = page.split('curid=')[1];
    const j = await commonsApi(`pageids=${id}`);
    return Object.values(j.query.pages)[0].imageinfo?.[0]?.thumburl;
  }
  if (page.includes('flickr.com')) {
    const j = await fetch(`https://www.flickr.com/services/oembed/?url=${encodeURIComponent(page)}&format=json&maxwidth=640`, { headers: UA }).then((x) => x.json());
    return j.url;
  }
  const html = await fetch(page, { headers: UA }).then((x) => x.text());
  const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  return m?.[1];
}

// Commons pages given as ?curid= are looked up in ONE batched API call (the API rate-limits single lookups hard).
const pending = rows.filter((r) => !out[r.name]?.url && r.page.includes('curid='));
for (let i = 0; i < pending.length; i += 40) {
  const chunk = pending.slice(i, i + 40);
  const ids = chunk.map((r) => r.page.split('curid=')[1]).join('|');
  const j = await commonsApi(`pageids=${encodeURIComponent(ids)}`);
  for (const r of chunk) {
    const url = j.query?.pages?.[r.page.split('curid=')[1]]?.imageinfo?.[0]?.thumburl;
    if (url) out[r.name] = { url, creator: r.creator, license: r.license, page: r.page };
    console.log(url ? 'ok  ' : 'FAIL', r.name, 'batch');
  }
}

for (const r of rows) {
  if (out[r.name]?.url) continue;
  try {
    const url = await resolve(r);
    out[r.name] = { url: url ?? null, creator: r.creator, license: r.license, page: r.page };
    console.log(url ? 'ok  ' : 'FAIL', r.name, r.source);
  } catch (e) {
    out[r.name] = { url: null, creator: r.creator, license: r.license, page: r.page };
    console.log('ERR ', r.name, r.source, String(e).slice(0, 80));
  }
  await new Promise((s) => setTimeout(s, 1500));
}
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log('resolved', Object.values(out).filter((v) => v.url).length, '/', rows.length);
