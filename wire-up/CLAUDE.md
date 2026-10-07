# wire-up

> อยู่ใต้ธรรมนูญ `C:\dev\CLAUDE.md` — อ่านไฟล์นั้นก่อน กฎในไฟล์นี้ชนะเมื่อขัดกัน

## โปรเจกต์นี้คืออะไร

Wire-Up = lab ทดลองอิเล็กทรอนิกส์เสมือน สำหรับคนไม่มีเครื่องมือ/อุปกรณ์ หรืออยากจำลองก่อนต่อของจริง
หลักการเหมือนของจริงทุกอย่าง: breadboard, อุปกรณ์วัด, ชิ้นส่วนพังจริง, บทเรียนแบบภารกิจ
(แรงบันดาลใจ: Tiny Logic บน itch.io แต่ **ไม่ใช่** เกมไต่ transistor→chip, **ไม่มี** DOOM, **ไม่มี** ตัวละครครู)
คู่แข่งที่ต้องต่าง: Wokwi, Tinkercad Circuits, Falstad — จุดต่างคือ "พังจริง + อธิบายเป็นตัวเลข" และบทเรียนภารกิจ

## Requirement (ตกลงแล้ว 2026-10-07)

1. **ผู้ใช้**: มือใหม่ (บทเรียน = กล่องภารกิจ + เช็กลิสต์ + hint) และคนทำโปรเจกต์ (โหมด lab อิสระ)
2. **แพลตฟอร์ม**: เว็บบนคอม (desktop browser)
3. **โค้ดในเกม**: Arduino = C++, ESP32 = C++ หรือ MicroPython, มีโหมดต่อบล็อกที่แปลงเป็น C++ ให้ดู
4. **ต่อผิด = ชิ้นส่วนพังจริง** (ไหม้/ควัน ต้องเปลี่ยนชิ้นใหม่) + อธิบายสาเหตุเป็นตัวเลข (เช่น "LED รับ 85 mA เกินพิกัด 30 mA")
5. **การต่อ**: ได้ทั้งบน breadboard และลากสายอิสระบนจอ
6. **เครื่องมือวัด**: มัลติมิเตอร์, แหล่งจ่ายไฟปรับได้, Serial Monitor — **ไม่มี** ออสซิลโลสโคป
7. **ESP32 WiFi**: จำลองใน lab (ESP32 เปิดหน้าเว็บเล็กๆ กดปุ่มสั่ง pin ได้) ไม่ออกเน็ตจริง
8. **เซฟ**: auto-save ใน browser (localStorage) + export/import ไฟล์ — ไม่มีบัญชี ไม่มี server
9. **ภาษา UI**: อังกฤษอย่างเดียวก่อน
10. **เป้าหมาย**: ใช้เอง ยังไม่ตัดสินเรื่องเผยแพร่
11. **ภาพ**: pixel นีออนพื้นมืด แต่รูปทรง/ตำแหน่งขา/สีชิ้นส่วนตรงของจริง (แถบสี resistor อ่านค่าได้)
    วาดด้วยโค้ด Canvas ทั้งหมด ไม่ใช้ไฟล์รูป/asset ภายนอก
12. **v1 = วงจรไฟฟ้าก่อน**: แหล่งจ่าย/แบต, resistor, LED, switch, diode, transistor, breadboard,
    มัลติมิเตอร์, ระบบพังจริง **+ sensor แบบอนาล็อก** (LDR, thermistor, potentiometer — ผู้ใช้สั่งเพิ่ม 2026-10-07)
    บอร์ด Arduino/ESP32, Serial Monitor, โหมดบล็อก, WiFi = v2
13. **UI**: toolbox แบบแท็บด้านซ้าย (ลากชิ้นส่วนลงจอ), inspector + missions ด้านขวา

## สถานะ

**v1 เสร็จ (2026-10-07)** — solver, breadboard + สายอิสระ, 15 ชิ้นส่วน, ระบบพังจริง, เซฟ, undo/redo, 9 mission
เทสต์ผ่านทั้งหมด (`npm run test`) และ build ผ่าน ดูรายละเอียดงานถัดไปใน README

## เทคนิค

- Vite + TypeScript `strict: true` + Canvas 2D (ไม่มี dependency runtime เลย; dev: vite, typescript, vitest)
- ตัวคำนวณ SPICE-style: **MNA** + Newton-Raphson (diode/LED/BJT Ebers-Moll, junction limiting `pnjlim`),
  source stepping เป็น fallback, ขีดจำกัดกระแสของ supply (โหมด CC) วนแก้ใน `solve()`
- DC เท่านั้นใน v1 (ไม่มี capacitor/transient) — ความร้อนสะสมของชิ้นส่วนคำนวณแยกต่อเฟรมใน `Simulation.step`
- ไม่มี backend ทุกอย่างฟรีไม่ผูกบัตร (ธรรมนูญข้อ 4)

## คำสั่งที่ใช้จริง

```bash
npm run dev -- --port 5173   # รัน dev (พอร์ต 5173) หรือใช้ Browser pane: preview_start ชื่อ wire-up
npm run build                # tsc (strict) + vite build
npm run test                 # vitest: solver, วงจรบน breadboard, เฉลยทุก mission
```

## โครงสร้าง

```
src/
├── sim/         ← solver MNA (solver.ts), โมเดล/พิกัดชิ้นส่วน (models.ts) — ไม่แตะ DOM
├── board/       ← world (ข้อมูล+validate ไฟล์), connectivity (จุดซ้อนกัน = ต่อกัน → วงจร),
│                  simulation (solve + สะสมความเครียด/ไหม้), hit (ทดสอบการคลิก)
├── parts/       ← นิยามชิ้นส่วนละ 1 PartDef: pins, build (→ element solver), evaluate (→ stress), draw, fields
├── render/      ← renderer (กล้อง/สาย/ควัน), draw.ts (พาเลตนีออน, ตัวอักษร pixel), scene.ts
├── ui/          ← workspace (เมาส์/คีย์บอร์ด/loop), toolbox, inspector, lessonPanel, app (ประกอบทุกอย่าง)
├── lessons/     ← lessons.ts (9 mission data-driven) + lessons.test.ts (เฉลยของทุก mission)
└── save/        ← storage (autosave/export/import), history (undo/redo)
```

## กฎเฉพาะของโปรเจกต์นี้

- **sim แยกจาก UI เด็ดขาด**: `src/sim` ห้าม import อะไรจาก `render`/`ui`/`board`/`parts` เพื่อเทสต์ solver โดยไม่มี browser
- ความถูกต้องของฟิสิกส์มาก่อนความสวย: ค่าที่แสดง (V, A, Ω) ต้องมาจาก solver จริง ไม่ fake
- **หลักการต่อ:** จุดสองจุดที่ตำแหน่งตรงกันบน grid 20 px = ต่อกัน (ขาชิ้นส่วน, ปลายสาย, รูบอร์ด) — ทุกอย่างสแนป grid
  breadboard: รูในคอลัมน์เดียวกัน (5 รู) ต่อกัน, รางไฟยาวตลอดแถว
- ทุกชิ้นส่วนมี **พิกัดสูงสุด** ใน `evaluate()` (คืน `stress.ratio` + ข้อความอธิบายตัวเลขจริง) — เกินเมื่อไรสะสมความร้อน
  แล้วพัง (ratio ≥ 6 พังทันที) ชิ้นที่พังแล้ว build เป็นวงจรเปิด (สวิตช์/ปุ่มจะเชื่อมค้าง) จนกว่าจะ Replace
- เพิ่มชิ้นส่วนใหม่: เขียน `PartDef` → ใส่ใน `ALL_PARTS` (`parts/index.ts`) → ทุกอย่าง (toolbox, inspector, เซฟ) ตามมาเอง
  ชิ้นส่วนที่มีขา "สายอ่อน" (แบต, probe) ใช้ `freeLeads: true`; สถานะชั่วคราวของเมาส์ใช้ชื่อ param `pressed` (ไม่ถูกเซฟ)
- รูปทรง/ขา/สีต้องตรงของจริง (resistor color code, LED ขายาว=แอโนด + ด้านแบน=แคโทด, ขั้ว diode, pinout BC547 = C B E)
- **หน้าตาทั้งหมดอยู่ที่ [`style.md`](style.md)** — อ่านก่อนแตะสี ฟอนต์ ขนาด หรือรูปอุปกรณ์ และแก้ไฟล์นั้นพร้อมโค้ดเสมอ
  สไตล์อุปกรณ์ทุกตัวยึดจาก **resistor** (ตัวอื่นยังไม่ถูกใจ ถือเป็นร่าง ห้ามลอก)
- ห้ามใช้ asset รูป/ฟอนต์ภายนอก (ยกเว้นฟอนต์ Silver ที่ลงเครดิตใน `THIRD-PARTY.md`) — ภาพอุปกรณ์วาดด้วย Canvas/สไปรต์พิกเซลในโค้ด ตัวอักษรบน canvas ใช้ฟอนต์ Silver (`render/draw.ts`)
- ไฟล์เซฟมี `version` เสมอ และ import ต้อง validate (`validateWorldData`) — เปลี่ยนรูปแบบต้องขึ้น version + migration
- `erasableSyntaxOnly` เปิดอยู่: ห้าม parameter property / enum / namespace
- UI/ข้อความในเกม = อังกฤษ; โค้ด/คอมเมนต์ = อังกฤษ; เอกสารภายใน = ไทยได้
- แก้บั๊กจริงต้องจด `bugs.md` (ธรรมนูญข้อ 3) โดยเฉพาะบั๊ก solver ไม่ converge / ค่าเพี้ยน
- Claude ทำ UI/ภาพเองทั้งหมด (ผู้ใช้ไม่ได้ออกแบบ frontend ให้โปรเจกต์นี้)
- **v2 (ยังไม่เริ่ม — ต้องให้ผู้ใช้สั่ง):** บอร์ด Arduino/ESP32 + Serial Monitor, โหมดบล็อก→C++, MicroPython, WiFi จำลอง
