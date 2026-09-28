"""Catalog step 0b: when does the market actually pause each day / week (UTC, after broker clock conversion), by month.
Used to check a broker: the daily pause should sit around 17:00 New York (21:00 UTC summer / 22:00 UTC winter)."""
import numpy as np
from datetime import datetime, timezone
from collections import Counter
import s2lib as L
B = L.bars(); t = B["t"]; g = np.diff(t) // 60
C = Counter()
for i in np.flatnonzero(g >= 30):
    a = datetime.fromtimestamp(int(t[i]), timezone.utc); b = datetime.fromtimestamp(int(t[i + 1]) - 60, timezone.utc)
    kind = "weekend" if g[i] > 1000 else "daily"
    C[(a.strftime("%Y-%m"), kind, (a + __import__("datetime").timedelta(minutes=1)).strftime("%H:%M"), (b + __import__("datetime").timedelta(minutes=1)).strftime("%H:%M"))] += 1
print("month   | kind    | pause from -> trading resumes (UTC) : count")
for k in sorted(C): print(f"{k[0]} | {k[1]:7s} | {k[2]} -> {k[3]} : {C[k]}")
