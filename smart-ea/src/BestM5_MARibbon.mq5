//+------------------------------------------------------------------+
//| BestM5_MARibbon.mq5                                                |
//| MA Ribbon EA ที่ตั้งค่าไว้ตามชุดที่ชนะบน XAUUSDm M5                  |
//|                                                                    |
//| ตรรกะเหมือน MARibbonEA ทุกอย่าง — ใช้ MARibbonCore.mqh ร่วมกัน      |
//| ต่างกันแค่ค่า default ไฟล์นี้จึงมีแต่บล็อก input ไม่มีตรรกะของตัวเอง   |
//| แก้บั๊กที่ core ที่เดียว EA ทั้งสองตัวได้รับผลพร้อมกัน                 |
//|                                                                    |
//| ค่าที่ตั้งไว้มาจากการไล่ทดสอบ 108 ชุดบนข้อมูล 1 ปี                    |
//| (10 ก.ย. 2568 - 8 ก.ย. 2569, ทุน 10,000 USD, เสี่ยง 100 USD ต่อไม้)  |
//|                                                                    |
//|   ribbon เลื่อน -4, เส้น SMMA, SL = ATR x 2.25, ไม่ใช้ TP, BE ปิด    |
//|   1,666 ไม้, กำไร +16,923, ขาดทุนสูงสุด 4,212, PF 1.21              |
//|                                                                    |
//| ผ่านการตรวจทานแบบแบ่งครึ่งปีแล้ว กำไรทั้งสองครึ่ง (PF 1.19 และ 1.22) |
//|                                                                    |
//| ข้อควรรู้ก่อนใช้เงินจริง                                             |
//| - ขาดทุนสูงสุด 4,212 คือ 42% ของพอร์ต 10,000 ที่ใช้ทดสอบ            |
//|   ถ้ารับได้น้อยกว่านั้น ต้องลด InpRiskPerTrade ลงตามส่วน            |
//| - ขาดทุนสูงสุดในอดีตมักต่ำกว่าที่เจอจริง เผื่อไว้ 1.5-2 เท่าเสมอ       |
//| - ตัวเลขทั้งหมดมาจาก tick ที่ MT5 ปั้นจากแท่ง M1 ยังไม่เคยทดสอบด้วย  |
//|   tick จริง และยังไม่เคยทดสอบบนข้อมูลก่อนปี 2568                    |
//| - จูนมาสำหรับ XAUUSDm บน M5 เท่านั้น สัญลักษณ์หรือ timeframe อื่น    |
//|   ต้องไล่หาค่าใหม่ ห้ามใช้ค่าชุดนี้ตรงๆ                               |
//+------------------------------------------------------------------+
#property strict
#include "MARibbonTypes.mqh"

input group "เส้นค่าเฉลี่ย (Ribbon)"
input ENUM_MA_METHOD InpMAMethod = MODE_SMMA; // ชนิดค่าเฉลี่ย (SMMA = RMA ของ Pine)
input int InpS1 = 5;   // เส้นสั้น 1
input int InpS2 = 8;   // เส้นสั้น 2
input int InpS3 = 11;  // เส้นสั้น 3
input int InpS4 = 14;  // เส้นสั้น 4
input int InpS5 = 17;  // เส้นสั้น 5
input int InpS6 = 20;  // เส้นสั้น 6
input int InpL1 = 30;  // เส้นยาว 1
input int InpL2 = 35;  // เส้นยาว 2
input int InpL3 = 40;  // เส้นยาว 3
input int InpL4 = 45;  // เส้นยาว 4
input int InpL5 = 50;  // เส้นยาว 5
input int InpL6 = 55;  // เส้นยาว 6
input int InpL7 = 60;  // เส้นยาว 7
input int InpRibbonShift = -4; // บวกเข้าทุกคาบเท่ากัน (เลื่อนทั้ง ribbon ช้า/เร็ว)

input group "จุดตัดขาดทุน (SL)"
input bool   InpUseAtrSL       = true; // คิด SL จาก ATR (ปิด = ใช้ swing high/low)
input int    InpAtrPeriod      = 14;   // คาบ ATR
input double InpAtrMult        = 2.25; // ตัวคูณ ATR
input int    InpSwingBars      = 10;   // ย้อนหลังหา high/low (แท่ง)
input int    InpSLBufferPoints = 0;    // ระยะเผื่อ SL (point ของสัญลักษณ์)

input group "จุดทำกำไร (TP)"
input ENUM_TP_MODE InpTPMode = TP_NONE; // โหมด TP
input double InpRR1 = 2.0; // TP1 (R)
input double InpRR2 = 3.0; // TP2 (R)
input double InpRR3 = 4.0; // TP3 (R)

input group "จุดเสมอตัว (BE)"
input bool InpUseBE      = false; // แตะ TP1 แล้วเลื่อน SL มาที่จุดเข้า
input int  InpBELockPoints = 0;   // ล็อกกำไรเหนือจุดเข้า (point)

input group "ความเสี่ยงและการเข้าออก"
input double InpRiskPerTrade   = 100;  // ทุนเสี่ยงต่อไม้ (USD)
input double InpRiskPointUnit  = 0.01; // ขนาด 1 จุดในสูตร lot (ราคา) — XAUUSD ใช้ 0.01
input bool   InpCloseOnOpposite = true; // สัญญาณกลับทิศแล้วปิดไม้เดิมทันที
input int    InpMagic          = 20260910; // magic number

input group "เกณฑ์ให้คะแนนตอน optimize"
input int    InpMinTrades  = 100;  // ไม้ขั้นต่ำ ต่ำกว่านี้ให้คะแนน 0
input double InpMinProfit  = 0;    // กำไรสุทธิขั้นต่ำ ต่ำกว่านี้ให้คะแนน 0
input bool   InpDumpPasses = false; // เขียนผลทุก pass ลงไฟล์ Common\ribbon_opt\

input group "ทบกำไรไม้ถัดไป (all-in 1 ชั้น)"
input bool InpUseParlay = false; // เปิดโหมดทบกำไร
input bool InpParlayFallbackBase = true; // margin ไม่พอ ให้ถอยไปใช้ทุนฐานแทนการข้ามไม้

input group "การแสดงผลบนชาร์ต (เหมือน Pine)"
input bool  InpShowVisuals = true;          // วาดเส้นกลุ่ม MA + ลูกศร + เส้น Entry/SL/TP
input bool  InpShowPanel   = true;          // แสดงพาเนลสรุป
input ENUM_PANEL_POS InpPanelPos = PANEL_BOTTOM_LEFT; // มุมที่วางพาเนล
input color InpColEntry    = C'30,144,255'; // สี Entry
input color InpColSL       = C'255,69,0';   // สี SL
input color InpColTP1      = C'50,205,50';  // สี TP1
input color InpColTP2      = C'46,139,87';  // สี TP2
input color InpColTP3      = C'0,160,0';    // สี TP3
input color InpColPanel    = clrWhite;      // สีตัวหนังสือพาเนล
input int   InpPanelSize   = 9;             // ขนาดตัวหนังสือพาเนล

#include "MARibbonCore.mqh"
