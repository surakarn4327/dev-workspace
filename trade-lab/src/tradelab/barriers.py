"""Forward-path primitives.

Everything that needs to ask "what did price do after bar t" goes through this
module: event detection and trade outcome labelling both reduce to "which of two
price levels was touched first, and how long did it take".

Written once, tested once, reused everywhere - a subtle off-by-one here would
silently corrupt every number the project produces.

Note on look-ahead: these functions deliberately read the future. That is correct
for *labels*. Features must never call them.
"""

from __future__ import annotations

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

#: rows processed per chunk, chosen so a chunk stays well under ~100 MB
_CHUNK = 20_000

UP, NONE, DOWN = 1, 0, -1


def _as_f64(a) -> np.ndarray:
    return np.ascontiguousarray(np.asarray(a, dtype=np.float64))


def first_touch(
    high,
    low,
    up_level,
    dn_level,
    horizon: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """For every bar ``t``, scan bars ``t+1 .. t+horizon``.

    Returns ``(outcome, bars_to_touch, valid)``:

    * ``outcome`` - ``UP`` if ``up_level[t]`` was reached first, ``DOWN`` if
      ``dn_level[t]`` was reached first, ``NONE`` if neither happened in time.
    * ``bars_to_touch`` - 1-based bar offset of the touch, ``-1`` when ``NONE``.
    * ``valid`` - ``False`` for the trailing bars that have no full window, and
      wherever a level is NaN. Callers must drop invalid rows rather than
      treating them as ``NONE``, otherwise the tail of the series silently
      becomes a block of "nothing happened" labels.

    When both levels are touched inside the same bar the outcome is ``NONE``:
    bar data cannot say which came first, and guessing would bias every result.
    """
    high = _as_f64(high)
    low = _as_f64(low)
    up_level = _as_f64(up_level)
    dn_level = _as_f64(dn_level)

    n = high.shape[0]
    if not (low.shape[0] == up_level.shape[0] == dn_level.shape[0] == n):
        raise ValueError("first_touch: all inputs must have the same length")
    if horizon < 1:
        raise ValueError("first_touch: horizon must be >= 1")

    outcome = np.zeros(n, dtype=np.int8)
    bars = np.full(n, -1, dtype=np.int32)
    valid = np.zeros(n, dtype=bool)

    # last bar that still has `horizon` bars of future available
    last = n - horizon - 1
    if last < 0:
        return outcome, bars, valid

    fut_high = sliding_window_view(high[1:], horizon)  # row i -> bars i+1..i+horizon
    fut_low = sliding_window_view(low[1:], horizon)

    for lo in range(0, last + 1, _CHUNK):
        hi = min(lo + _CHUNK, last + 1)
        wh = fut_high[lo:hi]
        wl = fut_low[lo:hi]
        up = up_level[lo:hi, None]
        dn = dn_level[lo:hi, None]

        up_hit = wh >= up
        dn_hit = wl <= dn

        any_up = up_hit.any(axis=1)
        any_dn = dn_hit.any(axis=1)
        # argmax on a boolean row gives the first True, or 0 when all-False,
        # hence the any_* guards below.
        first_up = np.where(any_up, up_hit.argmax(axis=1), np.iinfo(np.int32).max)
        first_dn = np.where(any_dn, dn_hit.argmax(axis=1), np.iinfo(np.int32).max)

        chunk_outcome = np.zeros(hi - lo, dtype=np.int8)
        chunk_bars = np.full(hi - lo, -1, dtype=np.int32)

        up_first = first_up < first_dn
        dn_first = first_dn < first_up
        chunk_outcome[up_first] = UP
        chunk_outcome[dn_first] = DOWN
        chunk_bars[up_first] = first_up[up_first] + 1
        chunk_bars[dn_first] = first_dn[dn_first] + 1

        outcome[lo:hi] = chunk_outcome
        bars[lo:hi] = chunk_bars
        valid[lo:hi] = True

    bad_level = ~np.isfinite(up_level) | ~np.isfinite(dn_level)
    valid &= ~bad_level
    outcome[bad_level] = NONE
    bars[bad_level] = -1
    return outcome, bars, valid


def forward_extremes(high, low, horizon: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Highest high and lowest low over ``t+1 .. t+horizon``.

    Returns ``(fwd_high, fwd_low, valid)``; invalid rows hold NaN.
    """
    high = _as_f64(high)
    low = _as_f64(low)
    n = high.shape[0]

    fwd_high = np.full(n, np.nan)
    fwd_low = np.full(n, np.nan)
    valid = np.zeros(n, dtype=bool)

    last = n - horizon - 1
    if last < 0:
        return fwd_high, fwd_low, valid

    wh = sliding_window_view(high[1:], horizon)
    wl = sliding_window_view(low[1:], horizon)
    for lo in range(0, last + 1, _CHUNK):
        hi = min(lo + _CHUNK, last + 1)
        fwd_high[lo:hi] = wh[lo:hi].max(axis=1)
        fwd_low[lo:hi] = wl[lo:hi].min(axis=1)
        valid[lo:hi] = True
    return fwd_high, fwd_low, valid


def backward_extremes(high, low, window: int) -> tuple[np.ndarray, np.ndarray]:
    """Highest high and lowest low over ``t-window .. t-1`` (strictly causal).

    Safe to use inside features: bar ``t`` itself is excluded.
    """
    import pandas as pd

    h = pd.Series(_as_f64(high))
    l = pd.Series(_as_f64(low))
    return (
        h.shift(1).rolling(window, min_periods=window).max().to_numpy(),
        l.shift(1).rolling(window, min_periods=window).min().to_numpy(),
    )
