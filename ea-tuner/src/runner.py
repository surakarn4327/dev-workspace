"""ประกอบคำสั่ง PowerShell + รัน optimizer/bin/*.ps1 ของ smart-ea เป็น subprocess

ไม่แตะ MT5/MQL5 โดยตรงเลย — ทุกอย่างผ่านสคริปต์ที่มีอยู่แล้ว (run-opt.ps1,
run-weekly-reset.ps1, run-monthly-reset.ps1) ea-tuner แค่เป็นหน้าต่างสำหรับ
ประกอบพารามิเตอร์ให้ถูก แล้วอ่านไฟล์ผลลัพธ์กลับมาสรุป
"""
from __future__ import annotations

import subprocess
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

import config


@dataclass
class RunRequest:
    ea_name: str
    expert_path: str  # "Advisors\\XXX"
    dump_dir: str
    set_name: str
    symbol: str
    period: str
    model: str
    deposit: str
    date_from: date
    date_to: date
    mode: str  # single / optimize / weekly / monthly
    out_name: str
    terminal_data_dir: str | None = None
    extra_args: list[str] = field(default_factory=list)
    opt_override: str | None = None  # ถ้าตั้งไว้ ใช้แทนค่า Optimization ที่เดาจาก mode
    # (ใช้กับรอบตรวจสอบเพื่อนบ้าน — mode ยังเป็น "optimize" แต่ต้องบังคับ exhaustive "1"
    # ไม่ใช่ genetic "2" เพราะกริดตอนนั้นแคบพอจะไล่ครบทุกจุดจริงได้แล้ว)
    genetic_reps: int = 3   # จำนวนรอบ genetic ที่รันซ้ำ (เช็คความนิ่งของผู้ชนะ)
    holdout_days: int = 45  # จำนวนวันท้ายสุดของช่วงที่ขอมา กันไว้ตรวจสอบ ไม่ใช้จูนเลย


def _dt(d: date) -> str:
    return d.strftime("%Y.%m.%d")


def build_command(req: RunRequest) -> list[str]:
    ps_exe = "powershell.exe"
    # -ExecutionPolicy Bypass ผูกกับ process นี้ครั้งเดียวเท่านั้น ไม่ได้เปลี่ยนนโยบายของเครื่อง
    # ถาวร — ต้องใส่เพราะเครื่องผู้ใช้ทั่วไป default เป็น Restricted (บล็อกสคริปต์ .ps1 ทุกไฟล์)
    # ต่างจาก session ที่ใช้ทดสอบตอนพัฒนา ea-tuner ซึ่ง bypass ไว้แล้วในนั้น เจอจริงตอนผู้ใช้กดรัน
    # ครั้งแรก (2026-09-12): "running scripts is disabled on this system"
    base_args = ["-NoProfile", "-ExecutionPolicy", "Bypass"]

    if req.mode in ("single", "optimize"):
        script = str(config.BIN_DIR / "run-opt.ps1")
        opt_flag = req.opt_override or ("0" if req.mode == "single" else "2")
        args = base_args + [
            "-File", script,
            "-Period", req.period,
            "-SetName", req.set_name,
            "-OutName", req.out_name,
            "-Symbol", req.symbol,
            "-Expert", req.expert_path,
            "-DumpDir", req.dump_dir,
            "-Optimization", opt_flag,
            "-Model", req.model,
            "-Deposit", req.deposit,
            "-From", _dt(req.date_from),
            "-To", _dt(req.date_to),
            "-SkipPreflight",
        ]
        if req.terminal_data_dir:
            args += ["-DataDir", req.terminal_data_dir]
        return [ps_exe] + args

    script_name = "run-weekly-reset.ps1" if req.mode == "weekly" else "run-monthly-reset.ps1"
    date_flag = "-StartDate" if req.mode == "weekly" else "-StartMonth"
    script = str(config.BIN_DIR / script_name)
    args = base_args + [
        "-File", script,
        "-SetName", req.set_name,
        "-OutPrefix", req.out_name,
        "-Period", req.period,
        "-Expert", req.expert_path,
        "-DumpDir", req.dump_dir,
        "-Symbol", req.symbol,
        "-Deposit", req.deposit,
        "-Model", req.model,
        date_flag, _dt(req.date_from),
        "-EndDate", _dt(req.date_to),
    ]
    return [ps_exe] + args


def run_streaming(req: RunRequest) -> Iterator[str]:
    """รันคำสั่งแล้ว yield ทีละบรรทัดของ stdout/stderr (สำหรับแสดงในหน้าต่าง log สด)"""
    cmd = build_command(req)
    yield f"$ {' '.join(cmd)}"
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    assert proc.stdout is not None
    for line in proc.stdout:
        yield line.rstrip("\n")
    proc.wait()
    yield f"[จบ — exit code {proc.returncode}]"


# ---------------------------------------------------------------------------
# .set parsing + neighbor-grid construction — automates the "อย่าเชื่อผู้ชนะ
# โดดเดี่ยว" (never trust a lone winner) rule this project already enforces by
# hand: MT5's genetic optimizer only samples a random slice of the full grid
# (a few hundred passes out of possibly tens of thousands of combos), so a
# single genetic run's top score can land on a fluke. After genetic search
# finds a promising region, we run a small EXHAUSTIVE grid around that one
# winner (±1 step per varied parameter, same step size) to check whether it
# sits on a real plateau or an isolated spike — mirroring the multi-stage
# process (wide search -> narrow verification) used when this project's EAs
# were tuned by hand.
# ---------------------------------------------------------------------------

@dataclass
class SetEntry:
    name: str
    ranged: bool
    value: str = ""           # ค่าคงที่ ถ้า ranged=False
    default: str = ""
    start: str = ""
    step: str = ""
    end: str = ""
    opt_flag: str = "Y"


def parse_set_file(path: Path) -> list[SetEntry]:
    """อ่าน .set เป็นรายการเรียงตามลำดับบรรทัด (ลำดับเดียวกับที่ EA ประกาศ input ไว้
    ซึ่งตรงกับลำดับคอลัมน์พารามิเตอร์ใน DumpPass() ของทุก Core.mqh ในโปรเจกต์นี้)"""
    entries: list[SetEntry] = []
    for line in path.read_text(encoding="utf-8-sig", errors="replace").splitlines():
        line = line.strip()
        if not line or "=" not in line:
            continue
        name, val = line.split("=", 1)
        parts = val.split("||")
        if len(parts) == 5:
            default, start, step, end, opt = parts
            entries.append(SetEntry(name=name, ranged=True, default=default,
                                     start=start, step=step, end=end, opt_flag=opt))
        else:
            entries.append(SetEntry(name=name, ranged=False, value=val))
    return entries


def _is_float_like(s: str) -> bool:
    return "." in s


def build_neighbor_set(entries: list[SetEntry], winner_values: list[str], n_params: int) -> str:
    """สร้างเนื้อไฟล์ .set ใหม่: พารามิเตอร์ N ตัวแรก (ตัวที่ปรากฏในไฟล์ผล .csv จริง)
    ถูกบีบช่วงให้แคบลงเหลือ ±1 step รอบค่าที่ชนะจากรอบ genetic (ยังอยู่ในขอบเขตเดิม)
    ส่วนที่เหลือ (พารามิเตอร์ควบคุม เช่น Magic/MinTrades ที่ไม่ถูกจูน) คงค่าเดิมจากไฟล์
    ทั้งหมด — ผลคือกริดเล็กพอจะไล่แบบ exhaustive (Optimization=1) ได้ครบทุกจุดจริง
    ไม่ใช่การสุ่มแบบ genetic อีกต่อไป
    """
    out_lines = []
    for i, e in enumerate(entries):
        if i < n_params and e.ranged:
            w = float(winner_values[i])
            step = float(e.step)
            lo, hi = float(e.start), float(e.end)
            new_lo = max(lo, w - step)
            new_hi = min(hi, w + step)
            fmt = "%.4f" if (_is_float_like(e.step) or _is_float_like(str(w))) else "%d"
            out_lines.append(
                f"{e.name}={fmt % w}||{fmt % new_lo}||{fmt % step}||{fmt % new_hi}||{e.opt_flag}"
            )
        elif i < n_params and not e.ranged:
            out_lines.append(f"{e.name}={winner_values[i]}")
        elif e.ranged:
            out_lines.append(f"{e.name}={e.default}||{e.start}||{e.step}||{e.end}||{e.opt_flag}")
        else:
            out_lines.append(f"{e.name}={e.value}")
    return "\n".join(out_lines) + "\n"


def build_fixed_set(entries: list[SetEntry], winner_values: list[str], n_params: int) -> str:
    """ล็อกพารามิเตอร์ N ตัวแรกเป็นค่าตายตัวตามผู้ชนะ (ไม่มีช่วงให้จูนอีกต่อไป) —
    ใช้รัน single-pass (Optimization=0) บนช่วง holdout เพื่อวัดผลจริงของค่าที่เลือกมา"""
    out_lines = []
    for i, e in enumerate(entries):
        if i < n_params:
            out_lines.append(f"{e.name}={winner_values[i]}")
        elif e.ranged:
            out_lines.append(f"{e.name}={e.default}||{e.start}||{e.step}||{e.end}||{e.opt_flag}")
        else:
            out_lines.append(f"{e.name}={e.value}")
    return "\n".join(out_lines) + "\n"


def apply_risk_overrides(
    entries: list[SetEntry], *, risk_mode: str, risk_value: float, point_unit: float
) -> tuple[str, list[str]]:
    """เขียนทับ field ความเสี่ยง/point-unit ในไฟล์ .set ตามค่าที่ตั้งในหน้าต่างโปรแกรม (คำขอ
    ผู้ใช้ 2026-09-12: ไม่อยากเปิดไฟล์ .set เองเพื่อแก้แค่ความเสี่ยง/point unit) — หา field ตาม
    รายชื่อที่รู้จักใน config.RISK_*_NAMES ก่อนเสมอ ถ้าไม่เจอชื่อไหนก็แค่ข้าม (EA บางตัวอาจไม่มี
    field นั้น เช่น EA รุ่นเก่าที่รองรับความเสี่ยงคงที่แบบเดียว) คืน (เนื้อไฟล์ .set ใหม่,
    รายการคำเตือนที่ควรแจ้งผู้ใช้)

    risk_mode: "fixed" (USD คงที่ต่อไม้) หรือ "percent" (% ของ equity) — ต้องตรงกับ
    config.RISK_MODES ค่าตัวเลขของ InpRiskMode อ้างอิงลำดับ enum ที่ทุก EA ในโปรเจกต์นี้ใช้
    ตรงกัน (RISK_PERCENT_EQUITY=0, RISK_FIXED_USD=1 — ดู smart-ea/src/*Types.mqh)
    """
    warnings: list[str] = []
    names_lower = {e.name.lower() for e in entries}

    def find_name(candidates: list[str]) -> str | None:
        for c in candidates:
            if c.lower() in names_lower:
                return c
        return None

    mode_name = find_name(config.RISK_MODE_NAMES)
    pct_name = find_name(config.RISK_PCT_NAMES)
    fixed_name = find_name(config.RISK_FIXED_NAMES)
    point_name = find_name(config.RISK_POINT_UNIT_NAMES)

    overrides: dict[str, str] = {}
    if mode_name:
        overrides[mode_name] = "0" if risk_mode == "percent" else "1"
    else:
        warnings.append(f"ไม่พบ {config.RISK_MODE_NAMES[0]} ใน .set นี้ — EA อาจรองรับความเสี่ยงแค่โหมดเดียว")

    if risk_mode == "percent":
        if pct_name:
            overrides[pct_name] = f"{risk_value}"
        else:
            warnings.append(f"ไม่พบ {config.RISK_PCT_NAMES[0]} ใน .set นี้ — ตั้งโหมด % ไม่ได้")
    else:
        if fixed_name:
            overrides[fixed_name] = f"{risk_value}"
        else:
            warnings.append(f"ไม่พบ {'/'.join(config.RISK_FIXED_NAMES)} ใน .set นี้ — ตั้ง USD คงที่ไม่ได้")

    append_lines: list[str] = []
    if point_name:
        overrides[point_name] = f"{point_unit}"
    else:
        # InpRiskPointUnit มีอยู่จริงในทุก EA ของโปรเจกต์นี้เสมอ (เช็คแล้วทั้ง MARibbon/AmdPo3/
        # SATS/SmartIndicator) แค่ไฟล์ .set นี้ไม่ได้ระบุไว้ (พึ่งค่า default ของ EA เฉยๆ) —
        # เพิ่มบรรทัดใหม่ให้เองได้อย่างปลอดภัย ต่างจาก mode/pct/fixed ที่บาง EA (รุ่นเก่า) อาจไม่มี
        # field นั้นจริงๆ เพิ่มมั่วอาจโดน MT5 เมินเงียบๆ หรือ error แทน
        name = config.RISK_POINT_UNIT_NAMES[0]
        append_lines.append(f"{name}={point_unit}")

    out_lines = []
    for e in entries:
        if e.name in overrides:
            out_lines.append(f"{e.name}={overrides[e.name]}")
        elif e.ranged:
            out_lines.append(f"{e.name}={e.default}||{e.start}||{e.step}||{e.end}||{e.opt_flag}")
        else:
            out_lines.append(f"{e.name}={e.value}")
    out_lines.extend(append_lines)
    return "\n".join(out_lines) + "\n", warnings


def split_train_holdout(
    date_from: date, date_to: date, holdout_days: int
) -> tuple[date, date, date, date]:
    """แบ่งช่วงวันที่เป็น (train_from, train_to, holdout_from, holdout_to)

    holdout เป็น "ท้ายสุด N วัน" ของช่วงที่ขอมาเสมอ (ไม่ใช่ปีเก่าคงที่แบบตรึงไว้) — ตาม
    เหตุผลที่ผู้ใช้ให้ไว้ 2026-09-12: ตลาดเปลี่ยน regime ตลอด ค่าที่จูนจากข้อมูลเก่าอาจใช้ไม่ได้
    กับตอนนี้ ดังนั้นทุกครั้งที่ date_to ขยับมาใหม่ (โหมดจูนคำนวณเป็นสิ้นเดือนก่อนหน้าให้เองเสมอ
    ดู config.default_optimize_date_range) ช่วง holdout ก็จะขยับตามมาเป็น "ช่วงล่าสุดที่สุด"
    โดยอัตโนมัติ ไม่ใช่ช่วงที่ถูกแช่แข็งไว้ตายตัว — ใช้จำนวนวันคงที่ (ไม่ใช่ %) เพราะช่วงข้อมูล
    ยาวขึ้นเรื่อยๆ ตามเวลา ถ้าใช้ % ระยะ holdout จะบวมขึ้นเรื่อยๆ ทั้งที่ไม่จำเป็น
    """
    split_date = date_to - timedelta(days=max(1, holdout_days))
    return date_from, split_date, split_date, date_to
