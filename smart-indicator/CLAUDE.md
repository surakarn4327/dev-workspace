# smart-indicator

> อยู่ใต้ธรรมนูญ `C:\dev\CLAUDE.md` — อ่านไฟล์นั้นก่อน กฎในไฟล์นี้ชนะเมื่อขัดกัน

## โปรเจกต์นี้คืออะไร

TradingView Pine Script indicator ที่หา entry signal ตามเทคนิคเทรดของผู้ใช้เอง (ไม่ใช่ SMC) - plot signal บนกราฟ ไม่ auto-trade รายละเอียดเทคนิคจะได้รับจากผู้ใช้ทีละสเต็ป

## คำสั่งที่ใช้จริง

```bash
# ยังไม่มี      # รัน dev (พอร์ต -)
# ยังไม่มี    # build
# ยังไม่มี     # test
```

หรือใช้ Browser pane: `preview_start` ชื่อ `smart-indicator`

## โครงสร้าง

โค้ดหลักทั้งหมดอยู่ไฟล์เดียว: `src/smart-indicator.pine` (3 feature รวมกัน — CRT, FVG/iFVG, Demand/Supply zone)
ก่อนแก้ตรงไหน **อ่านเอกสารกฎที่เกี่ยวข้องก่อนเสมอ:**

- `indicator_style.md` — กฎหน้าตั้งค่า (input/group/tooltip), ตาราง default ที่ล็อกไว้
- `crt_technique.md` — กฎเทคนิค CRT (sweep/pending/disqualify)
- `fvg_technique.md` — กฎ/นิยาม FVG/iFVG
- `demand_supply_zone.md` — กฎ/นิยาม Demand/Supply zone
- `bugs.md` — บั๊กที่เจอ+แก้จริงมาก่อน (เปิดดูก่อนแก้จุดที่เคยมีปัญหาเสมอ)

## กฎเฉพาะของโปรเจกต์นี้

- **CRT ต้องรันและสร้าง object ก่อน FVG/zone เสมอ** (z-order — ดู `indicator_style.md` หัวข้อ Z-order)
- **ทุกครั้งที่แก้บั๊กจริง ต้องจดลง `bugs.md`** (ชื่อ/สาเหตุ/วิธีแก้ — มาตรฐานเดียวกับ `C:\dev\CLAUDE.md`)
- **ห้าม sed/replace แบบ global** กับ pattern ที่ไม่ unique พอในไฟล์ .pine (เช่น `size=size.small`) — เคยพลาดไปแก้
  จุดที่ไม่เกี่ยวข้องมาแล้ว ต้องเจาะจงบรรทัดหรือ context string เสมอ
- **Pattern "loop อัปเดตของเก่ารันก่อนส่วนสร้างของใหม่"** (พบใน `manageFvgTf`) ต้องเช็คด้วยเสมอว่าเงื่อนไขที่ loop
  เช็คอยู่ (fill/แตะ/ยืด ฯลฯ) ควร apply ทันทีตอนสร้างของใหม่ด้วยรึเปล่า ไม่งั้นจะพลาดตรวจจับ 1 แท่งเสมอสำหรับของที่
  เพิ่งสร้าง (เจอบั๊กแบบนี้มาแล้วหลายรอบ ดู `bugs.md`)
- ยังไม่มี entry signal จริง — CRT/FVG/Demand-Supply เป็น filter/feature แสดงผลแยกกันหมด ไม่ได้ผูกเป็นสัญญาณเข้าเทรดเดียว
