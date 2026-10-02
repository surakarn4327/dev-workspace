//+------------------------------------------------------------------+
//| V2.1-V2.3 (2026-10-02): แถว Signal (ลูกศร + progress bar + %) แทนแถว Ready + แก้ WarmupEma — กฎเข้า/ออกไม้ไม่เปลี่ยน (เคยลองเส้น DI + ปุ่ม Indicator แล้วเอาออก V2.3) |
//| AdxEmaVolV2EA.mq5 (= AdxEmaVolEA V1.4 + จำการพุ่งของ volume 30 นาที 2026-10-01) — AdxEma + 2 กฎจากงานวิจัย 2026-09-26 (ผู้ใช้สั่งสร้างจาก "ชุดที่น่าใช้" ใน CLAUDE.md)           |
//|  1) ห้ามเปิดไม้ใหม่เมื่อเหลือเวลาก่อน cutoff น้อยกว่า InpNoEntryBeforeCutoffMin นาที (ไม้ชนะต้องใช้เวลาวิ่งหลายชั่วโมง)  |
//|  2) ปรับขนาดไม้ตามความคึกคักของตลาด: tick volume ช่วงสั้น ÷ ค่าเฉลี่ยต่อแท่ง ต่ำกว่าเส้นแบ่ง = ไม้เล็ก ไม่ต่ำ = ไม้ใหญ่   |
//| ตรรกะเข้า/ออกไม้อื่นเหมือน AdxEma ต้นฉบับทุกประการ — AdxEmaEA ต้นฉบับไม่ถูกแตะ                                    |
//|                                                                    |
//| AdxEmaEA.mq5 (ต้นฉบับ)                                                |
//| พอร์ตจากไกด์ผู้ใช้ "จำลอง EDX Histogram ด้วย ADX+EMA บน MT5" ที่ผู้ใช้   |
//| ส่งข้อความอธิบายมาตรงๆ 2026-09-19 (ไม่มี source โค้ด/Pine ต้นฉบับ —    |
//| เขียนตรรกะขึ้นใหม่เองตามคำอธิบายนั้นตามธรรมนูญ) ดูรายละเอียด           |
//| engineering assumption ทั้งหมดที่หัวไฟล์ AdxEmaCore.mqh              |
//|                                                                    |
//| แนวคิด: +DI/-DI (ADX มาตรฐาน) บอกทิศทางตลาด, ADX main line ตัดขึ้น    |
//| เหนือ EMA ของตัวมันเอง (Signal Line) บอกจังหวะที่โมเมนตัมเพิ่งเร่งตัว   |
//| → เข้าไม้ตามทิศทาง +DI/-DI ตอนนั้น SL/TP คำนวณจาก ATR                |
//|                                                                    |
//| ต่างจากไกด์ต้นฉบับอย่างไร: ต้นฉบับเป็นแค่การตั้งค่าอินดิเคเตอร์บน MT5   |
//| UI ล้วนๆ (ไม่มีการเทรดอัตโนมัติ) EA นี้เปิดออร์เดอร์จริงด้วย            |
//| PositionLib.mqh ที่ entry/SL/TP ตามกฎเดียวกัน (SL/TP3 วางที่ broker,  |
//| TP1/TP2 ใช้ได้เฉพาะโหมด Fix Multiple RR เท่านั้น — default โหมด       |
//| Fix RR ไม่แตะ partial-close/BE เลยตามที่ผู้ใช้ยืนยัน)                  |
//+------------------------------------------------------------------+
#property strict
#include "AdxEmaVolV2Types.mqh"

input group "[จูน] ADX + EMA Momentum Engine"
input int    InpADXPeriod = 14; // period ของ ADX (+DI/-DI/ADX main) — ยิ่งสั้นยิ่งไวต่อสัญญาณ ยิ่งยาวยิ่งกรองสัญญาณหลอกได้มากขึ้น
input int    InpEmaPeriod = 5;  // period ของ EMA ที่คำนวณจากค่า ADX main line เอง (Signal Line) — ตามไกด์ผู้ใช้ default = 5

input group "[จูน] ตัวกรองสัญญาณ (No-Trade Zone)"
input double InpMinADXLevel = 15.0; // ADX ต่ำกว่านี้ = ตลาดเงียบ/วอลลุ่มต่ำเกินไป ไม่เข้าไม้ (ไกด์ผู้ใช้เรียก "ตลาดเงียบเกินไป")
input double InpMinDiGap    = 2.0;  // +DI กับ -DI ต้องห่างกันอย่างน้อยเท่านี้ ไม่งั้นถือว่า "ตัดกันไปมา" (sideway) ไม่เข้าไม้

input group "[จูน] ATR & SL/TP"
input int    InpATRPeriod       = 14;  // period ของ ATR ใช้คำนวณ SL/TP
input double InpSLAtrMult       = 2.0; // SL = ราคาปิดแท่งสัญญาณ ∓ ATR x ค่านี้
input double InpFixRRTpAtrMult  = 3.0; // TP ของโหมด Fix RR (เป้าเดียว) เป็นเท่าของ ATR
input double InpTp1AtrMult      = 2.0; // TP1 ของโหมด Fix Multiple RR เป็นเท่าของ ATR
input double InpTp2AtrMult      = 3.0; // TP2 ของโหมด Fix Multiple RR เป็นเท่าของ ATR
input double InpTp3AtrMult      = 4.0; // TP3 ของโหมด Fix Multiple RR เป็นเท่าของ ATR
input double InpDynTpMinAtrMult = 1.5; // TP ต่ำสุดของโหมด Dynamic RR (ตอน ADX เท่า InpMinADXLevel)
input double InpDynTpMaxAtrMult = 5.0; // TP สูงสุดของโหมด Dynamic RR (ตอน ADX = 50)

input group "[จูน] จัดการไม้ตามโมเมนตัม"
input bool InpExitOnMomentumLoss = true; // ปิดไม้ทันทีถ้า ADX ตกกลับต่ำกว่า EMA ของตัวมันเอง (โมเมนตัมหมด — ตาม "Pro Tip" ของไกด์: ADX โค้งลงหา EMA = รอบเทรนด์ใกล้จบ)

input group "[ไม่จูน] โหมด TP"
input ENUM_ADXEMA_TPMODE InpTpMode = TPMODE_FIX_RR; // โหมด TP: Fix RR (default, ไม่แบ่งปิด) / Fix Multiple RR (แบ่งปิด) / Dynamic RR

input group "[ไม่จูน] ความเสี่ยงและการเข้าออก"
input ENUM_RISK_MODE InpRiskMode      = RISK_PERCENT_EQUITY; // โหมดทุนเสี่ยง: % ของ equity หรือคงที่ USD
input double         InpRiskPct       = 2.0;  // ทุนเสี่ยงต่อไม้ เป็น % ของ equity (ใช้เมื่อ RiskMode = PercentEquity)
input double         InpRiskFixedUsd  = 200;  // ทุนเสี่ยงต่อไม้ คงที่ USD (ใช้เมื่อ RiskMode = FixedUsd)
input double         InpRiskPointUnit = 1;    // ขนาด 1 จุดในสูตร lot — Strategy Tester (Deposit USD) ใช้ 1 เสมอ, บัญชีจริง cent (USC) ต้องเปลี่ยนเป็น 0.01 ก่อนโหลดใช้จริง
input long           InpMagic         = 20261001; // magic number — คนละค่ากับ AdxEma ต้นฉบับ (20260919) และ AdxEmaVol V1 (20260927) กันชนกันถ้าแนบหลายตัวในบัญชีเดียวกัน

input group "[ไม่จูน] Day-trade เท่านั้น (ห้ามถือไม้ข้ามคืน)"
input bool InpUseCutoff             = true; // เปิด/ปิดกฎคัตไม้เที่ยงคืน — true = คัตไม้+ห้ามเปิดใหม่ตามเวลา, false = ปิดกฎนี้ทั้งหมด
input int  InpCutoffServerHour      = 17;   // ชั่วโมง server ที่ถือว่าเลยเที่ยงคืนไทยแล้ว — วัดจริง 2026-09-14: server ช้ากว่าไทย 7 ชม. ปรับถ้า broker/บัญชีเปลี่ยน
input int  InpTradeStartServerHour  = 23;   // ชั่วโมง server ที่เริ่มเปิดไม้ได้ (ใช้เมื่อ InpUseCutoff=true) — ตรงกับ 06:00 เช้าไทย ก่อนถึงชั่วโมงนี้จะยังไม่เปิดไม้ใหม่ให้
input int  InpNoEntryBeforeCutoffMin = 120; // ไม่เปิดไม้ใหม่เมื่อเหลือเวลาก่อน cutoff น้อยกว่ากี่นาที (0 = ปิด) — 120 กับ cutoff 16 = หยุดเปิดไม้ใหม่ 21:00 ไทย ไม้ที่เปิดอยู่ยังถือถึง cutoff ตามปกติ

input group "[ไม่จูน] ปรับขนาดไม้ตามความคึกคักของตลาด (tick volume)"
input bool   InpUseVolSizing     = true; // เปิด/ปิดการปรับขนาดไม้ตาม volume — false = เสี่ยงเท่ากันทุกไม้ตาม InpRiskPct เหมือน AdxEma ต้นฉบับ
input int    InpVolSizeWindow    = 10;   // รวม tick volume กี่นาทีล่าสุดก่อนเข้าไม้ (งานวิจัย: 5-30 นาทีได้ผลใกล้กัน)
input int    InpVolSizeBaseBars  = 1440; // เทียบกับค่าเฉลี่ย volume ต่อแท่งของกี่แท่ง M1 ล่าสุด (1440 = 1 วัน)
input int    InpVolSurgeBars     = 30;   // จำการพุ่ง: ใช้ค่าสูงสุดของอัตราส่วน volume ย้อนหลังกี่แท่ง M1 (ช่วงพักตัวหลังพุ่ง ตัวคูณจะไม่ตกทันที) — 0 = ปิด (เท่า AdxEmaVol V1) · ผลทดสอบ real ticks 2026: 30 นาที ได้ 38.1M vs 34.0M ของเดิม (15/45 นาที ~36.8M, 60+ นาทีแย่ลง)
input double InpVolSizeThreshold = 0.90; // เส้นแบ่ง: volume ช่วงสั้น ÷ ค่าเฉลี่ย ต่ำกว่านี้ = ตลาดเงียบ (งานวิจัย: 0.7-1.2 ได้ผลใกล้กัน)
input double InpVolSizeLow       = 0.5;  // ตลาดเงียบ: คูณ % เสี่ยงด้วยค่านี้ (0.5 × 5% = เสี่ยง 2.5%)
input double InpVolSizeHigh      = 1.5;  // ตลาดคึกคัก: คูณ % เสี่ยงด้วยค่านี้ (1.5 × 5% = เสี่ยง 7.5%)

input group "[ไม่จูน] เกณฑ์ให้คะแนนตอน optimize"
input int    InpMinTrades  = 30;   // ไม้ขั้นต่ำ ต่ำกว่านี้ให้คะแนน 0
input double InpMinProfit  = 0;    // กำไรสุทธิขั้นต่ำ ต่ำกว่านี้ให้คะแนน 0
input bool   InpDumpPasses = true; // เขียนผลทุก pass ลงไฟล์ Common\adxemavolv2_opt\

input group "[ไม่จูน] แสดงผลบนกราฟ"
input bool InpShowChartObjects = false; // วาดลูกศรจุดเข้า + เส้น SL/TP1-3 บนชาร์ต — default false เพราะทำให้ backtest/optimize ช้าลง (วาด object ทุก pass) เปิดเป็น true เฉพาะตอนดูสดบนชาร์ตจริงเท่านั้น
input bool InpShowDashboard     = true;  // แสดงพาเนลสรุปสถานะมุมขวาบนของชาร์ต (ไม้/SL/TP/risk/balance/equity/เวลาเทรด/เหตุการณ์ล่าสุด) — เหมือน BestSATS ปิดได้ถ้าไม่ต้องการ (ไม่กระทบตอน optimize เพราะ throttle ไว้ 2 วิ/ครั้งและ MT5 ไม่วาดกราฟระหว่าง optimize อยู่แล้ว)
input group "[ไม่จูน] สรุปสถานะเข้า Discord เป็นระยะ"
input int  InpSummaryEveryMin      = 10;   // ส่งสรุปสถานะ (เหมือน dashboard บนกราฟ) เข้า Discord ทุกกี่นาที — 0 = ปิด ไม่ส่งเป็นระยะ (ยังแจ้งเข้า/ปิดไม้/ปัญหาตามปกติ)
input bool InpSummaryOnlyTradeHours = true; // true = ส่งเฉพาะช่วงที่อนุญาตให้เทรด (06:00-24:00 ไทยตาม InpUseCutoff), false = ส่งตลอด 24 ชม. แม้นอกเวลาเทรด

#include "AdxEmaVolV2Core.mqh"
