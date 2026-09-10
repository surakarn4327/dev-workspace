# smart-ea

EA (Expert Advisor) เทรด XAUUSD อัตโนมัติบน MetaTrader 5 ของ Exness

## มีอะไรอยู่ในนี้

สองกลยุทธ์ แต่ละตัวมี core ของตัวเองใน `src\` และไฟล์ EA ที่มีแต่บล็อก `input`

| กลยุทธ์ | แนวคิด | สถานะ |
|---|---|---|
| `MARibbonEA` + `BestM15_A..F` | ตัดของค่าเฉลี่ยสองกลุ่ม วิ่งตามเทรนด์ | A ผ่านการทดสอบนอกช่วงจูนแบบก้ำกึ่ง ตัวอื่นยังไม่ผ่าน |
| `RangeFadeEA` + `BestRF_M15` | สวนราคาที่เหวี่ยงออกจากค่ากลางเกินปกติ | **ตกการทดสอบนอกช่วงจูนทั้ง 3 ปี ห้ามใช้เงินจริง** |

ตัววัดผลและสูตรให้คะแนนตอน optimize อยู่ที่ `src\TesterMetrics.mqh` ใช้ร่วมกันทั้งสองกลยุทธ์

## วิธีรัน

MQL ไม่มี dev server — compile แล้วแนบ EA เข้ากับ chart หรือรันใน Strategy Tester

```powershell
& "C:\Program Files\MetaTrader 5 EXNESS\metaeditor64.exe" /compile:"C:\dev\smart-ea\src\RangeFadeEA.mq5" /log:"$env:TEMP\c.log"
```

process คืนค่าก่อนเขียน log เสร็จ รอสัก 5 วินาทีแล้วอ่าน log หาบรรทัด `Result: 0 errors`
แล้ว copy ทั้ง `.mq5` และ `.ex5` ไปที่ `MQL5\Experts\` ของ terminal
(`MARibbonVisual` ไปที่ `MQL5\Indicators\` แทน)

ไล่หาค่าตั้งต้นจากคอมมานด์ไลน์ — **อ่าน [`optimizer\README.md`](optimizer/README.md) ก่อนทุกครั้ง**
มีข้อจำกัดของ MT5 หลายข้อที่ไม่ทำตามจะพังเงียบๆ

```powershell
cd C:\dev\smart-ea\optimizer\bin
.\run-opt.ps1 -Period M15 -SetName RF10_M15 -OutName rf10_M15 -Expert RangeFadeEA -DumpDir rangefade_opt
.\show-results.ps1 -OutName rf10_M15 -Top 15
```

## อ่านก่อนเชื่อตัวเลขใดๆ

ทุกชุดที่ "ชนะ" บนช่วงเวลาที่ใช้จูน ยังไม่นับว่าใช้ได้ จนกว่าจะผ่าน 3 ปีที่ไม่เคยใช้จูน
(มิ.ย. 2565 ถึง มิ.ย. 2568) — ที่ผ่านมามีชุดที่ผ่านด่านนี้แค่ตัวเดียวและผ่านแบบก้ำกึ่ง
ส่วนที่ตกมีทั้ง M5 ของ MA Ribbon (ล้างพอร์ตทุกปี) และ Range Fade (ขาดทุนทั้งสามปี)
รายละเอียดอยู่ใน `optimizer\README.md` และ `bugs.md`
