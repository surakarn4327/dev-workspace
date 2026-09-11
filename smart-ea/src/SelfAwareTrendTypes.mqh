//+------------------------------------------------------------------+
//| SelfAwareTrendTypes.mqh                                            |
//| enum ที่บล็อก input ของ SelfAwareTrendEA ต้องใช้ จึง include ก่อนเสมอ  |
//+------------------------------------------------------------------+
#ifndef SELFAWARE_TREND_TYPES_MQH
#define SELFAWARE_TREND_TYPES_MQH

// มิเรอร์ presetInput ของ Pine ("Auto" เลือกตาม timeframe ให้เอง)
enum ENUM_SATS_PRESET
{
   SATS_AUTO = 0,     // Auto — <=5 นาที Scalping, <=4 ชม. Default, ช้ากว่านั้น Swing
   SATS_CUSTOM = 1,   // Custom — ใช้ค่าที่กรอกเองทั้งหมด
   SATS_SCALPING = 2,
   SATS_DEFAULT = 3,
   SATS_SWING = 4,
   SATS_CRYPTO = 5
};

enum ENUM_SATS_TPMODE
{
   SATS_TP_FIXED = 0,   // R คงที่ตามที่ตั้ง
   SATS_TP_DYNAMIC = 1  // R ปรับตาม TQI + volatility regime
};

enum ENUM_SATS_RISK
{
   SATS_RISK_PCT = 0,   // % ของ equity (ทบต้น)
   SATS_RISK_USD = 1    // USD คงที่ต่อไม้
};

#endif
