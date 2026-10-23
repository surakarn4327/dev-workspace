// PreToolUse hook: scaffolding a project needs the user's explicit approval every time.
// Forces a permission prompt so Claude cannot run new-project.ps1 on its own after only a name is chosen.
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  let cmd = "";
  try {
    const data = JSON.parse(input);
    cmd = String((data.tool_input && data.tool_input.command) || "");
  } catch {}
  if (!/new-project\.ps1/i.test(cmd)) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason:
          "สร้างโปรเจกต์ใหม่: ต้องเก็บ requirement ครบและผู้ใช้สั่งเริ่มสร้างเองก่อน (ชื่ออย่างเดียวไม่ใช่คำสั่งเริ่ม) — อนุมัติเฉพาะเมื่อผู้ใช้สั่งแล้ว",
      },
    })
  );
});
