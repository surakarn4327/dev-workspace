# optimizer — สคริปต์รัน Strategy Tester จากคอมมานด์ไลน์

> **2026-10-02 ปรับให้ตรงกับของที่เหลือ**: ใน `src\` เหลือ EA แค่ `adx-ema-vol-v2` (**AdxEmaVolV2 — ตัวที่ใช้จริง**)
> กับ `adx-ema-vol-re` (AdxEmaVolRe) README ฉบับเดิมอธิบาย MA Ribbon / Range Fade / SATS / AMD Po3 (ลบหมดแล้ว)
> และตัวอักษรไทยในไฟล์เดิมเสียหายเป็นอักษรขยะ จึงเขียนใหม่ — ผลทดสอบ/บทเรียนทั้งหมดอยู่ใน
> [`../CLAUDE.md`](../CLAUDE.md) และ [`../bugs.md`](../bugs.md)

```
optimizer\
├── bin\            ← สคริปต์ (ด้านล่าง)
├── sets\*.set      ← ช่วงค่าที่ไล่หาในแต่ละรอบ (ตอนนี้ว่าง)
└── results\*.csv   ← ผลที่รันแล้ว (ตอนนี้ว่าง)
```

## กฎก่อนรันทุกครั้ง

- **ห้ามรัน optimize/backtest บน terminal ที่ EA จริงเทรดอยู่** ใช้ terminal แยก (ตอนนี้คือ
  `C:\Users\surak\MT5-Optimizer` login บัญชี demo) — optimize เปิด agent เต็มทุก core แย่ง CPU กับ EA จริงได้
- **ปิด MT5 ก่อนสั่งสคริปต์ทุกครั้ง** (สั่งผ่าน `/config:` ตอนมี instance เปิดอยู่จะไม่ทำงาน)
- ปิด `InpShowChartObjects` และ `InpShowDashboard` ใน `.set` ที่ใช้ backtest เสมอ ไม่งั้นช้ามาก
- `Model` และ `ExecutionMode` ต้องส่งผ่านสคริปต์ทุกรอบ (MT5 รีเซ็ตสองค่านี้เป็น default เมื่อเปิดด้วย `/config:`) —
  `run-opt.ps1` ส่งให้แล้ว (default `-Model 1 -ExecutionMode 37`)
- วันที่ ช่วงทดสอบ และเกณฑ์ให้คะแนน ถ้าไม่ส่ง `-From/-To` จะใช้ค่าที่ตั้งไว้ใน GUI ครั้งล่าสุด (Date ต้องเป็น `Custom period`)
- `InpRiskPointUnit`, สกุลเงินบัญชี (USD/USC) และ symbol (`XAUUSDc`) ดูกฎใน `CLAUDE.md` หัวข้อ "บัญชีจริงที่ใช้เทรด"
  — ค่าใน backtest กับบัญชีจริงต่างกัน ห้ามก๊อป `.set` ข้ามโดยไม่เช็ค

## สคริปต์ใน `bin\`

| สคริปต์ | ทำอะไร |
|---|---|
| `run-opt.ps1` | ตัวหลัก: copy `.set` ไป terminal, สร้าง ini (UTF-16 + CRLF ที่ MT5 บังคับ), สั่งรัน, รอจบ แล้วรวมผลทุก pass เป็น `results\<OutName>.csv` |
| `run-oos.ps1` | รันชุดค่าเดี่ยว (ห้ามมี `\|\|` ใน `.set`) บน 3 ปีที่ไม่เคยใช้จูน (มิ.ย. 2565 – มิ.ย. 2568) ทีละปี |
| `run-monthly-reset.ps1` | รันทีละเดือน เงินฝากรีเซ็ตทุกเดือน (จำลองถอนกำไรสิ้นเดือน) แล้วสรุปรายเดือน |
| `run-weekly-reset.ps1` | เหมือนข้างบนแต่รายสัปดาห์ |
| `combine-monthly.ps1` | รวมกำไรรายเดือน (`results\<ชื่อ>_monthly.csv`) ของหลายชุดเป็นพอร์ตเดียว ดูความนิ่ง |

พารามิเตอร์หลักของ `run-opt.ps1`: `-Period` `-SetName` `-OutName` (บังคับ) · `-Expert` · `-DumpDir` · `-Symbol` ·
`-Optimization` (0 รันเดียว / 1 ไล่ครบ / 2 genetic) · `-Model` (0 every tick / 1 1-min OHLC / 4 real ticks) ·
`-From/-To` (`yyyy.MM.dd`) · `-Deposit` · `-OptCrit` (6 = Custom max จาก `OnTester()`)

**ค่า default ในสคริปต์ยังเป็นของ SATS** (`-Expert BestSATS`, `-DumpDir sats_opt`) — ต้องส่ง `-Expert` และ `-DumpDir`
เองทุกครั้ง สำหรับ AdxEmaVolV2 โฟลเดอร์ dump คือ `adxemavolv2_opt`

```powershell
cd <path>\smart-ea\optimizer\bin
.\run-opt.ps1 -Period M1 -SetName <ชื่อ set> -OutName <ชื่อผล> -Expert AdxEmaVolV2EA -DumpDir adxemavolv2_opt
```

`-Expert` คือชื่อไฟล์ `.ex5` ที่ deploy แล้วใน `<terminal>\MQL5\Experts\` (ไม่ใส่นามสกุล)

## compile และ deploy

```powershell
& "C:\Program Files\MetaTrader 5 EXNESS\metaeditor64.exe" /compile:"<path>\smart-ea\src\adx-ema-vol-v2\AdxEmaVolV2EA.mq5" /log:"$env:TEMP\c.log"
```

process คืนค่าก่อนเขียน log เสร็จ — รอ ~5 วินาทีแล้วอ่าน log หา `Result: 0 errors` จากนั้น copy `.mq5` + `.ex5`
ไปที่ `<terminal>\MQL5\Experts\` (`<terminal>` = `%APPDATA%\MetaQuotes\Terminal\<รหัส>\`; ดูอันที่ถูกจาก File → Open Data Folder)

## รูปแบบไฟล์ผล

คั่นด้วย `;` ไม่มีหัวคอลัมน์ แต่ละ pass เขียนจาก `DumpPass()` ใน core ของ EA **ท้ายสุด 17 ช่อง = ตัวชี้วัดมาตรฐาน**
จาก `MetricsCsvTail()` ใน [`../src/shared/TesterMetrics.mqh`](../src/shared/TesterMetrics.mqh) ส่วนหน้านั้นคือพารามิเตอร์ของ EA นั้นๆ:

```
เงินฝากตั้งต้น; ไม้; กำไรสุทธิ; ขาดทุนสูงสุด; PF; กำไรเฉลี่ยต่อไม้;
winrate; เดือนทั้งหมด; เดือนที่กำไร; สัดส่วนเดือนที่กำไร; เดือนแย่สุด; เดือนกลาง;
ไม้ใหญ่สุด/กำไรสุทธิ; ไม้ใหญ่สุด/กำไรฝั่งบวก; ชั่วโมงถือเฉลี่ย; แพ้ติดกันมากสุด; คะแนน
```

(ฉบับก่อนมี `show-results.ps1` ไว้อ่านเป็นตาราง ลบแล้วเพราะผูกกับรูปแบบของ SATS/AMD Po3 — ถ้าต้องการใหม่ให้เขียนตาม
`DumpPass()` ของ EA ที่ใช้อยู่)

## เกณฑ์ให้คะแนน (`Custom max`)

```
คะแนน = (กำไรสุทธิ / ขาดทุนสูงสุด)  [cap ที่ 10]
       x min(winrate / 0.50, 1)
       x (สัดส่วนเดือนที่กำไร)^2
       x min(0.15 / (ไม้ใหญ่สุด/กำไรสุทธิ), 1)
       x min((ไม้ต่อเดือน) / 20, 1)
```

ชุดที่ไม้น้อยกว่า `InpMinTrades` หรือขาดทุนจะได้ 0 เป้าอยู่ที่ `TGT_*` ต้นไฟล์ `TesterMetrics.mqh`

## สิ่งที่รู้แล้ว (ย่อ)

- **every tick กับ 1-min OHLC ใช้ข้อมูลต้นทางเดียวกัน** (แท่ง M1) ต่างที่ every tick ปั้นจุดระหว่างแท่งละเอียดกว่า —
  กับ SL แคบมาก 1-min OHLC ให้ภาพลวงได้ (เคยเจอกับ genetic ของ AdxEma) ชุดที่ชนะต้องตรวจซ้ำด้วย every tick
- **real ticks (`-Model 4`) ย้อนได้แค่ตั้งแต่ ม.ค. 2569** และเทียบผลกับ every tick ไม่ได้ตรงๆ
- **ห้ามเชื่อผลที่ชนะแบบโดดเดี่ยว** ดูค่าข้างเคียงเสมอ (ขยับ 1 ขั้นแล้วตกฮวบ = บังเอิญ)
- **ห้ามสรุปว่าชุดใช้ได้จริง** จนกว่าจะทดสอบบนข้อมูลที่ไม่มีส่วนในการเลือกค่า (`run-oos.ps1`)
- ผลของ AdxEma/AdxEmaVol/AdxEmaVolV2 ทั้งหมด (overfit ปี 2569, ปี 2568 ไม่มี edge ฯลฯ) อยู่ใน `CLAUDE.md`
