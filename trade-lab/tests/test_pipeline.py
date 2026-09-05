"""End-to-end: does a full study run, and does it stay honest on noise?"""

import numpy as np
import pytest

from tradelab.config import AnalysisConfig, Config, SplitConfig
from tradelab.data import synthetic
from tradelab.pipeline import confirm_on_holdout, research
from tradelab.report import render


@pytest.fixture(scope="module")
def study():
    bars = synthetic.generate(n_bars=14_000, timeframe="M5", seed=11)
    cfg = Config().with_(
        split=SplitConfig(holdout_frac=0.2, n_folds=2),
        analysis=AnalysisConfig(min_events=150, min_leaf_events=100),
    )
    return bars, cfg, research(bars, cfg, timeframe="M5", run_lookahead=False)


def test_study_completes_and_passes_its_own_checks(study):
    _, _, result = study
    assert result.sanity_ok, [str(c) for c in result.sanity]
    assert result.n_features > 100
    assert result.n_conditions > 50


def test_study_uses_only_the_research_portion(study):
    bars, cfg, result = study
    expected = int(len(bars) * (1 - cfg.split.holdout_frac))
    assert result.bars == expected


def test_all_event_families_screened(study):
    _, _, result = study
    assert set(result.event_families()) if hasattr(result, "event_families") else True
    for family in ("reversal", "bounce", "expansion"):
        assert family in result.event_rate


def test_no_profitable_rule_survives_on_random_data(study):
    """Synthetic data is a random walk with costs, so nothing may survive.

    This is the strongest statement the test suite makes: the analysis does not
    manufacture edges out of noise. If this ever fails, trust nothing the
    pipeline reports about real data either.
    """
    _, _, result = study
    for side in ("long", "short"):
        table = getattr(result, f"expectancy_{side}")
        if table.empty:
            continue
        survivors = table[table["survives"]]
        assert survivors.empty, f"{side}: invented an edge in noise:\n{survivors.head()}"


def test_event_rate_survivors_are_only_the_planted_kind(study):
    """The event-rate screen may legitimately find structure on synthetic data.

    The generator has a real intraday volatility profile, so reversal *frequency*
    genuinely varies by hour and volatility state - and the screen should say so.
    What must never happen is a price-structure feature scoring, since a random
    walk has none. Before the universe fix, `sweep_high_depth >= q90` scored a 5x
    lift purely because a sweep happens at a swing high by construction and
    reversals are only defined at swing highs.
    """
    allowed_prefixes = ("clock.", "volatility.", "volume.", "session_levels.")
    _, _, result = study
    for family, table in result.event_rate.items():
        if table.empty:
            continue
        bad = table[
            table["passes_bonferroni"]
            & ~table["feature"].str.startswith(allowed_prefixes)
        ]
        assert bad.empty, f"{family}: found price structure in a random walk:\n{bad.head()}"


def test_significant_rows_never_show_negative_expectancy(study):
    """A row flagged as surviving must actually make money on both measures."""
    _, _, result = study
    for side in ("long", "short"):
        table = getattr(result, f"expectancy_{side}")
        if table.empty:
            continue
        flagged = table[table["survives"]]
        assert (flagged["mean_r"] > 0).all()
        assert (flagged["mean_r_episode"] > 0).all()
        assert (flagged["ci_low"] > 0).all()


def test_baseline_expectancy_is_negative_by_the_spread(study):
    _, _, result = study
    for side in ("long", "short"):
        assert result.baseline[f"{side}_mean_r"] < 0


def test_report_renders_completely(study):
    _, cfg, result = study
    text = render(result, cfg)
    for heading in (
        "ตรวจความน่าเชื่อถือของระบบก่อน",
        "เหตุการณ์ที่ตรวจจับได้",
        "จุดกลับตัว / เด้ง / ก่อนวิ่ง เกิดที่ไหน",
        "เงื่อนไขไหนทำกำไรจริง",
        "ผสมเงื่อนไขแล้วดีขึ้นมั้ย",
        "indicator ซ้ำซ้อนกันแค่ไหน",
        "ขั้นถัดไป",
    ):
        assert heading in text, f"missing section: {heading}"
    assert "tick volume" in text, "the volume caveat must always be stated"


def test_report_stops_early_when_sanity_fails(study):
    """A broken foundation must halt the report, not decorate it."""
    from dataclasses import replace

    _, cfg, result = study
    from tradelab.validate.sanity import Check

    broken = replace(result, sanity=[Check("random entry", False, "planted failure")])
    text = render(broken, cfg)
    assert "หยุดที่นี่" in text
    assert "เงื่อนไขไหนทำกำไรจริง" not in text


def test_holdout_confirmation_runs(study):
    bars, cfg, _ = study
    table = confirm_on_holdout(bars, cfg, ["(always)", "momentum.rsi_14 <= 30"])
    assert len(table) == 2
    assert table["n"].iloc[0] > 0


def test_holdout_confirmation_rejects_unknown_column(study):
    bars, cfg, _ = study
    table = confirm_on_holdout(bars, cfg, ["nope.not_a_feature <= 1"])
    assert table["n"].iloc[0] == 0
    assert not table["confirmed"].iloc[0]


def test_rule_text_roundtrip():
    """A mined rule string must re-evaluate to the same mask it came from."""
    import pandas as pd

    from tradelab.pipeline import _apply_rule_text

    feats = pd.DataFrame({"blk.a": [1.0, 2.0, 3.0, np.nan], "blk.b": [0.0, 1.0, 2.0, 3.0]})
    mask = _apply_rule_text(feats, "blk.a <= 2 AND blk.b > 0")
    assert mask.tolist() == [False, True, False, False]
    # NaN must never satisfy a clause
    assert not _apply_rule_text(feats, "blk.a <= 99")[3]
