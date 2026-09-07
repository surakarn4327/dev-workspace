# trade-indicator

> อยู่ใต้ธรรมนูญ `C:\dev\CLAUDE.md` — อ่านไฟล์นั้นก่อน กฎในไฟล์นี้ชนะเมื่อขัดกัน

## โปรเจกต์นี้คืออะไร

Pine Script indicator บน TradingView: MA Ribbon + signal + SL/TP
พร้อม dashboard สถิติ winrate ของ SL/TP1/TP2/TP3

พอร์ตมาจาก `MA_Ribbon_Signal_Indicator.ex5` (MT5) ซึ่งเป็นไบนารีคอมไพล์แล้ว —
**ไม่มีซอร์สต้นฉบับ** ลอจิกที่เขียนไว้เป็นการตีความจากหน้าต่าง Inputs + พฤติกรรมบนชาร์ต

## คำสั่งที่ใช้จริง

ไม่มี build / test / dev server — เป็น Pine Script ไฟล์เดียวที่ copy ไปวางใน
TradingView Pine Editor แล้วกด Add to chart

ตรวจไวยากรณ์ได้ทางเดียวคือ **paste ลง Pine Editor แล้วดู error** ไม่มี local compiler

## โครงสร้าง

- `ma-ribbon-signal.pine` — สคริปต์ทั้งหมด (ribbon + signal + trade state machine + dashboard)

## กฎเฉพาะของโปรเจกต์นี้

- **Pine v6** เท่านั้น ห้ามถอยไป v5
- **ห้ามประกาศฟังก์ชันใน local scope** (ใน `if` / `for`) — Pine ไม่ยอม ต้องอยู่ระดับ global
- **ห้าม assign หลายตัวคั่นด้วย comma บรรทัดเดียว** (`a = 1, b = 2`) — Pine ไม่ยอม
- `ta.ema` / `ta.sma` ต้องรับ length เป็น `simple int` → ห้ามคำนวณ period จาก series
  (นี่คือเหตุผลที่ period แต่ละเส้นเป็น `input.int` แยกกัน ไม่ใช่ string คั่น comma แบบต้นฉบับ MT5)
- **สถิติต้องนับแบบ pessimistic** — แท่งที่แตะทั้ง SL และ TP ให้ SL ชนะเสมอ
  ห้ามเปลี่ยนเป็นให้ TP ชนะเพื่อให้ตัวเลขดูดี เพราะจะเป็นการหลอกตัวเอง
- ตัวเลขบน dashboard **ไม่รวม spread / commission / slippage** ถ้าจะเพิ่มต้องเขียนกำกับให้ชัด
