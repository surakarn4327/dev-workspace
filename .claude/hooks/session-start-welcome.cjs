const root = process.env.CLAUDE_PROJECT_DIR || process.cwd()

const lines = [
  `ยินดีต้อนรับสู่ workspace ${root} — อยู่ใต้ธรรมนูญ CLAUDE.md`,
  'dev-workspace เป็น monorepo เดียว 1 โปรเจกต์ = 1 โฟลเดอร์ (ไม่มี .git ซ้อน) ห้าม import ข้ามโปรเจกต์',
  'สร้างโปรเจกต์ใหม่: /new-project <ชื่อ> <web|next|node|python|blank>',
  '  หรือ powershell -File .workspace\\bin\\new-project.ps1 -Name <ชื่อ> -Type <ชนิด>',
  'ตรวจสุขภาพ workspace: /doctor-workspace',
  'ตอบและอธิบายเป็นภาษาไทยเสมอ ตามธรรมนูญข้อ 8',
]

console.log(JSON.stringify({ systemMessage: lines.join('\n') }))
