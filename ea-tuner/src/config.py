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

RISK_MODES = [
    ("fixed", "USD คงที่ต่อไม้"),
    ("percent", "% ของ equity ต่อไม้"),
]

# ชื่อ input ที่เกี่ยวกับความเสี่ยงที่ EA ในโปรเจกต์นี้ใช้ (เรียงตามที่เจอบ่อยสุดก่อน) — ไม่ทุก
# EA จะมีครบทุกชื่อ (เช่น MARibbonEA รุ่นเก่าใช้ InpRiskPerTrade ตัวเดียวไม่มี InpRiskMode
# แปลว่ารองรับแค่โหมด fixed) หาไม่เจอก็แค่ข้ามการ override ชื่อนั้นไป ไม่ error
RISK_MODE_NAMES = ["InpRiskMode"]
RISK_PCT_NAMES = ["InpRiskPct"]
RISK_FIXED_NAMES = ["InpRiskFixedUsd", "InpRiskPerTrade"]
RISK_POINT_UNIT_NAMES = ["InpRiskPointUnit"]


def guess_point_unit(symbol: str) -> float:
    """เดา 'ขนาด 1 จุด' (InpRiskPointUnit) จากชื่อสัญลักษณ์ — เดาแบบหยาบมาก ใช้ได้ชัวร์เฉพาะทอง
    บนบัญชีนี้เท่านั้น (บัญชี m ปกติ contract=100 -> 0.01, บัญชี Cent ลงท้าย 'c' contract=1 -> 1.0)
    คู่เงินอื่นค่าจริงต่างไปตาม contract size ของสัญลักษณ์นั้นๆ (เช่น EURUSDc=0.001,
    USDJPYc=0.15975 — มี USD เป็น base currency ต้องคูณเรตด้วย) **ต้องเช็คด้วย
    SymbolInfoDump.mq5 เองก่อนถ้าไม่ใช่ทอง** ดู smart-ea/bugs.md หัวข้อ 2026-09-12
    (สูตรเต็ม: pointUnit = 1/contract_size เมื่อ quote currency = USD, = เรตปัจจุบัน/contract_size
    เมื่อ USD เป็น base currency แทน) ที่นี่แค่เดาให้เป็นจุดเริ่มต้น ยังแก้เองได้เสมอในหน้าต่าง"""
    return 1.0 if symbol.strip().lower().endswith("c") else 0.01

# โมเดล tick ล็อกไว้ตายตัวตามด่าน ผู้ใช้ไม่ต้องเลือกเอง (คำขอผู้ใช้ 2026-09-12 — และเป็นบั๊กเสี่ยง
# จริงถ้าปล่อยให้เลือกผิด: bugs.md ของ smart-ea บันทึกไว้ว่ารันกริดด้วย Every tick ช้ากว่า
# 1-minute OHLC ~50 เท่า จนดูเหมือนเครื่องค้าง ต้อง taskkill ทิ้ง) —
# MODEL_GRID ใช้กับขั้นที่รันหลายร้อย/พันชุด (genetic + exhaustive), MODEL_ACCURATE ใช้กับขั้น
# ที่รันแค่ครั้งเดียว (รันเดี่ยว, holdout, รายสัปดาห์/รายเดือน) ซึ่งความช้าของ Every tick ไม่กระทบ
# เพราะมีแค่ 1 pass แต่ได้ความแม่นยำที่ดีกว่า
MODEL_GRID = "1"       # 1 minute OHLC — ใช้กับ genetic + exhaustive เท่านั้น
MODEL_ACCURATE = "0"   # Every tick — ใช้กับทุกอย่างที่รันแค่ 1 pass

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


# ตัวช่วยเดา TF/`.set` ที่เหมาะกับ EA ที่เลือก — เดาให้เฉยๆ ยังแก้เองได้เสมอ (ไม่ล็อกเหมือน
# ช่วงวันที่/holdout/genetic reps เพราะสัญลักษณ์ที่จะเทรดเป็นเรื่องที่ผู้ใช้ต้องเลือกเองจริงๆ
# TF ที่เหมาะสมยังต่างกันไปตาม EA/สัญลักษณ์ ไม่มี "ค่าที่ดีที่สุด" ตายตัวแบบ holdout days)
def guess_period_for_ea(ea_name: str) -> str:
    """เดา TF จากชื่อไฟล์ EA (เช่น BestM5_AmdPo3 -> M5) — ไล่จากยาวไปสั้นกันชื่อชนกัน (M15 มี
    'M1' เป็น substring) คืน 'M15' ถ้าเดาไม่ได้ (TF ที่โปรเจกต์ smart-ea ใช้บ่อยที่สุด)"""
    name_upper = ea_name.upper()
    for tf in sorted(TIMEFRAMES, key=len, reverse=True):
        if tf in name_upper:
            return tf
    return "M15"


def _strategy_key(ea_name: str) -> str:
    """ตัด prefix `Best*_TF_` ทิ้งแล้วคืนชื่อกลยุทธ์ตัวพิมพ์เล็ก เช่น 'BestM5_AmdPo3' กับ
    'AmdPo3EA' ทั้งคู่เหลือ 'amdpo3' — ใช้จับคู่ EA กับ .set ที่เป็นกลยุทธ์เดียวกัน"""
    # เรียง TF ยาวไปสั้นในการอ้าง alternation (เหตุผลเดียวกับ guess_period_for_ea) — regex
    # alternation จับตัวเลือกแรกที่แมตช์ได้ก่อนเสมอ ไม่ใช่ตัวที่ยาวที่สุด ถ้าเรียง M1 มาก่อน M15
    # "BestM15_AmdPo3" จะโดนตัดแค่ "BestM1" เหลือเศษ "5_AmdPo3" ค้าง (เจอบั๊กนี้จริงตอนเขียนเทสต์)
    tf_alt = "|".join(sorted(TIMEFRAMES, key=len, reverse=True))
    strategy = re.sub(rf"^Best(\w+?)?_?({tf_alt})_?", "", ea_name, flags=re.IGNORECASE)
    return re.sub(r"EA$", "", strategy, flags=re.IGNORECASE).lower()


def list_sets_for_ea(ea_name: str) -> list[str]:
    """คืนเฉพาะไฟล์ `.set` ที่เป็นกลยุทธ์เดียวกับ EA ที่เลือก (ไม่ใช่ทุกไฟล์ในโปรเจกต์) — คำขอ
    ผู้ใช้ 2026-09-12: ไม่อยากเห็น .set ของ EA อื่นปนอยู่ในตัวเลือก ไม่กรอง TF ด้วย (ต่างจาก
    guess_set_for_ea ที่ต้องเดาแค่ตัวเดียว) เพราะอยากให้เห็นทุก TF variant ของกลยุทธ์นั้นให้เลือกเอง
    ถ้าไม่มีไฟล์กลยุทธ์ไหนตรงเลย คืน list ว่าง (ไม่ fallback ไปโชว์ทุกไฟล์ กันสับสนกับ EA อื่น)"""
    strategy = _strategy_key(ea_name)
    if not strategy:
        return []
    return [s for s in list_sets() if strategy in s.lower()]


def guess_set_for_ea(ea_name: str) -> str | None:
    """เดาไฟล์ .set ที่น่าจะตรงกับ EA ที่เลือกที่สุด (ตัวเดียว) จาก list_sets_for_ea() คืน None
    ถ้าไม่มั่นใจ (ดีกว่าเดาผิดแล้วให้ผู้ใช้จูนด้วยช่วงค่าของ EA อื่น)

    ต้องเลือกไฟล์ที่ TF ตรงกับที่เดาไว้ด้วยเสมอ (ไม่ใช่แค่ชื่อกลยุทธ์ตรง) — พบจริงว่ากลยุทธ์เดียวกัน
    มักมี .set แยกกันคนละ TF (เช่น `amdpo3_clean2025_M5.set` กับ `..._M15.set`) เรียงตามตัวอักษร
    "M15" มาก่อน "M5" เสมอ (ตัวอักษร '1' < '5') ถ้าไม่กรอง TF จะได้ไฟล์ผิด TF ทุกครั้งที่ EA
    เป็น M5 แต่มีไฟล์ M15 อยู่ด้วย (เจอบั๊กนี้จริงตอนทดสอบ 2026-09-12)"""
    candidates = list_sets_for_ea(ea_name)
    if not candidates:
        return None
    tf = guess_period_for_ea(ea_name)

    def has_range(name: str) -> bool:
        text = (SETS_DIR / f"{name}.set").read_text(encoding="utf-8-sig", errors="ignore")
        return "||" in text

    # ต้องเป็นคำเต็ม ไม่ใช่ substring (กัน "M1" ไปแมตช์ผิดเข้ากับ "M15")
    tf_pattern = re.compile(rf"(?<![0-9A-Za-z]){re.escape(tf)}(?![0-9A-Za-z])", re.IGNORECASE)
    tf_matched = [s for s in candidates if tf_pattern.search(s)]
    for pool in (tf_matched, candidates):
        for name in pool:
            if has_range(name):
                return name
    return tf_matched[0] if tf_matched else candidates[0]
