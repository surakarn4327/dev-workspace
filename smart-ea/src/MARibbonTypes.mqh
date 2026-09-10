//+------------------------------------------------------------------+
//| MARibbonTypes.mqh                                                  |
//| ชนิดข้อมูลที่ input ต้องใช้ จึงต้องประกาศก่อนบล็อก input ของ EA      |
//+------------------------------------------------------------------+
#ifndef MARIBBON_TYPES_MQH
#define MARIBBON_TYPES_MQH

enum ENUM_PANEL_POS
{
   PANEL_TOP_LEFT = 0,     // ซ้ายบน
   PANEL_TOP_RIGHT = 1,    // ขวาบน
   PANEL_BOTTOM_LEFT = 2,  // ซ้ายล่าง
   PANEL_BOTTOM_RIGHT = 3  // ขวาล่าง
};

enum ENUM_TP_MODE
{
   TP_PARTIAL = 0,    // แบ่งปิด 3 ไม้ย่อยที่ TP1/TP2/TP3
   TP_FINAL_ONLY = 1, // ปิดครั้งเดียวที่ TP3
   TP_NONE = 2        // ไม่ใช้ TP ปล่อยไหลจนโดน SL/BE หรือสัญญาณกลับทิศ
};

#endif
