//+------------------------------------------------------------------+
//| AmdPo3Types.mqh                                                    |
//| ชนิดข้อมูลที่ input ต้องใช้ จึงต้องประกาศก่อนบล็อก input ของ EA      |
//| (มิเรอร์ MARibbonTypes.mqh)                                        |
//+------------------------------------------------------------------+
#ifndef AMDPO3_TYPES_MQH
#define AMDPO3_TYPES_MQH

// สถานะของ FSM — มิเรอร์ enum Phase ของ Pine ต้นฉบับ
// (idle → accum → sweepPending → manip(ชั่วคราวเสมอ) → dist → idle)
enum ENUM_PHASE
{
   PHASE_IDLE = 0,          // รอหาช่วงสะสม
   PHASE_ACCUM = 1,         // มีช่วงสะสมอยู่ รอการกวาดสภาพคล่อง
   PHASE_SWEEP_PENDING = 2, // กวาดแล้ว รอราคากลับเข้าช่วงภายในกำหนด
   PHASE_MANIP = 3,         // ยืนยันกวาดสำเร็จ — ตัดสินใจเปิดไม้ในบาร์เดียวกันเสมอ ไม่ค้ามข้ามบาร์
   PHASE_DIST = 4           // ไม้เปิดอยู่ รอ SL/TP/timeout
};

enum ENUM_BOUNDARY_MODE
{
   BOUNDARY_PIVOT = 0,     // ขอบเขตจาก pivot ที่ยืนยันแล้ว (สะอาดกว่า)
   BOUNDARY_ABSOLUTE = 1   // high/low ดิบของหน้าต่าง (ดุกว่า)
};

enum ENUM_RISK_MODE
{
   RISK_PERCENT_EQUITY = 0, // % ของ equity ปัจจุบัน — ทบต้นอัตโนมัติ (โต/หดตามพอร์ต)
   RISK_FIXED_USD       = 1  // ทุนเสี่ยงคงที่เป็น USD ทุกไม้ ไม่ว่า equity จะเป็นเท่าไร
};

#endif
