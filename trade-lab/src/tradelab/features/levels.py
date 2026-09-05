"""Reference levels: prior sessions, round numbers, volume profile.

All levels are frozen before the bar that uses them - yesterday's high is only
available from today's first bar onward, never during yesterday.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .indicators import atr
from .registry import register

#: session windows in UTC. Exness server time is UTC+2/+3; UTC keeps the study
#: free of DST bookkeeping, and the session flags below are what actually matter.
SESSIONS: dict[str, tuple[int, int]] = {
    "asia": (0, 8),
    "london": (7, 16),
    "ny": (13, 21),
}


@register("prior_periods")
def prior_periods(df: pd.DataFrame) -> pd.DataFrame:
    """Distance to the previous day's / week's high, low and close."""
    a = atr(df, 14).replace(0.0, np.nan)
    close = df["close"]
    out = pd.DataFrame(index=df.index)

    # to_period() drops the timezone; strip it explicitly so pandas stays quiet.
    naive = df.index.tz_convert(None)
    for tag, freq in (("d", "D"), ("w", "W"), ("m", "M")):
        grp = naive.to_period(freq)
        agg = df.groupby(grp).agg(hi=("high", "max"), lo=("low", "min"), cl=("close", "last"))
        prev = agg.shift(1)
        mapped = prev.reindex(grp)
        mapped.index = df.index
        out[f"prev_{tag}_high_dist_atr"] = (mapped["hi"] - close) / a
        out[f"prev_{tag}_low_dist_atr"] = (close - mapped["lo"]) / a
        out[f"prev_{tag}_close_dist_atr"] = (close - mapped["cl"]) / a
        span = (mapped["hi"] - mapped["lo"]).replace(0.0, np.nan)
        out[f"prev_{tag}_range_pos"] = (close - mapped["lo"]) / span
    return out


@register("session_levels")
def session_levels(df: pd.DataFrame) -> pd.DataFrame:
    """Running high/low of each session, and distance to the Asia range.

    The Asia range is the one scalpers lean on: it is complete before London
    opens, so it is a genuine level rather than a moving target.
    """
    a = atr(df, 14).replace(0.0, np.nan)
    close = df["close"]
    hour = df.index.hour
    naive = df.index.tz_convert(None)
    day = naive.to_period("D")
    out = pd.DataFrame(index=df.index)

    asia_mask = (hour >= SESSIONS["asia"][0]) & (hour < SESSIONS["asia"][1])
    asia = df.loc[asia_mask].groupby(naive[asia_mask].to_period("D")).agg(
        hi=("high", "max"), lo=("low", "min")
    )
    mapped = asia.reindex(day)
    mapped.index = df.index
    # During Asia itself the range is still forming, so blank it out to avoid
    # comparing price against a level that includes the current bar.
    forming = pd.Series(asia_mask, index=df.index)
    out["asia_high_dist_atr"] = ((mapped["hi"] - close) / a).mask(forming)
    out["asia_low_dist_atr"] = ((close - mapped["lo"]) / a).mask(forming)
    span = (mapped["hi"] - mapped["lo"]).replace(0.0, np.nan)
    out["asia_range_pos"] = ((close - mapped["lo"]) / span).mask(forming)
    out["asia_range_atr"] = (span / a).mask(forming)
    out["above_asia_high"] = (close > mapped["hi"]).where(~forming).fillna(False)
    out["below_asia_low"] = (close < mapped["lo"]).where(~forming).fillna(False)

    # Session VWAP, reset daily - strictly a running figure, so causal.
    tp = (df["high"] + df["low"] + df["close"]) / 3.0
    pv = (tp * df["tick_volume"]).groupby(day).cumsum()
    vol = df["tick_volume"].groupby(day).cumsum().replace(0.0, np.nan)
    out["session_vwap_dist_atr"] = (close - pv / vol) / a

    # Distance travelled since the day opened
    day_open = df["open"].groupby(day).transform("first")
    out["day_move_atr"] = (close - day_open) / a
    return out


@register("round_numbers")
def round_numbers(df: pd.DataFrame) -> pd.DataFrame:
    """Distance to psychological levels.

    Steps are chosen for gold-sized prices; on a 4-digit FX pair they still work
    because everything is expressed in ATR units.
    """
    a = atr(df, 14).replace(0.0, np.nan)
    close = df["close"]
    out = pd.DataFrame(index=df.index)
    for step in (1.0, 5.0, 10.0, 50.0):
        nearest = (close / step).round() * step
        tag = str(step).replace(".", "p")
        out[f"round_{tag}_dist_atr"] = (close - nearest) / a
        out[f"round_{tag}_abs_atr"] = (close - nearest).abs() / a
    return out


@register("volume_profile")
def volume_profile(df: pd.DataFrame, lookback: int = 480, bins: int = 24) -> pd.DataFrame:
    """Rolling tick-volume profile: POC and value-area edges.

    ⚠️ On FX/metals this is built from *tick* volume, not traded size, so treat
    a POC finding as weaker evidence than the same finding on futures. The
    reporting layer repeats this caveat next to any volume-derived result.

    Computed on a coarse grid over a rolling window ending at ``t-1`` so the
    current bar never contributes to its own level.
    """
    a = atr(df, 14).replace(0.0, np.nan).to_numpy()
    close = df["close"].to_numpy()
    tp = ((df["high"] + df["low"] + df["close"]) / 3.0).to_numpy()
    vol = df["tick_volume"].to_numpy()
    n = len(df)

    poc = np.full(n, np.nan)
    val = np.full(n, np.nan)
    vah = np.full(n, np.nan)

    step = 8  # recompute every `step` bars; levels move slowly at this window
    last: tuple[float, float, float] | None = None
    for i in range(n):
        if i < lookback:
            continue
        if (i % step) == 0 or last is None:
            lo_i, hi_i = i - lookback, i  # window is [i-lookback, i-1]
            p = tp[lo_i:hi_i]
            w = vol[lo_i:hi_i]
            if w.sum() <= 0:
                continue
            edges = np.linspace(p.min(), p.max(), bins + 1)
            if not np.isfinite(edges).all() or edges[0] == edges[-1]:
                continue
            hist, _ = np.histogram(p, bins=edges, weights=w)
            centers = (edges[:-1] + edges[1:]) / 2.0
            k = int(np.argmax(hist))
            # grow outward from the POC until 70% of volume is enclosed
            total = hist.sum()
            lo_k = hi_k = k
            acc = hist[k]
            while acc < 0.70 * total and (lo_k > 0 or hi_k < bins - 1):
                left = hist[lo_k - 1] if lo_k > 0 else -1.0
                right = hist[hi_k + 1] if hi_k < bins - 1 else -1.0
                if right >= left:
                    hi_k += 1
                    acc += hist[hi_k]
                else:
                    lo_k -= 1
                    acc += hist[lo_k]
            last = (centers[k], centers[lo_k], centers[hi_k])
        poc[i], val[i], vah[i] = last

    out = pd.DataFrame(index=df.index)
    out["poc_dist_atr"] = (close - poc) / a
    out["val_dist_atr"] = (close - val) / a
    out["vah_dist_atr"] = (close - vah) / a
    out["in_value_area"] = pd.Series((close >= val) & (close <= vah), index=df.index).fillna(False)
    out["poc_abs_atr"] = np.abs(close - poc) / a
    return out
