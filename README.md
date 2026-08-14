# smart-indicator

TradingView Pine Script indicator ที่หา entry signal ตามเทคนิคเทรดของผู้ใช้เอง (ไม่ใช่ SMC) - plot signal บนกราฟ ไม่ auto-trade รายละเอียดเทคนิคจะได้รับจากผู้ใช้ทีละสเต็ป

## เริ่มใช้งาน

ไม่มี dev server — เปิด TradingView, สร้าง Pine Script indicator ใหม่, วาง `src/smart-indicator.pine` ลงใน Pine Editor แล้ว Add to Chart

## โครงสร้าง

- `src/smart-indicator.pine` — indicator หลัก (CRT sweep engine + dashboard สถิติ)
- `style_crt.md` — style guide, ค่า default ที่ล็อกไว้, ประวัติการตัดสินใจ/สิ่งที่เคยลองแล้วยกเลิก

## สถานะ (อัปเดต 2026-08-13)

**เสร็จแล้ว:**
- เทคนิค CRT (candle range theory ของผู้ใช้เอง) — sweep/fail state machine ล็อกแล้ว, unify ผ่าน Pine `type`/`method`
- รองรับทั้งดู native TF (5m) และ HTF-chart mode (1H) ด้วย state machine เดียวกัน
- Visual: เส้น CTH/CTL แบบ erase-style, ✓/✗ mark ผลลัพธ์, วงกลมจุด sweep
- Dashboard สถิติ (สำเร็จ/ล้มเหลว/รวม/อัตรา, แยก BUY/SELL, ช่วงวันย้อนหลัง, ตำแหน่ง/ขนาดปรับได้)
- Settings UI ภาษาไทยทั้งหมด, ทุก visual element ซ่อน/โชว์ได้

**ยังไม่มี:** entry signal จริง — CRT ตอนนี้เป็นแค่ filter ด่านแรก (กรองว่า setup สำเร็จ/ล้มเหลว) ยังไม่ plot สัญญาณเข้าเทรดจริง

**ข้อจำกัดที่รู้อยู่แล้ว:** ตัวเลขสถิติไม่ synced ข้ามชาร์ต/timeframe (คนละ execution context) — รายละเอียดดู `style_crt.md`
