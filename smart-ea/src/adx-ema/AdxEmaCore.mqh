//+------------------------------------------------------------------+
//| AdxEmaCore.mqh                                                     |
//| กลยุทธ์ที่ 5: พอร์ตจากไกด์ผู้ใช้ "จำลอง EDX Histogram ด้วย ADX+EMA บน    |
//| MT5" (ผู้ใช้ส่งข้อความอธิบายมาตรงๆ 2026-09-19 ไม่มี source โค้ด/Pine   |
//| ให้อ้างอิง — เขียนตรรกะขึ้นใหม่เองตามคำอธิบายนั้นตามธรรมนูญ)            |
//|                                                                    |
//| แนวคิด: ใช้ ADX มาตรฐาน (+DI/-DI/ADX main) ของ MT5 คู่กับ EMA ที่คำนวณ |
//| จาก "ค่า ADX main line" เอง (ไม่ใช่จากราคา) เป็น Signal Line —        |
//| ทิศทางตลาดดูจาก +DI vs -DI ส่วนจังหวะเข้า (โมเมนตัมเพิ่งเร่งตัว) ดูจาก  |
//| ADX ตัดขึ้นเหนือ EMA ของตัวมันเอง                                     |
//|                                                                    |
//| Engineering assumption (ผู้ใช้อธิบายเป็นภาพ/ขั้นตอน MT5 UI ไม่ใช่โค้ด  |
//| เป๊ะๆ — ตัดสินใจเองตามกฎ "ห้ามเดา" คือห้ามเดาพฤติกรรม ไม่ใช่ห้ามออกแบบ |
//| ตรรกะที่ไม่มีสเปกเป๊ะ):                                              |
//| - EMA ของ ADX คำนวณเป็น running EMA ปกติ (ไม่ใช้ iMA ตรงๆ เพราะ MT5   |
//|   ไม่มีทาง apply MA กับ buffer ของ indicator อื่นผ่าน code ได้ตรงๆ    |
//|   ต้องคำนวณเอง) วอร์มค่าเริ่มต้นจากประวัติจริงตอน OnInit ด้วย SMA ของ  |
//|   ช่วงเก่าสุดในหน้าต่าง lookback แล้วไล่ EMA มาเรื่อยๆ จนถึงแท่งล่าสุด   |
//| - Cross ตรวจที่แท่งปิดเท่านั้น (กัน repaint) — เทียบ ADX/EMA ของแท่ง   |
//|   ที่เพิ่งปิด (shift1) กับแท่งก่อนหน้า (shift2)                        |
//| - เพิ่มตัวกรอง InpMinDiGap (ผู้ใช้ไม่ได้ระบุตัวเลข แต่บรรยาย "No Trade  |
//|   Zone: +DI/-DI ตัดกันไปมา") กันเข้าไม้ตอนสองเส้นแทบซ้อนกัน            |
//| - "ADX ตัดขึ้นเหนือ EMA5" เป็นเงื่อนไขเดียวกันทั้ง BUY/SELL ตามคำอธิบาย  |
//|   ผู้ใช้ตรงๆ ทิศทางมาจาก +DI/-DI แยกต่างหาก ไม่ใช่จากทิศของ cross      |
//| - เพิ่มฟีเจอร์ปิดไม้เมื่อโมเมนตัมหมด (ADX ตกกลับต่ำกว่า EMA) ตาม        |
//|   "Pro Tip" ของผู้ใช้ — ปิดได้ก่อน SL/TP ถ้าเปิดใช้ (InpExitOnMomentumLoss)|
//|                                                                    |
//| ไฟล์นี้ไม่ประกาศ input เอง — อ้างถึงตัวแปรที่ AdxEmaEA.mq5 ประกาศไว้    |
//| ก่อน include (มิเรอร์ SdPaAdxCore.mqh/AmdPo3Core.mqh)                 |
//+------------------------------------------------------------------+
#include "..\shared\PositionLib.mqh"
#include "..\shared\TesterMetrics.mqh"

// forward declaration — เรียกใช้ก่อนตัวจริง (นิยามอยู่ท้ายไฟล์) ตอนปิดไม้จาก momentum-exit/cutoff
void AdxEmaSendStatusSummary();

#define ADXEMA_VERSION "1.1"
#define ADXEMA_UPDATED "23/09/26"

const int ADXEMA_HEARTBEAT_MAX_SEC = 120; // ค่าเดียวกับ SATS (ผู้ใช้เลือกไว้ 2026-09-17)

// ล็อก timeframe การเทรดไว้ที่ M1 ตายตัว (ผู้ใช้ขอ 2026-09-22 — ไม่อยากยุ่งกับการแก้ .set)
// ไม่ใช่ input เพราะตั้งใจให้แก้ไม่ได้ผ่าน Inputs tab — จะสลับดูชาร์ต TF อื่นได้ตามปกติ (attach
// เข้ากับชาร์ต M1/M5/H1 ก็ได้) แต่ตรรกะเข้า/ออกไม้ทั้งหมดยังคำนวณจากแท่ง M1 เสมอ ไม่ผูกกับ
// PERIOD_CURRENT ของชาร์ตอีกต่อไป (OnTick() รับทุก tick อยู่แล้วไม่ว่าชาร์ตจะโชว์ TF ไหน)
#define ADXEMA_TRADE_TF PERIOD_M1

int hADX = INVALID_HANDLE;
int hATR = INVALID_HANDLE;

datetime gLastBarTime   = 0;
bool     gCurUsePartials = false;
double   gTradeRiskUsd   = 0; // ทุนเสี่ยง USD/USC ของไม้ที่เปิดอยู่ — โชว์บน dashboard เท่านั้น
ulong    gLastTickMs     = 0; // heartbeat — ดู OnTimer()
datetime gLastSummarySent = 0; // ครั้งล่าสุดที่ส่งสรุปสถานะเข้า Discord — ดู AdxEmaSendStatusSummary()/OnTimer()

// ── สถานะ EMA ของ ADX main line (running EMA เอง ไม่ใช้ iMA) ──
double gEmaAdx           = 0;   // EMA ณ แท่งที่เพิ่งปิด (shift1) — หลังอัปเดต
double gEmaAdxPrev       = 0;   // EMA ณ แท่งก่อนหน้า (shift2) — ค่าก่อนอัปเดตของรอบนี้
bool   gEmaInited        = false;

// ตัวนับ diagnostic — ตามกฎโปรเจกต์ ห้ามเดาสาเหตุเวลาผลผิดคาด
int gCnt_AdxLevelReject=0, gCnt_DiGapReject=0, gCnt_NoCross=0;
int gCnt_CutoffBlocked=0, gCnt_CutoffClose=0, gCnt_Entered=0, gCnt_MomentumExit=0;
int gCnt_EmaNotReady=0;

//+------------------------------------------------------------------+
//| วอร์ม EMA ของ ADX จากประวัติจริงตอน OnInit — seed ด้วย SMA ของช่วง     |
//| เก่าสุดใน lookback แล้วไล่ EMA มาเรื่อยๆ จนถึงแท่งที่เพิ่งปิด (shift1)   |
//+------------------------------------------------------------------+
void WarmupEma()
{
   int period = MathMax(2, InpEmaPeriod);
   int bars   = iBars(_Symbol, ADXEMA_TRADE_TF);
   int lookback = MathMin(period * 10, bars - InpADXPeriod - 5);
   if(lookback < period)
   {
      gEmaInited = false;
      return;
   }

   double buf[];
   // CopyBuffer(handle,0,1,lookback,buf) → buf[0]=shift1 (ใหม่สุด) ... buf[lookback-1]=shift(lookback) (เก่าสุด)
   if(CopyBuffer(hADX, 0, 1, lookback, buf) < lookback)
   {
      gEmaInited = false;
      return;
   }

   int start = lookback - period; // index ของช่วงเก่าสุด `period` แท่ง (ใช้ทำ seed)
   double sum = 0;
   for(int i = start; i < lookback; i++)
      sum += buf[i];
   double ema = sum / period;

   double alpha = 2.0 / (period + 1.0);
   for(int i = start - 1; i >= 0; i--) // ไล่จากเก่าไปใหม่ (index ลดลงหา 0 = ใหม่สุด)
      ema = alpha * buf[i] + (1.0 - alpha) * ema;

   gEmaAdx     = ema;
   gEmaAdxPrev = ema;
   gEmaInited  = true;
}

//+------------------------------------------------------------------+
//| อัปเดต EMA ด้วยค่า ADX ของแท่งที่เพิ่งปิด (shift1) — เรียกครั้งเดียว     |
//| ต่อแท่งใหม่ ก่อนอัปเดต gEmaAdxPrev เก็บค่าเดิม (=EMA ของแท่ง shift2)    |
//+------------------------------------------------------------------+
bool UpdateEma(double &adxShift1)
{
   double adxBuf[];
   if(CopyBuffer(hADX, 0, 1, 1, adxBuf) < 1) return false;
   adxShift1 = adxBuf[0];

   double alpha = 2.0 / (MathMax(2, InpEmaPeriod) + 1.0);
   gEmaAdxPrev = gEmaAdx;
   if(!gEmaInited)
   {
      gEmaAdx    = adxShift1;
      gEmaInited = true;
   }
   else
   {
      gEmaAdx = alpha * adxShift1 + (1.0 - alpha) * gEmaAdx;
   }
   return true;
}

//+------------------------------------------------------------------+
//| คำนวณ SL/TP1-3 ตามโหมด TP ที่เลือก (กฎ EA ข้อ 4)                     |
//+------------------------------------------------------------------+
void ComputeLevels(const int dir, const double refPrice, const double atr, const double adxAtEntry,
                    double &sl, double &tp1, double &tp2, double &tp3, bool &usePartials)
{
   sl = refPrice - dir * InpSLAtrMult * atr;
   usePartials = false;

   if(InpTpMode == TPMODE_FIX_MULTI_RR)
   {
      // เรียง multiplier จากใกล้ไปไกลเสมอ ไม่ว่าผู้ใช้จะตั้ง Tp1/Tp2/Tp3 มาลำดับไหนก็ตาม —
      // ป้องกันบั๊กเดียวกับที่เจอใน SdPaAdx 2026-09-19 (optimizer สุ่มมาได้ Tp1 > Tp2 แล้วปิดบางส่วน
      // สลับลำดับ/ป้ายชื่อผิดความหมาย) ดู bugs.md หัวข้อ 2026-09-19
      double m1 = InpTp1AtrMult, m2 = InpTp2AtrMult, m3 = InpTp3AtrMult;
      double lo = MathMin(m1, MathMin(m2, m3));
      double hi = MathMax(m1, MathMax(m2, m3));
      double mid = m1 + m2 + m3 - lo - hi;
      tp1 = refPrice + dir * lo * atr;
      tp2 = refPrice + dir * mid * atr;
      tp3 = refPrice + dir * hi * atr;
      usePartials = true;
   }
   else if(InpTpMode == TPMODE_DYNAMIC_RR)
   {
      double span  = MathMax(50.0 - InpMinADXLevel, 1e-6);
      double scale = MathMax(0.0, MathMin(1.0, (adxAtEntry - InpMinADXLevel) / span));
      double mult  = InpDynTpMinAtrMult + scale * (InpDynTpMaxAtrMult - InpDynTpMinAtrMult);
      double tp    = refPrice + dir * mult * atr;
      tp1 = tp2 = tp3 = tp;
   }
   else // TPMODE_FIX_RR
   {
      double tp = refPrice + dir * InpFixRRTpAtrMult * atr;
      tp1 = tp2 = tp3 = tp;
   }
}

//+------------------------------------------------------------------+
//| หากำไร/ขาดทุนสุทธิของไม้ที่เพิ่งปิดผ่าน `PL_CloseAll()` — ใช้ `gMtPosId`  |
//| ที่ `PL_CloseAll()` ตั้งใจไม่ล้างทิ้งไว้ให้ (ดูคอมเมนต์ใน PositionLib.mqh) |
//| จำเป็นเพราะ `PL_CloseAll()` เองไม่ส่ง Discord อัตโนมัติ — มีแค่           |
//| `PL_ClassifyClosed()` (เรียกจาก `PL_Manage()`) ที่ส่งให้ และมันเช็คเฉพาะ  |
//| เหตุผล TP/SL เท่านั้น ไม่ครอบคลุมการปิดมือแบบ cutoff/momentum-exit        |
//| (มิเรอร์ `SatsRecordClosedPosition()` ของ SelfAwareTrendCore.mqh)         |
//+------------------------------------------------------------------+
bool AdxEmaClosedNet(double &netOut)
{
   netOut = 0;
   if(gMtPosId == 0) return false;
   if(!HistorySelectByPosition((long)gMtPosId)) return false;

   bool any = false;
   int deals = HistoryDealsTotal();
   for(int i = 0; i < deals; i++)
   {
      ulong d = HistoryDealGetTicket(i);
      if(d == 0) continue;
      long entry = HistoryDealGetInteger(d, DEAL_ENTRY);
      if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_OUT_BY) continue;
      netOut += HistoryDealGetDouble(d, DEAL_PROFIT)
              + HistoryDealGetDouble(d, DEAL_SWAP)
              + HistoryDealGetDouble(d, DEAL_COMMISSION);
      any = true;
   }
   return any;
}

//+------------------------------------------------------------------+
//| ปิดไม้ทันทีถ้าโมเมนตัมหมด (ADX ตกกลับต่ำกว่า EMA ของตัวมันเอง) —         |
//| ตาม "Pro Tip" ของผู้ใช้: ADX โค้งลงหา EMA = รอบเทรนด์ใกล้จบ            |
//+------------------------------------------------------------------+
void CheckMomentumExit(const double adxShift1)
{
   if(!InpExitOnMomentumLoss) return;
   if(!PL_HasPosition(InpMagic)) return;
   if(adxShift1 < gEmaAdx)
   {
      PL_CloseAll(InpMagic);
      string reason = "โมเมนตัมหมด (ADX ต่ำกว่า EMA)";
      PL_SetLastEvent("ไม้ปิดแล้ว: " + reason); // ต้องตั้งก่อนส่งสรุป ไม่งั้นแถวเหตุการณ์ล่าสุดจะค้างอันเก่า
      double closedNet;
      if(AdxEmaClosedNet(closedNet))
         AdxEmaSendStatusSummary();
      gCnt_MomentumExit++;
   }
}

//+------------------------------------------------------------------+
//| หาสัญญาณเข้าไม้ — เช็คแค่ตอนแท่งใหม่ปิดแล้ว (กัน repaint) เรียกจาก      |
//| OnTick หลัง UpdateEma()                                             |
//+------------------------------------------------------------------+
void CheckEntrySignal(const double adxShift1)
{
   if(PL_HasPosition(InpMagic)) return;
   if(InpUseCutoff && PL_PastCutoff(InpCutoffServerHour, InpTradeStartServerHour))
   {
      gCnt_CutoffBlocked++;
      return;
   }
   if(!gEmaInited)
   {
      gCnt_EmaNotReady++;
      return;
   }

   double adxShift2Buf[];
   if(CopyBuffer(hADX, 0, 2, 1, adxShift2Buf) < 1) return;
   double adxShift2 = adxShift2Buf[0];

   // Cross up: แท่งก่อนหน้า ADX <= EMA แล้วแท่งล่าสุด ADX > EMA (โมเมนตัมเพิ่งเร่งตัว)
   bool crossUp = (adxShift2 <= gEmaAdxPrev) && (adxShift1 > gEmaAdx);
   if(!crossUp)
   {
      gCnt_NoCross++;
      return;
   }

   if(adxShift1 < InpMinADXLevel)
   {
      gCnt_AdxLevelReject++;
      return;
   }

   double diBuf[];
   if(CopyBuffer(hADX, 1, 1, 1, diBuf) < 1) return; // +DI
   double plusDi = diBuf[0];
   if(CopyBuffer(hADX, 2, 1, 1, diBuf) < 1) return; // -DI
   double minusDi = diBuf[0];

   double diGap = MathAbs(plusDi - minusDi);
   if(diGap < InpMinDiGap)
   {
      gCnt_DiGapReject++;
      return;
   }

   int dir = (plusDi > minusDi) ? 1 : -1;

   double atrBuf[];
   if(CopyBuffer(hATR, 0, 1, 1, atrBuf) < 1) return;
   double atr = MathMax(atrBuf[0], SymbolInfoDouble(_Symbol, SYMBOL_POINT));

   double refPrice = iClose(_Symbol, ADXEMA_TRADE_TF, 1);

   double sl, tp1, tp2, tp3; bool usePartials;
   ComputeLevels(dir, refPrice, atr, adxShift1, sl, tp1, tp2, tp3, usePartials);

   double riskUsd = InpRiskMode == RISK_FIXED_USD ? InpRiskFixedUsd
                                                   : AccountInfoDouble(ACCOUNT_EQUITY) * InpRiskPct / 100.0;

   if(PL_Open(dir, sl, tp1, tp2, tp3, riskUsd, InpRiskPointUnit, InpMagic, "AdxEma",
              usePartials, 0, InpShowChartObjects, false))
   {
      gCurUsePartials = usePartials;
      gTradeRiskUsd   = riskUsd;
      PL_SetLastEvent(StringFormat("เข้าไม้: %s %s", PL_DirStr(gMtDir), DoubleToString(gMtEntry, _Digits)));
      gCnt_Entered++;
   }
}

//+------------------------------------------------------------------+
//| รวมกำไร/ขาดทุน + จำนวนไม้ที่ "ปิดจบแล้ว" ของวันเทรดปัจจุบัน (แบ่งวันจาก    |
//| เวลาเริ่มเทรด InpTradeStartServerHour ไม่ใช่ cutoff/เที่ยงคืนปฏิทิน) —     |
//| ตรรกะจริงอยู่ที่ PL_ComputeTodayStats (ดู bugs.md 2026-09-22)            |
//+------------------------------------------------------------------+
void AdxEmaComputeTodayStats(double &profitOut, int &tradesOut)
{
   PL_ComputeTodayStats(InpMagic, InpCutoffServerHour, InpTradeStartServerHour, profitOut, tradesOut);
}

//+------------------------------------------------------------------+
//| % ความพร้อมเข้าไม้ = MIN ของ 3 เงื่อนไขใน CheckEntrySignal() (ADX vs   |
//| EMA ของตัวมันเอง / ADX Level / DI Gap) — ใช้โชว์บน dashboard เท่านั้น  |
//| ไม่กระทบตรรกะเข้าไม้จริง ใช้ MIN เพราะเงื่อนไขจริงเป็น AND ต้องผ่านทุกข้อ|
//| พร้อมกัน ตัวที่ต่ำสุดคือตัวที่ฉุดอยู่ กรณีพิเศษตามที่ผู้ใช้ขอ 2026-09-21:  |
//| มีไม้เปิดอยู่แล้ว = ค้าง 100% เสมอ, ติด cutoff = 0% เสมอ (ต่อให้เงื่อนไข |
//| อื่นครบก็เข้าไม่ได้อยู่ดี ไม่อยากให้ % หลอกว่า "ใกล้แล้ว")               |
//|                                                                    |
//| แก้ 2026-09-21 (รอบ 2): เดิม pAdxEma = ratio ADX/EMA เฉยๆ พอ ADX      |
//| อยู่เหนือ EMA ปุ๊บจะโชว์ 100% ค้างได้หลายแท่งติด ทั้งที่เงื่อนไขเข้าไม้จริง|
//| ต้องเป็น "แท่งที่เพิ่งตัดขึ้นพอดี" (crossUp) เท่านั้น ทำให้ผู้ใช้เข้าใจผิด |
//| ว่า 100% = เข้าไม้แน่ๆ — ตอนนี้เช็ค crossUp จริงแบบเดียวกับ              |
//| CheckEntrySignal(): ถ้าเป็นแท่งที่เพิ่งตัดขึ้นจริง = 100% เต็ม ถ้าแค่    |
//| ยังอยู่เหนือ EMA แต่ตัดไปแล้วก่อนหน้านี้ (ไม่ fresh) = cap ไว้ไม่เกิน 99% |
//| กัน 100% หลอกอีกต่อไป — 100% เต็มจะโผล่เฉพาะแท่งที่เข้าไม้จริงเท่านั้น   |
//| (พร้อมอีก 2 เงื่อนไขผ่านด้วย)                                        |
//+------------------------------------------------------------------+
int AdxEmaComputeProgress()
{
   if(PL_HasPosition(InpMagic)) return 100;
   if(InpUseCutoff && PL_PastCutoff(InpCutoffServerHour, InpTradeStartServerHour)) return 0;
   if(!gEmaInited) return 0;

   double adxShift2Buf[];
   if(CopyBuffer(hADX, 0, 2, 1, adxShift2Buf) < 1) return 0;
   double adxShift2 = adxShift2Buf[0];

   double adxBuf[];
   if(CopyBuffer(hADX, 0, 1, 1, adxBuf) < 1) return 0;
   double adxShift1 = adxBuf[0];

   double diBuf[];
   if(CopyBuffer(hADX, 1, 1, 1, diBuf) < 1) return 0;
   double plusDi = diBuf[0];
   if(CopyBuffer(hADX, 2, 1, 1, diBuf) < 1) return 0;
   double minusDi = diBuf[0];
   double diGap = MathAbs(plusDi - minusDi);

   bool freshCross = (adxShift2 <= gEmaAdxPrev) && (adxShift1 > gEmaAdx);
   double pAdxEma;
   if(freshCross)
      pAdxEma = 100.0;
   else
      pAdxEma = (gEmaAdx > 0) ? MathMin(99.0, adxShift1 / gEmaAdx * 100.0) : 0.0;

   double pAdxLevel = (InpMinADXLevel > 0) ? MathMin(100.0, adxShift1 / InpMinADXLevel * 100.0) : 100.0;
   double pDiGap    = (InpMinDiGap > 0)    ? MathMin(100.0, diGap / InpMinDiGap * 100.0)        : 100.0;

   double pct = MathMin(pAdxEma, MathMin(pAdxLevel, pDiGap));
   return (int)MathMax(0.0, MathRound(pct));
}

//+------------------------------------------------------------------+
//| แปลง % เป็นแถบ block character 10 ช่อง — ใช้บน dashboard คู่กับ         |
//| AdxEmaComputeProgress()                                            |
//+------------------------------------------------------------------+
string AdxEmaProgressBar(const int pct)
{
   int filled = (int)MathMax(0, MathMin(10, MathRound(pct / 10.0)));
   string bar = "";
   for(int i = 0; i < 10; i++)
      bar += (i < filled) ? "█" : "░";
   return bar + "  " + IntegerToString(pct) + "%";
}

//+------------------------------------------------------------------+
//| ประมาณความกว้างข้อความ (พิกเซล) — ลองใช้ TextSetFont()/TextGetSize()   |
//| จริงไปแล้ว 2 รอบ ได้ผลผิดทั้งคู่ (รอบแรกแคบเกิน ล้นซ้ำ, รอบสองกว้างเกิน  |
//| ~10 เท่าจนกล่องกินเกือบเต็มจอ — ไม่รู้ scale/sign convention ที่ถูกต้อง  |
//| ของ MQL5 API ตัวนี้แน่ชัด และไม่มีทาง verify ได้โดยไม่แนบ EA ทดสอบจริง)  |
//| เปลี่ยนมาใช้สูตรประมาณจากตัวอักษร ที่ปรับค่าคงที่จากสกรีนช็อตจริงที่     |
//| ผู้ใช้ส่งมา (เจอ overlap จริงที่ colGap=170 กับความยาว 17 ตัวอักษร      |
//| ที่ FS=12 → ~10px/ตัวอักษร) แทน เพราะเชื่อถือได้กว่า API ที่ยังไม่เข้าใจ |
//| scale ชัดเจน (เจอจริง 2026-09-19 — ดู bugs.md)                       |
//+------------------------------------------------------------------+
int AdxEmaTextWidth(const string text, const int fontSize)
{
   return (int)MathCeil(StringLen(text) * fontSize * 0.85);
}

//+------------------------------------------------------------------+
//| พาเนลสรุปสถานะมุมขวาบนของชาร์ต — พอร์ตมาจาก SatsDrawDashboard()      |
//| (SelfAwareTrendCore.mqh) ตามที่ผู้ใช้ขอ 2026-09-19 "เพิ่ม dashboard   |
//| แบบเดียวกับ best sats" ปรับให้เข้ากับสถานะของ AdxEma (ไม่มี replay/   |
//| catch-up/pending signal — แถวนั้นแทนที่ด้วยสถานะ ADX vs EMA สดแทน)    |
//| throttle ไว้ 2 วิ/ครั้ง กัน ObjectCreate/HistorySelect ถี่เกินไปตอนรันสด |
//| ขนาดกล่อง (colGap/panelW) วัดจากความกว้างข้อความหัวข้อจริงเสมอ ไม่ใช่   |
//| เลขคงที่ — กันล้นถ้าชื่อ symbol/กลยุทธ์เปลี่ยนความยาวไปในอนาคต          |
//+------------------------------------------------------------------+
void AdxEmaDrawDashboard()
{
   static datetime lastDraw = 0;
   if(TimeCurrent() - lastDraw < 2) return;
   lastDraw = TimeCurrent();

   string prefix = "ADXEMADASH_" + IntegerToString(InpMagic) + "_";
   // แก้กระพริบ 2026-09-21: เดิมเรียก PL_ClearChartObjects(prefix) ลบ object ทั้งหมดของ dashboard
   // ทิ้งก่อนวาดใหม่ทุกครั้ง (ทุก 2 วิ) — PL_DashLabel()/PL_DashPanelBg() เองอัปเดตแบบ upsert อยู่แล้ว
   // (เช็ค ObjectFind ก่อน มีอยู่แล้วก็แค่เขียนทับค่า ไม่ต้องลบ) การลบทั้งหมดตอนต้นเป็นของเกินจำเป็นที่
   // ทำให้เห็นช่วงว่างเปล่าสั้นๆ ระหว่างลบกับสร้างใหม่ (กระพริบ) — ตัดออก ปล่อยให้แต่ละ label อัปเดตในที่
   // ของมันเอง ส่วนแถวที่ต้องหายไปจริงๆ ตอนไม่มีไม้เปิดอยู่ (TP/SL/Risk/P&L) มีลูปลบเฉพาะจุด (posOnly[])
   // อยู่ด้านล่างอยู่แล้ว ไม่ต้องพึ่งการลบทั้งหมดตอนต้น

   string curr = AccountInfoString(ACCOUNT_CURRENCY);
   StringToLower(curr);

   const ENUM_BASE_CORNER CN = CORNER_LEFT_UPPER;
   const ENUM_ANCHOR_POINT AN = ANCHOR_LEFT_UPPER;
   const int FS = 12;
   const int dy = 24;
   const int padTop = 16, padBottom = 16, padLeft = 14;

   // ใช้ ADXEMA_TRADE_TF ไม่ใช่ Period() (TF ของชาร์ตที่กำลังดูอยู่) — ล็อกเทรด M1 ตายตัวแล้ว
   // (2026-09-22) หัวข้อควรโชว์ TF ที่เทรดจริงเสมอ ไม่ใช่ TF ที่บังเอิญเปิดชาร์ตดูอยู่ตอนนั้น
   string tf = StringSubstr(EnumToString((ENUM_TIMEFRAMES)ADXEMA_TRADE_TF), 7);
   string titleText = "AdxEma " + _Symbol + " " + tf;

   // colGap = ระยะจากขอบซ้ายกล่องถึงคอลัมน์ value — ต้องกว้างพอให้หัวข้อ (แถวที่ยาวสุดเสมอ
   // เพราะมีชื่อกลยุทธ์+symbol+timeframe รวมกัน) ไม่ล้นทับคอลัมน์ status ข้างๆ กัน
   // x1.15 คือ margin กันเผื่อวัดคลาดเคลื่อนเล็กน้อย (เช่น bold/DPI ของแต่ละเครื่องต่างกัน) — ยอมให้
   // กล่องกว้างเกินจริงนิดหน่อยดีกว่าเสี่ยงล้นทับซ้ำแบบที่เจอมา (บั๊ก 2026-09-19)
   int colGap = padLeft + (int)MathCeil(AdxEmaTextWidth(titleText, FS) * 1.15) + 20;
   // เพดานบน/ล่างตายตัว — กันพลาดซ้ำแบบที่เจอมาแล้ว 2 รอบ (ครั้งแรกแคบเกินจนล้น ครั้งที่สองกว้างเกิน
   // จนกินเกือบเต็มจอ) ไม่ว่าสูตรประมาณด้านบนจะคลาดเคลื่อนแค่ไหน กล่องจะไม่มีวันหลุดช่วงนี้ไปได้
   colGap = (int)MathMax(170, MathMin(260, colGap));
   int panelW = colGap + 210; // 210 = พื้นที่คอลัมน์ value (ยาวสุดที่เจอจริงคือ "4396.290 (+1234 usc)")

   bool hasPos = (gMtDir != 0);
   int tpRows = gCurUsePartials ? 3 : 1;
   int rowCount = 1 + 1 + 1 + (hasPos ? (4 + tpRows) : 1) + 4 + 1; // header + version + progress + ไม้ + (balance/equity/วันนี้/เวลาเทรด) + เหตุการณ์ล่าสุด
   int panelH = padTop + rowCount * dy + 30 + padBottom;

   string statusText;
   if(gLastProblem != "")
      statusText = gLastProblem;
   else if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) || !MQLInfoInteger(MQL_TRADE_ALLOWED))
      statusText = "ปิด Algo Trading อยู่";
   else if(!AccountInfoInteger(ACCOUNT_TRADE_EXPERT))
      statusText = "บัญชีไม่อนุญาตให้ EA เทรด";
   else if((ENUM_SYMBOL_TRADE_MODE)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_MODE) != SYMBOL_TRADE_MODE_FULL)
      statusText = "broker ปิดเทรด " + _Symbol + " ชั่วคราว";
   else
      statusText = "กำลังทำงาน";
   bool ok = (statusText == "กำลังทำงาน");
   color accentClr = ok ? clrLimeGreen : clrTomato;

   // แจ้ง Discord เฉพาะสถานะ Algo Trading/บัญชี/broker (edge-trigger) — เหมือน SATS ทุกประการ
   string tgStatus;
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) || !MQLInfoInteger(MQL_TRADE_ALLOWED))
      tgStatus = "ปิด Algo Trading อยู่";
   else if(!AccountInfoInteger(ACCOUNT_TRADE_EXPERT))
      tgStatus = "บัญชีไม่อนุญาตให้ EA เทรด";
   else if((ENUM_SYMBOL_TRADE_MODE)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_MODE) != SYMBOL_TRADE_MODE_FULL)
      tgStatus = "broker ปิดเทรด " + _Symbol + " ชั่วคราว";
   else
      tgStatus = "กำลังทำงาน";
   DC_NotifyStatus(_Symbol, tgStatus, tgStatus == "กำลังทำงาน");

   int chartW = (int)ChartGetInteger(0, CHART_WIDTH_IN_PIXELS);
   int boxX = MathMax(0, chartW - 5 - panelW);
   int boxY = 5;
   PL_DashPanelBg(prefix + "bg", boxX, boxY, panelW, panelH, C'19,23,34', C'58,63,77', CN);
   PL_DashPanelBg(prefix + "accent", boxX, boxY, 4, panelH, accentClr, accentClr, CN);

   int xLabel = boxX + padLeft;
   int xValue = boxX + colGap;
   int y = boxY + padTop;

   PL_DashLabel(prefix + "title", titleText, xLabel, y, clrSilver, FS, CN, AN);
   PL_DashLabel(prefix + "status", statusText, xValue, y, accentClr, FS, CN, AN);
   y += dy;

   PL_DashLabel(prefix + "ver_l", "Version", xLabel, y, clrGray, FS, CN, AN);
   PL_DashLabel(prefix + "ver_v", "v" + ADXEMA_VERSION + " · " + ADXEMA_UPDATED, xValue, y, clrGray, FS, CN, AN);
   y += dy;

   PL_DashPanelBg(prefix + "div1", boxX + 8, y + 5, panelW - 16, 1, C'58,63,77', C'58,63,77', CN);
   y += 10;

   int progressPct = AdxEmaComputeProgress();
   color progressClr = (progressPct >= 100) ? clrLimeGreen : (progressPct >= 70 ? clrOrange : clrGray);
   PL_DashLabel(prefix + "prog_l", "Progress", xLabel, y, clrSilver, FS, CN, AN);
   PL_DashLabel(prefix + "prog_v", AdxEmaProgressBar(progressPct), xValue, y, progressClr, FS, CN, AN);
   y += dy;

   if(hasPos)
   {
      PL_DashLabel(prefix + "pos_l", "Position", xLabel, y, clrSilver, FS, CN, AN);
      PL_DashLabel(prefix + "pos_v", PL_DirStr(gMtDir) + " " + DoubleToString(gMtEntry, _Digits), xValue, y,
                   gMtDir == 1 ? clrLimeGreen : clrTomato, FS, CN, AN);
      y += dy;

      // Lot/Risk รวมแถวเดียว (ผู้ใช้ขอ 2026-09-23) — Risk = เสี่ยงเหลือเท่าไหร่ถ้าโดน SL ตอนนี้
      // (ใช้ lot ที่เหลือจริง + SL ปัจจุบัน) ไม่ใช่ทุนเสี่ยงตั้งต้นตอนเปิดไม้เต็ม lot อีกต่อไป —
      // ลดลงเองหลัง TP1/TP2 หรือเกือบ 0 ถ้า BE เลื่อน SL มาที่ entry
      PL_DashLabel(prefix + "lotrisk_l", "Lot / Risk", xLabel, y, clrSilver, FS, CN, AN);
      PL_DashLabel(prefix + "lotrisk_v", DoubleToString(gMtLot, 2) + " / " +
                   DoubleToString(PL_RiskRemaining(InpRiskPointUnit), 0) + " " + curr,
                   xValue, y, clrWhite, FS, CN, AN);
      y += dy;

      PL_DashLabel(prefix + "sl_l", "SL", xLabel, y, clrSilver, FS, CN, AN);
      PL_DashLabel(prefix + "sl_v", DoubleToString(gMtSlInit, _Digits), xValue, y, clrWhite, FS, CN, AN);
      y += dy;

      if(gCurUsePartials)
      {
         // แก้บั๊ก 2026-09-23: เดิมลบ 2×gMtPartVol ออกจาก gMtLot เสมอ (สมมติว่า gMtLot ยังเป็น lot
         // เต็มตอนเปิดไม้) แต่ตั้งแต่แก้บั๊ก 2026-09-22 ที่ทำให้ gMtLot อัปเดตเป็น lot ที่เหลือจริงหลัง
         // ปิดบางส่วนไปแล้ว สูตรนี้เลยลบซ้ำ 2 รอบทันทีที่ TP1/TP2 แตะไปแล้วทั้งคู่ (เช่น TP1/TP2 หมดแล้ว
         // gMtLot=0.16 พอลบอีก 2×0.13 กลายเป็นติดลบ ถูก MathMax ปัดเป็น 0 → TP3 โชว์ "+0 usc" ทั้งที่
         // เหลือ 0.16 lot จริงรอปิดที่ TP3 อยู่) — คำนวณใหม่จากจำนวนครั้งที่ "ยังไม่แตะ" แทน (แตะไปแล้ว
         // กี่ครั้ง gMtLot ก็หักให้แล้วในตัว ไม่ต้องหักซ้ำ)
         double volLast = gMtLot;
         if(!gMtHitTp1) volLast -= gMtPartVol;
         if(!gMtHitTp2) volLast -= gMtPartVol;
         volLast = MathMax(volLast, 0.0);
         double gain1 = gMtPartVol * (MathAbs(gMtTp1 - gMtEntry) / InpRiskPointUnit);
         double gain2 = gMtPartVol * (MathAbs(gMtTp2 - gMtEntry) / InpRiskPointUnit);
         double gain3 = volLast    * (MathAbs(gMtTp3 - gMtEntry) / InpRiskPointUnit);

         PL_DashLabel(prefix + "tp1_l", "TP1", xLabel, y, gMtHitTp1 ? clrLimeGreen : clrSilver, FS, CN, AN);
         PL_DashLabel(prefix + "tp1_v", DoubleToString(gMtTp1, _Digits) + " (+" + DoubleToString(gain1, 0) + " " + curr + ")" +
                      (gMtHitTp1 ? " ✓" : ""), xValue, y, clrLimeGreen, FS, CN, AN);
         y += dy;

         PL_DashLabel(prefix + "tp2_l", "TP2", xLabel, y, gMtHitTp2 ? clrLimeGreen : clrSilver, FS, CN, AN);
         PL_DashLabel(prefix + "tp2_v", DoubleToString(gMtTp2, _Digits) + " (+" + DoubleToString(gain2, 0) + " " + curr + ")" +
                      (gMtHitTp2 ? " ✓" : ""), xValue, y, clrLimeGreen, FS, CN, AN);
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

      double posProfit = 0;
      ulong ticket = 0;
      if(PL_Select(InpMagic, ticket) && PositionSelectByTicket(ticket))
         posProfit = PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
      PL_DashLabel(prefix + "pl_l", "P/L", xLabel, y, clrSilver, FS, CN, AN);
      PL_DashLabel(prefix + "pl_v", (posProfit >= 0 ? "+" : "") + DoubleToString(posProfit, 0) + " " + curr,
                   xValue, y, posProfit >= 0 ? clrLimeGreen : clrTomato, FS, CN, AN);
      y += dy;
   }
   else
   {
      PL_DashLabel(prefix + "pos_l", "Position", xLabel, y, clrSilver, FS, CN, AN);
      PL_DashLabel(prefix + "pos_v", "ไม่มีไม้เปิดอยู่", xValue, y, clrSilver, FS, CN, AN);
      y += dy;

      string posOnly[] = {"lotrisk_l","lotrisk_v","sl_l","sl_v","tp_l","tp_v","tp1_l","tp1_v","tp2_l","tp2_v",
                          "tp3_l","tp3_v","pl_l","pl_v"};
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
   AdxEmaComputeTodayStats(todayProfit, todayTrades);
   PL_DashLabel(prefix + "today_l", "Today", xLabel, y, clrSilver, FS, CN, AN);
   PL_DashLabel(prefix + "today_v",
                (todayProfit >= 0 ? "+" : "") + DoubleToString(todayProfit, 0) + " " + curr +
                " · " + IntegerToString(todayTrades) + " ไม้",
                xValue, y, todayProfit > 0 ? clrLimeGreen : (todayProfit < 0 ? clrTomato : clrSilver), FS, CN, AN);
   y += dy;

   PL_DashLabel(prefix + "cutoff_l", "Time left", xLabel, y, clrSilver, FS, CN, AN);
   PL_DashLabel(prefix + "cutoff_v",
                InpUseCutoff ? PL_TimeLeftStr(InpCutoffServerHour, InpTradeStartServerHour) : "ปิดใช้งาน",
                xValue, y, clrWhite, FS, CN, AN);
   y += dy;

   PL_DashPanelBg(prefix + "div3", boxX + 8, y + 5, panelW - 16, 1, C'58,63,77', C'58,63,77', CN);
   y += 10;

   string evText = (gLastEvent == "") ? "ยังไม่มีเหตุการณ์" :
                   PL_ServerTimeToThaiStr(gLastEventTime, InpCutoffServerHour) + "  " + gLastEvent;
   PL_DashLabel(prefix + "event", evText, xLabel, y, clrOrange, FS, CN, AN);

   ChartRedraw();
}

// เติมช่องว่างท้าย label ให้ครบ width ตัวอักษร — ใช้จัดคอลัมน์ label/value ให้ตรงกันในโค้ดบล็อก
// (font monospace ของ Discord) ต้องเป็น label ภาษาอังกฤษล้วนเท่านั้นถึงจะตรงเป๊ะทุกแถว เพราะอักษรไทย
// กว้างไม่เท่ากันในฟอนต์ monospace (ปัญหาเดียวกับที่เจอตอนคาลิเบรต colGap ของ dashboard บนกราฟ) —
// ค่าที่ตามหลัง label ยังใส่ภาษาไทยได้ปกติ (เช่น "ไม้") เพราะอยู่หลังจุดจัดคอลัมน์แล้ว ไม่กระทบแถวอื่น
//+------------------------------------------------------------------+
//| สร้างข้อความสรุปสถานะเป็น code block (ผู้ใช้ขอ 2026-09-23 — ยืนยันดีไซน์  |
//| หลายรอบ) — รูปแบบ "Label: value" สั้นๆ บรรทัดเดียว **ไม่ pad ให้คอลัมน์   |
//| ตรงกันอีกต่อไป** (2026-09-23 รอบถัดมา): ลองบน desktop เห็นว่าตรงสวย แต่   |
//| พอทดสอบจริงบนมือถือ (จอแคบกว่า) บรรทัดที่ยาวจาก padding+ค่ายาวๆ ถูก      |
//| Discord ตัดขึ้นบรรทัดใหม่กลางค่า (เช่น "4369.949 /" ตัดจาก "0.42")       |
//| ทำให้คอลัมน์พังเละกว่าไม่ pad เลย — ตัดสินใจเลิก pad ทั้งหมด, ตัด          |
//| "(+xxx usc)" ท้าย TP1-3 ออก (ข้อมูลซ้ำกับ Floating P/L), แยก SL/Lot      |
//| และ Today/Trades เป็นคนละบรรทัด เพื่อให้ทุกบรรทัดสั้นพอไม่ตัดขึ้นบรรทัดใหม่ |
//| ไม่ว่าจอกว้างแค่ไหน — **ตัดแถว Version/Progress ออกตามคำขอผู้ใช้ด้วย**     |
//| เนื้อหาที่เหลือ/ลำดับยังอิง AdxEmaDrawDashboard() (ไม้/balance/equity/    |
//| วันนี้/เวลาเทรด/เหตุการณ์ล่าสุด) ใช้ทั้งกับตัวจับเวลาทุก InpSummaryEveryMin  |
//| นาที และทั้ง 4 เหตุการณ์ (เข้าไม้/ปิดไม้ทุกสาเหตุ/ปิดบางส่วน/ขยับ BE) ผ่าน   |
//| gPlSummaryHook ใน PositionLib.mqh                                    |
//+------------------------------------------------------------------+
void AdxEmaSendStatusSummary()
{
   string curr = AccountInfoString(ACCOUNT_CURRENCY);
   StringToLower(curr);
   string tf = StringSubstr(EnumToString((ENUM_TIMEFRAMES)ADXEMA_TRADE_TF), 7);

   string statusText;
   if(gLastProblem != "")
      statusText = gLastProblem;
   else if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) || !MQLInfoInteger(MQL_TRADE_ALLOWED))
      statusText = "ปิด Algo Trading อยู่";
   else if(!AccountInfoInteger(ACCOUNT_TRADE_EXPERT))
      statusText = "บัญชีไม่อนุญาตให้ EA เทรด";
   else if((ENUM_SYMBOL_TRADE_MODE)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_MODE) != SYMBOL_TRADE_MODE_FULL)
      statusText = "broker ปิดเทรด " + _Symbol + " ชั่วคราว";
   else
      statusText = "กำลังทำงาน";

   string s = "AdxEma " + _Symbol + " " + tf + " - " + statusText + "\n\n";

   bool hasPos = (gMtDir != 0);
   if(hasPos)
   {
      // ลำดับ/กลุ่มตามที่ผู้ใช้ขอ 2026-09-23 (รอบที่ 4): Position, Lot/Risk รวมแถวเดียว, SL, TP1-3,
      // Price (ราคาตลาดปัจจุบันฝั่งที่จะใช้ปิดไม้จริง — BUY ปิดที่ Bid, SELL ปิดที่ Ask), P/L
      // "(hit)" เปลี่ยนเป็นเครื่องหมายถูก "✓" ต่อท้าย label แทน (ตรงกับที่ dashboard บนกราฟใช้อยู่แล้ว)
      s += "Position: " + PL_DirStr(gMtDir) + " " + DoubleToString(gMtEntry, _Digits) + "\n";
      s += "Lot / Risk: " + DoubleToString(gMtLot, 2) + " / " +
           DoubleToString(PL_RiskRemaining(InpRiskPointUnit), 0) + " " + curr + "\n";
      s += "SL: " + DoubleToString(gMtSlInit, _Digits) + "\n";

      if(gCurUsePartials)
      {
         s += "TP1: " + DoubleToString(gMtTp1, _Digits) + (gMtHitTp1 ? " ✓" : "") + "\n";
         s += "TP2: " + DoubleToString(gMtTp2, _Digits) + (gMtHitTp2 ? " ✓" : "") + "\n";
         s += "TP3: " + DoubleToString(gMtTp3, _Digits) + "\n";
      }
      else
      {
         s += "TP: " + DoubleToString(gMtTp3, _Digits) + "\n";
      }

      double curPrice = (gMtDir == 1) ? SymbolInfoDouble(_Symbol, SYMBOL_BID) : SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      s += "Price: " + DoubleToString(curPrice, _Digits) + "\n";

      double posProfit = 0;
      ulong ticket = 0;
      if(PL_Select(InpMagic, ticket) && PositionSelectByTicket(ticket))
         posProfit = PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
      s += "P/L: " + (posProfit >= 0 ? "+" : "") + DoubleToString(posProfit, 0) + " " + curr + "\n";
   }
   else
   {
      s += "Position: ไม่มีไม้เปิดอยู่\n";
   }

   s += "\n";

   double bal = AccountInfoDouble(ACCOUNT_BALANCE);
   double eq  = AccountInfoDouble(ACCOUNT_EQUITY);
   s += "Balance: " + DoubleToString(bal, 0) + " " + curr + "\n";
   s += "Equity: " + DoubleToString(eq, 0) + " " + curr + "\n";

   double todayProfit; int todayTrades;
   AdxEmaComputeTodayStats(todayProfit, todayTrades);
   s += "Today: " + (todayProfit >= 0 ? "+" : "") + DoubleToString(todayProfit, 0) + " " + curr + "\n";
   s += "Trades: " + IntegerToString(todayTrades) + " ไม้\n";

   s += "Time left: " +
        (InpUseCutoff ? PL_TimeLeftStr(InpCutoffServerHour, InpTradeStartServerHour) : "ปิดใช้งาน") + "\n";

   s += "\n";
   s += (gLastEvent == "") ? "ยังไม่มีเหตุการณ์" :
        (PL_ServerTimeToThaiStr(gLastEventTime, InpCutoffServerHour) + "  " + gLastEvent);

   DC_Send(s); // DC_Send() ห่อ code block + account tag ให้เองแล้ว (2026-09-23) ไม่ต้องห่อซ้ำที่นี่
}

//+------------------------------------------------------------------+
int OnInit()
{
   // เสียบสรุปสถานะเต็มแบบ dashboard เข้า hook ของ PositionLib.mqh (ผู้ใช้ขอ 2026-09-23) — ทำให้
   // เข้าไม้/ปิดไม้(TP,SL)/ปิดบางส่วน/BE ที่เกิดใน PL_Open()/PL_Manage() ส่งสรุปเต็มแทนข้อความสั้นเดิม
   gPlSummaryHook = AdxEmaSendStatusSummary;

   hADX = iADX(_Symbol, ADXEMA_TRADE_TF, InpADXPeriod);
   hATR = iATR(_Symbol, ADXEMA_TRADE_TF, InpATRPeriod);
   if(hADX == INVALID_HANDLE || hATR == INVALID_HANDLE)
   {
      Print("iADX/iATR handle failed");
      return INIT_FAILED;
   }

   gTrade.SetExpertMagicNumber(InpMagic);
   gTrade.SetTypeFillingBySymbol(_Symbol);
   gTrade.SetMarginMode();

   // handle ADX/ATR ที่เพิ่งสร้างอาจยังคำนวณ buffer ไม่ครบทันที (พบบ่อยตอน attach ใหม่ๆ บนชาร์ตจริง)
   // รอให้พร้อมก่อน WarmupEma() ไม่งั้น CopyBuffer จะได้ข้อมูลไม่ครบแล้ว WarmupEma() ยอมแพ้เงียบๆ
   // (gEmaInited=false) ทำให้ EMA เริ่มจาก seed ค่าเดียวแทนประวัติจริง — ข้ามใน Tester/Optimization
   // เพราะที่นั่นข้อมูลย้อนหลังพร้อมอยู่แล้วเสมอ ไม่มี lag แบบตอน attach สด (มิเรอร์ SATS OnInit)
   if(!MQLInfoInteger(MQL_TESTER))
   {
      int wantBars = iBars(_Symbol, ADXEMA_TRADE_TF);
      int waited = 0;
      while((BarsCalculated(hADX) < wantBars - 2 || BarsCalculated(hATR) < wantBars - 2) && waited < 100)
      {
         Sleep(50);
         waited++;
      }
   }

   WarmupEma();

   // ซิงก์สถานะไม้จากตำแหน่งจริงที่เปิดอยู่ (ถ้ามี) — กันบั๊กเดียวกับที่เจอใน SATS 2026-09-16:
   // reattach/compile ใหม่/เปลี่ยน timeframe ระหว่างมีไม้เปิดอยู่ทำให้ gMtDir รีเซ็ตเป็น 0 ทั้งที่ไม้
   // ยังเปิดจริง ผลคือ TP1/TP2 (Fix Multiple RR) หยุดแบ่งปิด และไม่มีการแจ้ง Discord ตอนไม้นั้นปิด
   bool hasRealPosition = PL_SyncOpenPosition(InpMagic, 0);
   if(hasRealPosition)
   {
      // ไม่รู้ riskUsd จริงที่ใช้ตอนเปิดไม้นี้ (เปิดไปก่อน EA รอบนี้จะรัน) — ย้อนคำนวณจาก lot/SL แทน
      // (สูตรกลับของ PL_Lot: riskUsd = lot * slDistPoints) ไว้โชว์บน dashboard ให้พอเทียบเคียงได้
      gTradeRiskUsd = gMtLot * (MathAbs(gMtEntry - gMtSlInit) / InpRiskPointUnit);
      // แก้บั๊ก 2026-09-22: เดิม hardcode เป็น false เสมอ (เดาว่าไม่ใช่โหมด partial ไว้ก่อน) เพราะ
      // broker เก็บได้แค่ SL/TP เดียว ไม่รู้ว่าไม้นี้เปิดด้วยโหมดไหน — ตอนนี้ PL_SyncOpenPosition
      // ลองโหลดสถานะจริงจากไฟล์ที่ PL_Open เขียนไว้แล้ว (ดู PL_LoadState ใน PositionLib.mqh) ถ้าโหลด
      // สำเร็จ gMtPartVol > 0 แปลว่าไม้นี้เปิดด้วยโหมด Fix Multiple RR จริง ให้ partial-close ทำงาน
      // ต่อได้ตามปกติ — ถ้าโหลดไม่สำเร็จ (ไม่มีไฟล์/posId ไม่ตรง) gMtPartVol จะเป็น 0 จาก fallback
      // เดิมใน PL_SyncOpenPosition อยู่แล้ว จึงยังปลอดภัยเหมือนพฤติกรรมเดิมในเคสนั้น
      gCurUsePartials = (gMtPartVol > 0);

      // แก้บั๊ก 2026-09-22: เดิม PL_DrawTrade() ถูกเรียกแค่จุดเดียวตอน PL_Open() เปิดไม้ครั้งแรก —
      // reattach บนชาร์ตอื่น (หรือชาร์ตเดิมที่ล้าง object ไปแล้ว) จะไม่มีเส้น TP1/TP2/TP3 ที่ EA
      // วาดเองเลย เห็นแค่เส้น SL/TP เดียวที่ MT5 วาดให้อัตโนมัติ (built-in ของเทอร์มินัล คนละเส้นกับ
      // ที่ EA วาด) — วาดซ้ำด้วยค่าที่ sync กลับมาได้ ให้เหมือนตอนเปิดไม้ครั้งแรกทุกประการ
      if(InpShowChartObjects)
         PL_DrawTrade(PL_ChartPrefix(InpMagic), gMtDir, gMtEntry, gMtSlInit, gMtTp1, gMtTp2, gMtTp3,
                      gCurUsePartials, gMtOpenTime); // gMtOpenTime = เวลาเปิดไม้จริง ไม่ใช่เวลา reattach
   }

   if(InpShowDashboard)
      AdxEmaDrawDashboard();

   gLastTickMs = GetTickCount64();
   EventSetTimer(30); // เช็ค heartbeat ทุก 30 วิ (เกณฑ์ค้างคือ ADXEMA_HEARTBEAT_MAX_SEC วิ) — เหมือน SATS

   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| จับ "EA แขวน/data feed หลุด" ที่ OnTick เฉยๆ จับไม่ได้ (ไม่มี tick เข้ามา  |
//| เลยแปลว่า OnTick ไม่ถูกเรียกด้วย) เช็คทุก 30 วิไม่พึ่ง OnTick — พอร์ตจาก  |
//| SATS ตรงๆ (เฉพาะวันจันทร์-ศุกร์ เสาร์-อาทิตย์ตลาดปิดเองไม่ถือว่าผิดปกติ)  |
//+------------------------------------------------------------------+
void OnTimer()
{
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   if(dt.day_of_week == 0 || dt.day_of_week == 6)
   {
      // เจอระหว่างตรวจสอบ 2026-09-23: ต้อง refresh gLastTickMs ต่อเนื่องตลอดสุดสัปดาห์ ไม่งั้น
      // OnTimer() ครั้งแรกหลังตลาดเปิดวันจันทร์จะเจอ idleSec สะสมทั้งสุดสัปดาห์ (ไม่มี tick มาเป็นวันๆ
      // ตามปกติ เพราะตลาดปิด) แล้วเข้าใจผิดว่า "ค้าง" ทั้งที่ไม่มีอะไรผิดปกติเลย ยิง heartbeat_stuck
      // เท็จทุกเช้าวันจันทร์ (และตอนนี้ยิง "กลับมาปกติแล้ว" ตามหลังทันทีด้วย เพราะเพิ่งเพิ่มฟีเจอร์นี้)
      gLastTickMs = GetTickCount64();
      return; // เสาร์-อาทิตย์ ข้าม
   }

   if(!TerminalInfoInteger(TERMINAL_CONNECTED))
   {
      gLastProblem = "ขาดการเชื่อมต่อกับ broker";
      DC_NotifyProblemOnce("disconnected", _Symbol, gLastProblem, "🔌");
      return;
   }
   DC_ClearProblemKind("disconnected");
   if(gLastProblem == "ขาดการเชื่อมต่อกับ broker")
   {
      // แจ้งตอนกลับมาปกติด้วย (ผู้ใช้ขอ 2026-09-23) — เดิมเคลียร์เงียบๆ ไม่มีข้อความแจ้งเลยตอนหาย
      // เช็คค่า gLastProblem เดิมก่อนเคลียร์ = edge-trigger ธรรมชาติอยู่แล้ว (เข้าเงื่อนไขนี้ได้แค่ตอน
      // "เพิ่งจะ" ไม่ขาดการเชื่อมต่อแล้ว ไม่ใช่ทุกรอบที่เชื่อมต่อปกติ เพราะ gLastProblem โดนเคลียร์เป็น ""
      // ไปแล้วตั้งแต่รอบก่อน)
      DC_Send("✅ " + _Symbol + "\nกลับมาเชื่อมต่อกับ broker แล้ว");
      gLastProblem = ""; // เคลียร์ข้อความค้างบน dashboard (บั๊ก 2026-09-22)
   }

   double idleSec = (GetTickCount64() - gLastTickMs) / 1000.0;
   if(idleSec > ADXEMA_HEARTBEAT_MAX_SEC)
   {
      gLastProblem = StringFormat("ไม่มี tick เข้ามา %d นาทีแล้ว เช็คการเชื่อมต่อ", (int)(idleSec / 60));
      DC_NotifyProblemOnce("heartbeat_stuck", _Symbol, gLastProblem, "⚠️");
   }
   else
   {
      DC_ClearProblemKind("heartbeat_stuck");
      if(StringFind(gLastProblem, "ไม่มี tick เข้ามา") == 0)
      {
         // เหตุผลเดียวกับ disconnected ด้านบน — edge-trigger จาก gLastProblem เดิมก่อนเคลียร์
         DC_Send("✅ " + _Symbol + "\nกลับมามี tick เข้ามาปกติแล้ว");
         gLastProblem = "";
      }
   }

   // สรุปสถานะเข้า Discord เป็นระยะ (ผู้ใช้ขอ 2026-09-23) — InpSummaryEveryMin=0 ปิดฟีเจอร์นี้
   // InpSummaryOnlyTradeHours=true ส่งเฉพาะช่วงที่ InpUseCutoff อนุญาตให้เทรด (ไม่ส่งตอนนอกเวลา
   // แม้ EA จะยังทำงาน/monitor อยู่ก็ตาม) — เช็คใน OnTimer() ที่รันทุก 30 วิแน่นอนอยู่แล้ว ไม่ต้อง
   // พึ่ง tick เหมือนพาเนลบนกราฟ (มีไม้เปิดหรือไม่ก็ยังส่งได้แม้ไม่มี tick เข้ามาเลย)
   if(InpSummaryEveryMin > 0)
   {
      bool withinTradeHours = !InpUseCutoff || !PL_PastCutoff(InpCutoffServerHour, InpTradeStartServerHour);
      if(!InpSummaryOnlyTradeHours || withinTradeHours)
      {
         if(TimeCurrent() - gLastSummarySent >= InpSummaryEveryMin * 60)
         {
            gLastSummarySent = TimeCurrent();
            AdxEmaSendStatusSummary();
         }
      }
   }
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   PrintFormat("diag: adxLevelReject=%d diGapReject=%d noCross=%d emaNotReady=%d "
               "cutoffBlocked=%d cutoffClose=%d entered=%d momentumExit=%d | %s",
               gCnt_AdxLevelReject, gCnt_DiGapReject, gCnt_NoCross, gCnt_EmaNotReady,
               gCnt_CutoffBlocked, gCnt_CutoffClose, gCnt_Entered, gCnt_MomentumExit, PL_DiagString());

   if(InpShowChartObjects)
   {
      PL_ClearChartObjects(PL_ChartPrefix(InpMagic));
      ChartRedraw();
   }
   if(InpShowDashboard)
   {
      PL_ClearChartObjects("ADXEMADASH_" + IntegerToString(InpMagic) + "_");
      ChartRedraw();
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
//| เขียนผลของ pass นี้ลงไฟล์ใน Common — พารามิเตอร์ที่ sweep ได้ทั้งหมด   |
//| (ทุกสเตจ) ต้องอยู่ในชื่อไฟล์เสมอ (บทเรียนจาก bugs.md: ไม่งั้นหลาย pass  |
//| ทับกันเงียบๆ)                                                        |
//+------------------------------------------------------------------+
void DumpPass(const double score)
{
   // ใช้ ADXEMA_TRADE_TF ไม่ใช่ Period() — ตรรกะเทรดล็อก M1 ตายตัวแล้ว (2026-09-22) ต่อให้ตั้ง
   // Period ใน Strategy Tester เป็น TF อื่น ข้อมูลที่คำนวณจริงก็ยังเป็น M1 เสมอ ชื่อไฟล์ผลต้องบอก
   // ตามความจริง ไม่ใช่ตาม Tester period ที่เลือกไว้ (ดูคำอธิบายเต็มที่ ADXEMA_TRADE_TF ต้นไฟล์)
   string tf = StringSubstr(EnumToString((ENUM_TIMEFRAMES)ADXEMA_TRADE_TF), 7);

   string stem = StringFormat(
      "%s_%s_%d_%d_%.2f_%.2f_%d_%.2f_%.2f_%d_%.2f_%.2f_%.2f_%.2f_%.2f_%d",
      _Symbol, tf,
      InpADXPeriod, InpEmaPeriod, InpMinADXLevel, InpMinDiGap,
      InpATRPeriod, InpSLAtrMult, InpFixRRTpAtrMult,
      (int)InpExitOnMomentumLoss,
      InpTp1AtrMult, InpTp2AtrMult, InpTp3AtrMult,
      InpDynTpMinAtrMult, InpDynTpMaxAtrMult, (int)InpTpMode);
   string path = "adxema_opt\\" + stem + ".csv";

   int h = FileOpen(path, FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_COMMON);
   if(h == INVALID_HANDLE)
      return;

   WriteMonthlySeries("adxema_opt\\monthly\\" + stem + ".csv");

   FileWrite(h, StringFormat(
      "%s;%s;%d;%d;%.2f;%.2f;%d;%.2f;%.2f;%d;%.2f;%.2f;%.2f;%.2f;%.2f;%d;",
      _Symbol, tf,
      InpADXPeriod, InpEmaPeriod, InpMinADXLevel, InpMinDiGap,
      InpATRPeriod, InpSLAtrMult, InpFixRRTpAtrMult,
      (int)InpExitOnMomentumLoss,
      InpTp1AtrMult, InpTp2AtrMult, InpTp3AtrMult,
      InpDynTpMinAtrMult, InpDynTpMaxAtrMult, (int)InpTpMode)
      + MetricsCsvTail(score));
   FileClose(h);
}

//+------------------------------------------------------------------+
void OnTick()
{
   gLastTickMs = GetTickCount64(); // heartbeat — ดู OnTimer()

   if(InpUseCutoff && PL_PastCutoff(InpCutoffServerHour, InpTradeStartServerHour) && PL_HasPosition(InpMagic))
   {
      PL_CloseAll(InpMagic);
      string cutoffReason = "หมดเวลาเทรด (cutoff)";
      PL_SetLastEvent("ไม้ปิดแล้ว: " + cutoffReason); // ต้องตั้งก่อนส่งสรุป เหมือน momentum-exit ด้านบน
      double closedNet;
      if(AdxEmaClosedNet(closedNet))
         AdxEmaSendStatusSummary();
      gCnt_CutoffClose++;
   }
   PL_Manage(InpMagic, gCurUsePartials, false, false);

   datetime barTime = iTime(_Symbol, ADXEMA_TRADE_TF, 0);
   if(barTime != gLastBarTime)
   {
      gLastBarTime = barTime;

      double adxShift1;
      if(UpdateEma(adxShift1))
      {
         CheckMomentumExit(adxShift1);
         CheckEntrySignal(adxShift1);
      }
   }

   if(InpShowDashboard)
      AdxEmaDrawDashboard();
}
//+------------------------------------------------------------------+
