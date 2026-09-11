//+------------------------------------------------------------------+
//| BestM5_AmdPo3.mq5                                                  |
//| AMD Po3 EA ชุดที่จูนบน M5 แล้ว — ใช้ AmdPo3Core.mqh ร่วมกับ          |
//| AmdPo3EA.mq5 ไฟล์นี้มีแต่บล็อก input ไม่มีตรรกะของตัวเอง             |
//|                                                                    |
//| ค่าที่ตั้งไว้: CompressionPct=40, RangeTolerance=0.15,               |
//| StopBufAtr=0.80x ATR(14), FibExt=2.00, SweepReturnBars=40,          |
//| DistTimeoutBars=150, HTF bias ปิด (M5 ไม่ต้องพึ่ง H1 filter)         |
//|                                                                    |
//| ช่วงจูน: ม.ค.-ธ.ค. 2568 เท่านั้น (ไม่แตะ 2569) — 310 ไม้, +12,451,   |
//| PF 1.27, winrate 31%, กำไร 6/12 เดือน (50%)                        |
//|                                                                    |
//| ช่วงตรวจสอบ: ม.ค.-ก.ย. 2569 (ไม่เคยใช้เลือกค่าใดๆ, 1 minute OHLC):  |
//| 210 ไม้ (26.3/เดือน), +22,455, PF **1.48** (ดีกว่าช่วงจูน),          |
//| winrate 37%, **กำไรครบทุกเดือน 8/8 (100%)**, ไม้ใหญ่สุด 12.1%        |
//| ของกำไร, ขาดทุนสูงสุด 6,461 (~2.3 เดือนของกำไรเฉลี่ย)                |
//|                                                                    |
//| ผ่านเกณฑ์ "ถอนได้สม่ำเสมอ" **4 จาก 5 ข้อ** บนช่วงตรวจสอบ — เท่ากับ    |
//| BestWide_M15_MARibbon ซึ่งเป็นตัวดีที่สุดของโปรเจกต์ก่อนหน้านี้        |
//| ข้อเดียวที่ไม่ผ่านคือ winrate (37% vs เป้า 50%) ซึ่งเป็นข้อเดียวกับที่ |
//| MARibbon เจอด้วย และเคยวัดปิดคำถามไปแล้วว่า winrate 50% ทำได้จริง    |
//| แต่ระบบไม่เหลือกำไร (ดู optimizer/README.md) — trade-off นี้ดูเป็น    |
//| ธรรมชาติของโมเดล R:R>1 มากกว่าจะเป็นจุดต้องแก้                       |
//|                                                                    |
//| **คำเตือนเดียวกับ BestM15_AmdPo3**: บนข้อมูลเก่ากว่า (มิ.ย.2565-     |
//| มิ.ย.2568) กริดพารามิเตอร์กลุ่มนี้ (วัดฝั่ง M15) กำไรแค่ 26-28% ของ   |
//| กริดในปีเก่า vs 78% ปีล่าสุด — edge นี้น่าจะผูกกับ regime ตลาดทอง     |
//| ช่วงหลัง ยังไม่ได้วัดสัดส่วนเดียวกันนี้ซ้ำบนฝั่ง M5 โดยตรง            |
//+------------------------------------------------------------------+
#property strict
#include "AmdPo3Types.mqh"

input group "ช่วงสะสม (Range/Accumulation)"
input int    InpMinRangeBars    = 30;
input int    InpMaxRangeBars    = 96;
input int    InpCompressionPct  = 40;
input int    InpStatWindow      = 200;
input double InpRangeTolerance  = 0.15;
input double InpMinRangeWidthPct = 0.15;
input ENUM_BOUNDARY_MODE InpBoundaryMode = BOUNDARY_PIVOT;
input int    InpTrimTailPct     = 15;

input group "การกวาดสภาพคล่อง (Manipulation/Sweep)"
input int  InpSweepReturnBars    = 40;
input bool InpRequireLiquidity   = false;
input int  InpSweepDepthPct      = 100;
input bool InpAllowRearm         = true;

input group "การกระจายและเป้าหมาย (Distribution)"
input int    InpDistTimeoutBars = 150;
input double InpStopBufAtr      = 0.80;
input double InpFibExt          = 2.00;

input group "ตัวกรอง (Filters)"
input bool  InpUseKillzones   = false;
input int   InpKzLdnFromHour  = 7;
input int   InpKzLdnToHour    = 10;
input int   InpKzNyFromHour   = 13;
input int   InpKzNyToHour     = 16;
input bool  InpUseHtfBias      = false;
input ENUM_TIMEFRAMES InpHtfTf = PERIOD_H1;

input group "ความเสี่ยงและการเข้าออก"
input ENUM_RISK_MODE InpRiskMode = RISK_PERCENT_EQUITY; // โหมดทุนเสี่ยง: % ของ equity (ทบต้น) หรือคงที่ USD
input double InpRiskPct        = 2.0;
input double InpRiskFixedUsd   = 200;  // ใช้เมื่อ RiskMode = FixedUsd
input double InpRiskPointUnit  = 0.01;
input int    InpMagic          = 20260931; // ต่างจาก AmdPo3EA/BestM15_AmdPo3 กันชนกันถ้ารันพร้อมกัน

input group "เกณฑ์ให้คะแนนตอน optimize"
input int    InpMinTrades  = 15;
input double InpMinProfit  = 0;
input bool   InpDumpPasses = true;

#include "AmdPo3Core.mqh"
