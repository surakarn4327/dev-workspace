"""Catalog part C (time behaviours) -> table day_time + printed report. Descriptive only, FULL sessions.
- volatility profile: mean M1 bar range / ADR20 by Thai-time hour, split US summer (open 22 UTC) / winter (open 23 UTC); by minute-of-hour
- when is the session high / low made (Thai hour, NY hour), share made in the first hour
- first hour's share of the day range; range expansion at London open (03:00 ET) and NY open (08:00 ET, 09:30 ET): next 30 min / previous 30 min
- open gap vs previous close (ADR), how often it is filled the same session and how fast; Monday vs other days
- weekday: day range / ADR, day types"""
import numpy as np, sqlite3
from datetime import datetime, timezone
import cat_bars as CB
db = sqlite3.connect(CB.DB); M = CB.m1(); ADR = CB.adr_map()
t, o, h, l, c, sid, day, et = (M[x] for x in ("t", "o", "h", "l", "c", "sid", "day", "et"))
dtype = dict(db.execute("SELECT day, day_type FROM days").fetchall())
starts = np.r_[0, np.flatnonzero(np.diff(sid)) + 1]; ends = np.r_[starts[1:], len(t)]
FULLSET = set(CB.full_list().tolist())
S = [(a, b) for a, b in zip(starts, ends) if int(day[b - 1]) in FULLSET]
print(f"full sessions {len(S)}")
thai = ((t // 3600) + 7) % 24; mnt = (t // 60) % 60
summer = np.zeros(len(t), bool)
for a, b in S: summer[a:b] = (t[a] // 3600) % 24 == 22
rngU = np.full(len(t), np.nan)
for a, b in S: rngU[a:b] = (h[a:b] - l[a:b]) / ADR[int(day[b - 1])]
ok = np.isfinite(rngU); base = np.nanmean(rngU)
print("\nA) volatility by Thai hour: mean M1 range as multiple of the all-day average (1.00 = average minute)  [summer | winter]")
order = list(range(5, 24)) + list(range(0, 5))
print("  Thai hr : " + " ".join(f"{x:>5d}" for x in order))
for nm, m in (("summer", ok & summer), ("winter", ok & ~summer)):
    v = [np.nanmean(rngU[m & (thai == x)]) / base if (m & (thai == x)).sum() > 500 else np.nan for x in order]
    print(f"  {nm:7s} : " + " ".join("   --" if np.isnan(x) else f"{x:5.2f}" for x in v))
v = [np.nanmean(rngU[ok & (mnt == x)]) / base for x in range(60)]
print("  by minute of the hour (x average): " + " ".join(f":{x:02d} {v[x]:.2f}" for x in range(60) if v[x] > 1.08 or x in (0, 15, 30, 45)))
print("  top 10 (season, Thai hh:mm) minutes: ", end="")
for nm, m in (("S", ok & summer), ("W", ok & ~summer)):
    key = thai[m] * 60 + mnt[m]; s_ = np.bincount(key, weights=rngU[m], minlength=1440); n_ = np.bincount(key, minlength=1440)
    avg = np.where(n_ > 100, s_ / np.maximum(n_, 1), 0) / base; top = np.argsort(avg)[::-1][:10]
    print(f"{nm}: " + ", ".join(f"{k // 60:02d}:{k % 60:02d} x{avg[k]:.1f}" for k in top), end=" | ")
print()
ROWS = []
for a, b in S:
    dk = int(day[b - 1]); U = ADR[dk]; w = np.arange(a, b)
    ih, il = w[np.argmax(h[w])], w[np.argmin(l[w])]; R = h[w].max() - l[w].min()
    fh = w[t[w] < t[a] + 3600]; first_share = (h[fh].max() - l[fh].min()) / R
    prev_close = c[a - 1] if a > 0 else np.nan; gap = (o[a] - prev_close) / U
    filled = -1
    if abs(gap) >= 0.02:
        hit = np.flatnonzero((l[w] <= prev_close) if gap > 0 else (h[w] >= prev_close))
        filled = int((t[w[hit[0]]] - t[a]) // 60) if len(hit) else -1
    def exp_(e0, m0=0):
        since_open = ((et[w] - 17) % 24) * 60 + (t[w] // 60) % 60          # minutes on the NY clock since 17:00 ET (session open)
        k = np.flatnonzero(since_open >= ((e0 - 17) % 24) * 60 + m0)
        if not len(k) or k[0] < 30 or k[0] + 30 > len(w): return np.nan
        j = k[0]; after = h[w[j:j + 30]].max() - l[w[j:j + 30]].min(); before = h[w[j - 30:j]].max() - l[w[j - 30:j]].min()
        return after / before if before > 0 else np.nan
    wd = datetime.fromtimestamp(dk * 86400, timezone.utc).weekday()
    ROWS.append((dk, wd, int(thai[ih]), int(thai[il]), int(et[ih]), int(et[il]), float(first_share), float(gap), filled,
                 exp_(3), exp_(8, 30), exp_(9, 30), float(R / U), str(dtype.get(dk)), int((t[ih] - t[a]) < 3600), int((t[il] - t[a]) < 3600)))
cur = db.cursor(); cur.executescript("""DROP TABLE IF EXISTS day_time; CREATE TABLE day_time(day INTEGER PRIMARY KEY, weekday INTEGER,
 high_thai_hour INTEGER, low_thai_hour INTEGER, high_et_hour INTEGER, low_et_hour INTEGER, first_hour_share REAL, gap_adr REAL, gap_fill_min INTEGER,
 london_exp REAL, ny830_exp REAL, ny930_exp REAL, range_adr REAL, day_type TEXT, high_in_first_hour INTEGER, low_in_first_hour INTEGER);""")
cur.executemany("INSERT INTO day_time VALUES (" + ",".join("?" * 16) + ")", ROWS); db.commit()
X = np.array(ROWS, dtype=object)
hh, lh = X[:, 2].astype(int), X[:, 3].astype(int)
print("\nB) Thai hour when the session HIGH / LOW is made (% of days):")
print("  Thai hr: " + " ".join(f"{x:>4d}" for x in order))
print("  high   : " + " ".join(f"{np.mean(hh == x):4.0%}" for x in order))
print("  low    : " + " ".join(f"{np.mean(lh == x):4.0%}" for x in order))
hf, lf = X[:, 14].astype(int), X[:, 15].astype(int)
print(f"  high made in first hour {hf.mean():.0%}, low in first hour {lf.mean():.0%}, either {np.mean(hf | lf):.0%}")
fs = X[:, 6].astype(float)
print(f"\nC) first hour = {np.median(fs):.0%} of the day range (median; p10-p90 {np.percentile(fs, 10):.0%}-{np.percentile(fs, 90):.0%})")
for nm, k in (("London open 03:00 ET", 9), ("NY 08:30 ET (US data)", 10), ("NY 09:30 ET", 11)):
    v = X[:, k].astype(float); v = v[np.isfinite(v)]
    print(f"  {nm}: range next 30 min / previous 30 min median {np.median(v):.2f}, > 1.5x on {np.mean(v > 1.5):.0%} of days")
g = X[:, 7].astype(float); fm = X[:, 8].astype(int); wd = X[:, 1].astype(int); big = np.abs(g) >= 0.02
print(f"\nD) open gap vs previous close: |gap| >= 0.02 ADR on {big.mean():.0%} of days (Mon {big[wd == 0].mean():.0%}, other {big[wd != 0].mean():.0%}),"
      f" median |gap| {np.median(np.abs(g[big])):.3f} ADR; filled same session {np.mean(fm[big] >= 0):.0%}"
      f" (within 60 min {np.mean((fm[big] >= 0) & (fm[big] <= 60)):.0%}), up gaps {np.mean(g[big] > 0):.0%}")
print(f"   Monday gaps: |gap| median {np.median(np.abs(g[big & (wd == 0)])):.3f} ADR, filled {np.mean(fm[big & (wd == 0)] >= 0):.0%}")
print("\nE) weekday: day range / ADR (median), day types")
rr = X[:, 12].astype(float); ty = X[:, 13]
for d_, nm in enumerate(("Mon", "Tue", "Wed", "Thu", "Fri")):
    m = wd == d_
    print(f"  {nm}: n {m.sum():3d} range/ADR {np.median(rr[m]):.2f} | trend {np.mean(ty[m] == 'trend'):.0%} quiet {np.mean(ty[m] == 'quiet'):.0%}"
          f" two-sided {np.mean(ty[m] == 'two_sided'):.0%}")
