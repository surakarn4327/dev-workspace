"""Report for catalog part B (levels, boxes, trends) over FULL sessions: per-day frequency, outcome shares, sizes, durations, stability."""
import numpy as np, sqlite3
from datetime import datetime, timezone
import cat_bars as CB
db = sqlite3.connect(CB.DB); M = CB.m1()
ADR = CB.adr_map(); FULL = CB.full_list(); ND = len(FULL)
BARS_FULL = int(np.isin(M["day"], FULL).sum())                   # M1 bars in full days (for time shares)
mon = np.array([datetime.fromtimestamp(int(d) * 86400, timezone.utc).strftime("%Y-%m") for d in FULL]); months = sorted(set(mon))
def perday(days):
    days = np.asarray(days, dtype=np.int64); days = days[np.isin(days, FULL)]
    return np.bincount(np.searchsorted(FULL, days), minlength=ND).astype(float)
def mrange(p): mm = [p[mon == m].mean() for m in months]; return min(mm), max(mm)
print(f"full sessions {ND}\n\n1) LEVEL VISITS (ruler = ATR20 of M5; visit = came from >= 1 ATR away, touched +-0.25 ATR, left >= 1 ATR)")
print(" level  | visits/day [p10-p90] days>=1 | BOUNCE  POKE  CROSS | median penetration ATR | per-day monthly min-max")
V = db.execute("SELECT level_type, day, outcome, pen_atr FROM level_visits").fetchall()
lt = np.array([v[0] for v in V]); vd = np.array([v[1] for v in V]); vo = np.array([v[2] for v in V]); vp = np.array([v[3] for v in V])
keep = np.isin(vd, FULL)
for typ in ("R10", "R50", "R100", "P10a", "P10b", "PDH", "PDL", "PDC", "DOPEN", "LOPEN", "NYOPEN", "PWH", "PWL", "PMH", "PML"):
    m = keep & (lt == typ)
    if not m.any(): continue
    p = perday(vd[m]); a, b = mrange(p)
    print(f" {typ:6s} | {p.mean():6.2f} [{np.percentile(p, 10):3.0f}-{np.percentile(p, 90):3.0f}]   {np.mean(p >= 1):5.0%} |"
          f" {np.mean(vo[m] == 'BOUNCE'):5.0%} {np.mean(vo[m] == 'POKE'):5.0%} {np.mean(vo[m] == 'CROSS'):5.0%} | {np.median(vp[m]):5.2f}"
          f"                  | {a:.2f}-{b:.2f}")
# round vs pseudo: per level (not per day) bounce share with SE
for grp in (("R10", "R50", "R100"), ("R50", "R100"), ("R100",), ("P10a", "P10b")):
    m = keep & np.isin(lt, grp); x = (vo[m] == "BOUNCE").astype(float)
    print(f"   {'+'.join(grp):13s} n {m.sum():6d} bounce {x.mean():.1%} +- {x.std() / np.sqrt(len(x)):.1%}  cross {np.mean(vo[m] == 'CROSS'):.1%}")

print("\n2) BOXES (height <= 4 ATR of the TF, >= 20 bars)")
print(" TF  | boxes/day [p10-p90] | minutes median [p90] | bars med | height ATR med | height ADR med | touches top/bot median (p90) | exit UP/DOWN/END | share of session time in a box")
for tf in (1, 5, 15):
    X = np.array(db.execute("SELECT day, bars, height_atr, height_adr, touches_top, touches_bot, exit, t_start, t_end FROM boxes WHERE tf=?", (tf,)).fetchall(), dtype=object)
    m = np.isin(X[:, 0].astype(np.int64), FULL); X = X[m]; p = perday(X[:, 0])
    mins = (X[:, 8].astype(np.int64) - X[:, 7].astype(np.int64)) / 60 + tf
    ex = X[:, 6]; tt = X[:, 4].astype(float); tb = X[:, 5].astype(float)
    share = mins.sum() / BARS_FULL
    print(f" M{tf:<2} | {p.mean():5.2f} [{np.percentile(p, 10):2.0f}-{np.percentile(p, 90):2.0f}]       | {np.median(mins):5.0f} [{np.percentile(mins, 90):4.0f}]         |"
          f" {np.median(X[:, 1].astype(float)):4.0f}     | {np.median(X[:, 2].astype(float)):4.1f}           | {np.nanmedian(X[:, 3].astype(float)):.3f}          |"
          f" {np.median(tt):.0f}/{np.median(tb):.0f} ({np.percentile(tt, 90):.0f}/{np.percentile(tb, 90):.0f})                    |"
          f" {np.mean(ex == 'UP'):.0%}/{np.mean(ex == 'DOWN'):.0%}/{np.mean(ex == 'END'):.0%}        | {share:.0%}   monthly/day {mrange(p)[0]:.1f}-{mrange(p)[1]:.1f}")

print("\n3) TREND STRUCTURE RUNS (consecutive higher highs + higher lows / lower lows + lower highs on zigzag 3 ATR pivots)")
print(" TF  | runs/day | n pivots: 2 / 3 / 4 / 5-6 / 7+ (share) | up % | size ATR med [p90] | size ADR med [p90] | minutes med [p90] | monthly/day")
for tf in (1, 5, 15):
    X = np.array(db.execute("SELECT day, dir, n, size_atr, size_adr, minutes FROM trends WHERE tf=?", (tf,)).fetchall(), dtype=float)
    X = X[np.isin(X[:, 0].astype(np.int64), FULL)]; p = perday(X[:, 0]); n = X[:, 2]
    sh = [np.mean(n == 2), np.mean(n == 3), np.mean(n == 4), np.mean((n >= 5) & (n <= 6)), np.mean(n >= 7)]
    print(f" M{tf:<2} | {p.mean():6.2f}   | " + " / ".join(f"{s:.0%}" for s in sh) + f"            | {np.mean(X[:, 1] > 0):.0%} |"
          f" {np.median(X[:, 3]):5.1f} [{np.percentile(X[:, 3], 90):5.1f}]     | {np.nanmedian(X[:, 4]):.2f} [{np.nanpercentile(X[:, 4], 90):.2f}]        |"
          f" {np.median(X[:, 5]):5.0f} [{np.percentile(X[:, 5], 90):5.0f}]      | {mrange(p)[0]:.1f}-{mrange(p)[1]:.1f}")
    # how long does a structure last vs coin flip: under a random walk each pivot continues the structure with p~0.5 -> P(n>=k) ~ 0.5^(k-1)
    print(f"      P(n>=3 | n>=2) = {np.mean(n >= 3) :.2f}, P(n>=4 | n>=3) = {np.mean(n >= 4) / max(np.mean(n >= 3), 1e-9):.2f}, P(n>=5 | n>=4) = {np.mean(n >= 5) / max(np.mean(n >= 4), 1e-9):.2f}")
