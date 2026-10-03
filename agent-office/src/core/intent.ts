// Reads what the user MEANT when they type a free-text reply instead of pressing a button.
// Language-aware (English + Thai) but independent of the UI language: someone may type either.

const POLITE = String.raw`(\s*(ครับ|ค่ะ|คะ|นะ|เลย|จ้า|จ๊ะ|แล้ว|มาก|หน่อย))*[\s!.]*$`;

const AFFIRM_EN = /^(approve|accept|ok|okay|yes|y|go|start|good|great)/i;
const AFFIRM_TH = new RegExp(
  String.raw`^(อนุมัติ|ยอมรับ|ตกลง|โอเค|ได้เลย|ได้|เริ่ม|ใช่|ผ่าน|ดีมาก|ดี|เยี่ยม|สุดยอด|รับ)${POLITE}`,
);

const REVISE_EN = /^(revise|request)/i;
const REVISE_TH = new RegExp(String.raw`^(ขอให้แก้ไข|ขอแก้ไข|แก้ไข|ขอแก้|แก้)${POLITE}`);

/** "yes / approve / accept / ok / อนุมัติ / ตกลง ..." */
export function isAffirmative(text: string): boolean {
  const s = text.trim();
  return AFFIRM_EN.test(s) || AFFIRM_TH.test(s);
}

/** Just the bare word "revise" / "แก้ไข" (a button's worth of meaning): ask what to change. */
export function isBareRevise(text: string): boolean {
  const s = text.trim();
  return REVISE_EN.test(s) || REVISE_TH.test(s);
}
