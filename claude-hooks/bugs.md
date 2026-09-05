# bugs — claude-hooks

บันทึกบั๊กที่เจอและแก้จริงทุกครั้ง (ตาม [ธรรมนูญข้อ 3](../CLAUDE.md))
ต่อ 1 บั๊ก ต้องมี: **อาการ** / **สาเหตุจริง (root cause)** / **วิธีแก้**

---

## 2026-09-05 — ทดสอบ close hook ใน PowerShell แล้วดูเหมือนพัง ทั้งที่ไม่พัง

**อาการ** — รัน `'{"prompt":"/session"}' | node session-title-close-hook.js` ใน PowerShell
แล้วไม่มี output เลย exit code 0 ดูเหมือน hook เสีย

**สาเหตุ** — 2 อย่างซ้อนกัน ทั้งคู่เป็นเรื่องของ **PowerShell 5.1** ไม่ใช่ของ hook:
1. `Set-Content -Encoding utf8` ใส่ **BOM** (`﻿`) ไว้หน้าไฟล์ พอ hook อ่าน stdin ได้
   `﻿{"prompt"...` → `JSON.parse` throw → ตกเข้า `catch` ที่ fail เงียบตามดีไซน์ → ไม่มี output
2. การ pipe string เข้า native exe ของ PowerShell 5.1 ปิด stdin ไม่สนิท → event `end`
   ไม่ยิง → โค้ดใน handler ไม่ทำงานเลย

รู้ได้เพราะใส่ instrument (`process.stdin.on("data"/"end"/"error")` พ่นออก stderr) ตามกฎ
"ห้ามเดา ต้องตรวจจริง" — เห็น `DATA: "﻿{...}"` ชัดๆ ถ้าเดาไปเรื่อยคงแก้โค้ด hook ผิดจุด

**วิธีแก้** — ไม่แก้โค้ด hook (มันถูกอยู่แล้ว) แก้ **วิธีทดสอบ** แทน:
- เพิ่ม fixture BOM-free ไว้ที่ `test/prompt-session.json` และ `test/prompt-plain.json`
  (เขียนด้วย `[System.IO.File]::WriteAllText` + `UTF8Encoding($false)` ไม่ใช่ `Set-Content`)
- ทดสอบด้วย `cmd /c "node hook.js < test\prompt-session.json"` เท่านั้น
- อัปเดต README/CLAUDE.md ให้เลิกแนะนำ `echo ... | node`

**บทเรียน** — `catch` ที่ fail เงียบ (จำเป็นสำหรับ hook) ทำให้แยกไม่ออกว่า "input ผิด" กับ
"โค้ดพัง" ต้องพึ่ง instrument เสมอ · และ `Set-Content -Encoding utf8` บน PS 5.1 = มี BOM
ถ้าไฟล์นั้นจะถูกอ่านโดยเครื่องมืออื่น ต้องใช้ `WriteAllText` + `UTF8Encoding($false)`

---

## 2026-09-05 — prefix ของ workspace หลักหายเงียบๆ

**อาการ** — เปิด session ในโฟลเดอร์ workspace หลักแล้วไม่ได้ prefix `DEV`
hook กลับไปเข้าทาง "ยังไม่มีคำนำหน้า" แล้วสั่งให้ถามผู้ใช้ใหม่ ทั้งที่เคยตั้งไว้แล้ว

**สาเหตุ** — `session-prefixes.json` มี key ว่า `"dev"` (มาจากสมัยที่ workspace อยู่ที่ `C:\dev`)
แต่ตอนนี้โฟลเดอร์ชื่อ `dev-workspace` แล้ว hook ใช้ `path.basename(process.cwd())`
เทียบ key แบบตรงตัว พอ basename เปลี่ยน การหาก็ไม่เจอ — และ**ไม่มี error ใดๆ**
เพราะ `map[folder]` คืน `undefined` ซึ่งเป็นเส้นทางปกติของโค้ด

**วิธีแก้** — เพิ่ม key `"dev-workspace": "DEV"` ใน `session-prefixes.json`
(เก็บ `"dev"` เดิมไว้ด้วย เผื่อมีเครื่องที่ยังใช้ path เก่า)

**บทเรียน** — key คือ**ชื่อโฟลเดอร์** ไม่ใช่ path เปลี่ยนชื่อโฟลเดอร์เมื่อไหร่ต้องมาแก้ JSON ด้วย
และเพราะมันพังแบบเงียบ จะไม่มีใครรู้จนกว่าจะสังเกตเองว่าชื่อ session ผิดรูปแบบ
