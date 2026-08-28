const lines = [
  'ยินดีต้อนรับสู่ C:\\dev — เวิร์กสเปซอยู่ใต้ธรรมนูญ C:\\dev\\CLAUDE.md',
  '1 โปรเจกต์ = 1 โฟลเดอร์ = 1 git repo ห้าม import ข้ามโปรเจกต์',
  'สร้างโปรเจกต์ใหม่: /new-project <ชื่อ> <web|next|node|python|blank>',
  '  หรือ powershell -File .workspace\\bin\\new-project.ps1 -Name <ชื่อ> -Type <ชนิด>',
  'ตรวจสุขภาพ workspace: /doctor-workspace',
  'ตอบและอธิบายเป็นภาษาไทยเสมอ ตามธรรมนูญข้อ 8',
]

console.log(JSON.stringify({ systemMessage: lines.join('\n') }))
