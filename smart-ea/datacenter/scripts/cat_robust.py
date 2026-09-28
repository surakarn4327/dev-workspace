"""Catalog step 4: are the surviving findings robust to the definitions (thresholds, timeframe, ATR length) and stable over time?
Null copies: 3 sign-flipped (direction random, volatility kept) and 3 shuffled (keeps each day's drift, destroys order).
F1 reversal after a big bar      : big = range >= k ATR and body >= 50% of range. Measures: share of next bars closing the OTHER way;
                                   share of 2-bar continuations (next 2 bars both the same colour as the big bar). vs signflip.
F2 up/down asymmetry             : P(next bar same colour | big UP bar) - P(next bar same colour | big DOWN bar). vs shuffle (keeps drift).
                                   by year and by quarter (2026Q2 = the only strongly falling quarter) .
F3 consolidation on mid TFs      : inside bars per day and contracting 4-leg triangles per day on M5..M30, vs signflip, triangle
                                   with zigzag 2/3/4 ATR and shrink factor 0.80/0.85/0.90.
F4 previous-day high/low revisits: visits per day with touch tolerance 0.15/0.25/0.40 ATR(M5) and leave distance 0.75/1.0/1.5 ATR, vs signflip.
F5 time rhythm                   : range in the 30 min after 08:30 New York / average 30-min range of the day, per year; big-bar clustering
                                   (corr of consecutive M5 ranges) real vs shuffle, per year."""
import numpy as np
from datetime import datetime, timezone
import cat_bars as CB, cat_struct as CS
M = CB.m1(); FS = CB.full_list(); FSset = set(FS.tolist()); tv = M["tv"].astype(float)
yr_m1 = np.array([datetime.fromtimestamp(int(x), timezone.utc).year for x in M["t"][::1]])
def qkey(ts): d = datetime.fromtimestamp(int(ts), timezone.utc); return f"{d.year}Q{(d.month - 1) // 3 + 1}"
print("building null copies ...", flush=True)
SERIES = {"real": (M["o"], M["h"], M["l"], M["c"])}
for s in range(3):
    SERIES[f"flip{s}"] = CS.signflip_m1(M["o"], M["h"], M["l"], M["c"], tv, M["sid"], 900 + s)[:4]
    SERIES[f"shuf{s}"] = CS.shuffle_m1(M["o"], M["h"], M["l"], M["c"], tv, M["sid"], 950 + s)[:4]
_cache = {}
def bars(name, tf, atr_n=20):
    key = (name, tf, atr_n)
    if key not in _cache:
        B = CS.resample(tf, M["t"], M["sid"], *SERIES[name], tv)
        if atr_n != 20:
            pc = np.r_[B["c"][0], B["c"][:-1]]; tr = np.maximum(B["h"], pc) - np.minimum(B["l"], pc); cs = np.r_[0, np.cumsum(tr)]; n = len(tr)
            a = np.full(n, np.nan); a[atr_n:] = (cs[atr_n:n] - cs[:n - atr_n]) / atr_n; B["atr"] = a
        B["full"] = np.isin(M["day"][B["m1_end"] - 1], FS); B["year"] = yr_m1[B["m1_end"] - 1]
        _cache[key] = B
    return _cache[key]
FLIPS = [f"flip{s}" for s in range(3)]; SHUFS = [f"shuf{s}" for s in range(3)]
def big_next(B, k, mask=None):
    o, h, l, c, a = B["o"], B["h"], B["l"], B["c"], B["atr"]; rng = h - l; col = np.sign(c - o)
    big = np.isfinite(a) & (rng >= k * a) & (np.abs(c - o) >= 0.5 * rng) & B["full"]
    nxt = np.r_[B["sid"][1:] == B["sid"][:-1], False]; nxt2 = nxt & np.r_[nxt[1:], False]
    i = np.flatnonzero(big & nxt2 & (mask if mask is not None else True))
    opp = np.mean(col[i + 1] == -col[i]); cont2 = np.mean((col[i + 1] == col[i]) & (col[i + 2] == col[i]))
    up = i[col[i] > 0]; dn = i[col[i] < 0]
    asym = np.mean(col[up + 1] == 1) - np.mean(col[dn + 1] == -1)
    return opp, cont2, asym, len(i)
print("\nF1) REVERSAL AFTER A BIG BAR  (share of next bars closing the other way | share of 2-bar continuation) real vs signflip")
print(" TF  k ATR  ATRn |   n    | opp real / flip  | cont2 real / flip | ratio opp | ratio cont2")
for tf in (1, 5, 15):
    for k in (1.5, 2.0, 2.5, 3.0):
        for an in ((20,) if k != 2.0 else (10, 20, 50)):
            r = big_next(bars("real", tf, an), k); f = [big_next(bars(x, tf, an), k) for x in FLIPS]
            fo, fc = np.mean([x[0] for x in f]), np.mean([x[1] for x in f])
            print(f" M{tf:<2} {k:4.1f}  {an:4d} | {r[3]:6d} | {r[0]:.3f} / {fo:.3f}    | {r[1]:.3f} / {fc:.3f}     | {r[0] / fo:5.2f}     | {r[1] / fc:5.2f}")
print("   by year (M5, k=2): " + " | ".join(
    f"{y}: opp {big_next(bars('real', 5), 2, bars('real', 5)['year'] == y)[0]:.3f} vs flip {np.mean([big_next(bars(x, 5), 2, bars(x, 5)['year'] == y)[0] for x in FLIPS]):.3f}"
    for y in (2024, 2025, 2026)))
print("\nF2) UP/DOWN ASYMMETRY  P(next same colour | big up) - P(next same colour | big down): real vs shuffle (drift kept)")
for tf in (1, 5, 15):
    row = []
    for k in (1.5, 2.0, 2.5, 3.0):
        r = big_next(bars("real", tf), k)[2]; s = np.mean([big_next(bars(x, tf), k)[2] for x in SHUFS]); row.append(f"k{k}: {r:+.3f} vs {s:+.3f}")
    print(f" M{tf:<2} " + " | ".join(row))
B5 = bars("real", 5); qk = np.array([qkey(x) for x in B5["t"]]); gold_q = {}
d_open = {}; d_close = {}
for q in sorted(set(qk)):
    m = qk == q; gold_q[q] = (B5["c"][m][-1] / B5["o"][m][0] - 1) * 100
print(" M5 k=2 by quarter (gold % move): " + " | ".join(
    f"{q} ({gold_q[q]:+.0f}%): {big_next(B5, 2, qk == q)[2]:+.2f} vs {np.mean([big_next(bars(x, 5), 2, np.array([qkey(t) for t in bars(x, 5)['t']]) == q)[2] for x in SHUFS[:1]]):+.2f}"
    for q in sorted(set(qk))))
print("\nF3) CONSOLIDATION: inside bars per full day and contracting triangles per full day, real vs signflip")
ND = len(FS)
for tf in (5, 10, 15, 20, 30):
    def inside(B): h, l = B["h"], B["l"]; same = np.r_[False, B["sid"][1:] == B["sid"][:-1]]; return np.sum(same & (h < np.r_[h[0], h[:-1]]) & (l > np.r_[l[0], l[:-1]]) & B["full"]) / ND
    r = inside(bars("real", tf)); f = np.mean([inside(bars(x, tf)) for x in FLIPS])
    print(f" M{tf:<2} inside/day {r:6.2f} vs {f:6.2f}  ratio {r / f:.2f}")
def triangles(B, zk, shrink):
    idx, p, kind, conf = CS.zigzag(B["h"], B["l"], B["c"], B["atr"], zk); n = 0
    for j in range(4, len(p)):
        legs = np.abs(np.diff(p[j - 4:j + 1]))
        if np.all(legs[1:] <= shrink * legs[:-1]) and B["full"][conf[j]]: n += 1
    return n / ND
for tf in (5, 15):
    for zk in (2.0, 3.0, 4.0):
        row = []
        for sh in (0.80, 0.85, 0.90):
            r = triangles(bars("real", tf), zk, sh); f = np.mean([triangles(bars(x, tf), zk, sh) for x in FLIPS]); row.append(f"shrink {sh}: {r:.2f} vs {f:.2f} (x{r / f:.2f})")
        print(f" M{tf:<2} zigzag {zk} ATR | " + " | ".join(row))
print("\nF4) PREVIOUS-DAY HIGH/LOW revisits per full day, real vs signflip")
B5r = {x: bars(x, 5) for x in ["real"] + FLIPS}
def prevday_visits(name, tol, far):
    o, h, l, c = SERIES[name]; B = B5r[name]; a5 = np.full(len(c), np.nan)
    for k in range(len(B["c"])): a5[(B["m1_end"][k - 1] if k else 0):B["m1_end"][k]] = B["atr"][k]
    st = np.r_[0, np.flatnonzero(np.diff(M["sid"])) + 1]; en = np.r_[st[1:], len(c)]; prev = None; nv = 0
    for a_, b_ in zip(st, en):
        w = np.arange(a_, b_); dk = int(M["day"][b_ - 1])
        if prev is not None and dk in FSset:
            for L in prev:
                a = a5[w]; ok = np.isfinite(a); d_ = (c[w] - L) / np.where(ok, a, 1); far_ = ok & (np.abs(d_) >= far); side = np.sign(d_)
                band = ok & (l[w] <= L + tol * a) & (h[w] >= L - tol * a); F = np.flatnonzero(far_); cb = np.r_[0, np.cumsum(band)]
                for f0, f1 in zip(F[:-1], F[1:]):
                    if f1 == f0 + 1 and side[f0] == side[f1]: continue
                    if side[f0] != side[f1] or cb[f1] - cb[f0 + 1] > 0: nv += 1
        prev = (h[w].max(), l[w].min())
    return nv / ND
for tol in (0.15, 0.25, 0.40):
    row = []
    for far in (0.75, 1.0, 1.5):
        r = prevday_visits("real", tol, far); f = np.mean([prevday_visits(x, tol, far) for x in FLIPS]); row.append(f"leave {far}: {r:.2f} vs {f:.2f} (x{r / f:.2f})")
    print(f" touch {tol} ATR | " + " | ".join(row))
print("\nF5) TIME RHYTHM")
t = M["t"]; et = M["et"]; mnt = (t // 60) % 60; rngm1 = M["h"] - M["l"]
for y in (2024, 2025, 2026):
    m = (yr_m1 == y) & np.isin(M["day"], FS)
    win = m & (((et == 8) & (mnt >= 30)) | ((et == 9) & (mnt < 0)))
    print(f" {y}: mean M1 range 08:30-08:59 NY / all-day mean = {rngm1[win].mean() / rngm1[m].mean():.2f}", end="")
    B = bars("real", 5); mm = (B["year"] == y) & B["full"]; r5 = (B["h"] - B["l"])[mm]
    cr = np.corrcoef(r5[1:], r5[:-1])[0, 1]
    Bs = bars("shuf0", 5); ms = (Bs["year"] == y) & Bs["full"]; rs = (Bs["h"] - Bs["l"])[ms]
    print(f" | corr of consecutive M5 ranges real {cr:.2f} vs shuffle {np.corrcoef(rs[1:], rs[:-1])[0, 1]:.2f}")
