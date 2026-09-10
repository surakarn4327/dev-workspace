//+------------------------------------------------------------------+
//| MARibbonCore.mqh                                                   |
//| ตรรกะทั้งหมดของ MA Ribbon EA — สัญญาณ การเข้าออก การวาดบนชาร์ต      |
//|                                                                    |
//| ไฟล์นี้ไม่ประกาศ input เอง แต่อ้างถึงตัวแปร input ที่ EA ประกาศไว้    |
//| ก่อน include จึงมี EA หลายตัวใช้ตรรกะชุดเดียวกันโดยตั้งค่า default   |
//| ต่างกันได้ แก้บั๊กที่นี่ที่เดียว ทุกตัวได้รับผลพร้อมกัน                |
//|                                                                    |
//| ใช้คู่กับ MARibbonTypes.mqh ซึ่งต้อง include ก่อนบล็อก input        |
//+------------------------------------------------------------------+
#include <Trade\Trade.mqh>
#include "TesterMetrics.mqh"

const int SHORT_COUNT = 6;
const int LONG_COUNT  = 7;

int hShort[6];
int hLong[7];
int hATR = INVALID_HANDLE;
int hVisual = INVALID_HANDLE;

// คาบจริงหลังบวก InpRibbonShift แล้ว — ใช้ส่งต่อให้อินดิเคเตอร์วาดเส้นชุดเดียวกัน
int gSP[6];
int gLP[7];

CTrade   trade;
datetime gLastBarTime = 0;

// วาดของบนชาร์ตเฉพาะตอนที่มีคนดูจริง — ใน tester โหมดไม่ visual การสร้าง object
// ทุกไม้ทำให้ backtest ช้าลงหลายเท่าโดยไม่มีใครเห็น
bool   gDraw = false;
string gPfx  = "MARib_";

// สถานะไม้ที่เปิดอยู่ (EA นี้ถือได้ไม้เดียว)
int    gDir        = 0;   // 1 = long, -1 = short, 0 = ไม่มีไม้
double gEntry      = 0;
double gSL         = 0;   // SL เดิม (ก่อนเลื่อน BE)
double gTP1        = 0;
double gTP2        = 0;
double gTP3        = 0;
double gRisk       = 0;   // |Entry - SL| หน่วยราคา
double gInitVolume = 0;
double gPartVolume = 0;   // ปริมาณต่อไม้ย่อยในโหมด partial
bool   gGot1       = false;
bool   gGot2       = false;
bool   gBEArmed    = false;

// โหมดทบกำไร: ไม้ที่กิน TP เต็ม จะส่งกำไรไปเพิ่มทุนเสี่ยงให้ไม้ถัดไป "ไม้เดียว"
// แล้วกลับมาใช้ทุนฐานเสมอ ไม่ว่าไม้ที่ทบไปจะจบยังไง
bool   gParlayArmed   = false; // ไม้ถัดไปใช้ทุนบูสต์
double gParlayBonus   = 0;     // กำไรที่ยกยอดมา (USD)
bool   gTradeBoosted  = false; // ไม้ที่เปิดอยู่ตอนนี้ใช้ทุนบูสต์อยู่
long   gPosTicket     = 0;     // position id ของไม้ที่เปิดอยู่ ใช้ตามหาผลตอนปิด
double gRiskUsed      = 0;     // ทุนเสี่ยงที่ใช้จริงในไม้ที่เปิดอยู่

// ตัวนับ diagnostic — ตามกฎโปรเจกต์: ห้ามเดาสาเหตุ ให้ข้อมูลบอกเอง
int gCnt_Cross=0, gCnt_LotTooSmall=0, gCnt_NoRisk=0, gCnt_OpenFail=0, gCnt_Entered=0;
int gCnt_ReverseClose=0, gCnt_BEMoved=0, gCnt_Part1=0, gCnt_Part2=0, gCnt_PartFail=0;
int gCnt_Parlay=0, gCnt_ParlayNoMargin=0, gCnt_ParlayWin=0;

//+------------------------------------------------------------------+
int OnInit()
{
   int sp[6]; sp[0]=InpS1; sp[1]=InpS2; sp[2]=InpS3; sp[3]=InpS4; sp[4]=InpS5; sp[5]=InpS6;
   int lp[7]; lp[0]=InpL1; lp[1]=InpL2; lp[2]=InpL3; lp[3]=InpL4; lp[4]=InpL5; lp[5]=InpL6; lp[6]=InpL7;

   // เลื่อนคาบทั้งชุดเท่ากันด้วยตัวเลขเดียว ระยะห่างระหว่างเส้นคงเดิม
   // (สั้นห่าง 3 ยาวห่าง 5) — จูนตัวเดียวแทนที่จะไล่ทีละ 13 เส้น
   // ซึ่งเป็นล้านชุดและได้ค่าที่พอดีกับอดีตจนใช้จริงไม่ได้
   for(int i = 0; i < SHORT_COUNT; i++)
   {
      sp[i] += InpRibbonShift;
      if(sp[i] < 1)
         sp[i] = 1;
   }
   for(int i = 0; i < LONG_COUNT; i++)
   {
      lp[i] += InpRibbonShift;
      if(lp[i] < 1)
         lp[i] = 1;
   }
   ArrayCopy(gSP, sp);
   ArrayCopy(gLP, lp);

   for(int i = 0; i < SHORT_COUNT; i++)
   {
      hShort[i] = iMA(_Symbol, PERIOD_CURRENT, sp[i], 0, InpMAMethod, PRICE_CLOSE);
      if(hShort[i] == INVALID_HANDLE)
      {
         Print("iMA (short cluster) handle failed, period ", sp[i]);
         return INIT_FAILED;
      }
   }
   for(int i = 0; i < LONG_COUNT; i++)
   {
      hLong[i] = iMA(_Symbol, PERIOD_CURRENT, lp[i], 0, InpMAMethod, PRICE_CLOSE);
      if(hLong[i] == INVALID_HANDLE)
      {
         Print("iMA (long cluster) handle failed, period ", lp[i]);
         return INIT_FAILED;
      }
   }

   hATR = iATR(_Symbol, PERIOD_CURRENT, InpAtrPeriod);
   if(hATR == INVALID_HANDLE)
   {
      Print("iATR handle failed");
      return INIT_FAILED;
   }

   trade.SetExpertMagicNumber(InpMagic);
   trade.SetTypeFillingBySymbol(_Symbol);
   trade.SetMarginMode();

   bool visible = !MQLInfoInteger(MQL_TESTER) || MQLInfoInteger(MQL_VISUAL_MODE);
   gDraw = InpShowVisuals && visible;

   if(gDraw)
   {
      // เส้นที่ EA ใช้ตัดสินใจจริงคือค่าเฉลี่ย 2 กลุ่ม ซึ่งไม่มีบนชาร์ต
      // ต้องยืมอินดิเคเตอร์มาวาด (EA พล็อตบัฟเฟอร์เองไม่ได้)
      hVisual = iCustom(_Symbol, PERIOD_CURRENT, "MARibbonVisual",
                        InpMAMethod,
                        gSP[0], gSP[1], gSP[2], gSP[3], gSP[4], gSP[5],
                        gLP[0], gLP[1], gLP[2], gLP[3], gLP[4], gLP[5], gLP[6]);
      if(hVisual == INVALID_HANDLE)
         Print("MARibbonVisual not found — copy it into MQL5\\Indicators\\ then recompile");
      else if(!ChartIndicatorAdd(0, 0, hVisual))
         Print("ChartIndicatorAdd failed: ", GetLastError());
   }

   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   if(gDraw)
   {
      ObjectsDeleteAll(0, gPfx);
      if(hVisual != INVALID_HANDLE)
      {
         ChartIndicatorDelete(0, 0, "MA Ribbon (EA view)");
         IndicatorRelease(hVisual);
      }
   }

   PrintFormat("diag: cross=%d entered=%d lotTooSmall=%d noRisk=%d openFail=%d reverseClose=%d beMoved=%d part1=%d part2=%d partFail=%d",
               gCnt_Cross, gCnt_Entered, gCnt_LotTooSmall, gCnt_NoRisk, gCnt_OpenFail,
               gCnt_ReverseClose, gCnt_BEMoved, gCnt_Part1, gCnt_Part2, gCnt_PartFail);
   if(InpUseParlay)
      PrintFormat("diag parlay: boosted=%d boostedWin=%d noMargin=%d",
                  gCnt_Parlay, gCnt_ParlayWin, gCnt_ParlayNoMargin);
}

//+------------------------------------------------------------------+
//| ค่าเฉลี่ยของกลุ่มเส้น ณ แท่งที่ shift (1 = แท่งปิดล่าสุด)             |
//+------------------------------------------------------------------+
bool ClusterAvg(const int &handles[], const int count, const int shift, double &out)
{
   double sum = 0;
   double buf[];
   for(int i = 0; i < count; i++)
   {
      if(CopyBuffer(handles[i], 0, shift, 1, buf) < 1)
         return false;
      sum += buf[0];
   }
   out = sum / count;
   return true;
}

//+------------------------------------------------------------------+
//| สถานะไม้จริงใน terminal — เรียกทุก tick ก่อนตัดสินใจ                |
//+------------------------------------------------------------------+
bool HasPosition()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0)
         continue;
      if(PositionGetString(POSITION_SYMBOL) == _Symbol &&
         PositionGetInteger(POSITION_MAGIC) == InpMagic)
         return true;
   }
   return false;
}

bool SelectPosition(ulong &ticket)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(t == 0)
         continue;
      if(PositionGetString(POSITION_SYMBOL) == _Symbol &&
         PositionGetInteger(POSITION_MAGIC) == InpMagic)
      {
         ticket = t;
         return true;
      }
   }
   return false;
}

//+------------------------------------------------------------------+
double NormalizeVolume(double vol)
{
   double vmin  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double vmax  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double vstep = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   if(vstep <= 0)
      vstep = 0.01;
   vol = MathFloor(vol / vstep) * vstep;
   if(vol < vmin)
      return 0;                  // เล็กกว่าที่ broker รับ = ไม่เข้าไม้ ดีกว่าเสี่ยงเกินที่ตั้งไว้
   if(vol > vmax)
      vol = vmax;
   return NormalizeDouble(vol, 2);
}

//+------------------------------------------------------------------+
//| SL ตามสูตรเดียวกับ Pine: ATR x ตัวคูณ หรือ swing + ระยะเผื่อ        |
//+------------------------------------------------------------------+
bool CalcSL(const bool isLong, const double entry, double &slOut)
{
   double buffer = InpSLBufferPoints * _Point;
   double raw = 0;

   if(InpUseAtrSL)
   {
      double atr[];
      if(CopyBuffer(hATR, 0, 1, 1, atr) < 1)
         return false;
      raw = isLong ? entry - atr[0] * InpAtrMult : entry + atr[0] * InpAtrMult;
   }
   else
   {
      int idx = isLong ? iLowest(_Symbol, PERIOD_CURRENT, MODE_LOW, InpSwingBars, 1)
                       : iHighest(_Symbol, PERIOD_CURRENT, MODE_HIGH, InpSwingBars, 1);
      if(idx < 0)
         return false;
      raw = isLong ? iLow(_Symbol, PERIOD_CURRENT, idx) : iHigh(_Symbol, PERIOD_CURRENT, idx);
   }

   slOut = isLong ? raw - buffer : raw + buffer;
   return true;
}

//+------------------------------------------------------------------+
//| ปิดบัญชีไม้ที่เพิ่งจบ แล้วตัดสินว่าไม้ถัดไปได้ทบกำไรหรือไม่           |
//|                                                                    |
//| "ชนะ" = ดีลปิดตัวสุดท้ายมีเหตุผล DEAL_REASON_TP เท่านั้น (ผู้ใช้เลือก |
//| ข้อ ข.) — ปิดตามสัญญาณ / โดน SL / โดน BE ไม่นับ แม้ BE จะได้ 0 พอดี  |
//| ยอดที่ยกไปคือกำไรสุทธิจริงของไม้นั้น รวม swap และค่าคอมแล้ว           |
//+------------------------------------------------------------------+
void SettleClosedTrade()
{
   if(gPosTicket == 0)
      return;

   // ประวัติอาจยังไม่ทันเข้ามาใน tick นี้ ถ้าเลือกไม่ได้ให้เก็บ ticket ไว้ลองใหม่
   if(!HistorySelectByPosition(gPosTicket))
      return;

   double  profit     = 0;
   long    lastReason = -1;
   datetime lastTime  = 0;

   int deals = HistoryDealsTotal();
   for(int i = 0; i < deals; i++)
   {
      ulong d = HistoryDealGetTicket(i);
      if(d == 0)
         continue;

      profit += HistoryDealGetDouble(d, DEAL_PROFIT)
              + HistoryDealGetDouble(d, DEAL_SWAP)
              + HistoryDealGetDouble(d, DEAL_COMMISSION);

      long entry = HistoryDealGetInteger(d, DEAL_ENTRY);
      if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_OUT_BY)
         continue;

      datetime t = (datetime)HistoryDealGetInteger(d, DEAL_TIME);
      if(t >= lastTime)
      {
         lastTime   = t;
         lastReason = HistoryDealGetInteger(d, DEAL_REASON);
      }
   }

   bool wonByTP = (lastReason == DEAL_REASON_TP) && profit > 0;

   if(gTradeBoosted)
   {
      // ไม้ที่ทบไปแล้วจบ กลับไปทุนฐานเสมอ ไม่ว่าจะชนะหรือแพ้
      if(wonByTP)
         gCnt_ParlayWin++;
      gParlayArmed = false;
      gParlayBonus = 0;
   }
   else if(InpUseParlay && wonByTP)
   {
      gParlayArmed = true;
      gParlayBonus = profit;
   }
   else
   {
      gParlayArmed = false;
      gParlayBonus = 0;
   }

   gTradeBoosted = false;
   gPosTicket    = 0;
   gRiskUsed     = 0;
}

//+------------------------------------------------------------------+
//| การวาดบนชาร์ต — เลียนแบบหน้าตาของ Pine                             |
//+------------------------------------------------------------------+
void DrawRay(const string tag, const double price, const color col, const string label)
{
   string name = gPfx + tag;
   datetime t1 = iTime(_Symbol, PERIOD_CURRENT, 0);

   if(ObjectFind(0, name) < 0)
   {
      // เส้นแนวนอนยิงไปทางขวาไม่รู้จบ เหมือน extend.right ของ Pine
      ObjectCreate(0, name, OBJ_TREND, 0, t1, price, t1 + PeriodSeconds(), price);
      ObjectSetInteger(0, name, OBJPROP_RAY_RIGHT, true);
      ObjectSetInteger(0, name, OBJPROP_STYLE, STYLE_DASH);
      ObjectSetInteger(0, name, OBJPROP_WIDTH, 1);
      ObjectSetInteger(0, name, OBJPROP_BACK, true);
      ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
      ObjectSetString(0, name, OBJPROP_TEXT, label);
   }
   ObjectSetInteger(0, name, OBJPROP_COLOR, col);
   ObjectSetDouble(0, name, OBJPROP_PRICE, 0, price);
   ObjectSetDouble(0, name, OBJPROP_PRICE, 1, price);
}

void DeleteLevels()
{
   if(!gDraw)
      return;
   string tags[5] = {"entry", "sl", "tp1", "tp2", "tp3"};
   for(int i = 0; i < 5; i++)
      ObjectDelete(0, gPfx + tags[i]);
}

void DrawLevels()
{
   if(!gDraw)
      return;
   DrawRay("entry", gEntry, InpColEntry, "Entry");
   DrawRay("sl",    gSL,    InpColSL,    "SL");
   if(InpTPMode != TP_NONE)
   {
      DrawRay("tp1", gTP1, InpColTP1, "TP1");
      DrawRay("tp2", gTP2, InpColTP2, "TP2");
      DrawRay("tp3", gTP3, InpColTP3, "TP3");
   }
}

void DrawEntryArrow()
{
   if(!gDraw)
      return;
   datetime t = TimeCurrent();
   string name = StringFormat("%sarrow_%d", gPfx, (int)t);
   bool isLong = gDir == 1;
   if(!ObjectCreate(0, name, isLong ? OBJ_ARROW_BUY : OBJ_ARROW_SELL, 0, t, gEntry))
      return;
   ObjectSetInteger(0, name, OBJPROP_COLOR, isLong ? clrLime : clrRed);
   ObjectSetInteger(0, name, OBJPROP_WIDTH, 2);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
}

const int PANEL_ROWS   = 8;
const int PANEL_W      = 266; // ความกว้างกรอบ (พิกเซล)
const int PANEL_RH     = 17;  // ความสูงต่อแถว
const int PANEL_MARGIN = 10;  // ระยะห่างจากขอบจอ

// มุมล่างของ MT5 คิดระยะกลับทิศ และ OBJ_RECTANGLE_LABEL กับ OBJ_LABEL ตีความ
// จุดยึดไม่เหมือนกัน วางผิดตำแหน่งได้ง่าย จึงยึด CORNER_LEFT_UPPER อย่างเดียว
// แล้วคำนวณพิกัดจริงจากขนาดชาร์ตเอง — ได้ผลเหมือนกันทุกมุม ไม่ต้องเดา
int gPanelX = 0;
int gPanelY = 0;

int PanelHeight()
{
   return PANEL_ROWS * PANEL_RH + 6;
}

void PanelOrigin()
{
   int cw = (int)ChartGetInteger(0, CHART_WIDTH_IN_PIXELS);
   int ch = (int)ChartGetInteger(0, CHART_HEIGHT_IN_PIXELS);
   bool right = InpPanelPos == PANEL_TOP_RIGHT || InpPanelPos == PANEL_BOTTOM_RIGHT;
   bool lower = InpPanelPos == PANEL_BOTTOM_LEFT || InpPanelPos == PANEL_BOTTOM_RIGHT;

   gPanelX = right ? cw - PANEL_W - PANEL_MARGIN : PANEL_MARGIN;
   gPanelY = lower ? ch - PanelHeight() - PANEL_MARGIN : PANEL_MARGIN;

   if(gPanelX < 0) gPanelX = 0;
   if(gPanelY < 0) gPanelY = 0;
}

//+------------------------------------------------------------------+
//| หนึ่งแถวของพาเนล 3 คอลัมน์: ป้ายชิดซ้าย ราคาและหมายเหตุชิดขวา        |
//| ส่งข้อความว่างมา = ลบช่องนั้นทิ้ง — MT5 วาดคำว่า "Label" ให้เองถ้าตั้ง |
//| OBJPROP_TEXT เป็นค่าว่าง จึงซ่อนด้วยการลบเท่านั้น (ดู bugs.md)        |
//+------------------------------------------------------------------+
void PanelRow(const int row, const string label, const string value,
              const string note, const color col)
{
   string ids[3] = {"a", "b", "c"};
   string texts[3];
   texts[0] = label; texts[1] = value; texts[2] = note;
   int offs[3]    = {6, 168, 258}; // ตำแหน่งภายในกรอบ วัดจากขอบซ้ายกรอบ
   int anchors[3] = {ANCHOR_LEFT_UPPER, ANCHOR_RIGHT_UPPER, ANCHOR_RIGHT_UPPER};

   for(int c = 0; c < 3; c++)
   {
      string name = StringFormat("%spnl_%d%s", gPfx, row, ids[c]);

      if(texts[c] == "")
      {
         ObjectDelete(0, name);
         continue;
      }

      if(ObjectFind(0, name) < 0)
      {
         ObjectCreate(0, name, OBJ_LABEL, 0, 0, 0);
         ObjectSetInteger(0, name, OBJPROP_CORNER, CORNER_LEFT_UPPER);
         ObjectSetInteger(0, name, OBJPROP_ANCHOR, anchors[c]);
         ObjectSetInteger(0, name, OBJPROP_FONTSIZE, InpPanelSize);
         ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
         ObjectSetString(0, name, OBJPROP_FONT, "Tahoma");
      }
      // ตั้งพิกัดทุกครั้ง ไม่ใช่แค่ตอนสร้าง เผื่อผู้ใช้ย่อ/ขยายหน้าต่าง
      ObjectSetInteger(0, name, OBJPROP_XDISTANCE, gPanelX + offs[c]);
      ObjectSetInteger(0, name, OBJPROP_YDISTANCE, gPanelY + 4 + row * PANEL_RH);
      ObjectSetInteger(0, name, OBJPROP_COLOR, col);
      ObjectSetString(0, name, OBJPROP_TEXT, texts[c]);
   }
}

//+------------------------------------------------------------------+
//| กรอบพื้นหลัง + แถบหัวตารางสีน้ำเงิน เลียนแบบ table ของ Pine          |
//+------------------------------------------------------------------+
void PanelBox(const string tag, const int dx, const int dy,
              const int w, const int h, const color bgCol, const color edge)
{
   string name = gPfx + tag;
   if(ObjectFind(0, name) < 0)
   {
      ObjectCreate(0, name, OBJ_RECTANGLE_LABEL, 0, 0, 0);
      ObjectSetInteger(0, name, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, name, OBJPROP_BORDER_TYPE, BORDER_FLAT);
      ObjectSetInteger(0, name, OBJPROP_BACK, false);
      ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
   }
   ObjectSetInteger(0, name, OBJPROP_XDISTANCE, gPanelX + dx);
   ObjectSetInteger(0, name, OBJPROP_YDISTANCE, gPanelY + dy);
   ObjectSetInteger(0, name, OBJPROP_XSIZE, w);
   ObjectSetInteger(0, name, OBJPROP_YSIZE, h);
   ObjectSetInteger(0, name, OBJPROP_BGCOLOR, bgCol);
   ObjectSetInteger(0, name, OBJPROP_COLOR, edge);
}

void PanelChrome()
{
   PanelBox("pnl_bg",  0, 0, PANEL_W, PanelHeight(), C'20,20,28', C'70,70,90');
   PanelBox("pnl_hdr", 2, 2, PANEL_W - 4, PANEL_RH,  C'25,60,140', C'25,60,140');
}

string ParlayNote(const double riskUsd, const bool boosted)
{
   return StringFormat("%.0f USD%s", riskUsd, boosted ? " (ทบ)" : "");
}

string MoneyAt(const double level, const bool loss)
{
   if(gDir == 0 || gRisk <= 0 || gInitVolume <= 0)
      return "";
   double usd = gInitVolume * MathAbs(level - gEntry) / InpRiskPointUnit;
   return StringFormat("%s%.2f USD", loss ? "-" : "+", usd);
}

//+------------------------------------------------------------------+
//| พาเนลสรุป — ไล่ระดับตามที่วางอยู่บนชาร์ต ราคาสูงอยู่บน                |
//+------------------------------------------------------------------+
void UpdatePanel()
{
   if(!gDraw || !InpShowPanel)
      return;

   PanelOrigin();
   PanelChrome();

   string tf = StringSubstr(EnumToString((ENUM_TIMEFRAMES)Period()), 7); // PERIOD_M5 -> M5
   PanelRow(0, _Symbol + " " + tf, "", "", InpColPanel);

   if(gDir == 0)
   {
      PanelRow(1, "สัญญาณ", "", "ยังไม่เข้า", clrSilver);
      for(int r = 2; r < PANEL_ROWS - 1; r++)
         PanelRow(r, "", "", "", InpColPanel);
      PanelRow(PANEL_ROWS - 1, "ทุนไม้ถัดไป", "",
               ParlayNote(InpUseParlay && gParlayArmed ? InpRiskPerTrade + gParlayBonus
                                                       : InpRiskPerTrade,
                          InpUseParlay && gParlayArmed),
               InpUseParlay && gParlayArmed ? clrGold : clrSilver);
      return;
   }

   double effSL = gBEArmed ? (gDir == 1 ? gEntry + InpBELockPoints * _Point
                                        : gEntry - InpBELockPoints * _Point)
                           : gSL;
   string slLabel = gBEArmed ? "SL -> BE" : "SL";
   color  slCol   = gBEArmed ? clrOrange : InpColSL;

   string sig     = gDir == 1 ? "BUY (เปิดอยู่)" : "SELL (เปิดอยู่)";
   color  sigCol  = gDir == 1 ? clrLime : clrRed;
   string lotNote = StringFormat("%.2f lot", gInitVolume);

   string l1 = StringFormat("TP1 (%.1fR)", InpRR1);
   string l2 = StringFormat("TP2 (%.1fR)", InpRR2);
   string l3 = StringFormat("TP3 (%.1fR)", InpRR3);

   PanelRow(1, "สัญญาณ", "", sig, sigCol);

   if(gDir == -1)
   {
      PanelRow(2, slLabel, DoubleToString(effSL, _Digits), MoneyAt(effSL, !gBEArmed), slCol);
      PanelRow(3, "Entry", DoubleToString(gEntry, _Digits), lotNote, InpColEntry);
      PanelRow(4, l1, DoubleToString(gTP1, _Digits), MoneyAt(gTP1, false), InpColTP1);
      PanelRow(5, l2, DoubleToString(gTP2, _Digits), MoneyAt(gTP2, false), InpColTP2);
      PanelRow(6, l3, DoubleToString(gTP3, _Digits), MoneyAt(gTP3, false), InpColTP3);
   }
   else
   {
      PanelRow(2, l3, DoubleToString(gTP3, _Digits), MoneyAt(gTP3, false), InpColTP3);
      PanelRow(3, l2, DoubleToString(gTP2, _Digits), MoneyAt(gTP2, false), InpColTP2);
      PanelRow(4, l1, DoubleToString(gTP1, _Digits), MoneyAt(gTP1, false), InpColTP1);
      PanelRow(5, "Entry", DoubleToString(gEntry, _Digits), lotNote, InpColEntry);
      PanelRow(6, slLabel, DoubleToString(effSL, _Digits), MoneyAt(effSL, !gBEArmed), slCol);
   }

   PanelRow(PANEL_ROWS - 1, "ทุนไม้นี้", "", ParlayNote(gRiskUsed, gTradeBoosted),
            gTradeBoosted ? clrGold : clrSilver);
}

//+------------------------------------------------------------------+
//| ดูแลไม้ที่เปิดอยู่: BE และการแบ่งปิดที่ TP1/TP2                      |
//+------------------------------------------------------------------+
void ManageOpen()
{
   ulong ticket = 0;
   if(!SelectPosition(ticket))
   {
      if(gDir != 0)
         DeleteLevels(); // ไม้เพิ่งจบด้วย SL/TP ของ broker
      gDir = 0;
      SettleClosedTrade();
      return;
   }
   if(gDir == 0)
      return; // ไม้ที่ไม่ได้เปิดโดยรอบนี้ (เช่น restart) ไม่รู้ระดับ TP ปล่อยให้ SL/TP จริงจัดการ

   double price = gDir == 1 ? SymbolInfoDouble(_Symbol, SYMBOL_BID)
                            : SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   bool reached1 = gDir == 1 ? price >= gTP1 : price <= gTP1;
   bool reached2 = gDir == 1 ? price >= gTP2 : price <= gTP2;

   if(reached1 && !gGot1)
   {
      gGot1 = true;
      if(InpTPMode == TP_PARTIAL && gPartVolume > 0)
      {
         if(trade.PositionClosePartial(ticket, gPartVolume))
            gCnt_Part1++;
         else
            gCnt_PartFail++;
      }
   }
   if(reached2 && !gGot2)
   {
      gGot2 = true;
      if(InpTPMode == TP_PARTIAL && gPartVolume > 0)
      {
         if(!SelectPosition(ticket))
            return;
         double left = PositionGetDouble(POSITION_VOLUME);
         double part = MathMin(gPartVolume, left);
         double vmin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
         if(left - part >= vmin - 1e-8 && part >= vmin - 1e-8)
         {
            if(trade.PositionClosePartial(ticket, part))
               gCnt_Part2++;
            else
               gCnt_PartFail++;
         }
      }
   }

   if(InpUseBE && gGot1 && !gBEArmed)
   {
      if(!SelectPosition(ticket))
         return;
      double lock  = InpBELockPoints * _Point;
      double newSL = gDir == 1 ? gEntry + lock : gEntry - lock;
      double curTP = PositionGetDouble(POSITION_TP);
      if(trade.PositionModify(ticket, NormalizeDouble(newSL, _Digits), curTP))
      {
         gBEArmed = true;
         gCnt_BEMoved++;
         if(gDraw)
            DrawRay("sl", newSL, clrOrange, "SL -> BE");
      }
   }
}

//+------------------------------------------------------------------+
void CloseAll(const string why)
{
   ulong ticket = 0;
   while(SelectPosition(ticket))
   {
      if(!trade.PositionClose(ticket))
         break;
      ticket = 0;
   }
   gDir = 0;
   DeleteLevels();
   SettleClosedTrade(); // ต้องเคลียร์สถานะทบกำไรก่อนเปิดไม้ใหม่ใน tick เดียวกัน
}

//+------------------------------------------------------------------+
void OpenTrade(const bool isLong)
{
   double entry = isLong ? SymbolInfoDouble(_Symbol, SYMBOL_ASK)
                         : SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double sl = 0;
   if(!CalcSL(isLong, entry, sl))
   {
      gCnt_NoRisk++;
      return;
   }

   double risk = MathAbs(entry - sl);
   if(risk <= 0)
   {
      gCnt_NoRisk++;
      return;
   }

   double tp1 = isLong ? entry + risk * InpRR1 : entry - risk * InpRR1;
   double tp2 = isLong ? entry + risk * InpRR2 : entry - risk * InpRR2;
   double tp3 = isLong ? entry + risk * InpRR3 : entry - risk * InpRR3;

   // lot = ทุนเสี่ยง / (ระยะ SL คิดเป็นจุด) — สูตรเดียวกับ Pine/smart-indicator
   double slPoints = risk / InpRiskPointUnit;

   double riskUsd = InpRiskPerTrade;
   bool   boosted = false;
   if(InpUseParlay && gParlayArmed && gParlayBonus > 0)
   {
      riskUsd += gParlayBonus;
      boosted = true;
   }

   double lot = NormalizeVolume(riskUsd / slPoints);
   if(lot <= 0)
   {
      gCnt_LotTooSmall++;
      return;
   }

   // ไม้ที่ทบกำไรใหญ่กว่าปกติหลายเท่า margin อาจไม่พอ เช็คก่อนยิงจริง
   if(boosted)
   {
      double price  = isLong ? SymbolInfoDouble(_Symbol, SYMBOL_ASK)
                             : SymbolInfoDouble(_Symbol, SYMBOL_BID);
      double margin = 0;
      bool   okCalc = OrderCalcMargin(isLong ? ORDER_TYPE_BUY : ORDER_TYPE_SELL,
                                      _Symbol, lot, price, margin);
      double freeMargin = AccountInfoDouble(ACCOUNT_MARGIN_FREE);

      if(!okCalc || margin > freeMargin * 0.9)
      {
         gCnt_ParlayNoMargin++;
         if(!InpParlayFallbackBase)
         {
            gParlayArmed = false;
            gParlayBonus = 0;
            return;
         }
         riskUsd = InpRiskPerTrade;
         boosted = false;
         lot = NormalizeVolume(riskUsd / slPoints);
         if(lot <= 0)
         {
            gCnt_LotTooSmall++;
            return;
         }
      }
   }

   double part = 0;
   if(InpTPMode == TP_PARTIAL)
   {
      double vstep = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
      double vmin  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
      if(vstep <= 0)
         vstep = 0.01;
      part = MathFloor((lot / 3.0) / vstep) * vstep;
      part = NormalizeDouble(part, 2);
      // ต้องเหลือพอให้ปิดได้ 3 ครั้ง ไม่งั้น partial ทำไม่ได้จริง
      if(part < vmin - 1e-8 || lot - 2 * part < vmin - 1e-8)
         part = 0;
   }

   double tpOrder = InpTPMode == TP_NONE ? 0 : tp3;
   bool ok = isLong
      ? trade.Buy(lot, _Symbol, 0, NormalizeDouble(sl, _Digits), NormalizeDouble(tpOrder, _Digits), "MARibbon")
      : trade.Sell(lot, _Symbol, 0, NormalizeDouble(sl, _Digits), NormalizeDouble(tpOrder, _Digits), "MARibbon");

   if(!ok)
   {
      gCnt_OpenFail++;
      PrintFormat("open failed: retcode=%d %s", trade.ResultRetcode(), trade.ResultRetcodeDescription());
      return;
   }

   gDir        = isLong ? 1 : -1;
   gEntry      = trade.ResultPrice() > 0 ? trade.ResultPrice() : entry;
   gSL         = sl;
   gRisk       = risk;
   gTP1        = tp1;
   gTP2        = tp2;
   gTP3        = tp3;
   gInitVolume = lot;
   gPartVolume = part;
   gGot1       = false;
   gGot2       = false;
   gBEArmed    = false;
   gCnt_Entered++;

   gTradeBoosted = boosted;
   gRiskUsed     = riskUsd;
   gParlayArmed  = false; // ยอดที่ยกมาถูกใช้ไปแล้ว ไม้ถัดไปกลับสู่ทุนฐาน
   gParlayBonus  = 0;
   if(boosted)
      gCnt_Parlay++;

   ulong posTicket = 0;
   gPosTicket = SelectPosition(posTicket) ? PositionGetInteger(POSITION_IDENTIFIER) : 0;

   DrawLevels();
   DrawEntryArrow();
}

//+------------------------------------------------------------------+
//| คะแนนที่ optimizer ใช้จัดอันดับ (เลือก "Custom max" ในหน้า Settings) |
//| สูตรและตัวชี้วัดอยู่ใน TesterMetrics.mqh ใช้ร่วมกับกลยุทธ์อื่น         |
//+------------------------------------------------------------------+
double OnTester()
{
   // ชุดที่ TP เรียงผิดลำดับเป็นไปไม่ได้จริง ตัดทิ้งก่อนเสียเวลาประเมิน
   if(InpTPMode == TP_PARTIAL && (InpRR1 >= InpRR2 || InpRR2 >= InpRR3))
      return 0.0;
   if(InpTPMode == TP_FINAL_ONLY && InpRR1 >= InpRR3)
      return 0.0;

   double score = ConsistencyScore(InpMinTrades, InpMinProfit);

   // บันทึกทุก pass รวมชุดที่ได้ 0 ด้วย — ต้องเห็นภาพรวมว่าชุดที่แพ้แพ้แบบไหน
   // ไม่ใช่เห็นแค่ชุดที่ผ่านด่าน
   if(InpDumpPasses)
      DumpPass(score);

   return score;
}

//+------------------------------------------------------------------+
//| เขียนผลของ pass นี้ลงไฟล์ในโฟลเดอร์ Common                          |
//|                                                                    |
//| ไม่ใช้ระบบรายงานของ MT5 เพราะไฟล์ที่ส่งผ่าน /config: ถูกใช้แค่บาง key |
//| (Expert/Symbol/Period) ส่วน Report/Model/FromDate ถูก terminal.ini  |
//| ทับทิ้ง แล้ว MT5 ยังเขียน terminal.ini ทับกลับตอนปิดตัวเองอีก        |
//|                                                                    |
//| 1 pass = 1 ไฟล์ ชื่อไฟล์ประกอบจากค่าพารามิเตอร์ทั้งชุด จึงไม่ชนกัน    |
//| ระหว่าง agent หลายตัวที่รันขนานกัน แล้วค่อยรวมไฟล์ทีหลัง             |
//+------------------------------------------------------------------+
void DumpPass(const double score)
{
   string tf = StringSubstr(EnumToString((ENUM_TIMEFRAMES)Period()), 7);

   string stem = StringFormat("%s_%s_%d_%.2f_%d_%.1f_%.1f_%.1f_%d_%d_%d_%d_%d_%d",
                              _Symbol, tf, (int)InpUseAtrSL, InpAtrMult,
                              (int)InpTPMode, InpRR1, InpRR2, InpRR3,
                              (int)InpUseBE, InpRibbonShift, (int)InpMAMethod,
                              InpSwingBars, (int)InpCloseOnOpposite, InpBELockPoints);
   string path = "ribbon_opt\\" + stem + ".csv";

   int h = FileOpen(path, FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_COMMON);
   if(h == INVALID_HANDLE)
      return;

   WriteMonthlySeries("ribbon_opt\\monthly\\" + stem + ".csv");

   FileWrite(h, StringFormat("%s;%s;%d;%.2f;%d;%.1f;%.1f;%.1f;%d;%d;%d;%d;%d;%d;",
             _Symbol, tf,
             (int)InpUseAtrSL, InpAtrMult, (int)InpTPMode,
             InpRR1, InpRR2, InpRR3, (int)InpUseBE,
             InpRibbonShift, (int)InpMAMethod, InpSwingBars,
             (int)InpCloseOnOpposite, InpBELockPoints)
            + MetricsCsvTail(score));
   FileClose(h);
}
//+------------------------------------------------------------------+
void OnTick()
{
   ManageOpen();
   UpdatePanel();

   datetime barTime = iTime(_Symbol, PERIOD_CURRENT, 0);
   if(barTime == gLastBarTime)
      return;

   // ตัดสินใจบนแท่งที่ปิดแล้วเท่านั้น (เทียบ confirmOnly = true ของ Pine)
   double sPrev, sPrev2, lPrev, lPrev2;
   if(!ClusterAvg(hShort, SHORT_COUNT, 1, sPrev) ||
      !ClusterAvg(hShort, SHORT_COUNT, 2, sPrev2) ||
      !ClusterAvg(hLong,  LONG_COUNT,  1, lPrev) ||
      !ClusterAvg(hLong,  LONG_COUNT,  2, lPrev2))
      return; // ข้อมูลยังไม่พร้อม ยังไม่ถือว่าแท่งนี้ประมวลผลแล้ว

   gLastBarTime = barTime;

   bool buySignal  = sPrev > lPrev && sPrev2 <= lPrev2;
   bool sellSignal = sPrev < lPrev && sPrev2 >= lPrev2;
   if(!buySignal && !sellSignal)
      return;

   gCnt_Cross++;

   if(HasPosition())
   {
      if(!InpCloseOnOpposite)
         return; // ไม่ปิดไม้เดิม และถือได้ไม้เดียว = ข้ามสัญญาณนี้
      CloseAll("opposite signal");
      gCnt_ReverseClose++;
   }

   OpenTrade(buySignal);
}
//+------------------------------------------------------------------+
