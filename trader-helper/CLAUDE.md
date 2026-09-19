# trader-helper

> อยู่ใต้ธรรมนูญ `C:\dev\CLAUDE.md` — อ่านไฟล์นั้นก่อน กฎในไฟล์นี้ชนะเมื่อขัดกัน

## โปรเจกต์นี้คืออะไร

Web app dashboard สำหรับเทรด: จดบันทึกการเทรด (journal), แสดงการเทรดแบบเรียลไทม์, และแจ้งเตือน
ออกแบบให้เชื่อมกับ [`smart-ea`](../smart-ea/CLAUDE.md) (EA บน MT5) — **ห้าม import ข้ามโฟลเดอร์โปรเจกต์**
ตามธรรมนูญ ถ้าต้องใช้ตรรกะร่วมกันให้อ่านแล้วเขียนซ้ำ หรือคุยกันผ่าน HTTP เท่านั้น

**สถาปัตยกรรม (ตกลงกับผู้ใช้ 2026-09-19)**:
- **Deploy ขึ้น cloud ฟรี ไม่ผูกบัตร** — Vercel (frontend + API routes) + Neon หรือ Supabase (Postgres
  free tier) เพื่อให้เปิดดู dashboard ได้จากทุกที่ผ่านอินเทอร์เน็ต ไม่ต้องพึ่งเครื่องที่รัน MT5 เปิดอยู่ตลอด
- **EA ยิง HTTP ตรงเข้า API ของ dashboard นี้เอง** (`WebRequest` ใน MQL5) ทุกครั้งที่เปิด/ปิดไม้ — ฝั่ง
  `smart-ea` ต้องเพิ่ม module ยิง HTTP เข้ามาที่นี่ (คู่ขนานกับ `TelegramNotify.mqh` ที่มีอยู่แล้ว ไม่ใช่
  แทนที่ Telegram)
- แจ้งเตือนใน dashboard เป็นของเสริมจาก Telegram ที่ EA มีอยู่แล้ว ไม่ใช่ตัวแทน

## คำสั่งที่ใช้จริง

```bash
npm run dev -- -p 3000      # รัน dev (พอร์ต 3000)
npm run build    # build
npm run lint     # test
```

หรือใช้ Browser pane: `preview_start` ชื่อ `trader-helper`

## โครงสร้าง

<!-- อธิบายว่าโค้ดหลักอยู่ไหน แก้ตรงไหนก่อน -->

## กฎเฉพาะของโปรเจกต์นี้

- ห้าม hardcode secret (DB connection string, API key) ในโค้ด — ใช้ `.env.local` (ไม่เข้า git) +
  `.env.example` (ค่าหลอก)
- endpoint ที่รับข้อมูลจาก EA ต้องมี auth แบบง่าย (เช่น shared secret token ใน header) กันคนนอกยิง
  ข้อมูลปลอมเข้ามา — ห้ามเปิด endpoint แบบไม่ตรวจสอบอะไรเลย
- ห้ามใช้บริการที่ต้องผูกบัตรแม้ tier ฟรี (ตามธรรมนูญข้อ 4) — ถ้า Neon/Supabase free tier เปลี่ยนนโยบาย
  ต้องผูกบัตร ให้หยุดแล้วถามผู้ใช้ก่อนเปลี่ยนไปใช้บริการอื่น
