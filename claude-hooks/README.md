# claude-hooks

hook ของ Claude Code ที่ใช้ร่วมกันทุกโปรเจกต์ — ตอนนี้มีเรื่องเดียวคือ
**บังคับให้ตั้งชื่อ session อัตโนมัติ** เพื่อให้ย้อนกลับมาหา session เก่าเจอ

## มีอะไรบ้าง

| ไฟล์ | ทำงานตอนไหน | ทำอะไร |
|---|---|---|
| `session-title-hook.js` | `SessionStart` | สั่งให้ตั้งชื่อ session ทันทีก่อนตอบข้อความแรก |
| `session-title-close-hook.js` | `UserPromptSubmit` | เจอคำว่า `/session` แล้วเตือนให้อัปเดตชื่อก่อนปิดงาน |
| `session-prefixes.json` | — | ตารางจับคู่ ชื่อโฟลเดอร์ → คำนำหน้าชื่อ session |

## รูปแบบชื่อ session

```
PREFIX yy/mm/dd งานสั้นๆ
```

- `PREFIX` — มาจาก `session-prefixes.json` ตามชื่อโฟลเดอร์ที่เปิด session
- `yy/mm/dd` — วันที่ **พ.ศ. 2 หลัก** (ค.ศ. 2026-09-05 → `69/09/05`)
- `งานสั้นๆ` — 3–6 คำ **ภาษาชาวบ้าน** ห้ามใช้ชื่อ class / ตัวแปร / ไฟล์ในโค้ด
  - ❌ `SheetAdvisor Stk_Factor 1mm แก้เสร็จ`
  - ✅ `แก้หน้าแนะนำ 1mm ไม่มี`

ตัวอย่าง: `DEV 69/09/05 วางแผนโปรเจกต์วิจัยตลาด`

## เพิ่มโปรเจกต์ใหม่เข้าระบบ

แก้ [`session-prefixes.json`](session-prefixes.json) เพิ่ม 1 บรรทัด — key คือ**ชื่อโฟลเดอร์**
(ไม่ใช่ path เต็ม) value คือคำนำหน้าที่อยากได้:

```json
{
  "trade-lab": "LAB"
}
```

ถ้าเปิด session ในโฟลเดอร์ที่ยังไม่มีใน JSON hook จะสั่งให้ Claude **ถามผู้ใช้ก่อน**
ว่าอยากใช้คำนำหน้าอะไร แล้วเขียนกลับลงไฟล์นี้ให้เอง

## ติดตั้ง

hook ต้องลงทะเบียนใน `settings.json` ของ Claude Code (ระดับ user หรือ project)
ดูรายละเอียดใน [CLAUDE.md](CLAUDE.md)

## ทดสอบ

```bash
node claude-hooks\session-title-hook.js
```

```bash
cmd /c "node claude-hooks\session-title-close-hook.js < claude-hooks\test\prompt-session.json"
```

```bash
cmd /c "node claude-hooks\session-title-close-hook.js < claude-hooks\test\prompt-plain.json"
```

- 2 คำสั่งแรกต้องพ่น JSON ที่มี `hookSpecificOutput.additionalContext`
- คำสั่งที่สาม (prompt ธรรมดา ไม่มี `/session`) ต้อง**ไม่พ่นอะไรเลย** — ถูกต้องแล้ว

> ⚠️ อย่าทดสอบด้วย `echo '...' | node ...` ใน PowerShell — จะไม่ได้ output
> และดูเหมือน hook พัง ทั้งที่ไม่ได้พัง ดู [bugs.md](bugs.md)
