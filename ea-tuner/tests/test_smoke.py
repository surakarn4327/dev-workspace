import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import config  # noqa: E402
import report  # noqa: E402
import runner  # noqa: E402


def test_imports() -> None:
    assert config.SMART_EA_DIR.name == "smart-ea"


def test_list_eas_finds_something_when_smart_ea_present() -> None:
    if not config.SRC_DIR.exists():
        return  # smart-ea อาจไม่มีในเครื่อง CI — ข้ามแบบเงียบๆ
    eas = config.list_eas()
    for ea in eas:
        assert ea["expert_path"].startswith("Advisors\\")
        assert ea["dump_dir"].endswith("_opt")


def test_build_command_single() -> None:
    req = runner.RunRequest(
        ea_name="X", expert_path="Advisors\\X", dump_dir="x_opt", set_name="Foo",
        symbol="XAUUSDc", period="M15", model="0", deposit="10000",
        date_from=date(2025, 1, 1), date_to=date(2026, 1, 1), mode="single",
        out_name="out1", terminal_data_dir="C:\\term",
    )
    cmd = runner.build_command(req)
    assert cmd[0] == "powershell.exe"
    assert "-Optimization" in cmd and cmd[cmd.index("-Optimization") + 1] == "0"
    assert "-DataDir" in cmd


def test_build_command_weekly() -> None:
    req = runner.RunRequest(
        ea_name="X", expert_path="Advisors\\X", dump_dir="x_opt", set_name="Foo",
        symbol="XAUUSDc", period="M15", model="0", deposit="10000",
        date_from=date(2025, 1, 1), date_to=date(2026, 1, 1), mode="weekly",
        out_name="out1",
    )
    cmd = runner.build_command(req)
    assert any("run-weekly-reset.ps1" in c for c in cmd)
    assert "-StartDate" in cmd


def test_parse_pass_csv_roundtrip(tmp_path) -> None:
    p = tmp_path / "sample.csv"
    tail = ";".join(["10000", "5", "100.5", "50.2", "1.5", "0.1", "0.6",
                      "3", "2", "0.66", "-10", "20", "0.3", "0.3", "2.5", "1", "1.23"])
    p.write_text(f"EURUSD;M15;42;{tail};\n", encoding="utf-8")
    rows = report.parse_pass_csv(p)
    assert len(rows) == 1
    assert rows[0]["params"] == ["EURUSD", "M15", "42"]
    assert rows[0]["score"] == 1.23
    assert rows[0]["trades"] == 5


def test_parse_period_summary(tmp_path) -> None:
    p = tmp_path / "summary.csv"
    p.write_text("2026-01;123.45;10\n2026-02;-50.0;8\n", encoding="utf-8-sig")
    rows = report.parse_period_summary(p)
    assert rows == [("2026-01", 123.45, 10), ("2026-02", -50.0, 8)]
