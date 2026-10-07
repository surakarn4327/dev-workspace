# wire-up

Virtual electronics lab: realistic circuit simulation with breadboard, instruments, Arduino and ESP32, plus mission-style lessons

## เริ่มใช้งาน

```bash
npm install
npm run dev -- --port 5173
```

เปิดที่ http://localhost:5173

```bash
npm run test    # solver + วงจรบน breadboard + เฉลยของทุก mission
npm run build   # tsc (strict) + vite build
```

## ทำอะไรได้ (v1 — วงจรไฟฟ้า)

- ลากชิ้นส่วนจาก toolbox ด้านซ้าย (แท็บ Power / Passive / Semis / Switches / Sensors / Meters / Boards)
- ต่อบน breadboard หรือลากสายอิสระบนจอเลยก็ได้ (ลากจากรูหรือขาชิ้นส่วนไปอีกจุด, กด `W` เพื่อลากสายจากจุดไหนก็ได้)
- ชิ้นส่วน: แบตเตอรี่ (1.5/3/4.5/9 V), bench supply (0–30 V + จำกัดกระแส), resistor (แถบสีอ่านค่าได้), LED 5 สี,
  diode, transistor NPN/PNP, สวิตช์ rocker, สวิตช์เลื่อน, ปุ่มกด, potentiometer, LDR, thermistor NTC, มัลติมิเตอร์ (V / A / Ω)
- ต่อผิด = ชิ้นส่วนพังจริง (ไหม้ มีควัน ต้อง Replace) พร้อมคำอธิบายเป็นตัวเลข เช่น "LED carried 1.25 A; max 30 mA"
- 9 mission แบบมือใหม่ (แท็บ Missions): เช็กลิสต์ตรวจจากการจำลองจริง + hint
- auto-save ใน browser + Export/Import ไฟล์ JSON (ไม่มีบัญชี ไม่มี server)

## คีย์ลัด

`W` โหมดลากสาย · `R` หมุน · `Del` ลบ · `F` fit · `Esc` ยกเลิก · ล้อเมาส์ซูม · `Shift`+ล้อเมาส์ปรับค่า
(pot / แสง / อุณหภูมิ / แรงดัน) · `Ctrl+Z` / `Ctrl+Y` undo / redo

สายแตกกิ่ง: ปลายสายที่วางทับกลางสายเส้นอื่น = เชื่อมและเปลี่ยนเป็นสีเส้นหลัก; ลบชิ้นส่วนที่สายลากมา สายกิ่งหายด้วย

เมาส์: ซ้าย = เลือก/ย้ายชิ้น/ลากสาย, **ลากซ้ายบนพื้นว่าง = เลื่อนจอ** (ปุ่มกลาง หรือ `Space`+ลากซ้าย ก็ได้),
**ลากขวา = กรอบเลือก** (ต้องคลุมทั้งชิ้น),
`Ctrl`+คลิกซ้าย = เพิ่ม/เอาออกจากที่เลือก (`Ctrl`+ลากขวา = เพิ่มกรอบเข้ากลุ่ม)
เลือกหลายชิ้น: `Ctrl+A` ทั้งหมด · ลากชิ้นใดชิ้นหนึ่งในกลุ่ม = ย้ายทั้งกลุ่ม · ลูกศร = ขยับทีละ 1 ช่อง grid ·
`Ctrl+C` / `Ctrl+V` คัดลอก/วาง · `Ctrl+D` ทำซ้ำ (ถ้ามี breadboard วางไว้ข้างๆ ไม่ทับ) · `Del` ลบทั้งกลุ่ม

## สถานะ

v1 ครบตามแผน (2026-10-07) — ยังไม่ทำ: บอร์ด Arduino/ESP32, Serial Monitor, โหมดบล็อก, WiFi จำลอง (v2)
