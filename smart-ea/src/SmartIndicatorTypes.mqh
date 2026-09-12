//+------------------------------------------------------------------+
//| SmartIndicatorTypes.mqh                                            |
//| ชนิดข้อมูลที่ input ต้องใช้ จึงต้องประกาศก่อนบล็อก input ของ EA      |
//| (มิเรอร์ AmdPo3Types.mqh / MARibbonTypes.mqh)                       |
//+------------------------------------------------------------------+
#ifndef SMART_INDICATOR_TYPES_MQH
#define SMART_INDICATOR_TYPES_MQH

// เป้าหมายกำไร — สองโหมดที่ผู้ใช้ยืนยันให้ลองแยกกัน (2026-09-12) ห้ามผสมในรอบเดียว
enum ENUM_SI_TP_MODE
{
   SI_TP_R_MULTIPLE    = 0, // แบ่งปิดตาม R-multiple (TP1/TP2/TP3) เหมือน EA อื่นในโปรเจกต์นี้
   SI_TP_RANGE_TARGET  = 1  // เป้าเดียว = ฝั่งตรงข้ามของกรอบ CRT (CTH/CTL) — ไม่แบ่งปิด
};

enum ENUM_SI_RISK_MODE
{
   SI_RISK_PERCENT_EQUITY = 0, // % ของ equity ปัจจุบัน — ทบต้นอัตโนมัติ
   SI_RISK_FIXED_USD       = 1  // ทุนเสี่ยงคงที่เป็น USD ทุกไม้
};

// สถานะ CRT (Candle Range Theory) — มิเรอร์ state string ของ Pine ("none"/"swept"/"success"/"failed")
enum ENUM_CRT_STATE
{
   CRT_NONE    = 0, // ยังไม่เคย sweep หรือกรอบเดิมรู้ผลแล้ว รับแท่งคุมใหม่ได้
   CRT_SWEPT   = 1, // sweep สำเร็จแล้ว รอราคาไปแตะฝั่งตรงข้าม (success) หรือทะลุกลับ (failed)
   CRT_SUCCESS = 2, // ราคาไปแตะฝั่งตรงข้ามสำเร็จ — thesis จบแล้ว (ไม่ใช่ win rate ของการเทรด แค่ผลของ CRT filter)
   CRT_FAILED  = 3  // sweep แล้วทะลุกลับออกไปปิดค้างนอกกรอบ — thesis ล้มเหลว
};

// ฝั่งที่ถูก sweep — มิเรอร์ sweptSide ("low"/"high") ของ Pine
// sweep LOW (แท่งคุมแดง, กวาดใต้ CTL) = liquidity grab ฝั่งล่าง = bias ขึ้น (LONG, หา Demand zone)
// sweep HIGH (แท่งคุมเขียว, กวาดเหนือ CTH) = liquidity grab ฝั่งบน = bias ลง (SHORT, หา Supply zone)
enum ENUM_CRT_SIDE
{
   CRT_SIDE_NONE = 0,
   CRT_SIDE_LOW  = 1,
   CRT_SIDE_HIGH = 2
};

// กรอบ Demand (bullish FVG) / Supply (bearish FVG) — zone = แท่ง A ของ FVG มาตรฐานเต็มแท่ง (high-low)
// ที่ตรวจพบตามกลไก chain ใน demand_supply_zone.md (สลับกับ FVG ปกติไปเรื่อยๆ ไม่ใช่ทุก FVG ได้ zone)
struct SiZoneRec
{
   double top;         // = hA (ขอบเข้าของ Demand, ขอบ SL ของ Supply)
   double bottom;       // = lA (ขอบ SL ของ Demand, ขอบเข้าของ Supply)
   bool   bullish;      // true = Demand, false = Supply
   int    createdBar;   // gBarIndex ตอนสร้าง — ใช้เช็คหมดอายุ
   bool   entryUsed;     // เคยใช้เปิดไม้ไปแล้วหรือยัง (กันเปิดซ้ำจาก zone เดิม)
};

#endif
