const fs = require("fs");
const path = require("path");

const mapPath = path.join(__dirname, "session-prefixes.json");
const folder = path.basename(process.cwd());

let map = {};
try {
  map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
} catch (e) {
  map = {};
}

const prefix = map[folder];

const WORDING_RULE =
  `พูดแบบชาวบ้านทั่วไป ห้ามใช้ชื่อ class/field/ตัวแปร/ไฟล์ในโค้ด แม้จะสั้นก็ห้าม — ` +
  `ผิด: "SheetAdvisor Stk_Factor 1mm แก้เสร็จ" (ใช้ชื่อโค้ด) ถูก: "แก้หน้าแนะนำ 1mm ไม่มี" (คำพูดทั่วไป).`;

const MANDATE =
  `⚠️ บังคับ ห้ามลืม ห้ามข้าม — ทำก่อนตอบข้อความแรกของผู้ใช้เสมอ ไม่ว่าข้อความแรกจะเป็นคำถาม/สั่งงาน/บอกงานหรือไม่ก็ตาม: ` +
  `เรียก mcp__ccd_session_mgmt__set_session_title (session_id: "self") อย่างน้อย 1 ครั้งก่อนเริ่มทำงานใดๆ.`;

let context;
if (prefix) {
  context =
    `[ตั้งชื่อ session อัตโนมัติ] ${MANDATE} โฟลเดอร์ "${folder}" ใช้คำนำหน้า "${prefix}". ` +
    `ถ้ารู้งานจากข้อความแรกแล้ว ตั้งชื่อรูปแบบ "${prefix} yy/mm/dd งานสั้นๆ" ` +
    `(yy/mm/dd = วันที่ปัจจุบัน พ.ศ. 2 หลัก เช่น ค.ศ. 2026-08-31 = 69/08/31; ` +
    `งานสั้นๆ = สรุปงาน 3-6 คำ, ${WORDING_RULE}). ถ้ายังไม่รู้งาน (เช่นข้อความแรกเป็นแค่ทักทาย/ยังไม่บอกงาน) ` +
    `ก็ยังต้องเรียกตั้งเป็น "${prefix} yy/mm/dd" ไปก่อนอยู่ดี ห้ามปล่อยว่าง. ` +
    `เมื่อผู้ใช้บอกว่าจะปิดงาน/จบ session (เช่น พิมพ์ /session) และชื่อยังไม่มีงานต่อท้าย หรืองานเปลี่ยนไปจากตอนตั้ง ` +
    `ให้เรียก set_session_title อัปเดตงานที่ทำจริงต่อท้ายวันที่เดิมอีกครั้ง — ${WORDING_RULE}`;
} else {
  context =
    `[ตั้งชื่อ session อัตโนมัติ] ${MANDATE} โฟลเดอร์ "${folder}" ยังไม่มีคำนำหน้าชื่อ session ในระบบ. ` +
    `ก่อนเริ่มงาน ให้ถามผู้ใช้ก่อนว่าอยากตั้งคำนำหน้าอะไรสำหรับโปรเจกต์นี้ (เช่น ATLO, TT, CMP) ` +
    `แล้วบันทึกคำตอบลงไฟล์ ${mapPath} เพิ่ม key "${folder}": "PREFIX" (แก้ไฟล์ JSON ตรงๆ ผ่าน Edit/Write tool) ` +
    `จากนั้นตั้งชื่อ session ด้วย mcp__ccd_session_mgmt__set_session_title (session_id: "self") รูปแบบ ` +
    `"PREFIX yy/mm/dd งานสั้นๆ" (yy/mm/dd = วันที่ปัจจุบัน พ.ศ. 2 หลัก, ${WORDING_RULE}). ` +
    `เมื่อผู้ใช้บอกว่าจะปิดงาน/จบ session ให้อัปเดตชื่อเติมงานที่ทำจริงต่อท้ายวันที่เดิม — ${WORDING_RULE}`;
}

console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: context,
    },
  })
);
