//+------------------------------------------------------------------+
//| BestM5_SelfAwareTrend.mq5                                          |
//| Self-Aware Trend System ชุดที่จูนบน M5 แล้ว — ใช้                    |
//| SelfAwareTrendCore.mqh ร่วมกับ SelfAwareTrendEA.mq5                 |
//| ไฟล์นี้มีแต่บล็อก input ไม่มีตรรกะของตัวเอง                          |
//|                                                                    |
//| ค่าที่ตั้งไว้ (ต่างจาก default ของ Pine):                            |
//|   Preset=Custom, AtrLen=14, BaseMult=9.0, SlAtrMult=2.5,            |
//|   AsymStrength=1.0, CharFlipMinAge=10, CharFlipHigh=0.80,           |
//|   CharFlipLow=0.45, TP 0.5/1.0/4.0 R, RiskMode=USD คงที่ $100        |
//|   (ที่เหลือเป็น default ของ Pine ทั้งหมด)                            |
//|                                                                    |
//| === ช่วงข้อมูลที่ใช้จูน: 2025.01.01 – 2026.09.11 (21 เดือน) ===        |
//| จูนเมื่อ 2026-09-11 ตามกฎ walk-forward ใหม่ของโปรเจกต์               |
//| (CLAUDE.md หัวข้อ optimizer — ผู้ใช้เปลี่ยนกฎเองวันเดียวกัน)          |
//|                                                                    |
//| **ไม่มีช่วง out-of-sample ในรอบนี้** ตัวเลขทั้งหมดด้านล่างวัดบนข้อมูล  |
//| ชุดเดียวกับที่ใช้เลือกค่า จึงเป็น in-sample ล้วน อ่านแบบมองบนเสมอ     |
//| (ผู้ใช้รับทราบและเลือกแลกเอง เพื่อให้ค่าตามทัน regime ล่าสุด)         |
//|                                                                    |
//| ผลบนช่วงจูนเต็ม (XAUUSDm M5, 1 minute OHLC, deposit 10,000):        |
//|   2,662 ไม้ (127/เดือน) · +14,966.58 · DD 1,171.86 · PF 1.27        |
//|   winrate 49.6% · กำไร 18/21 เดือน (86%) · ไม้ใหญ่สุด 7.0% ของกำไร   |
//|   เดือนแย่สุด −837.69 · เดือนกลาง +818.90 · ถือเฉลี่ย 5.3 ชม.        |
//|                                                                    |
//| เกณฑ์ "ถอนกำไรได้สม่ำเสมอ" 5 ข้อ → **ผ่าน 4 จาก 5 (in-sample)**      |
//|   ไม้ 20+/เดือน            127          ✅                          |
//|   เดือนที่กำไร 70%+        86%          ✅                          |
//|   ไม้ใหญ่สุด ≤10-15%       7.0%         ✅                          |
//|   DD ≤ กำไร 2-3 เดือน      1.64 เดือน   ✅                          |
//|   winrate 50%+             49.6%        ❌ (พลาดแบบเฉียดฉิว)        |
//|                                                                    |
//| ที่ต่างจากรอบจูนก่อน (ช่วง 2568 อย่างเดียว): BaseMult ขยับ 7.5 → 9.0  |
//| CharFlipHigh/Low 0.75/0.40 → 0.80/0.45 และ CharFlipMinAge 5 → 10     |
//| ส่วน SlAtrMult / TP / AsymStrength / AtrLen ไม่ขยับ — แปลว่า regime   |
//| ปี 2569 ต้องการแบนด์กว้างขึ้นและ char-flip ที่ยิงยากขึ้นกว่าปี 2568    |
//|                                                                    |
//| **ควรจูนซ้ำรอบถัดไปประมาณ มี.ค. 2570 (ราว 6 เดือนจากนี้)** หรือเร็ว   |
//| กว่านั้นถ้าผลจริงเดือนต่อเดือนเริ่มหลุดจากรูปที่เห็นด้านบน — ตอนจูนซ้ำ  |
//| ให้เช็คผลของค่าชุดนี้บนช่วง ก.ย.2569 เป็นต้นไปก่อน (นั่นคือ           |
//| out-of-sample ตามธรรมชาติของรอบนี้) แล้วค่อยจูนทับด้วยข้อมูลทั้งหมด   |
//|                                                                    |
//| รายละเอียดทุกสเตจอยู่ใน optimizer/README.md หัวข้อ                   |
//| "SATS — รอบ walk-forward 2026-09"                                   |
//+------------------------------------------------------------------+
#property strict
#include "SelfAwareTrendTypes.mqh"

input group "หลัก (Main)"
input ENUM_SATS_PRESET InpPreset = SATS_CUSTOM; // preset — ต้องเป็น Custom ไม่งั้น Scalping ทับทุกค่า
input int    InpAtrLen    = 14;   // ATR Length
input double InpBaseMult  = 9.0;  // ความกว้างแบนด์ฐาน x ATR (จูนแล้ว — Pine default 2.0)

input group "Adaptive Engine (ER แบบเดิม)"
input bool   InpUseAdaptive   = true;
input int    InpErLength      = 20;
input double InpAdaptStrength = 0.5;
input int    InpAtrBaselineLen = 100;

input group "Trend Quality Engine"
input bool   InpUseTqi         = true;
input double InpQualityStrength = 0.4;
input double InpQualityCurve    = 1.5;
input bool   InpMultSmooth      = true;
input bool   InpUseAsymBands    = true;
input double InpAsymStrength    = 1.0;  // จูนแล้ว (Pine default 0.5)
input bool   InpUseEffAtr       = true;
input bool   InpUseCharFlip     = true;
input int    InpCharFlipMinAge  = 10;   // จูนแล้ว (Pine default 5)
input double InpCharFlipHigh    = 0.80; // จูนแล้ว (Pine default 0.55)
input double InpCharFlipLow     = 0.45; // จูนแล้ว (Pine default 0.25)
input double InpTqiWeightEr     = 0.35;
input double InpTqiWeightVol    = 0.20;
input double InpTqiWeightStruct = 0.25;
input double InpTqiWeightMom    = 0.20;
input int    InpTqiStructLen    = 20;
input int    InpTqiMomLen       = 10;
input int    InpVolLen          = 20;

input group "ความเสี่ยงและเป้าหมาย"
input int    InpPivotLen    = 3;
input double InpSlAtrMult   = 2.5;  // จูนแล้ว (Pine default 1.5) — แกนนี้แบนราบ 1.5-3.5
input double InpSlMaxDist   = 4.0;
input ENUM_SATS_TPMODE InpTpMode = SATS_TP_FIXED; // Fixed ชนะ Dynamic ทุกด้าน (วัดแล้ว)
input double InpTp1R        = 0.5;  // จูนแล้ว (Pine default 1.0)
input double InpTp2R        = 1.0;  // จูนแล้ว (Pine default 2.0)
input double InpTp3R        = 4.0;  // จูนแล้ว (Pine default 3.0)
input int    InpTradeMaxAge = 100;

input group "Dynamic TP (ไม่ได้ใช้ในชุดนี้)"
input double InpDynTpTqiWeight = 0.6;
input double InpDynTpVolWeight = 0.4;
input double InpDynTpMinScale  = 0.5;
input double InpDynTpMaxScale  = 2.0;
input double InpDynTpFloorR1   = 0.5;
input double InpDynTpCeilR3    = 8.0;

input group "Self-Learning (ปิดไว้ เหมือน Pine)"
input bool   InpUseAutoCalib  = false;
input int    InpCalibWindow   = 20;
input double InpCalibBadR     = 0.0;
input double InpCalibGoodR    = 0.7;
input double InpCalibStepQ    = 0.05;
input int    InpCalibCooldown = 5;
input double InpCalibMinQ     = 0.1;
input double InpCalibMaxQ     = 0.9;

input group "ทุนเสี่ยงและการส่งคำสั่ง"
input ENUM_SATS_RISK InpRiskMode = SATS_RISK_USD; // USD คงที่ — % equity ทำให้ตัวเลขพองจนอ่านไม่ได้
input double InpRiskPct       = 2.0;
input double InpRiskFixedUsd  = 100;   // ทุนเสี่ยงต่อไม้ที่ใช้จูนทั้งหมด
input double InpRiskPointUnit = 0.01;
input int    InpMagic         = 20260941; // ต่างจาก SelfAwareTrendEA กันชนกันถ้ารันพร้อมกัน

input group "เกณฑ์ให้คะแนนตอน optimize"
input int    InpMinTrades  = 50;
input double InpMinProfit  = 0;
input bool   InpDumpPasses = true;

#include "SelfAwareTrendCore.mqh"
