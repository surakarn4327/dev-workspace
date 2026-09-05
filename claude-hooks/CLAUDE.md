# claude-hooks

> อยู่ใต้ธรรมนูญ [`../CLAUDE.md`](../CLAUDE.md) — อ่านไฟล์นั้นก่อน กฎในไฟล์นี้ชนะเมื่อขัดกัน

## โปรเจกต์นี้คืออะไร

hook ของ Claude Code ที่ใช้ร่วมกันทุกโปรเจกต์ — บังคับให้ตั้งชื่อ session อัตโนมัติ
ตามรูปแบบ `PREFIX yy/mm/dd งานสั้นๆ` (พ.ศ. 2 หลัก) เพื่อให้ค้น session เก่าเจอ

ดูวิธีใช้และรูปแบบชื่อใน [README.md](README.md)

## คำสั่งที่ใช้จริง

ไม่มี build / install — เป็น Node script เปล่าๆ ใช้แค่ built-in module (`fs`, `path`)

```bash
node claude-hooks\session-title-hook.js
```

```bash
cmd /c "node claude-hooks\session-title-close-hook.js < claude-hooks\test\prompt-session.json"
```

```bash
cmd /c "node claude-hooks\session-title-close-hook.js < claude-hooks\test\prompt-plain.json"
```

> ทดสอบ hook ที่อ่าน stdin **ต้อง** redirect จากไฟล์ผ่าน `cmd /c` เท่านั้น
> ห้ามใช้ `echo ... | node` ใน PowerShell (ดู [bugs.md](bugs.md))

## โครงสร้าง

| ไฟล์ | event | หมายเหตุ |
|---|---|---|
| `session-title-hook.js` | `SessionStart` | อ่าน `basename(process.cwd())` ไปหาใน JSON |
| `session-title-close-hook.js` | `UserPromptSubmit` | อ่าน stdin, trigger เมื่อ prompt มีคำใน `KEYWORDS` |
| `session-prefixes.json` | — | `{ "ชื่อโฟลเดอร์": "PREFIX" }` |

## การลงทะเบียน hook

hook พวกนี้ไม่ทำงานเองจนกว่าจะใส่ใน `settings.json` ของ Claude Code:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node <path>\\claude-hooks\\session-title-hook.js" }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "node <path>\\claude-hooks\\session-title-close-hook.js" }] }
    ]
  }
}
```

## กฎเฉพาะของโปรเจกต์นี้

### 1. hook ห้ามพังหรือทำให้ผู้ใช้รอ

hook รันทุกครั้งที่เปิด session และทุกครั้งที่ผู้ใช้พิมพ์ ถ้ามันโยน error หรือค้าง
ผู้ใช้จะทำงานไม่ได้เลย ดังนั้น:

- ทุกจุดที่อาจ throw (อ่านไฟล์, `JSON.parse`) ต้องอยู่ใน `try/catch` และ **fail เงียบ**
- ห้ามเรียก network, ห้ามอ่านไฟล์ใหญ่, ห้ามทำอะไรที่ช้ากว่าหลักมิลลิวินาที
- ห้าม `console.log` อะไรที่ไม่ใช่ JSON ของ hook (จะทำให้ Claude Code parse ไม่ผ่าน)

### 2. key ใน session-prefixes.json คือชื่อโฟลเดอร์ ไม่ใช่ path

hook ใช้ `path.basename(process.cwd())` เทียบตรงๆ **ถ้าเปลี่ยนชื่อโฟลเดอร์ ต้องมาแก้ JSON ด้วย**
ไม่งั้น prefix จะหายเงียบๆ โดยไม่มี error (เคยเกิดมาแล้ว — ดู [bugs.md](bugs.md))

### 3. ใช้ Node built-in เท่านั้น ห้ามลง dependency

ไม่มี `package.json` และไม่ควรมี — hook ต้องรันได้ทันทีบนเครื่องใหม่ที่เพิ่ง clone
โดยไม่ต้อง `npm install` ก่อน

### 4. แก้ hook แล้วต้องทดสอบด้วยมือทุกครั้ง

ไม่มี test อัตโนมัติ (จะคุ้มก็ต่อเมื่อ hook ซับซ้อนกว่านี้มาก) — รันคำสั่งในหัวข้อ
"คำสั่งที่ใช้จริง" แล้วดูว่า JSON ที่ออกมาถูกต้อง ก่อน commit เสมอ
