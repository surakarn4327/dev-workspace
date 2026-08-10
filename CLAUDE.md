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

**ทุกงาน แม้เป็นไฟล์เดียว (เช่น script เดี่ยว, ไฟล์ config, indicator เดี่ยวๆ) ต้อง scaffold เป็น
project folder เต็มรูปแบบผ่าน `new-project.ps1` เสมอ** ห้ามวางไฟล์เดี่ยวๆ ลอยๆ ไว้ที่ root
หรือที่ไหนใน `C:\dev` โดยไม่มี CLAUDE.md/README.md/git repo ของตัวเอง เผื่ออนาคตต้องขยาย

**หนึ่งโปรเจกต์ = หนึ่งโฟลเดอร์ = หนึ่ง git repo** ไม่มี monorepo ไม่มี nested repo
โปรเจกต์คุยกันผ่าน HTTP หรือไฟล์ที่ export เท่านั้น — ห้าม `import` ข้ามโฟลเดอร์โปรเจกต์
(`../money-app/src/...` คือสิ่งต้องห้าม) ถ้าโค้ดต้องใช้ร่วมกันจริง ให้ทำเป็นแพ็กเกจแยก
ตามขั้นตอนใน [`.workspace/shared-packages.md`](.workspace/shared-packages.md)

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

## 4. ความปลอดภัยและการสำรองข้อมูล (ข้อนี้ห้ามละเมิด)

- ห้าม commit ค่า secret จริง — API key, token, connection string, ไฟล์ `.env*`
  ให้ commit เฉพาะ `.env.example` ที่ใส่ค่าหลอก
- ห้ามใส่ secret ลงในโค้ดฝั่ง client (อะไรที่ bundle ไป browser คือสาธารณะ)
- `.env` / `.env.local` อยู่ในเครื่องเท่านั้น
- **ทุกโปรเจกต์ต้องมี git remote** — ไม่มี remote = ดิสก์พังแล้วหายหมด
  `new-project.ps1` สร้าง GitHub repo เป็น **private** ให้อัตโนมัติ
  ถ้าจะทำ public ต้องสั่ง `-Public` เอง และตรวจ history ให้แน่ใจก่อนว่าไม่มี secret หลุด
- ตัว workspace เองก็อยู่ใน git → `github.com/surakarn4327/dev-workspace` (private)
- **ทุกบริการ/API/hosting ที่ใช้ในทุกโปรเจกต์ ต้องฟรี และห้ามผูกบัตร (no card verification)**
  แม้ tier ฟรีจะไม่มีค่าใช้จ่ายจริง ถ้าขั้นตอน sign up ต้องกรอกบัตร ถือว่าใช้ไม่ได้
  ห้ามเสนอ Oracle Cloud / AWS / GCP / TradingView Pro หรือบริการอื่นที่ต้องผูกบัตรแม้จะฟรี
  ถ้าจำเป็นต้องผูกบัตรจริงๆ (ไม่มีทางเลือกฟรี-ไม่ผูกบัตร) ต้องถามผู้ใช้ก่อนเสมอ ห้ามเสนอเป็นค่า default

### identity

ทุก repo ใต้ `C:\dev` ใช้บัญชี **surakarn4327** อัตโนมัติ ผ่าน `includeIf` ที่ชี้มาที่
`C:\dev\.gitconfig` — ไม่ต้องตั้ง `user.email` รายโปรเจกต์
งานนอก `C:\dev` (เช่นงานบริษัท) ยังใช้ identity เดิม ไม่กระทบกัน

**gh CLI มีหลาย account login พร้อมกัน (เช่น SurakarnTitle, surakarn4327) — ก่อนสั่ง `gh` ใดๆ
ที่แตะ GitHub จริง (สร้าง repo, push, ลบ ฯลฯ) ต้อง `gh auth switch --hostname github.com --user surakarn4327`
ก่อนเสมอ** ห้ามพึ่ง active account เดิมที่ค้างอยู่ เพราะอาจไม่ใช่ surakarn4327
(gh CLI ไม่มีหน้าต่างเลือก account แบบ GUI — การ switch ตายตัวทุกครั้งคือทางที่แทนได้)

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

- **ข้อความแรกของทุก session ใหม่ที่เปิดในโฟลเดอร์นี้** ให้ทักทายสั้นๆ ก่อนตอบเรื่องอื่นใด
  (ยกเว้น session ที่ resume/continue ของเก่าอยู่แล้ว) สรุปด้วย bullet สั้นๆ:
  - นี่คือ workspace `C:\dev` อยู่ใต้ธรรมนูญ `CLAUDE.md`
  - 1 โปรเจกต์ = 1 โฟลเดอร์ = 1 git repo ห้าม import ข้ามโปรเจกต์
  - สร้างโปรเจกต์ใหม่: `/new-project <ชื่อ> <web|next|node|python|blank>`
  - ตรวจสุขภาพ: `/doctor-workspace`
  - แล้วค่อยถามว่าวันนี้จะทำอะไร
- ตอบและอธิบายเป็น **ภาษาไทย**
- ก่อนแก้โปรเจกต์ไหน อ่าน `CLAUDE.md` ของโปรเจกต์นั้นก่อน
- ห้ามแก้ไฟล์ข้ามโปรเจกต์ในงานเดียวโดยไม่บอกก่อน
- ห้ามแตะไฟล์/โฟลเดอร์ที่ root ที่ไม่เกี่ยวกับงานที่สั่ง
- ตรวจสุขภาพประเทศได้ด้วย `/doctor-workspace` หรือ `.workspace\bin\doctor.ps1`
- **ห้ามคิดชื่อโปรเจกต์เองเป็น default** ผู้ใช้คิดชื่อเอง ถ้าผู้ใช้อยากให้ช่วยคิด ต้องบอกชัดๆ
  ("ช่วยคิดชื่อ") ค่อยเสนอให้ — ส่วนชนิดโปรเจกต์ (`web`/`next`/`node`/`python`/`blank`) ยัง
  ให้ Claude เลือกเองตามที่คุยกันไว้เดิม
