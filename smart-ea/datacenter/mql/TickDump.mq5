// Research-only: dump every REAL tick (time in ms, bid, ask in integer points) to binary files per month
// Common\Files\adxres\ticks\ticks_YYYYMM.bin  (records of: long time_msc, int bid_points, int ask_points = 16 bytes)
// Run in the Strategy Tester, "Every tick based on real ticks" (Model=4), symbol XAUUSDc, any period. Opens no orders.
#property strict

int  gFile = INVALID_HANDLE;
int  gYm = -1;
long gN = 0;

void OpenFor(int ym)
{
   if(gFile != INVALID_HANDLE) FileClose(gFile);
   string fn = StringFormat("adxres\\ticks\\ticks_%06d.bin", ym);
   gFile = FileOpen(fn, FILE_WRITE | FILE_BIN | FILE_COMMON);
   gYm = ym;
}

int OnInit() { return INIT_SUCCEEDED; }

void OnTick()
{
   MqlTick k;
   if(!SymbolInfoTick(_Symbol, k)) return;
   MqlDateTime d; TimeToStruct(k.time, d);
   int ym = d.year * 100 + d.mon;
   if(ym != gYm) OpenFor(ym);
   if(gFile == INVALID_HANDLE) return;
   FileWriteLong(gFile, k.time_msc);
   FileWriteInteger(gFile, (int)MathRound(k.bid / _Point), INT_VALUE);
   FileWriteInteger(gFile, (int)MathRound(k.ask / _Point), INT_VALUE);
   gN++;
}

void OnDeinit(const int reason)
{
   if(gFile != INVALID_HANDLE) FileClose(gFile);
   PrintFormat("TickDump: %I64d ticks written", gN);
}
