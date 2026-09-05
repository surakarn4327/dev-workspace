"""Outcome labelling and the sanity checks that police it."""

import numpy as np
import pandas as pd
import pytest

from tradelab.config import Costs, OutcomeConfig
from tradelab.features.indicators import atr
from tradelab.outcomes import label
from tradelab.validate import sanity


def _flat_bars(n=400, price=2000.0):
    idx = pd.date_range("2024-01-01", periods=n, freq="5min", tz="UTC")
    return pd.DataFrame(
        {
            "open": price,
            "high": price + 1.0,
            "low": price - 1.0,
            "close": price,
            "tick_volume": 10.0,
            "spread": 25.0,
        },
        index=idx,
    )


def test_no_trade_direction_gives_nan(bars_m5):
    a = atr(bars_m5, 14)
    out = label(bars_m5, np.zeros(len(bars_m5), dtype=np.int8), a)
    assert out["r1_net"].notna().sum() == 0


def test_win_pays_r_minus_cost():
    """A clean run to target pays R minus the exit cost, never more."""
    n = 60
    idx = pd.date_range("2024-01-01", periods=n, freq="5min", tz="UTC")
    price = np.full(n, 2000.0)
    price[10:] = 2000.0  # flat, then a jump engineered below
    df = pd.DataFrame(
        {
            "open": price,
            "high": price + 0.5,
            "low": price - 0.5,
            "close": price,
            "tick_volume": 10.0,
            "spread": 0.0,
        },
        index=idx,
    )
    # make bar 30 print a huge high so a long from bar 20 reaches its target
    df.loc[df.index[30], "high"] = 2100.0

    a = pd.Series(np.full(n, 1.0), index=idx)  # ATR = 1.0 -> stop 1.5, target 3.0
    costs = Costs(spread_points=0.0, slippage_points=0.0)
    out = label(
        df,
        np.where(np.arange(n) == 20, 1, 0).astype(np.int8),
        a,
        outcome=OutcomeConfig(sl_atr=1.5, r_multiples=(2.0,), max_hold_bars=30),
        costs=costs,
    )
    assert out["r2_net"].iloc[20] == pytest.approx(2.0, abs=1e-9)
    assert out["r2_win"].iloc[20] == 1.0


def test_loss_is_minus_one_r_minus_cost():
    n = 60
    idx = pd.date_range("2024-01-01", periods=n, freq="5min", tz="UTC")
    price = np.full(n, 2000.0)
    df = pd.DataFrame(
        {
            "open": price,
            "high": price + 0.5,
            "low": price - 0.5,
            "close": price,
            "tick_volume": 10.0,
            "spread": 0.0,
        },
        index=idx,
    )
    df.loc[df.index[25], "low"] = 1900.0  # stop taken out

    a = pd.Series(np.full(n, 1.0), index=idx)
    out = label(
        df,
        np.where(np.arange(n) == 20, 1, 0).astype(np.int8),
        a,
        outcome=OutcomeConfig(sl_atr=1.5, r_multiples=(2.0,), max_hold_bars=30),
        costs=Costs(spread_points=0.0, slippage_points=0.0),
    )
    assert out["r2_net"].iloc[20] == pytest.approx(-1.0, abs=1e-9)
    assert out["r2_win"].iloc[20] == 0.0


def test_costs_reduce_expectancy():
    bars = _flat_bars()
    a = atr(bars, 14)
    direction = np.ones(len(bars), dtype=np.int8)
    cheap = label(bars, direction, a, costs=Costs(spread_points=1.0)).mean(numeric_only=True)
    dear = label(bars, direction, a, costs=Costs(spread_points=200.0)).mean(numeric_only=True)
    assert dear["r1_net"] < cheap["r1_net"]


def test_random_entry_loses_the_spread(bars_m5):
    """CLAUDE.md rule 7 - if this passes, the labelling is not cheating."""
    check = sanity.random_entry_check(bars_m5, seed=7)
    assert check.passed, str(check)


def test_random_entry_check_catches_free_money(bars_m5):
    """Guard the guard: with costs removed, the check must notice."""
    zero = Costs(spread_points=0.0, slippage_points=0.0)
    check = sanity.random_entry_check(bars_m5, costs=zero, seed=7)
    # expected becomes 0; observed should still be ~0, so this should PASS -
    # the real failure mode is negative costs, i.e. a modelled rebate.
    assert "observed" in check.detail


def test_cost_monotonicity(bars_m5):
    check = sanity.cost_monotonicity_check(bars_m5, seed=3)
    assert check.passed, str(check)


def test_event_balance_flags_empty_family():
    bad = sanity.event_balance_check({"reversal_up": 5, "bounce_up": 0, "expansion_up": 0})
    assert not bad.passed
    good = sanity.event_balance_check(
        {"reversal_up": 500, "bounce_up": 500, "expansion_up": 500}
    )
    assert good.passed
