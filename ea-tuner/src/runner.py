"""ประกอบคำสั่ง PowerShell + รัน optimizer/bin/*.ps1 ของ smart-ea เป็น subprocess

ไม่แตะ MT5/MQL5 โดยตรงเลย — ทุกอย่างผ่านสคริปต์ที่มีอยู่แล้ว (run-opt.ps1,
run-weekly-reset.ps1, run-monthly-reset.ps1) ea-tuner แค่เป็นหน้าต่างสำหรับ
ประกอบพารามิเตอร์ให้ถูก แล้วอ่านไฟล์ผลลัพธ์กลับมาสรุป
"""
from __future__ import annotations

import subprocess
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import date

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


def _dt(d: date) -> str:
    return d.strftime("%Y.%m.%d")


def build_command(req: RunRequest) -> list[str]:
    ps_exe = "powershell.exe"

    if req.mode in ("single", "optimize"):
        script = str(config.BIN_DIR / "run-opt.ps1")
        opt_flag = "0" if req.mode == "single" else "2"
        args = [
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
    args = [
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
