//+------------------------------------------------------------------+
//| MARibbonVisual.mq5                                                 |
//| อินดิเคเตอร์คู่กับ MARibbonEA — วาดสิ่งที่ EA ใช้ตัดสินใจจริงๆ        |
//|                                                                    |
//| ชาร์ต MT5 ปกติโชว์เส้นค่าเฉลี่ย 13 เส้นพันกัน แต่ EA ไม่ได้ดูเส้นเดี่ยว |
//| มันดู "ค่าเฉลี่ยของกลุ่มสั้น 6 เส้น" ตัด "ค่าเฉลี่ยของกลุ่มยาว 7 เส้น" |
//| ซึ่งไม่มีอยู่บนชาร์ต ตัวนี้วาดสองเส้นนั้น + แถบสี + ลูกศรตรงจุดตัด     |
//|                                                                    |
//| แถบสี = ช่องระหว่างเส้นสั้นสุด (MA5) กับเส้นยาวสุด (MA60) เขียวเมื่อ   |
//| shortAvg > longAvg แดงเมื่อกลับกัน — นิยามเดียวกับ isBull ใน Pine    |
//| สีมาจากค่าเฉลี่ยกลุ่ม ไม่ใช่จากขอบแถบว่าเส้นไหนอยู่บน จึงต้องแยก       |
//| บัฟเฟอร์เขียว/แดงคนละคู่ แทนที่จะใช้ DRAW_FILLING คู่เดียวสองสี        |
//|                                                                    |
//| พารามิเตอร์ต้องตรงกับ EA ทุกตัว ไม่งั้นเส้นที่เห็นไม่ใช่เส้นที่ EA ใช้  |
//+------------------------------------------------------------------+
#property strict
#property indicator_chart_window
#property indicator_buffers 10
#property indicator_plots   6

#property indicator_label1  "Bull"
#property indicator_type1   DRAW_FILLING
#property indicator_color1  C'205,240,205',C'205,240,205'

#property indicator_label2  "Bear"
#property indicator_type2   DRAW_FILLING
#property indicator_color2  C'250,210,210',C'250,210,210'

#property indicator_label3  "ShortAvg"
#property indicator_type3   DRAW_LINE
#property indicator_color3  clrDeepSkyBlue
#property indicator_width3  2

#property indicator_label4  "LongAvg"
#property indicator_type4   DRAW_LINE
#property indicator_color4  clrOrange
#property indicator_width4  2

#property indicator_label5  "Buy"
#property indicator_type5   DRAW_ARROW
#property indicator_color5  clrLime
#property indicator_width5  3

#property indicator_label6  "Sell"
#property indicator_type6   DRAW_ARROW
#property indicator_color6  clrRed
#property indicator_width6  3

input ENUM_MA_METHOD InpMAMethod = MODE_EMA; // ชนิดค่าเฉลี่ย
input int InpS1 = 5;   // เส้นสั้น 1
input int InpS2 = 8;   // เส้นสั้น 2
input int InpS3 = 11;  // เส้นสั้น 3
input int InpS4 = 14;  // เส้นสั้น 4
input int InpS5 = 17;  // เส้นสั้น 5
input int InpS6 = 20;  // เส้นสั้น 6
input int InpL1 = 30;  // เส้นยาว 1
input int InpL2 = 35;  // เส้นยาว 2
input int InpL3 = 40;  // เส้นยาว 3
input int InpL4 = 45;  // เส้นยาว 4
input int InpL5 = 50;  // เส้นยาว 5
input int InpL6 = 55;  // เส้นยาว 6
input int InpL7 = 60;  // เส้นยาว 7
input bool InpShowAvgLines = true; // แสดงเส้นค่าเฉลี่ย 2 กลุ่ม (Pine ไม่แสดง)

const int SHORT_COUNT = 6;
const int LONG_COUNT  = 7;

double BufBullFast[];
double BufBullSlow[];
double BufBearFast[];
double BufBearSlow[];
double BufShort[];
double BufLong[];
double BufBuy[];
double BufSell[];
// บัฟเฟอร์คำนวณ ไม่ได้พล็อต
double BufFast[];
double BufSlow[];

int hShort[6];
int hLong[7];
int hFast = INVALID_HANDLE; // ขอบแถบด้านสั้น = MA(InpS1)
int hSlow = INVALID_HANDLE; // ขอบแถบด้านยาว = MA(InpL7)

//+------------------------------------------------------------------+
int OnInit()
{
   int sp[6]; sp[0]=InpS1; sp[1]=InpS2; sp[2]=InpS3; sp[3]=InpS4; sp[4]=InpS5; sp[5]=InpS6;
   int lp[7]; lp[0]=InpL1; lp[1]=InpL2; lp[2]=InpL3; lp[3]=InpL4; lp[4]=InpL5; lp[5]=InpL6; lp[6]=InpL7;

   SetIndexBuffer(0, BufBullFast, INDICATOR_DATA);
   SetIndexBuffer(1, BufBullSlow, INDICATOR_DATA);
   SetIndexBuffer(2, BufBearFast, INDICATOR_DATA);
   SetIndexBuffer(3, BufBearSlow, INDICATOR_DATA);
   SetIndexBuffer(4, BufShort,    INDICATOR_DATA);
   SetIndexBuffer(5, BufLong,     INDICATOR_DATA);
   SetIndexBuffer(6, BufBuy,      INDICATOR_DATA);
   SetIndexBuffer(7, BufSell,     INDICATOR_DATA);
   SetIndexBuffer(8, BufFast,     INDICATOR_CALCULATIONS);
   SetIndexBuffer(9, BufSlow,     INDICATOR_CALCULATIONS);

   ArraySetAsSeries(BufBullFast, false);
   ArraySetAsSeries(BufBullSlow, false);
   ArraySetAsSeries(BufBearFast, false);
   ArraySetAsSeries(BufBearSlow, false);
   ArraySetAsSeries(BufShort,    false);
   ArraySetAsSeries(BufLong,     false);
   ArraySetAsSeries(BufBuy,      false);
   ArraySetAsSeries(BufSell,     false);
   ArraySetAsSeries(BufFast,     false);
   ArraySetAsSeries(BufSlow,     false);

   // 0 = ไม่มีค่า จะได้ไม่วาดแถบ/ลูกศรทุกแท่ง
   for(int i = 0; i < 6; i++)
      PlotIndexSetDouble(i, PLOT_EMPTY_VALUE, 0.0);

   if(!InpShowAvgLines)
   {
      PlotIndexSetInteger(2, PLOT_DRAW_TYPE, DRAW_NONE);
      PlotIndexSetInteger(3, PLOT_DRAW_TYPE, DRAW_NONE);
   }

   PlotIndexSetInteger(4, PLOT_ARROW, 233); // ลูกศรขึ้น
   PlotIndexSetInteger(5, PLOT_ARROW, 234); // ลูกศรลง

   for(int i = 0; i < SHORT_COUNT; i++)
   {
      hShort[i] = iMA(_Symbol, PERIOD_CURRENT, sp[i], 0, InpMAMethod, PRICE_CLOSE);
      if(hShort[i] == INVALID_HANDLE)
         return INIT_FAILED;
   }
   for(int i = 0; i < LONG_COUNT; i++)
   {
      hLong[i] = iMA(_Symbol, PERIOD_CURRENT, lp[i], 0, InpMAMethod, PRICE_CLOSE);
      if(hLong[i] == INVALID_HANDLE)
         return INIT_FAILED;
   }
   hFast = hShort[0];
   hSlow = hLong[LONG_COUNT - 1];

   IndicatorSetString(INDICATOR_SHORTNAME, "MA Ribbon (EA view)");
   IndicatorSetInteger(INDICATOR_DIGITS, _Digits);
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| บวกค่าของ handle ทั้งชุดลง dst ช่วง [from, rates_total-1] แล้วหารจำนวน|
//+------------------------------------------------------------------+
bool AccumulateCluster(const int &handles[], const int count,
                       double &dst[], const int from, const int rates_total)
{
   int need = rates_total - from;
   if(need <= 0)
      return true;

   double tmp[];
   ArraySetAsSeries(tmp, false);

   for(int h = 0; h < count; h++)
   {
      if(CopyBuffer(handles[h], 0, 0, need, tmp) < need)
         return false;
      for(int k = 0; k < need; k++)
         dst[from + k] += tmp[k];
   }
   for(int k = 0; k < need; k++)
      dst[from + k] /= count;
   return true;
}

//+------------------------------------------------------------------+
bool CopyOne(const int handle, double &dst[], const int from, const int rates_total)
{
   int need = rates_total - from;
   if(need <= 0)
      return true;

   double tmp[];
   ArraySetAsSeries(tmp, false);
   if(CopyBuffer(handle, 0, 0, need, tmp) < need)
      return false;
   for(int k = 0; k < need; k++)
      dst[from + k] = tmp[k];
   return true;
}

//+------------------------------------------------------------------+
int OnCalculate(const int rates_total,
                const int prev_calculated,
                const datetime &time[],
                const double &open[],
                const double &high[],
                const double &low[],
                const double &close[],
                const long &tick_volume[],
                const long &volume[],
                const int &spread[])
{
   int longest = InpL7;
   if(rates_total < longest + 3)
      return 0;

   // MA ต้องคำนวณครบก่อน ไม่งั้นค่าที่ copy มาเป็นศูนย์แล้วแถบ/ลูกศรจะหลอก
   for(int i = 0; i < SHORT_COUNT; i++)
      if(BarsCalculated(hShort[i]) < rates_total)
         return 0;
   for(int i = 0; i < LONG_COUNT; i++)
      if(BarsCalculated(hLong[i]) < rates_total)
         return 0;

   // แท่งล่าสุดเปลี่ยนได้ตลอด จึงคำนวณซ้ำเสมอ
   int from = prev_calculated > 1 ? prev_calculated - 1 : 0;

   for(int i = from; i < rates_total; i++)
   {
      BufShort[i]    = 0.0;
      BufLong[i]     = 0.0;
      BufBuy[i]      = 0.0;
      BufSell[i]     = 0.0;
      BufBullFast[i] = 0.0;
      BufBullSlow[i] = 0.0;
      BufBearFast[i] = 0.0;
      BufBearSlow[i] = 0.0;
   }

   if(!AccumulateCluster(hShort, SHORT_COUNT, BufShort, from, rates_total))
      return 0;
   if(!AccumulateCluster(hLong, LONG_COUNT, BufLong, from, rates_total))
      return 0;
   if(!CopyOne(hFast, BufFast, from, rates_total))
      return 0;
   if(!CopyOne(hSlow, BufSlow, from, rates_total))
      return 0;

   int start = MathMax(from, longest + 2);
   for(int i = start; i < rates_total; i++)
   {
      if(BufShort[i-1] == 0.0 || BufLong[i-1] == 0.0)
         continue;

      bool isBull = BufShort[i] > BufLong[i];

      if(isBull)
      {
         BufBullFast[i] = BufFast[i];
         BufBullSlow[i] = BufSlow[i];
      }
      else
      {
         BufBearFast[i] = BufFast[i];
         BufBearSlow[i] = BufSlow[i];
      }

      // แท่งที่เปลี่ยนฝั่งต้องเขียนทับแท่งก่อนหน้าด้วย ไม่งั้นแถบขาดเป็นช่อง
      bool prevBull = BufShort[i-1] > BufLong[i-1];
      if(prevBull != isBull && i - 1 >= longest)
      {
         if(isBull)
         {
            BufBullFast[i-1] = BufFast[i-1];
            BufBullSlow[i-1] = BufSlow[i-1];
         }
         else
         {
            BufBearFast[i-1] = BufFast[i-1];
            BufBearSlow[i-1] = BufSlow[i-1];
         }
      }

      double range = high[i] - low[i];
      if(range <= 0)
         range = _Point * 10;

      // เงื่อนไขเดียวกับ ta.crossover/ta.crossunder ของ Pine และกับ EA
      if(BufShort[i] > BufLong[i] && BufShort[i-1] <= BufLong[i-1])
         BufBuy[i] = low[i] - range;
      else if(BufShort[i] < BufLong[i] && BufShort[i-1] >= BufLong[i-1])
         BufSell[i] = high[i] + range;
   }

   return rates_total;
}
//+------------------------------------------------------------------+
