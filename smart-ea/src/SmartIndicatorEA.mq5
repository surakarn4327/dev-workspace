//+------------------------------------------------------------------+
//| SmartIndicatorEA.mq5                                               |
//| พอร์ตจาก Pine "Smart Indicator" (โปรเจกต์พี่น้อง ../smart-indicator — |
//| อ่านโค้ด/เอกสารเทคนิคแล้วเขียนซ้ำที่นี่ ห้าม import ข้ามโฟลเดอร์)      |
//|                                                                    |
//| ตรรกะ: CRT sweep (Candle Range Theory) บอกทิศทาง (sweep ใต้กรอบของ    |
//| แท่งคุมแดง = bias ขึ้น, sweep เหนือกรอบของแท่งคุมเขียว = bias ลง) +    |
//| Demand/Supply zone (จาก FVG มาตรฐานที่สลับกับ zone ตาม chain) เป็น     |
//| จุดเข้าที่แม่นกว่า — ผู้ใช้ยืนยันให้รวมสองส่วนนี้เป็นสัญญาณเดียว        |
//| (2026-09-12) ส่วน FVG/iFVG เป็น feature แสดงผลอย่างเดียวใน Pine ต้นฉบับ|
//| (ไม่ผูก logic กับอะไรเลย) จึงไม่พอร์ตมาที่นี่                          |
//|                                                                    |
//| ทดสอบ TP สองแบบแยกกันตาม InpTpMode: R-multiple (แบ่งปิด, เหมือน EA    |
//| อื่นในโปรเจกต์นี้) กับ range-target (เป้าเดียว = ฝั่งตรงข้ามของกรอบ CRT)|
//| ห้ามผสมสองแบบในรอบเดียว (ตกลงกับผู้ใช้ 2026-09-12)                    |
//+------------------------------------------------------------------+
#property strict
#include "SmartIndicatorTypes.mqh"

input group "CRT (ทิศทาง)"
input ENUM_TIMEFRAMES InpHtf = PERIOD_H1; // แท่งคุม (control candle) — กำหนดกรอบ CTH/CTL ที่ใช้หา sweep

input group "Demand/Supply Zone (จุดเข้า)"
input int InpMaxZoneAgeBars = 100; // zone ที่ยังไม่ถูกแตะเกินกี่แท่งถือว่าหมดอายุ ไม่ใช้เปิดไม้อีก (ไม่มีใน Pine ต้นฉบับ กันไม้ที่ห่างเวลากันเกินไป + กัน array โตไม่จำกัด)

input group "SL / ทุนเสี่ยง"
input double InpSlBufferPoints = 30;   // ระยะเผื่อ SL เลยขอบ zone ออกไปกี่จุด (ตาม demand_supply_zone.md)
input double InpRiskPointUnit  = 0.01; // ขนาด 1 จุดในสูตร lot (ราคา) — ดู bugs.md ก่อนเปลี่ยนคู่เงิน
input ENUM_SI_RISK_MODE InpRiskMode = SI_RISK_FIXED_USD;
input double InpRiskPct       = 2.0;  // ใช้เมื่อ RiskMode = % ของ equity
input double InpRiskFixedUsd  = 100;  // ใช้เมื่อ RiskMode = USD คงที่

input group "Take Profit"
input ENUM_SI_TP_MODE InpTpMode = SI_TP_R_MULTIPLE;
input double InpTp1R = 1.0; // ใช้เฉพาะโหมด R-multiple
input double InpTp2R = 2.0;
input double InpTp3R = 3.0;
input bool   InpUsePartials = true; // แบ่งปิด 1/3 ที่ TP1/TP2 (โหมด R-multiple เท่านั้น)
input bool   InpUseBe       = true; // เลื่อน SL มาที่ราคาเปิดตอนแตะ TP1 (โหมด R-multiple เท่านั้น)

input group "อื่นๆ"
input long InpMagic = 20260912;

input group "เกณฑ์ให้คะแนนตอน optimize"
input int    InpMinTrades  = 15;
input double InpMinProfit  = 0;
input bool   InpDumpPasses = true;

#include "SmartIndicatorCore.mqh"
