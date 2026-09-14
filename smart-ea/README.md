# smart-ea

EA (Expert Advisor) เทรด XAUUSD อัตโนมัติบน MetaTrader 5 ของ Exness

## มีอะไรอยู่ในนี้

รีเซ็ตโปรเจกต์ 2026-09-14 — เหลือ 2 กลยุทธ์ แต่ละตัวมี core ของตัวเองใน `src\` และไฟล์ EA
ที่มีแต่บล็อก `input` (MA Ribbon/SMC/SmartIndicator ที่เคยมีถูกลบทิ้งไปแล้ว รายละเอียดใน `CLAUDE.md`)

| กลยุทธ์ | แนวคิด | สถานะ |
|---|---|---|
| `AmdPo3EA` + `BestM5_AmdPo3` | ICT liquidity-sweep-reversal (สะสม→กวาดสภาพคล่อง→กระจาย) | `BestM5_AmdPo3` = **ตัวที่ใช้จริง** ผ่านเกณฑ์ถอนกำไร 4/5 ข้อ |
| `SelfAwareTrendEA` + `BestM5_SelfAwareTrend` | เทรนด์ + trend-quality index ปรับแบนด์ตาม regime | `BestM5_SelfAwareTrend` = **ตัวที่ใช้จริง** ผ่านเกณฑ์ถอนกำไร 4/5 ข้อ (in-sample รอบล่าสุด) |

`AmdPo3EA.mq5`/`SelfAwareTrendEA.mq5` เป็นฐาน (ใช้จูนหาค่าใหม่ผ่าน ea-tuner + `.set`), `BestM5_*.mq5`
คือค่าที่ hardcode ไว้ใช้จริงตอนนี้ — ทั้งคู่ต้องแก้พร้อมกันเวลาเปลี่ยนกฎ (input ภาษาไทย, day-trade
cutoff, TP mode ฯลฯ) รายละเอียดที่มาของการตัดสินใจอยู่ใน `CLAUDE.md`

ตัววัดผลและสูตรให้คะแนนตอน optimize อยู่ที่ `src\TesterMetrics.mqh` ใช้ร่วมกันทั้งสองกลยุทธ์
(คะแนน = recovery factor cap ที่ 10 คูณตัวประกอบความสม่ำเสมอ 4 ตัว)

## วิธีรัน

MQL ไม่มี dev server — compile แล้วแนบ EA เข้ากับ chart หรือรันใน Strategy Tester

```powershell
& "C:\Program Files\MetaTrader 5 EXNESS\metaeditor64.exe" /compile:"C:\dev\smart-ea\src\BestM5_SelfAwareTrend.mq5" /log:"$env:TEMP\c.log"
```

process คืนค่าก่อนเขียน log เสร็จ รอสัก 5 วินาทีแล้วอ่าน log หาบรรทัด `Result: 0 errors`
แล้ว copy ทั้ง `.mq5` และ `.ex5` ไปที่ `MQL5\Experts\` ของ terminal

ไล่หาค่าตั้งต้นจากคอมมานด์ไลน์ — **อ่าน [`optimizer\README.md`](optimizer/README.md) ก่อนทุกครั้ง**
มีข้อจำกัดของ MT5 หลายข้อที่ไม่ทำตามจะพังเงียบๆ

```powershell
cd C:\dev\smart-ea\optimizer\bin
.\run-opt.ps1 -Period M5 -SetName sats_stage1_M5 -OutName sats_stage1_tune -From 2025.01.01 -To 2026.01.01
.\show-results.ps1 -OutName sats_stage1_tune -Top 15
```

## บัญชีจริงที่ใช้เทรด

บัญชีจริงเป็น **Cent Account** (สกุลเงิน USC, 1 USD จริง = 100 USC) เทรดสัญลักษณ์ `XAUUSDc`
(Contract size = 1 XAU) **ไม่ใช่ `XAUUSDm`** ที่ backtest ทั้งหมดใช้จูน — รายละเอียดครบใน `CLAUDE.md`
หัวข้อ "บัญชีจริงที่ใช้เทรด" ก่อนรันจริงทุกครั้งต้องเช็ค `InpRiskPointUnit` ให้ตรงกับ symbol จริงเสมอ

## อ่านก่อนเชื่อตัวเลขใดๆ

ทุกชุดที่ "ชนะ" บนช่วงเวลาที่ใช้จูน ยังไม่นับว่าใช้ได้ จนกว่าจะเจอข้อมูลที่ไม่มีส่วนในการเลือกค่าเลย
รายละเอียดครบทุกรอบ (รวมกลยุทธ์ที่เคยลองแล้วตกไป) อยู่ใน `optimizer\README.md` และ `bugs.md`
