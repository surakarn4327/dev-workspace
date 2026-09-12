"""ค่าคงที่ + การค้นหาไฟล์ของโปรเจกต์ smart-ea (พี่น้องของ ea-tuner ใน dev-workspace เดียวกัน)

ea-tuner ไม่ import โค้ดข้าม folder ของ smart-ea (ตามธรรมนูญ) แค่เรียก
optimizer/bin/*.ps1 ที่มีอยู่แล้วเป็น subprocess และอ่านไฟล์ผลลัพธ์ (.csv) กลับมา
เท่านั้น — ไม่แตะโค้ด MQL5 ใดๆ เลย
"""
from __future__ import annotations

import re
from pathlib import Path

WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
SMART_EA_DIR = WORKSPACE_ROOT / "smart-ea"
SRC_DIR = SMART_EA_DIR / "src"
OPT_DIR = SMART_EA_DIR / "optimizer"
BIN_DIR = OPT_DIR / "bin"
SETS_DIR = OPT_DIR / "sets"
RESULTS_DIR = OPT_DIR / "results"

# ไฟล์ .mq5 ที่ไม่ใช่ EA เทรดจริง (indicator/utility) — ไม่ให้ขึ้นในรายการเลือก
NON_EA_FILES = {"MARibbonVisual.mq5", "SymbolInfoDump.mq5"}

# ชื่อไฟล์ Core.mqh -> โฟลเดอร์ที่ DumpPass() เขียนผลลง Common\Files\
# (มาจากการอ่านโค้ดตรงๆ ทุกครั้งที่เพิ่ม EA ใหม่ ต้องเช็ค src/<Core>.mqh ว่า path ที่ FileOpen ใช้คืออะไร)
CORE_TO_DUMPDIR = {
    "MARibbonCore.mqh": "ribbon_opt",
    "AmdPo3Core.mqh": "amdpo3_opt",
    "SelfAwareTrendCore.mqh": "sats_opt",
    "SmartIndicatorCore.mqh": "smartind_opt",
}

TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"]
MODELS = [
    ("0", "Every tick (ละเอียดสุด, ช้าสุด)"),
    ("1", "1 minute OHLC (เร็ว, ใช้จูน)"),
    ("2", "Open prices only (เร็วสุด, หยาบสุด)"),
    ("4", "Real ticks (แม่นสุด, มีแค่ ~8 เดือนย้อนหลัง)"),
]
RUN_MODES = [
    ("single", "รันเดี่ยว (ทดสอบชุดค่าเดียว)"),
    ("optimize", "จูน (genetic optimize ตามช่วงค่าใน .set)"),
    ("weekly", "จำลองถอนกำไรรายสัปดาห์ (รีเซ็ตทุนทุก 7 วัน)"),
    ("monthly", "จำลองถอนกำไรรายเดือน (รีเซ็ตทุนทุกเดือน)"),
]


def find_terminal_data_dir(expert_rel_path: str) -> Path | None:
    """หาโฟลเดอร์ข้อมูลของ MT5 terminal ที่มี Expert นี้ deploy อยู่ (มิเรอร์ตรรกะใน run-opt.ps1)"""
    root = Path.home() / "AppData/Roaming/MetaQuotes/Terminal"
    if not root.exists():
        return None
    target = f"MQL5/Experts/{expert_rel_path}.ex5"
    for d in root.iterdir():
        if not d.is_dir():
            continue
        if (d / target).exists():
            return d
    return None


def list_eas() -> list[dict]:
    """คืนรายการ EA ที่เลือกได้ พร้อม dump dir ที่ตรวจจากไฟล์ .mq5 เอง"""
    eas = []
    if not SRC_DIR.exists():
        return eas
    for f in sorted(SRC_DIR.glob("*.mq5")):
        if f.name in NON_EA_FILES:
            continue
        text = f.read_text(encoding="utf-8", errors="ignore")
        m = re.search(r'#include\s+"(\w+Core\.mqh)"', text)
        core_name = m.group(1) if m else None
        dump_dir = CORE_TO_DUMPDIR.get(core_name, "unknown_opt")
        eas.append({
            "name": f.stem,
            "file": f.name,
            "expert_path": f"Advisors\\{f.stem}",
            "dump_dir": dump_dir,
        })
    return eas


def list_sets() -> list[str]:
    if not SETS_DIR.exists():
        return []
    return sorted(p.stem for p in SETS_DIR.glob("*.set"))
