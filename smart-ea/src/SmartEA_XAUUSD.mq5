//+------------------------------------------------------------------+
//| SmartEA_XAUUSD.mq5                                                 |
//| Adaptive statistical squeeze-breakout — ไม่มีค่าคงที่ที่เป็นการเดา   |
//| ทุกเกณฑ์อิงธรรมเนียมสถิติสากล (z-score 95% one-tail, Bartlett ACF   |
//| significance) หรือคำนวณสดจากข้อมูลจริง: baseline stats จาก ACF บน   |
//| D1 (recalibrate ทุกเดือน), ส่วนช่วง consolidation/breakout range    |
//| นับสดทุกแท่งจากความยาว "อั้นตัว" ปัจจุบัน (adaptive แบบ intraday)    |
//| จำกรอบอั้นตัวไว้ (armed) จนทะลุสำเร็จหรือกลับไปอั้นตัวรอบใหม่          |
//| TP อยู่ในกรอบวัน (ADR 14 วัน) — day-trade only ห้ามถือไม้ข้ามวัน      |
//+------------------------------------------------------------------+
#property strict
#include <Trade\Trade.mqh>

input double InpTotalCapital = 10000; // ทุนทั้งหมด (USD) — ใช้แสดงข้อมูล ไม่เข้าสูตร lot
input double InpRiskPerTrade = 200;   // ทุนต่อไม้ (USD) — เข้าสูตร lot โดยตรง

const string TradeSymbol = "XAUUSDm";

// ธรรมเนียมสถิติสากล (ไม่ใช่เลขเฉพาะกิจของโปรเจกต์นี้)
const double Z_CRITICAL          = 1.645; // 95% one-tail confidence — มาตรฐานสถิติ (ทดสอบผ่อนเป็น 90%=1.2816 แล้ว PF ตกเป็น 0.97 ขาดทุน — คงไว้ที่ 95%)
const double BARTLETT_Z          = 1.96;  // สูตรนัยสำคัญของ ACF สำหรับ white-noise (Bartlett's formula)
const int    ADX_PERIOD          = 14;
const double ADX_THRESHOLD       = 25.0;  // ธรรมเนียมของ Wilder ผู้คิดค้น ADX เอง (1978)
const int    EMA_FAST_PERIOD     = 50;    // MA cross สากล (ใช้ทั่วทุกตลาด ไม่ใช่ค่าเฉพาะทอง)
const int    EMA_SLOW_PERIOD     = 200;
const int    ATR_PERIOD          = 14;
const int    TRADING_DAYS_PER_YEAR = 252; // ธรรมเนียมอุตสาหกรรมการเงิน ใช้เป็นเพดานค้นหา ACF lag
const double MinRR_Required      = 2.0;   // กฎที่ผู้ใช้กำหนดเอง: TP ต้องให้ RR อย่างน้อยเท่านี้
const int    MaxPositions        = 1;
const double RiskPointUnit       = 0.01;  // 1 "point" ในสูตร lot = 0.01 ราคาเสมอ (XAUUSDm quote 3 ทศนิยม)
const int    MinVolWindowBars    = 20;    // กันเคส ACF หาไม่เจอ lag นัยสำคัญเลย (ตลาดไม่มี clustering) ไม่ให้ window เป็น 0/1

int      hADX_M5, hEMAFast_M5, hEMASlow_M5, hATR_M5;
datetime lastBarTime = 0;
CTrade   trade;

// ค่าที่คำนวณสดจากสถิติจริงของสัญลักษณ์ (ไม่ hardcode) — recalibrate ทุกเดือน
int gVolWindowBars   = 0; // จาก ACF ของ squared D1 return (volatility persistence) → ใช้เป็น baseline squeeze/volume/breakout range
int gCalibratedMonth = -1;
int gCalibratedYear  = -1;
int gBarsPerDayM5    = 0;

// สถานะ "จำกรอบอั้นตัวไว้" (armed) — เก็บกรอบ+volume อ้างอิงของ squeeze ล่าสุดที่ผ่านเกณฑ์จริง
// ไว้จนกว่าจะทะลุสำเร็จ หรือตลาดกลับไปอั้นตัวรอบใหม่ (ไม่ทิ้งทันทีที่ ATR เด้งขึ้น 1 แท่ง)
bool   gArmed           = false;
double gArmedRangeHigh  = 0;
double gArmedRangeLow   = 0;
long   gArmedRefVolume  = 0;

// ตัวนับ diagnostic ชั่วคราว: หา TryEnter ไปตายที่เงื่อนไขไหนบ่อยสุด (ไม่ใช่เดา ให้ข้อมูลบอกเอง)
int gCnt_MaxPos=0, gCnt_ADXFail=0, gCnt_NoTrend=0;
int gCnt_ATRStatsFail=0, gCnt_VolStatsFail=0, gCnt_NoSqueeze=0, gCnt_NoVolConfirm=0;
int gCnt_NoBreakout=0, gCnt_NoTP=0, gCnt_Entered=0;
int gCnt_ArmedEpisodes=0; // จำนวนครั้งจริงที่ตลาดอั้นตัวแตะเกณฑ์ (แยกจากนับรายแท่ง)

int OnInit()
{
   if(_Symbol != TradeSymbol)
   {
      Print("EA must run on ", TradeSymbol, " chart, currently on ", _Symbol);
      return INIT_FAILED;
   }

   hADX_M5     = iADX(TradeSymbol, PERIOD_M5, ADX_PERIOD);
   hEMAFast_M5 = iMA(TradeSymbol, PERIOD_M5, EMA_FAST_PERIOD, 0, MODE_EMA, PRICE_CLOSE);
   hEMASlow_M5 = iMA(TradeSymbol, PERIOD_M5, EMA_SLOW_PERIOD, 0, MODE_EMA, PRICE_CLOSE);
   hATR_M5     = iATR(TradeSymbol, PERIOD_M5, ATR_PERIOD);

   if(hADX_M5 == INVALID_HANDLE || hEMAFast_M5 == INVALID_HANDLE ||
      hEMASlow_M5 == INVALID_HANDLE || hATR_M5 == INVALID_HANDLE)
   {
      Print("Indicator handle creation failed");
      return INIT_FAILED;
   }

   CalibrateWindows();
   if(gVolWindowBars <= 0)
   {
      Print("Calibration failed — insufficient D1 history to compute ACF");
      return INIT_FAILED;
   }

   return INIT_SUCCEEDED;
}

// เพิ่ม key (ถ้ายังไม่มี) หรือบวกสะสมเข้า sum เดิม — ใช้ทำ bucket กำไรรายสัปดาห์/รายเดือน
void AccumulateBucket(long &keys[], double &sums[], long key, double profit)
{
   int n = ArraySize(keys);
   for(int i = 0; i < n; i++)
   {
      if(keys[i] == key)
      {
         sums[i] += profit;
         return;
      }
   }
   ArrayResize(keys, n + 1);
   ArrayResize(sums, n + 1);
   keys[n] = key;
   sums[n] = profit;
}

// สรุปกำไร-ขาดทุนจริงแยกตามสัปดาห์/เดือน จาก deal history จริง (ไม่ใช่เดา)
// ตอบคำถาม "ได้กำไรทุกสัปดาห์/ทุกเดือนมั้ย" ด้วยข้อมูลจริงหลัง backtest จบ
void PrintWeeklyMonthlyBreakdown()
{
   if(!HistorySelect(0, TimeCurrent()))
      return;

   long   weekKeys[];  double weekSums[];
   long   monthKeys[]; double monthSums[];

   int total = HistoryDealsTotal();
   for(int i = 0; i < total; i++)
   {
      ulong ticket = HistoryDealGetTicket(i);
      if(HistoryDealGetString(ticket, DEAL_SYMBOL) != TradeSymbol)
         continue;
      if((ENUM_DEAL_ENTRY)HistoryDealGetInteger(ticket, DEAL_ENTRY) != DEAL_ENTRY_OUT)
         continue; // เอาแค่ deal ที่ปิดไม้ (มีกำไร/ขาดทุนจริงเกิดขึ้น)

      double profit = HistoryDealGetDouble(ticket, DEAL_PROFIT)
                     + HistoryDealGetDouble(ticket, DEAL_SWAP)
                     + HistoryDealGetDouble(ticket, DEAL_COMMISSION);
      datetime dealTime = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);

      long weekKey = (long)(dealTime / 604800); // bucket ทุก 7 วันจาก epoch (ไม่ต้องคำนวณ ISO week ให้ซับซ้อน)
      AccumulateBucket(weekKeys, weekSums, weekKey, profit);

      MqlDateTime dt;
      TimeToStruct(dealTime, dt);
      long monthKey = dt.year * 100 + dt.mon;
      AccumulateBucket(monthKeys, monthSums, monthKey, profit);
   }

   int weekWin = 0, weekLose = 0;
   for(int i = 0; i < ArraySize(weekSums); i++)
   {
      if(weekSums[i] > 0) weekWin++;
      else if(weekSums[i] < 0) weekLose++;
   }

   int monthWin = 0, monthLose = 0;
   for(int i = 0; i < ArraySize(monthSums); i++)
   {
      if(monthSums[i] > 0) monthWin++;
      else if(monthSums[i] < 0) monthLose++;
   }

   PrintFormat("WEEKLY: %d/%d สัปดาห์กำไร (%d ขาดทุน)",
               weekWin, ArraySize(weekSums), weekLose);
   PrintFormat("MONTHLY: %d/%d เดือนกำไร (%d ขาดทุน)",
               monthWin, ArraySize(monthSums), monthLose);
}

void OnDeinit(const int reason)
{
   PrintFormat("DIAG: MaxPos=%d ADXFail=%d NoTrend=%d ATRStatsFail=%d VolStatsFail=%d NoSqueeze=%d NoVolConfirm=%d NoBreakout=%d NoTP=%d Entered=%d ArmedEpisodes=%d",
               gCnt_MaxPos, gCnt_ADXFail, gCnt_NoTrend, gCnt_ATRStatsFail, gCnt_VolStatsFail,
               gCnt_NoSqueeze, gCnt_NoVolConfirm, gCnt_NoBreakout, gCnt_NoTP, gCnt_Entered, gCnt_ArmedEpisodes);

   PrintWeeklyMonthlyBreakdown();

   IndicatorRelease(hADX_M5);
   IndicatorRelease(hEMAFast_M5);
   IndicatorRelease(hEMASlow_M5);
   IndicatorRelease(hATR_M5);
}

//+------------------------------------------------------------------+
//| Calibration: ACF บน D1 หา "ความจำ" ของตลาดตัวนี้เอง                |
//| lag ที่ ACF ตกต่ำกว่าเส้นนัยสำคัญ Bartlett = ขอบเขตความจำที่แท้จริง |
//| ไม่ใช่เลขที่เดา เป็นค่าที่วัดจากพฤติกรรมจริงของ XAUUSDm ช่วงที่ผ่านมา |
//+------------------------------------------------------------------+
int FindACFPersistenceLag(bool useSquaredReturns)
{
   int maxLag = TRADING_DAYS_PER_YEAR;
   int barsNeeded = maxLag + 2;
   int available  = iBars(TradeSymbol, PERIOD_D1);
   if(available < barsNeeded)
      barsNeeded = available;
   if(barsNeeded < 30) // ข้อมูลน้อยเกินจะวัด ACF ได้อย่างมีความหมาย
      return 0;

   int n = barsNeeded - 1; // จำนวน return ที่คำนวณได้
   double series[];
   ArrayResize(series, n);

   for(int i = 0; i < n; i++)
   {
      // shift น้อย = เวลาใหม่กว่า; ปิดวันนี้เทียบปิดเมื่อวาน ไล่ย้อนหลัง
      double c0 = iClose(TradeSymbol, PERIOD_D1, i + 1);
      double c1 = iClose(TradeSymbol, PERIOD_D1, i + 2);
      if(c1 == 0)
         return 0;
      double ret = (c0 - c1) / c1;
      series[i] = useSquaredReturns ? ret * ret : ret;
   }

   double mean = 0;
   for(int i = 0; i < n; i++)
      mean += series[i];
   mean /= n;

   double var0 = 0;
   for(int i = 0; i < n; i++)
      var0 += (series[i] - mean) * (series[i] - mean);
   if(var0 <= 0)
      return 0;

   double bartlettBound = BARTLETT_Z / MathSqrt((double)n);
   int    maxTestableLag = MathMin(maxLag, n - 1);

   for(int lag = 1; lag <= maxTestableLag; lag++)
   {
      double cov = 0;
      for(int i = 0; i < n - lag; i++)
         cov += (series[i] - mean) * (series[i + lag] - mean);
      double acf = cov / var0;

      if(MathAbs(acf) < bartlettBound)
         return lag; // ความจำของตลาดหมดที่ lag นี้ (แท่งก่อนหน้าไม่มีนัยสำคัญอีกต่อไป)
   }

   return maxTestableLag; // ไม่เจอจุดตัด → ใช้เพดานสูงสุด (1 ปีเทรดดิ้ง) เป็น fallback
}

void CalibrateWindows()
{
   int volLagDays = FindACFPersistenceLag(true); // squared return = volatility clustering

   double barsPerDayM5 = (double)PeriodSeconds(PERIOD_D1) / (double)PeriodSeconds(PERIOD_M5); // 288
   gBarsPerDayM5 = (int)MathRound(barsPerDayM5);

   gVolWindowBars = (int)MathRound(volLagDays * barsPerDayM5);
   if(gVolWindowBars < MinVolWindowBars)
      gVolWindowBars = MinVolWindowBars;

   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   gCalibratedMonth = dt.mon;
   gCalibratedYear  = dt.year;

   PrintFormat("Calibrated: volLagDays=%d -> VolWindow=%d bars", volLagDays, gVolWindowBars);
}

void CheckMonthlyRecalibration()
{
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   if(dt.mon != gCalibratedMonth || dt.year != gCalibratedYear)
      CalibrateWindows();
}

bool IsNewBar()
{
   datetime t = iTime(TradeSymbol, PERIOD_M5, 0);
   if(t != lastBarTime)
   {
      lastBarTime = t;
      return true;
   }
   return false;
}

double NormalizeLot(double lot)
{
   double minLot  = SymbolInfoDouble(TradeSymbol, SYMBOL_VOLUME_MIN);
   double maxLot  = SymbolInfoDouble(TradeSymbol, SYMBOL_VOLUME_MAX);
   double lotStep = SymbolInfoDouble(TradeSymbol, SYMBOL_VOLUME_STEP);

   lot = MathFloor(lot / lotStep + 0.5) * lotStep;
   lot = MathMax(minLot, MathMin(maxLot, lot));
   return NormalizeDouble(lot, 2);
}

double CalcLot(double slDistancePrice)
{
   double slPoints = slDistancePrice / RiskPointUnit;
   double rawLot   = InpRiskPerTrade / slPoints;
   return NormalizeLot(rawLot);
}

int CountOpenPositions()
{
   int count = 0;
   for(int i = 0; i < PositionsTotal(); i++)
      if(PositionGetSymbol(i) == TradeSymbol)
         count++;
   return count;
}

// ค่าเฉลี่ย+ส่วนเบี่ยงเบนมาตรฐานของ ATR (M5) ในช่วง baseline window (ไม่รวมแท่งที่กำลังทดสอบ กัน look-ahead)
bool GetATRStats(int startShift, int windowBars, double &meanOut, double &stdOut)
{
   double buf[];
   if(CopyBuffer(hATR_M5, 0, startShift, windowBars, buf) < windowBars)
      return false;

   double mean = 0;
   for(int i = 0; i < windowBars; i++)
      mean += buf[i];
   mean /= windowBars;

   double var = 0;
   for(int i = 0; i < windowBars; i++)
      var += (buf[i] - mean) * (buf[i] - mean);
   var /= windowBars;

   if(var <= 0)
      return false;

   meanOut = mean;
   stdOut  = MathSqrt(var);
   return true;
}

// ATR/Volume เบ้ขวา ไม่ใช่ normal distribution (มีขอบล่างที่ 0, มีวันพุ่งแรงลากค่าเฉลี่ยขึ้น)
// แปลงเป็น log ก่อนคำนวณ mean/std เพื่อให้ z-score มีความหมายทางสถิติจริง (ธรรมเนียม econometrics
// มาตรฐานสำหรับวัด volatility/volume ผิดปกติ ไม่ใช่การเดา) — ใช้เฉพาะการทดสอบ z-score เท่านั้น
bool GetLogATRStats(int startShift, int windowBars, double &meanOut, double &stdOut)
{
   double buf[];
   if(CopyBuffer(hATR_M5, 0, startShift, windowBars, buf) < windowBars)
      return false;

   double mean = 0;
   for(int i = 0; i < windowBars; i++)
   {
      if(buf[i] <= 0)
         return false;
      mean += MathLog(buf[i]);
   }
   mean /= windowBars;

   double var = 0;
   for(int i = 0; i < windowBars; i++)
   {
      double d = MathLog(buf[i]) - mean;
      var += d * d;
   }
   var /= windowBars;

   if(var <= 0)
      return false;

   meanOut = mean;
   stdOut  = MathSqrt(var);
   return true;
}

// นับสดว่าตอนนี้อั้นตัว (ATR ต่ำกว่าค่าเฉลี่ยตัวเอง) มาแล้วกี่แท่งติดกัน นับถอยจาก startShift
// (หยุดทันทีที่เจอแท่งที่ z>=0 คือหลุดออกจากอาการอั้นตัวแล้ว) — คืนความยาว streak + z ที่ต่ำสุดในนั้น
// ใช้แทนกรอบเวลาที่กำหนดตายตัว (adaptive ตามสภาพตลาดจริง ณ ขณะนั้น ไม่ใช่ค่าคงที่)
int GetContractionLength(int startShift, double meanLogATR, double stdLogATR, int capBars, double &minZOut)
{
   int    len  = 0;
   double minZ = DBL_MAX;

   for(int shift = startShift; shift < startShift + capBars; shift++)
   {
      double buf[1];
      if(CopyBuffer(hATR_M5, 0, shift, 1, buf) < 1)
         break;
      if(buf[0] <= 0)
         break;
      double z = (MathLog(buf[0]) - meanLogATR) / stdLogATR;
      if(z >= 0)
         break;
      if(z < minZ)
         minZ = z;
      len++;
   }

   minZOut = minZ;
   return len;
}

// ADR (Average Daily Range) — ค่าเฉลี่ยระยะ high-low รายวันย้อนหลัง `days` วัน (ไม่รวมวันนี้)
// ใช้ 14 วัน (ธรรมเนียม Wilder เดียวกับ ATR_PERIOD/ADX_PERIOD ที่ใช้อยู่แล้วในไฟล์นี้ ไม่ใช่เลขใหม่)
double ComputeADR(int days)
{
   double sum = 0;
   for(int shift = 1; shift <= days; shift++)
      sum += iHigh(TradeSymbol, PERIOD_D1, shift) - iLow(TradeSymbol, PERIOD_D1, shift);
   return sum / days;
}

// TP ต้องอยู่ภายใน "กรอบวัน" เท่านั้น (นับจากแท่ง D1 ที่ broker เปิด-ปิด) เล่นกับพฤติกรรมราคาใน 1 วัน
// ไม่ใช่ค้นหาย้อนไปเป็นปีแบบเดิม — เป้าหมาย = เปิดวันนี้ ± ADR (ธรรมเนียมมาตรฐานของการตั้ง TP รายวัน)
// แต่ถ้าวันนี้วิ่งเลย ADR ไปแล้วจริง (trend day) ให้ TP ขยายตามจุดสูง/ต่ำสุดที่วันนี้ทำได้แล้ว (ไม่ตัดโอกาส)
// ถ้า RR ที่ได้ยังไม่พอ MinRR_Required แปลว่าเหลือที่ให้วิ่งในวันนี้ไม่มากพอ ไม่ควรเข้าไม้
bool GetDayBoundedTP(bool isLong, double entry, double slDistance, double &tpOut)
{
   double dayOpen = iOpen(TradeSymbol, PERIOD_D1, 0);
   double adr     = ComputeADR(ATR_PERIOD);
   if(adr <= 0)
      return false;

   double adrTarget  = isLong ? dayOpen + adr : dayOpen - adr;
   double dayExtreme = isLong ? iHigh(TradeSymbol, PERIOD_D1, 0) : iLow(TradeSymbol, PERIOD_D1, 0);
   double tp         = isLong ? MathMax(adrTarget, dayExtreme) : MathMin(adrTarget, dayExtreme);

   double rr = isLong ? (tp - entry) / slDistance : (entry - tp) / slDistance;
   if(rr < MinRR_Required)
      return false;

   tpOut = tp;
   return true;
}

// เช็คทุกแท่ง: ถ้า thesis ที่ใช้เข้าไม้พังแล้ว (เทรนด์ M5 ตายหรือพลิกทิศ) ปิดไม้ทันที
void CheckTrendInvalidation()
{
   if(!PositionSelect(TradeSymbol))
      return;

   double adxBuf[1], emaFastBuf[1], emaSlowBuf[1];
   if(CopyBuffer(hADX_M5, 0, 1, 1, adxBuf) < 1)
      return;
   if(CopyBuffer(hEMAFast_M5, 0, 1, 1, emaFastBuf) < 1)
      return;
   if(CopyBuffer(hEMASlow_M5, 0, 1, 1, emaSlowBuf) < 1)
      return;

   bool isLongPos    = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY);
   bool trendUp      = emaFastBuf[0] > emaSlowBuf[0];
   bool trendDown    = emaFastBuf[0] < emaSlowBuf[0];
   bool trendDead    = adxBuf[0] < ADX_THRESHOLD;
   bool trendFlipped = (isLongPos && trendDown) || (!isLongPos && trendUp);

   if(trendDead || trendFlipped)
      trade.PositionClose(TradeSymbol);
}

// EA นี้เป็น day-trade/scalping เท่านั้น (กฎที่ผู้ใช้กำหนดเอง) — ห้ามถือไม้ข้ามวัน
// ปิดทันทีถ้าเปิดมาจากวันปฏิทินอื่นที่ไม่ใช่วันนี้ (server time) ไม่ว่ากำไร/ขาดทุนอยู่ก็ตาม
void CheckEndOfDayClose()
{
   if(!PositionSelect(TradeSymbol))
      return;

   datetime openTime = (datetime)PositionGetInteger(POSITION_TIME);
   MqlDateTime openDt, nowDt;
   TimeToStruct(openTime, openDt);
   TimeToStruct(TimeCurrent(), nowDt);

   bool sameDay = (openDt.year == nowDt.year && openDt.mon == nowDt.mon && openDt.day == nowDt.day);
   if(!sameDay)
      trade.PositionClose(TradeSymbol);
}

void TryEnter()
{
   if(CountOpenPositions() >= MaxPositions)
      { gCnt_MaxPos++; return; }

   // baseline stats (ไม่ผูกกับ compressed/released แยก ต้องใช้ทั้งสองสถานะ)
   double meanATR, stdATR;
   if(!GetATRStats(3, gVolWindowBars, meanATR, stdATR))
      { gCnt_ATRStatsFail++; return; }

   double meanLogATR, stdLogATR;
   if(!GetLogATRStats(3, gVolWindowBars, meanLogATR, stdLogATR))
      { gCnt_ATRStatsFail++; return; }

   double atrBuf[1];
   if(CopyBuffer(hATR_M5, 0, 1, 1, atrBuf) < 1)
      return;
   if(atrBuf[0] <= 0)
      return;
   double zATRNow        = (MathLog(atrBuf[0]) - meanLogATR) / stdLogATR;
   bool   stillCompressed = zATRNow < 0;

   if(stillCompressed)
   {
      // ยังอยู่ในช่วงอั้นตัว (ATR ล่าสุดยังต่ำกว่าค่าเฉลี่ยตัวเอง) — ยังไม่ใช่จังหวะปล่อยพลังงาน
      // อัปเดต "จำกรอบไว้" (armed) ถ้า streak นี้แตะเกณฑ์หายากจริง (ไม่ทิ้งง่ายๆ แค่เพราะยังไม่ทะลุตอนนี้)
      double minZInStreak;
      int    contractionBars = GetContractionLength(1, meanLogATR, stdLogATR, gVolWindowBars, minZInStreak);
      if(contractionBars > 0 && minZInStreak <= -Z_CRITICAL)
      {
         if(!gArmed)
            gCnt_ArmedEpisodes++; // นับเฉพาะตอนเริ่ม episode ใหม่ ไม่นับซ้ำทุกแท่งที่ยัง armed อยู่เดิม
         gArmedRangeHigh = iHigh(TradeSymbol, PERIOD_M5, iHighest(TradeSymbol, PERIOD_M5, MODE_HIGH, contractionBars, 1));
         gArmedRangeLow  = iLow(TradeSymbol,  PERIOD_M5, iLowest(TradeSymbol,  PERIOD_M5, MODE_LOW,  contractionBars, 1));
         long volBuf[1];
         if(CopyTickVolume(TradeSymbol, PERIOD_M5, 1, 1, volBuf) >= 1)
            gArmedRefVolume = volBuf[0];
         gArmed = true;
      }
      gCnt_NoSqueeze++;
      return;
   }

   // ATR หลุดจากช่วงอั้นตัวแล้ว (อาจเป็นแท่งปล่อยพลังงาน) — ต้องมีกรอบที่ armed ไว้ก่อนถึงจะมีอะไรให้ทดสอบ
   if(!gArmed)
      { gCnt_NoSqueeze++; return; }

   double adxBuf[1];
   if(CopyBuffer(hADX_M5, 0, 1, 1, adxBuf) < 1)
      return;
   if(adxBuf[0] < ADX_THRESHOLD)
      { gCnt_ADXFail++; return; }

   double emaFastBuf[1], emaSlowBuf[1];
   if(CopyBuffer(hEMAFast_M5, 0, 1, 1, emaFastBuf) < 1)
      return;
   if(CopyBuffer(hEMASlow_M5, 0, 1, 1, emaSlowBuf) < 1)
      return;

   bool trendUp   = emaFastBuf[0] > emaSlowBuf[0];
   bool trendDown = emaFastBuf[0] < emaSlowBuf[0];
   if(!trendUp && !trendDown)
      { gCnt_NoTrend++; return; }

   // เทียบ volume แท่งปล่อยพลังงาน (shift1) กับ volume อ้างอิงตอน armed (แท่งสุดท้ายของช่วงอั้นตัว)
   // นิยาม "ปล่อยพลังงาน" ที่ถูกต้องคือมีคนเข้าร่วม *มากกว่าตอนเงียบ* ไม่ใช่มากกว่าค่าเฉลี่ยระยะยาว
   long volBuf[1];
   if(CopyTickVolume(TradeSymbol, PERIOD_M5, 1, 1, volBuf) < 1)
      return;
   bool volumeReleasing = volBuf[0] > gArmedRefVolume;
   if(!volumeReleasing)
      { gCnt_NoVolConfirm++; return; }

   double openLast  = iOpen(TradeSymbol,  PERIOD_M5, 1);
   double closeLast = iClose(TradeSymbol, PERIOD_M5, 1);

   // ปิดต้องเลยกรอบที่ armed ไว้เด็ดขาด (ไม่ใช่แค่ไส้เทียนแตะ) + เป็นแท่งสีเดียวกับทิศทาง
   bool breakoutUp   = trendUp   && closeLast > gArmedRangeHigh && closeLast > openLast;
   bool breakoutDown = trendDown && closeLast < gArmedRangeLow  && closeLast < openLast;

   if(!breakoutUp && !breakoutDown)
      { gCnt_NoBreakout++; return; } // ยังไม่ทะลุ แต่กรอบยัง armed อยู่ รอแท่งถัดไปได้อีก

   // SL วางนอกช่วง "ปกติ" ของแท่งราคา (95% one-tail เดียวกับที่ใช้ตัดสิน squeeze/spike) ไม่ใช่ตัวคูณ ATR ที่เดา
   double slDistance = meanATR + Z_CRITICAL * stdATR;
   if(slDistance <= 0)
      return;

   double lot = CalcLot(slDistance);

   if(breakoutUp)
   {
      double ask = SymbolInfoDouble(TradeSymbol, SYMBOL_ASK);
      double sl  = ask - slDistance;
      double tp;
      if(!GetDayBoundedTP(true, ask, slDistance, tp))
         { gCnt_NoTP++; return; }
      if(trade.Buy(lot, TradeSymbol, ask, sl, tp))
         gCnt_Entered++;
      gArmed = false;
   }
   else if(breakoutDown)
   {
      double bid = SymbolInfoDouble(TradeSymbol, SYMBOL_BID);
      double sl  = bid + slDistance;
      double tp;
      if(!GetDayBoundedTP(false, bid, slDistance, tp))
         { gCnt_NoTP++; return; }
      if(trade.Sell(lot, TradeSymbol, bid, sl, tp))
         gCnt_Entered++;
      gArmed = false;
   }
}

void OnTick()
{
   if(!IsNewBar())
      return;

   CheckMonthlyRecalibration();
   CheckEndOfDayClose();
   CheckTrendInvalidation();
   TryEnter();
}
