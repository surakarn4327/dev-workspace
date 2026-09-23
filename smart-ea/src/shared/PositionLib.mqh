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
#include "DiscordNotify.mqh"

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

// จุดเริ่ม "วันเทรด" ของรอบปัจจุบัน — เดิมใช้ cutoffServerHour เป็นเส้นแบ่งวันเสมอ แต่ cutoff กับ
// เวลาเริ่มเทรด (startServerHour) เป็นคนละเวลากัน (default cutoff=17 server, start=23 server —
// ต่างกัน 6 ชม.) ผู้ใช้ขอ 2026-09-22 ให้ "วันนี้" บน dashboard เริ่มนับจากเวลาที่เริ่มเทรดได้จริง
// ไม่ใช่จาก cutoff — ถ้าส่ง startServerHour มา (>=0) ใช้เป็นเส้นแบ่งวันแทน คืนค่าเวลาที่ล่าสุดที่
// hour นั้นเกิดขึ้น (วันนี้ถ้าถึงแล้ว ไม่งั้นย้อนไปเมื่อวาน) ไม่ใส่ startServerHour (ค่าเริ่มต้น -1)
// ยังคงพฤติกรรมเดิมเป๊ะ (ใช้ cutoffServerHour เป็นเส้นแบ่งวัน)
datetime PL_TradingDayStart(const int cutoffServerHour, const int startServerHour = -1)
{
   int markHour = (startServerHour >= 0) ? startServerHour : cutoffServerHour;
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   dt.hour = markHour; dt.min = 0; dt.sec = 0;
   datetime markToday = StructToTime(dt);
   return (TimeCurrent() >= markToday) ? markToday : markToday - 86400;
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
double gMtSlCurrent = 0;   // SL ปัจจุบันจริง (ขยับได้ตอน BE/trailAfterTp2) ใช้คำนวณ "เสี่ยงเหลือเท่าไหร่
                           // ถ้าโดน SL ตอนนี้" บน dashboard — ต่างจาก gMtSlInit ที่ตรึงค่าตอนเปิดไม้
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

// showTp12 = false ไม่วาดเส้น/label TP1-TP2 (ใช้ตอน usePartials/useBe ปิดทั้งคู่ — ไม้จะปิดที่ TP3
// เท่านั้น เส้น TP1/TP2 ไม่มีความหมายกับผู้ใช้ตอนนั้น) ไม่กระทบค่า gMtTp1/gMtTp2 ภายในเลย ยังคำนวณ/
// เก็บไว้เหมือนเดิมทุกอย่าง เพราะยังใช้เช็ค breakeven (ถ้า useBe เปิด) และตอน replay/catch-up
void PL_DrawTrade(const string prefix, const int dir, const double entry,
                   const double sl, const double tp1, const double tp2, const double tp3,
                   const bool showTp12 = true)
{
   string an = prefix + "entry_arrow";
   ObjectCreate(0, an, dir == 1 ? OBJ_ARROW_BUY : OBJ_ARROW_SELL, 0, TimeCurrent(), entry);
   ObjectSetInteger(0, an, OBJPROP_COLOR, dir == 1 ? clrDodgerBlue : clrOrange);
   ObjectSetInteger(0, an, OBJPROP_SELECTABLE, false);

   PL_SetHLine(prefix + "sl", sl, clrRed, STYLE_DASH);
   PL_SetLabel(prefix + "sl_lbl", "SL " + DoubleToString(sl, _Digits), sl, clrRed);
   if(showTp12)
   {
      PL_SetHLine(prefix + "tp1", tp1, clrGold, STYLE_DOT);
      PL_SetLabel(prefix + "tp1_lbl", "TP1 " + DoubleToString(tp1, _Digits), tp1, clrGold);
      PL_SetHLine(prefix + "tp2", tp2, clrLime, STYLE_DOT);
      PL_SetLabel(prefix + "tp2_lbl", "TP2 " + DoubleToString(tp2, _Digits), tp2, clrLime);
   }
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
//| รวมกำไร/ขาดทุน + จำนวนไม้ที่ "ปิดจบแล้ว" ของไม้ที่ EA นี้เปิดเอง ตั้งแต่ต้น  |
//| วันเทรดปัจจุบัน — ใช้โชว์แถว "วันนี้" บน dashboard เท่านั้น                  |
//|                                                                    |
//| แก้บั๊ก 2026-09-22 (ดู bugs.md): เดิมกรอง deal ปิดไม้ (DEAL_ENTRY_OUT)    |
//| ด้วย DEAL_MAGIC ของตัว deal ปิดเองตรงๆ ซึ่งผิด — deal ปิดที่เกิดจากการ   |
//| ปิดมือผ่านเทอร์มินัล (คลิกขวา Close) หรือ stop-out จะมี DEAL_MAGIC = 0   |
//| เสมอ (สืบทอดจาก order ที่สั่งปิด ไม่ใช่จาก position เดิม) ไม่ตรงกับ magic  |
//| ของ EA ทำให้กำไรของไม้ที่ปิดมือหายไปจากผลรวม ทั้งที่ deal เข้าไม้ (IN) ของ|
//| ไม้เดียวกันยังมี magic ถูกต้องอยู่ (นับเข้าจำนวนไม้ได้ปกติ) — วิธีแก้คือ   |
//| ไล่ 2 รอบ: รอบแรกหา DEAL_POSITION_ID ของไม้ที่ IN deal มี magic ตรงกับ   |
//| EA นี้จริง (เชื่อถือได้เสมอ เพราะ EA เป็นคนสั่งเปิดเองโดยตรง) รอบสองรวม    |
//| กำไรจาก OUT deal ที่ position id อยู่ในเซตนั้น โดยไม่สนใจ magic ของ OUT   |
//| deal เอง — นับ "ไม้" แค่ครั้งเดียวต่อ 1 position แม้จะมีหลาย OUT deal    |
//| (partial close TP1/TP2) และนับเฉพาะไม้ที่ปิดจบแล้วเท่านั้น (ไม้ที่ยังเปิด |
//| ค้างอยู่ตอนนี้ไม่มี OUT deal เลย จึงไม่ถูกนับ ตามที่ผู้ใช้ขอ)              |
//+------------------------------------------------------------------+
void PL_ComputeTodayStats(const long magic, const int cutoffServerHour, const int startServerHour,
                           double &profitOut, int &tradesOut)
{
   profitOut = 0;
   tradesOut = 0;
   datetime dayStart = PL_TradingDayStart(cutoffServerHour, startServerHour);
   if(!HistorySelect(dayStart, TimeCurrent())) return;

   int deals = HistoryDealsTotal();

   long ownPosIds[];
   for(int i = 0; i < deals; i++)
   {
      ulong d = HistoryDealGetTicket(i);
      if(d == 0) continue;
      if(HistoryDealGetString(d, DEAL_SYMBOL) != _Symbol) continue;
      if(HistoryDealGetInteger(d, DEAL_ENTRY) != DEAL_ENTRY_IN) continue;
      if(HistoryDealGetInteger(d, DEAL_MAGIC) != magic) continue;
      int n = ArraySize(ownPosIds);
      ArrayResize(ownPosIds, n + 1);
      ownPosIds[n] = (long)HistoryDealGetInteger(d, DEAL_POSITION_ID);
   }
   if(ArraySize(ownPosIds) == 0) return;

   long countedPosIds[];
   for(int i = 0; i < deals; i++)
   {
      ulong d = HistoryDealGetTicket(i);
      if(d == 0) continue;
      if(HistoryDealGetString(d, DEAL_SYMBOL) != _Symbol) continue;
      long entry = HistoryDealGetInteger(d, DEAL_ENTRY);
      if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_OUT_BY) continue;

      long posId = (long)HistoryDealGetInteger(d, DEAL_POSITION_ID);
      bool isOwn = false;
      for(int k = 0; k < ArraySize(ownPosIds); k++)
         if(ownPosIds[k] == posId) { isOwn = true; break; }
      if(!isOwn) continue;

      profitOut += HistoryDealGetDouble(d, DEAL_PROFIT)
                 + HistoryDealGetDouble(d, DEAL_SWAP)
                 + HistoryDealGetDouble(d, DEAL_COMMISSION);

      bool alreadyCounted = false;
      for(int k = 0; k < ArraySize(countedPosIds); k++)
         if(countedPosIds[k] == posId) { alreadyCounted = true; break; }
      if(!alreadyCounted)
      {
         int n = ArraySize(countedPosIds);
         ArrayResize(countedPosIds, n + 1);
         countedPosIds[n] = posId;
         tradesOut++;
      }
   }
}

//+------------------------------------------------------------------+
//| มีไม้เข้าจริง (magic/symbol นี้) เกิดขึ้นตั้งแต่เวลา sinceTime เป็นต้นมาไหม |
//| ใช้กันบั๊ก "สัญญาณค้างฟื้นซ้ำ" — สัญญาณที่ replay/pending เจอ ถ้ามีไม้จริง |
//| เข้าไปแล้วหลังจากสัญญาณนั้นเกิด แปลว่าถูกเทรดไปแล้วจริง (ไม่ว่าจะได้/เสีย)  |
//| ไม่ควรฟื้นกลับมาเข้าซ้ำอีก (ดู bugs.md 2026-09-18)                       |
//+------------------------------------------------------------------+
bool PL_HasEntrySince(const long magic, const datetime sinceTime)
{
   if(sinceTime <= 0) return false;
   if(!HistorySelect(sinceTime, TimeCurrent())) return false;
   int deals = HistoryDealsTotal();
   for(int i = 0; i < deals; i++)
   {
      ulong d = HistoryDealGetTicket(i);
      if(d == 0) continue;
      if(HistoryDealGetInteger(d, DEAL_MAGIC) != magic) continue;
      if(HistoryDealGetString(d, DEAL_SYMBOL) != _Symbol) continue;
      if(HistoryDealGetInteger(d, DEAL_ENTRY) == DEAL_ENTRY_IN) return true;
   }
   return false;
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
//| กู้คืนได้แค่ dir/entry/SL/TP(บรอกเกอร์)/openBar จาก broker โดยตรงเสมอ — ส่วน TP1/TP2 (จุดปิด
//| บางส่วน) กับสถานะ hitTp1/hitTp2/BE ลองโหลดจากไฟล์ที่ PL_Open/PL_Manage เขียนไว้ก่อน (ดู
//| PL_LoadState) ถ้าไฟล์ตรงกับไม้จริง (เทียบ posId) ถือว่าเชื่อถือได้ ใช้แทนค่าเดา — ถ้าไม่มีไฟล์
//| หรือ posId ไม่ตรง (เช่น backward-compat กับ EA เวอร์ชันก่อนมีไฟล์นี้) fallback เป็นค่าเดิมที่
//| ถือว่า "ผ่านไปแล้ว" (true) ไว้ก่อนอย่างระมัดระวัง กันปิดบางส่วนซ้ำผิดจำนวน/ผิดราคาอ้างอิงเดิม
//| (แก้บั๊ก 2026-09-22 — ดู bugs.md)
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
   gMtLot     = PositionGetDouble(POSITION_VOLUME);
   gMtSlCurrent = sl; // SL ปัจจุบันอ่านสดจาก broker เสมอ เชื่อถือได้อยู่แล้วไม่ต้องพึ่งไฟล์ state

   bool stateLoaded = PL_LoadState(magic, gMtPosId);
   if(!stateLoaded)
   {
      gMtSlInit  = sl;
      gMtTp1     = tp;  // ไม่รู้ TP1/TP2 จริง ใช้ TP บรอกเกอร์ (=TP3 เดิม) กันปิดบางส่วนผิดราคา
      gMtTp2     = tp;
      gMtTp3     = tp;
      gMtHitTp1  = true; // ถือว่าผ่านจุดปิดบางส่วนไปแล้ว กันปิด partial ซ้ำผิดจำนวน/ผิดราคา
      gMtHitTp2  = true;
      gMtBeDone  = true; // กันเลื่อน SL ไปที่ราคาเปิดซ้ำ
      gMtPartVol = 0;
   }

   int shift = iBarShift(_Symbol, PERIOD_CURRENT, openTime, false);
   gMtOpenBar = (shift >= 0) ? MathMax(0, currentGBar - shift) : currentGBar;

   // แก้บั๊ก 2026-09-18: เดิมฟังก์ชันนี้ไม่เคยเรียก PL_SetLastEvent เลย ทำให้ "เหตุการณ์ล่าสุด" บน
   // dashboard ค้างข้อความ/เวลาเก่าจากก่อน reattach ทั้งที่แถว Position sync ราคาใหม่ถูกต้องแล้ว —
   // ใช้ openTime จริงของไม้ (ไม่ใช่ TimeCurrent() ตอน reattach) ให้เวลาที่โชว์ตรงกับตอนเปิดไม้จริง
   // แยกข้อความ 2 แบบ (ผู้ใช้ขอ 2026-09-22 ไว้เช็คว่า "กลับมาดูแลไม้" หลัง restart สำเร็จจริงไหม)
   // ไม่ต้องบอกละเอียดว่า TP1/TP2 ผ่านหรือยัง เพราะ dashboard มีติ๊ก ✓ ที่แถว TP1/TP2 โชว์อยู่แล้ว
   // (ผู้ใช้ขอตัด 2026-09-22 รอบ 2 — กันข้อความยาวเกินจำเป็น)
   if(stateLoaded)
      gLastEvent = StringFormat("กลับมาดูแลไม้แล้ว: %s %s", PL_DirStr(gMtDir), DoubleToString(entry, _Digits));
   else
      gLastEvent = StringFormat("เข้าไม้ (ซิงก์จากไม้เดิม): %s %s", PL_DirStr(gMtDir), DoubleToString(entry, _Digits));
   gLastEventTime = openTime;
   Print(gLastEvent); // ให้เห็นใน Experts/Journal log ด้วย ไม่ใช่แค่บน dashboard

   return true;
}

//+------------------------------------------------------------------+
//| เก็บสถานะ TP1/TP2/BE ของไม้ปัจจุบันลงไฟล์ (คีย์ด้วย magic+symbol เดียวกับ|
//| PL_Select — 1 EA/สัญลักษณ์ถือได้ไม้เดียวอยู่แล้ว) แก้บั๊ก 2026-09-22:    |
//| ก่อนหน้านี้ PL_SyncOpenPosition "เดา" ว่าไม้ที่เปิดอยู่ตอน reattack ผ่าน |
//| TP1/TP2 ไปแล้วเสมอ (กันปิด partial ซ้ำผิดจำนวน) แต่ถ้าไม้ยังไม่ผ่าน     |
//| TP1/TP2 เลยจริงๆ การเดานี้ทำให้ partial-close หยุดทำงานทั้งที่ควรทำต่อ  |
//| — เขียนไฟล์ทุกครั้งที่เปิดไม้ใหม่/สถานะ TP1/TP2/BE เปลี่ยน อ่านกลับใน   |
//| PL_SyncOpenPosition ถ้า posId ในไฟล์ตรงกับไม้จริงที่เจอ ถือว่าเชื่อถือได้|
//| ไฟล์ไม่ใช้ FILE_COMMON (ต่างจาก DiscordNotify) เพราะสถานะนี้ผูกกับ     |
//| บัญชี/เทอร์มินัลนี้เท่านั้น ไม่ควรแชร์ข้าม terminal เหมือน token       |
//+------------------------------------------------------------------+
string PL_StateFile(const long magic)
{
   return "PL_state_" + IntegerToString(magic) + "_" + _Symbol + ".bin";
}

void PL_SaveState(const long magic)
{
   int h = FileOpen(PL_StateFile(magic), FILE_WRITE | FILE_BIN);
   if(h == INVALID_HANDLE) return;
   FileWriteLong(h, (long)gMtPosId);
   FileWriteDouble(h, gMtSlInit);
   FileWriteDouble(h, gMtTp1);
   FileWriteDouble(h, gMtTp2);
   FileWriteDouble(h, gMtTp3);
   FileWriteDouble(h, gMtPartVol);
   FileWriteInteger(h, gMtHitTp1 ? 1 : 0);
   FileWriteInteger(h, gMtHitTp2 ? 1 : 0);
   FileWriteInteger(h, gMtBeDone ? 1 : 0);
   FileClose(h);
}

void PL_DeleteState(const long magic)
{
   string fn = PL_StateFile(magic);
   if(FileIsExist(fn))
      FileDelete(fn);
}

// คืน true เฉพาะเมื่อไฟล์มีอยู่จริงและ posId ในไฟล์ตรงกับไม้จริงที่กำลัง sync (posId ต่างกัน =
// ไฟล์เก่าของไม้ก่อนหน้าที่ปิดไปแล้วแต่ลบไฟล์ไม่ทัน เช่น EA ถูกปิดกลางคันตอนไม้เพิ่งปิด) ไม่ถือว่าเชื่อถือได้
bool PL_LoadState(const long magic, const ulong posId)
{
   string fn = PL_StateFile(magic);
   if(!FileIsExist(fn)) return false;
   int h = FileOpen(fn, FILE_READ | FILE_BIN);
   if(h == INVALID_HANDLE) return false;

   ulong  savedPosId = (ulong)FileReadLong(h);
   double slInit     = FileReadDouble(h);
   double tp1        = FileReadDouble(h);
   double tp2        = FileReadDouble(h);
   double tp3        = FileReadDouble(h);
   double partVol    = FileReadDouble(h);
   int    hit1       = FileReadInteger(h);
   int    hit2       = FileReadInteger(h);
   int    be         = FileReadInteger(h);
   FileClose(h);

   if(savedPosId != posId) return false;

   gMtSlInit  = slInit;
   gMtTp1     = tp1;
   gMtTp2     = tp2;
   gMtTp3     = tp3;
   gMtPartVol = partVol;
   gMtHitTp1  = (hit1 != 0);
   gMtHitTp2  = (hit2 != 0);
   gMtBeDone  = (be != 0);
   return true;
}

//+------------------------------------------------------------------+
//| เสี่ยงเหลือเท่าไหร่ถ้าราคาย้อนกลับไปโดน SL ปัจจุบัน — ใช้ lot ที่เหลือจริง   |
//| (หลัง partial close) คูณระยะจาก entry ถึง SL ปัจจุบัน (หลัง BE/trail)    |
//| ต่างจากทุนเสี่ยงตั้งต้นตอนเปิดไม้ (riskUsd ที่ส่งเข้า PL_Open) ซึ่งใช้ทำ    |
//| R-multiple ของ self-learning (SATS) ต่อ ไม่ควรเปลี่ยนตามการปิดบางส่วน   |
//| ฟังก์ชันนี้จึงแยกไว้เฉพาะโชว์ dashboard เท่านั้น (ผู้ใช้ขอ 2026-09-22)     |
//+------------------------------------------------------------------+
double PL_RiskRemaining(const double pointUnit)
{
   if(pointUnit <= 0) return 0;
   return gMtLot * (MathAbs(gMtEntry - gMtSlCurrent) / pointUnit);
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
             const bool showChart = false, const bool useBe = false)
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
      // แก้บั๊ก 2026-09-22 (ดู bugs.md): เดิมเขียนลง gLastProblem ซึ่งเป็น "สถานะ" ที่ dashboard
      // โชว์ทับ statusText ทุกครั้งจนกว่าจะมีใครเคลียร์ทิ้ง — แต่เหตุการณ์นี้เกิดครั้งเดียวจบ (เช่น
      // ผู้ใช้ปิด Algo Trading เองชั่วคราวตอน EA ดันสั่งเข้าไม้พอดี) ไม่ใช่ปัญหาค้างแบบเน็ตหลุด ไม่มี
      // จุดไหนเคลียร์ gLastProblem คืนเลย ทำให้ dashboard ค้างข้อความนี้ตลอดไปแม้ปัญหาจะหายแล้วจริง —
      // ย้ายไปโชว์ที่ "เหตุการณ์ล่าสุด" แทน (gLastEvent) ซึ่งจะถูกแทนที่เองโดยธรรมชาติทันทีที่มี
      // เหตุการณ์ถัดไปเกิดขึ้น (เข้าไม้สำเร็จ/ปิดไม้/sync ฯลฯ) ไม่ต้องหาจุดเคลียร์เพิ่มเลย
      PL_SetLastEvent("⚠️ เข้าไม้ไม่สำเร็จ: " + PL_DirStr(dir) + " ที่ " + DoubleToString(entry, _Digits));
      string failReason = gTrade.ResultRetcodeDescription();
      PrintFormat("⚠️ เข้าไม้ไม่สำเร็จ: %s ที่ %s — broker ปฏิเสธ (%s)",
                  PL_DirStr(dir), DoubleToString(entry, _Digits), failReason);
      DC_NotifyProblem(_Symbol, StringFormat("เข้าไม้ไม่สำเร็จ: %s ที่ %s\nเหตุผล: %s",
                       PL_DirStr(dir), DoubleToString(entry, _Digits), failReason));
      return false;
   }

   ulong ticket = 0;
   gMtPosId = PL_Select(magic, ticket) ? (ulong)PositionGetInteger(POSITION_IDENTIFIER) : 0;

   gMtDir     = dir;
   gMtEntry   = entry;
   gMtSlInit  = slAdj;
   gMtSlCurrent = slAdj;
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
   PL_SaveState(magic);

   if(showChart)
      PL_DrawTrade(PL_ChartPrefix(magic), dir, entry, slAdj, tp1Adj, tp2Adj, tp3Adj,
                   usePartials || useBe);

   // จุดเดียวที่แจ้งเข้าไม้ — ครอบคลุมทั้งเข้าไม้สด (cmt="SATS") และเข้าไม้ย้อนหลัง
   // (cmt="SATS-catchup") เพราะทั้งสองทางเรียก PL_Open() นี้เหมือนกัน ไม่ต้องแยกจุดเรียก
   DC_NotifyEntry(_Symbol, dir, entry, slAdj, tp3Adj, lot, riskUsd, AccountInfoString(ACCOUNT_CURRENCY),
                  AccountInfoDouble(ACCOUNT_BALANCE), StringFind(cmt, "catchup") >= 0);

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
      PL_DeleteState(magic); // ไม้ปิดแล้ว ไม่ต้องเก็บสถานะ TP1/TP2/BE ของไม้นี้ต่อ
   }
   else
   {
      // เหตุผลเดียวกับ "เข้าไม้ไม่สำเร็จ" ข้างบน — ย้ายจาก gLastProblem (ค้างตลอดไป) มาเป็น
      // gLastEvent (ถูกแทนที่เองโดยธรรมชาติ) แก้บั๊ก 2026-09-22
      PL_SetLastEvent(StringFormat("⚠️ ปิดไม้ไม่สำเร็จ: %s (เข้าที่ %s)", PL_DirStr(gMtDir), DoubleToString(gMtEntry, _Digits)));
      string failReason = gTrade.ResultRetcodeDescription();
      PrintFormat("⚠️ ปิดไม้ไม่สำเร็จ: ticket #%s — broker ปฏิเสธ (%s)",
                  IntegerToString(ticket), failReason);
      // ไม้ยังเปิดอยู่ (ปิดไม่สำเร็จ) — gMtDir/gMtEntry ยังไม่ถูกรีเซ็ต ใช้บอกทิศทาง/ราคาเข้าแทน
      // ticket number เปล่าๆ ที่อ่านไม่รู้เรื่อง
      DC_NotifyProblem(_Symbol, StringFormat("ปิดไม้ไม่สำเร็จ: %s (เข้าที่ %s)\nเหตุผล: %s",
                       PL_DirStr(gMtDir), DoubleToString(gMtEntry, _Digits), failReason));
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
   // กำไร/ขาดทุนรวม "ทุกดีลที่ออก" ของไม้นี้ ไม่ใช่แค่ดีลสุดท้าย — สำคัญเวลาเปิด partial close
   // (usePartials) เพราะดีลสุดท้ายมีแค่ 1/3 lot ที่เหลือ ไม่ใช่กำไรรวมทั้งไม้
   double totalProfit = 0;
   int deals = HistoryDealsTotal();
   for(int i = 0; i < deals; i++)
   {
      ulong d = HistoryDealGetTicket(i);
      if(d == 0) continue;
      long entry = HistoryDealGetInteger(d, DEAL_ENTRY);
      if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_OUT_BY) continue;
      totalProfit += HistoryDealGetDouble(d, DEAL_PROFIT)
                   + HistoryDealGetDouble(d, DEAL_SWAP)
                   + HistoryDealGetDouble(d, DEAL_COMMISSION);
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
      DC_NotifyClose(_Symbol, StringFormat("TP ที่ %s", DoubleToString(lastPrice, _Digits)),
                     totalProfit, AccountInfoString(ACCOUNT_CURRENCY));
   }
   else if(lastReason == DEAL_REASON_SL)
   {
      gPlClosedSl++;
      PL_SetLastEvent(StringFormat("ไม้ปิดแล้ว: SL ที่ %s", DoubleToString(lastPrice, _Digits)));
      Print(gLastEvent);
      DC_NotifyClose(_Symbol, StringFormat("SL ที่ %s", DoubleToString(lastPrice, _Digits)),
                     totalProfit, AccountInfoString(ACCOUNT_CURRENCY));
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
      gMtSlCurrent = sl;
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
         PL_DeleteState(magic); // ไม้ปิดเองจาก broker (SL/TP) — ไม่ต้องเก็บสถานะไม้นี้ต่อ
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
         {
            if(gTrade.PositionClosePartial(ticket, gMtPartVol))
            {
               DC_NotifyPartial(_Symbol, "TP1", gMtTp1, gMtPartVol);
               // อัปเดต lot ที่เหลือจริงหลังปิดบางส่วน — เดิม gMtLot ค้างเป็น lot เต็มตอนเปิดไม้
               // ตลอดไป ทำให้ dashboard โชว์ "SL / Lot" ผิดหลัง TP1/TP2 (บั๊ก 2026-09-22)
               if(PositionSelectByTicket(ticket))
                  gMtLot = PositionGetDouble(POSITION_VOLUME);
            }
         }
      }
      if(useBe && !gMtBeDone)
      {
         // gMtEntry เป็นราคาที่เปิดไม้จริง (Bid สำหรับ SELL) ไม่ได้ชดเชย spread ไว้
         // ต่างจาก gMtTp1/Tp2 ที่ชดเชยแล้วตั้งแต่ PL_Open — ต้องบวกเองตรงนี้
         double beSpread = isLong ? 0.0 : SymbolInfoDouble(_Symbol, SYMBOL_ASK) - SymbolInfoDouble(_Symbol, SYMBOL_BID);
         if(PL_MoveSl(ticket, gMtEntry + beSpread))
         {
            gMtBeDone = true;
            DC_NotifyBreakeven(_Symbol, gMtEntry + beSpread);
         }
      }
      PL_SaveState(magic); // เก็บสถานะทันทีที่ TP1/BE เปลี่ยน กันรีสตาร์ทกลางไม้แล้วเดาผิด (บั๊ก 2026-09-22)
   }

   if(reach2 && !gMtHitTp2)
   {
      gMtHitTp2 = true;
      if(usePartials && gMtPartVol > 0 && PositionSelectByTicket(ticket))
      {
         double vol = PositionGetDouble(POSITION_VOLUME);
         if(vol - gMtPartVol >= SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN))
         {
            if(gTrade.PositionClosePartial(ticket, gMtPartVol))
            {
               DC_NotifyPartial(_Symbol, "TP2", gMtTp2, gMtPartVol);
               if(PositionSelectByTicket(ticket))
                  gMtLot = PositionGetDouble(POSITION_VOLUME);
            }
         }
      }
      if(trailAfterTp2)
         PL_MoveSl(ticket, gMtTp1);
      PL_SaveState(magic); // เก็บสถานะทันทีที่ TP2 เปลี่ยน (เหตุผลเดียวกับ TP1 ด้านบน)
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
