//+------------------------------------------------------------------+
//| AdxEmaTypes.mqh                                                    |
//| enum ที่ input block ของ AdxEmaEA.mq5 ต้องใช้ก่อน #include Core       |
//+------------------------------------------------------------------+
#ifndef ADXEMA_TYPES_MQH
#define ADXEMA_TYPES_MQH

// โหมด TP ตามกฎ EA ข้อ 4 — ต้องมีครบ 3 แบบ default = Fix RR เสมอ (ไม่ partial-close,
// ตามที่ผู้ใช้ยืนยัน 2026-09-19 ว่าไม่ใช้ partial-close/BE ใน smart-ea)
enum ENUM_ADXEMA_TPMODE
{
   TPMODE_FIX_RR       = 0, // เป้าเดียว ปิดทีเดียว ไม่แบ่งปิด (default)
   TPMODE_FIX_MULTI_RR = 1, // แบ่งปิด TP1/TP2/TP3 ตาม R คงที่ (ใช้ partial-close จริง — เลือกเองถ้าต้องการ)
   TPMODE_DYNAMIC_RR   = 2  // เป้าเดียว แต่ระยะปรับตามความแรง ADX ตอนเข้าไม้ (ไม่ partial-close)
};

enum ENUM_RISK_MODE
{
   RISK_PERCENT_EQUITY = 0, // % ของ equity (ทบต้น)
   RISK_FIXED_USD       = 1  // จำนวนคงที่ USD ต่อไม้
};

#endif
