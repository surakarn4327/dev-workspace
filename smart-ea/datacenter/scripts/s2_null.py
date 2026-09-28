"""Fair nulls for an event type (reads s2_<TYPE>.npz from s2_pdb.py):
N1 same entry bar, opposite direction  -> does the event's direction carry information (vs symmetric volatility payoff)?
N2 random tradable bar on a random day of the same half, same direction -> how much is plain drift (gold up-trend) / time-of-day?
N3 same as N2 but entry hour matched to the event hour (+-1h)."""
import numpy as np, sys
import s2lib as L
TYPE = sys.argv[1] if len(sys.argv) > 1 else "PREVDAY_BREAK"
cells = [(0.075, 0.5), (0.10, 0.5), (0.125, 0.6), (0.15, 0.6), (0.20, 0.6), (0.10, 9.0)]
Z = np.load(f"s2_{TYPE}.npz", allow_pickle=True); ok = Z["ok"]
t, d, U, hr = Z["t"][ok], Z["dir"][ok], Z["U"][ok], Z["hour"][ok]
sls = np.array([c[0] for c in cells]); tps = np.array([c[1] for c in cells])
def cellR(R): return np.stack([R[:, k, k] for k in range(len(cells))], 1)   # diagonal pairs (sl_k, tp_k)
real = cellR(L.simulate(t, d, U, sls=sls, tps=tps)[0])
opp = cellR(L.simulate(t, -d, U, sls=sls, tps=tps)[0])
B = L.bars(); bt, bday = B["t"], B["day"]
# tradable bars per day
DD = {}
hh = (bt // 3600) % 24; trad = (hh == 23) | (hh < L.LAST_ENTRY_H)
for dk in np.unique(bday):
    lo, hi = np.searchsorted(bday, dk), np.searchsorted(bday, dk, "right")
    DD[dk] = np.arange(lo, hi)[trad[lo:hi]]
dks = np.array(sorted(DD)); tmid = np.median(t)
# ADR per day (from events table days) : use U of nearest event day as proxy is wrong -> load days
D = L.days(); Umap = dict(zip(D["day"], D["adr20"]))
rng = np.random.default_rng(7)
def rand_null(match_hour, reps=40):
    out = []
    for rep in range(reps):
        nt = np.empty(len(t), np.int64); nU = np.empty(len(t))
        for k in range(len(t)):
            pool = dks[(dks * 86400 < tmid) == (t[k] < tmid)]
            while True:
                dk = pool[rng.integers(len(pool))]; u = Umap.get(dk)
                if u is None or not np.isfinite(u) or len(DD[dk]) == 0: continue
                ids = DD[dk]
                if match_hour:
                    hs = (bt[ids] // 3600) % 24; dh = np.minimum((hs - hr[k]) % 24, (hr[k] - hs) % 24); ids = ids[dh <= 1]
                    if len(ids) == 0: continue
                nt[k] = bt[ids[rng.integers(len(ids))]]; nU[k] = u; break
        out.append(cellR(L.simulate(nt, d, nU, sls=sls, tps=tps)[0]))
    return np.array(out)            # reps x n x cells
N2 = rand_null(False); N3 = rand_null(True)
for name, m in (("ALL", np.ones(len(t), bool)), ("BUY", d > 0), ("SELL", d < 0)):
    print(f"\n{TYPE} {name} n={m.sum()}  (mean R after spread)")
    print("  cell (SL/TP)  | real   | N1 opposite | N2 random day/time: mean (sd) z | N3 hour-matched: mean (sd) z")
    for k, (s, tp) in enumerate(cells):
        r = np.nanmean(real[m, k]); o = np.nanmean(opp[m, k])
        n2 = np.nanmean(N2[:, m, k], 1); n3 = np.nanmean(N3[:, m, k], 1)
        print(f"  {s:.3f}/{'EOD' if tp > 8 else tp:<4} | {r:+.3f} | {o:+.3f}      | {n2.mean():+.3f} ({n2.std():.3f}) z {(r - n2.mean()) / n2.std():+.1f}"
              f"          | {n3.mean():+.3f} ({n3.std():.3f}) z {(r - n3.mean()) / n3.std():+.1f}")
