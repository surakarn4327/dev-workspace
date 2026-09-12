//+------------------------------------------------------------------+
//| SmartIndicatorCore.mqh                                             |
//| พอร์ตจาก smart-indicator/src/smart-indicator.pine (โปรเจกต์พี่น้อง   |
//| ../smart-indicator — ห้าม import ข้ามโฟลเดอร์ตามธรรมนูญ อ่านโค้ด/    |
//| เอกสารแล้วเขียนซ้ำที่นี่)                                            |
//|                                                                    |
//| อินดิเคเตอร์ต้นฉบับมี 3 ส่วนที่รันแยกอิสระกัน (ไม่มี entry signal จริง|
//| ตามที่ระบุไว้ใน crt_technique.md/fvg_technique.md): CRT sweep filter,|
//| FVG/iFVG (แสดงผลอย่างเดียว, ไม่พอร์ต), Demand/Supply zone (มีสูตร   |
//| Entry/SL/Lot อยู่แล้วใน demand_supply_zone.md) — ผู้ใช้ยืนยัน        |
//| (2026-09-12) ให้ผูกรวมเป็นสัญญาณเดียว: CRT บอกทิศทาง (sweep LOW =    |
//| bias ขึ้น, sweep HIGH = bias ลง) + Demand/Supply zone เป็นจุดเข้า     |
//| แม่นกว่า, ทดสอบ TP สองแบบแยกกัน (R-multiple กับ range-target CTH/CTL)|
//|                                                                    |
//| ต่างจาก Pine อย่างไร (อ่านก่อนเทียบตัวเลข):                          |
//| - Pine ประมวลผลทุก tick/แท่งสด (รองรับ intrabar pending/disqualify   |
//|   ละเอียด) ที่นี่ประมวลผลครั้งเดียวต่อแท่งที่ปิดแล้ว (มาตรฐานเดียวกับ  |
//|   EA อื่นทุกตัวในโปรเจกต์นี้ — ดู AmdPo3Core.mqh) ผลคือแท่งแรกของกรอบ  |
//|   HTF ใหม่จะถูกประมวลผลแบบ "continuous" ในรอบถัดไป (ช้ากว่า Pine     |
//|   ไปหนึ่งแท่งของ LTF) ไม่ใช่ในแท่งเดียวกับที่ adopt — คลาดเคลื่อนเล็กน้อย|
//|   เทียบกับ Pine แต่ไม่กระทบทิศทาง/กรอบที่ตรวจจับได้                   |
//| - Pine ทำงานได้ทั้งโหมด native (chart TF < htf) และ HTF-chart (chart |
//|   TF >= htf) ที่นี่พอร์ตเฉพาะโหมด native เพราะ EA เทรดบน M1/M5/M15    |
//|   ซึ่งเล็กกว่า htf (default H1) เสมอ — ไม่ต้องมี request_lower_tf     |
//|   เทียบเท่า ใช้ iHigh/iLow/iOpen/iClose ของ InpHtf ตรงๆ ได้เลย (ไม่   |
//|   repaint เพราะอ่านแต่ shift >= 1 เสมอ)                              |
//| - FVG ต้นฉบับรองรับ 2 ไทม์เฟรมพร้อมกัน (fvgTf1/fvgTf2) ที่นี่พอร์ต    |
//|   เฉพาะไทม์เฟรมของ EA เอง (เทียบเท่า fvgTf1 เว้นว่าง = current chart) |
//| - เพิ่ม InpMaxZoneAgeBars ที่ไม่มีใน Pine (ซึ่งไม่มีแนวคิดหมดอายุ      |
//|   ตามเวลา มีแต่ fill/touch) เพราะ EA รันยาวข้ามปีได้ ต้องกันไม่ให้     |
//|   zone ค้างเก่าเกินไปมาเปิดไม้แบบไม่สมเหตุสมผลและกัน array โตไม่จำกัด |
//+------------------------------------------------------------------+
#include <Trade\Trade.mqh>
#include "TesterMetrics.mqh"
#include "PositionLib.mqh"

datetime gLastBarTime = 0;
int      gBarIndex    = 0; // มิเรอร์ bar_index ของ Pine — เพิ่มทีละ 1 ต่อแท่งที่ปิดแล้ว

//+------------------------------------------------------------------+
//| CRT state — มิเรอร์ type CrtState + method canAdopt/adopt/processSubBar |
//| ของ Pine (ตัด field ที่ใช้แค่วาดกราฟออกทั้งหมด: cthLine/ctlLine/       |
//| sweepCircle/cthText/ctlText ไม่มีความหมายกับการเทรดจริง)              |
//+------------------------------------------------------------------+
bool           gCrtRangeSet   = false;
double         gCrtRangeHigh  = 0;
double         gCrtRangeLow   = 0;
bool           gCrtRangeBullish = false;
ENUM_CRT_STATE gCrtState      = CRT_NONE;
ENUM_CRT_SIDE  gCrtSweptSide  = CRT_SIDE_NONE;
double         gCrtSweepPoint = 0;

bool          gCrtPendingSwept = false;
ENUM_CRT_SIDE gCrtPendingSide  = CRT_SIDE_NONE;
double        gCrtPendingPoint = 0;
bool          gCrtPendingOppositeTouched = false;
bool          gCrtDisqualified = false;

bool   gCrtRePierced = false;
double gCrtRePierceCandidate = 0;
bool   gCrtRePierceCandidateSet = false;

datetime gCrtActiveHtfOpenTime = 0; // H1 (InpHtf) open time ของกรอบที่กำลังเฝ้าดูอยู่ตอนนี้

// ── Demand/Supply zone + chain (มิเรอร์ ZoneBox/ZoneChain — ตัด field ที่ใช้วาด/label ทั้งหมด) ──
SiZoneRec gZones[];
bool      gZoneChainStarted = false;
bool      gZoneLastBullish  = false;
datetime  gZoneExpectedA    = 0;

// ตัวนับ diagnostic — ตามกฎโปรเจกต์: ห้ามเดาสาเหตุ ให้ข้อมูลบอกเอง
int gCnt_SweepConfirmed=0, gCnt_Success=0, gCnt_Failed=0, gCnt_Disqualified=0;
int gCnt_ZoneCreated=0, gCnt_ZoneFilled=0, gCnt_ZoneExpired=0;
int gCnt_EntryTried=0, gCnt_Opened=0, gCnt_OpenFail=0, gCnt_NoRisk=0, gCnt_LotTooSmall=0;

//+------------------------------------------------------------------+
int OnInit()
{
   gTrade.SetExpertMagicNumber(InpMagic);
   gTrade.SetTypeFillingBySymbol(_Symbol);
   gTrade.SetMarginMode();

   if(PeriodSeconds(InpHtf) < PeriodSeconds(PERIOD_CURRENT))
   {
      Print("InpHtf (แท่งคุม CRT) ต้องใหญ่กว่าหรือเท่ากับ timeframe ของชาร์ตที่รัน EA นี้");
      return INIT_FAILED;
   }

   ArrayResize(gZones, 0);
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   PrintFormat("diag: sweepConfirmed=%d success=%d failed=%d disqualified=%d "
               "zoneCreated=%d zoneFilled=%d zoneExpired=%d "
               "entryTried=%d opened=%d openFail=%d noRisk=%d lotTooSmall=%d | %s",
               gCnt_SweepConfirmed, gCnt_Success, gCnt_Failed, gCnt_Disqualified,
               gCnt_ZoneCreated, gCnt_ZoneFilled, gCnt_ZoneExpired,
               gCnt_EntryTried, gCnt_Opened, gPlOpenFail, gPlNoRisk, gPlLotTooSmall,
               PL_DiagString());
}

//+------------------------------------------------------------------+
//| ราคาของแท่งที่ปิดแล้ว — k=0 คือแท่งที่เพิ่งปิด (shift 1 จริง),         |
//| k ยิ่งมากยิ่งย้อนอดีตมากขึ้น (มิเรอร์ high[k]/low[k]/close[k] ของ Pine, |
//| เหมือน CBHigh/CBLow/CBClose ของ AmdPo3Core.mqh)                      |
//+------------------------------------------------------------------+
double   CBHigh(int k)  { return iHigh(_Symbol, PERIOD_CURRENT, 1 + k); }
double   CBLow(int k)   { return iLow(_Symbol, PERIOD_CURRENT, 1 + k); }
double   CBClose(int k) { return iClose(_Symbol, PERIOD_CURRENT, 1 + k); }
datetime CBTime(int k)  { return iTime(_Symbol, PERIOD_CURRENT, 1 + k); }

//+------------------------------------------------------------------+
//| method canAdopt(CrtState) ของ Pine                                  |
//+------------------------------------------------------------------+
bool CrtCanAdopt()
{
   return !gCrtRangeSet || gCrtState == CRT_NONE || gCrtState == CRT_SUCCESS || gCrtState == CRT_FAILED;
}

//+------------------------------------------------------------------+
//| method adopt(CrtState) ของ Pine — รับแท่งคุมใหม่ ล้างสถานะ sweep เดิม |
//+------------------------------------------------------------------+
void CrtAdopt(const double rHigh, const double rLow, const bool bullish)
{
   gCrtRangeHigh   = rHigh;
   gCrtRangeLow    = rLow;
   gCrtRangeBullish = bullish;
   gCrtState       = CRT_NONE;
   gCrtSweptSide   = CRT_SIDE_NONE;
   gCrtSweepPoint  = 0;
   gCrtPendingSwept = false;
   gCrtPendingSide  = CRT_SIDE_NONE;
   gCrtPendingPoint = 0;
   gCrtPendingOppositeTouched = false;
   gCrtDisqualified = false;
   gCrtRePierced    = false;
   gCrtRePierceCandidateSet = false;
   gCrtRangeSet     = true;
}

//+------------------------------------------------------------------+
//| method processSubBar(CrtState) ของ Pine — ตัด field ที่ใช้วาดกราฟออก  |
//| ทั้งหมด ตรรกะ sweep/pending/disqualify/re-pierce เหมือนต้นฉบับทุกจุด   |
//+------------------------------------------------------------------+
void CrtProcessSubBar(const double h_, const double l_, const double c_, const bool isBoundary)
{
   if(!gCrtRangeSet)
      return;

   if(gCrtState == CRT_NONE)
   {
      if(!gCrtPendingSwept && !gCrtDisqualified)
      {
         bool wrongSideTouch = gCrtRangeBullish ? (l_ <= gCrtRangeLow) : (h_ >= gCrtRangeHigh);
         if(wrongSideTouch)
            gCrtDisqualified = true;
         else if(gCrtRangeBullish && h_ > gCrtRangeHigh)
         {
            gCrtPendingSwept = true;
            gCrtPendingSide  = CRT_SIDE_HIGH;
            gCrtPendingPoint = h_;
         }
         else if(!gCrtRangeBullish && l_ < gCrtRangeLow)
         {
            gCrtPendingSwept = true;
            gCrtPendingSide  = CRT_SIDE_LOW;
            gCrtPendingPoint = l_;
         }
      }
      else if(gCrtPendingSwept)
      {
         if(gCrtPendingSide == CRT_SIDE_HIGH && h_ > gCrtPendingPoint)
            gCrtPendingPoint = h_;
         if(gCrtPendingSide == CRT_SIDE_LOW && l_ < gCrtPendingPoint)
            gCrtPendingPoint = l_;
         if((gCrtPendingSide == CRT_SIDE_LOW && h_ >= gCrtRangeHigh) ||
            (gCrtPendingSide == CRT_SIDE_HIGH && l_ <= gCrtRangeLow))
            gCrtPendingOppositeTouched = true;
      }

      if(isBoundary && gCrtState == CRT_NONE)
      {
         if(gCrtPendingSwept && !gCrtPendingOppositeTouched &&
            ((gCrtPendingSide == CRT_SIDE_HIGH && c_ <= gCrtRangeHigh) ||
             (gCrtPendingSide == CRT_SIDE_LOW && c_ >= gCrtRangeLow)))
         {
            gCrtState      = CRT_SWEPT;
            gCrtSweptSide  = gCrtPendingSide;
            gCrtSweepPoint = gCrtPendingPoint;
            gCnt_SweepConfirmed++;
         }
         gCrtPendingSwept = false;
         gCrtPendingSide  = CRT_SIDE_NONE;
         gCrtPendingPoint = 0;
         gCrtPendingOppositeTouched = false;
      }
      if(gCrtDisqualified)
         gCnt_Disqualified++;
   }
   else if(gCrtState == CRT_SWEPT)
   {
      bool touchOpposite = (gCrtSweptSide == CRT_SIDE_LOW && h_ >= gCrtRangeHigh) ||
                            (gCrtSweptSide == CRT_SIDE_HIGH && l_ <= gCrtRangeLow);
      if(touchOpposite)
      {
         gCrtState = CRT_SUCCESS;
         gCnt_Success++;
      }
      else
      {
         bool beyondSweep = (gCrtSweptSide == CRT_SIDE_LOW && l_ < gCrtRangeLow) ||
                             (gCrtSweptSide == CRT_SIDE_HIGH && h_ > gCrtRangeHigh);
         if(beyondSweep)
         {
            gCrtRePierced = true;
            double baseline = gCrtRePierceCandidateSet ? gCrtRePierceCandidate : gCrtSweepPoint;
            double newCandidate = gCrtSweptSide == CRT_SIDE_LOW ? MathMin(baseline, l_) : MathMax(baseline, h_);
            if(newCandidate != baseline)
            {
               gCrtRePierceCandidate = newCandidate;
               gCrtRePierceCandidateSet = true;
            }
         }
         if(isBoundary && gCrtRePierced)
         {
            bool closedInside = (gCrtSweptSide == CRT_SIDE_LOW && c_ >= gCrtRangeLow) ||
                                 (gCrtSweptSide == CRT_SIDE_HIGH && c_ <= gCrtRangeHigh);
            if(closedInside)
            {
               gCrtRePierced = false;
               if(gCrtRePierceCandidateSet)
                  gCrtSweepPoint = gCrtRePierceCandidate;
               gCrtRePierceCandidateSet = false;
            }
            else
            {
               gCrtState = CRT_FAILED;
               gCrtRePierced = false;
               gCrtRePierceCandidateSet = false;
               gCnt_Failed++;
            }
         }
      }
   }
}

//+------------------------------------------------------------------+
//| ขับ CRT ทีละแท่งที่ปิดแล้ว — มิเรอร์ branch "native" ของ Pine (chart TF |
//| < htf เสมอสำหรับ EA นี้) ตรวจ H1 rollover ผ่าน iTime ตรงๆ แทนการไล่    |
//| curCandleHigh/Low เอง (MQL5 อ่าน shift>=1 ของ TF อื่นได้ตรงไม่ repaint |
//| อยู่แล้ว ไม่ต้องมี workaround แบบ Pine)                               |
//+------------------------------------------------------------------+
void CrtOnNewBar()
{
   datetime htfOpenNow = iTime(_Symbol, InpHtf, 0);
   bool firstRun = (gCrtActiveHtfOpenTime == 0);
   bool htfRolled = !firstRun && (htfOpenNow != gCrtActiveHtfOpenTime);

   if(htfRolled)
   {
      // แท่งที่เพิ่งปิด (CBHigh(0) ฯลฯ) คือแท่งสุดท้ายของกรอบ HTF เดิม (H1 ใหม่เริ่มฟอร์มตัวแล้ว
      // ตอนที่เราเช็ค iTime ณ จุดนี้) ใช้ยืนยันผล sweep/fail ของกรอบเดิมก่อนพิจารณารับกรอบใหม่
      if(gCrtRangeSet)
         CrtProcessSubBar(CBHigh(0), CBLow(0), CBClose(0), true);

      if(CrtCanAdopt())
      {
         double h1 = iHigh(_Symbol, InpHtf, 1);
         double l1 = iLow(_Symbol, InpHtf, 1);
         double o1 = iOpen(_Symbol, InpHtf, 1);
         double c1 = iClose(_Symbol, InpHtf, 1);
         CrtAdopt(h1, l1, c1 > o1);
      }
      gCrtActiveHtfOpenTime = htfOpenNow;
      // แท่งนี้เป็นแท่งสุดท้ายของกรอบเก่า ไม่ใช่แท่งแรกของกรอบใหม่ (H1 เพิ่งเริ่มฟอร์มตัว
      // แท่ง LTF แท่งแรกของ H1 ใหม่จะมาถึงในรอบ OnBar ถัดไป) จึงไม่ประมวลผลต่อเป็น continuous
      // ที่นี่ — ต่างจาก Pine ที่ประมวลผลแท่งสดของกรอบใหม่ในติ๊กเดียวกัน (คลาดเคลื่อน 1 แท่ง LTF
      // ดูหัวเรื่อง "ต่างจาก Pine" ด้านบนไฟล์)
      return;
   }

   if(firstRun)
   {
      gCrtActiveHtfOpenTime = htfOpenNow;
      double h1 = iHigh(_Symbol, InpHtf, 1);
      double l1 = iLow(_Symbol, InpHtf, 1);
      double o1 = iOpen(_Symbol, InpHtf, 1);
      double c1 = iClose(_Symbol, InpHtf, 1);
      if(h1 > 0 && CrtCanAdopt())
         CrtAdopt(h1, l1, c1 > o1);
      return;
   }

   CrtProcessSubBar(CBHigh(0), CBLow(0), CBClose(0), false);
}

//+------------------------------------------------------------------+
//| Zone array helpers — push/remove-by-shift (มิเรอร์ array.push/remove   |
//| ของ Pine, ขนาดเล็กเสมอเพราะจำกัดอายุด้วย InpMaxZoneAgeBars)           |
//+------------------------------------------------------------------+
void ZoneAdd(const double top, const double bottom, const bool bullish, const int barIdx)
{
   int n = ArraySize(gZones);
   ArrayResize(gZones, n + 1);
   gZones[n].top = top;
   gZones[n].bottom = bottom;
   gZones[n].bullish = bullish;
   gZones[n].createdBar = barIdx;
   gZones[n].entryUsed = false;
   gCnt_ZoneCreated++;
}

void ZoneRemoveAt(const int idx)
{
   int n = ArraySize(gZones);
   for(int i = idx; i < n - 1; i++)
      gZones[i] = gZones[i + 1];
   ArrayResize(gZones, n - 1);
}

//+------------------------------------------------------------------+
//| ตรวจจับ FVG มาตรฐาน (3 แท่ง, off=1 รอแท่งปิดเสมอ — fvgWaitClose=true   |
//| ล็อกไว้ตาม fvg_technique.md) + กลไก chain สลับ Demand/Supply กับ FVG   |
//| ปกติ (demand_supply_zone.md) — A=CBHigh(2)/CBLow(2) (เก่าสุด),        |
//| B=shift กลาง (ไม่ต้องอ่านราคา ใช้แค่เวลา), C=CBHigh(0)/CBLow(0)        |
//| (แท่งที่เพิ่งปิด) ทั้งหมดอิงเวลาแท่ง (CBTime) แทน bar_time ของ Pine    |
//| เพราะ EA รันบน native TF เดียว ไม่ต้องรองรับหลาย TF พร้อมกันในสคริปต์  |
//| เดียวแบบ Pine — เปรียบเทียบ bar index/time ตรงไปตรงมาได้เลย            |
//+------------------------------------------------------------------+
void ZoneOnNewBar()
{
   // 1) maintenance ของกรอบเดิมก่อนเสมอ (เหมือน manageFvgTf ของ Pine): fill หรือหมดอายุ = ลบทิ้ง
   for(int i = ArraySize(gZones) - 1; i >= 0; i--)
   {
      bool filled  = gZones[i].bullish ? (CBLow(0) <= gZones[i].bottom) : (CBHigh(0) >= gZones[i].top);
      bool expired = (gBarIndex - gZones[i].createdBar) > InpMaxZoneAgeBars;
      if(filled)
      {
         gCnt_ZoneFilled++;
         ZoneRemoveAt(i);
      }
      else if(expired)
      {
         gCnt_ZoneExpired++;
         ZoneRemoveAt(i);
      }
   }

   // 2) หา FVG ใหม่ + เช็คว่าเป็น "ตา" ของ chain มั้ย (ถ้าใช่ถึงจะได้ zone)
   double hC = CBHigh(0), lC = CBLow(0);
   double hA = CBHigh(2), lA = CBLow(2);
   datetime tA = CBTime(2), tC = CBTime(0);

   bool bullGap = lC > hA;
   bool bearGap = hC < lA;
   if(!bullGap && !bearGap)
      return;

   bool isChainReset = (!gZoneChainStarted) || (gZoneLastBullish != bullGap) || (tA > gZoneExpectedA);
   bool isZoneTurn = isChainReset || (tA == gZoneExpectedA);
   if(isZoneTurn)
   {
      ZoneAdd(hA, lA, bullGap, gBarIndex);
      gZoneExpectedA = tC;
   }
   gZoneLastBullish  = bullGap;
   gZoneChainStarted = true;
}

//+------------------------------------------------------------------+
//| เปิดไม้จริงตาม Entry/SL ของ zone (demand_supply_zone.md): Entry = hA   |
//| (Demand) / lA (Supply) ของ zone เอง, SL = ขอบตรงข้าม ± buffer — ที่นี่ |
//| ใช้ราคาตลาดจริงตอนเปิดแทน hA/lA เป๊ะ (เหมือนที่ AmdPo3/SATS ต่างจาก    |
//| Pine อยู่แล้ว — ดูหัวเรื่อง "ต่างจาก Pine") เพราะกว่าจะรู้ว่าราคาแตะ zone|
//| ได้ก็ต่อเมื่อแท่งนั้นปิดแล้ว ราคาจริงตอนส่งคำสั่งอาจเลย hA/lA ไปแล้ว    |
//| เล็กน้อย risk ที่ใช้คำนวณ lot จึงคำนวณจากราคาเปิดจริง ไม่ใช่ hA/lA ตรงๆ |
//+------------------------------------------------------------------+
void TryOpenFromZone(const int dir, const double slPrice)
{
   gCnt_EntryTried++;

   double riskUsd = InpRiskMode == SI_RISK_FIXED_USD ? InpRiskFixedUsd
                                                      : AccountInfoDouble(ACCOUNT_EQUITY) * InpRiskPct / 100.0;

   bool usePartials = (InpTpMode == SI_TP_R_MULTIPLE) && InpUsePartials;
   bool useBe        = (InpTpMode == SI_TP_R_MULTIPLE) && InpUseBe;

   double entryRef = dir == 1 ? SymbolInfoDouble(_Symbol, SYMBOL_ASK) : SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double risk = MathAbs(entryRef - slPrice);
   if(risk <= 0)
   {
      gPlNoRisk++;
      return;
   }

   double tp1, tp2, tp3;
   if(InpTpMode == SI_TP_R_MULTIPLE)
   {
      tp1 = dir == 1 ? entryRef + risk * InpTp1R : entryRef - risk * InpTp1R;
      tp2 = dir == 1 ? entryRef + risk * InpTp2R : entryRef - risk * InpTp2R;
      tp3 = dir == 1 ? entryRef + risk * InpTp3R : entryRef - risk * InpTp3R;
   }
   else // SI_TP_RANGE_TARGET — เป้าเดียว = ฝั่งตรงข้ามของกรอบ CRT ที่กำลังเทรดอยู่
   {
      double target = dir == 1 ? gCrtRangeHigh : gCrtRangeLow;
      tp1 = target; tp2 = target; tp3 = target;
   }

   if(PL_Open(dir, slPrice, tp1, tp2, tp3, riskUsd, InpRiskPointUnit, InpMagic, "SmartInd",
              usePartials, gBarIndex))
      gCnt_Opened++;
}

//+------------------------------------------------------------------+
//| ตัดสินใจเข้าไม้ — bias จาก CRT (sweep LOW=ขึ้น, sweep HIGH=ลง) +       |
//| จุดเข้าจาก Demand/Supply zone ที่ตรงทิศ (ผู้ใช้ยืนยัน 2026-09-12:       |
//| "CRT + Zone รวมกัน") ถือได้ไม้เดียว ไม่มีไม้เปิดอยู่ + CRT ต้องอยู่ใน    |
//| สถานะ "swept" เท่านั้น (thesis ยังไม่จบ) ถึงจะมองหาจุดเข้า             |
//+------------------------------------------------------------------+
void CheckEntry()
{
   if(PL_HasPosition(InpMagic))
      return;
   if(gCrtState != CRT_SWEPT)
      return;

   bool wantLong  = (gCrtSweptSide == CRT_SIDE_LOW);
   bool wantShort = (gCrtSweptSide == CRT_SIDE_HIGH);
   if(!wantLong && !wantShort)
      return;

   double buffer = InpSlBufferPoints * InpRiskPointUnit;

   for(int i = 0; i < ArraySize(gZones); i++)
   {
      if(gZones[i].entryUsed)
         continue;

      if(wantLong && gZones[i].bullish && CBLow(0) <= gZones[i].top)
      {
         gZones[i].entryUsed = true;
         TryOpenFromZone(1, gZones[i].bottom - buffer);
         return;
      }
      if(wantShort && !gZones[i].bullish && CBHigh(0) >= gZones[i].bottom)
      {
         gZones[i].entryUsed = true;
         TryOpenFromZone(-1, gZones[i].top + buffer);
         return;
      }
   }
}

//+------------------------------------------------------------------+
//| คะแนนที่ optimizer ใช้จัดอันดับ — สูตรกลางใน TesterMetrics.mqh        |
//+------------------------------------------------------------------+
double OnTester()
{
   double score = ConsistencyScore(InpMinTrades, InpMinProfit);
   if(InpDumpPasses)
      DumpPass(score);
   return score;
}

//+------------------------------------------------------------------+
//| เขียนผลของ pass นี้ลงไฟล์ใน Common — ทุกพารามิเตอร์ที่ sweep ต้องอยู่ |
//| ในชื่อไฟล์เสมอ (บทเรียนจาก bugs.md: ไม่งั้นหลาย pass ทับกันเงียบๆ)     |
//+------------------------------------------------------------------+
void DumpPass(const double score)
{
   string tf = StringSubstr(EnumToString((ENUM_TIMEFRAMES)Period()), 7);
   string htfLabel = StringSubstr(EnumToString(InpHtf), 7); // แค่ใช้แต่งชื่อไฟล์ให้อ่านง่าย

   // ลำดับคอลัมน์พารามิเตอร์ต้องตรงกับลำดับ input ที่ประกาศใน SmartIndicatorEA.mq5 เป๊ะ (InpHtf ->
   // InpMaxZoneAgeBars -> InpSlBufferPoints -> ...) เพราะเครื่องมือจูนอ่านไฟล์ .csv นี้แล้วจับคู่
   // กลับไปยังบรรทัดใน .set ตามตำแหน่งคอลัมน์ตรงๆ (ea-tuner/src/runner.py) — เคยเขียนผิดลำดับมา
   // ก่อน (สลับ InpSlBufferPoints มาก่อน InpMaxZoneAgeBars) พบตอนเตรียมจูนจริงครั้งแรก 2026-09-12
   // ถ้าลำดับไม่ตรง เครื่องมือจูนจะเอาค่าที่ชนะไปเขียนทับผิดพารามิเตอร์แบบเงียบๆ — ต้องใช้
   // (int)InpHtf ค่าตัวเลขจริงด้วย ไม่ใช่ label ข้อความ "H1" เหมือนเดิม (EA อื่นในโปรเจกต์นี้ทุกตัว
   // ใช้ตัวเลขดิบของ enum เสมอในคอลัมน์ผล ไม่เคยใช้ label ข้อความ)
   string stem = StringFormat(
      "%s_%s_htf%s_maxage%d_slb%.1f_pu%.4f_rm%d_rp%.2f_rf%.2f_tpm%d_r1%.2f_r2%.2f_r3%.2f_part%d_be%d",
      _Symbol, tf, htfLabel,
      InpMaxZoneAgeBars, InpSlBufferPoints, InpRiskPointUnit, (int)InpRiskMode, InpRiskPct,
      InpRiskFixedUsd, (int)InpTpMode, InpTp1R, InpTp2R, InpTp3R, (int)InpUsePartials, (int)InpUseBe);
   string path = "smartind_opt\\" + stem + ".csv";

   int h = FileOpen(path, FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_COMMON);
   if(h == INVALID_HANDLE)
      return;

   WriteMonthlySeries("smartind_opt\\monthly\\" + stem + ".csv");

   FileWrite(h, StringFormat(
      "%s;%s;%d;%d;%.1f;%.4f;%d;%.2f;%.2f;%d;%.2f;%.2f;%.2f;%d;%d;",
      _Symbol, tf, (int)InpHtf,
      InpMaxZoneAgeBars, InpSlBufferPoints, InpRiskPointUnit, (int)InpRiskMode, InpRiskPct,
      InpRiskFixedUsd, (int)InpTpMode, InpTp1R, InpTp2R, InpTp3R, (int)InpUsePartials, (int)InpUseBe)
      + MetricsCsvTail(score));
   FileClose(h);
}

//+------------------------------------------------------------------+
void OnTick()
{
   PL_Manage(InpMagic, (InpTpMode == SI_TP_R_MULTIPLE) && InpUsePartials,
             (InpTpMode == SI_TP_R_MULTIPLE) && InpUseBe, false);

   datetime barTime = iTime(_Symbol, PERIOD_CURRENT, 0);
   if(barTime == gLastBarTime)
      return;
   gLastBarTime = barTime;
   gBarIndex++;

   CrtOnNewBar();
   ZoneOnNewBar();
   CheckEntry();
}
//+------------------------------------------------------------------+
