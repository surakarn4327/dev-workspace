import bundled from './data.json';
import type { Brand, Data, IngredientInfo, Menu, ProteinMapEntry } from '../engine/types';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

async function table<T>(name: string): Promise<T[]> {
  const res = await fetch(`${url}/rest/v1/${name}?select=*&limit=5000`, { headers: { apikey: key!, Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  return res.json();
}

/** Reads from Supabase when configured; otherwise (or on any failure) uses the data bundled at build time. */
export async function loadData(): Promise<Data> {
  if (!url || !key) return bundled as unknown as Data;
  try {
    const [ing, prot, brands, menus] = await Promise.all([
      table<{ name: string } & IngredientInfo>('ingredients'),
      table<{ option: string; maps_to: string; status: string; reason: string }>('protein_map'),
      table<Brand>('brands'),
      table<Menu>('menus'),
    ]);
    if (!menus.length) return bundled as unknown as Data;
    return {
      ingredients: Object.fromEntries(ing.map((r) => [r.name, { status: r.status, reason: r.reason, substitute: r.substitute, source: r.source }])),
      proteinMap: Object.fromEntries(prot.map((r): [string, ProteinMapEntry] => [r.option, { mapsTo: r.maps_to, status: r.status, reason: r.reason }])),
      brands: brands.map((b) => ({ category: b.category, brand: b.brand, variant: b.variant, note: b.note, confirmed: b.confirmed })),
      menus,
    };
  } catch {
    return bundled as unknown as Data;
  }
}
