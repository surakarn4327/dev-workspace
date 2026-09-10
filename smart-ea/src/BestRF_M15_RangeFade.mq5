//+------------------------------------------------------------------+
//| BestRF_M15_RangeFade.mq5                                           |
//| Range Fade EA ตั้งค่าตามชุดที่คัดมาจากการจูนบน XAUUSDm M15           |
//|                                                                    |
//| ตรรกะเหมือน RangeFadeEA ทุกอย่าง ใช้ RangeFadeCore.mqh ร่วมกัน     |
//| ไฟล์นี้มีแต่บล็อก input ไม่มีตรรกะของตัวเอง                          |
//|                                                                    |
//| ค่าที่ตั้งไว้: เข้าเมื่อราคาปิดห่างค่ากลาง 20 แท่งเกิน 3 sd            |
//| TP = 1.20 ATR, SL = 1.25 ATR, ปิดทิ้งเมื่อครบ 1 แท่ง                |
//| ไม่ใช้ตัวกรองเทรนด์ ไม่ใช้ RSI ไม่กรองช่วงเวลา ไม่รอแท่งกลับตัว        |
//|                                                                    |
//| ตัวกรองที่ไม่ได้ใช้ ไม่ได้ลืมใส่ — ลองแล้วไม่ช่วย: ช่วงเวลา 41 จาก 42  |
//| ช่วงกำไรทั้งนั้น และเกณฑ์ RSI ให้ผลเท่ากันเป๊ะกับไม่ใส่เลย จึงตัดออก    |
//| เพื่อไม่ให้มีพารามิเตอร์เกินจำเป็น เหลือของจริง 5 ตัว                  |
//+------------------------------------------------------------------+
#property strict
#include "RangeFadeTypes.mqh"

input group "การวัดการเหวี่ยง"
input int    InpBandPeriod = 20;   // คาบค่ากลาง (แท่ง)
input double InpBandDev    = 2.0;  // ตัวคูณ dev ของแบนด์ (ใช้ถอด sd เท่านั้น)
input double InpZEntry     = 3.0;  // ห่างค่ากลางกี่ sd จึงเข้าไม้

input group "จุดทำกำไรและจุดตัดขาดทุน"
input ENUM_RF_TP InpTPMode = RF_TP_ATR; // เป้าทำกำไร
input double InpTPMult     = 1.20; // ตัวคูณ TP (ATR หรือ R ตามโหมด)
input double InpMinTPAtr   = 0.5;  // โหมดค่ากลาง: TP ต่ำสุดกี่ ATR
input int    InpAtrPeriod  = 14;   // คาบ ATR
input double InpAtrSLMult  = 1.25; // ตัวคูณ ATR ของ SL
input int    InpMaxBars    = 1;    // ถือเกินกี่แท่งให้ปิดทิ้ง (0 = ไม่จำกัด)

input group "ตัวกรอง"
input ENUM_RF_TREND InpTrendMode = RF_TREND_OFF; // กรองด้วยเทรนด์ระยะยาว
input int  InpTrendPeriod = 200;  // คาบ EMA ที่ใช้เป็นเทรนด์
input bool InpUseRSI      = false;// กรองด้วย RSI ด้วย
input int  InpRSIPeriod   = 14;   // คาบ RSI
input int  InpRSILow      = 30;   // ซื้อได้เมื่อ RSI ต่ำกว่านี้
input int  InpRSIHigh     = 70;   // ขายได้เมื่อ RSI สูงกว่านี้
input bool InpNeedTurn    = false;// รอแท่งล่าสุดหันกลับก่อนเข้า
input int  InpCooldownBars = 0;   // ปิดไม้แล้วพักกี่แท่งก่อนเข้าใหม่
input int  InpHourFrom    = 0;    // ชั่วโมงเริ่มเทรด (เท่ากับ InpHourTo = ไม่กรอง)
input int  InpHourTo      = 0;    // ชั่วโมงสิ้นสุด

input group "ความเสี่ยง"
input double InpRiskPerTrade  = 100;  // ทุนเสี่ยงต่อไม้ (USD)
input double InpRiskPointUnit = 0.01; // ขนาด 1 จุดในสูตร lot (ราคา) — XAUUSD ใช้ 0.01
input int    InpMagic         = 20260912; // magic number

input group "เกณฑ์ให้คะแนนตอน optimize"
input int    InpMinTrades  = 100; // ไม้ขั้นต่ำ ต่ำกว่านี้ให้คะแนน 0
input double InpMinProfit  = 0;   // กำไรสุทธิขั้นต่ำ ต่ำกว่านี้ให้คะแนน 0
input bool   InpDumpPasses = true;// เขียนผลทุก pass ลงไฟล์ Common\rangefade_opt\

#include "RangeFadeCore.mqh"
