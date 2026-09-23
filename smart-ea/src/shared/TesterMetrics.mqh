//+------------------------------------------------------------------+
//| TesterMetrics.mqh                                                  |
//| ตัวชี้วัด "ถอนกำไรได้สม่ำเสมอ" + สูตรให้คะแนน ใช้ร่วมกันทุกกลยุทธ์    |
//|                                                                    |
//| TesterStatistics() ให้แต่ภาพรวมทั้งช่วง บอกไม่ได้ว่ากำไรกระจายตัวยังไง |
//| ซึ่งเป็นหัวใจของการถอนเงินรายเดือน จึงต้องเดินประวัติดีลเองแล้วจับกลุ่ม |
//| ตาม position id (ไม้เดียวอาจมีหลายดีลจากการปิดแบ่งไม้ย่อย)            |
//|                                                                    |
//| ไฟล์นี้ไม่รู้จักพารามิเตอร์ของกลยุทธ์ใดเลย ตัวที่เขียน CSV จึงอยู่ที่    |
//| core ของแต่ละกลยุทธ์ (คอลัมน์พารามิเตอร์ต่างกัน) ส่วนคอลัมน์ตัวชี้วัด   |
//| ให้เรียก MetricsCsvTail() เพื่อให้ทุกกลยุทธ์เรียงเหมือนกันเสมอ         |
//+------------------------------------------------------------------+
#ifndef TESTER_METRICS_MQH
#define TESTER_METRICS_MQH

// เป้าหมายที่ใช้ให้คะแนน — คุณสมบัติที่ต้องได้ของ EA ที่ถอนกำไรได้จริง
const double TGT_WINRATE       = 0.50; // winrate ที่ต้องการ
const double TGT_MAX_WIN_SHARE = 0.15; // ไม้กำไรใหญ่สุด ต่อกำไรสุทธิรวม
const double TGT_TRADES_MONTH  = 20.0; // ไม้ต่อเดือนขั้นต่ำที่ถอนได้จริง

int    gStTrades      = 0;
int    gStWins        = 0;
double gStWinrate     = 0;
double gStMaxWin      = 0;   // กำไรของไม้ที่ได้มากสุด (USD)
double gStGrossProfit = 0;
double gStShareNet    = 0;   // ไม้ใหญ่สุด / กำไรสุทธิ
double gStShareGross  = 0;   // ไม้ใหญ่สุด / กำไรรวมฝั่งบวก
double gStAvgHoldH    = 0;
int    gStMonths      = 0;
int    gStPosMonths   = 0;
double gStPosMonthPct = 0;
double gStWorstMonth  = 0;
double gStMedianMonth = 0;
int    gStMaxConsecLoss = 0;

// กำไรรายเดือนเรียงตามเวลา + เดือนแรก (ปี*12+เดือน) ที่ดัชนี 0 หมายถึง
// เก็บไว้ให้ WriteMonthlySeries() เขียนออกไฟล์ ตัวเลขรวมทั้งช่วงบอกไม่ได้ว่า
// เดือนไหนขาดทุน และการรวมพอร์ตหลาย EA ต้องบวกกันเป็นเดือนต่อเดือน
double gStMonthly[];
int    gStMonthlyTrades[];
int    gStMonthFirst = 0;

//+------------------------------------------------------------------+
void CollectTradeStats()
{
   gStTrades = 0; gStWins = 0; gStWinrate = 0; gStMaxWin = 0; gStGrossProfit = 0;
   gStShareNet = 0; gStShareGross = 0; gStAvgHoldH = 0;
   gStMonths = 0; gStPosMonths = 0; gStPosMonthPct = 0;
   gStWorstMonth = 0; gStMedianMonth = 0; gStMaxConsecLoss = 0;

   if(!HistorySelect(0, TimeCurrent()))
      return;

   int total = HistoryDealsTotal();
   if(total <= 0)
      return;

   long     ids[];   // position id ของแต่ละไม้
   double   nets[];  // กำไรสุทธิรวมของไม้นั้น (profit + swap + commission)
   datetime opens[], closes[];
   ArrayResize(ids, 0); ArrayResize(nets, 0);
   ArrayResize(opens, 0); ArrayResize(closes, 0);
   int n = 0;

   for(int i = 0; i < total; i++)
   {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0)
         continue;
      long type = HistoryDealGetInteger(ticket, DEAL_TYPE);
      if(type != DEAL_TYPE_BUY && type != DEAL_TYPE_SELL)
         continue; // ตัด balance/credit ออก

      long     pid   = HistoryDealGetInteger(ticket, DEAL_POSITION_ID);
      long     entry = HistoryDealGetInteger(ticket, DEAL_ENTRY);
      datetime t     = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);
      double   net   = HistoryDealGetDouble(ticket, DEAL_PROFIT)
                     + HistoryDealGetDouble(ticket, DEAL_SWAP)
                     + HistoryDealGetDouble(ticket, DEAL_COMMISSION);

      // หาไม้ที่ดีลนี้สังกัด — EA ถือไม้เดียว ไม้ล่าสุดจึงเกือบเสมอคือไม้ที่ใช่
      int slot = -1;
      for(int k = n - 1; k >= 0 && k >= n - 4; k--)
         if(ids[k] == pid) { slot = k; break; }

      if(slot < 0)
      {
         slot = n;
         n++;
         ArrayResize(ids, n); ArrayResize(nets, n);
         ArrayResize(opens, n); ArrayResize(closes, n);
         ids[slot] = pid; nets[slot] = 0;
         opens[slot] = t; closes[slot] = t;
      }

      if(entry == DEAL_ENTRY_IN)
         opens[slot] = t;
      else
      {
         nets[slot] += net;
         if(t > closes[slot])
            closes[slot] = t;
      }
   }

   if(n <= 0)
      return;

   // เดือนที่กำไร: จับกลุ่มตามเดือนปฏิทินของ "เวลาปิดไม้"
   int minIdx = 0, maxIdx = 0;
   for(int k = 0; k < n; k++)
   {
      MqlDateTime dt;
      TimeToStruct(closes[k], dt);
      int mi = dt.year * 12 + dt.mon;
      if(k == 0 || mi < minIdx) minIdx = mi;
      if(k == 0 || mi > maxIdx) maxIdx = mi;
   }
   int months = maxIdx - minIdx + 1;
   double msum[];
   ArrayResize(msum, months);
   ArrayInitialize(msum, 0.0);
   gStMonthFirst = minIdx;
   ArrayResize(gStMonthly, months);
   ArrayResize(gStMonthlyTrades, months);
   ArrayInitialize(gStMonthly, 0.0);
   ArrayInitialize(gStMonthlyTrades, 0);

   double totalHold = 0;
   int consec = 0;
   for(int k = 0; k < n; k++)
   {
      gStTrades++;
      if(nets[k] > 0)
      {
         gStWins++;
         gStGrossProfit += nets[k];
         if(nets[k] > gStMaxWin)
            gStMaxWin = nets[k];
         consec = 0;
      }
      else
      {
         consec++;
         if(consec > gStMaxConsecLoss)
            gStMaxConsecLoss = consec;
      }
      totalHold += (double)(closes[k] - opens[k]);

      MqlDateTime dtm;
      TimeToStruct(closes[k], dtm);
      int slotM = dtm.year * 12 + dtm.mon - minIdx;
      msum[slotM] += nets[k];
      gStMonthly[slotM] += nets[k];
      gStMonthlyTrades[slotM]++;
   }

   gStWinrate  = (double)gStWins / (double)gStTrades;
   gStAvgHoldH = totalHold / (double)gStTrades / 3600.0;
   gStMonths   = months;

   for(int m = 0; m < months; m++)
      if(msum[m] > 0)
         gStPosMonths++;
   gStPosMonthPct = (double)gStPosMonths / (double)months;

   double sorted[];
   ArrayResize(sorted, months);
   ArrayCopy(sorted, msum);
   ArraySort(sorted);
   gStWorstMonth  = sorted[0];
   gStMedianMonth = months % 2 == 1 ? sorted[months / 2]
                                    : (sorted[months / 2 - 1] + sorted[months / 2]) / 2.0;

   double netProfit = TesterStatistics(STAT_PROFIT);
   gStShareNet   = netProfit > 0 ? gStMaxWin / netProfit : 1.0;
   gStShareGross = gStGrossProfit > 0 ? gStMaxWin / gStGrossProfit : 1.0;
}

//+------------------------------------------------------------------+
//| คะแนนที่ optimizer ใช้จัดอันดับ (เลือก "Custom max" ใน Strategy Tester)|
//|                                                                    |
//| เดิมใช้ กำไรสุทธิ / ขาดทุนสูงสุด อย่างเดียว ซึ่งเลือกชุดที่ปล่อยไหลเสมอ |
//| (โหมด TP จึงแพ้ทุกรอบและไม่เคยได้โอกาส) แต่ชุดแบบนั้นถอนเงินรายเดือน  |
//| ไม่ได้ เพราะกำไรมาจากไม้ใหญ่นานๆ ครั้งและมีเดือนขาดทุนเยอะ            |
//|                                                                    |
//| เกณฑ์นี้ = recovery factor คูณตัวประกอบความสม่ำเสมอ 4 ตัว ทุกตัวอยู่   |
//| ในช่วง 0..1 และ "อิ่มตัว" เมื่อถึงเป้า จึงไม่ให้รางวัลการเกินเป้าเปล่าๆ |
//| และยังมีความชันให้ genetic algorithm ไต่ ไม่ใช่ประตูตัด 0/1 ซึ่งจะทำให้ |
//| ทุกชุดได้ 0 เท่ากันแล้วค้นหาต่อไม่ได้                                 |
//|                                                                    |
//| เรียก CollectTradeStats() ให้เองแล้ว ผู้เรียกอ่านค่า gSt* ต่อได้เลย   |
//+------------------------------------------------------------------+
double ConsistencyScore(const int minTrades, const double minProfit)
{
   double trades = TesterStatistics(STAT_TRADES);
   double profit = TesterStatistics(STAT_PROFIT);
   double dd     = TesterStatistics(STAT_EQUITY_DD);
   if(dd < 1.0)
      dd = 1.0; // กัน div-by-zero และกันคะแนนพุ่งจากชุดที่บังเอิญ DD จิ๋ว

   CollectTradeStats();

   if(trades < minTrades || profit <= minProfit || gStTrades <= 0 || gStMonths <= 0)
      return 0.0;

   double fWin   = MathMin(gStWinrate / TGT_WINRATE, 1.0);
   double fMonth = MathPow(gStPosMonthPct, 2.0);
   double fConc  = MathMin(TGT_MAX_WIN_SHARE / MathMax(gStShareNet, 1e-6), 1.0);
   double fFreq  = MathMin(((double)gStTrades / (double)gStMonths) / TGT_TRADES_MONTH, 1.0);

   // cap recovery factor ที่ 10 — กัน DD จิ๋วบังเอิญ (มักไม้น้อย/ไม่ทนทาน) ดันคะแนนพุ่งหลักร้อย
   // แล้วลอยขึ้นอันดับต้นของผลออปติไมซ์ทั้งที่ใช้งานจริงไม่ได้ (ตกลงกับผู้ใช้ 2026-09-14)
   double recovery = MathMin(profit / dd, 10.0);

   return recovery * fWin * fMonth * fConc * fFreq;
}

//+------------------------------------------------------------------+
//| ท้ายบรรทัด CSV — คอลัมน์ตัวชี้วัด 16 ช่อง เรียงเหมือนกันทุกกลยุทธ์      |
//| (เงินฝากตั้งต้นอยู่ช่องแรก เพราะช่องนั้นสั่งจาก ini ไม่ได้เสมอ ถ้าเลข   |
//|  ไม่ตรงกับที่ตั้งใจ แปลว่าผลรอบนั้นเทียบกับรอบอื่นไม่ได้)              |
//+------------------------------------------------------------------+
//+------------------------------------------------------------------+
//| เขียนกำไรรายเดือนออกเป็นไฟล์ — เรียกได้เฉพาะรอบรันเดี่ยว              |
//|                                                                    |
//| ตอน optimize ไม่เขียน เพราะจะได้ไฟล์เท่าจำนวน pass เปล่าๆ ตรวจด้วย    |
//| MQL_OPTIMIZATION ให้แล้วในนี้ ผู้เรียกไม่ต้องเช็คเอง                  |
//|                                                                    |
//| ต้องมีไฟล์นี้เพราะสองอย่าง: ดูได้ว่าเดือนไหนขาดทุน (ตัวเลขรวมทั้งช่วง  |
//| ปิดเรื่องนี้ไว้) และเอาไปบวกกันข้าม EA เพื่อดูว่าพอร์ตรวมนิ่งขึ้นไหม     |
//+------------------------------------------------------------------+
void WriteMonthlySeries(const string path)
{
   if(MQLInfoInteger(MQL_OPTIMIZATION))
      return;
   int months = ArraySize(gStMonthly);
   if(months <= 0)
      return;

   int h = FileOpen(path, FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_COMMON);
   if(h == INVALID_HANDLE)
      return;
   for(int m = 0; m < months; m++)
   {
      int idx  = gStMonthFirst + m;
      int year = (idx - 1) / 12;
      int mon  = idx - year * 12;
      FileWrite(h, StringFormat("%04d-%02d;%.2f;%d", year, mon, gStMonthly[m], gStMonthlyTrades[m]));
   }
   FileClose(h);
}

//+------------------------------------------------------------------+
string MetricsCsvTail(const double score)
{
   return StringFormat("%.0f;%.0f;%.2f;%.2f;%.2f;%.4f;"
                       "%.4f;%d;%d;%.4f;%.2f;%.2f;%.4f;%.4f;%.2f;%d;%.4f",
                       TesterStatistics(STAT_INITIAL_DEPOSIT),
                       TesterStatistics(STAT_TRADES),
                       TesterStatistics(STAT_PROFIT),
                       TesterStatistics(STAT_EQUITY_DD),
                       TesterStatistics(STAT_PROFIT_FACTOR),
                       TesterStatistics(STAT_EXPECTED_PAYOFF),
                       gStWinrate, gStMonths, gStPosMonths, gStPosMonthPct,
                       gStWorstMonth, gStMedianMonth, gStShareNet, gStShareGross,
                       gStAvgHoldH, gStMaxConsecLoss, score);
}

#endif
