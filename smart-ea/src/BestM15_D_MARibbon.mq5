//+------------------------------------------------------------------+
//| BestM15_D_MARibbon.mq5
//| MA Ribbon EA ตั้งค่าตามชุดที่คัดมาจากการจูนบน XAUUSDm M15           |
//|                                                                    |
//| ตรรกะเหมือน MARibbonEA ทุกอย่าง ใช้ MARibbonCore.mqh ร่วมกัน       |
//| ไฟล์นี้มีแต่บล็อก input ไม่มีตรรกะของตัวเอง                          |
//|                                                                    |
//| ค่าที่ตั้งไว้: SL = swing high/low ย้อน 10 แท่ง, TP ปิดครั้งเดียวที่ 5R, BE เปิดที่ 2R, ribbon SMMA เลื่อน +15
//|                                                                    |
//| ทำไมถึงเลือกชุดนี้: กลไก SL คนละแบบกับ A/B/C ซึ่งใช้ ATR หมด และเป็นตัวเดียวที่มีทั้ง TP และ BE
//|                                                                    |
//| ผลบนช่วงที่ใช้จูน (10 ก.ย. 2568 - 8 ก.ย. 2569, ทุน 10,000 USD,     |
//| เสี่ยง 100 USD ต่อไม้): 149 ไม้, กำไร +5,391, ขาดทุนสูงสุด 1,209, PF 1.69
//|                                                                    |
//| ข้อควรระวังเฉพาะตัวนี้: เข้าไม้แค่ 149 ครั้งต่อปี กลุ่มตัวอย่างเล็ก ตัวเลขจึงเหวี่ยงง่ายกว่าตัวอื่น
//|                                                                    |
//| คำเตือนที่ใช้กับทุกชุดในโปรเจกต์นี้                                   |
//| ตัวเลขด้านบนมาจากปีที่ใช้คัดค่าชุดนี้มาเอง จึงเป็นขอบบน ไม่ใช่ค่าที่   |
//| คาดหวังได้ ชุด M15 ที่เคยทดสอบบน 3 ปีก่อนหน้าที่ไม่เคยใช้จูน ได้     |
//| +3,589 / -3,871 / +1,478 คือรวมสามปีแค่ +1,196 และขาดทุนสูงสุดจริง  |
//| อยู่ราว 4,200-5,500 ไม่ใช่หลักพันต้นๆ อย่างที่เห็นในปีที่จูน           |
//|                                                                    |
//| ยังไม่ได้ทดสอบชุดนี้นอกช่วงจูน ถ้าจะใช้จริงควรทดสอบก่อน และลด        |
//| InpRiskPerTrade ให้ขาดทุนสูงสุดที่รับได้จริงไม่เกิน 10-15% ของพอร์ต   |
//|                                                                    |
//| จูนมาสำหรับ XAUUSDm บน M15 เท่านั้น                                 |
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
input int InpRibbonShift = 15; // บวกเข้าทุกคาบเท่ากัน (เลื่อนทั้ง ribbon ช้า/เร็ว)

input group "จุดตัดขาดทุน (SL)"
input bool   InpUseAtrSL = false; // คิด SL จาก ATR (ปิด = ใช้ swing high/low)
input int    InpAtrPeriod      = 14;   // คาบ ATR
input double InpAtrMult = 1.5; // ตัวคูณ ATR
input int    InpSwingBars      = 10;   // ย้อนหลังหา high/low (แท่ง)
input int    InpSLBufferPoints = 0;    // ระยะเผื่อ SL (point ของสัญลักษณ์)

input group "จุดทำกำไร (TP)"
input ENUM_TP_MODE InpTPMode = TP_FINAL_ONLY; // โหมด TP
input double InpRR1 = 2.0; // TP1 (R)
input double InpRR2 = 2.0; // TP2 (R)
input double InpRR3 = 5.0; // TP3 (R)

input group "จุดเสมอตัว (BE)"
input bool InpUseBE = true; // แตะ TP1 แล้วเลื่อน SL มาที่จุดเข้า
input int  InpBELockPoints = 0;   // ล็อกกำไรเหนือจุดเข้า (point)

input group "ความเสี่ยงและการเข้าออก"
input double InpRiskPerTrade   = 100;  // ทุนเสี่ยงต่อไม้ (USD)
input double InpRiskPointUnit  = 0.01; // ขนาด 1 จุดในสูตร lot (ราคา) — XAUUSD ใช้ 0.01
input bool   InpCloseOnOpposite = true; // สัญญาณกลับทิศแล้วปิดไม้เดิมทันที
input int    InpMagic          = 20260914; // magic number

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
