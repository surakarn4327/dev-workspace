"""Regime PER TIMEFRAME (user rule 2026-09-28: every TF has its own trend / pullback / sideway; an H1 uptrend's pause is a downtrend
on M1/M5). For each TF (M1, M5, M15, H1, H4) the regime at each bar is judged ONLY from that TF's own confirmed zigzag pivots (3 ATR):
  UP   = last confirmed swing high > the one before AND last confirmed swing low > the one before
  DOWN = both lower            SIDE = anything else
Measured on the real series and on 3 sign-flipped copies (same bars and volatility, random direction):
 A) how often each regime occurs: episodes per day, median duration, share of time
 B) inside each regime: after a big bar (>= 2 ATR, body >= 50%) WITH the regime vs AGAINST it -> share of next bars closing the other way
 C) inside each regime: rejection wicks (pinbar) pointing WITH the regime (lower wick in UP, upper wick in DOWN) vs against
 D) pullback depth inside each regime: counter-leg / previous with-regime leg (median) and share of shallow (< 38%) pullbacks
 E) inside bars per 100 bars by regime
UP vs DOWN in the SAME TF answers whether behaviour is symmetric (a real 'buy the dip' bias shows as UP != mirror of DOWN)."""
import numpy as np
import cat_bars as CB, cat_struct as CS
M = CB.m1(); FS = CB.full_list(); ND = len(FS); tv = M["tv"].astype(float)
SER = {"real": (M["o"], M["h"], M["l"], M["c"])}
for s in range(3): SER[f"flip{s}"] = CS.signflip_m1(M["o"], M["h"], M["l"], M["c"], tv, M["sid"], 1100 + s)[:4]
TFS = (1, 5, 15, 60, 240)
def regime(B):
    idx, p, kind, conf = CS.zigzag(B["h"], B["l"], B["c"], B["atr"])
    st = np.zeros(len(p) + 1, int); lastH = []; lastL = []
    for k in range(len(p)):
        (lastH if kind[k] > 0 else lastL).append(p[k])
        if len(lastH) >= 2 and len(lastL) >= 2:
            st[k + 1] = 1 if (lastH[-1] > lastH[-2] and lastL[-1] > lastL[-2]) else (-1 if (lastH[-1] < lastH[-2] and lastL[-1] < lastL[-2]) else 0)
        else: st[k + 1] = 0
    ncf = np.searchsorted(conf, np.arange(len(B["c"])), "right")        # pivots confirmed at or before each bar
    return st[ncf], (idx, p, kind, conf)
def stats(name, tf):
    B = CS.resample(tf, M["t"], M["sid"], *SER[name], tv); full = np.isin(M["day"][B["m1_end"] - 1], FS)
    R, (idx, p, kind, conf) = regime(B); o, h, l, c, a = B["o"], B["h"], B["l"], B["c"], B["atr"]; n = len(c)
    out = {}; rng = h - l; col = np.sign(c - o); okb = np.isfinite(a)
    # A) episodes
    ch = np.r_[True, R[1:] != R[:-1]]; starts = np.flatnonzero(ch); ends = np.r_[starts[1:], n]
    for rv, nm in ((1, "UP"), (-1, "DOWN"), (0, "SIDE")):
        e = [(s_, e_) for s_, e_ in zip(starts, ends) if R[s_] == rv and full[s_]]
        out[("A", nm, "per_day")] = len(e) / ND
        out[("A", nm, "median_min")] = np.median([(e_ - s_) * tf for s_, e_ in e]) if e else np.nan
        out[("A", nm, "time_share")] = np.sum((R == rv) & full) / max(1, full.sum())
    # B) reversal after big bar, by regime and relation
    nxt = np.r_[B["sid"][1:] == B["sid"][:-1], False]
    big = okb & (rng >= 2 * a) & (np.abs(c - o) >= 0.5 * rng) & full & nxt
    for rv, nm in ((1, "UP"), (-1, "DOWN")):
        for rel in ("with", "against"):
            i = np.flatnonzero(big & (R == rv) & ((col == rv) if rel == "with" else (col == -rv)))
            out[("B", nm, rel)] = (np.mean(col[i + 1] == -col[i]) if len(i) else np.nan, len(i))
    # C) pinbar wick direction by regime
    body = np.abs(c - o); up_w = h - np.maximum(o, c); dn_w = np.minimum(o, c) - l
    pin = okb & (rng >= a) & (body <= 0.3 * rng) & ((up_w >= 0.6 * rng) | (dn_w >= 0.6 * rng)) & full
    for rv, nm in ((1, "UP"), (-1, "DOWN")):
        m = pin & (R == rv); withw = (dn_w >= 0.6 * rng) if rv > 0 else (up_w >= 0.6 * rng)
        out[("C", nm, "with_share")] = (np.mean(withw[m]) if m.any() else np.nan, int(m.sum()))
    # D) pullback depth inside regimes (counter-leg vs the with-regime leg before it), regime taken at the counter-leg's start pivot
    for rv, nm in ((1, "UP"), (-1, "DOWN")):
        ratios = []
        for k in range(2, len(p)):
            leg_prev = p[k - 1] - p[k - 2]; leg = p[k] - p[k - 1]
            if np.sign(leg_prev) == rv and np.sign(leg) == -rv and R[idx[k - 1]] == rv and full[idx[k]]:
                ratios.append(abs(leg) / abs(leg_prev))
        ratios = np.array(ratios)
        out[("D", nm, "median_retr")] = (np.median(ratios) if len(ratios) else np.nan, len(ratios))
        out[("D", nm, "shallow_share")] = (np.mean(ratios < 0.382) if len(ratios) else np.nan, len(ratios))
    # E) inside bars per 100 bars by regime
    same = np.r_[False, B["sid"][1:] == B["sid"][:-1]]; ins = same & (h < np.r_[h[0], h[:-1]]) & (l > np.r_[l[0], l[:-1]]) & full
    for rv, nm in ((1, "UP"), (-1, "DOWN"), (0, "SIDE")):
        m = (R == rv) & full; out[("E", nm, "inside_per100")] = 100 * np.sum(ins & m) / max(1, m.sum())
    return out
RES = {}
for tf in TFS:
    RES[tf] = {nm: stats(nm, tf) for nm in SER}
    print(f"M{tf} done", flush=True)
import pickle; pickle.dump(RES, open("cat_regime.pkl", "wb"))
def v(x): return x[0] if isinstance(x, tuple) else x
def show(section, title, keys, fmt="{:.2f}"):
    print(f"\n{title}")
    print("  TF   | " + " | ".join(f"{k[1]}:{k[2]}" for k in keys))
    for tf in TFS:
        r = RES[tf]["real"]; f = [RES[tf][f"flip{s}"] for s in range(3)]
        cells = []
        for k in keys:
            rv = v(r[k]); fv = np.nanmean([v(x[k]) for x in f]); nn = r[k][1] if isinstance(r[k], tuple) else None
            cells.append(f"{fmt.format(rv)} vs {fmt.format(fv)}" + (f" (n{nn})" if nn is not None else ""))
        print(f"  {'M' + str(tf) if tf < 60 else 'H' + str(tf // 60):4s} | " + " | ".join(cells))
show("A", "A) REGIME EPISODES per day (real vs signflip)", [("A", x, "per_day") for x in ("UP", "DOWN", "SIDE")])
show("A", "A) REGIME median duration minutes", [("A", x, "median_min") for x in ("UP", "DOWN", "SIDE")], "{:.0f}")
show("A", "A) REGIME share of time", [("A", x, "time_share") for x in ("UP", "DOWN", "SIDE")])
show("B", "B) AFTER A BIG BAR: share of next bars closing the other way (with = big bar in the regime's direction)",
     [("B", x, y) for x in ("UP", "DOWN") for y in ("with", "against")], "{:.3f}")
show("C", "C) PINBARS: share whose long wick points WITH the regime (rejecting the counter move)", [("C", x, "with_share") for x in ("UP", "DOWN")], "{:.3f}")
show("D", "D) PULLBACKS inside the regime: median counter-leg / with-leg", [("D", x, "median_retr") for x in ("UP", "DOWN")], "{:.3f}")
show("D", "D) PULLBACKS: share shallower than 38%", [("D", x, "shallow_share") for x in ("UP", "DOWN")], "{:.3f}")
show("E", "E) INSIDE BARS per 100 bars by regime", [("E", x, "inside_per100") for x in ("UP", "DOWN", "SIDE")])
