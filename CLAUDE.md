# C:\dev — ธรรมนูญของ workspace

ไฟล์นี้เป็น "กฎหมายกลาง" ที่บังคับใช้กับ **ทุกโปรเจกต์** ที่อยู่ใต้ `C:\dev`
โปรเจกต์ย่อยมี `CLAUDE.md` ของตัวเองได้ และกฎในนั้น **ชนะ** กฎกลางเมื่อขัดกัน
(กฎกลางคือค่า default ไม่ใช่ข้อห้ามเด็ดขาด — ยกเว้นหมวด 4 "ความปลอดภัย")

> `C:\work` เป็นดินแดนเก่า ไม่อยู่ใต้กฎนี้ ของใหม่ทั้งหมดเกิดที่นี่

---

## 1. โครงสร้างดินแดน

```
C:\dev\
├── CLAUDE.md          ← ไฟล์นี้ (ธรรมนูญ)
├── PROJECTS.md        ← ทะเบียนราษฎร์: โปรเจกต์ทั้งหมด + พอร์ตที่จอง
├── .nvmrc             ← Node เวอร์ชันกลางของทั้งประเทศ
├── .editorconfig      ← กฎการจัดรูปแบบไฟล์กลาง
├── .claude\
│   ├── settings.json  ← permission / env ที่ใช้ร่วมกัน
│   ├── launch.json    ← ทะเบียนพอร์ต dev server (Browser pane อ่านไฟล์นี้)
│   └── commands\      ← slash command ประจำ workspace
├── .workspace\
│   ├── bin\           ← สคริปต์ประจำรัฐ (new-project.ps1, doctor.ps1)
│   └── templates\     ← ไฟล์ที่โปรเจกต์เกิดใหม่ทุกคนได้รับ
├── _docs\             ← เอกสาร/สเปรดชีตที่ไม่ผูกกับโปรเจกต์ใด
└── <ชื่อโปรเจกต์>\     ← พลเมือง: git repo อิสระ 1 repo ต่อ 1 โปรเจกต์
```

**หนึ่งโปรเจกต์ = หนึ่งโฟลเดอร์ = หนึ่ง git repo** ไม่มี monorepo ไม่มี nested repo
โปรเจกต์คุยกันผ่าน HTTP หรือไฟล์ที่ export เท่านั้น — ห้าม `import` ข้ามโฟลเดอร์โปรเจกต์
(`../money-app/src/...` คือสิ่งต้องห้าม) ถ้าโค้ดต้องใช้ร่วมกันจริง ให้ทำเป็นแพ็กเกจแยก

## 2. การเกิดของโปรเจกต์ใหม่

อย่าสร้างโฟลเดอร์เปล่าเอง ใช้:

```bash
powershell -File C:\dev\.workspace\bin\new-project.ps1 -Name my-app -Type web
```

หรือใน Claude Code: `/new-project my-app web`
สคริปต์จะ scaffold, ใส่ไฟล์ตามกฎ, `git init` + commit แรก, จองพอร์ต และลงทะเบียนใน
`PROJECTS.md` กับ `.claude\launch.json` ให้ครบ

ชนิดที่รองรับ: `web` (Vite+TS), `next` (Next.js), `node` (CLI/API), `python`, `blank`

## 3. สิ่งที่ทุกโปรเจกต์ต้องมี

| ไฟล์ | หน้าที่ |
|---|---|
| `README.md` | โปรเจกต์นี้คืออะไร + วิธีรัน (ภาษาไทยได้) |
| `CLAUDE.md` | กฎเฉพาะของโปรเจกต์ + คำสั่ง build/test/lint ที่ใช้จริง |
| `.gitignore` | ต้อง ignore `node_modules`, `dist`, `.env*` (ยกเว้น `.env.example`) |
| `.editorconfig` | UTF-8, LF, indent 2 (Python 4) |

ชื่อโฟลเดอร์เป็น **kebab-case ภาษาอังกฤษ** เสมอ (`smart-drive-map` ไม่ใช่ `SmartDriveMap`)

## 4. ความปลอดภัย (ข้อนี้ห้ามละเมิด)

- ห้าม commit ค่า secret จริง — API key, token, connection string, ไฟล์ `.env*`
  ให้ commit เฉพาะ `.env.example` ที่ใส่ค่าหลอก
- ห้ามใส่ secret ลงในโค้ดฝั่ง client (อะไรที่ bundle ไป browser คือสาธารณะ)
- ก่อน `git push` ครั้งแรกของทุก repo ต้องเช็กว่าไม่มีไฟล์ secret หลุดเข้า history
- `.env` / `.env.local` อยู่ในเครื่องเท่านั้น

## 5. พอร์ต

พอร์ตต้องจองใน `.claude\launch.json` ก่อนใช้ ห้ามชนกัน ช่วงที่กันไว้:

| ช่วง | ใช้กับ |
|---|---|
| 3000–3099 | Next.js / เว็บที่มี server |
| 5170–5199 | Vite / static dev server |
| 8000–8099 | Python / API / backend |

พอร์ตที่ถูกจองแล้วดูได้ใน `PROJECTS.md` — `new-project.ps1` เลือกให้อัตโนมัติ

## 6. เครื่องมือมาตรฐาน

- **Node** — เวอร์ชันเดียวกันทั้งประเทศ ดู `.nvmrc` (ปัจจุบัน Node 24)
- **package manager** — `npm` เท่านั้น และ commit `package-lock.json` เสมอ
- **TypeScript** — `strict: true` ทุกโปรเจกต์ TS
- **Python** — venv ต่อโปรเจกต์ (`.venv\`) ห้ามลงแพ็กเกจลง global
- **git** — commit message ภาษาอังกฤษ ขึ้นต้นด้วยคำกริยา (`add`, `fix`, `refactor`)
  โค้ด/ตัวแปร/คอมเมนต์ในโค้ด = อังกฤษ, README/เอกสาร/UI = ไทยได้

## 7. การรัน dev server

ใช้ Browser pane (`preview_start` ตามชื่อใน `launch.json`) เสมอ — อย่ารัน dev server
ค้างไว้ใน terminal เพราะจะไม่มีใครเก็บกวาด process ให้

## 8. กฎการทำงานร่วมกับ Claude

- ตอบและอธิบายเป็น **ภาษาไทย**
- ก่อนแก้โปรเจกต์ไหน อ่าน `CLAUDE.md` ของโปรเจกต์นั้นก่อน
- ห้ามแก้ไฟล์ข้ามโปรเจกต์ในงานเดียวโดยไม่บอกก่อน
- ห้ามแตะไฟล์/โฟลเดอร์ที่ root ที่ไม่เกี่ยวกับงานที่สั่ง
- ตรวจสุขภาพประเทศได้ด้วย `/doctor-workspace` หรือ `.workspace\bin\doctor.ps1`
