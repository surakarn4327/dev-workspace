//+------------------------------------------------------------------+
//| MARibbonEA.mq5                                                     |
//| พอร์ตจาก Pine "MA Ribbon Signal + Stats" มาเป็น EA เพื่อ backtest   |
//| ใน Strategy Tester ของ MT5                                          |
//|                                                                    |
//| สัญญาณ: ค่าเฉลี่ยของกลุ่มเส้นสั้น (6 เส้น) ตัดค่าเฉลี่ยของกลุ่มเส้นยาว |
//| (7 เส้น) — ตัดขึ้น = BUY, ตัดลง = SELL คิดบนแท่งที่ปิดแล้วเท่านั้น    |
//| SL: ATR x ตัวคูณ หรือ swing high/low + ระยะเผื่อ                     |
//| TP: TP1/TP2/TP3 เป็นตัวคูณ R ของระยะ SL                             |
//| BE: แตะ TP1 แล้วเลื่อน SL มาที่จุดเข้า (+ ระยะล็อกกำไร)               |
//| Lot: ทุนเสี่ยงต่อไม้ / (ระยะ SL คิดเป็นจุด)                          |
//|                                                                    |
//| ต่างจาก Pine อย่างไร (อ่านก่อนเทียบตัวเลข):                          |
//| - Pine เดินไม้ทีละแท่งด้วย high/low และเมื่อแท่งเดียวแตะทั้ง SL และ TP |
//|   จะให้ SL ชนะ (มองแง่ร้าย) EA นี้วาง SL/TP จริงไว้ที่ broker จึงถูก  |
//|   ยิงระหว่างแท่ง ผลจึงขึ้นกับโมเดล tick ที่เลือกใน Strategy Tester    |
//| - Pine บันทึกผลไม้เป็น "R ของระดับสูงสุดที่เคยแตะ" ทั้งไม้ ส่วน EA    |
//|   ปิดของจริง โหมด partial จึงได้กำไรเฉลี่ยต่ำกว่าตัวเลขในแดชบอร์ด Pine|
//+------------------------------------------------------------------+
#property strict
#include "MARibbonTypes.mqh"

input group "เส้นค่าเฉลี่ย (Ribbon)"
input ENUM_MA_METHOD InpMAMethod = MODE_EMA; // ชนิดค่าเฉลี่ย (SMMA = RMA ของ Pine)
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
input int InpRibbonShift = 0; // บวกเข้าทุกคาบเท่ากัน (เลื่อนทั้ง ribbon ช้า/เร็ว)

input group "จุดตัดขาดทุน (SL)"
input bool   InpUseAtrSL       = true; // คิด SL จาก ATR (ปิด = ใช้ swing high/low)
input int    InpAtrPeriod      = 14;   // คาบ ATR
input double InpAtrMult        = 1.5;  // ตัวคูณ ATR
input int    InpSwingBars      = 10;   // ย้อนหลังหา high/low (แท่ง)
input int    InpSLBufferPoints = 500;  // ระยะเผื่อ SL (point ของสัญลักษณ์)

input group "จุดทำกำไร (TP)"
input ENUM_TP_MODE InpTPMode = TP_PARTIAL; // โหมด TP
input double InpRR1 = 2.0; // TP1 (R)
input double InpRR2 = 3.0; // TP2 (R)
input double InpRR3 = 4.0; // TP3 (R)

input group "จุดเสมอตัว (BE)"
input bool InpUseBE      = true; // แตะ TP1 แล้วเลื่อน SL มาที่จุดเข้า
input int  InpBELockPoints = 0;  // ล็อกกำไรเหนือจุดเข้า (point)

input group "ความเสี่ยงและการเข้าออก"
input double InpRiskPerTrade   = 400;  // ทุนเสี่ยงต่อไม้ (USD)
input double InpRiskPointUnit  = 0.01; // ขนาด 1 จุดในสูตร lot (ราคา) — XAUUSD ใช้ 0.01
input bool   InpCloseOnOpposite = true; // สัญญาณกลับทิศแล้วปิดไม้เดิมทันที
input int    InpMagic          = 20260909; // magic number

input group "เกณฑ์ให้คะแนนตอน optimize"
input int    InpMinTrades  = 100;  // ไม้ขั้นต่ำ ต่ำกว่านี้ให้คะแนน 0
input double InpMinProfit  = 0;    // กำไรสุทธิขั้นต่ำ ต่ำกว่านี้ให้คะแนน 0
input bool   InpDumpPasses = true; // เขียนผลทุก pass ลงไฟล์ Common\ribbon_opt\

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
