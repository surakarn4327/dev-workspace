# ทะเบียนราษฎร์ — โปรเจกต์ใน C:\dev

ตารางนี้ `new-project.ps1` เติมให้อัตโนมัติ แก้ด้วยมือได้ถ้าจำเป็น

| โปรเจกต์ | ชนิด | พอร์ต | เกิดเมื่อ | คำอธิบาย |
|---|---|---|---|---|
<!-- PROJECTS:START -->
| [trader-helper](trader-helper/) | next | 3000 | 2026-09-19 | Dashboard เทรด: journal, real-time trade feed, แจ้งเตือน — เชื่อมกับ smart-ea ผ่าน EA ยิง HTTP เข้ามาตรงๆ |
| [smart-ea](smart-ea/) | blank | - | 2026-09-04 | EA (Expert Advisor) เทรด forex บน Exness (MetaTrader) |
| [game-dev-simulator](game-dev-simulator/) | blank | - | 2026-08-28 | Roblox tycoon: dev ผันตัวจากศูนย์ - สร้างเกม, ขาย, ปั้นทุน, ซื้อบริษัท, จ้างคน, แข่งกับสตูดิโออื่น (ใช้ Studio built-in MCP แทน Rojo-only) |
| [claude-hooks](claude-hooks/) | blank | - | 2026-08-28 | hook ของ Claude Code ที่ใช้ร่วมกันทุกโปรเจกต์ — บังคับตั้งชื่อ session อัตโนมัติ |
| [smart-indicator](smart-indicator/) | blank | - | 2026-08-10 | TradingView Pine Script indicator ที่หา entry signal ตามเทคนิคเทรดของผู้ใช้เอง (ไม่ใช่ SMC) - plot signal บนกราฟ ไม่ auto-trade |
<!-- PROJECTS:END -->

## ช่วงพอร์ตที่กันไว้

- `3000–3099` — Next.js / เว็บที่มี server
- `5170–5199` — Vite / static dev server
- `8000–8099` — Python / API / backend
