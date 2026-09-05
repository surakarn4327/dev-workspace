"""Turn "would I have entered here" into "how much would I have made".

Triple-barrier labelling: from the close of bar ``t``, place a stop ``sl_atr``
ATR away and a target ``R`` times that distance, then ask which was hit first.
Costs are charged on both ends, so a coin-flip entry comes out negative by
exactly the spread - which is what ``validate.sanity`` checks.

Result is an **R-multiple**, not currency: a win at R=3 pays +3R minus costs,
a loss pays -1R minus costs. Expectancy in R is comparable across symbols,
timeframes and account sizes.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .barriers import DOWN, UP, first_touch
from .config import Costs, OutcomeConfig


def label(
    bars: pd.DataFrame,
    direction: np.ndarray | pd.Series,
    atr_at_entry: np.ndarray | pd.Series,
    *,
    outcome: OutcomeConfig | None = None,
    costs: Costs | None = None,
) -> pd.DataFrame:
    """R-multiple outcome for every bar, for each configured reward multiple.

    ``direction`` is +1 (long), -1 (short) or 0 (no trade). Bars with direction 0
    or an unusable forward window come back as NaN and must be dropped, never
    treated as break-even.
    """
    outcome = outcome or OutcomeConfig()
    costs = costs or Costs()

    direction = np.asarray(direction, dtype=np.int8)
    a = np.asarray(atr_at_entry, dtype=np.float64)
    close = bars["close"].to_numpy(dtype=np.float64)
    high = bars["high"].to_numpy(dtype=np.float64)
    low = bars["low"].to_numpy(dtype=np.float64)
    n = len(bars)

    stop_dist = outcome.sl_atr * a
    tradable = (direction != 0) & np.isfinite(stop_dist) & (stop_dist > 0)

    # Entry is filled worse than the close by half the spread plus slippage.
    entry = close + np.where(direction > 0, costs.entry_cost_price, -costs.entry_cost_price)

    out = pd.DataFrame(index=bars.index)
    out["direction"] = direction
    out["stop_dist"] = np.where(tradable, stop_dist, np.nan)

    for r in outcome.r_multiples:
        tp = entry + direction * r * stop_dist
        sl = entry - direction * stop_dist

        up_level = np.where(direction > 0, tp, sl)
        dn_level = np.where(direction > 0, sl, tp)
        up_level = np.where(tradable, up_level, np.nan)
        dn_level = np.where(tradable, dn_level, np.nan)

        touch, bars_to, valid = first_touch(high, low, up_level, dn_level, outcome.max_hold_bars)

        won = np.where(direction > 0, touch == UP, touch == DOWN)
        lost = np.where(direction > 0, touch == DOWN, touch == UP)

        r_gross = np.full(n, np.nan)
        r_gross[won] = r
        r_gross[lost] = -1.0

        # Neither barrier inside the hold window: close at market on the last bar.
        timeout = valid & tradable & ~won & ~lost
        if timeout.any():
            idx = np.flatnonzero(timeout)
            exit_idx = np.minimum(idx + outcome.max_hold_bars, n - 1)
            exit_px = close[exit_idx]
            move = (exit_px - entry[idx]) * direction[idx]
            r_gross[idx] = move / stop_dist[idx]

        # Exit cost, expressed in R
        exit_cost_r = costs.exit_cost_price / stop_dist
        r_net = r_gross - exit_cost_r

        usable = valid & tradable & np.isfinite(r_net)
        r_net = np.where(usable, r_net, np.nan)

        tag = _tag(r)
        out[f"r{tag}_net"] = r_net
        out[f"r{tag}_win"] = np.where(usable, won.astype(float), np.nan)
        out[f"r{tag}_bars"] = np.where(usable & (bars_to > 0), bars_to.astype(float), np.nan)

    return out


def _tag(r: float) -> str:
    return f"{r:g}".replace(".", "p")


def r_columns(outcome: OutcomeConfig | None = None) -> list[str]:
    outcome = outcome or OutcomeConfig()
    return [f"r{_tag(r)}_net" for r in outcome.r_multiples]


def best_r_column(outcome: OutcomeConfig | None = None) -> str:
    """Default column for headline reporting."""
    outcome = outcome or OutcomeConfig()
    return f"r{_tag(outcome.r_multiples[min(1, len(outcome.r_multiples) - 1)])}_net"
