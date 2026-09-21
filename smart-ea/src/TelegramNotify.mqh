//+------------------------------------------------------------------+
//| TelegramNotify.mqh                                                 |
//| โมดูลแจ้งเตือน Telegram ใช้ร่วมกันทุก EA ในโปรเจกต์ (กฎข้อ 9 ของ           |
//| CLAUDE.md — ตกลงกับผู้ใช้ 2026-09-18) ไม่รู้จัก input ของกลยุทธ์ไหนเลย     |
//| ค่าทุกตัวส่งผ่านพารามิเตอร์ เหมือน PositionLib.mqh                        |
//|                                                                    |
//| Config (Bot Token/Chat ID) อ่านจาก Common Files ผ่าน FileOpen(FILE_ |
//| COMMON) ไม่ใช้ input — กัน token หลุดเข้า git ผ่าน .set ที่โปรเจกต์นี้     |
//| มีธรรมเนียม commit เก็บไว้ ไฟล์ต้องชื่อ telegram_config.txt วางไว้ที่     |
//| %APPDATA%\MetaQuotes\Terminal\Common\Files\telegram_config.txt      |
//| เนื้อหา 2 บรรทัด: บรรทัดแรก = bot token, บรรทัดสอง = chat id            |
//| ถ้าไฟล์ไม่มี/format ผิด ฟีเจอร์นี้ปิดตัวเงียบๆ ไม่กระทบการเทรดเลย          |
//+------------------------------------------------------------------+
#ifndef TELEGRAM_NOTIFY_MQH
#define TELEGRAM_NOTIFY_MQH

#define TG_CONFIG_FILE "telegram_config.txt"

string g_TgBotToken       = "";
string g_TgChatId         = "";
bool   g_TgReady          = false;
bool   g_TgConfigChecked  = false;

// edge-trigger สถานะ (เช่น Algo Trading ปิด/เปิด) — ต้อง init ตอน OnInit โดยไม่ส่งข้อความ
// กัน false-alarm ตอน reattach/compile ใหม่ (ดู TG_NotifyStatus)
string g_TgLastStatus     = "";
bool   g_TgStatusInited   = false;

// dedupe ปัญหาตาม "สาเหตุ" ไม่ใช่ข้อความเป๊ะๆ (เช่น "ไม่มี tick มา N นาที" เปลี่ยนทุกรอบ)
string g_TgLastProblemKind = "";

//+------------------------------------------------------------------+
//| โหลด token/chat id จาก Common Files ครั้งแรกที่เรียกใช้ (lazy load)      |
//+------------------------------------------------------------------+
void TG_LoadConfig()
{
   g_TgConfigChecked = true;
   int h = FileOpen(TG_CONFIG_FILE, FILE_COMMON | FILE_READ | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE)
   {
      PrintFormat("Telegram: ไม่พบไฟล์ config (%s) ใน Common Files — ปิดฟีเจอร์แจ้งเตือน Telegram", TG_CONFIG_FILE);
      return;
   }
   string token  = FileReadString(h);
   string chatId = FileReadString(h);
   FileClose(h);
   StringTrimLeft(token);  StringTrimRight(token);
   StringTrimLeft(chatId); StringTrimRight(chatId);
   if(token == "" || chatId == "")
   {
      Print("Telegram: config ไม่ครบ (token/chat id ว่าง) — ปิดฟีเจอร์แจ้งเตือน Telegram");
      return;
   }
   g_TgBotToken = token;
   g_TgChatId   = chatId;
   g_TgReady    = true;
   PrintFormat("Telegram: โหลด config สำเร็จ ส่งเข้า chat id %s", g_TgChatId);
}

// แท็กบัญชี กัน FILE_COMMON ที่แชร์ข้าม terminal ทำให้ demo/จริงปนกัน
string TG_AccountTag()
{
   if((ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_DEMO)
      return "[DEMO]";
   if((ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_CONTEST)
      return "[CONTEST]";
   return "#" + IntegerToString((int)AccountInfoInteger(ACCOUNT_LOGIN));
}

// percent-encode เป็น ASCII ล้วนก่อนส่ง — เลี่ยงปัญหา UTF-8 ไทยเพี้ยนตอนแปลงเป็น char array ทีเดียว
string TG_UrlEncode(const string text)
{
   uchar bytes[];
   int n = StringToCharArray(text, bytes, 0, WHOLE_ARRAY, CP_UTF8) - 1; // ตัด null terminator ท้าย
   string out = "";
   for(int i = 0; i < n; i++)
   {
      uchar c = bytes[i];
      if((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
         c == '-' || c == '_' || c == '.' || c == '~')
         out += CharToString((char)c);
      else
         out += StringFormat("%%%02X", c);
   }
   return out;
}

//+------------------------------------------------------------------+
//| ยิงข้อความเข้า Telegram — จุดเดียวที่คุยกับ WebRequest จริง             |
//+------------------------------------------------------------------+
bool TG_Send(const string text)
{
   // กันสแปมตอน backtest/optimize (โปรเจกต์นี้รันเป็นพัน/หมื่น combination) — สำคัญที่สุด
   if(MQLInfoInteger(MQL_TESTER) || MQLInfoInteger(MQL_OPTIMIZATION))
      return false;

   if(!g_TgConfigChecked)
      TG_LoadConfig();
   if(!g_TgReady)
      return false;

   string full = TG_AccountTag() + " " + text;
   if(StringLen(full) > 4000) // เผื่อ margin จาก limit จริง 4096 ตัวอักษรของ Telegram
      full = StringSubstr(full, 0, 4000);

   string url     = "https://api.telegram.org/bot" + g_TgBotToken + "/sendMessage";
   string headers = "Content-Type: application/x-www-form-urlencoded\r\n";
   string body    = "chat_id=" + g_TgChatId + "&text=" + TG_UrlEncode(full);

   char post[];
   int len = StringToCharArray(body, post, 0, WHOLE_ARRAY, CP_UTF8) - 1;
   ArrayResize(post, MathMax(len, 0));

   char   result[];
   string resultHeaders;
   ResetLastError();
   int code = WebRequest("POST", url, headers, 3000, post, result, resultHeaders);
   if(code == -1)
   {
      PrintFormat("Telegram: ส่งไม่สำเร็จ (WebRequest error %d) — เช็คว่าเพิ่ม https://api.telegram.org "
                  "ใน MT5 > Tools > Options > Expert Advisors > Allow WebRequest แล้วหรือยัง", GetLastError());
      return false;
   }
   if(code != 200)
   {
      PrintFormat("Telegram: ส่งไม่สำเร็จ HTTP %d: %s", code, CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8));
      return false;
   }
   return true;
}

//+------------------------------------------------------------------+
//| เข้าไม้ (สด/ย้อนหลัง) — เรียกจากจุดเดียวใน PL_Open() ครอบคลุมทั้งสองเคส   |
//+------------------------------------------------------------------+
void TG_NotifyEntry(const string symbol, const int dir, const double entry, const double sl,
                     const double tp, const double lot, const double riskAmt, const string currency,
                     const double balance, const bool isCatchup)
{
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   string label = isCatchup ? "เข้าไม้ย้อนหลัง" : "เข้าไม้";
   string text = StringFormat("🟢 %s\n%s: %s %s\nSL: %s | TP: %s\nLot: %s | Risk: %s %s\nBalance: %s %s",
                 symbol, label, dir == 1 ? "BUY" : "SELL", DoubleToString(entry, digits),
                 DoubleToString(sl, digits), DoubleToString(tp, digits),
                 DoubleToString(lot, 2), DoubleToString(riskAmt, 2), currency,
                 DoubleToString(balance, 2), currency);
   TG_Send(text);
}

//+------------------------------------------------------------------+
//| ปิดไม้ (TP/SL/ถือนาน/กลับทิศ/หมดเวลา ฯลฯ) — icon/label เดาจาก reasonText |
//| อัตโนมัติ: มีคำว่า "TP" -> กำไร, "SL" -> ขาดทุน, อื่นๆ -> ผลลัพธ์         |
//+------------------------------------------------------------------+
void TG_NotifyClose(const string symbol, const string reasonText, const double profit, const string currency)
{
   string icon, label;
   if(StringFind(reasonText, "TP") >= 0)      { icon = "✅"; label = "กำไร"; }
   else if(StringFind(reasonText, "SL") >= 0) { icon = "🛑"; label = "ขาดทุน"; }
   else                                        { icon = "⚪"; label = "ผลลัพธ์"; }
   string sign = profit >= 0 ? "+" : "";
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   string text = StringFormat("%s %s\nไม้ปิดแล้ว: %s\n%s: %s%s %s\nBalance: %s %s",
                 icon, symbol, reasonText, label, sign, DoubleToString(profit, 2), currency,
                 DoubleToString(balance, 2), currency);
   TG_Send(text);
}

//+------------------------------------------------------------------+
//| ปิดบางส่วน (TP1/TP2) และขยับ SL เป็น Breakeven — ส่งเฉพาะตอนเปิดใช้จริง  |
//| ใน .set เท่านั้น (usePartials/useBe) ผู้เรียกเป็นคนเช็คก่อนเรียกฟังก์ชันนี้ |
//+------------------------------------------------------------------+
void TG_NotifyPartial(const string symbol, const string label, const double price, const double volume)
{
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   TG_Send(StringFormat("🎯 %s\nปิดบางส่วน: %s ที่ %s (%s lot)",
           symbol, label, DoubleToString(price, digits), DoubleToString(volume, 2)));
}

void TG_NotifyBreakeven(const string symbol, const double price)
{
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   TG_Send(StringFormat("🔒 %s\nขยับ SL เป็น Breakeven ที่ %s", symbol, DoubleToString(price, digits)));
}

//+------------------------------------------------------------------+
//| ปัญหา/error ทั่วไป (เข้าไม้ไม่สำเร็จ, ปิดไม้ไม่สำเร็จ ฯลฯ) — ส่งทุกครั้งที่ |
//| เรียก ไม่ dedupe (เพราะเป็นเหตุการณ์ที่เกิดครั้งเดียวจบ ไม่ใช่สถานะค้าง)   |
//+------------------------------------------------------------------+
void TG_NotifyProblem(const string symbol, const string text, const string icon = "❌")
{
   TG_Send(StringFormat("%s %s\n%s", icon, symbol, text));
}

//+------------------------------------------------------------------+
//| ปัญหาที่เป็น "สถานะค้าง" (connection หลุด, heartbeat ค้าง) — dedupe ตาม |
//| kind ไม่ใช่ข้อความเป๊ะๆ ส่งแค่ครั้งแรกที่เจอ จนกว่า TG_ClearProblemKind   |
//| จะถูกเรียกด้วย kind เดียวกัน (แปลว่าปัญหาหายแล้ว) ถึงจะแจ้งซ้ำได้อีกรอบ    |
//+------------------------------------------------------------------+
void TG_NotifyProblemOnce(const string kind, const string symbol, const string text, const string icon = "⚠️")
{
   if(kind == g_TgLastProblemKind) return;
   g_TgLastProblemKind = kind;
   TG_NotifyProblem(symbol, text, icon);
}

void TG_ClearProblemKind(const string kind)
{
   if(g_TgLastProblemKind == kind)
      g_TgLastProblemKind = "";
}

//+------------------------------------------------------------------+
//| สถานะ Algo Trading/บัญชี/broker — edge-trigger เท่านั้น ไม่ส่งทุก tick   |
//| เรียกครั้งแรกสุด (ตอน OnInit) จะแค่จำสถานะไว้ ไม่ส่งอะไร กัน false-alarm |
//| ตอน reattach/compile ใหม่ — ครั้งต่อๆ ไปถ้าสถานะเปลี่ยนถึงจะส่ง          |
//+------------------------------------------------------------------+
void TG_NotifyStatus(const string symbol, const string statusText, const bool isOk)
{
   if(!g_TgStatusInited)
   {
      g_TgLastStatus   = statusText;
      g_TgStatusInited = true;
      return;
   }
   if(statusText == g_TgLastStatus)
      return;
   g_TgLastStatus = statusText;

   if(isOk)
      TG_Send(StringFormat("✅ %s\nกลับมาทำงานปกติแล้ว", symbol));
   else
      TG_Send(StringFormat("🚫 %s\n%s", symbol, statusText));
}

#endif
