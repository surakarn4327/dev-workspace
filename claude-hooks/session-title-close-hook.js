// UserPromptSubmit hook: catch the moment the user signals they're closing out the session
// (e.g. "จบงาน", "ปิดงาน", "/session") and force a reminder right then — the SessionStart-only
// instruction (session-title-hook.js) fires once at the very start and gets lost by the time
// closing happens, so this fires on every prompt instead and only speaks up when it matches.
const KEYWORDS = ["/session"];

let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  try {
    const input = JSON.parse(raw);
    const prompt = String(input.prompt || input.user_prompt || input.message || input.text || "");
    if (!prompt) return;

    const hit = KEYWORDS.some((k) => prompt.includes(k));
    if (!hit) return;

    const context =
      `[ปิดงาน session] ข้อความนี้ดูเหมือนผู้ใช้กำลังจะปิดงาน/จบ session. ` +
      `ก่อนตอบ ให้เรียก mcp__ccd_session_mgmt__set_session_title (session_id: "self") ` +
      `อัปเดตชื่อ session ให้มีงานที่ทำจริงต่อท้ายวันที่เดิม (รูปแบบเดิม "PREFIX yy/mm/dd งานที่ทำ") ` +
      `ถ้าชื่อปัจจุบันยังไม่มีงานต่อท้าย หรืองานเปลี่ยนไปจากตอนตั้งชื่อ — ` +
      `ใช้คำง่ายๆ สั้นๆ 3-6 คำ พูดแบบชาวบ้านทั่วไป ห้ามชื่อ class/field/ตัวแปร/ไฟล์ในโค้ด ` +
      `(ผิด: "SheetAdvisor Stk_Factor 1mm แก้เสร็จ" ถูก: "แก้หน้าแนะนำ 1mm ไม่มี").`;

    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: context,
        },
      })
    );
  } catch (e) {
    // fail silently — never block the user's turn over a naming reminder
  }
});
