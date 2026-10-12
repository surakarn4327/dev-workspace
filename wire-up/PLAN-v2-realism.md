# แผน: ทำให้ Arduino เหมือนของจริง (ชุด 1 → 2 → 3)

สถานะตอนเขียน (2026-10-12): Uno + ตัวรัน C++ ชุดย่อย + หน้าต่างโค้ดเสร็จและ commit แล้ว
ผู้ใช้เลือกทำ **ทีละชุด** — เริ่มจากชุด 1 ใน session ใหม่ อ่านย่อหน้า "ตัวรันโค้ด Arduino" ใน `CLAUDE.md` ก่อน

## ชุด 1 — ภาษา C++ ให้ครบ (`src/mcu/`) — เสร็จ 2026-10-12 (ทุกข้อ + `examples.test.ts`)
ทุกข้อต้องมีเทสต์ใน `src/mcu/mcu.test.ts` และ compile error ที่เคยบอกว่า "ยังไม่รองรับ" ต้องหายไป

| ข้อ | งาน | ไฟล์หลัก |
|---|---|---|
| 1 | `bitRead` `bitWrite` `bitSet` `bitClear` `bit` `lowByte` `highByte` | compile.ts |
| 2 | `shiftOut` `shiftIn` (ใช้ digitalWrite/Read ภายใน) | compile.ts / vm.ts |
| 3 | `tone` `noTone` (พินส่งคลื่นสี่เหลี่ยมตามความถี่ + บัซเซอร์ทดสอบ) | vm.ts + simulation |
| 4 | `pulseIn` (วัดเวลาพินสูง/ต่ำ รอ timeout) | vm.ts |
| 5 | อาร์เรย์ 2 มิติ | lang.ts, compile.ts |
| 6 | `#define` แบบฟังก์ชัน (`#define SQ(x) ((x)*(x))`) | lang.ts |
| 7 | `EEPROM.read/write/update` (เก็บใน param ของบอร์ด, เซฟลงไฟล์) | vm.ts + mcuBoards.ts |
| 8 | `struct` พื้นฐาน, `const`/`static`, `byte`/`unsigned`/`long` ครบ, `PROGMEM`/`F()` ผ่านเฉยๆ | lang.ts, compile.ts |
| 9 | `Serial.printf`-ไม่มีใน AVR จริง → ห้ามเพิ่ม; `Serial.print(x, HEX/BIN/DEC)` และ `println` ทุก overload ให้ตรงของจริง | vm.ts |

เสร็จเมื่อ: sketch ตัวอย่างมาตรฐาน (Blink, Fade, AnalogReadSerial, Button, DigitalReadSerial, Debounce, toneMelody, ShiftOut, EEPROM Read/Write) คอมไพล์ผ่านและทำงานถูก — เพิ่มเป็นชุดเทสต์ `examples.test.ts`

## ชุด 2 — ฮาร์ดแวร์ให้ตรงของจริง — ข้อ 1, 2, 3, 5 เสร็จ 2026-10-12; ข้อ 4 (VIN + แจ็ค DC) รอผู้ใช้เลือกภาพอ้างอิงตาม PARTS.md
1. `analogWrite` ทำงานเฉพาะขา PWM (3 5 6 9 10 11) — ขาอื่นเป็น HIGH/LOW ตาม >=128 เหมือนของจริง
2. `attachInterrupt` / `detachInterrupt` ขา 2, 3 (RISING/FALLING/CHANGE/LOW) — VM ต้องขัดจังหวะได้
3. เวลาตามรอบ AVR จริง (ตารางรอบต่อคำสั่ง, `digitalWrite` ~ 5 µs ตามของจริง) แทนค่าประมาณ
4. VIN + แจ็ค DC (7–12 V ผ่านรีกูเลเตอร์ 5 V, ร้อน/ไหม้เกิน 12 V) — ต้องทำตาม PARTS.md
5. ความถี่ PWM จริง (490/980 Hz) ให้ LED/มอเตอร์ที่ไวต่อความถี่เห็นผล

## ชุด 3 — ไลบรารีมาตรฐาน
1. `Servo` (`attach/write/read/detach`) + ชิ้นส่วน servo ในกล่อง (ต้องผ่าน PARTS.md: อ้างอิงภาพจริงก่อน)
2. `Wire` (I2C master) + ตัวจำลองบัส I2C ใน solver ระดับตรรกะ
3. `LiquidCrystal_I2C` + ชิ้นส่วนจอ LCD 16×2 (ต่อกับ Wire)

## กติกา (ห้ามลืม)
- ชิ้นส่วนใหม่ทุกชิ้นตาม `PARTS.md` + `style.md`; draft จนผู้ใช้อนุมัติ
- ทำเสร็จแต่ละชุด: tsc + vitest รอบเดียว, อัปเดต `CLAUDE.md` ย่อหน้าตัวรันโค้ด (ลบรายการ "ยังไม่รองรับ" ที่ทำแล้ว) + `README.md`
- commit ทีละชุด ไม่ push จนผู้ใช้สั่ง
