# ea-tuner

โปรแกรม desktop (Python + Tkinter) ควบคุมการจูน/ทดสอบ EA ของ MT5 ในโปรเจกต์พี่น้อง
[`../smart-ea`](../smart-ea/CLAUDE.md) — เลือก EA, ไฟล์ `.set`, สัญลักษณ์, timeframe, ช่วงวันที่,
โมเดล tick, โหมด (รันเดี่ยว / จูนแบบ genetic / จำลองถอนกำไรรายสัปดาห์ / รายเดือน) แล้วกดปุ่ม
**รัน** — โปรแกรมจะสั่ง MT5 backtest/optimize ให้เองผ่านสคริปต์ที่มีอยู่แล้วของ smart-ea แล้วเปิด
หน้าสรุปผล HTML ให้อัตโนมัติเมื่อเสร็จ (ตารางอันดับทุกชุดที่จูน + กราฟกำไรรายงวด)

## เริ่มใช้งาน

ต้องมี Python 3.10+ ติดตั้งจริงในเครื่อง (ไม่ใช่ store stub — เช็คด้วย `python --version`
ถ้าขึ้น error ให้ลง `winget install Python.Python.3.12` ก่อน)

```bash
cd ea-tuner
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python src\main.py
```

หน้าต่างโปรแกรมจะเปิดขึ้นมาเอง (ไม่ใช่เว็บ ไม่ต้องเปิด browser ไปที่พอร์ตไหน)

## ก่อนใช้ครั้งแรก

1. `smart-ea` ต้อง compile + deploy EA ที่จะทดสอบไปที่ `MQL5\Experts\Advisors\` ของ MT5 terminal
   ก่อนแล้ว (ดู `smart-ea\CLAUDE.md`) — ea-tuner หาโฟลเดอร์ terminal เองจากตำแหน่งไฟล์ `.ex5`
2. เตรียมไฟล์ `.set` อย่างน้อย 1 ไฟล์ใน `smart-ea\optimizer\sets\` (หรือกดปุ่ม "แก้ไฟล์ .set"
   ในโปรแกรมเพื่อสร้างใหม่)
3. ปิด MT5 ก่อนกดรันทุกครั้ง (`run-opt.ps1` เดิมต้องการแบบนั้น)

## สถานะ

สร้างเมื่อ 2026-09-12 — เวอร์ชันแรก: รัน/จูน + สรุปผลอัตโนมัติผ่าน 4 โหมด
