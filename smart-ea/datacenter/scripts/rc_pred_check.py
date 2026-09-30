r"""Checks for rc_pred.py: (1) the models find a planted effect of known size in real features with real-size noise,
(2) with pure-noise targets the top-20% uplift is ~0 (no built-in optimism), (3) training rows never close at/after T."""
import sys, calendar, datetime as dt
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, rc_pred as RP

R, fc, pos, d, par, cols = RP.load("real")
day = R[:, 3].astype(np.int64); ex = R[:, 2]
rng = np.random.default_rng(3)
t0 = calendar.timegm(dt.datetime(2025, 10, 1).timetuple()); a = t0 // 86400
tr = np.flatnonzero((day >= a - 365) & (day < a) & (ex + 60 <= t0)); te = np.flatnonzero((day >= a) & (day < a + 31))
assert np.all(ex[tr] + 60 <= t0) and day[tr].max() < a
tr = rng.choice(tr, 150000, replace=False)
Xtr = RP.build_X(fc, pos, d, par, tr); Xte = RP.build_X(fc, pos, d, par, te)
j = cols.index("m1k3_rng_pos") if "m1k3_rng_pos" in cols else 10
def planted(X, idx, eff):
    x = X[:, j] * d[idx]; return eff * np.where(x > np.nanmedian(Xtr[:, j] * d[tr]), 1, -1) + rng.normal(0, 1.4, len(idx))
for eff in (0.0, 0.05, 0.10, 0.20):
    ytr = planted(Xtr, tr, eff); yte = planted(Xte, te, eff)
    for name, p in (("boost", RP.Boost().fit(Xtr, ytr).predict(Xte)), ("ridge", RP.ridge(Xtr, ytr, Xte))):
        top = p >= np.quantile(p, 0.8)
        print(f"planted +-{eff:.2f}R: {name} top20% uplift {yte[top].mean() - yte.mean():+.3f} (perfect = {eff * 0.5 if eff else 0:+.3f}..{eff:+.3f})")
