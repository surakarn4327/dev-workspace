// Builds src/data/data.json from the CSV research files in docs/.
// Run: node scripts/build-data.mjs
import fs from 'fs';
import { parseCsv } from './csv.mjs';

const read = (f) => parseCsv(fs.readFileSync(`docs/${f}`, 'utf8'));
const ingredientRows = read('ingredient-iodine.csv');
const menuRows = read('menu-ingredients.csv');
const brandRows = read('rama-seasonings.csv');
const proteinRows = read('protein-map.csv');
const regionRows = read('menu-images.csv');
const imageUrls = fs.existsSync('docs/menu-image-urls.json') ? JSON.parse(fs.readFileSync('docs/menu-image-urls.json', 'utf8')) : {};

const KEYWORDS = ['หมู', 'ไก่', 'เนื้อ', 'วัว', 'ปลา', 'กุ้ง', 'หอย', 'ปู', 'เป็ด', 'ลูกชิ้น', 'กุนเชียง', 'ตับ', 'แหนม', 'เต้าหู้', 'เห็ด', 'เครื่องใน', 'กบ', 'ไข่เค็ม', 'ขา', 'ปีก', 'ซี่โครง', 'หนัง', 'เกี๊ยว', 'ทะเล', 'หมึก'];
// Menus where the keyword heuristic picks the wrong row (null = no protein slot).
const SLOT_OVERRIDE = { แกงไตปลา: null, ไข่ครอบ: 'ไข่แดงเค็ม' };
const isNone = (o) => o.startsWith('ไม่ใส่เนื้อสัตว์') || o.startsWith('ไม่มีเนื้อสัตว์');

const ingredients = Object.fromEntries(ingredientRows.map((r) => [r.ingredient, { status: r.status, reason: r.reason, substitute: r.substitute, source: r.source }]));
const proteinMap = Object.fromEntries(proteinRows.map((r) => [r.option, { mapsTo: r.maps_to, status: r.status, reason: r.reason }]));
const brands = brandRows.filter((r) => r.group === 'restricted').map((r) => ({ category: r.category, brand: r.brand, variant: r.variant }));
const regions = Object.fromEntries(regionRows.map((r) => [r.name, r.region]));

const names = [...new Set(menuRows.map((r) => r.menu))];
const menus = names.map((name) => {
  const rows = menuRows.filter((r) => r.menu === name);
  const options = (rows.find((r) => r.protein_options)?.protein_options ?? '').split(' / ').filter(Boolean);
  const meaty = options.filter((o) => !isNone(o));
  let slot = rows.findIndex((r) => r.note.includes('เปลี่ยนตามเนื้อสัตว์'));
  const shares = (r) => KEYWORDS.some((k) => r.ingredient.includes(k) && meaty.some((o) => o.includes(k)));
  if (slot < 0 && meaty.length) {
    slot = rows.findIndex((r) => r.role === 'หลัก' && shares(r));
    if (slot < 0) slot = rows.findIndex(shares);
  }
  if (name in SLOT_OVERRIDE) slot = rows.findIndex((r) => r.ingredient === SLOT_OVERRIDE[name]);
  const img = imageUrls[name];
  const filePage = img?.page?.match(/commons\.wikimedia\.org\/wiki\/(File:[^?#]+)/)?.[1];
  // Commons File: pages resolve through Special:FilePath without calling the (rate-limited) API.
  const url = img?.url ?? (filePage ? `https://commons.wikimedia.org/wiki/Special:FilePath/${filePage.slice(5)}?width=640` : null);
  return {
    name,
    region: regions[name] ?? '',
    options,
    slot,
    rows: rows.map((r) => ({ ingredient: r.ingredient, role: r.role, note: r.note })),
    image: url ? { url, creator: img.creator, license: img.license, page: img.page } : null,
  };
});

fs.mkdirSync('src/data', { recursive: true });
fs.writeFileSync('src/data/data.json', JSON.stringify({ ingredients, proteinMap, brands, menus }));
const noSlot = menus.filter((m) => m.options.some((o) => !isNone(o)) && m.slot < 0);
console.log('menus', menus.length, '| with image', menus.filter((m) => m.image).length, '| meaty options but no slot:', noSlot.map((m) => m.name).join(', ') || '-');
for (const m of menus.filter((m) => m.slot >= 0)) console.log(m.name.padEnd(18), '->', m.rows[m.slot].ingredient, '|', m.options.join(' / '));
