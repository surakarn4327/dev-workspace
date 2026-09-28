"""Catalog step 0: data quality of the clean period (>= 2024-04-12). Per session: bar count, missing minutes, flat bars (O=H=L=C),
tick volume 1, duplicate/unsorted times, price spikes (1-min |close change| or range > 15x median of that session), spread outliers.
Also classifies sessions: full / short (holiday, early close) so per-day statistics can exclude them explicitly."""
import numpy as np
from datetime import datetime, timezone
import s2lib as L
B = L.bars(); t, o, h, l, c, tv, sp, day = (B[x] for x in ("t", "o", "h", "l", "c", "tv", "sp", "day"))
print(f"bars {len(t)}  from {datetime.fromtimestamp(int(t[0]), timezone.utc)} to {datetime.fromtimestamp(int(t[-1]), timezone.utc)}")
print(f"sorted strictly increasing: {bool(np.all(np.diff(t) > 0))} | on-minute timestamps: {bool(np.all(t % 60 == 0))}")
print(f"OHLC consistent (l <= o,c <= h): {np.mean((l <= np.minimum(o, c)) & (h >= np.maximum(o, c))):.6f}")
flat = (o == h) & (h == l) & (l == c)
print(f"flat bars O=H=L=C: {flat.sum()} ({flat.mean():.3%}) | tick_vol<=1: {(tv <= 1).sum()} ({(tv <= 1).mean():.3%})")
ud = np.unique(day); rows = []
for dk in ud:
    m = np.flatnonzero(day == dk); tt = t[m]
    span = (tt[-1] - tt[0]) // 60 + 1; gaps = np.diff(tt) // 60 - 1
    rng_ = h[m] - l[m]; mv = np.abs(np.diff(c[m])); med_r = np.median(rng_[rng_ > 0]) if (rng_ > 0).any() else np.nan
    spikes = int(((rng_ > 15 * med_r) | (np.r_[0, mv] > 15 * med_r)).sum())
    wd = datetime.fromtimestamp(int(tt[0]) + 3600, timezone.utc).strftime("%a")
    rows.append((dk, len(m), span, int(gaps[gaps > 0].sum()), int((gaps >= 5).sum()), int(gaps.max()) if len(gaps) else 0,
                 flat[m].mean(), spikes, np.median(sp[m]), np.max(sp[m]), wd,
                 datetime.fromtimestamp(int(tt[0]), timezone.utc).strftime("%H:%M"), datetime.fromtimestamp(int(tt[-1]), timezone.utc).strftime("%H:%M")))
n = np.array([r[1] for r in rows])
print(f"\nsessions {len(rows)} | bars/session: median {np.median(n):.0f}, min {n.min()}, max {n.max()}")
full = n >= 0.90 * np.median(n)
print(f"full sessions (>= 90% of median bars = {0.90 * np.median(n):.0f}): {full.sum()} | short: {(~full).sum()}")
print("short sessions (date = trading date, weekday, first-last bar UTC, bars):")
for r, f in zip(rows, full):
    if not f: print(f"   {datetime.fromtimestamp(int(r[0]) * 86400, timezone.utc):%Y-%m-%d} {r[10]} {r[11]}-{r[12]} bars {r[1]}")
g = np.array([r[3] for r in rows]); g5 = np.array([r[4] for r in rows]); gm = np.array([r[5] for r in rows])
print(f"\nmissing minutes inside sessions (full only): median {np.median(g[full]):.0f}, p95 {np.percentile(g[full], 95):.0f}, max {g[full].max()}"
      f" | sessions with a gap >= 5 min: {(g5[full] > 0).sum()} | largest single gap {gm[full].max()} min")
big = sorted([r for r, f in zip(rows, full) if f], key=lambda r: -r[5])[:8]
print("  largest intra-session gaps: " + ", ".join(f"{datetime.fromtimestamp(int(r[0]) * 86400, timezone.utc):%Y-%m-%d} {r[5]}m" for r in big))
fl = np.array([r[6] for r in rows]); print(f"flat-bar share per full session: median {np.median(fl[full]):.2%}, max {fl[full].max():.2%}")
sk = np.array([r[7] for r in rows]); print(f"spike bars (>15x session median range): total {sk.sum()}, sessions with any {(sk > 0).sum()}")
top = sorted(rows, key=lambda r: -r[7])[:5]; print("  most spikes: " + ", ".join(f"{datetime.fromtimestamp(int(r[0]) * 86400, timezone.utc):%Y-%m-%d} {r[7]}" for r in top))
spm = np.array([r[8] for r in rows]); spx = np.array([r[9] for r in rows])
print(f"spread USD: session median of medians {np.median(spm):.3f} (range {spm.min():.3f}-{spm.max():.3f}), max single bar {spx.max():.2f}")
# per hour-of-day coverage (full sessions) : share of sessions that have a bar at each server hour
hr = (t // 3600) % 24; fulldays = set(ud[full])
cov = [len(set(day[(hr == hh)]) & fulldays) / len(fulldays) for hh in range(24)]
print("hour coverage (UTC hour: share of full sessions with bars): " + " ".join(f"{hh}:{v:.0%}" for hh, v in enumerate(cov)))
np.save("cat_fullsessions.npy", ud[full])
