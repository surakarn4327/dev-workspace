"""Statistics, screening, splits - the parts that decide what counts as true."""

import numpy as np
import pandas as pd
import pytest

from tradelab.analysis import conditions, rules, screen, stats
from tradelab.config import SplitConfig
from tradelab.validate import splits


# --- expectancy ---------------------------------------------------------------


def test_expectancy_of_known_series():
    # 4 wins at +3R, 6 losses at -1R -> mean = (12 - 6)/10 = +0.6R
    r = [3.0] * 4 + [-1.0] * 6
    e = stats.expectancy(r)
    assert e.n == 10
    assert e.mean_r == pytest.approx(0.6)
    assert e.win_rate == pytest.approx(0.4)


def test_high_winrate_low_rr_loses_money():
    """The headline point of the whole project, as a test."""
    good_hitrate = stats.expectancy([0.5] * 60 + [-1.0] * 40)
    poor_hitrate = stats.expectancy([3.0] * 34 + [-1.0] * 66)
    assert good_hitrate.win_rate > poor_hitrate.win_rate
    assert good_hitrate.mean_r < 0 < poor_hitrate.mean_r


def test_expectancy_ignores_nan():
    e = stats.expectancy([1.0, np.nan, -1.0, np.nan])
    assert e.n == 2


def test_expectancy_of_empty_is_nan():
    e = stats.expectancy([])
    assert e.n == 0 and np.isnan(e.mean_r)


def test_drawdown_and_single_trade_share():
    e = stats.expectancy([-1.0, -1.0, 10.0])
    assert e.max_drawdown_r == pytest.approx(2.0)
    assert e.top_trade_share == pytest.approx(1.0)


# --- intervals ----------------------------------------------------------------


def test_wilson_stays_within_zero_one_for_rare_events():
    lo, hi = stats.wilson_interval(1, 500)
    assert 0.0 <= lo < hi <= 1.0


def test_wilson_narrows_as_n_grows():
    small = stats.wilson_interval(40, 100)
    large = stats.wilson_interval(4000, 10_000)
    assert (large[1] - large[0]) < (small[1] - small[0])


def test_rate_vs_baseline_lift():
    out = stats.rate_vs_baseline(cond_hits=34, cond_n=100, base_hits=120, base_n=1000)
    assert out["rate"] == pytest.approx(0.34)
    assert out["baseline_rate"] == pytest.approx(0.12)
    assert out["lift"] == pytest.approx(0.34 / 0.12)


# --- multiple testing ---------------------------------------------------------


def test_bh_rejects_pure_noise():
    """500 null tests must yield essentially nothing at a 10% FDR."""
    rng = np.random.default_rng(0)
    p = rng.uniform(size=500)
    passed = stats.benjamini_hochberg(p, 0.10)
    assert passed.sum() <= 2, f"{passed.sum()} false positives from pure noise"


def test_bh_finds_real_signal_among_noise():
    rng = np.random.default_rng(1)
    p = np.concatenate([rng.uniform(size=200), np.full(10, 1e-8)])
    passed = stats.benjamini_hochberg(p, 0.10)
    assert passed[-10:].all()


def test_bh_ignores_nan():
    passed = stats.benjamini_hochberg([np.nan, 1e-9, np.nan], 0.10)
    assert passed.tolist() == [False, True, False]


def test_bonferroni_tightens_with_more_tests():
    assert stats.deflated_threshold(1000) < stats.deflated_threshold(10)


def test_redundancy_groups_catch_duplicate_indicators():
    rng = np.random.default_rng(2)
    base = rng.standard_normal(500)
    df = pd.DataFrame(
        {
            "rsi": base,
            "stoch": base + rng.standard_normal(500) * 0.01,  # near-identical
            "willr": base + rng.standard_normal(500) * 0.01,
            "unrelated": rng.standard_normal(500),
        }
    )
    groups = stats.redundancy_groups(df.corr(), 0.90)
    assert groups, "expected the three momentum clones to group"
    biggest = max(groups, key=len)
    assert {"rsi", "stoch", "willr"} <= set(biggest)
    assert "unrelated" not in biggest


# --- conditions ---------------------------------------------------------------


def test_conditions_from_boolean_and_continuous():
    rng = np.random.default_rng(3)
    feats = pd.DataFrame(
        {
            "block.flag": rng.integers(0, 2, size=2000).astype(float),
            "block.value": rng.standard_normal(2000),
        }
    )
    conds = conditions.build(feats, min_n=100)
    names = {c.name for c in conds}
    assert "block.flag=true" in names
    assert any(n.startswith("block.value<=") for n in names)
    assert any(n.startswith("block.value>=") for n in names)
    for c in conds:
        assert c.mask.dtype == bool and c.n >= 100


def test_conditions_drop_rare_cases():
    feats = pd.DataFrame({"block.flag": [1.0] + [0.0] * 4999})
    assert conditions.build(feats, min_n=100) == []


# --- screening ----------------------------------------------------------------


def test_screen_finds_a_planted_edge():
    rng = np.random.default_rng(4)
    n = 8000
    flag = rng.integers(0, 2, size=n).astype(float)
    feats = pd.DataFrame({"block.flag": flag, "block.noise": rng.standard_normal(n)})
    # flag == 1 gets a genuinely better R distribution
    r = rng.standard_normal(n) * 0.5 - 0.1 + flag * 0.5

    conds = conditions.build(feats, min_n=100)
    table = screen.screen_expectancy(conds, r)
    top = table.iloc[0]
    assert top["condition"] == "block.flag=true"
    assert top["passes_fdr"]
    assert top["mean_r"] > top["baseline_mean_r"]


def test_screen_finds_nothing_in_noise():
    """The most important negative test: pure noise must not produce winners."""
    rng = np.random.default_rng(5)
    n = 8000
    feats = pd.DataFrame({f"block.f{i}": rng.standard_normal(n) for i in range(12)})
    r = rng.standard_normal(n) * 0.5 - 0.1

    conds = conditions.build(feats, min_n=100)
    table = screen.screen_expectancy(conds, r)
    assert not table.empty
    assert table["passes_bonferroni"].sum() == 0, "found an edge in pure noise"


def test_screen_event_rate_reports_baseline():
    rng = np.random.default_rng(6)
    n = 6000
    flag = rng.integers(0, 2, size=n).astype(float)
    feats = pd.DataFrame({"block.flag": flag})
    events = (rng.uniform(size=n) < (0.10 + 0.20 * flag))

    conds = conditions.build(feats, min_n=100)
    table = screen.screen_event_rate(conds, events)
    row = table.iloc[0]
    assert row["lift"] > 1.5
    assert row["passes_fdr"]


# --- rule mining --------------------------------------------------------------


def test_mine_rules_recovers_an_interaction():
    rng = np.random.default_rng(7)
    n = 12_000
    a = rng.standard_normal(n)
    b = rng.standard_normal(n)
    feats = pd.DataFrame({"blk.a": a, "blk.b": b, "blk.junk": rng.standard_normal(n)})
    # edge exists only where BOTH are positive - a single feature cannot see it
    r = rng.standard_normal(n) * 0.4 - 0.1 + ((a > 0) & (b > 0)) * 0.6

    mined = rules.mine_rules(feats, r)
    assert not mined.empty
    best = mined.iloc[0]
    assert best["mean_r"] > best["baseline_mean_r"]
    assert "blk.a" in best["rule"] and "blk.b" in best["rule"]


def test_mine_rules_respects_depth_cap():
    from tradelab.config import AnalysisConfig

    rng = np.random.default_rng(8)
    n = 6000
    feats = pd.DataFrame({f"blk.f{i}": rng.standard_normal(n) for i in range(6)})
    r = rng.standard_normal(n)
    mined = rules.mine_rules(feats, r, cfg=AnalysisConfig(max_rule_depth=2, min_leaf_events=50))
    assert (mined["depth"] <= 2).all()


# --- splits -------------------------------------------------------------------


def test_holdout_is_the_newest_slice_and_disjoint():
    n = 10_000
    cfg = SplitConfig(holdout_frac=0.2)
    research = splits.research_slice(n, cfg)
    holdout = splits.holdout_slice_final_check(n, cfg)
    assert research.stop == holdout.start
    assert holdout.stop == n
    assert (holdout.stop - holdout.start) == pytest.approx(n * 0.2, rel=0.01)


def test_walk_forward_never_trains_on_its_own_future():
    n = 10_000
    for fold in splits.walk_forward(n, SplitConfig(n_folds=4)):
        assert fold.train.stop <= fold.test.start
        assert fold.test.stop > fold.test.start


def test_walk_forward_test_blocks_do_not_overlap():
    folds = splits.walk_forward(10_000, SplitConfig(n_folds=4))
    spans = [(f.test.start, f.test.stop) for f in folds]
    for (_, end), (start, _) in zip(spans, spans[1:]):
        assert start >= end


def test_walk_forward_stays_out_of_holdout():
    n = 10_000
    cfg = SplitConfig(holdout_frac=0.2, n_folds=4)
    limit = splits.research_slice(n, cfg).stop
    for fold in splits.walk_forward(n, cfg):
        assert fold.test.stop <= limit
