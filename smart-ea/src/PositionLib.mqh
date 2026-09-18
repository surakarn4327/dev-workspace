//+------------------------------------------------------------------+
//| PositionLib.mqh                                                    |
//| ตัวจัดการไม้ที่ใช้ร่วมกันของกลยุทธ์ที่พอร์ตจาก Pine ชุด WillyAlgoTrader  |
//|                                                                    |
//| ทุกตัวในชุดนี้มีโครงเดียวกัน: ถือไม้เดียว, SL/TP3 วางไว้ที่ broker,      |
//| TP1/TP2 เป็นจุดปิดบางส่วน (1/3) และ/หรือจุดเลื่อน SL (BE / TP1)        |
//| จึงแยกออกมาที่นี่ที่เดียวแทนที่จะ copy ตรรกะเดียวกัน 5 รอบ              |
//|                                                                    |
//| ไฟล์นี้ไม่รู้จัก input ของกลยุทธ์ใดเลย ค่าทุกตัวส่งผ่านพารามิเตอร์        |
//+------------------------------------------------------------------+
#ifndef POSITION_LIB_MQH
#define POSITION_LIB_MQH

#include <Trade\Trade.mqh>

CTrade gTrade;

//+------------------------------------------------------------------+
//| เลยเวลาตัดรอบวันหรือยัง — ใช้ทำ day-trade/scalping จบในวัน ห้ามถือ    |
//| ข้ามคืน (ผู้ใช้ตกลง 2026-09-14) เทียบจาก server hour ตรงๆ เพราะเวลา  |
//| server ไม่ใช่เวลาไทยเสมอไป (วัดจริงแล้ว 2026-09-14 server ช้ากว่าไทย  |
//| ~7 ชม. เที่ยงคืนไทยจึงตรงกับ server ~17:00 — ปรับได้ผ่าน cutoffHour   |
//| ถ้า server เปลี่ยน timezone/DST ทีหลัง)                              |
//+------------------------------------------------------------------+
// startServerHour < 0 (default) = พฤติกรรมเดิม: บล็อกตั้งแต่ cutoffServerHour ยาวไปจนเที่ยงคืน server
// แล้วเปิดเทรดได้ทันทีตั้งแต่ server 00:00 (ไม่ตั้งเวลาเริ่มแยก)
// ถ้าตั้ง startServerHour >= 0 ด้วย จะเช็คเป็น "ช่วงที่อนุญาตให้เทรด" [start, cutoff) แทน (รองรับ
// กรณี start > cutoff ที่ช่วงอนุญาตวนข้ามเที่ยงคืน server ไป เช่น start=23 cutoff=17 → อนุญาตเทรด
// hour 23,0,1,...,16 บล็อกเฉพาะ hour 17-22 — ใช้ทำ "เริ่มเทรดได้ตั้งแต่ 06:00 ไทย" (2026-09-16)
// รับ hour ตรงๆ แยกจาก PL_PastCutoff เพื่อใช้เช็คเวลาของ "แท่งประวัติ" ตอน replay ได้ด้วย
// (PL_PastCutoff อ่านจาก TimeCurrent() เสมอ ใช้ได้แค่ตอนเช็คเวลาสด)
bool PL_HourBlocked(const int hour, const int cutoffServerHour, const int startServerHour = -1)
{
   if(startServerHour < 0)
      return hour >= cutoffServerHour;

   bool allowed = (startServerHour <= cutoffServerHour)
      ? (hour >= startServerHour && hour < cutoffServerHour)
      : (hour >= startServerHour || hour < cutoffServerHour);
   return !allowed;
}

bool PL_PastCutoff(const int cutoffServerHour, const int startServerHour = -1)
{
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   return PL_HourBlocked(dt.hour, cutoffServerHour, startServerHour);
}

// "BUY"/"SELL" จาก dir (1/-1) — ใช้พิมพ์ log ให้อ่านง่ายแทนเลข dir ดิบ
string PL_DirStr(const int dir) { return dir == 1 ? "BUY" : "SELL"; }

// ข้อความปัญหาล่าสุด (ว่าง = ไม่เคยเกิดตั้งแต่ attach รอบนี้) — ตั้งจากจุด ⚠️ เดิมที่มีอยู่แล้ว
// (เข้าไม้/ปิดไม้ไม่สำเร็จ, วาดกราฟไม่สำเร็จ) ใช้โชว์บน dashboard แทนที่จะเขียน health-check ใหม่
string gLastProblem = "";

// เหตุการณ์ล่าสุด (เข้าไม้/ปิดไม้ ฯลฯ) — โชว์บน dashboard แทนที่ต้องไปเปิด Experts tab ดู
string   gLastEvent     = "";
datetime gLastEventTime = 0;
void PL_SetLastEvent(const string text)
{
   gLastEvent     = text;
   gLastEventTime = TimeCurrent();
}

// จุดเริ่ม "วันเทรด" ของรอบปัจจุบัน — ใช้ cutoffServerHour เป็นเส้นแบ่งวันเดียวกับกฎ day-trade
// (เที่ยงคืนไทย = cutoffServerHour ฝั่ง server) ไม่ใช่เที่ยงคืนปฏิทินธรรมดา
datetime PL_TradingDayStart(const int cutoffServerHour)
{
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   dt.hour = cutoffServerHour; dt.min = 0; dt.sec = 0;
   datetime cutoffToday = StructToTime(dt);
   return (TimeCurrent() >= cutoffToday) ? cutoffToday : cutoffToday - 86400;
}

// เวลาที่เหลือก่อนถึง cutoff แบบอ่านง่าย — "นอกเวลาเทรด" ถ้าติด cutoff อยู่แล้ว
string PL_TimeLeftStr(const int cutoffServerHour, const int startServerHour = -1)
{
   if(PL_PastCutoff(cutoffServerHour, startServerHour))
      return "นอกเวลาเทรด";
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   int nowMin = dt.hour * 60 + dt.min;
   int cutMin = cutoffServerHour * 60;
   int diff = cutMin - nowMin;
   if(diff < 0) diff += 24 * 60;
   return StringFormat("%d ชม. %d นาที", diff / 60, diff % 60);
}

// พื้นหลังสี่เหลี่ยมทึบของพาเนล dashboard — ให้อ่านออกด้วยตอนชาร์ตพื้นขาว (ผู้ใช้ขอ 2026-09-17)
void PL_DashPanelBg(const string name, const int x, const int y, const int w, const int h,
                     const color bg, const color border, const ENUM_BASE_CORNER corner)
{
   if(ObjectFind(0, name) < 0)
      ObjectCreate(0, name, OBJ_RECTANGLE_LABEL, 0, 0, 0);
   ObjectSetInteger(0, name, OBJPROP_CORNER, corner);
   ObjectSetInteger(0, name, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, name, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, name, OBJPROP_XSIZE, w);
   ObjectSetInteger(0, name, OBJPROP_YSIZE, h);
   ObjectSetInteger(0, name, OBJPROP_BGCOLOR, bg);
   ObjectSetInteger(0, name, OBJPROP_COLOR, border);
   ObjectSetInteger(0, name, OBJPROP_BORDER_TYPE, BORDER_FLAT);
   ObjectSetInteger(0, name, OBJPROP_STYLE, STYLE_SOLID);
   ObjectSetInteger(0, name, OBJPROP_WIDTH, 1);
   ObjectSetInteger(0, name, OBJPROP_BACK, false);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, name, OBJPROP_HIDDEN, true);
}

// สร้าง/อัปเดต label หนึ่งบรรทัดของ dashboard — เรียกซ้ำได้ตลอด (เขียนทับค่าเดิมเสมอ)
void PL_DashLabel(const string name, const string text, const int x, const int y,
                   const color clr, const int fontSize = 9,
                   const ENUM_BASE_CORNER corner = CORNER_LEFT_UPPER,
                   const ENUM_ANCHOR_POINT anchor = ANCHOR_LEFT_UPPER)
{
   if(ObjectFind(0, name) < 0)
      ObjectCreate(0, name, OBJ_LABEL, 0, 0, 0);
   ObjectSetInteger(0, name, OBJPROP_CORNER, corner);
   ObjectSetInteger(0, name, OBJPROP_ANCHOR, anchor);
   ObjectSetInteger(0, name, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, name, OBJPROP_YDISTANCE, y);
   ObjectSetString(0, name, OBJPROP_TEXT, text);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   ObjectSetString(0, name, OBJPROP_FONT, "Consolas");
   ObjectSetInteger(0, name, OBJPROP_FONTSIZE, fontSize);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, name, OBJPROP_HIDDEN, true);
   ObjectSetInteger(0, name, OBJPROP_BACK, false);
}

// แปลง server hour เป็นเวลาไทยแบบ "HH.00" สำหรับโชว์ใน log เท่านั้น (offset +7 ชม. ตามที่วัดจริง
// 2026-09-14 — ดูคอมเมนต์ InpCutoffServerHour/InpTradeStartServerHour ถ้า server เปลี่ยน timezone
// ต้องปรับ input เหล่านั้นเอง ฟังก์ชันนี้แค่แปลงเพื่อแสดงผล ไม่กระทบตรรกะเทรด)
string PL_ThaiHourStr(const int serverHour)
{
   int thaiHour = ((serverHour + 7) % 24 + 24) % 24;
   return StringFormat("%02d.00", thaiHour);
}

// ── สถานะไม้ที่ถืออยู่ (EA ทุกตัวในชุดนี้ถือได้ไม้เดียว) ──
int    gMtDir     = 0;     // 1 = long, -1 = short, 0 = ไม่มีไม้
ulong  gMtPosId   = 0;     // position identifier ของไม้ที่เปิดอยู่
double gMtEntry   = 0;
double gMtSlInit  = 0;     // SL ตอนเปิด (ใช้คำนวณ R ไม่ใช่ SL ปัจจุบัน)
double gMtTp1     = 0;
double gMtTp2     = 0;
double gMtTp3     = 0;
double gMtLot     = 0;     // ล็อตของไม้ที่เปิดอยู่ (ไว้พิมพ์ log ความเสี่ยง/ล็อตให้อ่านง่าย)
double gMtPartVol = 0;     // ปริมาณที่ปิดต่อ 1 ขั้น = 1/3 ของไม้เต็ม
bool   gMtHitTp1  = false;
bool   gMtHitTp2  = false;
bool   gMtBeDone  = false;
int    gMtOpenBar = 0;

// ตัวนับ diagnostic — ตามกฎโปรเจกต์ ห้ามเดาสาเหตุเวลาผลผิดคาด
int gPlOpenFail = 0, gPlNoRisk = 0, gPlLotTooSmall = 0, gPlNoPartial = 0;
int gPlOpened = 0, gPlClosedSl = 0, gPlClosedTp = 0, gPlClosedManual = 0;

//+------------------------------------------------------------------+
//| วาดจุดเข้า/SL/TP บนชาร์ต — เปิดใช้ต่อไม้ผ่าน showChart ของ PL_Open       |
//| ชื่อ object ทุกตัวขึ้นต้นด้วย prefix เดียวกัน (มาจาก magic) ลบทีเดียวได้  |
//| ไม่กระทบตรรกะเทรดเลย เป็นแค่ภาพ                                       |
//+------------------------------------------------------------------+
string PL_ChartPrefix(const long magic)
{
   return "PL_" + IntegerToString(magic) + "_";
}

bool PL_ChartActive(const string prefix)
{
   return ObjectFind(0, prefix + "entry_arrow") >= 0;
}

void PL_ClearChartObjects(const string prefix)
{
   for(int i = ObjectsTotal(0) - 1; i >= 0; i--)
   {
      string nm = ObjectName(0, i);
      if(StringFind(nm, prefix) == 0)
         ObjectDelete(0, nm);
   }
}

void PL_SetHLine(const string name, const double price, const color clr, const ENUM_LINE_STYLE style)
{
   if(ObjectFind(0, name) < 0)
      ObjectCreate(0, name, OBJ_HLINE, 0, 0, price);
   else
      ObjectMove(0, name, 0, 0, price);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   ObjectSetInteger(0, name, OBJPROP_STYLE, style);
   ObjectSetInteger(0, name, OBJPROP_WIDTH, 1);
   ObjectSetInteger(0, name, OBJPROP_BACK, true);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
}

void PL_SetLabel(const string name, const string text, const double price, const color clr)
{
   datetime t = iTime(_Symbol, PERIOD_CURRENT, 0) + PeriodSeconds(PERIOD_CURRENT) * 3;
   if(ObjectFind(0, name) < 0)
      ObjectCreate(0, name, OBJ_TEXT, 0, t, price);
   else
      ObjectMove(0, name, 0, t, price);
   ObjectSetString(0, name, OBJPROP_TEXT, text);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   ObjectSetInteger(0, name, OBJPROP_FONTSIZE, 8);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
}

void PL_DrawTrade(const string prefix, const int dir, const double entry,
                   const double sl, const double tp1, const double tp2, const double tp3)
{
   string an = prefix + "entry_arrow";
   ObjectCreate(0, an, dir == 1 ? OBJ_ARROW_BUY : OBJ_ARROW_SELL, 0, TimeCurrent(), entry);
   ObjectSetInteger(0, an, OBJPROP_COLOR, dir == 1 ? clrDodgerBlue : clrOrange);
   ObjectSetInteger(0, an, OBJPROP_SELECTABLE, false);

   PL_SetHLine(prefix + "sl", sl, clrRed, STYLE_DASH);
   PL_SetLabel(prefix + "sl_lbl", "SL " + DoubleToString(sl, _Digits), sl, clrRed);
   PL_SetHLine(prefix + "tp1", tp1, clrGold, STYLE_DOT);
   PL_SetLabel(prefix + "tp1_lbl", "TP1 " + DoubleToString(tp1, _Digits), tp1, clrGold);
   PL_SetHLine(prefix + "tp2", tp2, clrLime, STYLE_DOT);
   PL_SetLabel(prefix + "tp2_lbl", "TP2 " + DoubleToString(tp2, _Digits), tp2, clrLime);
   PL_SetHLine(prefix + "tp3", tp3, clrGreen, STYLE_SOLID);
   PL_SetLabel(prefix + "tp3_lbl", "TP3 " + DoubleToString(tp3, _Digits), tp3, clrGreen);
   ChartRedraw();
}

//+------------------------------------------------------------------+
double PL_NormVol(double vol)
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
bool PL_Select(const long magic, ulong &ticket)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(t == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) == _Symbol &&
         PositionGetInteger(POSITION_MAGIC) == magic)
      {
         ticket = t;
         return true;
      }
   }
   return false;
}

bool PL_HasPosition(const long magic)
{
   ulong t = 0;
   return PL_Select(magic, t);
}

//+------------------------------------------------------------------+
//| lot จากทุนเสี่ยง — "จุด" ในสูตรนี้คือ pointUnit ที่ผู้ใช้กำหนด (XAUUSD    |
//| ใช้ 0.01) ไม่ใช่ SYMBOL_POINT ของ broker (ดูบั๊ก 2026-09-04 ใน bugs.md) |
//+------------------------------------------------------------------+
//| ซิงก์ gMt* จากไม้จริงที่เปิดอยู่ในบัญชี — เรียกใน OnInit หลัง SatsReplayHistory/
//| เทียบเท่า ป้องกันบั๊ก: เปลี่ยน timeframe/symbol ของชาร์ต ทำให้ MT5 unload+reload
//| EA global variable ทั้งหมดรีเซ็ตกลับค่าเริ่มต้น (gMtDir กลับเป็น 0) ทั้งที่ไม้จริง
//| ยังเปิดอยู่ในตลาด ถ้าไม่ sync ตรงนี้ EA จะ "ลืม" ไม้เดิม แล้วอาจเปิดไม้ซ้อนอีกไม้
//| (เพราะคิดว่าช่องว่าง) หรือไม่คัตไม้ตาม cutoff/timeout/flip-exit ให้อีกเลย
//|
//| กู้คืนได้แค่ dir/entry/SL/TP(บรอกเกอร์)/openBar โดยประมาณ — TP1/TP2 (จุดปิดบางส่วน)
//| กับสถานะ hitTp1/hitTp2/BE ไม่มีที่เก็บฝั่งบรอกเกอร์เลย จึงถือว่า "ผ่านไปแล้ว" (true)
//| ไว้ก่อนอย่างระมัดระวัง กันปิดบางส่วนซ้ำผิดจำนวน/ผิดราคาอ้างอิงเดิม
//+------------------------------------------------------------------+
bool PL_SyncOpenPosition(const long magic, const int currentGBar)
{
   ulong ticket = 0;
   if(!PL_Select(magic, ticket)) return false;

   long     type     = PositionGetInteger(POSITION_TYPE);
   double   entry    = PositionGetDouble(POSITION_PRICE_OPEN);
   double   sl       = PositionGetDouble(POSITION_SL);
   double   tp       = PositionGetDouble(POSITION_TP);
   datetime openTime = (datetime)PositionGetInteger(POSITION_TIME);

   gMtDir     = (type == POSITION_TYPE_BUY) ? 1 : -1;
   gMtPosId   = (ulong)PositionGetInteger(POSITION_IDENTIFIER);
   gMtEntry   = entry;
   gMtSlInit  = sl;
   gMtTp1     = tp;  // ไม่รู้ TP1/TP2 จริง ใช้ TP บรอกเกอร์ (=TP3 เดิม) กันปิดบางส่วนผิดราคา
   gMtTp2     = tp;
   gMtTp3     = tp;
   gMtHitTp1  = true; // ถือว่าผ่านจุดปิดบางส่วนไปแล้ว กันปิด partial ซ้ำผิดจำนวน/ผิดราคา
   gMtHitTp2  = true;
   gMtBeDone  = true; // กันเลื่อน SL ไปที่ราคาเปิดซ้ำ
   gMtPartVol = 0;
   gMtLot     = PositionGetDouble(POSITION_VOLUME);

   int shift = iBarShift(_Symbol, PERIOD_CURRENT, openTime, false);
   gMtOpenBar = (shift >= 0) ? MathMax(0, currentGBar - shift) : currentGBar;

   return true;
}

//+------------------------------------------------------------------+
double PL_Lot(const double riskUsd, const double slDist, const double pointUnit)
{
   if(slDist <= 0 || pointUnit <= 0) return 0;
   double slPoints = slDist / pointUnit;
   if(slPoints <= 0) return 0;
   return PL_NormVol(riskUsd / slPoints);
}

//+------------------------------------------------------------------+
//| เปิดไม้จริง — SL กับ TP3 วางไว้ที่ broker (Pine ต้นฉบับตรวจเองในสคริปต์) |
//+------------------------------------------------------------------+
bool PL_Open(const int dir, const double slPrice,
             const double tp1, const double tp2, const double tp3,
             const double riskUsd, const double pointUnit,
             const long magic, const string cmt,
             const bool usePartials, const int barIdx,
             const bool showChart = false)
{
   bool isLong  = (dir == 1);
   double entry = isLong ? SymbolInfoDouble(_Symbol, SYMBOL_ASK)
                         : SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double risk  = MathAbs(entry - slPrice);
   if(risk <= 0)
   {
      gPlNoRisk++;
      return false;
   }

   double lot = PL_Lot(riskUsd, risk, pointUnit);
   if(lot <= 0)
   {
      gPlLotTooSmall++;
      return false;
   }

   // SL/TP ของ SELL ถูก broker เช็คกับ Ask ไม่ใช่ Bid — slPrice/tp1/tp2/tp3 คำนวณมาจาก
   // ราคา Bid (high/low/close ของแท่งเป็นค่า Bid โดย default) จึงต้องบวก spread ปัจจุบัน
   // ชดเชยให้ทุกระดับ (ทั้งที่ส่ง broker และที่ PL_Manage เทียบกับ Ask เอง) ตรงกับ Bid ที่
   // ตั้งใจไว้จริง — BUY ไม่ต้องเพราะเช็คกับ Bid อยู่แล้ว ไม่กระทบ lot/risk เพราะคำนวณจาก
   // slPrice เดิมไปแล้วข้างบน
   double spread = isLong ? 0.0 : SymbolInfoDouble(_Symbol, SYMBOL_ASK) - SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double slAdj  = slPrice + spread;
   double tp1Adj = tp1 + spread;
   double tp2Adj = tp2 + spread;
   double tp3Adj = tp3 + spread;

   double sl = NormalizeDouble(slAdj, _Digits);
   double tp = NormalizeDouble(tp3Adj, _Digits);

   bool ok = isLong ? gTrade.Buy(lot, _Symbol, 0, sl, tp, cmt)
                    : gTrade.Sell(lot, _Symbol, 0, sl, tp, cmt);
   if(!ok)
   {
      gPlOpenFail++;
      gLastProblem = "เข้าไม้ไม่สำเร็จ";
      PrintFormat("⚠️ เข้าไม้ไม่สำเร็จ: %s ที่ %s — broker ปฏิเสธ (%s)",
                  PL_DirStr(dir), DoubleToString(entry, _Digits), gTrade.ResultRetcodeDescription());
      return false;
   }

   ulong ticket = 0;
   gMtPosId = PL_Select(magic, ticket) ? (ulong)PositionGetInteger(POSITION_IDENTIFIER) : 0;

   gMtDir     = dir;
   gMtEntry   = entry;
   gMtSlInit  = slAdj;
   gMtTp1     = tp1Adj;
   gMtTp2     = tp2Adj;
   gMtTp3     = tp3Adj;
   gMtHitTp1  = false;
   gMtHitTp2  = false;
   gMtBeDone  = false;
   gMtOpenBar = barIdx;
   gMtLot     = lot;
   gMtPartVol = usePartials ? PL_NormVol(lot / 3.0) : 0.0;
   if(usePartials && gMtPartVol <= 0)
      gPlNoPartial++;
   gPlOpened++;

   if(showChart)
      PL_DrawTrade(PL_ChartPrefix(magic), dir, entry, slAdj, tp1Adj, tp2Adj, tp3Adj);

   return true;
}

//+------------------------------------------------------------------+
void PL_CloseAll(const long magic)
{
   ulong ticket = 0;
   if(!PL_Select(magic, ticket)) { gMtDir = 0; return; }
   if(gTrade.PositionClose(ticket))
   {
      gPlClosedManual++;
      gMtDir = 0;
      // ไม่ล้าง gMtPosId ที่นี่ — ผู้เรียกอาจต้องอ่านประวัติดีลของไม้นี้ต่อ
      PL_ClearChartObjects(PL_ChartPrefix(magic));
   }
   else
   {
      gLastProblem = "ปิดไม้ไม่สำเร็จ";
      PrintFormat("⚠️ ปิดไม้ไม่สำเร็จ: ticket #%s — broker ปฏิเสธ (%s)",
                  IntegerToString(ticket), gTrade.ResultRetcodeDescription());
   }
}

//+------------------------------------------------------------------+
//| จำแนกว่าไม้ที่เพิ่งหายไปปิดด้วยอะไร (ไว้อ่านตอน debug)                  |
//+------------------------------------------------------------------+
void PL_ClassifyClosed()
{
   if(gMtPosId == 0) return;
   if(!HistorySelectByPosition((long)gMtPosId)) { gMtPosId = 0; return; }

   long lastReason = -1;
   double lastPrice = 0;
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
         lastPrice  = HistoryDealGetDouble(d, DEAL_PRICE);
      }
   }
   if(lastReason == DEAL_REASON_TP)
   {
      gPlClosedTp++;
      PL_SetLastEvent(StringFormat("ไม้ปิดแล้ว: TP ที่ %s", DoubleToString(lastPrice, _Digits)));
      Print(gLastEvent);
   }
   else if(lastReason == DEAL_REASON_SL)
   {
      gPlClosedSl++;
      PL_SetLastEvent(StringFormat("ไม้ปิดแล้ว: SL ที่ %s", DoubleToString(lastPrice, _Digits)));
      Print(gLastEvent);
   }
   gMtPosId = 0;
}

//+------------------------------------------------------------------+
//| เลื่อน SL ของไม้ที่เปิดอยู่ (TP เดิมคงไว้)                             |
//+------------------------------------------------------------------+
// newSl ต้องเป็นระดับที่พร้อมส่งให้ broker แล้ว (ชดเชย spread มาแล้วถ้าเป็น SELL) —
// ผู้เรียกรับผิดชอบเรื่องนี้เอง เพราะบางค่าที่ส่งเข้ามา (เช่น gMtTp1) ชดเชยไว้แล้วตั้งแต่
// ตอนเปิดไม้ ถ้าชดเชยซ้ำในนี้อีกจะบวก spread สองรอบ
bool PL_MoveSl(const ulong ticket, const double newSl)
{
   if(!PositionSelectByTicket(ticket)) return false;
   double curSl = PositionGetDouble(POSITION_SL);
   double curTp = PositionGetDouble(POSITION_TP);
   double sl    = NormalizeDouble(newSl, _Digits);
   if(MathAbs(curSl - sl) < SymbolInfoDouble(_Symbol, SYMBOL_POINT)) return false;
   bool ok = gTrade.PositionModify(ticket, sl, curTp);
   if(ok)
   {
      string prefix = PL_ChartPrefix((long)PositionGetInteger(POSITION_MAGIC));
      if(PL_ChartActive(prefix))
      {
         PL_SetHLine(prefix + "sl", sl, clrRed, STYLE_DASH);
         PL_SetLabel(prefix + "sl_lbl", "SL(BE) " + DoubleToString(sl, _Digits), sl, clrRed);
         ChartRedraw();
      }
   }
   return ok;
}

//+------------------------------------------------------------------+
//| จัดการไม้ที่เปิดอยู่ทุก tick:                                          |
//|  - usePartials : แตะ TP1 ปิด 1/3, แตะ TP2 ปิดอีก 1/3 (ที่เหลือวิ่งถึง TP3)|
//|  - useBe       : แตะ TP1 เลื่อน SL มาที่ราคาเปิด                       |
//|  - trailAfterTp2 : แตะ TP2 เลื่อน SL มาที่ TP1                        |
//| คืนค่า true ถ้ายังมีไม้เปิดอยู่                                        |
//+------------------------------------------------------------------+
bool PL_Manage(const long magic, const bool usePartials,
               const bool useBe, const bool trailAfterTp2)
{
   ulong ticket = 0;
   if(!PL_Select(magic, ticket))
   {
      if(gMtDir != 0)
      {
         PL_ClassifyClosed();
         PL_ClearChartObjects(PL_ChartPrefix(magic));
      }
      gMtDir = 0;
      return false;
   }
   if(gMtDir == 0) return true;

   bool isLong = (gMtDir == 1);
   double px = isLong ? SymbolInfoDouble(_Symbol, SYMBOL_BID)
                      : SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   if(px <= 0) return true;

   bool reach1 = isLong ? px >= gMtTp1 : px <= gMtTp1;
   bool reach2 = isLong ? px >= gMtTp2 : px <= gMtTp2;

   if(reach1 && !gMtHitTp1)
   {
      gMtHitTp1 = true;
      if(usePartials && gMtPartVol > 0)
      {
         double vol = PositionGetDouble(POSITION_VOLUME);
         if(vol - gMtPartVol >= SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN))
            gTrade.PositionClosePartial(ticket, gMtPartVol);
      }
      if(useBe && !gMtBeDone)
      {
         // gMtEntry เป็นราคาที่เปิดไม้จริง (Bid สำหรับ SELL) ไม่ได้ชดเชย spread ไว้
         // ต่างจาก gMtTp1/Tp2 ที่ชดเชยแล้วตั้งแต่ PL_Open — ต้องบวกเองตรงนี้
         double beSpread = isLong ? 0.0 : SymbolInfoDouble(_Symbol, SYMBOL_ASK) - SymbolInfoDouble(_Symbol, SYMBOL_BID);
         if(PL_MoveSl(ticket, gMtEntry + beSpread))
            gMtBeDone = true;
      }
   }

   if(reach2 && !gMtHitTp2)
   {
      gMtHitTp2 = true;
      if(usePartials && gMtPartVol > 0 && PositionSelectByTicket(ticket))
      {
         double vol = PositionGetDouble(POSITION_VOLUME);
         if(vol - gMtPartVol >= SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN))
            gTrade.PositionClosePartial(ticket, gMtPartVol);
      }
      if(trailAfterTp2)
         PL_MoveSl(ticket, gMtTp1);
   }

   return true;
}

//+------------------------------------------------------------------+
string PL_DiagString()
{
   return StringFormat("pl: opened=%d openFail=%d noRisk=%d lotTooSmall=%d noPartial=%d "
                       "closedTp=%d closedSl=%d closedManual=%d",
                       gPlOpened, gPlOpenFail, gPlNoRisk, gPlLotTooSmall, gPlNoPartial,
                       gPlClosedTp, gPlClosedSl, gPlClosedManual);
}

#endif
