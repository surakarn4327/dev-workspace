//+------------------------------------------------------------------+
//| RangeFadeEA.mq5                                                    |
//| EA สวนการเหวี่ยง — ออกแบบมาเพื่อ "ถอนกำไรได้ทุกเดือน" ไม่ใช่กำไรสูงสุด |
//|                                                                    |
//| เข้าไม้เมื่อราคาปิดห่างจากค่ากลางเกิน InpZEntry ส่วนเบี่ยงเบนมาตรฐาน   |
//| ออกที่ค่ากลาง / ATR / R ตามโหมด SL จาก ATR และมีเวลาหมดอายุเป็นแท่ง   |
//|                                                                    |
//| ตรรกะทั้งหมดอยู่ใน RangeFadeCore.mqh ไฟล์นี้มีแต่บล็อก input          |
//+------------------------------------------------------------------+
#property strict
#include "RangeFadeTypes.mqh"

input group "การวัดการเหวี่ยง"
input int    InpBandPeriod = 40;   // คาบค่ากลาง (แท่ง)
input double InpBandDev    = 2.0;  // ตัวคูณ dev ของแบนด์ (ใช้ถอด sd เท่านั้น)
input double InpZEntry     = 2.0;  // ห่างค่ากลางกี่ sd จึงเข้าไม้

input group "จุดทำกำไรและจุดตัดขาดทุน"
input ENUM_RF_TP InpTPMode = RF_TP_ATR; // เป้าทำกำไร
input double InpTPMult     = 1.0;  // ตัวคูณ TP (ATR หรือ R ตามโหมด)
input double InpMinTPAtr   = 0.5;  // โหมดค่ากลาง: TP ต่ำสุดกี่ ATR
input int    InpAtrPeriod  = 14;   // คาบ ATR
input double InpAtrSLMult  = 2.0;  // ตัวคูณ ATR ของ SL
input int    InpMaxBars    = 24;   // ถือเกินกี่แท่งให้ปิดทิ้ง (0 = ไม่จำกัด)

input group "ตัวกรอง"
input ENUM_RF_TREND InpTrendMode = RF_TREND_OFF; // กรองด้วยเทรนด์ระยะยาว
input int  InpTrendPeriod = 200;  // คาบ EMA ที่ใช้เป็นเทรนด์
input bool InpUseRSI      = false;// กรองด้วย RSI ด้วย
input int  InpRSIPeriod   = 14;   // คาบ RSI
input int  InpRSILow      = 30;   // ซื้อได้เมื่อ RSI ต่ำกว่านี้
input int  InpRSIHigh     = 70;   // ขายได้เมื่อ RSI สูงกว่านี้
input bool InpNeedTurn    = true; // รอแท่งล่าสุดหันกลับก่อนเข้า
input int  InpCooldownBars = 0;   // ปิดไม้แล้วพักกี่แท่งก่อนเข้าใหม่
input int  InpHourFrom    = 0;    // ชั่วโมงเริ่มเทรด (เท่ากับ InpHourTo = ไม่กรอง)
input int  InpHourTo      = 0;    // ชั่วโมงสิ้นสุด

input group "ความเสี่ยง"
input double InpRiskPerTrade  = 100;  // ทุนเสี่ยงต่อไม้ (USD)
input double InpRiskPointUnit = 0.01; // ขนาด 1 จุดในสูตร lot (ราคา) — XAUUSD ใช้ 0.01
input int    InpMagic         = 20260911; // magic number

input group "เกณฑ์ให้คะแนนตอน optimize"
input int    InpMinTrades  = 100; // ไม้ขั้นต่ำ ต่ำกว่านี้ให้คะแนน 0
input double InpMinProfit  = 0;   // กำไรสุทธิขั้นต่ำ ต่ำกว่านี้ให้คะแนน 0
input bool   InpDumpPasses = true;// เขียนผลทุก pass ลงไฟล์ Common\rangefade_opt\

#include "RangeFadeCore.mqh"
