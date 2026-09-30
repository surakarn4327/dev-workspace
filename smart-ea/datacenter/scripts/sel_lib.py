r"""Phase 4 - Strategy Selector, step 1: which fixed sets to trade next month (rule draft v0, NOT locked yet).

Decisions by the user (2026-09-30): portfolio of several sets at once, rolling 12-month window, no M1 counter-day filter,
measure in R + compounding shown at 1/2/5%. TF = M1/M3/M5 only, never "stop trading" (fallback fills the portfolio).

select(T) reads ONLY adx_asof.as_of(T)  (trades fully closed before T)  -> no future data possible.
Rule (all constants below are fixed BEFORE looking at any result of the exam period):
  window   = trades with trade-day in [day(T)-WIN_DAYS, day(T))
  eligible = n >= MIN_N, mean R > 0 in BOTH halves of the window, and >= NB_SHARE of neighbour sets (one parameter one step
             away, with enough trades) also have mean R > 0
  score    = mean R - SE_MULT * SE   (SE = sd / sqrt(n))       -> shrinks small-sample stars
  portfolio= top K eligible by score; if fewer than K eligible, fill from the rest by score (never trade nothing);
             sets whose trade list is identical to an already chosen set are skipped
Risk: total risk budget f per trade is split equally: each set risks f / K per trade.
"""
import sys, datetime as dt
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np
from adx_asof import as_of, params, to_ts

WIN_DAYS = 365; MIN_N = 200; NB_SHARE = 0.70; SE_MULT = 1.0; K = 5
_EPOCH = dt.date(1970, 1, 1)

def day_of(T):
    return int(to_ts(T) // 86400)

_P = None
def _params():
    global _P
    if _P is None:
        _P = {p["set_id"]: p for p in params()}
    return _P

def _neighbours():
    P = _params(); ids = sorted(P)
    orders = {"tf": sorted({P[i]["tf"] for i in ids}), "adx_p": sorted({P[i]["adx_p"] for i in ids}),
              "ema_p": sorted({P[i]["ema_p"] for i in ids}), "min_adx": sorted({P[i]["min_adx"] for i in ids}),
              "min_gap": sorted({P[i]["min_gap"] for i in ids}), "sl_atr": sorted({P[i]["sl_atr"] for i in ids}),
              "exit_mode": sorted({P[i]["exit_mode"] for i in ids})}
    key = {tuple(P[i][k] for k in orders): i for i in ids}
    nb = {}
    for i in ids:
        out = []
        for k, vals in orders.items():
            j = vals.index(P[i][k])
            for jj in (j - 1, j + 1):
                if 0 <= jj < len(vals):
                    t = tuple((vals[jj] if kk == k else P[i][kk]) for kk in orders)
                    if t in key: out.append(key[t])
        nb[i] = out
    return nb

_NB = None
def select(T, lib=None, k=K):
    """Return list of set_ids chosen at time T (+ diagnostics dict). lib = as_of(T) result (pass to avoid reloading)."""
    global _NB
    if _NB is None: _NB = _neighbours()
    L = lib if lib is not None else as_of(T)
    d0 = day_of(T); a = d0 - WIN_DAYS; mid = d0 - WIN_DAYS // 2
    w = (L["day"] >= a) & (L["day"] < d0)
    rcol = L["r_adj"] if "r_adj" in L else L["r_std"]     # score the strategy as it is traded (exit rule applied)
    sid = L["set_id"][w]; r = rcol[w]; dd = L["day"][w]
    st = {}
    for s in np.unique(sid):
        m = sid == s; rr = r[m]; n = len(rr)
        if n < 2: continue
        h1 = rr[dd[m] < mid]; h2 = rr[dd[m] >= mid]
        mean = rr.mean(); se = rr.std(ddof=1) / np.sqrt(n)
        st[s] = dict(n=n, mean=mean, score=mean - SE_MULT * se,
                     both=(len(h1) > 0 and len(h2) > 0 and h1.mean() > 0 and h2.mean() > 0),
                     sig=(n, round(float(rr.sum()), 9), round(float(np.abs(rr).sum()), 9)))
    elig = []
    for s, v in st.items():
        if v["n"] < MIN_N or not v["both"]: continue
        nbs = [st[j]["mean"] > 0 for j in _NB[s] if j in st and st[j]["n"] >= MIN_N]
        if nbs and np.mean(nbs) >= NB_SHARE: elig.append(s)
    order_e = sorted(elig, key=lambda s: -st[s]["score"])
    order_r = sorted([s for s in st if s not in set(elig)], key=lambda s: -st[s]["score"])
    pick, sigs = [], set()
    for s in order_e + order_r:
        if st[s]["sig"] in sigs: continue
        sigs.add(st[s]["sig"]); pick.append(s)
        if len(pick) == k: break
    return pick, dict(n_eligible=len(elig), n_sets=len(st), from_fallback=max(0, len(pick) - len(elig)))
