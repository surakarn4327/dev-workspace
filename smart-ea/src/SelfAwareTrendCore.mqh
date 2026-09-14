//+------------------------------------------------------------------+
//| SelfAwareTrendCore.mqh                                             |
//| ตรรกะทั้งหมดของ Self-Aware Trend System (SATS)                      |
//|                                                                    |
//| ไฟล์นี้ไม่ประกาศ input เอง อ้างถึง input ที่ EA ประกาศไว้ก่อน include  |
//| (แพทเทิร์นเดียวกับ MARibbonCore / AmdPo3Core)                       |
//+------------------------------------------------------------------+
#include "PositionLib.mqh"
#include "TesterMetrics.mqh"

// ค่าคงที่จาก constants section ของ Pine (ไม่ใช่ input เพราะต้นฉบับก็ไม่ใช่)
const int    SATS_WARMUP_FLOOR  = 50;
const int    SATS_MAX_HIST_SIGS = 100;
const double SATS_EWMA_ALPHA    = 0.2;
const double SATS_MULT_ALPHA    = 0.15;
const double SATS_TQI_FLOOR     = 0.6;  // ความกว้างแบนด์ที่คุณภาพเต็ม (TQI = 1)
const double SATS_TQI_RANGE     = 0.8;  // ความกว้างที่เพิ่มเมื่อคุณภาพแย่สุด
const double SATS_ASYM_TIGHTEN  = 0.3;
const double SATS_ASYM_WIDEN    = 0.4;
#define SATS_TQI_RING 64                // ขนาด buffer ของ TQI สำหรับ char-flip window

// ── ค่าที่ preset แปลงมาแล้ว ──
int    gAtrLen = 14;
double gBaseMult = 2.0;
int    gErLen = 20;
double gSlMult = 1.5;

int    hAtrMain = INVALID_HANDLE;

// ── สถานะ series ที่ต้องเดินต่อเนื่องแบบ Pine ──
datetime gLastBar = 0;
int      gBar = 0;

double gActiveMultSm  = 0;
double gPassiveMultSm = 0;
bool   gMultSmInit    = false;

double gLowerBand = 0, gUpperBand = 0;
double gLowerBandPrev = 0, gUpperBandPrev = 0;
bool   gBandInit  = false;
int    gStTrend   = 1;
int    gTrendStartBar = 0;

double gTqiRing[SATS_TQI_RING];
int    gTqiCount = 0;

bool   gHavePivHi = false, gHavePivLo = false;
double gLastPivHi = 0, gLastPivLo = 0;

// ── สถานะ self-learning (มิเรอร์ LearnState ของ Pine) ──
double gLearnR[];
double gEffQ = 0.4;
int    gLastShiftDir = 0;
double gAvgRAtLastShift = 0;
bool   gHaveAvgRShift = false;
int    gSignalsSinceCalib = 0;

// ── ไม้ที่ถืออยู่ (รายละเอียดฝั่ง broker อยู่ใน PositionLib) ──
double gTradeRiskUsd = 0;

// ── diagnostic ──
int gCnt_FlipUp = 0, gCnt_FlipDown = 0, gCnt_CharFlip = 0;
int gCnt_Entry = 0, gCnt_FlipExit = 0, gCnt_Timeout = 0, gCnt_NotWarm = 0;

//+------------------------------------------------------------------+
double SatsClamp(const double v, const double lo, const double hi)
{
   return MathMax(lo, MathMin(hi, v));
}
double SatsSafeDiv(const double num, const double den, const double fallback)
{
   return den != 0.0 ? num / den : fallback;
}
double SatsMapClamp(const double v, const double inLo, const double inHi,
                    const double outLo, const double outHi)
{
   double t = SatsClamp(SatsSafeDiv(v - inLo, inHi - inLo, 0.0), 0.0, 1.0);
   return outLo + t * (outHi - outLo);
}

// ราคาแท่งที่ยืนยันแล้ว — k=0 คือแท่งที่เพิ่งปิด (shift 1 จริง)
double CB_H(const int k) { return iHigh(_Symbol, PERIOD_CURRENT, 1 + k); }
double CB_L(const int k) { return iLow(_Symbol, PERIOD_CURRENT, 1 + k); }
double CB_C(const int k) { return iClose(_Symbol, PERIOD_CURRENT, 1 + k); }

//+------------------------------------------------------------------+
//| preset — มิเรอร์ section 3.5 ของ Pine                              |
//+------------------------------------------------------------------+
void SatsResolvePreset()
{
   int tfMin = PeriodSeconds(PERIOD_CURRENT) / 60;
   ENUM_SATS_PRESET p = InpPreset;
   if(p == SATS_AUTO)
      p = tfMin <= 5 ? SATS_SCALPING : (tfMin <= 240 ? SATS_DEFAULT : SATS_SWING);

   switch(p)
   {
      case SATS_SCALPING: gAtrLen = 10; gBaseMult = 1.5; gErLen = 14; gSlMult = 1.0; break;
      case SATS_DEFAULT:  gAtrLen = 14; gBaseMult = 2.0; gErLen = 20; gSlMult = 1.5; break;
      case SATS_SWING:    gAtrLen = 21; gBaseMult = 2.5; gErLen = 30; gSlMult = 2.0; break;
      case SATS_CRYPTO:   gAtrLen = 14; gBaseMult = 2.8; gErLen = 20; gSlMult = 2.5; break;
      default:
         gAtrLen   = InpAtrLen;
         gBaseMult = InpBaseMult;
         gErLen    = InpErLength;
         gSlMult   = InpSlAtrMult;
         break;
   }
}

//+------------------------------------------------------------------+
int OnInit()
{
   SatsResolvePreset();

   hAtrMain = iATR(_Symbol, PERIOD_CURRENT, gAtrLen);
   if(hAtrMain == INVALID_HANDLE)
   {
      Print("iATR handle failed");
      return INIT_FAILED;
   }

   gEffQ = InpQualityStrength;
   ArrayResize(gLearnR, 0);
   ArrayInitialize(gTqiRing, 0.0);

   gTrade.SetExpertMagicNumber(InpMagic);
   gTrade.SetTypeFillingBySymbol(_Symbol);
   gTrade.SetMarginMode();
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   PrintFormat("diag: flipUp=%d flipDown=%d charFlip=%d entry=%d flipExit=%d timeout=%d notWarm=%d | %s",
               gCnt_FlipUp, gCnt_FlipDown, gCnt_CharFlip, gCnt_Entry,
               gCnt_FlipExit, gCnt_Timeout, gCnt_NotWarm, PL_DiagString());
}

//+------------------------------------------------------------------+
//| ATR ของแท่งที่ยืนยันแล้ว + ค่าเฉลี่ย ATR (atrBaseline ของ Pine)        |
//+------------------------------------------------------------------+
double SatsAtrAt(const int k)
{
   double buf[];
   if(CopyBuffer(hAtrMain, 0, 1 + k, 1, buf) < 1)
      return 0.0;
   return buf[0];
}
double SatsAtrBaseline(const int len)
{
   double buf[];
   int got = CopyBuffer(hAtrMain, 0, 1, len, buf);
   if(got <= 0) return 0.0;
   double s = 0;
   for(int i = 0; i < got; i++) s += buf[i];
   return s / got;
}

//+------------------------------------------------------------------+
//| Efficiency Ratio — |close - close[len]| / sum(|close - close[1]|)  |
//+------------------------------------------------------------------+
double SatsEfficiencyRatio(const int len)
{
   double chg = MathAbs(CB_C(0) - CB_C(len));
   double vol = 0;
   for(int i = 0; i < len; i++)
      vol += MathAbs(CB_C(i) - CB_C(i + 1));
   return SatsSafeDiv(chg, vol, 0.0);
}

//+------------------------------------------------------------------+
//| z-score ของ tick volume (Pine ใช้ volume ของ TradingView)           |
//+------------------------------------------------------------------+
double SatsVolumeZ(const int len)
{
   double sum = 0, sum2 = 0;
   for(int i = 0; i < len; i++)
   {
      double v = (double)iVolume(_Symbol, PERIOD_CURRENT, 1 + i);
      sum  += v;
      sum2 += v * v;
   }
   double mean = sum / len;
   double var  = sum2 / len - mean * mean;
   if(var <= 0) return 0.0;
   double sd = MathSqrt(var);
   return SatsSafeDiv((double)iVolume(_Symbol, PERIOD_CURRENT, 1) - mean, sd, 0.0);
}

//+------------------------------------------------------------------+
//| pivot high/low ที่ยืนยันแล้ว (ta.pivothigh(len,len) ของ Pine)         |
//+------------------------------------------------------------------+
bool SatsPivotHigh(const int len, double &val)
{
   double c = CB_H(len);
   for(int i = 1; i <= len; i++)
   {
      if(CB_H(len - i) >= c) return false;
      if(CB_H(len + i) >= c) return false;
   }
   val = c;
   return true;
}
bool SatsPivotLow(const int len, double &val)
{
   double c = CB_L(len);
   for(int i = 1; i <= len; i++)
   {
      if(CB_L(len - i) <= c) return false;
      if(CB_L(len + i) <= c) return false;
   }
   val = c;
   return true;
}

//+------------------------------------------------------------------+
//| self-learning: บันทึกผลไม้ที่ปิดแล้วเป็น R แล้วปรับ Quality Influence   |
//| ตามอัลกอริทึม hill-climbing ของ Pine (ค่า default ปิดอยู่)             |
//|                                                                    |
//| ต่างจาก Pine: R ที่บันทึกคำนวณจาก "กำไรสุทธิจริง / ทุนเสี่ยง" ไม่ใช่จาก  |
//| โมเดลแบ่งสามส่วนในสคริปต์ — เพราะที่นี่ไม้เปิดจริง ตัวเลขจริงแม่นกว่า     |
//+------------------------------------------------------------------+
void SatsRecordR(const double r)
{
   int n = ArraySize(gLearnR);
   ArrayResize(gLearnR, n + 1);
   gLearnR[n] = r;
   if(ArraySize(gLearnR) > SATS_MAX_HIST_SIGS)
   {
      int total = ArraySize(gLearnR);
      for(int i = 0; i < total - 1; i++) gLearnR[i] = gLearnR[i + 1];
      ArrayResize(gLearnR, total - 1);
   }

   gSignalsSinceCalib++;
   if(!InpUseAutoCalib) return;
   if(ArraySize(gLearnR) < InpCalibWindow) return;
   if(gSignalsSinceCalib < InpCalibCooldown) return;

   int size = ArraySize(gLearnR);
   double sum = 0;
   for(int i = size - InpCalibWindow; i < size; i++) sum += gLearnR[i];
   double postAvgR = sum / InpCalibWindow;

   if(postAvgR < InpCalibBadR)
   {
      int dir;
      if(gLastShiftDir == 0)
         dir = 1;
      else if(!gHaveAvgRShift || postAvgR >= gAvgRAtLastShift)
         dir = gLastShiftDir;
      else
         dir = -gLastShiftDir;

      gEffQ = SatsClamp(gEffQ + dir * InpCalibStepQ, InpCalibMinQ, InpCalibMaxQ);
      gAvgRAtLastShift = postAvgR;
      gHaveAvgRShift = true;
      gLastShiftDir = dir;
      gSignalsSinceCalib = 0;
   }
   else if(postAvgR > InpCalibGoodR)
   {
      gLastShiftDir = 0;
      gAvgRAtLastShift = postAvgR;
      gHaveAvgRShift = true;
      gSignalsSinceCalib = 0;
   }
}

//+------------------------------------------------------------------+
//| TP แบบ Dynamic — section 6.35 ของ Pine                             |
//+------------------------------------------------------------------+
double SatsDynScale(const double tqi, const double volRatio)
{
   double tqiComp = SatsClamp(tqi, 0.0, 1.0);
   double volComp = SatsClamp(SatsMapClamp(volRatio, 0.5, 2.0, 0.0, 1.0), 0.0, 1.0);
   double wSum    = InpDynTpTqiWeight + InpDynTpVolWeight;
   double wDenom  = wSum > 0 ? wSum : 1.0;
   double raw     = (tqiComp * InpDynTpTqiWeight + volComp * InpDynTpVolWeight) / wDenom;
   return InpDynTpMinScale + raw * (InpDynTpMaxScale - InpDynTpMinScale);
}

//+------------------------------------------------------------------+
double SatsRiskUsd()
{
   return InpRiskMode == SATS_RISK_USD ? InpRiskFixedUsd
                                       : AccountInfoDouble(ACCOUNT_EQUITY) * InpRiskPct / 100.0;
}

//+------------------------------------------------------------------+
//| เปิดไม้ตามสัญญาณ flip — SL/TP มิเรอร์ section 7.5 ของ Pine           |
//+------------------------------------------------------------------+
void SatsOpen(const int dir, const double atrValue, const double tqi, const double volRatio)
{
   double entry = CB_C(0); // Pine ใช้ close ของแท่งยืนยันเป็นราคาอ้างอิง

   double tSl;
   if(dir == 1)
   {
      double slBase = gHavePivLo ? gLastPivLo : CB_L(0);
      double rawSl  = slBase - gSlMult * atrValue;
      double minSl  = entry - gSlMult * atrValue;
      tSl = MathMin(rawSl, minSl);
      double slCap = MathMax(InpSlMaxDist, gSlMult) * atrValue;
      tSl = MathMax(tSl, entry - slCap);
   }
   else
   {
      double slBase = gHavePivHi ? gLastPivHi : CB_H(0);
      double rawSl  = slBase + gSlMult * atrValue;
      double minSl  = entry + gSlMult * atrValue;
      tSl = MathMax(rawSl, minSl);
      double slCap = MathMax(InpSlMaxDist, gSlMult) * atrValue;
      tSl = MathMin(tSl, entry + slCap);
   }

   double risk = MathAbs(entry - tSl);
   if(risk <= 0) return;

   // TP order auto-fix ของ Pine: บังคับให้ tp1 <= tp2 <= tp3 เสมอ
   double a = InpTp1R, b = InpTp2R, c = InpTp3R;
   double r1 = MathMin(a, MathMin(b, c));
   double r3 = MathMax(a, MathMax(b, c));
   double r2 = a + b + c - r1 - r3;

   if(InpTpMode == SATS_TP_DYNAMIC)
   {
      double scale = SatsDynScale(tqi, volRatio);
      double f1 = MathMin(InpDynTpFloorR1, InpDynTpCeilR3);
      double f2 = MathMin(InpDynTpFloorR1 * (r2 / MathMax(r1, 0.01)), InpDynTpCeilR3);
      double f3 = MathMin(InpDynTpFloorR1 * (r3 / MathMax(r1, 0.01)), InpDynTpCeilR3);
      double e1 = SatsClamp(r1 * scale, f1, InpDynTpCeilR3);
      double e2 = SatsClamp(r2 * scale, f2, InpDynTpCeilR3);
      double e3 = SatsClamp(r3 * scale, f3, InpDynTpCeilR3);
      r1 = MathMin(e1, MathMin(e2, e3));
      r3 = MathMax(e1, MathMax(e2, e3));
      r2 = e1 + e2 + e3 - r1 - r3;
   }

   double tp1 = dir == 1 ? entry + risk * r1 : entry - risk * r1;
   double tp2 = dir == 1 ? entry + risk * r2 : entry - risk * r2;
   double tp3 = dir == 1 ? entry + risk * r3 : entry - risk * r3;

   gTradeRiskUsd = SatsRiskUsd();
   if(PL_Open(dir, tSl, tp1, tp2, tp3, gTradeRiskUsd, InpRiskPointUnit,
              InpMagic, "SATS", false, gBar))
      gCnt_Entry++;
}

//+------------------------------------------------------------------+
//| ปิดไม้แล้วบันทึกผลเป็น R เข้า self-learning                           |
//+------------------------------------------------------------------+
void SatsRecordClosedPosition()
{
   if(gMtPosId == 0 || gTradeRiskUsd <= 0) return;
   if(!HistorySelectByPosition((long)gMtPosId)) return;
   double net = 0;
   int deals = HistoryDealsTotal();
   for(int i = 0; i < deals; i++)
   {
      ulong d = HistoryDealGetTicket(i);
      if(d == 0) continue;
      long entry = HistoryDealGetInteger(d, DEAL_ENTRY);
      if(entry == DEAL_ENTRY_IN) continue;
      net += HistoryDealGetDouble(d, DEAL_PROFIT)
           + HistoryDealGetDouble(d, DEAL_SWAP)
           + HistoryDealGetDouble(d, DEAL_COMMISSION);
   }
   SatsRecordR(net / gTradeRiskUsd);
}

//+------------------------------------------------------------------+
//| เดิน series ทั้งหมดหนึ่งแท่ง แล้วตัดสินใจเข้า/ออก                      |
//+------------------------------------------------------------------+
void SatsOnBar()
{
   int warmup = MathMax(SATS_WARMUP_FLOOR,
                MathMax(gAtrLen, MathMax(InpAtrBaselineLen,
                MathMax(gErLen, MathMax(InpVolLen,
                MathMax(InpPivotLen * 2 + 1,
                MathMax(InpTqiMomLen, InpTqiStructLen))))))) + 10;
   if(gBar < warmup + 5)
   {
      gCnt_NotWarm++;
      return;
   }

   // ── pivot (ใช้เป็นฐาน SL) ──
   double pv = 0;
   if(SatsPivotHigh(InpPivotLen, pv)) { gLastPivHi = pv; gHavePivHi = true; }
   if(SatsPivotLow(InpPivotLen, pv))  { gLastPivLo = pv; gHavePivLo = true; }

   // ── ฐานคำนวณ ──
   double rawAtr = SatsAtrAt(0);
   if(rawAtr <= 0) return;
   double atrBaseline = SatsAtrBaseline(InpAtrBaselineLen);
   double volRatio = SatsSafeDiv(rawAtr, atrBaseline, 1.0);
   double erValue  = SatsEfficiencyRatio(gErLen);
   double atrValue = InpUseEffAtr ? rawAtr * (0.5 + 0.5 * erValue) : rawAtr;

   // ── TQI 4 องค์ประกอบ ──
   double tqiEr = SatsClamp(erValue, 0.0, 1.0);
   double volZ  = SatsVolumeZ(InpVolLen);
   double tqiVol = SatsMapClamp(volZ, -1.0, 2.0, 0.0, 1.0);

   int idxHi = iHighest(_Symbol, PERIOD_CURRENT, MODE_HIGH, InpTqiStructLen, 1);
   int idxLo = iLowest(_Symbol, PERIOD_CURRENT, MODE_LOW, InpTqiStructLen, 1);
   double structHi = idxHi < 0 ? CB_H(0) : iHigh(_Symbol, PERIOD_CURRENT, idxHi);
   double structLo = idxLo < 0 ? CB_L(0) : iLow(_Symbol, PERIOD_CURRENT, idxLo);
   double pricePos = SatsSafeDiv(CB_C(0) - structLo, structHi - structLo, 0.5);
   double tqiStruct = SatsClamp(MathAbs(pricePos - 0.5) * 2.0, 0.0, 1.0);

   double windowChange = CB_C(0) - CB_C(InpTqiMomLen);
   double upMoves = 0, downMoves = 0;
   for(int i = 0; i < InpTqiMomLen; i++)
   {
      if(CB_C(i) > CB_C(i + 1)) upMoves += 1.0;
      if(CB_C(i) < CB_C(i + 1)) downMoves += 1.0;
   }
   double tqiMom = windowChange > 0 ? upMoves / InpTqiMomLen
                 : (windowChange < 0 ? downMoves / InpTqiMomLen : 0.0);

   double wSum = InpTqiWeightEr + InpTqiWeightVol + InpTqiWeightStruct + InpTqiWeightMom;
   double wDen = wSum > 0 ? wSum : 1.0;
   double tqiRaw = InpUseTqi ? (tqiEr * InpTqiWeightEr + tqiVol * InpTqiWeightVol +
                                tqiStruct * InpTqiWeightStruct + tqiMom * InpTqiWeightMom) / wDen
                             : 0.5;
   double tqi = SatsClamp(tqiRaw, 0.0, 1.0);

   // เก็บ TQI ลง ring buffer (ใช้หา highest ในหน้าต่าง char-flip)
   for(int i = SATS_TQI_RING - 1; i > 0; i--) gTqiRing[i] = gTqiRing[i - 1];
   gTqiRing[0] = tqi;
   if(gTqiCount < SATS_TQI_RING) gTqiCount++;

   // ── ตัวคูณแบนด์ ──
   double legacyAdapt = InpUseAdaptive ? (1.0 + InpAdaptStrength * (0.5 - erValue)) : 1.0;
   if(!InpUseAutoCalib) gEffQ = InpQualityStrength;

   double qualityDev = InpUseTqi ? MathPow(1.0 - tqi, InpQualityCurve) : 0.5;
   double tqiMult = 1.0 - gEffQ + gEffQ * (SATS_TQI_FLOOR + SATS_TQI_RANGE * qualityDev);
   double symMult = gBaseMult * legacyAdapt * tqiMult;

   double activeRaw = symMult, passiveRaw = symMult;
   if(InpUseTqi && InpUseAsymBands)
   {
      activeRaw  = symMult * (1.0 - InpAsymStrength * tqi * SATS_ASYM_TIGHTEN);
      passiveRaw = symMult * (1.0 + InpAsymStrength * tqi * SATS_ASYM_WIDEN);
   }

   if(!gMultSmInit)
   {
      gActiveMultSm  = activeRaw;
      gPassiveMultSm = passiveRaw;
      gMultSmInit = true;
   }
   else if(InpMultSmooth)
   {
      gActiveMultSm  = gActiveMultSm  * (1.0 - SATS_MULT_ALPHA) + activeRaw  * SATS_MULT_ALPHA;
      gPassiveMultSm = gPassiveMultSm * (1.0 - SATS_MULT_ALPHA) + passiveRaw * SATS_MULT_ALPHA;
   }
   else
   {
      gActiveMultSm  = activeRaw;
      gPassiveMultSm = passiveRaw;
   }

   // ── SuperTrend แบบไม่สมมาตร ──
   int prevTrend = gStTrend;
   double lowerMult = prevTrend == 1 ? gActiveMultSm  : gPassiveMultSm;
   double upperMult = prevTrend == 1 ? gPassiveMultSm : gActiveMultSm;

   double src = CB_C(0);
   double lowerRaw = src - lowerMult * atrValue;
   double upperRaw = src + upperMult * atrValue;

   gLowerBandPrev = gLowerBand;
   gUpperBandPrev = gUpperBand;

   if(!gBandInit)
   {
      gLowerBand = lowerRaw;
      gUpperBand = upperRaw;
      gLowerBandPrev = lowerRaw;
      gUpperBandPrev = upperRaw;
      gBandInit = true;
   }
   else
   {
      double closePrev = CB_C(1);
      gLowerBand = closePrev > gLowerBandPrev ? MathMax(lowerRaw, gLowerBandPrev) : lowerRaw;
      gUpperBand = closePrev < gUpperBandPrev ? MathMin(upperRaw, gUpperBandPrev) : upperRaw;
   }

   bool priceFlipUp   = prevTrend == -1 && src > gUpperBandPrev;
   bool priceFlipDown = prevTrend ==  1 && src < gLowerBandPrev;

   int trendAge = gBar - gTrendStartBar;
   int cfWindow = MathMax(InpCharFlipMinAge, 3);
   double tqiWinHigh = 0;
   int lim = MathMin(cfWindow, gTqiCount);
   for(int i = 0; i < lim; i++) tqiWinHigh = MathMax(tqiWinHigh, gTqiRing[i]);

   bool cfBase = InpUseCharFlip && InpUseTqi && trendAge >= InpCharFlipMinAge &&
                 tqiWinHigh > InpCharFlipHigh && tqi < InpCharFlipLow;
   bool charFlipDown = cfBase && prevTrend ==  1 && src < CB_C(cfWindow);
   bool charFlipUp   = cfBase && prevTrend == -1 && src > CB_C(cfWindow);

   bool finalFlipUp   = priceFlipUp   || charFlipUp;
   bool finalFlipDown = priceFlipDown || charFlipDown;

   gStTrend = finalFlipUp ? 1 : (finalFlipDown ? -1 : prevTrend);
   if(gStTrend != prevTrend)
      gTrendStartBar = gBar;

   bool flipUp   = gStTrend ==  1 && prevTrend == -1;
   bool flipDown = gStTrend == -1 && prevTrend ==  1;
   if(flipUp)   gCnt_FlipUp++;
   if(flipDown) gCnt_FlipDown++;
   if((charFlipUp && !priceFlipUp && flipUp) || (charFlipDown && !priceFlipDown && flipDown))
      gCnt_CharFlip++;

   // ── timeout ของไม้ที่เปิดอยู่ (Pine แค่บันทึกผล ที่นี่ต้องปิดจริง) ──
   if(gMtDir != 0 && gBar - gMtOpenBar >= InpTradeMaxAge)
   {
      PL_CloseAll(InpMagic);
      SatsRecordClosedPosition();
      gMtPosId = 0;
      gCnt_Timeout++;
   }

   // ── flip-exit: สัญญาณตรงข้ามปิดไม้เดิมก่อนเสมอ ──
   if(gMtDir != 0 && ((gMtDir == 1 && flipDown) || (gMtDir == -1 && flipUp)))
   {
      PL_CloseAll(InpMagic);
      SatsRecordClosedPosition();
      gMtPosId = 0;
      gCnt_FlipExit++;
   }

   if(gMtDir == 0 && (flipUp || flipDown))
      SatsOpen(flipUp ? 1 : -1, atrValue, tqi, volRatio);
}

//+------------------------------------------------------------------+
void OnTick()
{
   // ไม้ปิดเองโดย broker (SL/TP) → บันทึกผลเข้า self-learning ก่อนรีเซ็ต
   if(gMtDir != 0 && !PL_HasPosition(InpMagic))
      SatsRecordClosedPosition();

   PL_Manage(InpMagic, false, false, false);

   datetime t = iTime(_Symbol, PERIOD_CURRENT, 0);
   if(t == gLastBar) return;
   gLastBar = t;
   gBar++;

   SatsOnBar();
}

//+------------------------------------------------------------------+
double OnTester()
{
   double score = ConsistencyScore(InpMinTrades, InpMinProfit);
   if(InpDumpPasses)
      DumpPass(score);
   return score;
}

//+------------------------------------------------------------------+
void DumpPass(const double score)
{
   string tf = StringSubstr(EnumToString((ENUM_TIMEFRAMES)Period()), 7);
   string stem = StringFormat("%s_%s_p%d_atr%d_bm%.2f_q%.2f_qc%.2f_sl%.2f_slmx%.1f_tp%.1f-%.1f-%.1f_"
      "tpm%d_age%d_cfa%d_cfh%.2f_cfl%.2f_asym%.2f_r%.2f",
      _Symbol, tf, (int)InpPreset, gAtrLen, gBaseMult, InpQualityStrength, InpQualityCurve, gSlMult,
      InpSlMaxDist, InpTp1R, InpTp2R, InpTp3R, (int)InpTpMode, InpTradeMaxAge, InpCharFlipMinAge,
      InpCharFlipHigh, InpCharFlipLow, InpAsymStrength, InpRiskPct);
   string path = "sats_opt\\" + stem + ".csv";

   int h = FileOpen(path, FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_COMMON);
   if(h == INVALID_HANDLE) return;

   WriteMonthlySeries("sats_opt\\monthly\\" + stem + ".csv");

   // หมายเหตุ: ทุกพารามิเตอร์ที่เคยใส่ช่วงค่าใน .set ต้องอยู่ในชื่อไฟล์ (ด้านบน) ด้วยเสมอ
   // (บั๊ก 2026-09-11 ใน bugs.md — ไม่งั้นชุดที่ต่างกันจะทับกันเงียบๆ) คอลัมน์ CSV ด้านล่างนี้
   // เพิ่ม InpCharFlipMinAge/High/Low และ InpAsymStrength เข้ามาด้วยเหตุผลเดียวกัน
   FileWrite(h, StringFormat("%s;%s;%d;%d;%.2f;%.2f;%.2f;%.2f;%.2f;%.1f;%.1f;%.1f;%d;%d;%d;%.2f;%.2f;%.2f;%.2f;",
      _Symbol, tf, (int)InpPreset, gAtrLen, gBaseMult, InpQualityStrength, InpQualityCurve,
      gSlMult, InpSlMaxDist, InpTp1R, InpTp2R, InpTp3R, InpTradeMaxAge,
      (int)InpTpMode, InpCharFlipMinAge, InpCharFlipHigh, InpCharFlipLow, InpAsymStrength,
      InpRiskPct) + MetricsCsvTail(score));
   FileClose(h);
}
//+------------------------------------------------------------------+
