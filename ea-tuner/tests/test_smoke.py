import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import config  # noqa: E402
import report  # noqa: E402
import runner  # noqa: E402


def test_imports() -> None:
    assert config.SMART_EA_DIR.name == "smart-ea"


def test_guess_period_for_ea_prefers_longer_match() -> None:
    assert config.guess_period_for_ea("BestM5_AmdPo3") == "M5"
    assert config.guess_period_for_ea("BestWide_M15_MARibbon") == "M15"
    assert config.guess_period_for_ea("SomeEAWithNoTf") == "M15"  # ค่า default เมื่อเดาไม่ได้


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


def test_split_train_holdout_uses_fixed_days() -> None:
    train_from, train_to, hold_from, hold_to = runner.split_train_holdout(
        date(2025, 1, 1), date(2026, 9, 11), holdout_days=45
    )
    assert train_from == date(2025, 1, 1)
    assert hold_to == date(2026, 9, 11)
    assert train_to == hold_from
    assert (hold_to - hold_from).days == 45


def test_default_optimize_date_range_ends_last_month() -> None:
    start, end = config.default_optimize_date_range()
    assert start == config.OPTIMIZE_TRAIN_START
    assert end < date.today().replace(day=1)  # ตัดเดือนปัจจุบันทิ้งเสมอ


def test_parse_set_file_and_build_neighbor_set(tmp_path) -> None:
    p = tmp_path / "sample.set"
    p.write_text(
        "InpA=40||30||10||60||Y\n"
        "InpB=0.15||0.10||0.05||0.20||Y\n"
        "InpFlag=1\n"
        "InpMagic=123\n",
        encoding="utf-8",
    )
    entries = runner.parse_set_file(p)
    assert [e.name for e in entries] == ["InpA", "InpB", "InpFlag", "InpMagic"]
    assert entries[0].ranged and entries[2].ranged is False

    # winner_values สำหรับ 3 พารามิเตอร์ที่ปรากฏในผล .csv (InpA, InpB, InpFlag) — InpMagic
    # ไม่ถูกจูนเลยไม่อยู่ในผล .csv จึงไม่ส่งมาที่นี่ (n_params=3 < len(entries)=4)
    neighbor = runner.build_neighbor_set(entries, ["50", "0.15", "1"], n_params=3)
    lines = {ln.split("=")[0]: ln for ln in neighbor.strip().splitlines()}
    assert "InpA=50" in lines["InpA"]  # ค่าเริ่มของช่วงใหม่ = ค่าที่ชนะ
    assert lines["InpFlag"] == "InpFlag=1"  # ไม่ ranged ก็ล็อกตรงๆ
    assert lines["InpMagic"] == "InpMagic=123"  # พารามิเตอร์ควบคุมไม่ถูกแตะเลย

    fixed = runner.build_fixed_set(entries, ["50", "0.15", "1"], n_params=3)
    fixed_lines = {ln.split("=")[0]: ln for ln in fixed.strip().splitlines()}
    assert fixed_lines["InpA"] == "InpA=50"  # ไม่มีช่วงอีกต่อไป ล็อกตายตัว
    assert fixed_lines["InpMagic"] == "InpMagic=123"


def test_guess_point_unit_by_symbol_suffix() -> None:
    assert config.guess_point_unit("XAUUSDc") == 1.0
    assert config.guess_point_unit("XAUUSDm") == 0.01
    assert config.guess_point_unit("XAUUSD") == 0.01


def test_apply_risk_overrides_fixed_mode(tmp_path) -> None:
    p = tmp_path / "sample.set"
    p.write_text(
        "InpRiskMode=0\nInpRiskPct=2.0\nInpRiskFixedUsd=200\nInpRiskPointUnit=0.01\nInpMagic=1\n",
        encoding="utf-8",
    )
    entries = runner.parse_set_file(p)
    text, warnings = runner.apply_risk_overrides(
        entries, risk_mode="fixed", risk_value=150.0, point_unit=1.0
    )
    lines = {ln.split("=")[0]: ln for ln in text.strip().splitlines()}
    assert lines["InpRiskMode"] == "InpRiskMode=1"       # RISK_FIXED_USD
    assert lines["InpRiskFixedUsd"] == "InpRiskFixedUsd=150.0"
    assert lines["InpRiskPointUnit"] == "InpRiskPointUnit=1.0"
    assert lines["InpMagic"] == "InpMagic=1"              # ไม่ถูกแตะ
    assert not warnings


def test_apply_risk_overrides_missing_fields_warns(tmp_path) -> None:
    p = tmp_path / "sample.set"
    p.write_text("InpRiskPerTrade=100\n", encoding="utf-8")
    entries = runner.parse_set_file(p)
    text, warnings = runner.apply_risk_overrides(
        entries, risk_mode="percent", risk_value=2.0, point_unit=0.01
    )
    assert any("InpRiskPct" in w for w in warnings)
    assert any("InpRiskMode" in w for w in warnings)
    # InpRiskPointUnit ไม่เจอในไฟล์นี้ก็จริง แต่ EA ทุกตัวในโปรเจกต์นี้มี field นี้เสมอ
    # เลยเพิ่มบรรทัดใหม่ให้เองแทนการแค่เตือน (ต่างจาก mode/pct/fixed)
    assert not any("InpRiskPointUnit" in w for w in warnings)
    assert "InpRiskPointUnit=0.01" in text


def test_list_sets_for_ea_filters_by_strategy(tmp_path, monkeypatch) -> None:
    (tmp_path / "amdpo3_clean2025_M15.set").write_text("InpA=1||1||1||2||Y\n", encoding="utf-8")
    (tmp_path / "amdpo3_clean2025_M5.set").write_text("InpA=1||1||1||2||Y\n", encoding="utf-8")
    (tmp_path / "MARibbonOpt.set").write_text("InpA=1\n", encoding="utf-8")
    monkeypatch.setattr(config, "SETS_DIR", tmp_path)
    result = config.list_sets_for_ea("BestM5_AmdPo3")
    assert set(result) == {"amdpo3_clean2025_M15", "amdpo3_clean2025_M5"}
    assert config.list_sets_for_ea("MARibbonEA") == ["MARibbonOpt"]
    assert config.list_sets_for_ea("SmartIndicatorEA") == []


def test_guess_set_for_ea_prefers_matching_timeframe(tmp_path, monkeypatch) -> None:
    # จำลองสถานการณ์จริงที่เจอบั๊ก 2026-09-12: กลยุทธ์เดียวกันมี .set แยกคนละ TF
    # ("M15" เรียงก่อน "M5" ตามตัวอักษรเสมอ) ต้องเลือกไฟล์ที่ TF ตรงกับที่เดาไว้ ไม่ใช่ตัวแรกตามลำดับ
    (tmp_path / "amdpo3_clean2025_M15.set").write_text("InpA=1||1||1||2||Y\n", encoding="utf-8")
    (tmp_path / "amdpo3_clean2025_M5.set").write_text("InpA=1||1||1||2||Y\n", encoding="utf-8")
    monkeypatch.setattr(config, "SETS_DIR", tmp_path)
    assert config.guess_set_for_ea("BestM5_AmdPo3") == "amdpo3_clean2025_M5"
    assert config.guess_set_for_ea("BestM15_AmdPo3") == "amdpo3_clean2025_M15"
