import fs from 'fs';
import { parseCsv } from './csv.mjs';
const ing = parseCsv(fs.readFileSync('docs/ingredient-iodine.csv','utf8'));
const tab = parseCsv(fs.readFileSync('docs/rama-food-table.csv','utf8'));
const norm = (s) => s.replace(/\(.*?\)/g,'').replace(/[\s,]/g,'');
const expect = { low:'กินได้', medium:'จำกัดปริมาณ', high:'ห้าม' };
console.log('=== A. ชื่อตรงกับตารางรามาฯ แต่สถานะของเราไม่ตรงระดับ ===');
for (const r of ing) {
  const n = norm(r.ingredient);
  const hits = tab.filter(t => { const m = norm(t.name); return m && (n===m || (n.length>=3 && m.length>=3 && (n.includes(m) || m.includes(n)))); });
  if (!hits.length) continue;
  const levels = [...new Set(hits.map(h=>h.level))];
  const worst = levels.includes('high')?'high':levels.includes('medium')?'medium':'low';
  const ok = (worst==='low' && r.status==='กินได้') || (worst==='medium' && ['จำกัดปริมาณ','ห้าม'].includes(r.status)) || (worst==='high' && r.status==='ห้าม');
  if (!ok) console.log(`${r.ingredient} [${r.status}] <- รามาฯ: ${hits.map(h=>h.name+'='+h.level+'('+h.mcg_per_100g+')').join(', ')}`);
}
console.log('\n=== B. สถานะกินได้ แต่ไม่มีชื่อตรงในตารางรามาฯ (อนุมานตามหมวด) ===');
const matched = new Set();
for (const r of ing) { const n = norm(r.ingredient); if (tab.some(t => { const m = norm(t.name); return m && (n===m || (n.length>=3 && m.length>=3 && (n.includes(m) || m.includes(n)))); })) matched.add(r.ingredient); }
const un = ing.filter(r => r.status==='กินได้' && !matched.has(r.ingredient));
console.log(un.length, 'รายการ');
console.log(un.map(r => r.ingredient).join(' | '));
