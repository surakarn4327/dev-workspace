// Fetches front-pack photo metadata for the barcodes verified in docs/research-low-iodine.md (Open Food Facts, CC BY-SA 3.0).
// Output: docs/product-image-urls.json  (barcode -> { name, brand, url, creator, license, page })
import fs from 'fs';

// Only products the manual allows. Iodine-added products must never be listed here (the app only shows usable brands).
const CODES = {
  '8851912050209': 'ง่วนเชียง ซอสหอยนางรม',
  '8857123982063': '101 พลัส ซอสหอยนางรม',
  '8850206252527': 'เด็กสมบูรณ์ ซีอิ๊วขาว ออร์แกนิค',
  '8857123982025': '101 พลัส ซีอิ๊วขาว',
  '8852022032604': 'คิวพี น้ำสลัดงาคั่วญี่ปุ่น',
  '8850206067053': 'เด็กสมบูรณ์ ซีอิ๊วดำ ฉลากเขียว',
  '8850206111022': 'เด็กสมบูรณ์ บ๊วยเจี่ย',
  '8851954103512': 'ภูเขาทอง ซอสพริกเผ็ดน้อย',
  '8851954113061': 'ศรีราชาพานิช ซอสพริก',
  '8851954101020': 'ภูเขาทอง ซอสปรุงรส ฝาเหลือง', // ผู้ใช้ยืนยัน (2026-10-06) ไม่อยู่ในรายการรามาฯ
  '8857118730686': 'Mega Chef น้ำปลาแท้', // ผู้ใช้ยืนยันว่าเป็นรุ่นที่ใช้ได้ (2026-10-06)
  '8850206110025': 'เด็กสมบูรณ์ น้ำจิ้มไก่',
  '8850250004035': 'ทาคูมิอายิ เทอริยากิ',
};
const UA = { 'User-Agent': 'kin-arai-dee-build/0.1 (personal non-commercial project)' };
const out = {};
for (const [code, name] of Object.entries(CODES)) {
  let j;
  for (let attempt = 0; attempt < 5 && !j; attempt++) {
    const text = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=code,brands,image_front_url,images`, { headers: UA }).then((r) => r.text());
    try { j = JSON.parse(text); } catch { console.log('non-JSON answer, waiting 20s'); await new Promise((s) => setTimeout(s, 20000)); }
  }
  const p = j.product;
  const front = Object.entries(p?.images ?? {}).find(([k]) => k.startsWith('front'));
  const imgid = front?.[1]?.imgid;
  const uploader = imgid ? p.images[imgid]?.uploader : undefined;
  out[code] = { name, brand: p?.brands ?? '', url: p?.image_front_url ?? null, creator: uploader ?? '', license: 'CC BY-SA 3.0', page: `https://world.openfoodfacts.org/product/${code}` };
  console.log(p?.image_front_url ? 'ok  ' : 'FAIL', code, name, '|', uploader);
  await new Promise((s) => setTimeout(s, 700));
}
fs.writeFileSync('docs/product-image-urls.json', JSON.stringify(out, null, 1));
