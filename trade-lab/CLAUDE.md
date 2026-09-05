# trade-lab

> อยู่ใต้ธรรมนูญ [`../CLAUDE.md`](../CLAUDE.md) — อ่านไฟล์นั้นก่อน กฎในไฟล์นี้ชนะเมื่อขัดกัน

## โปรเจกต์นี้คืออะไร

ห้องแล็บวิจัยตลาด รันบนเครื่องตัวเอง — ไล่ดูราคาย้อนหลัง หาจุดที่ราคา
**กลับตัว / เด้ง / เริ่มวิ่งจริง** แล้วตอบด้วยตัวเลขว่า **แนวคิดเทคนิคไหนทำกำไรได้จริง
แนวคิดไหนแค่ความเชื่อ**

ไม่ใช่ระบบทำนายราคา และไม่ใช่ EA — เป็นเครื่องมือ**วิจัย** ที่ผลลัพธ์ของมันเอาไปสร้าง
indicator (Pine) หรือ EA (MQL5 ใน [`../smart-ea`](../smart-ea)) อีกที

**ขอบเขต: XAUUSD บน M1 และ M5 เท่านั้น** ผู้ใช้เป็นสายเทรดสั้น (ยืนยัน 2026-09-05)
timeframe อื่นอยู่นอกขอบเขต **ห้ามเพิ่มเองโดยไม่ถาม**

## คำสั่งที่ใช้จริง

ติดตั้งครั้งแรก:

```bash
python -m venv .venv
```

```bash
.\.venv\Scripts\Activate.ps1; pip install -e ".[dev]" -r requirements.txt
```

รันเทสต์ (ต้องผ่านครบก่อน commit ทุกครั้ง):

```bash
.\.venv\Scripts\python.exe -m pytest -q
```

ใช้งาน:

```bash
.\.venv\Scripts\python.exe -m tradelab check
```

```bash
.\.venv\Scripts\python.exe -m tradelab fetch --years 3
```

```bash
.\.venv\Scripts\python.exe -m tradelab sanity
```

```bash
.\.venv\Scripts\python.exe -m tradelab study
```

ทดสอบระบบโดยไม่ต้องมี MT5 (ข้อมูลจำลอง — **ผลลัพธ์ไม่ใช่ข้อเท็จจริงของตลาด**):

```bash
.\.venv\Scripts\python.exe -m tradelab --synthetic --synthetic-bars 60000 study
```

> ไม่มี dev server / ไม่ใช้ Browser pane — เป็น CLI วิเคราะห์ข้อมูล
> (พอร์ต 8000 จองไว้ใน `PROJECTS.md` เผื่ออนาคตทำ dashboard แต่ยังไม่ได้ใช้)

## โครงสร้าง

```
src/tradelab/
├── config.py          ค่าตั้งทั้งหมดอยู่ที่เดียว (ต้นทุน, threshold, split)
├── barriers.py        ⭐ primitive: ราคาชนเป้าไหนก่อน — ใช้ทั้ง event และ outcome
├── events.py          ตรวจจับ 3 ประเภท + counter บอกว่าตัดออกที่จุดไหน
├── outcomes.py        triple-barrier → R-multiple หักต้นทุนแล้ว
├── pipeline.py        ประกอบทุกขั้น + walk-forward + holdout
├── report.py          ออกรายงาน Markdown ภาษาไทย
├── cli.py             `python -m tradelab <command>`
├── data/              MT5 / CSV / synthetic — ทุกทางออกมาเป็น schema เดียว
├── features/          180 feature ใน 18 block (registry-based)
├── analysis/
│   ├── episodes.py    ⭐ effective sample size — อ่าน bugs.md ก่อนแตะ
│   ├── stats.py       expectancy, Wilson CI, Benjamini-Hochberg
│   ├── conditions.py  แปลง feature เป็นเงื่อนไขที่ทดสอบได้
│   ├── screen.py      คัดกรอง 2 มิติ: อัตราเกิด vs ทำกำไร
│   ├── rules.py       ขุดกฎผสมด้วย decision tree (ไม่ brute force)
│   └── discover.py    จัดกลุ่มแบบไม่ชี้นำ หารูปแบบที่ยังไม่มีชื่อ
└── validate/
    ├── splits.py      holdout + walk-forward
    ├── sanity.py      สุ่มเทรดต้องขาดทุนเท่าต้นทุน
    └── lookahead.py   ⭐ พิสูจน์ว่า feature ไม่อ่านอนาคต
```

**จุดที่ต้องอ่านก่อนแก้อะไรก็ตาม**: `analysis/episodes.py` และ [`bugs.md`](bugs.md)
สองไฟล์นี้อธิบายบั๊กที่ทำให้ระบบเคย "หา edge เจอ" บนข้อมูลสุ่ม

**เพิ่ม feature ใหม่**: เขียนฟังก์ชันใน `features/` แล้วใส่ `@register("ชื่อ block")` แค่นั้น
`build()` จะเก็บมาให้เอง และ `lookahead` จะตรวจให้อัตโนมัติ

## กฎเฉพาะของโปรเจกต์นี้

### 1. ห้ามใส่ credential ของ MT5/Exness ลงในโค้ด

login / password / server อ่านจาก environment variable เท่านั้น (`MT5_LOGIN`, `MT5_PASSWORD`,
`MT5_SERVER`, `MT5_TERMINAL_PATH`) — ตาม [ธรรมนูญข้อ 4](../CLAUDE.md)

**โปรเจกต์นี้ต่อ MT5 เพื่อดึงข้อมูลอย่างเดียว ห้ามเขียนโค้ดส่งคำสั่งเทรดที่นี่เด็ดขาด**
ถ้าจะเทรดจริง ไปทำที่ [`../smart-ea`](../smart-ea)

### 2. Holdout ต้องแตะครั้งเดียว — ห้ามแอบดู

ข้อมูล 20% ท้ายสุดเป็น holdout `research()` ไม่โหลดมันเลย จะเข้าถึงได้ต้องเรียก
`splits.holdout_slice_final_check()` ซึ่งตั้งชื่อยาวๆ ตั้งใจให้รู้ตัวว่ากำลังทำอะไรอยู่

**ห้ามดูผล holdout แล้วกลับไปแก้สมมติฐาน** ถ้าทำ มันจะกลายเป็น training data ทันที
และเราจะไม่มีทางรู้อีกเลยว่าผลจริงหรือปลอม — ไม่ผ่านคือบันทึกว่าไม่ผ่าน

### 3. รายงานผลต้องมี expectancy + จำนวน episode + CI เสมอ

ห้ามรายงาน winrate เปล่าๆ (แม่น 60% ที่ RR 0.5 ขาดทุน แต่แม่น 34% ที่ RR 3 กำไร)
ทุกตัวเลขต้องหักต้นทุนแล้ว และ **ต้องบอกจำนวน episode ไม่ใช่จำนวนแท่ง** (ดูกฎข้อ 8)

ใช้คอลัมน์ `survives` เป็นตัวตัดสิน ไม่ใช่ `passes_fdr` เดี่ยวๆ

### 4. ทดสอบยิ่งเยอะ ยิ่งต้องเข้มขึ้น

ทดสอบ 500 เงื่อนไขจะเจอ "ผู้ชนะ" ~25 อันจากความบังเอิญล้วนๆ ทุกครั้งที่เพิ่มจำนวนสมมติฐาน
Benjamini-Hochberg + Bonferroni ทำงานอัตโนมัติอยู่แล้ว แต่เงื่อนไขที่ผ่านต้องอธิบายได้ว่า
**ทำไม**มันควรใช้ได้ — ถ้าอธิบายไม่ได้ ให้ทิ้ง ไม่ว่าตัวเลขจะสวยแค่ไหน

**ห้ามไล่ทดสอบทุกชุดผสมแบบ brute force** (180 เงื่อนไข × 3 ตัว ≈ 950,000 ชุด)
ใช้ `rules.mine_rules()` ที่ขุดจาก decision tree แทน

### 5. ห้าม lookahead — และมีเครื่องพิสูจน์อยู่แล้ว

feature ที่บาร์ `t` ใช้ได้แค่ข้อมูลถึงราคาปิดของบาร์ `t` เท่านั้น
`validate/lookahead.py` พิสูจน์ให้อัตโนมัติ (คำนวณบนข้อมูลเต็ม vs ข้อมูลที่ตัดท้ายทิ้ง
ถ้าค่าเปลี่ยน = อ่านอนาคต) **ห้าม `--skip-lookahead` ตอนรันจริง**

### 6. เจอผลลัพธ์ผิดปกติ ห้ามเดาสาเหตุแล้วแก้เลย

ต้องใส่ counter/log ตรวจจริงว่าไปตายจุดไหน แล้วค่อยแก้ตามข้อมูล
`EventStats.report()` มีไว้เพื่อการนี้ และบั๊กใหญ่ที่สุดในโปรเจกต์นี้ก็เจอด้วยวิธีนี้
(กฎเดียวกับ [`../smart-ea/CLAUDE.md`](../smart-ea/CLAUDE.md))

### 7. Sanity check ก่อนเชื่อผลใดๆ

**การเข้าออเดอร์แบบสุ่มต้องขาดทุนไม่น้อยกว่าต้นทุน spread** ถ้าสุ่มแล้วได้ดีกว่านั้น
แปลว่าโค้ดมีบั๊ก (lookahead หรือลืมหักต้นทุน) ไม่ใช่ว่าเจอ edge

การตรวจเป็น**ด้านเดียว** — ขาดทุนมากกว่าที่ประมาณไว้เป็นเรื่องปกติ (ดู bugs.md)

`pipeline.research()` จะ**หยุด**ไม่วิเคราะห์ต่อถ้า sanity check แบบ blocking ไม่ผ่าน

### 8. ⭐ นับ episode ไม่ใช่แท่ง

`clock.is_friday` กิน 2,016 แท่ง แต่เกิดจริง **7 ครั้ง** ถ้าคิดสถิติจาก 2,016
ช่วงความเชื่อมั่นจะแคบลง ~17 เท่า และ noise ธรรมดาจะกลายเป็น p=0.001

ทุกการคำนวณ p-value / CI ต้องผ่าน `analysis/episodes.py` และเงื่อนไขที่มี episode
น้อยกว่า `min_episodes` (30) ต้องถูกตัดทิ้ง ไม่รายงานเป็น finding

นี่คือบั๊กที่เคยทำให้ระบบ "หา edge เจอ" บนข้อมูลสุ่ม — มี regression test คุมไว้แล้ว
**ห้ามลดหรือปิด `min_episodes` เพื่อให้ผลลัพธ์ดูดีขึ้น**

### 9. baseline ต้องเป็นกลุ่มที่ label นั้นเกิดได้จริง

`reversal`/`bounce` เกิดได้เฉพาะที่จุด swing → baseline ต้องเป็นจุด swing ทั้งหมด
`expansion` เกิดได้ทุกแท่ง → baseline เป็นทุกแท่ง
ใช้ `events.family_universe()` ทุกครั้ง ห้ามใช้ "ทุกแท่ง" เป็นค่า default โดยอัตโนมัติ

### 10. ข้อมูลจำลองมีไว้ทดสอบระบบ ห้ามรายงานเป็นผลตลาด

`--synthetic` สร้าง random walk ที่**ไม่มี edge** โดยเจตนา ถ้าวิเคราะห์แล้วเจอเงื่อนไข
ที่ `survives` แปลว่าโค้ดวิเคราะห์มีบั๊ก ไม่ใช่เจอของ · `load_bars()` จะ**ไม่**ตกไปใช้
ข้อมูลจำลองเองเงียบๆ ต้องสั่ง `allow_synthetic=True` ชัดเจนเท่านั้น

## ข้อควรรู้เรื่องข้อมูล

- **volume ใน forex/XAUUSD ไม่ใช่ volume จริง** — MT5 ให้ tick volume (จำนวนครั้งที่ราคาขยับ)
  ไม่ใช่ปริมาณซื้อขาย ฟีเจอร์ที่อิง volume profile / POC จึงอ่อนกว่าบนหุ้นหรือ futures มาก
  รายงานย้ำข้อจำกัดนี้ท้ายไฟล์ทุกครั้ง — อย่าเอาออก
- **1 จุดของ XAUUSD บน feed Exness = 0.01 ราคา** (ยืนยันกับผู้ใช้แล้ว 2026-09-05)
- **ต้นทุนบน M1 หนักกว่า M5 มาก** — spread 25 จุด + slippage 5 จุด กินระยะ SL ไป
  **0.36R บน M1** แต่ **0.16R บน M5** กลยุทธ์ M1 ต้องเก่งกว่ามากเพื่อผลลัพธ์เท่ากัน
  ตัวเลขนี้แสดงอยู่ใน `cost burden` ของ sanity check ทุกครั้ง
