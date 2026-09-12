# ea-tuner

> อยู่ใต้ธรรมนูญ `C:\dev\CLAUDE.md` — อ่านไฟล์นั้นก่อน กฎในไฟล์นี้ชนะเมื่อขัดกัน

## โปรเจกต์นี้คืออะไร

หน้าต่าง desktop (Python + Tkinter) สำหรับควบคุมการทดสอบ/จูน EA ของโปรเจกต์พี่น้อง
[`../smart-ea`](../smart-ea/CLAUDE.md) โดยไม่ต้องพิมพ์คอมมานด์ไลน์เอง — เลือก EA, ไฟล์ `.set`,
สัญลักษณ์, timeframe, ช่วงวันที่, โมเดล tick, โหมด (รันเดี่ยว/จูน/จำลองถอนกำไรรายสัปดาห์-รายเดือน)
แล้วกดปุ่ม **รัน** โปรแกรมจะสั่ง MT5 ผ่าน `optimizer/bin/*.ps1` ที่มีอยู่แล้วของ smart-ea ให้เอง
รอจนจบ แล้วเปิดหน้าสรุปผล HTML ให้อัตโนมัติ (ตารางอันดับทุกชุดที่จูน + กราฟกำไรรายงวด)

**ห้าม import โค้ด MQL5 ข้ามโฟลเดอร์** (ตามธรรมนูญ) — ea-tuner ไม่รู้จักตรรกะภายในของ EA ใดๆ เลย
คุยกับ smart-ea ผ่านสองทางเท่านั้น: (1) เรียก `optimizer/bin/*.ps1` เป็น subprocess (2) อ่านไฟล์ผลลัพธ์
`.csv` ที่สคริปต์เหล่านั้นเขียนไว้ใน `optimizer/results/` กลับมา

## คำสั่งที่ใช้จริง

```bash
python src\main.py      # เปิดหน้าต่างโปรแกรม
pytest                  # test
```

ไม่มี dev server/พอร์ตจริง (เป็นโปรแกรม desktop ล้วน ไม่ใช่เว็บ) — ค่าพอร์ต 8000 ใน `PROJECTS.md`
เป็นแค่ค่า default ของสคริปต์ scaffold ไม่ได้ใช้งานจริง

## โครงสร้าง

- `src/config.py` — ค่าคงที่ + ค้นหาไฟล์ของ smart-ea (path ของ `optimizer/bin`, `sets`, `results`,
  รายชื่อ EA จาก `smart-ea/src/*.mq5`, mapping ชื่อไฟล์ `*Core.mqh` → โฟลเดอร์ dump ผลใน
  `Common\Files\` ของ MT5) **ถ้าเพิ่ม EA ใหม่ใน smart-ea ที่ import Core.mqh ตัวใหม่ ต้องเพิ่ม
  entry ใน `CORE_TO_DUMPDIR` ที่นี่ด้วย** (เช็คจาก path ที่ `FileOpen()` ใช้ใน `DumpPass()` ของ
  Core.mqh นั้น)
- `src/runner.py` — ประกอบ argument list แล้วรัน `run-opt.ps1` / `run-weekly-reset.ps1` /
  `run-monthly-reset.ps1` เป็น subprocess, stream stdout ทีละบรรทัดกลับมา
- `src/report.py` — parse ไฟล์ผล `.csv` (ผังคอลัมน์: พารามิเตอร์ N ช่อง + 17 ช่องตัวชี้วัดท้ายบรรทัด
  ตาม `MetricsCsvTail()` ใน `smart-ea/src/TesterMetrics.mqh` — ea-tuner ไม่รู้ชื่อจริงของแต่ละ
  พารามิเตอร์ แสดงเป็น `Param1..N` เสมอ เพื่อให้ใช้ได้กับ EA ใหม่ในอนาคตโดยไม่ต้องแก้โค้ดที่นี่)
  แล้วประกอบเป็นหน้าเว็บ HTML เดี่ยว (self-contained ไม่พึ่ง asset ภายนอก) เขียนลง `output/`
  (ไม่เข้า git — สร้างใหม่ได้ทุกครั้งจากไฟล์ผลดิบใน `smart-ea/optimizer/results/`)
- `src/gui.py` — หน้าต่างหลัก (Tkinter) + หน้าต่างแก้ไฟล์ `.set` แบบ text ธรรมดา
- `src/main.py` — entry point

## กฎเฉพาะของโปรเจกต์นี้

- **ไม่มี dependency ภายนอกเกินจำเป็น** — ใช้แต่ standard library ของ Python (Tkinter, subprocess,
  threading) เพื่อไม่ต้องพึ่ง `pip install` อะไรเพิ่มตอนย้ายเครื่อง (เครื่องนี้ไม่มี Python ติดตั้งมา
  ด้วยซ้ำตอนสร้างโปรเจกต์ — ต้องลงผ่าน `winget install Python.Python.3.12` ก่อน)
- **โหมดความเสี่ยง (fixed USD / % equity) ไม่มี control แยกในหน้าต่างหลัก** ตั้งใจให้แก้ผ่านไฟล์
  `.set` โดยตรง (ปุ่ม "แก้ไฟล์ .set") เพราะชื่อ input ของแต่ละ EA ไม่เหมือนกัน
  (`InpRiskMode`/`InpRiskPct`/`InpRiskFixedUsd`) การสร้าง control เฉพาะจะผูก ea-tuner
  เข้ากับ EA ตัวใดตัวหนึ่งมากเกินไป
- **การรันจริงทุกครั้งเรียก `optimizer/bin/run-opt.ps1` ของ smart-ea เสมอ** (ไม่เขียน logic
  เรียก MT5 ซ้ำเอง) เพราะสคริปต์นั้นมีด่านตรวจ/แก้บั๊กสะสมมาเยอะแล้ว (ดู `smart-ea/bugs.md`
  และ `smart-ea/optimizer/README.md`) — ถ้า `run-opt.ps1` เปลี่ยน interface ต้องแก้
  `src/runner.py` ให้ตรงกันด้วย
- **path ของ Expert ที่ส่งให้ `run-opt.ps1` ต้องมี `Advisors\` นำหน้าเสมอ** (เช่น
  `Advisors\SmartIndicatorEA`) เพราะไฟล์ `.ex5` ถูก deploy ไปที่ `MQL5\Experts\Advisors\`
  ไม่ใช่ `MQL5\Experts\` ตรงๆ — พลาดจุดนี้แล้ว `run-opt.ps1` จะหาโฟลเดอร์ terminal ไม่เจอ
- **PowerShell บนเครื่องนี้ไม่มี `git`/`python` ใน PATH ของ process ใหม่โดย default**
  ถ้าจะรันคำสั่งที่ต้องใช้สองตัวนี้จาก terminal ภายนอก IDE ต้องเซ็ต `$env:Path` เพิ่มเอง
  ชี้ไป `AppData\Local\Programs\Python\Python312` และ
  `AppData\Local\GitHubDesktop\app-*\resources\app\git\cmd` — ea-tuner เองไม่ต้องพึ่งเรื่องนี้
  เพราะเรียก `powershell.exe` ตรงๆ ผ่าน `subprocess` ซึ่งสืบทอด PATH จาก process ที่รันโปรแกรมนี้อยู่แล้ว
