"""Classic indicators, and the standard textbook signals built from them.

Two kinds of column come out of here:

* *state* - continuous readings (``rsi_14``, ``bb_pctb_20``, ``adx_14`` ...)
* *signal* - the boolean textbook setups people actually trade
  (``sig_rsi_oversold``, ``sig_macd_cross_up``, ``sig_golden_cross`` ...)

Reporting both is the point: it lets the analysis answer "does RSI<30 make money"
directly, instead of only "is RSI low here".
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .registry import register


# --- building blocks ----------------------------------------------------------


def ema(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(span=n, adjust=False, min_periods=n).mean()


def rma(s: pd.Series, n: int) -> pd.Series:
    """Wilder's smoothing - what RSI/ATR/ADX are actually defined with."""
    return s.ewm(alpha=1.0 / n, adjust=False, min_periods=n).mean()


def true_range(df: pd.DataFrame) -> pd.Series:
    prev_close = df["close"].shift(1)
    return pd.concat(
        [
            df["high"] - df["low"],
            (df["high"] - prev_close).abs(),
            (df["low"] - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)


def atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    return rma(true_range(df), n)


def rsi(close: pd.Series, n: int = 14) -> pd.Series:
    delta = close.diff()
    gain = rma(delta.clip(lower=0.0), n)
    loss = rma((-delta).clip(lower=0.0), n)
    out = 100.0 - 100.0 / (1.0 + gain / loss.replace(0.0, np.nan))
    # Degenerate runs: no losses at all is RSI 100, no gains at all is RSI 0.
    warm = gain.notna() & loss.notna()
    out = out.mask(warm & (loss == 0.0) & (gain > 0.0), 100.0)
    out = out.mask(warm & (gain == 0.0) & (loss > 0.0), 0.0)
    out = out.mask(warm & (gain == 0.0) & (loss == 0.0), 50.0)
    return out


def adx(df: pd.DataFrame, n: int = 14) -> tuple[pd.Series, pd.Series, pd.Series]:
    up = df["high"].diff()
    dn = -df["low"].diff()
    plus_dm = up.where((up > dn) & (up > 0), 0.0)
    minus_dm = dn.where((dn > up) & (dn > 0), 0.0)
    tr = rma(true_range(df), n)
    plus_di = 100.0 * rma(plus_dm, n) / tr.replace(0.0, np.nan)
    minus_di = 100.0 * rma(minus_dm, n) / tr.replace(0.0, np.nan)
    dx = 100.0 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0.0, np.nan)
    return rma(dx, n), plus_di, minus_di


def _slope(s: pd.Series, n: int) -> pd.Series:
    """Change over n bars, normalised by the value - a unit-free trend measure."""
    return (s - s.shift(n)) / s.abs().replace(0.0, np.nan)


# --- registered blocks --------------------------------------------------------


@register("momentum")
def momentum(df: pd.DataFrame) -> pd.DataFrame:
    close = df["close"]
    out = pd.DataFrame(index=df.index)

    for n in (7, 14, 21):
        out[f"rsi_{n}"] = rsi(close, n)
    out["rsi_14_slope_3"] = out["rsi_14"].diff(3)

    # Stochastic
    for n in (14,):
        ll = df["low"].rolling(n, min_periods=n).min()
        hh = df["high"].rolling(n, min_periods=n).max()
        k = 100.0 * (close - ll) / (hh - ll).replace(0.0, np.nan)
        out[f"stoch_k_{n}"] = k
        out[f"stoch_d_{n}"] = k.rolling(3, min_periods=3).mean()

    # Williams %R and CCI - kept precisely because they should turn out to be
    # near-duplicates of RSI/Stochastic; the redundancy report proves it.
    n = 14
    hh = df["high"].rolling(n, min_periods=n).max()
    ll = df["low"].rolling(n, min_periods=n).min()
    out["willr_14"] = -100.0 * (hh - close) / (hh - ll).replace(0.0, np.nan)

    tp = (df["high"] + df["low"] + close) / 3.0
    sma_tp = tp.rolling(20, min_periods=20).mean()
    mad = (tp - sma_tp).abs().rolling(20, min_periods=20).mean()
    out["cci_20"] = (tp - sma_tp) / (0.015 * mad.replace(0.0, np.nan))

    out["roc_10"] = 100.0 * close.pct_change(10)

    # MACD
    macd_line = ema(close, 12) - ema(close, 26)
    macd_sig = ema(macd_line, 9)
    a = atr(df, 14)
    out["macd_hist_atr"] = (macd_line - macd_sig) / a.replace(0.0, np.nan)
    out["macd_line_atr"] = macd_line / a.replace(0.0, np.nan)
    return out


@register("momentum_signals")
def momentum_signals(df: pd.DataFrame) -> pd.DataFrame:
    close = df["close"]
    out = pd.DataFrame(index=df.index)

    r = rsi(close, 14)
    out["sig_rsi_oversold"] = r < 30
    out["sig_rsi_overbought"] = r > 70
    out["sig_rsi_cross_up_30"] = (r > 30) & (r.shift(1) <= 30)
    out["sig_rsi_cross_dn_70"] = (r < 70) & (r.shift(1) >= 70)
    out["sig_rsi_mid_bull"] = (r >= 45) & (r <= 60)

    macd_line = ema(close, 12) - ema(close, 26)
    macd_sig = ema(macd_line, 9)
    hist = macd_line - macd_sig
    out["sig_macd_cross_up"] = (macd_line > macd_sig) & (macd_line.shift(1) <= macd_sig.shift(1))
    out["sig_macd_cross_dn"] = (macd_line < macd_sig) & (macd_line.shift(1) >= macd_sig.shift(1))
    out["sig_macd_hist_flip_up"] = (hist > 0) & (hist.shift(1) <= 0)
    out["sig_macd_hist_flip_dn"] = (hist < 0) & (hist.shift(1) >= 0)

    # RSI divergence against the last confirmed swing, measured over a window.
    win = 30
    px_low = df["low"].rolling(win, min_periods=win).min()
    px_high = df["high"].rolling(win, min_periods=win).max()
    rsi_at_low = r.rolling(win, min_periods=win).min()
    rsi_at_high = r.rolling(win, min_periods=win).max()
    out["sig_rsi_bull_div"] = (df["low"] <= px_low) & (r > rsi_at_low * 1.05)
    out["sig_rsi_bear_div"] = (df["high"] >= px_high) & (r < rsi_at_high * 0.95)
    return out


@register("trend")
def trend(df: pd.DataFrame) -> pd.DataFrame:
    close = df["close"]
    a = atr(df, 14).replace(0.0, np.nan)
    out = pd.DataFrame(index=df.index)

    for n in (9, 20, 50, 200):
        e = ema(close, n)
        # distance in ATR units, so the number means the same thing in any regime
        out[f"ema{n}_dist_atr"] = (close - e) / a
        out[f"ema{n}_slope"] = _slope(e, 10)

    e20, e50, e200 = ema(close, 20), ema(close, 50), ema(close, 200)
    out["ema_stack_bull"] = (e20 > e50) & (e50 > e200)
    out["ema_stack_bear"] = (e20 < e50) & (e50 < e200)
    out["above_ema200"] = close > e200

    adx_v, plus_di, minus_di = adx(df, 14)
    out["adx_14"] = adx_v
    out["di_spread"] = plus_di - minus_di

    # Parabolic SAR side - the user already trades a SAR flip strategy in smart-ea
    out["sar_side"] = _sar_side(df)
    out["sar_flip"] = out["sar_side"] != out["sar_side"].shift(1)
    return out


@register("trend_signals")
def trend_signals(df: pd.DataFrame) -> pd.DataFrame:
    close = df["close"]
    out = pd.DataFrame(index=df.index)
    e50, e200 = ema(close, 50), ema(close, 200)
    out["sig_golden_cross"] = (e50 > e200) & (e50.shift(1) <= e200.shift(1))
    out["sig_death_cross"] = (e50 < e200) & (e50.shift(1) >= e200.shift(1))

    adx_v, plus_di, minus_di = adx(df, 14)
    out["sig_adx_trending"] = adx_v > 25
    out["sig_adx_ranging"] = adx_v < 20
    out["sig_di_cross_up"] = (plus_di > minus_di) & (plus_di.shift(1) <= minus_di.shift(1))
    out["sig_di_cross_dn"] = (plus_di < minus_di) & (plus_di.shift(1) >= minus_di.shift(1))
    return out


@register("volatility")
def volatility(df: pd.DataFrame) -> pd.DataFrame:
    close = df["close"]
    out = pd.DataFrame(index=df.index)

    a14 = atr(df, 14)
    out["atr_14_pct"] = a14 / close
    # log before z-scoring: ATR is right-skewed, and a raw z-score on it was the
    # bug that made squeezes never fire in smart-ea (see that project's bugs.md)
    log_atr = np.log(a14.replace(0.0, np.nan))
    out["atr_z_100"] = (
        (log_atr - log_atr.rolling(100, min_periods=100).mean())
        / log_atr.rolling(100, min_periods=100).std().replace(0.0, np.nan)
    )
    out["atr_pctile_500"] = a14.rolling(500, min_periods=100).rank(pct=True)

    for n in (20,):
        ma = close.rolling(n, min_periods=n).mean()
        sd = close.rolling(n, min_periods=n).std()
        upper, lower = ma + 2 * sd, ma - 2 * sd
        out[f"bb_pctb_{n}"] = (close - lower) / (upper - lower).replace(0.0, np.nan)
        out[f"bb_width_{n}"] = (upper - lower) / ma.replace(0.0, np.nan)
        out[f"bb_width_pctile_{n}"] = out[f"bb_width_{n}"].rolling(500, min_periods=100).rank(pct=True)

    # Keltner and the Bollinger/Keltner squeeze
    ma20 = close.rolling(20, min_periods=20).mean()
    kc_up, kc_dn = ma20 + 1.5 * a14, ma20 - 1.5 * a14
    bb_up = ma20 + 2 * close.rolling(20, min_periods=20).std()
    bb_dn = ma20 - 2 * close.rolling(20, min_periods=20).std()
    squeeze = (bb_up < kc_up) & (bb_dn > kc_dn)
    out["in_squeeze"] = squeeze
    out["squeeze_bars"] = _run_length(squeeze)

    # Donchian position: 0 = at the low of the range, 1 = at the high
    for n in (20, 50):
        hh = df["high"].rolling(n, min_periods=n).max()
        ll = df["low"].rolling(n, min_periods=n).min()
        out[f"donchian_pos_{n}"] = (close - ll) / (hh - ll).replace(0.0, np.nan)
    return out


@register("volume")
def volume(df: pd.DataFrame) -> pd.DataFrame:
    """Tick-volume features.

    Reminder for whoever reads the results: on FX/metals this is *tick* volume
    (how often the price changed), not traded size. Anything here is weaker
    evidence than the same feature would be on an exchange-traded instrument.
    """
    tv = df["tick_volume"].replace(0.0, np.nan)
    close = df["close"]
    out = pd.DataFrame(index=df.index)

    out["tickvol_rel_20"] = tv / tv.rolling(20, min_periods=20).mean()
    out["tickvol_z_100"] = (
        (tv - tv.rolling(100, min_periods=100).mean())
        / tv.rolling(100, min_periods=100).std().replace(0.0, np.nan)
    )

    direction = np.sign(close.diff()).fillna(0.0)
    obv = (direction * df["tick_volume"]).cumsum()
    out["obv_slope_20"] = _slope(obv.replace(0.0, np.nan), 20)

    # Rolling VWAP (a session VWAP lives in levels.py)
    pv = ((df["high"] + df["low"] + close) / 3.0) * df["tick_volume"]
    vwap_50 = pv.rolling(50, min_periods=50).sum() / df["tick_volume"].rolling(
        50, min_periods=50
    ).sum().replace(0.0, np.nan)
    out["vwap50_dist_atr"] = (close - vwap_50) / atr(df, 14).replace(0.0, np.nan)
    return out


# --- helpers ------------------------------------------------------------------


def _run_length(flag: pd.Series) -> pd.Series:
    """How many consecutive bars up to and including t the flag has been True."""
    f = flag.fillna(False).to_numpy(dtype=bool)
    out = np.zeros(f.shape[0], dtype=np.int32)
    run = 0
    for i, v in enumerate(f):
        run = run + 1 if v else 0
        out[i] = run
    return pd.Series(out, index=flag.index)


def _sar_side(df: pd.DataFrame, start: float = 0.02, inc: float = 0.02, max_af: float = 0.2):
    """+1 when SAR sits below price (uptrend), -1 above (downtrend).

    Standard Wilder SAR. Only past bars feed each step, so it is causal.
    """
    high = df["high"].to_numpy()
    low = df["low"].to_numpy()
    n = high.shape[0]
    side = np.zeros(n, dtype=np.int8)
    if n < 2:
        return pd.Series(side, index=df.index)

    bull = high[1] >= high[0]
    af = start
    sar = low[0] if bull else high[0]
    ep = high[0] if bull else low[0]
    side[0] = 1 if bull else -1

    for i in range(1, n):
        sar = sar + af * (ep - sar)
        if bull:
            sar = min(sar, low[i - 1], low[max(i - 2, 0)])
            if low[i] < sar:
                bull, sar, ep, af = False, ep, low[i], start
            elif high[i] > ep:
                ep, af = high[i], min(af + inc, max_af)
        else:
            sar = max(sar, high[i - 1], high[max(i - 2, 0)])
            if high[i] > sar:
                bull, sar, ep, af = True, ep, high[i], start
            elif low[i] < ep:
                ep, af = low[i], min(af + inc, max_af)
        side[i] = 1 if bull else -1
    return pd.Series(side, index=df.index)
