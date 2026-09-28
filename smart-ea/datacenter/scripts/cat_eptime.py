"""Task 2 (2026-09-28): time and the picture. For every UP/DOWN episode of M1/M5/M15/H1 (cat_episodes, zigzag k ATR of that TF):
  session   New York clock at the episode's first pivot: asia 17:00-02:59, london 03:00-07:59, newyork 08:00-12:59, late 13:00-16:59
  news      the episode (first pivot -> break confirmed) spans 08:30 ET on a weekday (US data release minute)
  vol       ATR20 of the TF at the first pivot / mean true range of that TF over the previous 5 trading days (known at that bar) -> terciles
Questions: A) where in the day episodes start (per hour of the phase), UP share ; B) does the anatomy (and the UP vs DOWN asymmetry)
change with session / news / volatility?  Everything also on 3 sign-flipped copies (same bars, same timing of volatility, random
direction) -> a time/vol effect that also appears in the null is mechanical (volatility), only real-minus-null is about gold's direction.
usage: python cat_eptime.py [k]  -> cat_eptime_k<k>.pkl"""
import sys, pickle, numpy as np
import cat_bars as CB, cat_struct as CS, cat_episodes as CE
from broker import us_dst
K = float(sys.argv[1]) if len(sys.argv) > 1 else 3.0
M = CB.m1(); FS = CB.full_list(); ND = len(FS); tv = M["tv"].astype(float)
SER = {"real": (M["o"], M["h"], M["l"], M["c"])}
for s in range(3): SER[f"flip{s}"] = CS.signflip_m1(M["o"], M["h"], M["l"], M["c"], tv, M["sid"], 1300 + s)[:4]
TFS = (1, 5, 15, 60); BPD = 1380                                          # ~M1 bars per trading day
def et_min(t):
    t = np.asarray(t, np.int64); e = t - np.where(us_dst(t), 4, 5) * 3600; return (e // 60) % 1440, ((e // 86400) + 3) % 7   # minute of ET day, weekday (0=Mon)
def phase(m):
    h = m // 60; return np.where((h >= 17) | (h < 3), "asia", np.where(h < 8, "london", np.where(h < 13, "newyork", "late")))
OUT = {}
for name in SER:
    OUT[name] = {}
    for tf in TFS:
        B = CS.resample(tf, M["t"], M["sid"], *SER[name], tv); bday = M["day"][B["m1_end"] - 1]; ok = np.isin(bday, FS)
        pc = np.r_[B["c"][0], B["c"][:-1]]; tr = np.maximum(B["h"], pc) - np.minimum(B["l"], pc); cs = np.r_[0, np.cumsum(tr)]
        W = max(20, 5 * BPD // tf); n = len(tr); base = np.full(n, np.nan); base[W:] = (cs[W:n] - cs[:n - W]) / W
        L = []
        for e in CE.episodes(B, K):
            if not ok[e["i_ext"]]: continue
            t0, t1 = B["t"][e["i_first"]], B["t"][e["i_end"]]
            m0, wd0 = et_min(t0); ph = str(phase(m0))
            # news: an 08:30 ET weekday minute inside [t0, t1]
            span = np.arange((t0 // 60) * 60, t1 + 60, 60) if t1 - t0 < 3 * 86400 else np.array([t0])
            mm, wd = et_min(span); news = bool(np.any((mm == 510) & (wd < 5)))
            e.update(minutes=(B["t"][e["i_ext"]] - t0) / 60, phase=ph, et_hour=int(m0 // 60), news=news,
                     vol=e["atr0"] / base[e["i_first"]] if np.isfinite(base[e["i_first"]]) else np.nan)
            L.append(e)
        v = np.array([e["vol"] for e in L]); q = np.nanpercentile(v, [33.3, 66.7])
        for e in L: e["volq"] = -1 if not np.isfinite(e["vol"]) else int(np.searchsorted(q, e["vol"]))
        OUT[name][tf] = L
    print(name, "done", {tf: len(OUT[name][tf]) for tf in TFS}, flush=True)
pickle.dump(OUT, open(f"cat_eptime_k{K:g}.pkl", "wb"))
