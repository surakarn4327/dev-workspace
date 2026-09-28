"""Honesty checks for a candidate: day-clustered t (events on the same day are not independent), one-position-at-a-time path,
and a block bootstrap of the day-level sums. usage: s2_cluster.py TYPE [rev] SL TP"""
import numpy as np, sys
import s2lib as L
TY = sys.argv[1]; orient = -1 if sys.argv[2] == "rev" else 1; sl = float(sys.argv[3]); tp = float(sys.argv[4])
E = L.events([TY]); d = E["dir"] * orient
R, HOLD = L.simulate(E["t"], d, E["U"], sls=np.array([sl]), tps=np.array([tp])); r = R[:, 0, 0]; hold = HOLD[:, 0, 0]
ok = np.isfinite(r); r, t, day, hold, dd = r[ok], E["t"][ok], E["day"][ok], hold[ok], d[ok]
ud = np.unique(day); s = np.array([r[day == k].sum() for k in ud]); nd = np.array([(day == k).sum() for k in ud])
print(f"{TY} {'rev' if orient < 0 else 'def'} SL{sl}/TP{tp}: n {len(r)} on {len(ud)} days (max {nd.max()}/day)  mean {r.mean():+.3f}")
print(f"  naive t {r.mean() / (r.std(ddof=1) / np.sqrt(len(r))):+.2f} | day-clustered t {s.mean() / (s.std(ddof=1) / np.sqrt(len(s))):+.2f} (per-day sum {s.mean():+.3f})")
# one position at a time (skip events while a trade is open)
keep = []; busy_until = -1
for k in np.argsort(t):
    if t[k] >= busy_until: keep.append(k); busy_until = t[k] + 60 * hold[k]
keep = np.array(keep); rk = r[keep]
tt = t[keep]; h = tt < np.median(t)
print(f"  one-at-a-time: n {len(rk)} mean {rk.mean():+.3f} t {rk.mean() / (rk.std(ddof=1) / np.sqrt(len(rk))):+.2f} total {rk.sum():+.1f}R "
      f"H1 {rk[h].mean():+.3f} H2 {rk[~h].mean():+.3f} BUY {rk[dd[keep] > 0].mean():+.3f} SELL {rk[dd[keep] < 0].mean():+.3f} streak {L.max_losing_streak(rk)}")
eq = np.cumsum(rk); print(f"  one-at-a-time maxDD {np.max(np.maximum.accumulate(eq) - eq):.1f}R")
# block bootstrap by week of the per-day sums -> P(mean <= 0)
rng = np.random.default_rng(3); wk = ud // 7; uw = np.unique(wk); ws = np.array([s[wk == w].sum() for w in uw])
bs = np.array([ws[rng.integers(len(ws), size=len(ws))].sum() for _ in range(5000)])
print(f"  weekly block bootstrap: total {ws.sum():+.1f}R, 90% CI [{np.percentile(bs, 5):+.1f}, {np.percentile(bs, 95):+.1f}], P(total<=0) {np.mean(bs <= 0):.4f}")
