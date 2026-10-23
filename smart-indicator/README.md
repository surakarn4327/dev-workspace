# smart-indicator

TradingView Pine Script indicator ที่หา entry signal ตามเทคนิคเทรดของผู้ใช้เอง (ไม่ใช่ SMC) - plot signal บนกราฟ ไม่ auto-trade รายละเอียดเทคนิคจะได้รับจากผู้ใช้ทีละสเต็ป

## เริ่มใช้งาน

ไม่มี dev server — เปิด TradingView, สร้าง Pine Script indicator ใหม่, วาง `src/smart-indicator.pine` (และ/หรือ `src/msnr.pine` เป็น indicator อีกตัว) ลงใน Pine Editor แล้ว Add to Chart

## โครงสร้าง

- `src/smart-indicator.pine` — indicator หลัก (CRT sweep engine + FVG/iFVG engine + Demand/Supply zone + dashboard สถิติ, ทั้งหมดอยู่ในไฟล์เดียว)
- `src/msnr.pine` — indicator แยก: MSNR (Malaysian Support & Resistance) เส้น A/V/Gap + fresh/unfresh + SBR/RBS + แท่งยืนยัน (เพิ่มลง TradingView เป็นอีกตัว ใส่กราฟคู่กันได้)
- `msnr_technique.md` — กฎ MSNR ที่ implement จริง + preset
- `msnr_research.md` — บันทึกค้นคว้า MSNR จากแหล่งสาธารณะ (เวอร์ชันที่แหล่งขัดกัน)
- `src/msnr_sniper.pine` + `src/msnr_sniper_strategy.pine` — MSNR แบบ "sniper" ตามคลิปของผู้ใช้ (เส้น fresh → แตะ → MSS บนกราฟเล็ก → SL สั้น/TP ยอดย่อย) indicator กับสำเนา strategy สำหรับทดสอบ
- `msnr_sniper_technique.md` — กฎ + ตารางที่มาของทุกกฎ (คลิป / ตีความ / ผมคิดเอง)
- `msnr_video_notes.md` — สิ่งที่ได้ยินและเห็นจากคลิป (แคปเฟรม 1080p)
- `msnr_backtest.md` — ผลทดสอบของ `msnr.pine` ชุดเดิม (ไม่ใช่ชุด sniper)
- `indicator_style.md` — กฎหน้าตั้งค่า (input/group/UI), ค่า default ที่ล็อกไว้, ประวัติการตัดสินใจ/สิ่งที่เคยลองแล้วยกเลิก
- `crt_technique.md` — กฎเทคนิค CRT (sweep/pending/disqualify/state machine เต็มๆ)
- `fvg_technique.md` — กฎ/นิยาม FVG/iFVG
- `demand_supply_zone.md` — กฎ/นิยาม Demand/Supply zone (feature แยกจาก FVG, จับคู่ 1:1)
- `bugs.md` — log บั๊กที่เจอ+แก้จริงทุกครั้ง (ชื่อ/สาเหตุ/วิธีแก้) เปิดดูก่อนแก้จุดที่เคยมีปัญหา

## สถานะ (อัปเดต 2026-08-14)

**เสร็จแล้ว:**
- เทคนิค CRT (candle range theory ของผู้ใช้เอง) — sweep/fail state machine ล็อกแล้ว, unify ผ่าน Pine `type`/`method`
- รองรับทั้งดู native TF (5m) และ HTF-chart mode (1H) ด้วย state machine เดียวกัน
- FVG/iFVG (Fair Value Gap) — feature แสดงผลแยกจาก CRT, ตรวจจับได้หลายไทม์เฟรมพร้อมกัน
- Demand/Supply zone — สลับกับ FVG ไปเรื่อยๆ ตามที่ตรวจพบจริง (จับคู่ 1:1 กับ FVG), มีสถานะแตะ/ยืดกรอบ/ตัวอักษรในกรอบ
- Visual: ป้าย CTH/CTL ลอยเหนือ/ใต้เส้น (ตัวหนา, พิกเซลคงที่ไม่ขึ้นกับซูม), ✔/✘ mark ผลลัพธ์, วงกลมจุด sweep
- Dashboard สถิติ (สำเร็จ/ล้มเหลว/รวม/อัตรา, แยก BUY/SELL, ช่วงวันย้อนหลัง, ตำแหน่ง/ขนาดปรับได้)
- Settings UI ภาษาไทยทั้งหมด รวมเป็นกลุ่มใหญ่ตาม feature (เปิด/ปิด, เส้นปิดแท่ง, ตั้งค่า CRT, ตั้งค่า FVG, ตั้งค่า Demand/Supply), ทุก visual element ซ่อน/โชว์ได้

**ยังไม่มี:** entry signal จริง — CRT ตอนนี้เป็นแค่ filter ด่านแรก (กรองว่า setup สำเร็จ/ล้มเหลว) ยังไม่ plot สัญญาณเข้าเทรดจริง FVG/Demand-Supply เป็น feature แสดงผลแยก ไม่ได้ผูกเป็นตัวกรอง entry ร่วมกับ CRT

**ข้อจำกัดที่รู้อยู่แล้ว:** ตัวเลขสถิติไม่ synced ข้ามชาร์ต/timeframe (คนละ execution context) — รายละเอียดดู `crt_technique.md`
