// Pushes src/data/data.json (menus that have a photo) into Supabase.
// Run: node --env-file=.env.local scripts/seed-supabase.mjs
import fs from 'fs';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync('src/data/data.json', 'utf8'));
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

async function call(method, path, body, extra = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, { method, headers: { ...headers, ...extra }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
}

const upsert = (table, rows) => call('POST', table, rows, { Prefer: 'resolution=merge-duplicates' });
const wipe = (table, col) => call('DELETE', `${table}?${col}=not.is.null`);

// Replace everything so removed rows disappear too.
await wipe('menus', 'name');
await wipe('ingredients', 'name');
await wipe('protein_map', 'option');
await wipe('brands', 'id');

await upsert('ingredients', Object.entries(data.ingredients).map(([name, v]) => ({ name, status: v.status, reason: v.reason, substitute: v.substitute, source: v.source })));
await upsert('protein_map', Object.entries(data.proteinMap).map(([option, v]) => ({ option, maps_to: v.mapsTo, status: v.status, reason: v.reason })));
await call('POST', 'brands', data.brands.map((b) => ({ category: b.category, brand: b.brand, variant: b.variant, note: b.note, confirmed: b.confirmed })));
await upsert('menus', data.menus.map((m) => ({ name: m.name, region: m.region, options: m.options, slot: m.slot, rows: m.rows, image: m.image })));

console.log('seeded', data.menus.length, 'menus,', Object.keys(data.ingredients).length, 'ingredients,', data.brands.length, 'brands');
