import numpy as np
from datetime import datetime, timezone
B = np.load("bars.npz"); t, h, l, tv = B["t"], B["h"], B["l"], B["tv"]
k = (t >= 1704067200) & (t < 1735689600)
d = np.array([datetime.fromtimestamp(int(x), timezone.utc).strftime("%Y-%m-%d") for x in t[k]])
flat = (h - l)[k] == 0
ud = np.unique(d)
last_flat = None
for day in ud:
    f = flat[d == day].mean()
    if f > 0.5: last_flat = day
print("last day in 2024 with mostly flat bars:", last_flat)
for day in ud:
    if day >= last_flat:
        print(day, f"{flat[d == day].mean():.0%}"); 
        if day > last_flat: break
