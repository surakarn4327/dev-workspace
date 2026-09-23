#property strict
#property tester_no_cache

int OnInit()
{
   datetime srv = TimeCurrent();   // เวลา server ของ broker
   datetime loc = TimeLocal();     // เวลาเครื่องนี้ (ตามที่ Windows ตั้งไว้)
   datetime gmt = TimeGMT();       // เวลา GMT จริง
   PrintFormat("TIMECHECK server=%s local=%s gmt=%s server_minus_local_hours=%.2f",
      TimeToString(srv, TIME_DATE|TIME_SECONDS),
      TimeToString(loc, TIME_DATE|TIME_SECONDS),
      TimeToString(gmt, TIME_DATE|TIME_SECONDS),
      (double)(srv - loc) / 3600.0);
   PrintFormat("ACCOUNTDUMP currency=%s balance=%.2f equity=%.2f leverage=%d company=%s server=%s",
      AccountInfoString(ACCOUNT_CURRENCY),
      AccountInfoDouble(ACCOUNT_BALANCE),
      AccountInfoDouble(ACCOUNT_EQUITY),
      (int)AccountInfoInteger(ACCOUNT_LEVERAGE),
      AccountInfoString(ACCOUNT_COMPANY),
      AccountInfoString(ACCOUNT_SERVER));
   int total = SymbolsTotal(false); // ทุกสัญลักษณ์ของ broker ไม่ใช่แค่ที่อยู่ใน Market Watch
   PrintFormat("SYMBOLCOUNT total=%d", total);
   for(int i = 0; i < total; i++)
   {
      string s = SymbolName(i, false);
      if(!SymbolSelect(s, true)) continue; // ต้องเลือกก่อนถึงจะอ่านราคา/สเปคได้ครบ
      double contract = SymbolInfoDouble(s, SYMBOL_TRADE_CONTRACT_SIZE);
      double point    = SymbolInfoDouble(s, SYMBOL_POINT);
      double bid      = SymbolInfoDouble(s, SYMBOL_BID);
      double ask      = SymbolInfoDouble(s, SYMBOL_ASK);
      int    spreadPt = (int)SymbolInfoInteger(s, SYMBOL_SPREAD);
      string path     = SymbolInfoString(s, SYMBOL_PATH);
      PrintFormat("SYMLIST %s path=%s contract=%.4f point=%.6f bid=%.5f ask=%.5f spreadpts=%d spreadprice=%.6f",
         s, path, contract, point, bid, ask, spreadPt, ask - bid);
   }
   return(INIT_SUCCEEDED);
}

void OnTick() {}
double OnTester() { return 1.0; }
