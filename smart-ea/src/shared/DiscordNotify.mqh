//+------------------------------------------------------------------+
//| DiscordNotify.mqh                                                  |
//| โมดูลแจ้งเตือน Discord ใช้ร่วมกันทุก EA ในโปรเจกต์ (กฎข้อ 9 ของ            |
//| CLAUDE.md — เดิมใช้ Telegram, เปลี่ยนมาใช้ Discord แทนตามคำขอผู้ใช้        |
//| 2026-09-23) ไม่รู้จัก input ของกลยุทธ์ไหนเลย ค่าทุกตัวส่งผ่านพารามิเตอร์     |
//| เหมือน PositionLib.mqh                                             |
//|                                                                    |
//| Config (Webhook URL) อ่านจาก Common Files ผ่าน FileOpen(FILE_COMMON) |
//| ไม่ใช้ input — กัน URL หลุดเข้า git ผ่าน .set ที่โปรเจกต์นี้มีธรรมเนียม   |
//| commit เก็บไว้ ไฟล์ต้องชื่อ discord_config.txt วางไว้ที่                |
//| %APPDATA%\MetaQuotes\Terminal\Common\Files\discord_config.txt       |
//| เนื้อหา 1 บรรทัด: Webhook URL เต็ม (Discord Server > Integrations >   |
//| Webhooks > Copy Webhook URL) ถ้าไฟล์ไม่มี/format ผิด ฟีเจอร์นี้ปิดตัว   |
//| เงียบๆ ไม่กระทบการเทรดเลย                                          |
//+------------------------------------------------------------------+
#ifndef DISCORD_NOTIFY_MQH
#define DISCORD_NOTIFY_MQH

#define DC_CONFIG_FILE "discord_config.txt"

string g_DcWebhookUrl     = "";
bool   g_DcReady          = false;
bool   g_DcConfigChecked  = false;

// edge-trigger สถานะ (เช่น Algo Trading ปิด/เปิด) — ต้อง init ตอน OnInit โดยไม่ส่งข้อความ
// กัน false-alarm ตอน reattach/compile ใหม่ (ดู DC_NotifyStatus)
string g_DcLastStatus     = "";
bool   g_DcStatusInited   = false;

// dedupe ปัญหาตาม "สาเหตุ" ไม่ใช่ข้อความเป๊ะๆ (เช่น "ไม่มี tick มา N นาที" เปลี่ยนทุกรอบ)
string g_DcLastProblemKind = "";

//+------------------------------------------------------------------+
//| โหลด webhook URL จาก Common Files ครั้งแรกที่เรียกใช้ (lazy load)       |
//+------------------------------------------------------------------+
void DC_LoadConfig()
{
   g_DcConfigChecked = true;
   int h = FileOpen(DC_CONFIG_FILE, FILE_COMMON | FILE_READ | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE)
   {
      PrintFormat("Discord: ไม่พบไฟล์ config (%s) ใน Common Files — ปิดฟีเจอร์แจ้งเตือน Discord", DC_CONFIG_FILE);
      return;
   }
   string url = FileReadString(h);
   FileClose(h);
   StringTrimLeft(url); StringTrimRight(url);
   if(url == "" || StringFind(url, "http") != 0)
   {
      Print("Discord: config ไม่ครบ/รูปแบบผิด (webhook URL ว่างหรือไม่ขึ้นต้นด้วย http) — ปิดฟีเจอร์แจ้งเตือน Discord");
      return;
   }
   g_DcWebhookUrl = url;
   g_DcReady      = true;
   Print("Discord: โหลด config สำเร็จ");
}

// แท็กบัญชี กัน FILE_COMMON ที่แชร์ข้าม terminal ทำให้ demo/จริงปนกัน
string DC_AccountTag()
{
   if((ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_DEMO)
      return "[DEMO]";
   if((ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_CONTEST)
      return "[CONTEST]";
   return "#" + IntegerToString((int)AccountInfoInteger(ACCOUNT_LOGIN));
}

// escape ให้เป็น JSON string ที่ถูกต้อง — คนละแบบกับ percent-encode ของ Telegram
// (Discord webhook รับ body เป็น JSON ไม่ใช่ form-urlencoded)
string DC_JsonEscape(const string text)
{
   uchar bytes[];
   int n = StringToCharArray(text, bytes, 0, WHOLE_ARRAY, CP_UTF8) - 1; // ตัด null terminator ท้าย
   string out = "";
   for(int i = 0; i < n; i++)
   {
      uchar c = bytes[i];
      if(c == '"' || c == '\\')
         out += "\\" + CharToString((char)c);
      else if(c == '\n')
         out += "\\n";
      else if(c == '\r')
         continue; // ตัดทิ้ง กัน \r\n ซ้อนกันตอน escape
      else if(c == '\t')
         out += "\\t";
      else if(c < 0x20)
         continue; // control char อื่นๆ ที่ JSON string ห้ามมีตรงๆ
      else
         out += CharToString((char)c);
   }
   return out;
}

//+------------------------------------------------------------------+
//| ยิง JSON body ที่ประกอบไว้แล้วเข้า Discord — จุดเดียวที่คุยกับ WebRequest  |
//| จริง ใช้ร่วมกันทั้ง DC_Send (content ธรรมดา) และ DC_SendEmbedFields      |
//| (embed 2 คอลัมน์) แยกออกมาจาก DC_Send เดิม 2026-09-23 กันโค้ด           |
//| WebRequest/error-handling ซ้ำซ้อนกัน 2 จุด                             |
//+------------------------------------------------------------------+
bool DC_PostJson(const string body)
{
   // กันสแปมตอน backtest/optimize (โปรเจกต์นี้รันเป็นพัน/หมื่น combination) — สำคัญที่สุด
   if(MQLInfoInteger(MQL_TESTER) || MQLInfoInteger(MQL_OPTIMIZATION))
      return false;

   if(!g_DcConfigChecked)
      DC_LoadConfig();
   if(!g_DcReady)
      return false;

   string url     = g_DcWebhookUrl;
   string headers = "Content-Type: application/json\r\n";

   char post[];
   int len = StringToCharArray(body, post, 0, WHOLE_ARRAY, CP_UTF8) - 1;
   ArrayResize(post, MathMax(len, 0));

   char   result[];
   string resultHeaders;
   ResetLastError();
   int code = WebRequest("POST", url, headers, 3000, post, result, resultHeaders);
   if(code == -1)
   {
      PrintFormat("Discord: ส่งไม่สำเร็จ (WebRequest error %d) — เช็คว่าเพิ่มโดเมน webhook (เช่น "
                  "https://discord.com) ใน MT5 > Tools > Options > Expert Advisors > Allow WebRequest แล้วหรือยัง",
                  GetLastError());
      return false;
   }
   if(code != 200 && code != 204) // Discord webhook สำเร็จคืน 204 No Content ปกติ
   {
      PrintFormat("Discord: ส่งไม่สำเร็จ HTTP %d: %s", code, CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8));
      return false;
   }
   return true;
}

//+------------------------------------------------------------------+
//| ยิงข้อความธรรมดาเข้า Discord (content เดี่ยว)                          |
//+------------------------------------------------------------------+
bool DC_Send(const string text)
{
   string full = DC_AccountTag() + " " + text;
   if(StringLen(full) > 1900) // เผื่อ margin จาก limit จริง 2000 ตัวอักษรของ Discord content
      full = StringSubstr(full, 0, 1900);
   return DC_PostJson("{\"content\":\"" + DC_JsonEscape(full) + "\"}");
}

//+------------------------------------------------------------------+
//| เข้าไม้ (สด/ย้อนหลัง) — เรียกจากจุดเดียวใน PL_Open() ครอบคลุมทั้งสองเคส   |
//+------------------------------------------------------------------+
void DC_NotifyEntry(const string symbol, const int dir, const double entry, const double sl,
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
   DC_Send(text);
}

//+------------------------------------------------------------------+
//| ปิดไม้ (TP/SL/ถือนาน/กลับทิศ/หมดเวลา ฯลฯ) — icon/label เดาจาก reasonText |
//| อัตโนมัติ: มีคำว่า "TP" -> กำไร, "SL" -> ขาดทุน, อื่นๆ -> ผลลัพธ์         |
//+------------------------------------------------------------------+
void DC_NotifyClose(const string symbol, const string reasonText, const double profit, const string currency)
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
   DC_Send(text);
}

//+------------------------------------------------------------------+
//| ปิดบางส่วน (TP1/TP2) และขยับ SL เป็น Breakeven — ส่งเฉพาะตอนเปิดใช้จริง  |
//| ใน .set เท่านั้น (usePartials/useBe) ผู้เรียกเป็นคนเช็คก่อนเรียกฟังก์ชันนี้ |
//+------------------------------------------------------------------+
void DC_NotifyPartial(const string symbol, const string label, const double price, const double volume)
{
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   DC_Send(StringFormat("🎯 %s\nปิดบางส่วน: %s ที่ %s (%s lot)",
           symbol, label, DoubleToString(price, digits), DoubleToString(volume, 2)));
}

void DC_NotifyBreakeven(const string symbol, const double price)
{
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   DC_Send(StringFormat("🔒 %s\nขยับ SL เป็น Breakeven ที่ %s", symbol, DoubleToString(price, digits)));
}

//+------------------------------------------------------------------+
//| ปัญหา/error ทั่วไป (เข้าไม้ไม่สำเร็จ, ปิดไม้ไม่สำเร็จ ฯลฯ) — ส่งทุกครั้งที่ |
//| เรียก ไม่ dedupe (เพราะเป็นเหตุการณ์ที่เกิดครั้งเดียวจบ ไม่ใช่สถานะค้าง)   |
//+------------------------------------------------------------------+
void DC_NotifyProblem(const string symbol, const string text, const string icon = "❌")
{
   DC_Send(StringFormat("%s %s\n%s", icon, symbol, text));
}

//+------------------------------------------------------------------+
//| ปัญหาที่เป็น "สถานะค้าง" (connection หลุด, heartbeat ค้าง) — dedupe ตาม |
//| kind ไม่ใช่ข้อความเป๊ะๆ ส่งแค่ครั้งแรกที่เจอ จนกว่า DC_ClearProblemKind   |
//| จะถูกเรียกด้วย kind เดียวกัน (แปลว่าปัญหาหายแล้ว) ถึงจะแจ้งซ้ำได้อีกรอบ    |
//+------------------------------------------------------------------+
void DC_NotifyProblemOnce(const string kind, const string symbol, const string text, const string icon = "⚠️")
{
   if(kind == g_DcLastProblemKind) return;
   g_DcLastProblemKind = kind;
   DC_NotifyProblem(symbol, text, icon);
}

void DC_ClearProblemKind(const string kind)
{
   if(g_DcLastProblemKind == kind)
      g_DcLastProblemKind = "";
}

//+------------------------------------------------------------------+
//| สถานะ Algo Trading/บัญชี/broker — edge-trigger เท่านั้น ไม่ส่งทุก tick   |
//| เรียกครั้งแรกสุด (ตอน OnInit) จะแค่จำสถานะไว้ ไม่ส่งอะไร กัน false-alarm |
//| ตอน reattach/compile ใหม่ — ครั้งต่อๆ ไปถ้าสถานะเปลี่ยนถึงจะส่ง          |
//+------------------------------------------------------------------+
void DC_NotifyStatus(const string symbol, const string statusText, const bool isOk)
{
   if(!g_DcStatusInited)
   {
      g_DcLastStatus   = statusText;
      g_DcStatusInited = true;
      return;
   }
   if(statusText == g_DcLastStatus)
      return;
   g_DcLastStatus = statusText;

   if(isOk)
      DC_Send(StringFormat("✅ %s\nกลับมาทำงานปกติแล้ว", symbol));
   else
      DC_Send(StringFormat("🚫 %s\n%s", symbol, statusText));
}

#endif
