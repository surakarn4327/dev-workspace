"""The forward-path primitive is load-bearing - test it against hand-built cases."""

import numpy as np

from tradelab.barriers import DOWN, NONE, UP, first_touch, forward_extremes


def test_up_touched_first():
    high = np.array([10.0, 11.0, 12.0, 9.0])
    low = np.array([10.0, 10.0, 10.0, 8.0])
    out, bars, valid = first_touch(high, low, up_level=np.full(4, 11.5), dn_level=np.full(4, 9.0), horizon=2)
    # from bar 0: bars 1..2 -> high 12 >= 11.5 at bar 2, low never <= 9
    assert valid[0] and out[0] == UP and bars[0] == 2


def test_down_touched_first():
    high = np.array([10.0, 10.2, 10.3, 10.0])
    low = np.array([10.0, 9.0, 8.0, 10.0])
    out, bars, valid = first_touch(high, low, np.full(4, 11.0), np.full(4, 9.5), horizon=2)
    assert valid[0] and out[0] == DOWN and bars[0] == 1


def test_neither_touched():
    high = np.full(6, 10.1)
    low = np.full(6, 9.9)
    out, bars, valid = first_touch(high, low, np.full(6, 20.0), np.full(6, 1.0), horizon=3)
    assert valid[0] and out[0] == NONE and bars[0] == -1


def test_same_bar_touch_is_unresolvable():
    """A bar spanning both levels cannot say which came first - must be NONE."""
    high = np.array([10.0, 15.0, 10.0, 10.0])
    low = np.array([10.0, 5.0, 10.0, 10.0])
    out, _, valid = first_touch(high, low, np.full(4, 12.0), np.full(4, 8.0), horizon=2)
    assert valid[0] and out[0] == NONE


def test_tail_is_invalid_not_none():
    """Bars without a full forward window must be flagged, never labelled NONE."""
    n, horizon = 10, 4
    high = np.linspace(10, 11, n)
    low = high - 0.1
    _, _, valid = first_touch(high, low, np.full(n, 12.0), np.full(n, 9.0), horizon=horizon)
    # bar t needs bars t+1 .. t+horizon, so the last usable t is n-1-horizon
    last = n - 1 - horizon
    assert valid[: last + 1].all()
    assert not valid[last + 1 :].any()


def test_nan_level_marked_invalid():
    high = np.full(8, 10.0)
    low = np.full(8, 9.0)
    up = np.full(8, np.nan)
    out, bars, valid = first_touch(high, low, up, np.full(8, 8.0), horizon=2)
    assert not valid.any()
    assert (out == NONE).all() and (bars == -1).all()


def test_chunk_boundary_consistency():
    """Results must not depend on the internal chunk size."""
    from tradelab import barriers

    rng = np.random.default_rng(0)
    n = 5_000
    close = 2000 + np.cumsum(rng.standard_normal(n))
    high = close + np.abs(rng.standard_normal(n))
    low = close - np.abs(rng.standard_normal(n))
    up, dn = close + 3.0, close - 3.0

    ref = first_touch(high, low, up, dn, 30)
    original = barriers._CHUNK
    try:
        barriers._CHUNK = 137
        alt = first_touch(high, low, up, dn, 30)
    finally:
        barriers._CHUNK = original

    for a, b in zip(ref, alt):
        np.testing.assert_array_equal(a, b)


def test_forward_extremes_matches_bruteforce():
    rng = np.random.default_rng(3)
    n, h = 400, 12
    high = rng.random(n) * 10
    low = high - rng.random(n)
    fh, fl, valid = forward_extremes(high, low, h)
    for t in range(n - h - 1):
        assert valid[t]
        assert fh[t] == high[t + 1 : t + 1 + h].max()
        assert fl[t] == low[t + 1 : t + 1 + h].min()
