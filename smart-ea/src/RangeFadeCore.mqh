//+------------------------------------------------------------------+
//| RangeFadeCore.mqh                                                  |
//| ตรรกะทั้งหมดของ Range Fade EA — กลยุทธ์คนละตัวกับ MA Ribbon          |
//|                                                                    |
//| ทำไมต้องมีกลยุทธ์นี้: MA Ribbon เป็นการวิ่งตามเทรนด์ กำไรมาจากไม้ใหญ่  |
//| นานๆ ครั้ง winrate จึงอยู่แค่ 21-32% โดยธรรมชาติ ต่อให้ใส่ TP ที่ R    |
//| ต่ำแล้วจูนจนสุด (ทดลองแล้ว 2026-09-11) winrate ขึ้นถึง 50-68% ได้จริง  |
//| แต่ PF ตกมาเหลือ 1.07-1.11 เพราะทิ้งหางกำไรที่เป็นแหล่งเงินเดียวไป     |
//| ขาดทุนสูงสุดจึงกินกำไรราว 10 เดือน ซึ่งถอนรายเดือนไม่ได้               |
//|                                                                    |
//| กลยุทธ์นี้กลับด้าน: เข้าสวนเมื่อราคาเหวี่ยงออกจากค่ากลางเกินปกติ แล้ว   |
//| ออกเมื่อกลับเข้าหาค่ากลาง — winrate สูงตั้งแต่ต้นเพราะราคาแกว่ง        |
//| กลับเข้าค่ากลางบ่อยกว่าวิ่งต่อ และไม้ทุกไม้ขนาดใกล้กัน (TP คงที่)      |
//| จึงไม่มีไม้เดียวที่คิดเป็นสัดส่วนใหญ่ของกำไรทั้งปี                     |
//|                                                                    |
//| ไฟล์นี้ไม่ประกาศ input เอง แต่อ้างถึง input ที่ EA ประกาศไว้ก่อน       |
//| include เหมือน MARibbonCore.mqh — แก้บั๊กที่นี่ที่เดียว                |
//+------------------------------------------------------------------+
#include <Trade\Trade.mqh>
#include "TesterMetrics.mqh"

int hMid   = INVALID_HANDLE; // ค่ากลาง (SMA) ที่ใช้วัดการเหวี่ยง
int hDev   = INVALID_HANDLE; // ส่วนเบี่ยงเบนมาตรฐาน (ผ่าน iBands)
int hATR   = INVALID_HANDLE;
int hRSI   = INVALID_HANDLE;
int hTrend = INVALID_HANDLE; // เส้นกรองเทรนด์ระยะยาว

CTrade   trade;
datetime gLastBarTime  = 0;
datetime gEntryBarTime = 0;  // เวลาแท่งที่เข้าไม้ ใช้นับอายุไม้เป็นแท่ง
int      gCooldownLeft = 0;  // ต้องรออีกกี่แท่งจึงเข้าไม้ใหม่ได้

// ตัวนับ diagnostic — ตามกฎโปรเจกต์: ห้ามเดาสาเหตุ ให้ข้อมูลบอกเอง
int gCnt_Bars = 0, gCnt_Stretch = 0, gCnt_RejTrend = 0, gCnt_RejRSI = 0;
int gCnt_RejTurn = 0, gCnt_RejBusy = 0, gCnt_RejCooldown = 0, gCnt_RejSession = 0;
int gCnt_Entered = 0, gCnt_LotTooSmall = 0, gCnt_OpenFail = 0, gCnt_TimeExit = 0;

void DumpPass(const double score);

//+------------------------------------------------------------------+
int OnInit()
{
   // iBands ให้ทั้งค่ากลางและขอบ ±dev เท่า จึงคำนวณ z-score ได้จากตัวเดียว
   // (ขอบบน - ค่ากลาง) / InpBandDev = 1 ส่วนเบี่ยงเบนมาตรฐาน
   hMid = iBands(_Symbol, PERIOD_CURRENT, InpBandPeriod, 0, InpBandDev, PRICE_CLOSE);
   hATR = iATR(_Symbol, PERIOD_CURRENT, InpAtrPeriod);
   hRSI = iRSI(_Symbol, PERIOD_CURRENT, InpRSIPeriod, PRICE_CLOSE);
   hTrend = iMA(_Symbol, PERIOD_CURRENT, InpTrendPeriod, 0, MODE_EMA, PRICE_CLOSE);

   if(hMid == INVALID_HANDLE || hATR == INVALID_HANDLE ||
      hRSI == INVALID_HANDLE || hTrend == INVALID_HANDLE)
      return INIT_FAILED;

   trade.SetExpertMagicNumber(InpMagic);
   trade.SetTypeFillingBySymbol(_Symbol);
   trade.SetMarginMode();
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   PrintFormat("RangeFade: แท่ง=%d เหวี่ยงถึงเกณฑ์=%d | ตัดเพราะ เทรนด์=%d RSI=%d ยังไม่กลับตัว=%d "
               "มีไม้อยู่=%d พักหลังปิด=%d ช่วงเวลา=%d",
               gCnt_Bars, gCnt_Stretch, gCnt_RejTrend, gCnt_RejRSI, gCnt_RejTurn,
               gCnt_RejBusy, gCnt_RejCooldown, gCnt_RejSession);
   PrintFormat("RangeFade: เข้าไม้=%d lot เล็กเกิน=%d เปิดไม่ติด=%d ปิดเพราะหมดเวลา=%d",
               gCnt_Entered, gCnt_LotTooSmall, gCnt_OpenFail, gCnt_TimeExit);
}

//+------------------------------------------------------------------+
double Buf(const int handle, const int buffer, const int shift)
{
   double v[];
   if(CopyBuffer(handle, buffer, shift, 1, v) != 1)
      return 0.0;
   return v[0];
}

//+------------------------------------------------------------------+
bool HasPosition()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(t == 0)
         continue;
      if(PositionGetString(POSITION_SYMBOL) == _Symbol &&
         PositionGetInteger(POSITION_MAGIC) == InpMagic)
         return true;
   }
   return false;
}

//+------------------------------------------------------------------+
bool SelectOwnPosition()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(t == 0)
         continue;
      if(PositionGetString(POSITION_SYMBOL) == _Symbol &&
         PositionGetInteger(POSITION_MAGIC) == InpMagic)
         return true;
   }
   return false;
}

//+------------------------------------------------------------------+
double NormalizeVolume(double lot)
{
   double vmin  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double vmax  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double vstep = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   if(vstep <= 0)
      vstep = 0.01;
   lot = MathFloor(lot / vstep) * vstep;
   lot = NormalizeDouble(lot, 2);
   if(lot < vmin - 1e-8)
      return 0.0;
   if(lot > vmax)
      lot = vmax;
   return lot;
}

//+------------------------------------------------------------------+
//| ชั่วโมงของแท่ง อยู่ในช่วงที่อนุญาตไหม                                 |
//| ช่วงข้ามเที่ยงคืนได้ (เช่น 20-4) จึงต้องแยกสองกรณี                    |
//+------------------------------------------------------------------+
bool SessionOk(const datetime t)
{
   if(InpHourFrom == InpHourTo)
      return true; // เท่ากัน = ไม่กรอง

   MqlDateTime dt;
   TimeToStruct(t, dt);
   if(InpHourFrom < InpHourTo)
      return dt.hour >= InpHourFrom && dt.hour < InpHourTo;
   return dt.hour >= InpHourFrom || dt.hour < InpHourTo;
}

//+------------------------------------------------------------------+
//| ปิดไม้ที่ถืออยู่นานเกิน InpMaxBars แท่ง                               |
//|                                                                    |
//| กลยุทธ์สวนเทรนด์ต้องมีเวลาหมดอายุ ไม่งั้นไม้ที่คิดผิดจะค้างจนโดน SL    |
//| ซึ่งเป็นต้นทางของขาดทุนก้อนใหญ่และเดือนที่ติดลบ                       |
//+------------------------------------------------------------------+
void CheckTimeExit()
{
   if(InpMaxBars <= 0 || gEntryBarTime == 0 || !SelectOwnPosition())
      return;

   int held = iBarShift(_Symbol, PERIOD_CURRENT, gEntryBarTime, false);
   if(held < InpMaxBars)
      return;

   if(trade.PositionClose(PositionGetInteger(POSITION_TICKET)))
   {
      gCnt_TimeExit++;
      gEntryBarTime = 0;
      gCooldownLeft = InpCooldownBars;
   }
}

//+------------------------------------------------------------------+
void OpenTrade(const bool isLong, const double mid, const double atr)
{
   double entry = isLong ? SymbolInfoDouble(_Symbol, SYMBOL_ASK)
                         : SymbolInfoDouble(_Symbol, SYMBOL_BID);
   if(entry <= 0 || atr <= 0)
      return;

   double slDist = atr * InpAtrSLMult;
   if(slDist <= 0)
      return;

   double tpDist;
   if(InpTPMode == RF_TP_MEAN)
   {
      // เป้าคือค่ากลางของแบนด์ — ระยะจึงไม่คงที่ ขึ้นกับว่าเหวี่ยงออกไปไกลแค่ไหน
      tpDist = MathAbs(mid - entry);
      if(tpDist < atr * InpMinTPAtr)
         tpDist = atr * InpMinTPAtr; // ใกล้ค่ากลางเกินไป กำไรไม่คุ้มสเปรด
   }
   else if(InpTPMode == RF_TP_ATR)
      tpDist = atr * InpTPMult;
   else
      tpDist = slDist * InpTPMult; // ตัวคูณ R

   double sl = isLong ? entry - slDist : entry + slDist;
   double tp = isLong ? entry + tpDist : entry - tpDist;

   // lot คิดจากทุนเสี่ยงต่อไม้ หน่วย "จุด" ตามนิยามของผู้ใช้ (0.01 ของราคา)
   // ไม่ใช่ SYMBOL_POINT ของ broker — ดู bugs.md 2026-09-04 เรื่อง lot ผิด 10 เท่า
   double slPoints = slDist / InpRiskPointUnit;
   if(slPoints <= 0)
      return;
   double lot = NormalizeVolume(InpRiskPerTrade / slPoints);
   if(lot <= 0)
   {
      gCnt_LotTooSmall++;
      return;
   }

   bool ok = isLong
      ? trade.Buy(lot, _Symbol, 0, NormalizeDouble(sl, _Digits), NormalizeDouble(tp, _Digits), "RangeFade")
      : trade.Sell(lot, _Symbol, 0, NormalizeDouble(sl, _Digits), NormalizeDouble(tp, _Digits), "RangeFade");

   if(!ok)
   {
      gCnt_OpenFail++;
      return;
   }

   gCnt_Entered++;
   gEntryBarTime = iTime(_Symbol, PERIOD_CURRENT, 0);
}

//+------------------------------------------------------------------+
void OnTick()
{
   CheckTimeExit();

   datetime barTime = iTime(_Symbol, PERIOD_CURRENT, 0);
   if(barTime == gLastBarTime)
      return;

   // ตัดสินใจบนแท่งที่ปิดแล้วเท่านั้น
   double mid   = Buf(hMid, 0, 1);
   double upper = Buf(hMid, 1, 1);
   double atr   = Buf(hATR, 0, 1);
   if(mid <= 0 || upper <= 0 || atr <= 0)
      return; // ข้อมูลยังไม่พร้อม ยังไม่ถือว่าแท่งนี้ประมวลผลแล้ว

   gLastBarTime = barTime;
   gCnt_Bars++;

   if(gCooldownLeft > 0)
      gCooldownLeft--;

   double sd = (upper - mid) / MathMax(InpBandDev, 1e-9);
   if(sd <= 0)
      return;

   double c1 = iClose(_Symbol, PERIOD_CURRENT, 1);
   double c2 = iClose(_Symbol, PERIOD_CURRENT, 2);
   double z  = (c1 - mid) / sd;

   bool wantLong  = z <= -InpZEntry;
   bool wantShort = z >= InpZEntry;
   if(!wantLong && !wantShort)
      return;
   gCnt_Stretch++;

   if(!SessionOk(iTime(_Symbol, PERIOD_CURRENT, 1)))
   {
      gCnt_RejSession++;
      return;
   }
   if(HasPosition())
   {
      gCnt_RejBusy++;
      return;
   }
   if(gCooldownLeft > 0)
   {
      gCnt_RejCooldown++;
      return;
   }

   // กรองเทรนด์: สวนได้เฉพาะเมื่อภาพใหญ่ไม่ขัด (หรือขัด แล้วแต่โหมด)
   if(InpTrendMode != RF_TREND_OFF)
   {
      double tr = Buf(hTrend, 0, 1);
      if(tr > 0)
      {
         bool aboveTrend = c1 > tr;
         if(InpTrendMode == RF_TREND_WITH && wantLong && !aboveTrend)  { gCnt_RejTrend++; return; }
         if(InpTrendMode == RF_TREND_WITH && wantShort && aboveTrend)  { gCnt_RejTrend++; return; }
         if(InpTrendMode == RF_TREND_AGAINST && wantLong && aboveTrend) { gCnt_RejTrend++; return; }
         if(InpTrendMode == RF_TREND_AGAINST && wantShort && !aboveTrend) { gCnt_RejTrend++; return; }
      }
   }

   if(InpUseRSI)
   {
      double rsi = Buf(hRSI, 0, 1);
      if(rsi <= 0 ||
         (wantLong && rsi > InpRSILow) ||
         (wantShort && rsi < InpRSIHigh))
      {
         gCnt_RejRSI++;
         return;
      }
   }

   // รอให้แท่งล่าสุดหันกลับก่อน — เข้าตอนที่ยังไหลอยู่คือรับมีดที่ตกลงมา
   if(InpNeedTurn && ((wantLong && c1 <= c2) || (wantShort && c1 >= c2)))
   {
      gCnt_RejTurn++;
      return;
   }

   OpenTrade(wantLong, mid, atr);
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
//| เขียนผลของ pass นี้ลงไฟล์ในโฟลเดอร์ Common                          |
//| 1 pass = 1 ไฟล์ ชื่อไฟล์ประกอบจากค่าพารามิเตอร์ทั้งชุด จึงไม่ชนกัน    |
//| ระหว่าง agent หลายตัวที่รันขนานกัน แล้วค่อยรวมไฟล์ทีหลัง             |
//+------------------------------------------------------------------+
void DumpPass(const double score)
{
   string tf = StringSubstr(EnumToString((ENUM_TIMEFRAMES)Period()), 7);

   // ชื่อไฟล์ต้องมี "ทุก" พารามิเตอร์ที่ไล่หาได้ ไม่งั้นชุดที่ต่างกันจะเขียนทับกัน
   // แล้วรอบนั้นเหลือผลชุดเดียวโดยไม่มีอะไรฟ้อง — เคยพลาดกับช่วงเวลา 2026-09-11
   string stem = StringFormat("%s_%s_%d_%.1f_%.2f_%d_%.2f_%.2f_%d_%d_%d_%d_%d_%d_%d_%d_%d_%d",
                              _Symbol, tf, InpBandPeriod, InpBandDev, InpZEntry,
                              (int)InpTPMode, InpTPMult, InpAtrSLMult, InpMaxBars,
                              (int)InpTrendMode, InpTrendPeriod, (int)InpUseRSI,
                              (int)InpRSILow, (int)InpRSIHigh, (int)InpNeedTurn,
                              InpCooldownBars, InpHourFrom, InpHourTo);
   string path = "rangefade_opt\\" + stem + ".csv";

   int h = FileOpen(path, FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_COMMON);
   if(h == INVALID_HANDLE)
      return;

   WriteMonthlySeries("rangefade_opt\\monthly\\" + stem + ".csv");

   FileWrite(h, StringFormat("%s;%s;%d;%.1f;%.2f;%d;%.2f;%.2f;%d;%d;%d;%d;%d;%d;%d;%d;%d;%d;",
             _Symbol, tf, InpBandPeriod, InpBandDev, InpZEntry,
             (int)InpTPMode, InpTPMult, InpAtrSLMult, InpMaxBars,
             (int)InpTrendMode, InpTrendPeriod, (int)InpUseRSI,
             (int)InpRSILow, (int)InpRSIHigh, (int)InpNeedTurn, InpCooldownBars,
             InpHourFrom, InpHourTo)
            + MetricsCsvTail(score));
   FileClose(h);
}
//+------------------------------------------------------------------+
