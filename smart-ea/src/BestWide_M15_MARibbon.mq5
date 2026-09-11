//+------------------------------------------------------------------+
//| BestWide_M15_MARibbon.mq5                                          |
//| MA Ribbon EA ชุดที่ออกแบบมาเพื่อ "ถอนกำไรได้ทุกเดือน" โดยเฉพาะ       |
//|                                                                    |
//| ตรรกะเหมือน MARibbonEA ทุกอย่าง ใช้ MARibbonCore.mqh ร่วมกัน       |
//| ไฟล์นี้มีแต่บล็อก input ไม่มีตรรกะของตัวเอง                          |
//|                                                                    |
//| ค่าที่ตั้งไว้: ribbon EMA เลื่อน +10, SL = ATR(14) x 4.50,           |
//| แบ่งปิด 3 ไม้ย่อยที่ 2R / 3R / 5R, ไม่ใช้ BE, ปิดเมื่อสัญญาณกลับทิศ   |
//|                                                                    |
//| ต่างจาก BestM15_A..F ตรงไหน — และทำไมถึงดีกว่ามาก                  |
//| ชุดเก่าทั้งหมดใช้ SL แคบ (ATR 1.75-2.50) เพราะกริดที่ไล่ตอนนั้น      |
//| ไม่เคยไล่เกิน 3.0 เลย แต่ต้นทุนสเปรดต่อไม้ = ทุนเสี่ยง x (สเปรด /    |
//| ระยะ SL) ส่วนกำไรต่อไม้ = R x ทุนเสี่ยง ซึ่งไม่ขึ้นกับระยะ SL         |
//| **ขยาย SL จึงลดต้นทุนโดยไม่ลดกำไร** — ที่ ATR 1.75 สเปรดกินราว 9%   |
//| ของไม้ที่ชนะ พอมาที่ ATR 4.50 เหลือราว 4% ซึ่งเทียบกับ edge ดิบที่มี  |
//| อยู่แค่ ~12% ของทุนเสี่ยง ถือเป็นคนละเรื่องกันเลย                    |
//|                                                                    |
//| ผลบนช่วงที่ใช้จูน (ม.ค. - ธ.ค. 2568, ทุน 10,000 เสี่ยง 100/ไม้):     |
//|   509 ไม้, +4,462, ขาดทุนสูงสุด 1,250, PF 1.36, กำไร 10 จาก 12 เดือน|
//|                                                                    |
//| ผลบนช่วงตรวจสอบ (ม.ค. - ก.ย. 2569) ซึ่ง **ไม่ได้ใช้เลือกค่าใดๆ**     |
//| และรันด้วย **tick จริง** ไม่ใช่โมเดลปั้น:                            |
//|   265 ไม้ (29/เดือน), +3,465, ขาดทุนสูงสุด 959, PF 1.48            |
//|   กำไร 8 จาก 9 เดือน · ไม้ใหญ่สุด 13.5% ของกำไร                    |
//|   ขาดทุนสูงสุดคิดเป็นกำไรเพียง 2.5 เดือน                            |
//|   รายเดือน: +106 +437 +1040 −386 +175 +756 +644 +426 +269          |
//|                                                                    |
//| ผ่านเกณฑ์ "ถอนได้สม่ำเสมอ" 4 จาก 5 ข้อบนข้อมูลที่ไม่ได้ใช้จูน         |
//| ที่ไม่ผ่านคือ winrate (34% ไม่ถึง 50%) ซึ่ง **ผ่านไม่ได้โดยโครงสร้าง** |
//| วัดแล้วสองทาง: ระบบแบ่งปิดมี winrate ถูกกำหนดโดยไม้ที่ปล่อยวิ่ง      |
//| ดึง TP1 จาก 2R มา 0.5R ขยับ winrate แค่ 24% เป็น 31% ส่วนการปิด    |
//| ทั้งไม้ที่เป้าใกล้ได้ winrate 50-68% จริงแต่ PF ร่วงเหลือ 1.07-1.11   |
//| และขาดทุนสูงสุดพุ่งกลับไปเท่ากำไรราว 10 เดือน                       |
//|                                                                    |
//| คำเตือนก่อนใช้เงินจริง                                              |
//| ช่วงตรวจสอบยาวแค่ 9 เดือน สั้นกว่าที่ควรจะเป็นมาก และทั้งการจูนและ    |
//| การตรวจอยู่ในกรอบ 2568 เป็นต้นมาตามที่ผู้ใช้กำหนด (เหตุผล: ทองเปลี่ยน|
//| พฤติกรรมไปแล้ว ราคาขึ้นเกือบเท่าตัว) จึงยังไม่รู้ว่าทนได้แค่ไหนถ้าตลาด |
//| เปลี่ยนโหมดอีก — เริ่มที่ทุนเสี่ยงต่ำและรัน demo คู่ขนานก่อนเสมอ      |
//|                                                                    |
//| จูนมาสำหรับ XAUUSDm บน M15 เท่านั้น สัญลักษณ์หรือ timeframe อื่น    |
//| ต้องไล่หาค่าใหม่ (M5 ด้วย SL กว้างก็กำไรทุกชุดเหมือนกัน แต่ PF 1.06  |
//| เทียบกับ 1.24 ของ M15 จึงไม่คุ้ม)                                   |
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
input int InpRibbonShift = 10; // บวกเข้าทุกคาบเท่ากัน (เลื่อนทั้ง ribbon ช้า/เร็ว)

input group "จุดตัดขาดทุน (SL)"
input bool   InpUseAtrSL       = true; // คิด SL จาก ATR (ปิด = ใช้ swing high/low)
input int    InpAtrPeriod      = 14;   // คาบ ATR
input double InpAtrMult        = 4.50; // ตัวคูณ ATR
input int    InpSwingBars      = 10;   // ย้อนหลังหา high/low (แท่ง)
input int    InpSLBufferPoints = 50;   // ระยะเผื่อ SL (point ของสัญลักษณ์)

input group "จุดทำกำไร (TP)"
input ENUM_TP_MODE InpTPMode = TP_PARTIAL; // โหมด TP
input double InpRR1 = 2.0; // TP1 (R)
input double InpRR2 = 3.0; // TP2 (R)
input double InpRR3 = 5.0; // TP3 (R)

input group "จุดเสมอตัว (BE)"
input bool InpUseBE      = false; // แตะ TP1 แล้วเลื่อน SL มาที่จุดเข้า
input int  InpBELockPoints = 0;   // ล็อกกำไรเหนือจุดเข้า (point)

input group "เลื่อน SL ตามราคา (Trailing)"
input double InpTrailAtrMult = 0;  // ระยะ trail เป็นตัวคูณ ATR (0 = ปิด)
input int    InpTrailAfterTP = 1; // เริ่ม trail หลังแตะ TP ที่เท่าไร (1 หรือ 2)

input group "ความเสี่ยงและการเข้าออก"
input ENUM_RISK_MODE InpRiskMode = RISK_PERCENT_EQUITY; // โหมดทุนเสี่ยง: % ของ equity (ทบต้น) หรือคงที่ USD
input double InpRiskPct        = 1.0;  // ทุนเสี่ยงต่อไม้ เป็น % ของ equity (ใช้เมื่อ RiskMode = PercentEquity)
input double InpRiskPerTrade   = 100;  // ทุนเสี่ยงต่อไม้ คงที่ USD (ใช้เมื่อ RiskMode = FixedUsd)
input double InpRiskPointUnit  = 0.01; // ขนาด 1 จุดในสูตร lot (ราคา) — XAUUSD ใช้ 0.01
input bool   InpCloseOnOpposite = true; // สัญญาณกลับทิศแล้วปิดไม้เดิมทันที
input int    InpMagic          = 20260913; // magic number

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
