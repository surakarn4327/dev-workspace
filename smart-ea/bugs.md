# bugs.md — smart-ea

บันทึกบั๊กที่เจอ+แก้จริงในโปรเจกต์นี้ (ดูกฎที่ [../CLAUDE.md](../CLAUDE.md))

## 2026-09-04 — compile error รัวๆ (24 errors, 20 warnings) หลังเขียน SmartEA_XAUUSD.mq5 ครั้งแรก

**อาการ**: MetaEditor compile แล้วขึ้น error กระจายทั้งไฟล์ "open parenthesis expected", "implicit conversion from 'number' to 'string'" ตั้งแต่บรรทัด 31 เป็นต้นไป ดูเหมือนพังทั้งไฟล์

**สาเหตุจริง**: ประกาศตัวแปร `const string SymbolName = "XAUUSDm"` ชื่อชนกับฟังก์ชัน built-in ของ MQL5 คือ `SymbolName()` (คืนชื่อ symbol จาก index) — error แรกสุดคือ "identifier 'SymbolName' already used, built-in 'SymbolName'" ส่วน error ที่เหลือทั้งหมดเป็นผลพวง parser สับสนจากตัวนี้ตัวเดียว ไม่ใช่ error จริงหลายจุด

**วิธีแก้**: เปลี่ยนชื่อตัวแปรเป็น `TradeSymbol` แทน (sed แทนที่ทั้งไฟล์) compile ผ่านสะอาด

**บทเรียน**: ก่อนตั้งชื่อ const/variable ใน MQL5 เช็คก่อนว่าชนกับ built-in function ชื่อเดียวกันไหม (เช่น `Symbol`, `SymbolName`, `Bid`, `Ask`, `Point` เป็นชื่อที่เสี่ยงชน) — ถ้า compile error เยอะผิดปกติกระจายทั้งไฟล์ ให้ดู error **แรกสุด** ก่อน มักเป็นต้นตอเดียวที่ทำให้ error หลอกอื่นๆ ตามมา ไม่ต้องไล่แก้ทีละบรรทัด

## 2026-09-04 — Lot size คำนวณผิด เสีย/ได้เงินจริงเล็กกว่าที่ตั้งใจ ~10 เท่า

**อาการ**: backtest เดือน ส.ค. 2026, ตั้ง `InpRiskPerTrade=200` (ตั้งใจให้เสีย ~$200/ไม้) แต่ผล backtest average loss trade = **-$19.69** เท่านั้น (ควรใกล้ 200)

**สาเหตุจริง**: `CalcLot()` ใน [src/SmartEA_XAUUSD.mq5](src/SmartEA_XAUUSD.mq5) ดึง `SymbolInfoDouble(TradeSymbol, SYMBOL_POINT)` มาหาร SL distance เพื่อได้ "จำนวนจุด" — แต่ **XAUUSDm ของ Exness ราคาแสดงทศนิยม 3 ตำแหน่ง (เช่น 4471.501) แปลว่า `SYMBOL_POINT` จริงของ broker คือ 0.001** ในขณะที่สูตร lot ที่ผู้ใช้ออกแบบไว้ (ตัวอย่าง: SL distance 4.700 = "470 จุด") ตั้งใจนิยาม 1 "จุด" = 0.01 เสมอ (ไม่ใช่ tick size จริงของ broker) — โค้ดใช้ point ของ broker (0.001) แทนที่จะ hardcode 0.01 ตามนิยามของผู้ใช้ ทำให้ sl_points คำนวณออกมาใหญ่กว่าที่ตั้งใจ 10 เท่า → lot เล็กลง 10 เท่า → เงินเสีย/ได้จริงเล็กกว่าที่ตั้งใจ 10 เท่า

**วิธีแก้**: เพิ่ม `const double RiskPointUnit = 0.01;` แล้วใช้ค่านี้แทน `SymbolInfoDouble(...,SYMBOL_POINT)` ในสูตร lot โดยเฉพาะ (ไม่ใช่ tick size จริงของ broker) — หลัง fix backtest เดือนเดิม average loss = -205.66, average profit = 395.71 ตรงตามที่ตั้งใจ (risk≈200, RR≈2)

**บทเรียน**: **ห้ามสมมติว่า "จุด" ที่ user พูดถึง (ในสูตรธุรกิจ/risk management) เท่ากับ `SYMBOL_POINT` ของ broker เสมอไป** โดยเฉพาะ instrument ที่ราคาแสดงทศนิยมมากกว่าปกติ (เช่น gold บาง broker ใช้ 2 ทศนิยม บาง broker ใช้ 3) ต้องถามหรือ derive หน่วย "จุด" จากตัวอย่างตัวเลขจริงที่ user ให้มาก่อน ไม่ใช่ผูกกับค่า broker ตรงๆ — ถ้าตัวเลขผลลัพธ์ (P&L จริง) ต่างจากที่ตั้งใจเป็นสิบเท่า/ร้อยเท่า ให้สงสัยเรื่อง unit mismatch (point/pip/tick) ก่อนอย่างอื่น
