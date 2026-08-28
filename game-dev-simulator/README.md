# game-dev-simulator

Roblox tycoon — เด็กธรรมดาผันตัวเป็น game dev ไต่จากศูนย์: สร้างเกม → ตระเวนขายตามคุณภาพ →
ปั้นทุนซื้อบริษัทเล็ก → จ้างพนักงาน → แข่งขันกับสตูดิโออื่น

## เริ่มใช้งาน

1. เปิด Roblox Studio เปิดโปรเจกต์ (place file)
2. `File → Studio Settings → Beta Features → enable MCP Server` (ฟัง `localhost:3004`)
3. ตั้งค่า MCP client (Claude Code) ให้ต่อ `localhost:3004` — ดูขั้นตอนใน `CLAUDE.md`
4. เปิด Studio ทิ้งไว้ตลอดที่ให้ Claude ทำงานกับโปรเจกต์นี้ (MCP เป็น session-based ต้องมี Studio รันอยู่)

## สถานะ

สร้างเมื่อ 2026-08-28 (สร้างใหม่แทนที่โปรเจกต์เดิมที่ใช้ Rojo-only ซึ่งยังว่างเปล่า) — โครงยังว่าง
รอเริ่มสร้างเกมผ่าน Studio built-in MCP
