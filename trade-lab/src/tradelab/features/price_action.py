"""Price-action concepts, made measurable.

The concepts here are the ones traders argue about - fair value gaps, order
blocks, liquidity sweeps, candle range theory, market structure. Each becomes a
number or a flag so the analysis can put a win rate and an expectancy next to it
instead of an opinion.

Every column is strictly causal: a swing pivot is only "confirmed" once the bars
to its right exist, and the confirmation is recorded at the bar where it becomes
knowable, not at the pivot itself. That distinction is what stops a fair-looking
study from quietly reading the future.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .indicators import atr
from .registry import register

#: bars either side required to confirm a swing pivot
SWING_W = 3


# --- swing structure ----------------------------------------------------------


def swing_pivots(df: pd.DataFrame, w: int = SWING_W) -> tuple[pd.Series, pd.Series]:
    """Fractal pivots, shifted to the bar where they become confirmed.

    A high at bar ``i`` is a pivot when it exceeds the ``w`` highs on each side.
    That is only knowable at bar ``i + w``, so the flag is placed there.
    """
    high, low = df["high"], df["low"]
    is_ph = high == high.rolling(2 * w + 1, center=True, min_periods=2 * w + 1).max()
    is_pl = low == low.rolling(2 * w + 1, center=True, min_periods=2 * w + 1).min()
    # shift() on a bool Series yields object dtype (NaN is not a bool), and an
    # object array silently poisons every downstream `&`. Cast it back.
    return (
        is_ph.shift(w).fillna(False).astype(bool),
        is_pl.shift(w).fillna(False).astype(bool),
    )


def _last_pivot_levels(df: pd.DataFrame, w: int = SWING_W) -> pd.DataFrame:
    """Level and age of the most recent confirmed swing high / low."""
    ph, pl = swing_pivots(df, w)
    # value of the pivot bar, recorded at the confirmation bar
    ph_level = df["high"].shift(w).where(ph)
    pl_level = df["low"].shift(w).where(pl)

    out = pd.DataFrame(index=df.index)
    out["last_ph"] = ph_level.ffill()
    out["last_pl"] = pl_level.ffill()
    out["prev_ph"] = ph_level.ffill().shift(1).where(ph).ffill()
    out["prev_pl"] = pl_level.ffill().shift(1).where(pl).ffill()

    pos = pd.Series(np.arange(len(df)), index=df.index)
    out["ph_age"] = pos - pos.where(ph).ffill()
    out["pl_age"] = pos - pos.where(pl).ffill()
    return out


@register("structure")
def structure(df: pd.DataFrame) -> pd.DataFrame:
    a = atr(df, 14).replace(0.0, np.nan)
    piv = _last_pivot_levels(df)
    close = df["close"]
    out = pd.DataFrame(index=df.index)

    out["dist_last_ph_atr"] = (piv["last_ph"] - close) / a
    out["dist_last_pl_atr"] = (close - piv["last_pl"]) / a
    out["swing_range_atr"] = (piv["last_ph"] - piv["last_pl"]) / a
    out["swing_pos"] = (close - piv["last_pl"]) / (piv["last_ph"] - piv["last_pl"]).replace(0.0, np.nan)
    out["ph_age"] = piv["ph_age"]
    out["pl_age"] = piv["pl_age"]

    # Market structure state from the last two confirmed pivots each side
    hh = piv["last_ph"] > piv["prev_ph"]
    hl = piv["last_pl"] > piv["prev_pl"]
    lh = piv["last_ph"] < piv["prev_ph"]
    ll = piv["last_pl"] < piv["prev_pl"]
    out["struct_bull"] = hh & hl
    out["struct_bear"] = lh & ll
    out["struct_mixed"] = ~(out["struct_bull"] | out["struct_bear"])

    # Break of structure: close through the last confirmed pivot
    out["bos_up"] = (close > piv["last_ph"]) & (close.shift(1) <= piv["last_ph"].shift(1))
    out["bos_dn"] = (close < piv["last_pl"]) & (close.shift(1) >= piv["last_pl"].shift(1))
    # Change of character: a break against the prevailing structure
    out["choch_up"] = out["bos_up"] & out["struct_bear"].shift(1).fillna(False)
    out["choch_dn"] = out["bos_dn"] & out["struct_bull"].shift(1).fillna(False)

    # Equal highs / lows - the classic resting-liquidity pattern
    tol = 0.25
    out["equal_highs"] = ((piv["last_ph"] - piv["prev_ph"]).abs() / a) < tol
    out["equal_lows"] = ((piv["last_pl"] - piv["prev_pl"]).abs() / a) < tol
    return out


@register("liquidity")
def liquidity(df: pd.DataFrame) -> pd.DataFrame:
    """Sweeps / stop hunts: take out a prior extreme, then close back inside."""
    a = atr(df, 14).replace(0.0, np.nan)
    piv = _last_pivot_levels(df)
    high, low, close = df["high"], df["low"], df["close"]
    out = pd.DataFrame(index=df.index)

    swept_high = (high > piv["last_ph"]) & (close < piv["last_ph"])
    swept_low = (low < piv["last_pl"]) & (close > piv["last_pl"])
    out["sweep_high"] = swept_high
    out["sweep_low"] = swept_low
    out["sweep_high_depth_atr"] = ((high - piv["last_ph"]) / a).where(swept_high)
    out["sweep_low_depth_atr"] = ((piv["last_pl"] - low) / a).where(swept_low)

    # Was there a sweep in the recent past (not just this bar)?
    for n in (3, 10):
        out[f"sweep_high_within_{n}"] = swept_high.rolling(n, min_periods=1).max().astype(bool)
        out[f"sweep_low_within_{n}"] = swept_low.rolling(n, min_periods=1).max().astype(bool)

    # Distance to the nearest untouched pool of liquidity above / below
    out["liq_above_atr"] = (piv["last_ph"] - close) / a
    out["liq_below_atr"] = (close - piv["last_pl"]) / a
    return out


# --- fair value gaps ----------------------------------------------------------


def _fvg_state(df: pd.DataFrame) -> pd.DataFrame:
    """Track the newest unfilled FVG on each side.

    A bullish FVG forms when ``low[i] > high[i-2]``; the gap is the band between
    them. It is knowable at bar ``i``. We then follow it forward and record how
    much of it price has since filled.
    """
    high = df["high"].to_numpy()
    low = df["low"].to_numpy()
    close = df["close"].to_numpy()
    n = len(df)

    bull_top = np.full(n, np.nan)
    bull_bot = np.full(n, np.nan)
    bull_age = np.full(n, np.nan)
    bull_fill = np.full(n, np.nan)
    bear_top = np.full(n, np.nan)
    bear_bot = np.full(n, np.nan)
    bear_age = np.full(n, np.nan)
    bear_fill = np.full(n, np.nan)

    cur_bull: tuple[float, float, int] | None = None  # (bot, top, born_at)
    cur_bear: tuple[float, float, int] | None = None
    bull_min_seen = np.nan
    bear_max_seen = np.nan

    for i in range(n):
        # A new gap detected using bars i, i-1, i-2 - all in the past or current.
        if i >= 2:
            if low[i] > high[i - 2]:
                cur_bull = (high[i - 2], low[i], i)
                bull_min_seen = low[i]
            elif high[i] < low[i - 2]:
                cur_bear = (high[i], low[i - 2], i)
                bear_max_seen = high[i]

        if cur_bull is not None:
            bot, top, born = cur_bull
            bull_min_seen = min(bull_min_seen, low[i])
            span = top - bot
            filled = 0.0 if span <= 0 else np.clip((top - bull_min_seen) / span, 0.0, 1.0)
            if filled >= 1.0 or close[i] < bot:
                cur_bull = None  # fully mitigated, stop tracking
            else:
                bull_bot[i], bull_top[i] = bot, top
                bull_age[i] = i - born
                bull_fill[i] = filled

        if cur_bear is not None:
            bot, top, born = cur_bear
            bear_max_seen = max(bear_max_seen, high[i])
            span = top - bot
            filled = 0.0 if span <= 0 else np.clip((bear_max_seen - bot) / span, 0.0, 1.0)
            if filled >= 1.0 or close[i] > top:
                cur_bear = None
            else:
                bear_bot[i], bear_top[i] = bot, top
                bear_age[i] = i - born
                bear_fill[i] = filled

    return pd.DataFrame(
        {
            "fvg_bull_bot": bull_bot,
            "fvg_bull_top": bull_top,
            "fvg_bull_age": bull_age,
            "fvg_bull_fill": bull_fill,
            "fvg_bear_bot": bear_bot,
            "fvg_bear_top": bear_top,
            "fvg_bear_age": bear_age,
            "fvg_bear_fill": bear_fill,
        },
        index=df.index,
    )


@register("fvg")
def fvg(df: pd.DataFrame) -> pd.DataFrame:
    st = _fvg_state(df)
    a = atr(df, 14).replace(0.0, np.nan)
    close = df["close"]
    out = pd.DataFrame(index=df.index)

    out["fvg_bull_open"] = st["fvg_bull_top"].notna()
    out["fvg_bear_open"] = st["fvg_bear_top"].notna()
    out["fvg_bull_fill"] = st["fvg_bull_fill"]
    out["fvg_bear_fill"] = st["fvg_bear_fill"]
    out["fvg_bull_age"] = st["fvg_bull_age"]
    out["fvg_bear_age"] = st["fvg_bear_age"]
    out["fvg_bull_dist_atr"] = (close - st["fvg_bull_top"]) / a
    out["fvg_bear_dist_atr"] = (st["fvg_bear_bot"] - close) / a
    out["fvg_bull_size_atr"] = (st["fvg_bull_top"] - st["fvg_bull_bot"]) / a
    out["fvg_bear_size_atr"] = (st["fvg_bear_top"] - st["fvg_bear_bot"]) / a

    inside_bull = (close <= st["fvg_bull_top"]) & (close >= st["fvg_bull_bot"])
    inside_bear = (close <= st["fvg_bear_top"]) & (close >= st["fvg_bear_bot"])
    out["in_fvg_bull"] = inside_bull.fillna(False)
    out["in_fvg_bear"] = inside_bear.fillna(False)
    out["sig_fvg_bull_fresh"] = out["fvg_bull_open"] & (st["fvg_bull_fill"] < 0.5)
    out["sig_fvg_bear_fresh"] = out["fvg_bear_open"] & (st["fvg_bear_fill"] < 0.5)
    return out


# --- order blocks and CRT -----------------------------------------------------


@register("order_block")
def order_block(df: pd.DataFrame) -> pd.DataFrame:
    """Last opposite candle before an impulse leg.

    Impulse = a bar whose range exceeds ``k`` ATR. The order block is the
    preceding candle of the opposite colour; we then track distance and how many
    times price has returned to it.
    """
    a = atr(df, 14).replace(0.0, np.nan)
    body = df["close"] - df["open"]
    rng = (df["high"] - df["low"]) / a
    impulse_up = (rng > 1.5) & (body > 0)
    impulse_dn = (rng > 1.5) & (body < 0)

    prev_bear = body.shift(1) < 0
    prev_bull = body.shift(1) > 0
    ob_bull = impulse_up & prev_bear
    ob_bear = impulse_dn & prev_bull

    bull_top = df["high"].shift(1).where(ob_bull).ffill()
    bull_bot = df["low"].shift(1).where(ob_bull).ffill()
    bear_top = df["high"].shift(1).where(ob_bear).ffill()
    bear_bot = df["low"].shift(1).where(ob_bear).ffill()

    close = df["close"]
    out = pd.DataFrame(index=df.index)
    out["ob_bull_dist_atr"] = (close - bull_top) / a
    out["ob_bear_dist_atr"] = (bear_bot - close) / a
    out["in_ob_bull"] = ((close <= bull_top) & (close >= bull_bot)).fillna(False)
    out["in_ob_bear"] = ((close <= bear_top) & (close >= bear_bot)).fillna(False)

    pos = pd.Series(np.arange(len(df)), index=df.index)
    out["ob_bull_age"] = pos - pos.where(ob_bull).ffill()
    out["ob_bear_age"] = pos - pos.where(ob_bear).ffill()

    # Touch count: how worn out the zone is. The folklore says the first touch
    # is the good one - this is the column that will decide whether that is true.
    out["ob_bull_touches"] = _touch_count(out["in_ob_bull"], out["ob_bull_age"])
    out["ob_bear_touches"] = _touch_count(out["in_ob_bear"], out["ob_bear_age"])
    return out


@register("crt")
def crt(df: pd.DataFrame) -> pd.DataFrame:
    """Candle Range Theory: a large range candle defines the playing field.

    Columns describe where price sits inside the last significant range, and
    whether it has just swept one end and come back in.
    """
    a = atr(df, 14).replace(0.0, np.nan)
    rng_atr = (df["high"] - df["low"]) / a
    anchor = rng_atr > 2.0

    top = df["high"].where(anchor).ffill()
    bot = df["low"].where(anchor).ffill()
    mid = (top + bot) / 2.0
    span = (top - bot).replace(0.0, np.nan)
    close, high, low = df["close"], df["high"], df["low"]

    out = pd.DataFrame(index=df.index)
    out["crt_pos"] = (close - bot) / span
    out["crt_span_atr"] = span / a
    out["crt_dist_mid_atr"] = (close - mid) / a
    pos = pd.Series(np.arange(len(df)), index=df.index)
    out["crt_age"] = pos - pos.where(anchor).ffill()

    out["crt_sweep_high"] = (high > top) & (close < top)
    out["crt_sweep_low"] = (low < bot) & (close > bot)
    out["crt_inside"] = ((close <= top) & (close >= bot)).fillna(False)
    out["sig_crt_reclaim_low"] = out["crt_sweep_low"].rolling(3, min_periods=1).max().astype(bool)
    out["sig_crt_reclaim_high"] = out["crt_sweep_high"].rolling(3, min_periods=1).max().astype(bool)
    return out


@register("candles")
def candles(df: pd.DataFrame) -> pd.DataFrame:
    a = atr(df, 14).replace(0.0, np.nan)
    o, h, l, c = df["open"], df["high"], df["low"], df["close"]
    rng = (h - l).replace(0.0, np.nan)
    body = (c - o).abs()

    out = pd.DataFrame(index=df.index)
    out["body_ratio"] = body / rng
    out["upper_wick_ratio"] = (h - np.maximum(o, c)) / rng
    out["lower_wick_ratio"] = (np.minimum(o, c) - l) / rng
    out["close_pos_in_bar"] = (c - l) / rng
    out["range_atr"] = rng / a
    out["bull_bar"] = c > o

    prev_body_hi = np.maximum(o.shift(1), c.shift(1))
    prev_body_lo = np.minimum(o.shift(1), c.shift(1))
    out["engulf_bull"] = (c > prev_body_hi) & (o < prev_body_lo) & (c > o)
    out["engulf_bear"] = (c < prev_body_lo) & (o > prev_body_hi) & (c < o)
    out["inside_bar"] = (h < h.shift(1)) & (l > l.shift(1))
    out["pin_bull"] = (out["lower_wick_ratio"] > 0.6) & (out["body_ratio"] < 0.3)
    out["pin_bear"] = (out["upper_wick_ratio"] > 0.6) & (out["body_ratio"] < 0.3)

    up = (c > o).astype(int)
    out["consec_up"] = _streak(up.to_numpy(), 1, df.index)
    out["consec_dn"] = _streak(up.to_numpy(), 0, df.index)
    return out


# --- trendlines ---------------------------------------------------------------


@register("trendline")
def trendline(df: pd.DataFrame) -> pd.DataFrame:
    """Auto-drawn trendlines from the last two confirmed pivots on each side.

    Reported as distance to the projected line in ATR units, plus a break flag.
    Two points is the honest minimum: anything fancier starts fitting the line
    to whatever answer we were hoping for.
    """
    a = atr(df, 14).replace(0.0, np.nan)
    w = SWING_W
    ph, pl = swing_pivots(df, w)
    pos = pd.Series(np.arange(len(df)), index=df.index, dtype=float)

    ph_level = df["high"].shift(w).where(ph)
    pl_level = df["low"].shift(w).where(pl)
    ph_pos = (pos - w).where(ph)
    pl_pos = (pos - w).where(pl)

    out = pd.DataFrame(index=df.index)
    for tag, level, at in (("res", ph_level, ph_pos), ("sup", pl_level, pl_pos)):
        y1 = level.ffill()
        x1 = at.ffill()
        y0 = y1.shift(1).where(level.notna()).ffill()
        x0 = x1.shift(1).where(level.notna()).ffill()
        slope = (y1 - y0) / (x1 - x0).replace(0.0, np.nan)
        projected = y1 + slope * (pos - x1)
        out[f"tl_{tag}_dist_atr"] = (df["close"] - projected) / a
        out[f"tl_{tag}_slope_atr"] = slope / a
    out["sig_tl_break_up"] = (out["tl_res_dist_atr"] > 0) & (out["tl_res_dist_atr"].shift(1) <= 0)
    out["sig_tl_break_dn"] = (out["tl_sup_dist_atr"] < 0) & (out["tl_sup_dist_atr"].shift(1) >= 0)
    return out


# --- helpers ------------------------------------------------------------------


def _streak(flags: np.ndarray, want: int, index) -> pd.Series:
    out = np.zeros(flags.shape[0], dtype=np.int32)
    run = 0
    for i, v in enumerate(flags):
        run = run + 1 if v == want else 0
        out[i] = run
    return pd.Series(out, index=index)


def _touch_count(inside: pd.Series, age: pd.Series) -> pd.Series:
    """Count entries into a zone, resetting whenever a newer zone replaces it."""
    ins = inside.fillna(False).to_numpy(dtype=bool)
    ag = age.to_numpy(dtype="float64")
    out = np.zeros(ins.shape[0], dtype=np.int32)
    count = 0
    was_in = False
    for i in range(ins.shape[0]):
        if i > 0 and not (ag[i] > ag[i - 1]):  # zone was replaced (age reset)
            count, was_in = 0, False
        if ins[i] and not was_in:
            count += 1
        was_in = ins[i]
        out[i] = count
    return pd.Series(out, index=inside.index)
