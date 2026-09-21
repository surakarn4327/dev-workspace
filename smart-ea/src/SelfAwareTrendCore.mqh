//+------------------------------------------------------------------+
//| SelfAwareTrendCore.mqh                                             |
//| ตรรกะทั้งหมดของ Self-Aware Trend System (SATS)                      |
//|                                                                    |
//| ไฟล์นี้ไม่ประกาศ input เอง อ้างถึง input ที่ EA ประกาศไว้ก่อน include  |
//| (แพทเทิร์นเดียวกับ MARibbonCore / AmdPo3Core)                       |
//+------------------------------------------------------------------+
#include "PositionLib.mqh"
#include "TesterMetrics.mqh"

// เวอร์ชันของ core นี้ — โชว์บน dashboard กันสับสนว่า EA ที่รันอยู่บนชาร์ตเป็นโค้ดล่าสุดหรือยัง
// (อัปเดตคู่กับทุกครั้งที่แก้ SelfAwareTrendCore.mqh/PositionLib.mqh แล้ว compile ใหม่จริง)
#define SATS_VERSION "1.2"
#define SATS_UPDATED "18/09/26"

// ค่าคงที่จาก constants section ของ Pine (ไม่ใช่ input เพราะต้นฉบับก็ไม่ใช่)
const int    SATS_WARMUP_FLOOR  = 50;
const int    SATS_MAX_HIST_SIGS = 100;
const double SATS_EWMA_ALPHA    = 0.2;
const double SATS_MULT_ALPHA    = 0.15;
const double SATS_TQI_FLOOR     = 0.6;  // ความกว้างแบนด์ที่คุณภาพเต็ม (TQI = 1)
const double SATS_TQI_RANGE     = 0.8;  // ความกว้างที่เพิ่มเมื่อคุณภาพแย่สุด
const double SATS_ASYM_TIGHTEN  = 0.3;
const double SATS_ASYM_WIDEN    = 0.4;
// เกณฑ์ความปลอดภัยของ "เข้าไม้ย้อนหลัง" (catch-up) — ป้องกัน lot พองผิดปกติเวลาราคาที่แตะโซน
// entry↔SL ดันไปแตะใกล้ SL เดิมมากกว่าใกล้ entry เดิม (ระยะเสี่ยงจริงแคบกว่าที่ตั้งใจไว้มาก
// lot ที่คำนวณจาก riskUsd/ระยะ เลยพองขึ้นมหาศาลแบบไม่มีเพดาน) — ยืนยันจาก log จริง 2026-09-16:
// เจอ order ที่ถูกปฏิเสธเพราะ margin ไม่พอ lot 200/47/110 ก่อนที่ 32.3 lot จะหลุดผ่านไปได้จริง
// ต่ำกว่าเกณฑ์นี้ = ถือว่าสัญญาณหมดสิทธิ์ ไม่เข้าไม้ ไม่ลองซ้ำ (ดู bugs.md 2026-09-16)
const double SATS_CATCHUP_MIN_RISK_FRAC = 0.5;
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

// heartbeat: เวลาระบบ (ms, ไม่อิง server time เผื่อ server time เองก็ค้าง) ของ tick ล่าสุด
// เช็คผ่าน OnTimer() ซึ่งทำงานเองไม่พึ่ง OnTick — ถ้า OnTick ไม่ถูกเรียกเลย (EA แขวน/data feed
// หลุด) OnTimer ยังทำงานต่อได้ จึงจับ "ค้าง" ได้จริง ต่างจากเช็คใน OnTick เองที่ไม่ทำงานตอนค้างพอดี
ulong gLastTickMs = 0;
const int SATS_HEARTBEAT_MAX_SEC = 120; // ผู้ใช้เลือกไว้ 2026-09-17

// จำนวนบาร์ที่ต้องเลื่อนย้อนจาก "ปัจจุบันจริง" ไปอีก — ใช้ตอน history replay ใน OnInit
// (SatsReplayHistory) เพื่อไล่คำนวณ indicator/trend ย้อนหลังด้วยฟังก์ชันชุดเดียวกับตอนรันสด
// โดยไม่ต้องเขียนสูตรซ้ำ ตอนรันสดค่านี้ต้องเป็น 0 เสมอ
int      gAsOf = 0;

// ── สัญญาณที่พลาดไป (พบจาก history replay ตอน OnInit) — รอเข้าไม้ย้อนหลังได้ครั้งเดียว
// ถ้าราคาวิ่งกลับมาแตะช่วง entry↔SL ก่อนจะ timeout/โดน SL/โดน TP1/มี flip ใหม่ทับ ──
bool     gHavePending  = false;
int      gPendingDir   = 0;
double   gPendingEntry = 0;
double   gPendingSl    = 0;
double   gPendingTp1   = 0;
double   gPendingTp2   = 0;
double   gPendingTp3   = 0;
// เวลาที่แท่งซึ่งเกิดสัญญาณนี้ปิด — ใช้เช็คตอน OnInit ว่ามีไม้จริงเข้าไปแล้วหลังจากนี้หรือยัง (กันบั๊ก
// สัญญาณ "ฟื้น" ซ้ำหลัง reattach ทั้งที่ไม้จริงจากสัญญาณเดียวกันเคยเข้า+ปิดจบไปแล้ว ดู bugs.md 2026-09-18)
datetime gPendingSignalTime = 0;

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
int gCnt_Entry = 0, gCnt_FlipExit = 0, gCnt_Timeout = 0, gCnt_NotWarm = 0, gCnt_CutoffClose = 0;

// ── วาดเส้นแบนด์ (ฝั่งที่ trend ยืนอยู่ — เส้นเดียวกับที่ราคาต้องทะลุถึงจะ flip) ──
// ไม่กระทบตรรกะเทรดเลย เป็นแค่ภาพ เปิด/ปิดได้ที่ InpShowChartObjects
datetime gPrevBandTime  = 0;
double   gPrevBandValue = 0;
int      gBandSegIdx    = 0;

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
// บวก gAsOf เข้าไปเสมอ: ตอนรันสด gAsOf=0 เหมือนเดิมทุกอย่าง ตอน replay ประวัติ gAsOf>0
// ทำให้ "แท่งที่กำลังพิจารณา" เลื่อนย้อนไปตามจำนวนบาร์ที่ต้องการ
double CB_H(const int k) { return iHigh(_Symbol, PERIOD_CURRENT, gAsOf + 1 + k); }
double CB_L(const int k) { return iLow(_Symbol, PERIOD_CURRENT, gAsOf + 1 + k); }
double CB_C(const int k) { return iClose(_Symbol, PERIOD_CURRENT, gAsOf + 1 + k); }

//+------------------------------------------------------------------+
//| ต่อเส้นแบนด์ (ฝั่ง active ตาม trend) เป็นท่อนๆ ทีละแท่ง — ชื่อ object     |
//| วนซ้ำทุก InpChartBandBars ท่อน กันไม่ให้ object พอกพูนไม่จำกัด          |
//| เรียกทั้งตอน replay ประวัติ (backfill เส้นย้อนหลังทันทีที่ attach) และ   |
//| ตอนรันสด — ใช้ path เดียวกันเพราะ SatsComputeSignal เดินตามลำดับเวลา    |
//| อยู่แล้ว (replay: เก่า→ใหม่, สด: บาร์ใหม่ล่าสุด)                        |
//+------------------------------------------------------------------+
void SatsRecordBandPoint(const datetime t, const double val, const int trend)
{
   if(gPrevBandTime != 0 && t != gPrevBandTime)
   {
      string prefix = "SATS_" + IntegerToString(InpMagic) + "_";
      int slot = gBandSegIdx % MathMax(InpChartBandBars, 10);
      string name = prefix + "band_" + IntegerToString(slot);
      color clr = trend == 1 ? clrLime : clrRed;

      if(ObjectFind(0, name) < 0)
         ObjectCreate(0, name, OBJ_TREND, 0, gPrevBandTime, gPrevBandValue, t, val);
      else
      {
         ObjectMove(0, name, 0, gPrevBandTime, gPrevBandValue);
         ObjectMove(0, name, 1, t, val);
      }
      ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
      ObjectSetInteger(0, name, OBJPROP_WIDTH, 2);
      ObjectSetInteger(0, name, OBJPROP_RAY_RIGHT, false);
      ObjectSetInteger(0, name, OBJPROP_RAY_LEFT, false);
      ObjectSetInteger(0, name, OBJPROP_STYLE, STYLE_SOLID);
      ObjectSetInteger(0, name, OBJPROP_BACK, true);
      ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
      gBandSegIdx++;
   }
   gPrevBandTime  = t;
   gPrevBandValue = val;
}

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
   TG_LoadConfig(); // เช็ค/พิมพ์ log ทันทีว่าหา token/chat id เจอไหม แทนที่จะรอ event แรกเกิดก่อน

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

   gLastTickMs = GetTickCount64();
   EventSetTimer(30); // เช็ค heartbeat ทุก 30 วิ (ไม่ต้องถี่กว่านี้ เกณฑ์ค้างคือ 2 นาที)

   // SatsReplayHistory() มีไว้แก้ปัญหา "ไม้พลาด" ตอน reattach บัญชีจริง/demo เท่านั้น (ไล่ย้อนหลัง
   // หาสัญญาณที่เกิดช่วง EA ปิดอยู่) — ใน Strategy Tester ไม่มี "ช่วงที่ EA หายไป" ให้ไล่ตามจริง
   // (เริ่มจากบาร์ 0 ใหม่ทุก pass) รันแบบไม่มีเงื่อนไขจึงเปลืองเวลาทุก pass โดยไม่มีประโยชน์ ยิ่ง
   // InpTradeMaxAge สูงยิ่งช้า (ดู bugs.md 2026-09-18) — ข้ามทั้ง 2 จุดนี้เมื่อรันใน Tester/Optimization
   if(!MQLInfoInteger(MQL_TESTER))
   {
      // handle ATR ที่เพิ่งสร้างอาจยังคำนวณ buffer ไม่ครบทันที (พบบ่อยตอน attach ใหม่ๆ) —
      // รอให้พร้อมก่อน replay ไม่งั้น SatsAtrAt จะได้ 0 แล้วโดนตีความว่า "ไม่มีสัญญาณ" ผิดๆ
      int wantBars = iBars(_Symbol, PERIOD_CURRENT);
      int waited = 0;
      while(BarsCalculated(hAtrMain) < wantBars - 2 && waited < 100)
      {
         Sleep(50);
         waited++;
      }

      SatsReplayHistory();
   }
   // ต้อง sync หลัง replay เสมอ (replay จำลองไม้เสมือนจากศูนย์ ไม่รู้จักไม้จริง — ถ้า sync
   // ก่อน replay จะโดน gMtOpenBar ที่ replay ไม่ได้แตะอยู่แล้วก็จริง แต่ปลอดภัยกว่าให้ sync
   // เป็นขั้นตอนสุดท้ายเสมอ กันโค้ดในอนาคตมาแทรกระหว่างกลางแล้วลืมลำดับ)
   bool hasRealPosition = PL_SyncOpenPosition(InpMagic, gBar);
   // ไม่รู้ riskUsd จริงที่ใช้ตอนเปิดไม้นี้ (เปิดไปก่อน EA รอบนี้จะรัน) — ย้อนคำนวณจาก lot/SL
   // แทน (สูตรกลับของ PL_Lot: riskUsd = lot * slDistPoints) ไว้โชว์ log ให้พอเทียบเคียงได้
   if(hasRealPosition)
      gTradeRiskUsd = gMtLot * (MathAbs(gMtEntry - gMtSlInit) / InpRiskPointUnit);

   string tfStr = StringSubstr(EnumToString((ENUM_TIMEFRAMES)Period()), 7);
   PrintFormat("--- SATS เริ่มทำงาน (%s %s) ---", _Symbol, tfStr);

   if(hasRealPosition)
      PrintFormat("มีไม้เปิดอยู่แล้ว: %s : %s | SL : %s | Lot : %.2f | Risk : %.2f | Balance : %.2f",
                  PL_DirStr(gMtDir), DoubleToString(gMtEntry, _Digits), DoubleToString(gMtSlInit, _Digits),
                  gMtLot, gTradeRiskUsd, AccountInfoDouble(ACCOUNT_BALANCE));
   else
      Print("ไม่มีไม้เปิดอยู่ตอนนี้");

   // แก้บั๊ก 2026-09-16: SatsReplayHistory() จำลองไม้เสมือนจากประวัติราคาล้วนๆ ไม่รู้จักไม้จริงที่
   // เปิดอยู่ในบัญชีเลย — ถ้า reattach ตอนที่มีไม้จริงเปิดอยู่ (ยังไม่โดน SL/TP) replay จะคำนวณ
   // สัญญาณเดียวกันได้อีกชุด (ใช้สูตร+ราคาชุดเดียวกัน) แล้วเก็บเป็น "เงาซ้ำ" ของไม้จริงไว้ใน
   // gHavePending โดยไม่รู้ตัว — เงานี้ถูกกัน SatsTryCatchup ไม่ให้ทำงานไว้ชั่วคราว (เพราะเช็ค
   // gMtDir!=0) แต่พอไม้จริงปิดจริง (โดน SL/TP/timeout) ไม่ว่าจะจบยังไง เงานี้จะ "ฟื้น" ขึ้นมา
   // เข้าไม้ซ้ำ setup เดิมที่เพิ่งจบไปทันที (ยืนยันจาก log จริง 08:20 — SL เดียวกับไม้ที่เพิ่งปิด
   // เป๊ะ, เข้าไม้ซ้ำภายใน 2 วินาที) — เคลียร์เงานี้ทิ้งทันทีถ้ามีไม้จริงเปิดอยู่แล้ว เพราะ pending
   // ไม่มีเหตุผลต้องมีอยู่พร้อมกับไม้จริงเลย (กลยุทธ์นี้ถือได้ไม้เดียว)
   if(hasRealPosition && gHavePending)
   {
      Print("มีสัญญาณเก่าที่ซ้ำกับไม้ที่เปิดอยู่แล้ว จึงยกเลิกสัญญาณนั้นทิ้ง");
      gHavePending = false;
   }
   // แก้บั๊ก 2026-09-18: เคสข้างบน (hasRealPosition) ครอบคลุมแค่ตอนไม้จริงยัง "เปิดอยู่" ตอน reattach
   // แต่ถ้าไม้จริงจากสัญญาณเดียวกันเข้าไปแล้ว "ปิดจบไปก่อน" reattach (โดน SL/TP/timeout ไปแล้ว)
   // hasRealPosition จะเป็น false ทำให้เช็คข้างบนไม่จับ — สัญญาณ replay ฟื้นซ้ำเข้าไม้ setup เดิมที่จบ
   // ไปแล้วอีกรอบ (เจอจริง 2026-09-18: ไม้หลักโดน SL ไปแล้ว แต่ reattach แล้วเข้าไม้ย้อนหลังซ้ำที่ราคา
   // ตลาดตอนนั้นซึ่งอยู่ชิดขอบ SL เดิมมาก ทำให้ lot พองผิดปกติ (60+ lot) — ดู bugs.md) เช็คประวัติ
   // ดีลจริงว่ามีไม้เข้าเกิดขึ้นหลังจากสัญญาณนี้เกิดหรือยัง ถ้ามีแปลว่าถูกเทรดไปแล้วจริง ไม่ว่าผลจะเป็น
   // ยังไง ไม่ควรฟื้นกลับมาเข้าซ้ำอีก
   else if(gHavePending && PL_HasEntrySince(InpMagic, gPendingSignalTime))
   {
      Print("สัญญาณเก่าถูกเทรดไปแล้วจริงตั้งแต่ก่อน reattach (เจอไม้เข้าในประวัติหลังจากสัญญาณนี้เกิด) — ยกเลิกทิ้ง กันเข้าไม้ซ้ำ setup เดิม");
      gHavePending = false;
   }
   else if(gHavePending)
      PrintFormat("พบสัญญาณเก่าที่พลาดไป: %s : %s | SL : %s — กำลังรอราคาย้อนมาเพื่อเข้าไม้ย้อนหลัง",
                  PL_DirStr(gPendingDir), DoubleToString(gPendingEntry, _Digits), DoubleToString(gPendingSl, _Digits));
   else
      Print("ไม่มีสัญญาณเก่าที่พลาดไปรออยู่");

   if(InpShowChartObjects)
   {
      int objCount = 0;
      string prefix = "SATS_" + IntegerToString(InpMagic) + "_";
      for(int i = ObjectsTotal(0) - 1; i >= 0; i--)
         if(StringFind(ObjectName(0, i), prefix) == 0) objCount++;
      if(objCount > 0)
         Print("วาดกราฟเสร็จแล้ว");
      else
      {
         Print("⚠️ วาดกราฟไม่สำเร็จ — รอสักครู่แล้วลบ/เพิ่ม EA ใหม่");
         gLastProblem = "วาดกราฟไม่สำเร็จ";
      }
      ChartRedraw();
   }

   if(InpShowDashboard)
      SatsDrawDashboard();
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| รวมกำไร/ขาดทุนที่ปิดจริงแล้ว + จำนวนไม้ที่เปิดตั้งแต่ต้น "วันเทรด" ปัจจุบัน  |
//| (แบ่งวันตาม cutoff ไม่ใช่เที่ยงคืนปฏิทิน) — ใช้โชว์บน dashboard เท่านั้น    |
//+------------------------------------------------------------------+
void SatsComputeTodayStats(double &profitOut, int &tradesOut)
{
   profitOut = 0;
   tradesOut = 0;
   datetime dayStart = PL_TradingDayStart(InpCutoffServerHour);
   if(!HistorySelect(dayStart, TimeCurrent())) return;

   int deals = HistoryDealsTotal();
   for(int i = 0; i < deals; i++)
   {
      ulong d = HistoryDealGetTicket(i);
      if(d == 0) continue;
      if(HistoryDealGetString(d, DEAL_SYMBOL) != _Symbol) continue;
      if(HistoryDealGetInteger(d, DEAL_MAGIC) != InpMagic) continue;

      long entry = HistoryDealGetInteger(d, DEAL_ENTRY);
      if(entry == DEAL_ENTRY_IN)
         tradesOut++;
      else if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_OUT_BY)
         profitOut += HistoryDealGetDouble(d, DEAL_PROFIT)
                    + HistoryDealGetDouble(d, DEAL_SWAP)
                    + HistoryDealGetDouble(d, DEAL_COMMISSION);
   }
}

//+------------------------------------------------------------------+
//| พาเนลสรุปสถานะมุมซ้ายบนของชาร์ต — รวม Trade tab + Experts tab ไว้ที่เดียว |
//| (ผู้ใช้ขอ 2026-09-17 ไม่ต้องสลับแท็บไปมา) throttle ไว้ 2 วิ/ครั้ง กัน       |
//| ObjectCreate/HistorySelect ถี่เกินไปตอนรันสด                          |
//+------------------------------------------------------------------+
void SatsDrawDashboard()
{
   static datetime lastDraw = 0;
   if(TimeCurrent() - lastDraw < 2) return;
   lastDraw = TimeCurrent();

   string prefix = "SATSDASH_" + IntegerToString(InpMagic) + "_";
   PL_ClearChartObjects(prefix);

   string curr = AccountInfoString(ACCOUNT_CURRENCY);
   StringToLower(curr);

   // แก้บั๊ก 2026-09-17: เดิม anchor ขวา (ANCHOR_RIGHT_UPPER) แล้วเดาความกว้างตัวหนังสือเอง
   // ทำให้ label ภาษาไทยยาวๆ ล้นออกนอกกล่องพื้นหลัง — เปลี่ยนมาใช้มุมซ้ายบนล้วน (ทั้งกล่องและ
   // ตัวหนังสือ) กับ 2 คอลัมน์ตำแหน่งคงที่แทน ขยายไปทางขวาซึ่งเดางานตรงไปตรงมากว่า ไม่ต้องรู้
   // ความกว้างจริงของตัวหนังสือ แค่กันพื้นที่คอลัมน์ให้กว้างพอ
   const ENUM_BASE_CORNER CN = CORNER_LEFT_UPPER;
   const ENUM_ANCHOR_POINT AN = ANCHOR_LEFT_UPPER;
   const int FS = 12;   // ฟอนต์ขนาดเดียวกันทั้งพาเนลตามที่ขอ (ตัดหัวข้อไซซ์แยกออก)
   const int dy = 24;   // เว้นบรรทัดให้กว้างขึ้น อ่านสบายตา
   const int padTop = 16, padBottom = 16, padLeft = 14;
   const int colGap = 170; // ระยะจากขอบซ้ายกล่องถึงคอลัมน์ value — เผื่อ label ไทยยาวสุด

   bool hasPos = (gMtDir != 0);
   // แถว TP: usePartials=true โชว์ TP1/TP2/TP3 แยกบรรทัด (3 แถว), false โชว์ TP เดียว (=TP3, 1 แถว)
   int tpRows = InpUsePartials ? 3 : 1;
   int rowCount = 1 + 1 + (hasPos ? (4 + tpRows) : 1) + 5 + 1; // header + version + ไม้ + (balance/equity/วันนี้/เวลา/pending) + เหตุการณ์ล่าสุด
   int panelW = 360;
   int panelH = padTop + rowCount * dy + 30 + padBottom; // +30 = ช่องว่าง+เส้นคั่น 3 จุดระหว่างกลุ่ม

   // เช็คว่า EA เทรดได้จริงไหม (ต่างจาก heartbeat ที่เช็คแค่ว่ามี tick เข้ามา) — Algo Trading
   // อาจถูกปิดโดยไม่ตั้งใจ (ปุ่มบนแถบเครื่องมือ/checkbox ตอน attach) หรือบัญชีไม่อนุญาตให้ EA
   // เทรด ทั้งสองกรณีนี้ราคายังวิ่งเข้ามาปกติ (tick ไม่หาย) แต่ส่งคำสั่งเทรดไม่ได้เลยแบบเงียบๆ
   string statusText;
   if(gLastProblem != "")
      statusText = gLastProblem;
   else if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) || !MQLInfoInteger(MQL_TRADE_ALLOWED))
      // TERMINAL_TRADE_ALLOWED = ปุ่ม Algo Trading บนแถบเครื่องมือ (กดปิด/เปิดแบบสด)
      // MQL_TRADE_ALLOWED = สิทธิ์ของ EA ตัวนี้เอง (checkbox "Allow Algo Trading" ตอน attach)
      // ต้องเช็คทั้งคู่ — เจอจริง 2026-09-18: เช็คแค่ MQL_TRADE_ALLOWED อย่างเดียวไม่ตามปุ่มบนแถบเครื่องมือ
      statusText = "ปิด Algo Trading อยู่";
   else if(!AccountInfoInteger(ACCOUNT_TRADE_EXPERT))
      statusText = "บัญชีไม่อนุญาตให้ EA เทรด";
   else if((ENUM_SYMBOL_TRADE_MODE)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_MODE) != SYMBOL_TRADE_MODE_FULL)
      statusText = "broker ปิดเทรด " + _Symbol + " ชั่วคราว";
   else
      statusText = "กำลังทำงาน";
   bool ok = (statusText == "กำลังทำงาน");
   color accentClr = ok ? clrLimeGreen : clrTomato;

   // แจ้ง Telegram เฉพาะสถานะ Algo Trading/บัญชี/broker (edge-trigger) — คำนวณแยกจาก statusText
   // ข้างบน เพราะ statusText ผสม gLastProblem เข้ามาด้วย ซึ่ง "ค้าง" ตลอดไปหลัง set ครั้งแรก (ไม่มีจุด
   // reset กลับเป็น "" ที่ไหนเลยในโค้ดเดิม) ถ้าเอา statusText ตรงๆ มา edge-trigger จะยิงซ้ำกับ
   // TG_NotifyProblem ที่จุดเข้า/ปิดไม้ไม่สำเร็จ และค้างสถานะ "มีปัญหา" ไม่มีวันกลับเป็นปกติจน EA รีสตาร์ท
   string tgStatus;
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) || !MQLInfoInteger(MQL_TRADE_ALLOWED))
      tgStatus = "ปิด Algo Trading อยู่";
   else if(!AccountInfoInteger(ACCOUNT_TRADE_EXPERT))
      tgStatus = "บัญชีไม่อนุญาตให้ EA เทรด";
   else if((ENUM_SYMBOL_TRADE_MODE)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_MODE) != SYMBOL_TRADE_MODE_FULL)
      tgStatus = "broker ปิดเทรด " + _Symbol + " ชั่วคราว";
   else
      tgStatus = "กำลังทำงาน";
   TG_NotifyStatus(_Symbol, tgStatus, tgStatus == "กำลังทำงาน");

   int chartW = (int)ChartGetInteger(0, CHART_WIDTH_IN_PIXELS);
   int boxX = MathMax(0, chartW - 5 - panelW);
   int boxY = 5;
   PL_DashPanelBg(prefix + "bg", boxX, boxY, panelW, panelH, C'19,23,34', C'58,63,77', CN);
   // แถบสีบอกสถานะที่ขอบซ้ายกล่อง (เขียว=ไม่มีปัญหา, แดง=มีปัญหา) — วาดทับขอบซ้ายของ bg
   PL_DashPanelBg(prefix + "accent", boxX, boxY, 4, panelH, accentClr, accentClr, CN);

   int xLabel = boxX + padLeft;
   int xValue = boxX + colGap;
   int y = boxY + padTop;
   string tf = StringSubstr(EnumToString((ENUM_TIMEFRAMES)Period()), 7);

   PL_DashLabel(prefix + "title", "SATS " + _Symbol + " " + tf, xLabel, y, clrSilver, FS, CN, AN);
   PL_DashLabel(prefix + "status", statusText, xValue, y, accentClr, FS, CN, AN);
   y += dy;

   PL_DashLabel(prefix + "ver_l", "Version", xLabel, y, clrGray, FS, CN, AN);
   PL_DashLabel(prefix + "ver_v", "v" + SATS_VERSION + " · " + SATS_UPDATED, xValue, y, clrGray, FS, CN, AN);
   y += dy;

   PL_DashPanelBg(prefix + "div1", boxX + 8, y + 5, panelW - 16, 1, C'58,63,77', C'58,63,77', CN);
   y += 10;

   if(hasPos)
   {
      PL_DashLabel(prefix + "pos_l", "Position", xLabel, y, clrSilver, FS, CN, AN);
      PL_DashLabel(prefix + "pos_v", PL_DirStr(gMtDir) + " " + DoubleToString(gMtEntry, _Digits), xValue, y,
                   gMtDir == 1 ? clrLimeGreen : clrTomato, FS, CN, AN);
      y += dy;

      PL_DashLabel(prefix + "sl_l", "SL / Lot", xLabel, y, clrSilver, FS, CN, AN);
      PL_DashLabel(prefix + "sl_v", DoubleToString(gMtSlInit, _Digits) + " / " + DoubleToString(gMtLot, 2),
                   xValue, y, clrWhite, FS, CN, AN);
      y += dy;

      // แถว TP — เพิ่ม 2026-09-18 ตามคำขอผู้ใช้ บอกกำไร (+currency) ถ้าราคาไปถึงจุดนั้นจริง
      // usePartials=false: TP1/TP2 ไม่มีการปิดไม้จริง (แค่ useBe ขยับ SL เฉยๆ) โชว์แค่ TP3 เต็ม lot
      // usePartials=true: แตะ TP1/TP2 ปิดจริง 1/3 lot ต่อจุด (gMtPartVol) ที่เหลือปิดที่ TP3
      if(InpUsePartials)
      {
         double volLast = MathMax(gMtLot - 2.0 * gMtPartVol, 0.0);
         double gain1 = gMtPartVol * (MathAbs(gMtTp1 - gMtEntry) / InpRiskPointUnit);
         double gain2 = gMtPartVol * (MathAbs(gMtTp2 - gMtEntry) / InpRiskPointUnit);
         double gain3 = volLast    * (MathAbs(gMtTp3 - gMtEntry) / InpRiskPointUnit);

         PL_DashLabel(prefix + "tp1_l", "TP1", xLabel, y, clrSilver, FS, CN, AN);
         PL_DashLabel(prefix + "tp1_v", DoubleToString(gMtTp1, _Digits) + " (+" + DoubleToString(gain1, 0) + " " + curr + ")",
                      xValue, y, clrLimeGreen, FS, CN, AN);
         y += dy;

         PL_DashLabel(prefix + "tp2_l", "TP2", xLabel, y, clrSilver, FS, CN, AN);
         PL_DashLabel(prefix + "tp2_v", DoubleToString(gMtTp2, _Digits) + " (+" + DoubleToString(gain2, 0) + " " + curr + ")",
                      xValue, y, clrLimeGreen, FS, CN, AN);
         y += dy;

         PL_DashLabel(prefix + "tp3_l", "TP3", xLabel, y, clrSilver, FS, CN, AN);
         PL_DashLabel(prefix + "tp3_v", DoubleToString(gMtTp3, _Digits) + " (+" + DoubleToString(gain3, 0) + " " + curr + ")",
                      xValue, y, clrLimeGreen, FS, CN, AN);
         y += dy;
      }
      else
      {
         double gainTp = gMtLot * (MathAbs(gMtTp3 - gMtEntry) / InpRiskPointUnit);
         PL_DashLabel(prefix + "tp_l", "TP", xLabel, y, clrSilver, FS, CN, AN);
         PL_DashLabel(prefix + "tp_v", DoubleToString(gMtTp3, _Digits) + " (+" + DoubleToString(gainTp, 0) + " " + curr + ")",
                      xValue, y, clrLimeGreen, FS, CN, AN);
         y += dy;
      }

      PL_DashLabel(prefix + "risk_l", "Risk (" + curr + ")", xLabel, y, clrSilver, FS, CN, AN);
      PL_DashLabel(prefix + "risk_v", DoubleToString(gTradeRiskUsd, 0) + " " + curr, xValue, y, clrWhite, FS, CN, AN);
      y += dy;

      double posProfit = 0;
      ulong ticket = 0;
      if(PL_Select(InpMagic, ticket) && PositionSelectByTicket(ticket))
         posProfit = PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
      PL_DashLabel(prefix + "pl_l", "Floating P/L", xLabel, y, clrSilver, FS, CN, AN);
      PL_DashLabel(prefix + "pl_v", (posProfit >= 0 ? "+" : "") + DoubleToString(posProfit, 0) + " " + curr,
                   xValue, y, posProfit >= 0 ? clrLimeGreen : clrTomato, FS, CN, AN);
      y += dy;
   }
   else
   {
      PL_DashLabel(prefix + "pos_l", "Position", xLabel, y, clrSilver, FS, CN, AN);
      PL_DashLabel(prefix + "pos_v", "ไม่มีไม้เปิดอยู่", xValue, y, clrSilver, FS, CN, AN);
      y += dy;

      // แก้บั๊ก 2026-09-18: เดิมตอนไม่มีไม้เปิดอยู่ label แถวเฉพาะตอนมีไม้ (SL/TP/Risk/P&L) จากรอบก่อน
      // ไม่เคยถูกลบเลย ค้างลอยอยู่ใต้กล่องที่ย่อสั้นลงแล้ว — ลบทิ้งทุกครั้งที่ไม่มีไม้เปิดอยู่
      string posOnly[] = {"sl_l","sl_v","tp_l","tp_v","tp1_l","tp1_v","tp2_l","tp2_v","tp3_l","tp3_v",
                          "risk_l","risk_v","pl_l","pl_v"};
      for(int pi = 0; pi < ArraySize(posOnly); pi++)
         ObjectDelete(0, prefix + posOnly[pi]);
   }

   PL_DashPanelBg(prefix + "div2", boxX + 8, y + 5, panelW - 16, 1, C'58,63,77', C'58,63,77', CN);
   y += 10;
   double bal = AccountInfoDouble(ACCOUNT_BALANCE);
   double eq  = AccountInfoDouble(ACCOUNT_EQUITY);
   PL_DashLabel(prefix + "bal_l", "Balance", xLabel, y, clrSilver, FS, CN, AN);
   PL_DashLabel(prefix + "bal_v", DoubleToString(bal, 0) + " " + curr, xValue, y, clrWhite, FS, CN, AN);
   y += dy;

   PL_DashLabel(prefix + "eq_l", "Equity", xLabel, y, clrSilver, FS, CN, AN);
   PL_DashLabel(prefix + "eq_v", DoubleToString(eq, 0) + " " + curr, xValue, y,
                eq >= bal ? clrLimeGreen : clrTomato, FS, CN, AN);
   y += dy;

   double todayProfit; int todayTrades;
   SatsComputeTodayStats(todayProfit, todayTrades);
   PL_DashLabel(prefix + "today_l", "วันนี้", xLabel, y, clrSilver, FS, CN, AN);
   PL_DashLabel(prefix + "today_v",
                (todayProfit >= 0 ? "+" : "") + DoubleToString(todayProfit, 0) + " " + curr +
                " · " + IntegerToString(todayTrades) + " ไม้",
                xValue, y, todayProfit > 0 ? clrLimeGreen : (todayProfit < 0 ? clrTomato : clrSilver), FS, CN, AN);
   y += dy;

   PL_DashLabel(prefix + "cutoff_l", "เหลือเวลาเทรด", xLabel, y, clrSilver, FS, CN, AN);
   PL_DashLabel(prefix + "cutoff_v",
                InpUseCutoff ? PL_TimeLeftStr(InpCutoffServerHour, InpTradeStartServerHour) : "ปิดใช้งาน",
                xValue, y, clrWhite, FS, CN, AN);
   y += dy;

   PL_DashLabel(prefix + "pend_l", "สัญญาณรอเข้า", xLabel, y, clrSilver, FS, CN, AN);
   if(gHavePending)
      PL_DashLabel(prefix + "pend_v", PL_DirStr(gPendingDir) + " " + DoubleToString(gPendingEntry, _Digits),
                   xValue, y, clrOrange, FS, CN, AN);
   else
      PL_DashLabel(prefix + "pend_v", "ไม่มี", xValue, y, clrSilver, FS, CN, AN);
   y += dy;

   PL_DashPanelBg(prefix + "div3", boxX + 8, y + 5, panelW - 16, 1, C'58,63,77', C'58,63,77', CN);
   y += 10;

   string evText = (gLastEvent == "") ? "ยังไม่มีเหตุการณ์" :
                   TimeToString(gLastEventTime, TIME_MINUTES) + "  " + gLastEvent;
   PL_DashLabel(prefix + "event", evText, xLabel, y, clrOrange, FS, CN, AN);

   ChartRedraw();
}

//+------------------------------------------------------------------+
//| เช็คทุก 30 วิ ไม่พึ่ง OnTick เลย — จับ "EA แขวน/data feed หลุด" ได้จริง  |
//| (เฉพาะวันจันทร์-ศุกร์ เสาร์-อาทิตย์ตลาดปิดเองไม่ถือว่าผิดปกติ)          |
//+------------------------------------------------------------------+
void OnTimer()
{
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   if(dt.day_of_week == 0 || dt.day_of_week == 6) return; // เสาร์-อาทิตย์ ข้าม

   if(!TerminalInfoInteger(TERMINAL_CONNECTED))
   {
      gLastProblem = "ขาดการเชื่อมต่อกับ broker";
      TG_NotifyProblemOnce("disconnected", _Symbol, gLastProblem, "🔌");
      return;
   }
   TG_ClearProblemKind("disconnected"); // เชื่อมต่อกลับมาแล้ว เปิดสิทธิ์แจ้งซ้ำได้ถ้าหลุดอีกรอบ

   double idleSec = (GetTickCount64() - gLastTickMs) / 1000.0;
   if(idleSec > SATS_HEARTBEAT_MAX_SEC)
   {
      // dedupe ตามสาเหตุ ไม่ใช่ข้อความเป๊ะๆ — เลขนาทีเปลี่ยนทุกรอบ 30 วิ ถ้า dedupe แบบเทียบ string
      // ตรงๆ จะไม่มีทางซ้ำเลย ส่งรัวทุก 30 วิจนกว่าจะหาย
      gLastProblem = StringFormat("ไม่มี tick เข้ามา %d นาทีแล้ว เช็คการเชื่อมต่อ", (int)(idleSec / 60));
      TG_NotifyProblemOnce("heartbeat_stuck", _Symbol, gLastProblem, "⚠️");
   }
   else
      TG_ClearProblemKind("heartbeat_stuck");
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   PrintFormat("diag: flipUp=%d flipDown=%d charFlip=%d entry=%d flipExit=%d timeout=%d notWarm=%d cutoffClose=%d | %s",
               gCnt_FlipUp, gCnt_FlipDown, gCnt_CharFlip, gCnt_Entry,
               gCnt_FlipExit, gCnt_Timeout, gCnt_NotWarm, gCnt_CutoffClose, PL_DiagString());
   if(InpShowChartObjects)
   {
      PL_ClearChartObjects("SATS_" + IntegerToString(InpMagic) + "_");
      ChartRedraw();
   }
   if(InpShowDashboard)
   {
      PL_ClearChartObjects("SATSDASH_" + IntegerToString(InpMagic) + "_");
      ChartRedraw();
   }
}

//+------------------------------------------------------------------+
//| ATR ของแท่งที่ยืนยันแล้ว + ค่าเฉลี่ย ATR (atrBaseline ของ Pine)        |
//+------------------------------------------------------------------+
double SatsAtrAt(const int k)
{
   double buf[];
   if(CopyBuffer(hAtrMain, 0, gAsOf + 1 + k, 1, buf) < 1)
      return 0.0;
   return buf[0];
}
double SatsAtrBaseline(const int len)
{
   double buf[];
   int got = CopyBuffer(hAtrMain, 0, gAsOf + 1, len, buf);
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
      double v = (double)iVolume(_Symbol, PERIOD_CURRENT, gAsOf + 1 + i);
      sum  += v;
      sum2 += v * v;
   }
   double mean = sum / len;
   double var  = sum2 / len - mean * mean;
   if(var <= 0) return 0.0;
   double sd = MathSqrt(var);
   return SatsSafeDiv((double)iVolume(_Symbol, PERIOD_CURRENT, gAsOf + 1) - mean, sd, 0.0);
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
//| คำนวณ entry/SL/TP1-3 ของสัญญาณ flip — มิเรอร์ section 7.5 ของ Pine    |
//| แยกออกมาจาก SatsOpen เพื่อใช้ร่วมกับ SatsReplayHistory (หาไม้ที่พลาด)  |
//| โดยไม่ต้องยิงออเดอร์จริง — คืน false ถ้า risk <= 0 (คำนวณ SL ไม่ได้)   |
//+------------------------------------------------------------------+
bool SatsComputeLevels(const int dir, const double atrValue, const double tqi, const double volRatio,
                        double &outEntry, double &outSl, double &outTp1, double &outTp2, double &outTp3)
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
   if(risk <= 0) return false;

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

   outEntry = entry;
   outSl    = tSl;
   outTp1   = dir == 1 ? entry + risk * r1 : entry - risk * r1;
   outTp2   = dir == 1 ? entry + risk * r2 : entry - risk * r2;
   outTp3   = dir == 1 ? entry + risk * r3 : entry - risk * r3;
   return true;
}

//+------------------------------------------------------------------+
//| เปิดไม้ตามสัญญาณ flip สดๆ                                          |
//+------------------------------------------------------------------+
void SatsOpen(const int dir, const double atrValue, const double tqi, const double volRatio)
{
   double entry, tSl, tp1, tp2, tp3;
   if(!SatsComputeLevels(dir, atrValue, tqi, volRatio, entry, tSl, tp1, tp2, tp3))
      return;

   gTradeRiskUsd = SatsRiskUsd();
   if(PL_Open(dir, tSl, tp1, tp2, tp3, gTradeRiskUsd, InpRiskPointUnit,
              InpMagic, "SATS", InpUsePartials, gBar, InpShowChartObjects, InpUseBe))
   {
      gCnt_Entry++;
      PrintFormat("เกิดสัญญาณใหม่: %s : %s | SL : %s | Lot : %.2f | Risk : %.2f | Balance : %.2f",
                  PL_DirStr(gMtDir), DoubleToString(gMtEntry, _Digits), DoubleToString(gMtSlInit, _Digits),
                  gMtLot, gTradeRiskUsd, AccountInfoDouble(ACCOUNT_BALANCE));
      // ข้อความสั้นแยกไว้โชว์บน dashboard เท่านั้น (ตัวเต็มยาวเกินความกว้างพาเนล ล้นออกนอกกล่อง)
      PL_SetLastEvent(StringFormat("เข้าไม้: %s %s", PL_DirStr(gMtDir), DoubleToString(gMtEntry, _Digits)));
   }
}

//+------------------------------------------------------------------+
//| ปิดไม้แล้วบันทึกผลเป็น R เข้า self-learning                           |
//+------------------------------------------------------------------+
// คืนค่า true + netOut = กำไร/ขาดทุนจริงรวม swap/commission ถ้าบันทึกสำเร็จ — ผู้เรียกใช้ netOut
// ต่อแจ้ง Telegram ได้เลยโดยไม่ต้องวนลูปอ่านประวัติดีลซ้ำอีกรอบ
bool SatsRecordClosedPosition(double &netOut)
{
   netOut = 0;
   if(gMtPosId == 0 || gTradeRiskUsd <= 0) return false;
   if(!HistorySelectByPosition((long)gMtPosId)) return false;
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
   netOut = net;
   return true;
}

//+------------------------------------------------------------------+
//| เดิน series ทั้งหมดหนึ่งแท่ง คำนวณ indicator/trend/flip อย่างเดียว —   |
//| ไม่แตะการเปิด/ปิดไม้ ใช้ร่วมกันทั้งตอนรันสด (SatsOnBar) และตอน replay  |
//| ประวัติ (SatsReplayHistory) ผ่าน gAsOf คืน false ถ้ายังวอร์มไม่พอ      |
//+------------------------------------------------------------------+
bool SatsComputeSignal(bool &flipUpOut, bool &flipDownOut,
                        double &atrValueOut, double &tqiOut, double &volRatioOut)
{
   int warmup = MathMax(SATS_WARMUP_FLOOR,
                MathMax(gAtrLen, MathMax(InpAtrBaselineLen,
                MathMax(gErLen, MathMax(InpVolLen,
                MathMax(InpPivotLen * 2 + 1,
                MathMax(InpTqiMomLen, InpTqiStructLen))))))) + 10;
   if(gBar < warmup + 5)
   {
      gCnt_NotWarm++;
      return false;
   }

   // ── pivot (ใช้เป็นฐาน SL) ──
   double pv = 0;
   if(SatsPivotHigh(InpPivotLen, pv)) { gLastPivHi = pv; gHavePivHi = true; }
   if(SatsPivotLow(InpPivotLen, pv))  { gLastPivLo = pv; gHavePivLo = true; }

   // ── ฐานคำนวณ ──
   double rawAtr = SatsAtrAt(0);
   if(rawAtr <= 0) return false;
   double atrBaseline = SatsAtrBaseline(InpAtrBaselineLen);
   double volRatio = SatsSafeDiv(rawAtr, atrBaseline, 1.0);
   double erValue  = SatsEfficiencyRatio(gErLen);
   double atrValue = InpUseEffAtr ? rawAtr * (0.5 + 0.5 * erValue) : rawAtr;

   // ── TQI 4 องค์ประกอบ ──
   double tqiEr = SatsClamp(erValue, 0.0, 1.0);
   double volZ  = SatsVolumeZ(InpVolLen);
   double tqiVol = SatsMapClamp(volZ, -1.0, 2.0, 0.0, 1.0);

   int idxHi = iHighest(_Symbol, PERIOD_CURRENT, MODE_HIGH, InpTqiStructLen, gAsOf + 1);
   int idxLo = iLowest(_Symbol, PERIOD_CURRENT, MODE_LOW, InpTqiStructLen, gAsOf + 1);
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

   if(InpShowChartObjects)
   {
      double activeBand = gStTrend == 1 ? gLowerBand : gUpperBand;
      SatsRecordBandPoint(iTime(_Symbol, PERIOD_CURRENT, gAsOf + 1), activeBand, gStTrend);
      if(gAsOf == 0) ChartRedraw(); // เฉพาะตอนรันสด — ตอน replay ไม่ต้อง redraw ทุกแท่งเพราะเปลืองเปล่าๆ
   }

   flipUpOut    = flipUp;
   flipDownOut  = flipDown;
   atrValueOut  = atrValue;
   tqiOut       = tqi;
   volRatioOut  = volRatio;
   return true;
}

//+------------------------------------------------------------------+
//| เดินหนึ่งแท่งสด: คำนวณสัญญาณ แล้วจัดการไม้จริง (timeout/flip-exit/entry)|
//+------------------------------------------------------------------+
void SatsOnBar()
{
   bool flipUp, flipDown;
   double atrValue, tqi, volRatio;
   if(!SatsComputeSignal(flipUp, flipDown, atrValue, tqi, volRatio))
      return;

   // ── timeout ของไม้ที่เปิดอยู่ (Pine แค่บันทึกผล ที่นี่ต้องปิดจริง) ──
   if(gMtDir != 0 && gBar - gMtOpenBar >= InpTradeMaxAge)
   {
      PL_CloseAll(InpMagic);
      double closedNet;
      if(SatsRecordClosedPosition(closedNet))
         TG_NotifyClose(_Symbol, "ถือนานเกินกำหนด", closedNet, AccountInfoString(ACCOUNT_CURRENCY));
      gMtPosId = 0;
      gCnt_Timeout++;
      Print("ไม้ปิดแล้ว: ถือไม้นานเกินกำหนด ปิดอัตโนมัติ");
      PL_SetLastEvent("ไม้ปิดแล้ว: ถือนานเกินกำหนด");
   }

   // ── flip-exit: สัญญาณตรงข้ามปิดไม้เดิมก่อนเสมอ ──
   if(gMtDir != 0 && ((gMtDir == 1 && flipDown) || (gMtDir == -1 && flipUp)))
   {
      int oldDir = gMtDir;
      PL_CloseAll(InpMagic);
      double closedNet;
      string flipReason = StringFormat("กลับทิศ (%s→%s)", PL_DirStr(oldDir), PL_DirStr(-oldDir));
      if(SatsRecordClosedPosition(closedNet))
         TG_NotifyClose(_Symbol, flipReason, closedNet, AccountInfoString(ACCOUNT_CURRENCY));
      gMtPosId = 0;
      gCnt_FlipExit++;
      PrintFormat("ไม้ปิดแล้ว: สัญญาณกลับทิศ (%s → %s) รอเข้าไม้ใหม่", PL_DirStr(oldDir), PL_DirStr(-oldDir));
      PL_SetLastEvent("ไม้ปิดแล้ว: " + flipReason);
   }

   // diagnostic เฉพาะ flip ที่เกิด "สด" เท่านั้น (SatsOnBar ถูกเรียกจาก OnTick อย่างเดียว ไม่ถูก
   // เรียกจาก SatsReplayHistory) แยกจาก gCnt_FlipUp/FlipDown ที่นับรวมทั้ง replay กับสด ทำให้บอกไม่ได้
   // ว่า flip ที่นับได้เกิดตอนไหน — log บรรทัดนี้บอกตรงๆ ว่า flip สดที่เพิ่งเกิดโดน cutoff บล็อกหรือเปล่า
   // และมีไม้ค้างอยู่ก่อนหรือไม่ (ตามคำถามผู้ใช้ 2026-09-16 ว่าทำไม flip แล้วไม่เข้าไม้)
   bool cutoffBlocked = InpUseCutoff && PL_PastCutoff(InpCutoffServerHour, InpTradeStartServerHour);
   if(flipUp || flipDown)
      PrintFormat("SATS live flip: %s @ %s gMtDir=%d cutoffBlocked=%d",
                  flipUp ? "UP" : "DOWN",
                  TimeToString(iTime(_Symbol, PERIOD_CURRENT, 1), TIME_DATE|TIME_MINUTES|TIME_SECONDS),
                  gMtDir, cutoffBlocked);

   if(gMtDir == 0 && (flipUp || flipDown))
   {
      if(!cutoffBlocked)
         SatsOpen(flipUp ? 1 : -1, atrValue, tqi, volRatio);
      else
      {
         // แก้บั๊ก 2026-09-16: เดิม flip สดที่โดน cutoff บล็อกจะหายไปเฉยๆ ไม่มีทางกู้คืน (ต่างจาก
         // สัญญาณที่เจอตอน replay ใน OnInit ซึ่งถูกเก็บเป็น gPending ให้เข้าไม้ย้อนหลังได้อยู่แล้ว) —
         // เก็บเป็น pending แบบเดียวกัน พอ cutoff คลาย (เที่ยงคืน server ผ่านไป) SatsTryCatchup()
         // จะเข้าไม้ให้เองถ้าราคายังอยู่ในโซน entry↔SL ไม่งั้นหมดสิทธิ์ตามปกติ (SL/TP1/timeout/flip ใหม่)
         double e, s, t1, t2, t3;
         if(SatsComputeLevels(flipUp ? 1 : -1, atrValue, tqi, volRatio, e, s, t1, t2, t3))
         {
            // สัญญาณเก่าที่ยังไม่ทันเข้าไม้ (ถ้ามี) ตกไปตรงนี้ — สัญญาณใหม่ทับที่ไม่มีทางกู้คืน
            if(gHavePending)
            {
               PrintFormat("สัญญาณเก่าที่รอไว้ (%s : %s) ถูกยกเลิก เพราะมีสัญญาณใหม่เข้ามาแทน",
                           PL_DirStr(gPendingDir), DoubleToString(gPendingEntry, _Digits));
               PL_SetLastEvent(StringFormat("สัญญาณเก่า (%s %s) โดนแทนที่",
                           PL_DirStr(gPendingDir), DoubleToString(gPendingEntry, _Digits)));
            }

            gHavePending      = true;
            gPendingDir       = flipUp ? 1 : -1;
            gPendingEntry     = e;
            gPendingSl        = s;
            gPendingTp1       = t1;
            gPendingTp2       = t2;
            gPendingTp3       = t3;
            gPendingSignalTime = iTime(_Symbol, PERIOD_CURRENT, 1);

            PrintFormat("เกิดสัญญาณใหม่: %s : %s | SL : %s — อยู่นอกเวลาเทรด (%s) เก็บสัญญาณไว้รอเข้าไม้ย้อนหลังเมื่อถึงเวลา (%s)",
                        PL_DirStr(gPendingDir), DoubleToString(e, _Digits), DoubleToString(s, _Digits),
                        PL_ThaiHourStr(InpCutoffServerHour), PL_ThaiHourStr(InpTradeStartServerHour));
            PL_SetLastEvent(StringFormat("สัญญาณรอ: %s %s (นอกเวลาเทรด)", PL_DirStr(gPendingDir), DoubleToString(e, _Digits)));
         }
      }
   }
}

//+------------------------------------------------------------------+
//| ไล่ย้อนหลัง warmup+InpTradeMaxAge บาร์ตอน OnInit ผ่าน gAsOf:          |
//|  1) วอร์ม state ของ trend/band/TQI ให้ถูกต้องจริง (ไม่ใช่เริ่มนับจาก 0  |
//|     ทุกครั้งที่ EA reinit — บั๊กเดิมที่ทำให้ EA ไม่เข้าไม้เป็นชั่วโมงหลัง    |
//|     attach ใหม่ทุกรอบ)                                              |
//|  2) จำลอง "ไม้เสมือน" ตามกฎเดียวกับของจริงทุกอย่าง (flip/SL/TP1/       |
//|     timeout/cutoff/flip-exit) ถ้าจบ replay แล้วไม้เสมือนยังไม่ถูก       |
//|     ปิดและไม่มีไม้จริงเปิดอยู่ → เก็บเป็น gPending* ไว้เข้าไม้ย้อนหลัง     |
//|     ได้ครั้งเดียวถ้าราคากลับมาแตะช่วง entry↔SL (ดู SatsTryCatchup)       |
//+------------------------------------------------------------------+
void SatsReplayHistory()
{
   int warmup = MathMax(SATS_WARMUP_FLOOR,
                MathMax(gAtrLen, MathMax(InpAtrBaselineLen,
                MathMax(gErLen, MathMax(InpVolLen,
                MathMax(InpPivotLen * 2 + 1,
                MathMax(InpTqiMomLen, InpTqiStructLen))))))) + 10;
   int replayBars = warmup + InpTradeMaxAge + 5;

   int available = iBars(_Symbol, PERIOD_CURRENT) - 2; // กันแท่งปัจจุบันที่ยังไม่ปิด
   int steps = MathMin(replayBars, MathMax(available, 0));

   int    virtDir     = 0;
   double virtEntry = 0, virtSl = 0, virtTp1 = 0, virtTp2 = 0, virtTp3 = 0;
   int    virtOpenBar = 0;
   datetime virtSignalTime = 0; // เวลาที่แท่งซึ่งเกิดสัญญาณนี้ปิด — ส่งต่อเป็น gPendingSignalTime

   // สัญญาณที่เจอระหว่าง replay แต่ติด cutoff/ยังไม่ถึงเวลาเริ่ม (InpTradeStartServerHour) ตอนนั้น —
   // แยกจาก virt* เพราะยังไม่ได้ "เปิด" จริงแม้แต่ในแบบจำลอง แค่รอราคาแตะช่วง entry↔SL ตอนเวลาเปิดแล้ว
   // (มิเรอร์ SatsTryCatchup ตอนรันสด) แก้บั๊ก 2026-09-16: เดิม replay ทิ้งสัญญาณกลุ่มนี้ไปเฉยๆ ทำให้
   // reattach/เปลี่ยน tf ระหว่างที่ยังติด cutoff อยู่ จะทำสัญญาณที่ค้างไว้ (จากไลฟ์) หายไปอีกรอบ เพราะ
   // replay ไม่รู้จักมันเลย
   int    blockDir   = 0;
   double blockEntry = 0, blockSl = 0, blockTp1 = 0, blockTp2 = 0, blockTp3 = 0;
   datetime blockSignalTime = 0;

   for(int i = steps; i >= 1; i--)
   {
      gAsOf = i - 1;
      gBar++;

      bool flipUp, flipDown;
      double atrValue, tqi, volRatio;
      if(!SatsComputeSignal(flipUp, flipDown, atrValue, tqi, volRatio))
         continue; // ยังไม่วอร์มพอ ณ จุดนี้ของประวัติ — ข้าม ไม่ยุ่งกับไม้เสมือน

      datetime barTime = iTime(_Symbol, PERIOD_CURRENT, gAsOf + 1);
      MqlDateTime dt;
      TimeToStruct(barTime, dt);
      bool cutoffNow = InpUseCutoff && PL_HourBlocked(dt.hour, InpCutoffServerHour, InpTradeStartServerHour);

      double barHi = iHigh(_Symbol, PERIOD_CURRENT, gAsOf + 1);
      double barLo = iLow(_Symbol, PERIOD_CURRENT, gAsOf + 1);

      // ลองแปลงสัญญาณที่ค้าง (blockDir) เป็นไม้เสมือนจริง ถ้าแท่งนี้ราคาผ่านโซน entry↔SL แล้ว
      // (เงื่อนไขเดียวกับ SatsTryCatchup แค่เช็คระดับแท่งแทนระดับ tick)
      if(blockDir != 0 && virtDir == 0)
      {
         double lo = MathMin(blockEntry, blockSl);
         double hi = MathMax(blockEntry, blockSl);
         if(barHi >= lo && barLo <= hi)
         {
            virtDir     = blockDir;
            virtEntry   = blockEntry;
            virtSl      = blockSl;
            virtTp1     = blockTp1;
            virtTp2     = blockTp2;
            virtTp3     = blockTp3;
            virtOpenBar = gBar;
            virtSignalTime = blockSignalTime;
            blockDir    = 0;
         }
      }

      // timeout ของไม้เสมือน
      if(virtDir != 0 && gBar - virtOpenBar >= InpTradeMaxAge)
         virtDir = 0;

      // แตะ SL หรือ TP1 (เช็คตั้งแต่แท่งถัดจากแท่งเปิด — แท่งเปิดเองใช้ close เป็น entry แล้ว)
      if(virtDir != 0 && gBar > virtOpenBar)
      {
         bool hitSl  = virtDir == 1 ? barLo <= virtSl  : barHi >= virtSl;
         bool hitTp1 = virtDir == 1 ? barHi >= virtTp1 : barLo <= virtTp1;
         if(hitSl || hitTp1)
            virtDir = 0;
      }

      // เลยเวลาตัดรอบวัน (day-trade) — เหมือนของจริงที่บังคับปิดทันที
      if(virtDir != 0 && cutoffNow)
         virtDir = 0;

      // flip-exit: สัญญาณตรงข้ามปิดไม้เสมือนเดิมก่อนเสมอ (ปิดสัญญาณค้างเดิมทิ้งด้วยถ้ามี)
      if(virtDir != 0 && ((virtDir == 1 && flipDown) || (virtDir == -1 && flipUp)))
         virtDir = 0;
      if(flipUp || flipDown)
         blockDir = 0; // สัญญาณใหม่มาแล้ว ของเก่าที่ยังไม่ทันเข้าไม้ถือว่าตกไป (ตรงกับตอนรันสด)

      if(virtDir == 0 && (flipUp || flipDown))
      {
         int dir = flipUp ? 1 : -1;
         double e, s, t1, t2, t3;
         if(SatsComputeLevels(dir, atrValue, tqi, volRatio, e, s, t1, t2, t3))
         {
            if(!cutoffNow)
            {
               virtDir     = dir;
               virtEntry   = e;
               virtSl      = s;
               virtTp1     = t1;
               virtTp2     = t2;
               virtTp3     = t3;
               virtOpenBar = gBar;
               virtSignalTime = barTime;
            }
            else
            {
               blockDir   = dir;
               blockEntry = e;
               blockSl    = s;
               blockTp1   = t1;
               blockTp2   = t2;
               blockTp3   = t3;
               blockSignalTime = barTime;
            }
         }
      }
   }

   gAsOf = 0; // กลับเข้าโหมดสดเสมอหลัง replay จบ

   if(virtDir != 0)
   {
      gHavePending      = true;
      gPendingDir       = virtDir;
      gPendingEntry     = virtEntry;
      gPendingSl        = virtSl;
      gPendingTp1       = virtTp1;
      gPendingTp2       = virtTp2;
      gPendingTp3       = virtTp3;
      gPendingSignalTime = virtSignalTime;
   }
   else if(blockDir != 0)
   {
      gHavePending      = true;
      gPendingDir       = blockDir;
      gPendingEntry     = blockEntry;
      gPendingSl        = blockSl;
      gPendingTp1       = blockTp1;
      gPendingTp2       = blockTp2;
      gPendingTp3       = blockTp3;
      gPendingSignalTime = blockSignalTime;
   }
}

//+------------------------------------------------------------------+
//| เช็คทุก tick: ถ้ามีสัญญาณที่พลาดไปค้างอยู่ ไม่มีไม้จริงเปิด ไม่ติด cutoff  |
//| และราคาปัจจุบันอยู่ในช่วง entry↔SL (รวมแตะพอดี entry) → เข้าไม้ที่ราคา   |
//| ตลาดตอนนี้เลย ด้วย SL/TP เดิมที่ค้างไว้ตอนสัญญาณเกิด ใช้สิทธิ์ได้ครั้งเดียว |
//+------------------------------------------------------------------+
void SatsTryCatchup()
{
   if(!gHavePending || gMtDir != 0) return;
   if(InpUseCutoff && PL_PastCutoff(InpCutoffServerHour, InpTradeStartServerHour)) return;

   bool isLong  = gPendingDir == 1;
   double price = isLong ? SymbolInfoDouble(_Symbol, SYMBOL_ASK) : SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double lo = MathMin(gPendingEntry, gPendingSl);
   double hi = MathMax(gPendingEntry, gPendingSl);
   if(price < lo || price > hi) return;

   gTradeRiskUsd = SatsRiskUsd();
   if(PL_Open(gPendingDir, gPendingSl, gPendingTp1, gPendingTp2, gPendingTp3,
              gTradeRiskUsd, InpRiskPointUnit, InpMagic, "SATS-catchup", InpUsePartials, gBar,
              InpShowChartObjects, InpUseBe))
   {
      gCnt_Entry++;
      PrintFormat("เข้าไม้ย้อนหลังสำเร็จ: %s : %s | SL : %s | Lot : %.2f | Risk : %.2f | Balance : %.2f",
                  PL_DirStr(gMtDir), DoubleToString(gMtEntry, _Digits), DoubleToString(gMtSlInit, _Digits),
                  gMtLot, gTradeRiskUsd, AccountInfoDouble(ACCOUNT_BALANCE));
      PL_SetLastEvent(StringFormat("เข้าไม้ย้อนหลัง: %s %s", PL_DirStr(gMtDir), DoubleToString(gMtEntry, _Digits)));
      gHavePending = false; // ใช้สิทธิ์ครั้งเดียว — เคลียร์เฉพาะตอนเปิดไม้ "สำเร็จ" เท่านั้น
   }
   // เปิดไม่สำเร็จ (เช่น algo trading ปิดพอดีตอนนั้น, requote) — คง pending ไว้ ลองใหม่ได้ทุก tick
   // ตราบใดที่ราคายังอยู่ในโซน entry↔SL (ไม่งั้นสัญญาณจะหมดสิทธิ์ไปฟรีๆ ทั้งที่ยังไม่เคยเข้าไม้จริง)
}

//+------------------------------------------------------------------+
void OnTick()
{
   gLastTickMs = GetTickCount64(); // heartbeat — ดู OnTimer()

   // ไม้ปิดเองโดย broker (SL/TP) → บันทึกผลเข้า self-learning ก่อนรีเซ็ต
   // (แจ้ง Telegram ทำที่ PL_ClassifyClosed() ผ่าน PL_Manage() ด้านล่างแทน ไม่ต้องซ้ำที่นี่)
   if(gMtDir != 0 && !PL_HasPosition(InpMagic))
   {
      double unusedNet;
      SatsRecordClosedPosition(unusedNet);
   }

   // day-trade เท่านั้น ห้ามถือข้ามคืน — เลยเวลาตัดรอบแล้วคัตไม้ที่เหลือทั้งหมดทันที (ปิดได้ที่ InpUseCutoff)
   if(InpUseCutoff && gMtDir != 0 && PL_PastCutoff(InpCutoffServerHour))
   {
      PL_CloseAll(InpMagic);
      double closedNet;
      string cutoffReason = StringFormat("หมดเวลาเทรด (%s)", PL_ThaiHourStr(InpCutoffServerHour));
      if(SatsRecordClosedPosition(closedNet))
         TG_NotifyClose(_Symbol, cutoffReason, closedNet, AccountInfoString(ACCOUNT_CURRENCY));
      gMtPosId = 0;
      gCnt_CutoffClose++;
      PrintFormat("ไม้ปิดแล้ว: หมดเวลาเทรดของวัน (%s) ปิดไม้อัตโนมัติตามกฎ", PL_ThaiHourStr(InpCutoffServerHour));
      PL_SetLastEvent("ไม้ปิดแล้ว: " + cutoffReason);
   }

   PL_Manage(InpMagic, InpUsePartials, InpUseBe, false);

   SatsTryCatchup();

   if(InpShowDashboard)
      SatsDrawDashboard();

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
