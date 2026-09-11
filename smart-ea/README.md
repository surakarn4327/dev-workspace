# smart-ea

EA (Expert Advisor) เทรด XAUUSD อัตโนมัติบน MetaTrader 5 ของ Exness

## มีอะไรอยู่ในนี้

สองกลยุทธ์ แต่ละตัวมี core ของตัวเองใน `src\` และไฟล์ EA ที่มีแต่บล็อก `input`

| กลยุทธ์ | แนวคิด | สถานะ |
|---|---|---|
| `MARibbonEA` + `BestM15_A..F` | ตัดของค่าเฉลี่ยสองกลุ่ม วิ่งตามเทรนด์ | A ผ่านการทดสอบนอกช่วงจูนแบบก้ำกึ่ง ตัวอื่นยังไม่ผ่าน |
| `BestWide_M15_MARibbon` | ตัดของค่าเฉลี่ย + SL กว้าง + แบ่งปิด 3 ไม้ | **ตัวที่ใช้จริง** ผ่านเกณฑ์ถอนกำไร 4/5 ข้อนอกช่วงจูน |

ตัววัดผลและสูตรให้คะแนนตอน optimize อยู่ที่ `src\TesterMetrics.mqh` ใช้ร่วมกันทั้งสองกลยุทธ์

## วิธีรัน

MQL ไม่มี dev server — compile แล้วแนบ EA เข้ากับ chart หรือรันใน Strategy Tester

```powershell
& "C:\Program Files\MetaTrader 5 EXNESS\metaeditor64.exe" /compile:"C:\dev\smart-ea\src\BestWide_M15_MARibbon.mq5" /log:"$env:TEMP\c.log"
```

process คืนค่าก่อนเขียน log เสร็จ รอสัก 5 วินาทีแล้วอ่าน log หาบรรทัด `Result: 0 errors`
แล้ว copy ทั้ง `.mq5` และ `.ex5` ไปที่ `MQL5\Experts\` ของ terminal
(`MARibbonVisual` ไปที่ `MQL5\Indicators\` แทน)

ไล่หาค่าตั้งต้นจากคอมมานด์ไลน์ — **อ่าน [`optimizer\README.md`](optimizer/README.md) ก่อนทุกครั้ง**
มีข้อจำกัดของ MT5 หลายข้อที่ไม่ทำตามจะพังเงียบๆ

```powershell
cd C:\dev\smart-ea\optimizer\bin
.\run-opt.ps1 -Period M15 -SetName Ribbon3_M15 -OutName ribbon3_M15_tune -From 2025.01.01 -To 2026.01.01
.\show-results.ps1 -OutName ribbon3_M15_tune -Top 15
```

## อ่านก่อนเชื่อตัวเลขใดๆ

ทุกชุดที่ "ชนะ" บนช่วงเวลาที่ใช้จูน ยังไม่นับว่าใช้ได้ จนกว่าจะเจอข้อมูลที่ไม่มีส่วนในการเลือกค่าเลย
งานรอบล่าสุดจูนบน **ม.ค.–ธ.ค. 2568** แล้วตรวจบน **ม.ค.–ก.ย. 2569 ด้วย tick จริง**
(ขอบเขตข้อมูลเริ่ม 1 ม.ค. 2568 ตามที่ผู้ใช้กำหนด — ทองเปลี่ยนพฤติกรรมไปแล้ว ปีเก่ากว่านั้นอธิบายตลาดคนละแบบ)

ไล่ไปแล้วราว 1,800 ชุด แต่ **มีแค่ 8 ชุดที่เคยออกไปเจอข้อมูลนอกช่วงจูน** ตัวเลขของอีก ~1,790 ชุด
จึงบอกได้แค่ว่า "เข้ากับปี 2568 ได้ดีแค่ไหน" ไม่ได้บอกว่าดีจริง

ที่ตกไปแล้วมี M1 กับ M5 ของ MA Ribbon, H1/H4 (ไม้ไม่พอ) และ Range Fade ทั้งตระกูล
รายละเอียดครบทุกรอบอยู่ใน `optimizer\README.md` และ `bugs.md`
