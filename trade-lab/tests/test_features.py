"""Feature correctness, and the causality guarantee everything else rests on."""

import numpy as np
import pandas as pd
import pytest

from tradelab import features
from tradelab.features.indicators import atr, ema, rsi
from tradelab.validate import lookahead


def test_all_blocks_produce_columns(bars_m5):
    feats = features.build(bars_m5)
    assert feats.index.equals(bars_m5.index)
    assert feats.shape[1] > 100, "expected a wide feature set"
    for name in features.names():
        cols = [c for c in feats.columns if c.startswith(f"{name}.")]
        assert cols, f"block {name!r} produced nothing"


def test_features_are_all_float(bars_m5):
    feats = features.build(bars_m5)
    assert set(feats.dtypes.unique()) == {np.dtype("float64")}


def test_no_column_is_entirely_nan(bars_m5):
    feats = features.build(bars_m5)
    empty = [c for c in feats.columns if feats[c].notna().sum() == 0]
    assert not empty, f"all-NaN feature columns: {empty}"


def test_no_lookahead_anywhere(bars_m5):
    """The whole study is worthless if this fails - see CLAUDE.md rule 5."""
    lookahead.assert_causal(bars_m5, features.build)


def test_lookahead_detector_catches_a_planted_leak(bars_m5):
    """Guard the guard: a deliberately future-reading feature must be flagged."""

    def leaky(bars):
        out = features.build(bars)
        out["planted.tomorrow_close"] = bars["close"].shift(-1)
        return out

    leaks = lookahead.check(bars_m5, leaky)
    assert any(r.column == "planted.tomorrow_close" for r in leaks)


def test_rsi_bounds_and_extremes():
    up_only = pd.Series(np.arange(1, 200, dtype=float))
    r = rsi(up_only, 14).dropna()
    assert (r > 99.9).all()

    dn_only = pd.Series(np.arange(200, 1, -1, dtype=float))
    r = rsi(dn_only, 14).dropna()
    assert (r < 0.1).all()

    rng = np.random.default_rng(0)
    noisy = pd.Series(100 + np.cumsum(rng.standard_normal(1000)))
    r = rsi(noisy, 14).dropna()
    assert r.between(0, 100).all()


def test_ema_matches_pandas_ewm():
    s = pd.Series(np.arange(100, dtype=float))
    expected = s.ewm(span=10, adjust=False, min_periods=10).mean()
    pd.testing.assert_series_equal(ema(s, 10), expected)


def test_atr_is_positive(bars_m5):
    a = atr(bars_m5, 14).dropna()
    assert (a > 0).all()


def test_swing_pivot_flag_is_confirmed_not_centred(bars_m5):
    """A pivot flag must sit at the bar where it becomes knowable."""
    from tradelab.features.price_action import swing_pivots

    w = 3
    ph, _ = swing_pivots(bars_m5, w)
    hits = np.flatnonzero(ph.to_numpy())
    assert hits.size > 0
    for i in hits[:50]:
        pivot = i - w
        if pivot - w < 0 or i >= len(bars_m5):
            continue
        window = bars_m5["high"].to_numpy()[pivot - w : pivot + w + 1]
        assert bars_m5["high"].to_numpy()[pivot] == window.max()


def test_fvg_gap_geometry():
    """A bullish FVG requires low[i] > high[i-2]; check the tracked band matches."""
    from tradelab.features.price_action import _fvg_state

    idx = pd.date_range("2024-01-01", periods=6, freq="5min", tz="UTC")
    df = pd.DataFrame(
        {
            "open": [10, 10, 12, 12.5, 12.5, 12.5],
            # high[1] is tall on purpose so no *second* gap forms at bar 3
            "high": [10.5, 12.5, 13.0, 13.0, 13.0, 13.0],
            "low": [9.5, 9.6, 11.0, 12.0, 12.2, 12.2],
            "close": [10.2, 10.4, 12.8, 12.6, 12.7, 12.7],
            "tick_volume": [1.0] * 6,
            "spread": [25.0] * 6,
        },
        index=idx,
    )
    st = _fvg_state(df)
    # bar 2: low 11.0 > high[0] 10.5 -> gap band 10.5 .. 11.0
    assert st["fvg_bull_bot"].iloc[2] == pytest.approx(10.5)
    assert st["fvg_bull_top"].iloc[2] == pytest.approx(11.0)
    assert st["fvg_bull_age"].iloc[2] == 0
    assert st["fvg_bull_age"].iloc[3] == 1
    assert st["fvg_bull_age"].iloc[5] == 3
    # nothing ever traded back into the band, so it stays unfilled
    assert st["fvg_bull_fill"].iloc[5] == pytest.approx(0.0)


def test_fvg_newer_gap_replaces_older():
    """Only the newest gap on a side is tracked - a fresh one resets age to 0."""
    from tradelab.features.price_action import _fvg_state

    idx = pd.date_range("2024-01-01", periods=6, freq="5min", tz="UTC")
    df = pd.DataFrame(
        {
            "open": [10, 10, 12, 12.5, 12.5, 12.5],
            "high": [10.5, 10.6, 13.0, 13.0, 13.0, 13.0],
            "low": [9.5, 9.6, 11.0, 12.0, 12.2, 12.2],
            "close": [10.2, 10.4, 12.8, 12.6, 12.7, 12.7],
            "tick_volume": [1.0] * 6,
            "spread": [25.0] * 6,
        },
        index=idx,
    )
    st = _fvg_state(df)
    # bar 3 opens a second gap (low 12.0 > high[1] 10.6), so age restarts
    assert st["fvg_bull_age"].iloc[2] == 0
    assert st["fvg_bull_age"].iloc[3] == 0
    assert st["fvg_bull_bot"].iloc[3] == pytest.approx(10.6)
    assert st["fvg_bull_top"].iloc[3] == pytest.approx(12.0)


def test_build_rejects_unknown_block(bars_m5):
    with pytest.raises(KeyError):
        features.build(bars_m5, only=["does_not_exist"])
