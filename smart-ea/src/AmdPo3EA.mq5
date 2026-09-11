//+------------------------------------------------------------------+
//| AmdPo3EA.mq5                                                       |
//| พอร์ตจาก Pine "AMD Po3 with Live Edge Stats [WillyAlgoTrader]"      |
//| (ไฟล์ต้นฉบับ: C:\Users\OH\Downloads\AMD Po3.txt — อ่านแล้วเขียนซ้ำ    |
//| ที่นี่ตามธรรมนูญ ห้าม import ข้ามโฟลเดอร์โปรเจกต์)                    |
//|                                                                    |
//| แนวคิด: FSM สะสม (Accumulation) → กวาดสภาพคล่อง (Manipulation) →    |
//| กระจาย (Distribution) แบบ ICT/Po3 — หา range ที่ Donchian(20) บีบตัว |
//| ลงต่ำกว่า percentile ที่กำหนด รอราคากวาดขอบแล้วกลับเข้าภายในไม่กี่แท่ง |
//| แล้วเปิดไม้จริงตามโมเดล: entry = close ของแท่งยืนยัน, stop = เลย       |
//| จุดกวาดสุดขั้ว + ATR buffer, target = fib extension ของขาที่กวาด       |
//|                                                                    |
//| ต่างจาก Pine อย่างไร (อ่านก่อนเทียบตัวเลข):                          |
//| - Pine ต้นฉบับเป็น "reference model" คือแค่ติดตามสถิติเฉยๆ ไม่เปิดไม้ |
//|   จริง EA นี้เปิดออร์เดอร์จริงด้วย CTrade ที่ entry/stop/target       |
//|   เดียวกัน (ไม่มี partial/BE/trailing — โมเดลเดิมเป็นไม้เดียวจบ)      |
//| - entry ที่ได้จริงคือ Ask/Bid ตอนบาร์ถัดไปเปิด ไม่ใช่ close เป๊ะๆ      |
//|   เหมือน Pine (ต่างกันเล็กน้อยตามสเปรด/สลิปเพจ)                      |
//| - ta.percentrank / ta.percentile_nearest_rank ไม่มีใน MQL5 คำนวณเอง  |
//|   ด้วยการไล่ history สด (ดูคอมเมนต์ใน AmdPo3Core.mqh)                |
//| - ta.pivothigh/low ไม่มีใน MQL5 เขียนฟังก์ชันเทียบ left/right เอง     |
//| - killzone ของ Pine ใช้ timezone string ที่นี่ใช้ "ชั่วโมงตาม broker  |
//|   server time" ตรงๆ ผู้ใช้ต้องเทียบ server time ของ broker เองครั้ง   |
//|   เดียว (ดู Experts log เทียบ TimeCurrent() กับ TimeGMT())            |
//| - timeout ของ Pine แค่บันทึกผล ที่นี่ต้องสั่งปิดไม้จริงเมื่อถึงกำหนด    |
//+------------------------------------------------------------------+
#property strict
#include "AmdPo3Types.mqh"

input group "ช่วงสะสม (Range/Accumulation)"
input int    InpMinRangeBars    = 12;   // อายุขั้นต่ำก่อนถือว่าการแหกขอบเป็น sweep (ไม่งั้นคือ reset)
input int    InpMaxRangeBars    = 96;   // อายุสูงสุดของ range ก่อนหมดเวลา
input int    InpCompressionPct  = 25;   // Donchian(20) width ต้องอยู่ percentile ล่างสุด N% นี้
input int    InpStatWindow      = 200;  // หน้าต่างสำหรับคำนวณ percentile ของ width และ TR
input double InpRangeTolerance  = 0.10; // สัดส่วนความกว้าง range ที่ขอบ "หายใจ" ได้โดยไม่นับ reset
input double InpMinRangeWidthPct = 0.15; // ความกว้าง range ขั้นต่ำ เป็น % ของราคา
input ENUM_BOUNDARY_MODE InpBoundaryMode = BOUNDARY_PIVOT; // วิธีหาขอบ range
input int    InpTrimTailPct     = 15;   // ตัดหางแท่งเก่าที่ถ่วงความกว้างออก (0 = ปิด)

input group "การกวาดสภาพคล่อง (Manipulation/Sweep)"
input int  InpSweepReturnBars    = 8;     // ต้องกลับเข้า range ภายในกี่แท่ง ไม่งั้นคือ BREAKOUT
input bool InpRequireLiquidity   = false; // ต้องมี EQH/EQL อย่างน้อย 2 จุดเลยขอบก่อนถึงนับเป็น sweep
input int  InpSweepDepthPct      = 100;   // เพดานความลึกของ sweep เป็น percentile ของ TR (100 = ปิด)
input bool InpAllowRearm         = true;  // HTF bias ปฏิเสธทิศแล้ว รอกวาดฝั่งตรงข้ามอีกรอบ

input group "การกระจายและเป้าหมาย (Distribution)"
input int    InpDistTimeoutBars = 64;  // ปิดไม้เองถ้ายังไม่ถึง SL/TP ภายในกี่แท่ง
input double InpStopBufAtr      = 0.4; // ระยะเผื่อ stop เลยจุดกวาดสุดขั้ว หน่วย x ATR(14)
input double InpFibExt          = 1.5; // fib extension ของขาที่กวาด (0=จุดกวาด, 1=ขอบตรงข้าม)

input group "ตัวกรอง (Filters)"
input bool  InpUseKillzones   = false;    // กวาดนับเฉพาะในช่วง killzone
input int   InpKzLdnFromHour  = 7;        // London killzone เริ่ม (ชั่วโมงตาม server time ของ broker)
input int   InpKzLdnToHour    = 10;       // London killzone จบ
input int   InpKzNyFromHour   = 13;       // New York killzone เริ่ม
input int   InpKzNyToHour     = 16;       // New York killzone จบ
input bool  InpUseHtfBias      = false;   // กรองทิศทางด้วย EMA50 บน timeframe สูงกว่า
input ENUM_TIMEFRAMES InpHtfTf = PERIOD_H1; // timeframe สำหรับ HTF bias

input group "ความเสี่ยงและการเข้าออก"
input ENUM_RISK_MODE InpRiskMode = RISK_PERCENT_EQUITY; // โหมดทุนเสี่ยง: % ของ equity (ทบต้น) หรือคงที่ USD
input double InpRiskPct        = 2.0;  // ทุนเสี่ยงต่อไม้ เป็น % ของ equity (ใช้เมื่อ RiskMode = PercentEquity)
input double InpRiskFixedUsd   = 200;  // ทุนเสี่ยงต่อไม้ คงที่ USD (ใช้เมื่อ RiskMode = FixedUsd)
input double InpRiskPointUnit  = 0.01; // ขนาด 1 จุดในสูตร lot (ราคา) — XAUUSD ใช้ 0.01
input int    InpMagic          = 20260920; // magic number

input group "เกณฑ์ให้คะแนนตอน optimize"
input int    InpMinTrades  = 30;   // ไม้ขั้นต่ำ ต่ำกว่านี้ให้คะแนน 0
input double InpMinProfit  = 0;    // กำไรสุทธิขั้นต่ำ ต่ำกว่านี้ให้คะแนน 0
input bool   InpDumpPasses = true; // เขียนผลทุก pass ลงไฟล์ Common\amdpo3_opt\

#include "AmdPo3Core.mqh"
