//+------------------------------------------------------------------+
//| SelfAwareTrendEA.mq5                                               |
//| พอร์ตจาก Pine "Self-Aware Trend System [WillyAlgoTrader]" v1.12.0   |
//| (ต้นฉบับ: C:\Users\OH\Downloads\SELF-AWARE TREND SYSTEM.txt —       |
//| อ่านแล้วเขียนซ้ำที่นี่ตามธรรมนูญ ห้าม import ข้ามโฟลเดอร์โปรเจกต์)     |
//|                                                                    |
//| แนวคิด: SuperTrend ที่ความกว้างแบนด์ปรับตาม "Trend Quality Index"    |
//| (TQI 0..1 จาก efficiency ratio + volatility regime + structure +    |
//| momentum persistence) แบนด์ฝั่งที่ตรงกับเทรนด์แคบลง ฝั่งตรงข้ามกว้างขึ้น |
//| เข้าไม้เมื่อเทรนด์พลิก (พลิกได้จากราคาทะลุแบนด์ หรือจาก TQI ทรุด)        |
//|                                                                    |
//| ต่างจาก Pine อย่างไร (อ่านก่อนเทียบตัวเลข):                          |
//| - Pine เป็น indicator ติดตามสถิติเฉยๆ ที่นี่เปิดออร์เดอร์จริงด้วย CTrade|
//|   ที่ entry/SL/TP เดียวกัน แบ่งปิด 1/3 ที่ TP1 และ TP2 ที่เหลือถึง TP3   |
//|   (โมเดลสถิติของ Pine ก็คิดเป็นสามส่วนเท่ากันเหมือนกัน)                |
//| - entry จริงคือราคาตลาดตอนบาร์ถัดไปเปิด ไม่ใช่ close เป๊ะๆ เหมือน Pine |
//| - ส่วน visual (label/line/dashboard/alert) กับคะแนน "score" 0-100     |
//|   ไม่ได้พอร์ตมา เพราะเป็นการแสดงผลล้วน ไม่มีผลต่อการเข้า/ออกไม้        |
//| - auto-calibration (hill-climbing ปรับ Quality Influence) พอร์ตมาด้วย |
//|   เพราะมันแก้ความกว้างแบนด์จริง ไม่ใช่แค่ตัวเลขบนจอ — แต่ R ที่ป้อนกลับ |
//|   คำนวณจากกำไรสุทธิจริงหารทุนเสี่ยง ไม่ใช่โมเดลสามส่วนในสคริปต์        |
//| - ta.pivothigh/low, ta.percentrank ไม่มีใน MQL5 เขียนเองใน Core      |
//+------------------------------------------------------------------+
#property strict
#include "SelfAwareTrendTypes.mqh"

input group "หลัก (Main)"
input ENUM_SATS_PRESET InpPreset = SATS_AUTO; // preset (Auto = เลือกตาม timeframe เหมือน Pine)
input int    InpAtrLen    = 13;   // ATR Length (ใช้เมื่อ preset = Custom)
input double InpBaseMult  = 2.0;  // ความกว้างแบนด์ฐาน x ATR (ใช้เมื่อ preset = Custom)

input group "Adaptive Engine (ER แบบเดิม)"
input bool   InpUseAdaptive   = true; // เปิดการปรับแบนด์ตาม efficiency ratio
input int    InpErLength      = 20;   // หน้าต่าง efficiency (ใช้เมื่อ preset = Custom)
input double InpAdaptStrength = 0.5;  // ความแรงของการปรับ
input int    InpAtrBaselineLen = 100; // หน้าต่างค่าเฉลี่ย ATR สำหรับ volatility regime

input group "Trend Quality Engine"
input bool   InpUseTqi         = true; // เปิด TQI
input double InpQualityStrength = 0.4; // TQI บีบ/ขยายแบนด์แรงแค่ไหน
input double InpQualityCurve    = 1.5; // ความไม่เชิงเส้นของการขยาย
input bool   InpMultSmooth      = true;// EMA-smooth ตัวคูณแบนด์ก่อนใช้
input bool   InpUseAsymBands    = true;// แบนด์ไม่สมมาตร
input double InpAsymStrength    = 0.5; // ความไม่สมมาตร
input bool   InpUseEffAtr       = true;// ถ่วง ATR ด้วย efficiency
input bool   InpUseCharFlip     = true;// ให้เทรนด์พลิกได้เมื่อคุณภาพทรุด
input int    InpCharFlipMinAge  = 5;   // อายุเทรนด์ขั้นต่ำ + ขนาดหน้าต่าง TQI
input double InpCharFlipHigh    = 0.55;// TQI สูงที่ต้องเคยแตะในหน้าต่าง
input double InpCharFlipLow     = 0.25;// TQI ต่ำที่ต้องอยู่ตอนนี้
input double InpTqiWeightEr     = 0.35;// น้ำหนัก: efficiency
input double InpTqiWeightVol    = 0.20;// น้ำหนัก: volatility regime
input double InpTqiWeightStruct = 0.25;// น้ำหนัก: structure
input double InpTqiWeightMom    = 0.20;// น้ำหนัก: momentum persistence
input int    InpTqiStructLen    = 20;  // หน้าต่าง structure
input int    InpTqiMomLen       = 10;  // หน้าต่าง momentum
input int    InpVolLen          = 20;  // หน้าต่าง z-score ของ volume

input group "ความเสี่ยงและเป้าหมาย"
input int    InpPivotLen    = 3;    // ความแรง pivot ที่ใช้เป็นฐาน SL
input double InpSlAtrMult   = 1.5;  // SL buffer x ATR (ใช้เมื่อ preset = Custom)
input double InpSlMaxDist   = 4.0;  // เพดานระยะ SL x ATR
input ENUM_SATS_TPMODE InpTpMode = SATS_TP_FIXED; // โหมด TP
input double InpTp1R        = 1.0;  // TP1 (R)
input double InpTp2R        = 2.0;  // TP2 (R)
input double InpTp3R        = 3.0;  // TP3 (R)
input int    InpTradeMaxAge = 100;  // ปิดไม้เองถ้าเกินกี่แท่ง

input group "Dynamic TP (ใช้เมื่อ TP Mode = Dynamic)"
input double InpDynTpTqiWeight = 0.6; // TQI มีผลต่อ TP แค่ไหน
input double InpDynTpVolWeight = 0.4; // volatility มีผลต่อ TP แค่ไหน
input double InpDynTpMinScale  = 0.5; // ตัวคูณต่ำสุด
input double InpDynTpMaxScale  = 2.0; // ตัวคูณสูงสุด
input double InpDynTpFloorR1   = 0.5; // พื้นของ TP1 (R)
input double InpDynTpCeilR3    = 8.0; // เพดานของทุก TP (R)

input group "Self-Learning (ทดลอง — Pine ปิดไว้เป็น default)"
input bool   InpUseAutoCalib  = false; // ปรับ Quality Influence อัตโนมัติ
input int    InpCalibWindow   = 20;    // หน้าต่างคำนวณ avgR
input double InpCalibBadR     = 0.0;   // ต่ำกว่านี้ถือว่าขอบแย่ ให้ขยับค่า
input double InpCalibGoodR    = 0.7;   // สูงกว่านี้ถือว่าดี ให้หยุดค้นหา
input double InpCalibStepQ    = 0.05;  // ขนาดก้าว
input int    InpCalibCooldown = 5;     // เว้นกี่ไม้ก่อนขยับอีกครั้ง
input double InpCalibMinQ     = 0.1;   // พื้น
input double InpCalibMaxQ     = 0.9;   // เพดาน

input group "ทุนเสี่ยงและการส่งคำสั่ง"
input ENUM_SATS_RISK InpRiskMode = SATS_RISK_PCT; // โหมดทุนเสี่ยง
input double InpRiskPct       = 2.0;   // ทุนเสี่ยงต่อไม้ (% ของ equity)
input double InpRiskFixedUsd  = 200;   // ทุนเสี่ยงต่อไม้ (USD คงที่)
input double InpRiskPointUnit = 0.01;  // ขนาด 1 จุดในสูตร lot — XAUUSD ใช้ 0.01
input int    InpMagic         = 20260921; // magic number

input group "เกณฑ์ให้คะแนนตอน optimize"
input int    InpMinTrades  = 30;
input double InpMinProfit  = 0;
input bool   InpDumpPasses = true;

#include "SelfAwareTrendCore.mqh"
