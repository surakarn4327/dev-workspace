"""ค่าคงที่ + การค้นหาไฟล์ของโปรเจกต์ smart-ea (พี่น้องของ ea-tuner ใน dev-workspace เดียวกัน)

ea-tuner ไม่ import โค้ดข้าม folder ของ smart-ea (ตามธรรมนูญ) แค่เรียก
optimizer/bin/*.ps1 ที่มีอยู่แล้วเป็น subprocess และอ่านไฟล์ผลลัพธ์ (.csv) กลับมา
เท่านั้น — ไม่แตะโค้ด MQL5 ใดๆ เลย
"""
from __future__ import annotations

import re
from datetime import date, timedelta
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

# ทุก DumpPass() ในโปรเจกต์นี้ (MARibbon/AmdPo3/SATS/SmartIndicator) เขียน _Symbol แล้วก็ tf
# เป็น 2 คอลัมน์แรกเสมอ ก่อนพารามิเตอร์ตัวแรกที่มาจาก .set จริงๆ — ไม่ใช่ input ที่ปรับผ่าน
# .set ได้ (มาจาก -Symbol/-Period ของ run-opt.ps1 เอง) ต้องข้าม 2 คอลัมน์นี้เวลาจับคู่
# ค่าจากไฟล์ผล .csv กลับไปที่บรรทัดใน .set (ดู runner.build_neighbor_set)
PARAM_PREFIX_COLS = 2  # [symbol, timeframe]

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

# โหมดจูนล็อกช่วงวันที่เองเสมอ ผู้ใช้ไม่ต้องกรอก (คำขอผู้ใช้ 2026-09-12 — "ใช้งานง่ายที่สุด
# ไม่ต้องมาคอยปรับอีก"): เริ่ม 1 ม.ค. 2568 (ขอบเขตข้อมูลมาตรฐานของ XAUUSD ในโปรเจกต์นี้ ดู
# smart-ea/optimizer/README.md — ทองเปลี่ยนพฤติกรรมไปแล้วหลังจากนั้น) ถึงสิ้นเดือนก่อนเดือน
# ปัจจุบัน (ตัดเดือนที่กำลังเดินอยู่ทิ้งเพราะข้อมูลยังไม่ครบเดือน)
OPTIMIZE_TRAIN_START = date(2025, 1, 1)

# กันไว้ตรวจสอบท้ายช่วงเท่านี้เสมอ (ตายตัว ไม่ให้ผู้ใช้ปรับ) — เลือกเป็นจำนวนวันคงที่ (ไม่ใช่ %)
# เพราะช่วงข้อมูลจะยาวขึ้นเรื่อยๆ ตามเวลา ถ้าใช้ % ระยะ holdout จะบวมขึ้นเรื่อยๆ ทั้งที่ไม่จำเป็น
# 45 วัน (~1.5 เดือน) เป็นจุดกลางที่ยังมีไม้พอให้วัดผลได้จริง แต่เสียข้อมูลล่าสุดไปไม่มากเกินไป
# (เทียบ 20% ของช่วง ~20 เดือนคือเสียไปเกือบ 4 เดือน) — อ้างอิงบทเรียนที่ Range Fade/SATS ผ่าน
# ด่านตรวจเพื่อนบ้านหมดแต่ยังพังบนข้อมูลที่ไม่เคยจูน จึงยังต้องมี holdout เสมอ ไม่ตัดทิ้งทั้งหมด
OPTIMIZE_HOLDOUT_DAYS = 45

# จำนวนรอบ genetic ที่รันซ้ำก่อนรวมผู้ชนะ (ตายตัว ไม่ให้ผู้ใช้ปรับ — คำขอผู้ใช้ 2026-09-12
# "ไม่ควรให้ฉันตั้งค่าเอง ควรตั้งค่าที่ดีที่สุดเป็นค่าเริ่มต้น") 3 รอบคือจุดที่ทดสอบแล้วว่าเร็วพอ
# (~0.6-0.8 นาทีต่อรอบบน M5 กริดขนาด ~76,800 ชุด) และลดความเสี่ยงที่ genetic รอบเดียวจะสุ่มได้
# จุดฟลุกได้มากพอ — ตัวที่เป็นด่านตรวจคุณภาพจริงคือรอบ exhaustive ตรวจสอบเพื่อนบ้านถัดไป
# (ไล่ครบทุกจุดจริง ไม่ใช่สุ่ม) รอบ genetic นี้แค่ช่วยหาว่าควรเริ่มค้นละแวกไหนเท่านั้น
OPTIMIZE_GENETIC_REPS = 3


def default_optimize_date_range() -> tuple[date, date]:
    """ช่วงวันที่ที่โหมดจูนใช้เสมอ: 1 ม.ค. 2568 ถึงสิ้นเดือนก่อนเดือนปัจจุบัน"""
    today = date.today()
    first_of_this_month = today.replace(day=1)
    last_of_prev_month = first_of_this_month - timedelta(days=1)
    return OPTIMIZE_TRAIN_START, last_of_prev_month


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
