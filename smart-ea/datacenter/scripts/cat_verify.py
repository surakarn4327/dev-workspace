"""Independent re-count of a few catalog behaviours on random sessions (plain loops straight from M1 bars, no shared code with dc_catalog.py),
compared with the `patterns` table. Also prints one M5 session in full for eyeballing."""
import numpy as np, sqlite3, os
from datetime import datetime, timezone
from dc_sessions import sessions
from broker import DB; db = sqlite3.connect(DB)
R = np.array(db.execute("SELECT t,o,h,l,c FROM bars_m1 ORDER BY t").fetchall()); T = R[:, 0].astype(np.int64)
sid, day, et = sessions(T)
rng = np.random.default_rng(5); pick = rng.choice(np.unique(day)[30:], 12, replace=False)
tot = {}
for tf in (1, 5, 15):
    # build all TF bars with plain python (dict of buckets) to recompute ATR the same way (mean TR of 20 previous bars)
    bars = []; cur_key = None
    for i in range(len(T)):
        k = (sid[i], T[i] // (tf * 60))
        if k != cur_key:
            bars.append([T[i], R[i, 1], R[i, 2], R[i, 3], R[i, 4], sid[i], day[i]]); cur_key = k
        else:
            b = bars[-1]; b[0] = T[i]; b[2] = max(b[2], R[i, 2]); b[3] = min(b[3], R[i, 3]); b[4] = R[i, 4]; b[6] = day[i]
    B = np.array(bars, dtype=float)
    tr = [B[0, 2] - B[0, 3]] + [max(B[j, 2], B[j - 1, 4]) - min(B[j, 3], B[j - 1, 4]) for j in range(1, len(B))]
    for d in pick:
        idx = np.flatnonzero(B[:, 6] == d); cnt = {"INSIDE": 0, "OUTSIDE": 0, "PINBAR": 0, "BIGBAR": 0, "DOJI": 0}
        for j in idx:
            if j < 20: continue
            a = np.mean(tr[j - 20:j]); o, h, l, c = B[j, 1:5]; rg = h - l; bd = abs(c - o)
            samep = B[j - 1, 5] == B[j, 5]
            if samep and h < B[j - 1, 2] and l > B[j - 1, 3]: cnt["INSIDE"] += 1
            if samep and h > B[j - 1, 2] and l < B[j - 1, 3]: cnt["OUTSIDE"] += 1
            if rg >= a and bd <= 0.3 * rg and ((h - max(o, c)) >= 0.6 * rg or (min(o, c) - l) >= 0.6 * rg): cnt["PINBAR"] += 1
            if rg >= 2 * a: cnt["BIGBAR"] += 1
            if rg >= 0.5 * a and bd <= 0.1 * rg: cnt["DOJI"] += 1
        for ty, v in cnt.items():
            db_v = db.execute("SELECT COUNT(*) FROM patterns WHERE tf=? AND type=? AND day=?", (tf, ty, int(d))).fetchone()[0]
            a_, b_ = tot.get((tf, ty), (0, 0)); tot[(tf, ty)] = (a_ + v, b_ + db_v)
print("independent recount vs table, 12 random sessions:")
for k, (a, b) in sorted(tot.items()): print(f"  M{k[0]:<2} {k[1]:8s} recount {a:5d}  table {b:5d}  {'OK' if a == b else 'DIFF'}")
