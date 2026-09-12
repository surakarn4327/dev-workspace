//+------------------------------------------------------------------+
//| AmdPo3Core.mqh                                                     |
//| ตรรกะทั้งหมดของ AMD Po3 EA — FSM สะสม/กวาด/กระจาย, การเข้าออกไม้จริง |
//|                                                                    |
//| ไฟล์นี้ไม่ประกาศ input เอง แต่อ้างถึงตัวแปร input ที่ EA ประกาศไว้    |
//| ก่อน include (มิเรอร์ MARibbonCore.mqh)                             |
//+------------------------------------------------------------------+
#include <Trade\Trade.mqh>
#include "TesterMetrics.mqh"

// ค่าคงที่ตาม constants section ของ Pine ต้นฉบับ (ไม่ใช่ input เพราะต้นฉบับก็ไม่ใช่)
const int RANGE_WIN         = 20;   // หน้าต่าง Donchian
const int PIVOT_LR          = 3;    // pivot ยืนยันหลังผ่านไปกี่แท่ง (ซ้าย/ขวา)
const int PIVOT_CAP         = 60;   // pivot ที่จำไว้สูงสุดต่อฝั่ง
const int EQ_LOOKBACK       = 96;   // ค้นหา EQH/EQL ย้อนหลังกี่แท่ง
const int COOLDOWN_BARS     = 10;   // กันชนระหว่างจบ cycle กับเริ่ม range ใหม่
const int ATR_ANCHOR_PERIOD = 14;   // ATR สำหรับ stop buffer (เท่า Pine ta.atr(14))

CTrade   trade;
datetime gLastBarTime = 0;
int      gBarIndex    = 0;  // มิเรอร์ bar_index ของ Pine — เพิ่มทีละ 1 ต่อแท่งที่ยืนยันแล้ว

int hAtrAnchor = INVALID_HANDLE; // ATR(14) — ใช้เป็น stop buffer anchor
int hTR        = INVALID_HANDLE; // ATR(1) = True Range ดิบรายแท่ง
int hHtfEma    = INVALID_HANDLE; // EMA(50) บน HTF สำหรับ bias filter

// ── สถานะ FSM ──
ENUM_PHASE gState      = PHASE_IDLE;
int        gCycleId    = 0;
int        gLastEndBar = -1000;

bool   gRangeSet     = false;
double gRangeHigh    = 0;
double gRangeLow     = 0;
double gRangeMid     = 0;
double gRangeWidth   = 0;
int    gRangeStartBar = 0;
int    gExpiryAnchor  = 0;
int    gRangeAge      = 0;
double gAtrAnchor     = 0;

int    gSweepSide      = 0; // 1 = HIGH, -1 = LOW
int    gFirstSweepSide = 0;
double gSweepExtreme   = 0;
int    gSweepBar       = 0;
bool   gRearmUsed      = false;

int    gDistDir       = 0;
double gEntryPriceRef = 0;
double gStopPriceRef  = 0;
double gTgtPriceRef   = 0;
double gRiskR         = 0;
int    gDistStartBar  = 0;

// pivot ที่ยืนยันแล้ว — ring buffer มือ (มิเรอร์ array.push+array.shift ของ Pine)
double gPivHiV[];
int    gPivHiB[];
double gPivLoV[];
int    gPivLoB[];

bool   gPhValid = false;
double gPhVal   = 0;
bool   gPlValid = false;
double gPlVal   = 0;

// ไม้ที่เปิดอยู่ (EA นี้ถือได้ไม้เดียว)
int    gDir       = 0;
long   gPosTicket = 0;

// ตัวนับ diagnostic — ตามกฎโปรเจกต์: ห้ามเดาสาเหตุ ให้ข้อมูลบอกเอง
int gCnt_RangeDetected=0, gCnt_SweepConfirmed=0, gCnt_ManipConfirmed=0, gCnt_DistOpened=0;
int gCnt_HitTarget=0, gCnt_HitStop=0, gCnt_Timeout=0, gCnt_FailedManip=0, gCnt_Breakout=0;
int gCnt_OpenFail=0, gCnt_NoRisk=0, gCnt_LotTooSmall=0;

//+------------------------------------------------------------------+
int OnInit()
{
   hAtrAnchor = iATR(_Symbol, PERIOD_CURRENT, ATR_ANCHOR_PERIOD);
   hTR        = iATR(_Symbol, PERIOD_CURRENT, 1); // period=1 → ATR กลายเป็น True Range ดิบ

   if(hAtrAnchor == INVALID_HANDLE || hTR == INVALID_HANDLE)
   {
      Print("iATR handle failed");
      return INIT_FAILED;
   }

   if(InpUseHtfBias)
   {
      if(PeriodSeconds(InpHtfTf) < PeriodSeconds(PERIOD_CURRENT))
      {
         Print("HTF bias timeframe must be >= chart timeframe");
         return INIT_FAILED;
      }
      hHtfEma = iMA(_Symbol, InpHtfTf, 50, 0, MODE_EMA, PRICE_CLOSE);
      if(hHtfEma == INVALID_HANDLE)
      {
         Print("HTF EMA handle failed");
         return INIT_FAILED;
      }
   }

   trade.SetExpertMagicNumber(InpMagic);
   trade.SetTypeFillingBySymbol(_Symbol);
   trade.SetMarginMode();

   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   PrintFormat("diag: rangeDetected=%d sweepConfirmed=%d manipConfirmed=%d distOpened=%d "
               "hitTarget=%d hitStop=%d timeout=%d failedManip=%d breakout=%d "
               "openFail=%d noRisk=%d lotTooSmall=%d",
               gCnt_RangeDetected, gCnt_SweepConfirmed, gCnt_ManipConfirmed, gCnt_DistOpened,
               gCnt_HitTarget, gCnt_HitStop, gCnt_Timeout, gCnt_FailedManip, gCnt_Breakout,
               gCnt_OpenFail, gCnt_NoRisk, gCnt_LotTooSmall);
}

//+------------------------------------------------------------------+
//| ราคาของแท่งที่ยืนยันแล้ว — k=0 คือแท่งที่เพิ่งปิด (shift 1 จริง),      |
//| k ยิ่งมากยิ่งย้อนอดีตมากขึ้น (มิเรอร์ high[i]/low[i]/close[i] ของ Pine) |
//+------------------------------------------------------------------+
double CBHigh(int k)  { return iHigh(_Symbol, PERIOD_CURRENT, 1 + k); }
double CBLow(int k)   { return iLow(_Symbol, PERIOD_CURRENT, 1 + k); }
double CBClose(int k) { return iClose(_Symbol, PERIOD_CURRENT, 1 + k); }

//+------------------------------------------------------------------+
double HighestVal(const int len, const int startShift)
{
   int idx = iHighest(_Symbol, PERIOD_CURRENT, MODE_HIGH, len, startShift);
   return idx < 0 ? 0.0 : iHigh(_Symbol, PERIOD_CURRENT, idx);
}
double LowestVal(const int len, const int startShift)
{
   int idx = iLowest(_Symbol, PERIOD_CURRENT, MODE_LOW, len, startShift);
   return idx < 0 ? 0.0 : iLow(_Symbol, PERIOD_CURRENT, idx);
}
double DonchianWidthAt(const int k)
{
   return HighestVal(RANGE_WIN, 1 + k) - LowestVal(RANGE_WIN, 1 + k);
}

//+------------------------------------------------------------------+
//| ta.percentrank / ta.percentile_nearest_rank ไม่มีใน MQL5 — คำนวณเองจาก|
//| history สด แทนการดูแล rolling buffer เอง (ข้อมูลราคาทั้งหมดอยู่ครบ    |
//| ใน terminal อยู่แล้ว) ไม่เป๊ะกับ Pine เป๊ะร้อยเปอร์เซ็นต์ (นับรวม/ไม่   |
//| นับรวมค่าปัจจุบันต่างกันเล็กน้อย) แต่พอสำหรับใช้เป็น threshold filter  |
//+------------------------------------------------------------------+
double PercentRankWidth(const int statWindow)
{
   double cur = DonchianWidthAt(0);
   int count = 0;
   for(int k = 1; k <= statWindow; k++)
      if(DonchianWidthAt(k) <= cur)
         count++;
   return statWindow > 0 ? 100.0 * count / statWindow : 0.0;
}

double PercentileNearestRankTR(const int statWindow, const double pct)
{
   double buf[];
   int got = CopyBuffer(hTR, 0, 1, statWindow, buf);
   if(got <= 0)
      return 0.0;
   double sorted[];
   ArrayResize(sorted, got);
   ArrayCopy(sorted, buf);
   ArraySort(sorted);
   int idx = (int)MathCeil(pct / 100.0 * got) - 1;
   if(idx < 0) idx = 0;
   if(idx >= got) idx = got - 1;
   return sorted[idx];
}

double AtrAt(const int k)
{
   double buf[];
   if(CopyBuffer(hAtrAnchor, 0, 1 + k, 1, buf) < 1)
      return SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   return MathMax(buf[0], SymbolInfoDouble(_Symbol, SYMBOL_POINT));
}

//+------------------------------------------------------------------+
//| pivot high/low ที่ยืนยันแล้ว (lag = PIVOT_LR แท่ง) — MQL5 ไม่มีของ    |
//| สำเร็จรูปเหมือน ta.pivothigh/low เขียนเทียบ left/right เอง            |
//| ผู้สมัคร = แท่ง PIVOT_LR ก่อนแท่งที่เพิ่งยืนยัน (CB(PIVOT_LR))         |
//+------------------------------------------------------------------+
bool ConfirmedPivotHigh(double &val)
{
   double c = CBHigh(PIVOT_LR);
   for(int i = 1; i <= PIVOT_LR; i++)
   {
      if(CBHigh(PIVOT_LR - i) >= c) return false; // ฝั่งขวา (ใหม่กว่า)
      if(CBHigh(PIVOT_LR + i) >= c) return false; // ฝั่งซ้าย (เก่ากว่า)
   }
   val = c;
   return true;
}
bool ConfirmedPivotLow(double &val)
{
   double c = CBLow(PIVOT_LR);
   for(int i = 1; i <= PIVOT_LR; i++)
   {
      if(CBLow(PIVOT_LR - i) <= c) return false;
      if(CBLow(PIVOT_LR + i) <= c) return false;
   }
   val = c;
   return true;
}

void PushPivot(double &v[], int &b[], const double val, const int barIdx, const int cap)
{
   int n = ArraySize(v);
   if(n < cap)
   {
      ArrayResize(v, n + 1);
      ArrayResize(b, n + 1);
      v[n] = val;
      b[n] = barIdx;
   }
   else
   {
      for(int i = 0; i < cap - 1; i++)
      {
         v[i] = v[i + 1];
         b[i] = b[i + 1];
      }
      v[cap - 1] = val;
      b[cap - 1] = barIdx;
   }
}

//+------------------------------------------------------------------+
//| EQH/EQL: อย่างน้อย 2 pivot ภายใน 0.1×width จากขอบ ในช่วง EQ_LOOKBACK  |
//+------------------------------------------------------------------+
bool LiquidityBeyond(const int side)
{
   int cnt = 0;
   double tol = 0.10 * gRangeWidth;
   if(side == 1)
   {
      int n = ArraySize(gPivHiV);
      for(int j = 0; j < n; j++)
         if(gPivHiB[j] >= gBarIndex - EQ_LOOKBACK && MathAbs(gPivHiV[j] - gRangeHigh) <= tol)
            cnt++;
   }
   else
   {
      int n = ArraySize(gPivLoV);
      for(int j = 0; j < n; j++)
         if(gPivLoB[j] >= gBarIndex - EQ_LOOKBACK && MathAbs(gPivLoV[j] - gRangeLow) <= tol)
            cnt++;
   }
   return cnt >= 2;
}

//+------------------------------------------------------------------+
//| HTF bias — MQL5 รองรับ multi-timeframe โดยตรง ขอ shift=1 (แท่ง HTF    |
//| ที่ปิดแล้วล่าสุด) ก็ไม่ repaint อยู่แล้ว ไม่ต้องมี wrapper แบบ Pine     |
//| ([1] + lookahead_on)                                               |
//+------------------------------------------------------------------+
bool GetHtfBias(double &htfC, double &htfE)
{
   double buf[];
   if(CopyBuffer(hHtfEma, 0, 1, 1, buf) < 1)
      return false;
   htfE = buf[0];
   htfC = iClose(_Symbol, InpHtfTf, 1);
   return htfC != 0;
}

//+------------------------------------------------------------------+
//| Killzone — Pine ใช้ timezone string ที่นี่ใช้ชั่วโมงตาม broker       |
//| server time ตรงๆ (เทียบเองครั้งเดียวผ่าน Experts log)                |
//+------------------------------------------------------------------+
bool InRangeHour(const int h, const int from, const int to)
{
   if(from == to) return true;
   if(from < to) return h >= from && h < to;
   return h >= from || h < to; // ช่วงข้ามเที่ยงคืน
}
bool InKillzone()
{
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   return InRangeHour(dt.hour, InpKzLdnFromHour, InpKzLdnToHour) ||
          InRangeHour(dt.hour, InpKzNyFromHour,  InpKzNyToHour);
}

//+------------------------------------------------------------------+
bool HasPosition()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) == _Symbol &&
         PositionGetInteger(POSITION_MAGIC) == InpMagic)
         return true;
   }
   return false;
}
bool SelectPosition(ulong &ticket)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(t == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) == _Symbol &&
         PositionGetInteger(POSITION_MAGIC) == InpMagic)
      {
         ticket = t;
         return true;
      }
   }
   return false;
}
double NormalizeVolume(double vol)
{
   double vmin  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double vmax  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double vstep = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   if(vstep <= 0) vstep = 0.01;
   vol = MathFloor(vol / vstep) * vstep;
   if(vol < vmin) return 0;
   if(vol > vmax) vol = vmax;
   return NormalizeDouble(vol, 2);
}

//+------------------------------------------------------------------+
//| เปิดไม้จริงตาม reference model: entry=ราคาตลาดตอนนี้ (Pine ใช้ close  |
//| ของแท่งยืนยัน อ้างอิงเท่านั้น), stop/target = ค่าที่ FSM คำนวณไว้แล้ว   |
//+------------------------------------------------------------------+
void OpenTrade(const int dir, const double stopPrice, const double tgtPrice)
{
   bool isLong = dir == 1;
   double entry = isLong ? SymbolInfoDouble(_Symbol, SYMBOL_ASK) : SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double risk = MathAbs(entry - stopPrice);
   if(risk <= 0)
   {
      gCnt_NoRisk++;
      return;
   }

   double riskUsd  = InpRiskMode == RISK_FIXED_USD ? InpRiskFixedUsd
                                                    : AccountInfoDouble(ACCOUNT_EQUITY) * InpRiskPct / 100.0;
   double slPoints = risk / InpRiskPointUnit;
   double lot = NormalizeVolume(riskUsd / slPoints);
   if(lot <= 0)
   {
      gCnt_LotTooSmall++;
      return;
   }

   // SL/TP ของ SELL ถูก broker เช็คกับ Ask ไม่ใช่ Bid — stopPrice/tgtPrice คำนวณมาจาก
   // ราคา Bid (high/low/close ของแท่งเป็นค่า Bid โดย default) จึงต้องบวก spread ปัจจุบัน
   // ชดเชยให้จุดที่ Ask ถูกเช็คตรงกับระดับ Bid ที่ตั้งใจไว้จริง — BUY ไม่ต้องเพราะ SL/TP
   // เช็คกับ Bid อยู่แล้วตรงกับที่คำนวณมา ไม่กระทบ lot/risk เพราะยังคำนวณจาก stopPrice เดิม
   double spread = SymbolInfoDouble(_Symbol, SYMBOL_ASK) - SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ordSl  = isLong ? stopPrice : stopPrice + spread;
   double ordTp  = isLong ? tgtPrice  : tgtPrice  + spread;

   bool ok = isLong
      ? trade.Buy(lot, _Symbol, 0, NormalizeDouble(ordSl, _Digits), NormalizeDouble(ordTp, _Digits), "AmdPo3")
      : trade.Sell(lot, _Symbol, 0, NormalizeDouble(ordSl, _Digits), NormalizeDouble(ordTp, _Digits), "AmdPo3");

   if(!ok)
   {
      gCnt_OpenFail++;
      PrintFormat("open failed: retcode=%d %s", trade.ResultRetcode(), trade.ResultRetcodeDescription());
      return;
   }

   gDir = dir;
   ulong posTicket = 0;
   gPosTicket = SelectPosition(posTicket) ? PositionGetInteger(POSITION_IDENTIFIER) : 0;
}

//+------------------------------------------------------------------+
//| จัดการไม้ที่เปิดอยู่: ปิดเองเมื่อ timeout, จำแนกผลเมื่อ broker ปิดให้   |
//| (SL/TP จริงที่วางไว้ตอนเปิดไม้ทำหน้าที่แทน "hitT/hitS" ของ Pine)      |
//+------------------------------------------------------------------+
void ClassifyClosedTrade()
{
   if(gPosTicket == 0) return;
   if(!HistorySelectByPosition(gPosTicket)) return;

   long lastReason = -1;
   datetime lastTime = 0;
   int deals = HistoryDealsTotal();
   for(int i = 0; i < deals; i++)
   {
      ulong d = HistoryDealGetTicket(i);
      if(d == 0) continue;
      long entry = HistoryDealGetInteger(d, DEAL_ENTRY);
      if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_OUT_BY) continue;
      datetime t = (datetime)HistoryDealGetInteger(d, DEAL_TIME);
      if(t >= lastTime)
      {
         lastTime = t;
         lastReason = HistoryDealGetInteger(d, DEAL_REASON);
      }
   }

   if(lastReason == DEAL_REASON_TP)
      gCnt_HitTarget++;
   else if(lastReason == DEAL_REASON_SL)
      gCnt_HitStop++;
   // ปิดเองเพราะ timeout ถูกนับที่จุดสั่งปิดใน ManageOpen() ไปแล้ว ไม่นับซ้ำที่นี่

   gPosTicket = 0;
}

void ManageOpen()
{
   ulong ticket = 0;
   if(!SelectPosition(ticket))
   {
      if(gDir != 0)
         ClassifyClosedTrade();
      gDir = 0;
      return;
   }
   if(gDir == 0) return;

   if(gBarIndex - gDistStartBar > InpDistTimeoutBars)
   {
      if(trade.PositionClose(ticket))
      {
         gCnt_Timeout++;
         gDir = 0;
         gPosTicket = 0;
      }
   }
}

//+------------------------------------------------------------------+
//| คำนวณ pivot ของแท่งที่เพิ่งยืนยัน + ลงทะเบียนเข้า array ทุกแท่ง        |
//| (มิเรอร์ Pine section 6 ที่ทำแบบ unconditional ทุกบาร์)               |
//+------------------------------------------------------------------+
void UpdateBaseSeries()
{
   gPhValid = ConfirmedPivotHigh(gPhVal);
   if(gPhValid)
      PushPivot(gPivHiV, gPivHiB, gPhVal, gBarIndex - PIVOT_LR, PIVOT_CAP);

   gPlValid = ConfirmedPivotLow(gPlVal);
   if(gPlValid)
      PushPivot(gPivLoV, gPivLoB, gPlVal, gBarIndex - PIVOT_LR, PIVOT_CAP);
}

//+------------------------------------------------------------------+
//| FSM หลัก — แปลจาก Pine section 10 ทีละ state                        |
//+------------------------------------------------------------------+
void RunFSM()
{
   // T7 เดิม: outcome ของ Dist จริงๆ ถูก broker จัดการผ่าน SL/TP ที่วางไว้
   // (ManageOpen ปิด gDir=0 เมื่อ broker ปิดไม้หรือ timeout) ที่นี่แค่ปิด cycle
   if(gState == PHASE_DIST && gDir == 0)
   {
      gState = PHASE_IDLE;
      gLastEndBar = gBarIndex;
      gRangeSet = false;
   }

   // ══════ T1: IDLE → ACCUMULATION ══════
   if(gState == PHASE_IDLE)
   {
      bool warmedUp = gBarIndex > InpStatWindow;
      double chW = DonchianWidthAt(0);
      double pctRank = PercentRankWidth(InpStatWindow);

      if(warmedUp && pctRank <= InpCompressionPct &&
         chW >= InpMinRangeWidthPct / 100.0 * CBClose(0) &&
         gBarIndex - gLastEndBar >= COOLDOWN_BARS)
      {
         int winLast = RANGE_WIN - 1;
         double tHi = HighestVal(RANGE_WIN, 1);
         double tLo = LowestVal(RANGE_WIN, 1);

         if(InpTrimTailPct > 0)
         {
            bool keepTrim = true;
            while(keepTrim && winLast > InpMinRangeBars)
            {
               double hi2 = CBHigh(0), lo2 = CBLow(0);
               for(int i = 0; i < winLast; i++)
               {
                  hi2 = MathMax(hi2, CBHigh(i));
                  lo2 = MathMin(lo2, CBLow(i));
               }
               if((tHi - tLo) - (hi2 - lo2) > InpTrimTailPct / 100.0 * (tHi - tLo))
               {
                  winLast--;
                  tHi = hi2;
                  tLo = lo2;
               }
               else
                  keepTrim = false;
            }
         }

         int candStart = gBarIndex - winLast;
         double candHigh = tHi, candLow = tLo;

         if(InpBoundaryMode == BOUNDARY_PIVOT)
         {
            bool haveHi = false, haveLo = false;
            double bestHi = 0, bestLo = 0;
            int nHi = ArraySize(gPivHiV);
            for(int j = 0; j < nHi; j++)
               if(gPivHiB[j] >= candStart)
               {
                  bestHi = haveHi ? MathMax(bestHi, gPivHiV[j]) : gPivHiV[j];
                  haveHi = true;
               }
            int nLo = ArraySize(gPivLoV);
            for(int j = 0; j < nLo; j++)
               if(gPivLoB[j] >= candStart)
               {
                  bestLo = haveLo ? MathMin(bestLo, gPivLoV[j]) : gPivLoV[j];
                  haveLo = true;
               }
            if(haveHi) candHigh = bestHi;
            if(haveLo) candLow  = bestLo;
         }

         double candW = candHigh - candLow;
         if(candW >= InpMinRangeWidthPct / 100.0 * CBClose(0))
         {
            gRangeStartBar = candStart;
            gExpiryAnchor  = candStart;
            gRangeHigh     = candHigh;
            gRangeLow      = candLow;
            gRangeWidth    = candW;
            gRangeMid      = (candHigh + candLow) / 2.0;
            gRangeAge      = winLast;
            gAtrAnchor     = AtrAt(winLast + 1);
            gRearmUsed     = false;
            gFirstSweepSide = 0;
            gCycleId++;
            gRangeSet = true;
            gState = PHASE_ACCUM;
            gCnt_RangeDetected++;
         }
      }
   }
   // ══════ T2/T3: ACCUMULATION ══════
   else if(gState == PHASE_ACCUM)
   {
      gRangeAge = gBarIndex - gRangeStartBar;
      double tolBand = InpRangeTolerance * gRangeWidth;
      bool insideRng  = CBClose(0) <= gRangeHigh && CBClose(0) >= gRangeLow;
      bool breachHigh = CBHigh(0) > gRangeHigh + tolBand;
      bool breachLow  = CBLow(0)  < gRangeLow  - tolBand;

      if(gBarIndex - gExpiryAnchor > InpMaxRangeBars)
      {
         gState = PHASE_IDLE;
         gLastEndBar = gBarIndex;
         gRangeSet = false;
      }
      else if(breachHigh && breachLow)
      {
         gState = PHASE_IDLE;
         gLastEndBar = gBarIndex;
         gRangeSet = false;
      }
      else if(breachHigh || breachLow)
      {
         int side = breachHigh ? 1 : -1;
         if(gRangeAge < InpMinRangeBars)
         {
            gState = PHASE_IDLE;
            gLastEndBar = gBarIndex;
            gRangeSet = false;
         }
         else
         {
            bool sameSideBlock = gRearmUsed && side == gFirstSweepSide;
            bool kzOK = !InpUseKillzones || InKillzone();
            double excurs = side == 1 ? CBHigh(0) - gRangeHigh : gRangeLow - CBLow(0);
            bool dpOK = InpSweepDepthPct >= 100 ||
                        excurs <= PercentileNearestRankTR(InpStatWindow, InpSweepDepthPct);
            bool liqOK = !InpRequireLiquidity || LiquidityBeyond(side);

            if(kzOK && dpOK && liqOK && !sameSideBlock)
            {
               gSweepSide = side;
               gSweepBar  = gBarIndex;
               gSweepExtreme = side == 1 ? CBHigh(0) : CBLow(0);
               if(gFirstSweepSide == 0) gFirstSweepSide = side;
               gState = PHASE_SWEEP_PENDING;
               gCnt_SweepConfirmed++;

               if(insideRng)
               {
                  gState = PHASE_MANIP;
                  gCnt_ManipConfirmed++;
               }
            }
            else if(!insideRng)
            {
               gState = PHASE_IDLE;
               gLastEndBar = gBarIndex;
               gRangeSet = false;
            }
         }
      }
      else
      {
         if(InpBoundaryMode == BOUNDARY_ABSOLUTE)
         {
            double newHi = MathMin(MathMax(gRangeHigh, CBHigh(0)), gRangeHigh + tolBand);
            double newLo = MathMax(MathMin(gRangeLow,  CBLow(0)),  gRangeLow  - tolBand);
            if(newHi != gRangeHigh || newLo != gRangeLow)
            {
               gRangeHigh  = newHi;
               gRangeLow   = newLo;
               gRangeWidth = gRangeHigh - gRangeLow;
               gRangeMid   = (gRangeHigh + gRangeLow) / 2.0;
            }
         }
         else
         {
            if(gPhValid && gBarIndex - PIVOT_LR >= gRangeStartBar &&
               gPhVal > gRangeHigh && gPhVal <= gRangeHigh + tolBand)
            {
               gRangeHigh  = gPhVal;
               gRangeWidth = gRangeHigh - gRangeLow;
               gRangeMid   = (gRangeHigh + gRangeLow) / 2.0;
            }
            if(gPlValid && gBarIndex - PIVOT_LR >= gRangeStartBar &&
               gPlVal < gRangeLow && gPlVal >= gRangeLow - tolBand)
            {
               gRangeLow   = gPlVal;
               gRangeWidth = gRangeHigh - gRangeLow;
               gRangeMid   = (gRangeHigh + gRangeLow) / 2.0;
            }
         }
      }
   }
   // ══════ T4: SWEEP_PENDING ══════
   else if(gState == PHASE_SWEEP_PENDING)
   {
      gSweepExtreme = gSweepSide == 1 ? MathMax(gSweepExtreme, CBHigh(0))
                                      : MathMin(gSweepExtreme, CBLow(0));

      if(gBarIndex - gSweepBar > InpSweepReturnBars)
      {
         gCnt_Breakout++;
         gState = PHASE_IDLE;
         gLastEndBar = gBarIndex;
         gRangeSet = false;
      }
      else
      {
         bool insideRng = CBClose(0) <= gRangeHigh && CBClose(0) >= gRangeLow;
         if(insideRng)
         {
            gState = PHASE_MANIP;
            gCnt_ManipConfirmed++;
         }
      }
   }

   // ══════ T5: MANIPULATION CONFIRMED → เปิดไม้จริง (transient เสมอ) ══════
   if(gState == PHASE_MANIP)
   {
      int dir = gSweepSide == -1 ? 1 : -1;
      bool htfOK = true;
      if(InpUseHtfBias)
      {
         double htfC = 0, htfE = 0;
         htfOK = GetHtfBias(htfC, htfE) && (dir == 1 ? htfC > htfE : htfC < htfE);
      }

      if(htfOK)
      {
         gDistDir = dir;
         gEntryPriceRef = CBClose(0);
         double fibLeg = dir == 1 ? gRangeHigh - gSweepExtreme : gSweepExtreme - gRangeLow;
         gTgtPriceRef = dir == 1 ? gRangeHigh + (InpFibExt - 1.0) * fibLeg
                                 : gRangeLow  - (InpFibExt - 1.0) * fibLeg;
         gStopPriceRef = dir == 1 ? gSweepExtreme - InpStopBufAtr * gAtrAnchor
                                  : gSweepExtreme + InpStopBufAtr * gAtrAnchor;
         gRiskR = MathMax(MathAbs(gEntryPriceRef - gStopPriceRef), SymbolInfoDouble(_Symbol, SYMBOL_POINT));
         gDistStartBar = gBarIndex;
         gCnt_DistOpened++;

         OpenTrade(dir, gStopPriceRef, gTgtPriceRef);

         gState = PHASE_DIST;
      }
      else
      {
         if(InpAllowRearm && !gRearmUsed)
         {
            gRearmUsed = true;
            gExpiryAnchor = gBarIndex;
            gState = PHASE_ACCUM;
         }
         else
         {
            gCnt_FailedManip++;
            gState = PHASE_IDLE;
            gLastEndBar = gBarIndex;
            gRangeSet = false;
         }
      }
   }
}

//+------------------------------------------------------------------+
//| คะแนนที่ optimizer ใช้จัดอันดับ — สูตรกลางใน TesterMetrics.mqh        |
//| ใช้ร่วมกับกลยุทธ์อื่นทุกตัว ไม่แก้อะไรที่นี่                          |
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

   string stem = StringFormat(
      "%s_%s_%d_%d_%d_%d_%.2f_%.2f_%d_%d_%d_%d_%d_%d_%d_%.2f_%.2f_%d_%d_%d_%d_%d_%d_%d_%.2f",
      _Symbol, tf,
      InpMinRangeBars, InpMaxRangeBars, InpCompressionPct, InpStatWindow,
      InpRangeTolerance, InpMinRangeWidthPct, (int)InpBoundaryMode, InpTrimTailPct,
      InpSweepReturnBars, (int)InpRequireLiquidity, InpSweepDepthPct, (int)InpAllowRearm,
      InpDistTimeoutBars, InpStopBufAtr, InpFibExt,
      (int)InpUseKillzones, InpKzLdnFromHour, InpKzLdnToHour, InpKzNyFromHour, InpKzNyToHour,
      (int)InpUseHtfBias, (int)InpHtfTf, InpRiskPct);
   string path = "amdpo3_opt\\" + stem + ".csv";

   int h = FileOpen(path, FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_COMMON);
   if(h == INVALID_HANDLE)
      return;

   WriteMonthlySeries("amdpo3_opt\\monthly\\" + stem + ".csv");

   FileWrite(h, StringFormat("%s;%s;%d;%d;%d;%d;%.2f;%.2f;%d;%d;%d;%d;%d;%d;%d;%.2f;%.2f;%d;%d;%d;%d;%d;%d;%d;%.2f;",
      _Symbol, tf,
      InpMinRangeBars, InpMaxRangeBars, InpCompressionPct, InpStatWindow,
      InpRangeTolerance, InpMinRangeWidthPct, (int)InpBoundaryMode, InpTrimTailPct,
      InpSweepReturnBars, (int)InpRequireLiquidity, InpSweepDepthPct, (int)InpAllowRearm,
      InpDistTimeoutBars, InpStopBufAtr, InpFibExt,
      (int)InpUseKillzones, InpKzLdnFromHour, InpKzLdnToHour, InpKzNyFromHour, InpKzNyToHour,
      (int)InpUseHtfBias, (int)InpHtfTf, InpRiskPct)
      + MetricsCsvTail(score));
   FileClose(h);
}

//+------------------------------------------------------------------+
void OnTick()
{
   ManageOpen();

   datetime barTime = iTime(_Symbol, PERIOD_CURRENT, 0);
   if(barTime == gLastBarTime)
      return;
   gLastBarTime = barTime;
   gBarIndex++;

   UpdateBaseSeries();
   RunFSM();
}
//+------------------------------------------------------------------+
