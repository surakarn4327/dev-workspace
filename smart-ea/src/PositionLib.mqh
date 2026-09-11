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

// ── สถานะไม้ที่ถืออยู่ (EA ทุกตัวในชุดนี้ถือได้ไม้เดียว) ──
int    gMtDir     = 0;     // 1 = long, -1 = short, 0 = ไม่มีไม้
ulong  gMtPosId   = 0;     // position identifier ของไม้ที่เปิดอยู่
double gMtEntry   = 0;
double gMtSlInit  = 0;     // SL ตอนเปิด (ใช้คำนวณ R ไม่ใช่ SL ปัจจุบัน)
double gMtTp1     = 0;
double gMtTp2     = 0;
double gMtTp3     = 0;
double gMtPartVol = 0;     // ปริมาณที่ปิดต่อ 1 ขั้น = 1/3 ของไม้เต็ม
bool   gMtHitTp1  = false;
bool   gMtHitTp2  = false;
bool   gMtBeDone  = false;
int    gMtOpenBar = 0;

// ตัวนับ diagnostic — ตามกฎโปรเจกต์ ห้ามเดาสาเหตุเวลาผลผิดคาด
int gPlOpenFail = 0, gPlNoRisk = 0, gPlLotTooSmall = 0, gPlNoPartial = 0;
int gPlOpened = 0, gPlClosedSl = 0, gPlClosedTp = 0, gPlClosedManual = 0;

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
             const bool usePartials, const int barIdx)
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

   double sl = NormalizeDouble(slPrice, _Digits);
   double tp = NormalizeDouble(tp3, _Digits);

   bool ok = isLong ? gTrade.Buy(lot, _Symbol, 0, sl, tp, cmt)
                    : gTrade.Sell(lot, _Symbol, 0, sl, tp, cmt);
   if(!ok)
   {
      gPlOpenFail++;
      return false;
   }

   ulong ticket = 0;
   gMtPosId = PL_Select(magic, ticket) ? (ulong)PositionGetInteger(POSITION_IDENTIFIER) : 0;

   gMtDir     = dir;
   gMtEntry   = entry;
   gMtSlInit  = slPrice;
   gMtTp1     = tp1;
   gMtTp2     = tp2;
   gMtTp3     = tp3;
   gMtHitTp1  = false;
   gMtHitTp2  = false;
   gMtBeDone  = false;
   gMtOpenBar = barIdx;
   gMtPartVol = usePartials ? PL_NormVol(lot / 3.0) : 0.0;
   if(usePartials && gMtPartVol <= 0)
      gPlNoPartial++;
   gPlOpened++;
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
   if(lastReason == DEAL_REASON_TP)      gPlClosedTp++;
   else if(lastReason == DEAL_REASON_SL) gPlClosedSl++;
   gMtPosId = 0;
}

//+------------------------------------------------------------------+
//| เลื่อน SL ของไม้ที่เปิดอยู่ (TP เดิมคงไว้)                             |
//+------------------------------------------------------------------+
bool PL_MoveSl(const ulong ticket, const double newSl)
{
   if(!PositionSelectByTicket(ticket)) return false;
   double curSl = PositionGetDouble(POSITION_SL);
   double curTp = PositionGetDouble(POSITION_TP);
   double sl    = NormalizeDouble(newSl, _Digits);
   if(MathAbs(curSl - sl) < SymbolInfoDouble(_Symbol, SYMBOL_POINT)) return false;
   return gTrade.PositionModify(ticket, sl, curTp);
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
         PL_ClassifyClosed();
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
         if(PL_MoveSl(ticket, gMtEntry))
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
