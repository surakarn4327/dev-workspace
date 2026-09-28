import numpy as np
from datetime import datetime, timezone
B = np.load("bars.npz"); t, o, h, l, c, tv, sp = B["t"], B["o"], B["h"], B["l"], B["c"], B["tv"], B["sp"]
hr = (t // 3600) % 24; m = (hr >= 7) & (hr < 16)          # London/NY hours (busiest)
yr = np.array([datetime.fromtimestamp(int(x), timezone.utc).year for x in t[::1440]]); yr = np.repeat(yr, 1440)[:len(t)]
print(" year | bars in London/NY hrs | range=0 (flat bar) | tick vol median | tick vol=1 | close unchanged vs prev | spread median | bars/day (all hrs)")
for y in range(2019, 2027):
    k = m & (yr == y)
    flat = np.mean((h - l)[k] == 0); v = np.median(tv[k]); v1 = np.mean(tv[k] <= 1)
    same = np.mean(np.diff(c[k]) == 0); spr = np.median(sp[k]) * 0.001
    days = len(np.unique(((t[yr == y] + 3600) // 86400)))
    print(f" {y} | {k.sum():7d} | {flat:5.0%} | {v:6.0f} | {v1:5.0%} | {same:5.0%} | {spr:.3f} | {np.sum(yr == y) / max(days, 1):6.0f}")
