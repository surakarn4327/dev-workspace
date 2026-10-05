// UserPromptSubmit hook: suggest Opus for planning/research prompts and Sonnet for coding prompts.
// Reads the current model from the transcript and only speaks up when it does not match.
const fs = require("fs");

const PLANNING = [
  "วางแผน", "แผน", "หาข้อมูล", "ค้นหา", "ค้นคว้า", "requirement", "ออกแบบ", "เปรียบเทียบ",
  "วิเคราะห์", "ควรจะ", "แนะนำ", "ทางเลือก", "สรุป", "ตรวจสอบข้อมูล", "แหล่งข้อมูล",
  "plan", "research", "design", "compare", "analy", "investigate", "explore", "should we",
];
const CODING = [
  "เขียนโค้ด", "โค้ด", "แก้บั๊ก", "บั๊ก", "แก้โค้ด", "implement", "เริ่มทำ", "สร้างหน้า", "สร้างไฟล์",
  "refactor", "fix", "bug", "code", "function", "component", "test", "build", "deploy",
  "migration", "schema", "script", "hook", "commit",
];

function countHits(text, words) {
  return words.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0);
}

function currentModel(transcriptPath) {
  try {
    const raw = fs.readFileSync(transcriptPath, "utf8");
    const tail = raw.slice(-200000);
    const matches = [...tail.matchAll(/"model"\s*:\s*"(claude-[^"]+)"/g)];
    return matches.length ? matches[matches.length - 1][1] : "";
  } catch {
    return "";
  }
}

let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  let data;
  try {
    data = JSON.parse(input);
  } catch {
    return;
  }
  const prompt = String(data.prompt || "").toLowerCase();
  const planning = countHits(prompt, PLANNING);
  const coding = countHits(prompt, CODING);
  if (planning === coding) return; // ambiguous or neither: stay quiet

  const kind = planning > coding ? "planning" : "coding";
  const want = kind === "planning" ? "opus" : "sonnet";
  const model = currentModel(data.transcript_path || "");
  if (model && model.includes(want)) return;

  const label = kind === "planning" ? "งานวางแผน/หาข้อมูล" : "งานเขียนโค้ด";
  const wantName = want === "opus" ? "Opus" : "Sonnet";
  const msg = `${label} → แนะนำให้เปลี่ยนโมเดลเป็น ${wantName} (เลือกได้ที่ตัวเลือกโมเดลของแอป)` +
    (model ? ` ตอนนี้ใช้ ${model}` : "");

  process.stdout.write(JSON.stringify({
    systemMessage: msg,
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext:
        `[model-advisor] This prompt looks like ${kind} work; the user prefers ${wantName} for it. ` +
        `If you are not ${wantName}, open your reply with one short Thai line suggesting the user switch ` +
        `to ${wantName} via the app's model picker, then continue with the task.`,
    },
  }));
});
