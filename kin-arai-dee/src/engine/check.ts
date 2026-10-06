import type { Check, Data, Menu, MenuRow, RowResult, Verdict } from './types';

const OPTIONAL_ROLES = ['ไม่บังคับ', 'เครื่องเคียง'];

export const isNoneOption = (o: string): boolean => o.startsWith('ไม่ใส่เนื้อสัตว์') || o.startsWith('ไม่มีเนื้อสัตว์');

interface EvalRow extends MenuRow {
  identity: boolean;
  protein: boolean;
  /** Ingredient name to look up in the ingredient table (protein options may map elsewhere). */
  lookup: string;
  statusOverride?: { status: string; reason: string; substitute: string };
}

function findBrands(data: Data, name: string) {
  let list = data.brands.filter((b) => b.category === name);
  if (!list.length) {
    // "ซอสพริก" / "ซอสมะเขือเทศ" live under the dipping-sauce category, matched by variant text.
    list = data.brands.filter((b) => b.category === 'ซอสสำหรับจิ้ม' && b.variant.includes(name));
  }
  const byBrand = new Map<string, { variants: string[]; notes: Set<string>; confirmed: boolean }>();
  for (const b of list) {
    const cur = byBrand.get(b.brand) ?? { variants: [], notes: new Set<string>(), confirmed: true };
    if (b.variant) cur.variants.push(b.variant);
    if (b.note) cur.notes.add(b.note);
    cur.confirmed = cur.confirmed && b.confirmed;
    byBrand.set(b.brand, cur);
  }
  return [...byBrand].map(([brand, v]) => ({ brand, variants: v.variants, notes: [...v.notes], singleSource: !v.confirmed, image: list.find((b) => b.brand === brand && b.image)?.image ?? null }));
}

function isIdentity(data: Data, menu: Menu, row: MenuRow): boolean {
  if (row.role !== 'หลัก') return false;
  // Egg-white is allowed, so any dish that works with egg white only is never "identity".
  if (data.ingredients[row.ingredient]?.substitute.startsWith('ไข่ขาว')) return false;
  if (menu.name.includes(row.ingredient)) return true;
  // Salted yolk (no egg-white swap) is the dish itself in ไข่ครอบ and the like.
  return menu.name.includes('ไข่') && row.ingredient.startsWith('ไข่');
}

function buildRows(data: Data, menu: Menu, option: string | null): EvalRow[] {
  const out: EvalRow[] = [];
  menu.rows.forEach((row, i) => {
    if (i === menu.slot && option !== null) {
      if (isNoneOption(option)) return;
      const mapped = data.proteinMap[option];
      const known = data.ingredients[option];
      out.push({
        ingredient: option,
        role: 'หลัก',
        note: '',
        identity: true,
        protein: true,
        lookup: known ? option : mapped?.mapsTo || option,
        statusOverride: !known && mapped?.status ? { status: mapped.status, reason: mapped.reason, substitute: '' } : undefined,
      });
      return;
    }
    out.push({ ...row, identity: isIdentity(data, menu, row), protein: false, lookup: row.ingredient });
  });
  return out;
}

function evalRow(data: Data, r: EvalRow): RowResult {
  const optional = OPTIONAL_ROLES.includes(r.role) && !r.identity;
  const info = r.statusOverride ?? data.ingredients[r.lookup];
  const base = { ingredient: r.ingredient, protein: r.protein || undefined, image: data.ingredients[r.lookup]?.image ?? data.ingredients[r.ingredient]?.image ?? null };
  if (!info) {
    if (optional) return { ...base, kind: 'omit', use: 'ไม่ใส่' };
    return { ...base, kind: 'unknown', use: 'ไม่มีข้อมูลวัตถุดิบนี้', reason: 'ยังไม่มีข้อมูลวัตถุดิบนี้ในฐานข้อมูล' };
  }
  const reason = info.reason;
  switch (info.status) {
    case 'กินได้':
      return { ...base, kind: 'ok', use: `ใช้${r.ingredient}` };
    case 'จำกัดปริมาณ':
      return { ...base, kind: 'limit', use: `ใช้${r.ingredient}ได้ แต่ไม่ควรทานมาก`, reason };
    case 'ตามยี่ห้อ':
      return { ...base, kind: 'brand', use: 'เลือกยี่ห้อตามรายการ', reason, brands: findBrands(data, r.ingredient) };
    case 'ต้องตรวจส่วนประกอบ':
      if (optional) return { ...base, kind: 'omit', use: 'ไม่ใส่', reason };
      return { ...base, kind: 'unknown', use: 'ตรวจส่วนประกอบก่อนใช้', reason };
    default: {
      if (optional) return { ...base, kind: 'omit', use: 'ไม่ใส่', reason };
      const sub = info.substitute;
      if (!r.identity && sub.startsWith('ไข่ขาว')) return { ...base, kind: 'swap', use: 'เปลี่ยนเป็นไข่ขาว', swapTo: 'ไข่ขาว', reason };
      if (!r.identity && sub.startsWith('เปลี่ยนเป็น')) return { ...base, kind: 'swap', use: sub, swapTo: sub, reason };
      if (!r.identity && sub.startsWith('เนื้อสัตว์สดปรุงเอง')) return { ...base, kind: 'swap', use: 'เปลี่ยนเป็นเนื้อสัตว์สดที่ปรุงเอง', swapTo: 'เนื้อสัตว์สดปรุงเอง', reason };
      if (r.identity || sub.startsWith('ไม่มีของทดแทน')) return { ...base, kind: 'banned', use: 'ห้ามทาน', reason };
      // A mandatory main ingredient that can only be cut: not safe to call it edible.
      return { ...base, kind: 'unknown', use: 'ตัดออกหรือเปลี่ยนวัตถุดิบ', reason };
    }
  }
}

function summarize(rows: RowResult[]): Verdict {
  if (rows.some((r) => r.kind === 'banned')) return 'no';
  if (rows.some((r) => r.kind === 'unknown')) return 'unsure';
  return 'ok';
}

function reasonsOf(rows: RowResult[]): string[] {
  const out: string[] = [];
  for (const r of rows.filter((x) => x.kind === 'banned')) out.push(`${r.ingredient}เป็นวัตถุดิบหลักของเมนูนี้ ${r.reason ?? ''}`.trim());
  for (const r of rows.filter((x) => x.kind === 'unknown')) out.push(`${r.ingredient}: ${r.reason ?? r.use}`);
  return out;
}

function evaluate(data: Data, menu: Menu, option: string | null): { verdict: Verdict; rows: RowResult[] } {
  const rows = buildRows(data, menu, option).map((r) => evalRow(data, r));
  return { verdict: summarize(rows), rows };
}

export function checkMenu(data: Data, menu: Menu, protein: string | null): Check {
  const hasSlot = menu.slot >= 0 && menu.options.length > 0;
  const byProtein = hasSlot ? menu.options.map((option) => ({ option, verdict: evaluate(data, menu, option).verdict })) : [];

  if (!hasSlot || protein !== null) {
    const { verdict, rows } = evaluate(data, menu, hasSlot ? protein : null);
    return { menu: menu.name, protein: hasSlot ? protein : null, verdict, rows, reasons: reasonsOf(rows), byProtein };
  }

  // No protein chosen: the answer is only certain when every option agrees.
  const verdicts = new Set(byProtein.map((b) => b.verdict));
  const verdict: Verdict = verdicts.size === 1 ? byProtein[0].verdict : 'unsure';
  const { rows } = evaluate(data, menu, null);
  const reasons = verdict === 'unsure' && verdicts.size > 1 ? ['ผลขึ้นอยู่กับเนื้อสัตว์ที่เลือก'] : reasonsOf(rows);
  return { menu: menu.name, protein: null, verdict, rows, reasons, byProtein };
}

/** Parse free text like "ข้าวผัดกุ้ง" into a menu plus an optional protein option. */
export function parseInput(data: Data, text: string): { menu: Menu; protein: string | null } | null {
  const q = text.trim();
  if (!q) return null;
  const exact = data.menus.find((m) => m.name === q);
  if (exact) return { menu: exact, protein: null };
  const prefixes = data.menus.filter((m) => q.startsWith(m.name)).sort((a, b) => b.name.length - a.name.length);
  for (const menu of prefixes) {
    const rest = q.slice(menu.name.length).trim();
    const protein = menu.options.find((o) => o === rest) ?? menu.options.find((o) => o.startsWith(rest)) ?? menu.options.find((o) => o.includes(rest));
    if (protein && rest) return { menu, protein };
  }
  return null;
}

export function suggest(data: Data, text: string, limit = 6): string[] {
  const q = text.trim();
  if (!q) return [];
  const names = new Set<string>();
  for (const m of data.menus) {
    if (m.name.includes(q)) names.add(m.name);
    for (const o of m.options) if (!isNoneOption(o) && m.slot >= 0 && (m.name + o).includes(q)) names.add(m.name + o);
  }
  return [...names].sort((a, b) => Number(!a.startsWith(q)) - Number(!b.startsWith(q)) || a.length - b.length).slice(0, limit);
}

/** Other menus that pass the diet, ranked by shared ingredients. */
export function nearby(data: Data, menu: Menu, limit = 3): Menu[] {
  const mine = new Set(menu.rows.map((r) => r.ingredient));
  return data.menus
    .filter((m) => m.name !== menu.name && checkMenu(data, m, null).verdict === 'ok')
    .map((m) => ({ m, score: m.rows.filter((r) => mine.has(r.ingredient)).length / new Set([...mine, ...m.rows.map((r) => r.ingredient)]).size }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.m);
}
