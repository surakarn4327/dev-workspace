"""Event detection: do the three families fire, and do they mean what they say."""

import numpy as np

from tradelab import events as ev
from tradelab.config import EventConfig


def test_all_three_families_fire(bars_m5):
    labels, stats = ev.detect(bars_m5)
    for family, members in ev.FAMILIES.items():
        n = sum(stats.counts[ev.LABELS[m]] for m in members)
        assert n > 0, f"family {family!r} never fired: {stats.report()}"


def test_direction_matches_label(bars_m5):
    labels, _ = ev.detect(bars_m5)
    up = labels["event"].isin([ev.REVERSAL_UP, ev.BOUNCE_UP, ev.EXPANSION_UP])
    dn = labels["event"].isin([ev.REVERSAL_DOWN, ev.BOUNCE_DOWN, ev.EXPANSION_DOWN])
    assert (labels.loc[up, "direction"] == 1).all()
    assert (labels.loc[dn, "direction"] == -1).all()
    assert (labels.loc[~(up | dn), "direction"] == 0).all()


def test_events_only_where_forward_window_exists(bars_m5):
    labels, _ = ev.detect(bars_m5)
    labelled = labels["event"] != ev.NONE
    assert labels.loc[labelled, "forward_valid"].all()


def test_expansion_requires_a_real_move(bars_m5):
    cfg = EventConfig()
    labels, _ = ev.detect(bars_m5, cfg)
    up = labels["event"] == ev.EXPANSION_UP
    assert (labels.loc[up, "fwd_up_atr"] >= cfg.expansion_atr).all()
    assert (labels.loc[up, "fwd_dn_atr"] <= cfg.expansion_max_adverse_atr).all()


def test_reversal_requires_a_swing_and_a_clean_turn(bars_m5):
    cfg = EventConfig()
    labels, _ = ev.detect(bars_m5, cfg)
    up = labels["event"] == ev.REVERSAL_UP
    if up.any():
        assert (labels.loc[up, "fwd_up_atr"] >= cfg.reversal_atr).all()
        assert (labels.loc[up, "fwd_dn_atr"] < cfg.bounce_atr).all()


def test_stricter_thresholds_produce_fewer_events(bars_m5):
    loose, loose_stats = ev.detect(bars_m5, EventConfig(expansion_atr=2.0))
    tight, tight_stats = ev.detect(bars_m5, EventConfig(expansion_atr=6.0))
    n_loose = loose_stats.counts["expansion_up"] + loose_stats.counts["expansion_down"]
    n_tight = tight_stats.counts["expansion_up"] + tight_stats.counts["expansion_down"]
    assert n_tight < n_loose


def test_family_mask_rejects_unknown_family(bars_m5):
    labels, _ = ev.detect(bars_m5)
    try:
        ev.family_mask(labels, "not_a_family")
    except KeyError:
        return
    raise AssertionError("expected KeyError for unknown family")


def test_stats_report_is_printable(bars_m5):
    _, stats = ev.detect(bars_m5)
    text = stats.report()
    assert "reversal_up" in text and "bars" in text
    assert stats.valid_forward > 0
    assert stats.swing_highs > 0 and stats.swing_lows > 0


def test_detection_is_causal_in_thresholds(bars_m5):
    """Event labels may look forward, but only within the configured horizon.

    Truncating the series must not change labels more than `horizon` bars from
    the end - otherwise the horizon is not being respected.
    """
    cfg = EventConfig(horizon_bars=30)
    full, _ = ev.detect(bars_m5, cfg)
    cut = len(bars_m5) // 2
    part, _ = ev.detect(bars_m5.iloc[:cut], cfg)
    margin = cfg.horizon_bars + cfg.swing_window + 1
    a = full["event"].to_numpy()[: cut - margin]
    b = part["event"].to_numpy()[: cut - margin]
    np.testing.assert_array_equal(a, b)
