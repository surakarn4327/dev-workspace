"""Does the higher-TF backdrop change small-TF behaviour? Exness clean data (2024-04-12 ->). Swings = zigzag with reversal >= 20% ADR.
Split every swing by the backdrop at its start: price vs its level 5 sessions ago (up-backdrop / down-backdrop).
Compare up-legs vs down-legs: count, mean size (ADR), and impulse->pullback->resume rates, per backdrop."""
import numpy as np
from datetime import datetime, timezone
exec(open("catalog2.py", encoding="utf-8").read().split("for w, y in zip(S, Y):")[0])
T0 = int(datetime(2024, 4, 12, tzinfo=timezone.utc).timestamp())
closes = []; rows = []
for w in S:
    R = h[w].max() - l[w].min(); U = np.mean(rngs[-20:]) if len(rngs) >= 20 else np.nan; rngs.append(R)
    closes.append(c[w[-1]])
    if t[w[0]] < T0 or not np.isfinite(U) or len(closes) < 7: continue
    back = np.sign(c[w[0]] - closes[-6])          # backdrop: up if price above its level 5 sessions ago
    piv = zigzag(w, 0.2 * U)
    for m in range(1, len(piv)):
        p0, p1 = piv[m - 1][1], piv[m][1]; d = np.sign(p1 - p0); size = abs(p1 - p0) / U
        res = None
        if size >= 0.5 and m + 2 < len(piv):
            retr = abs(piv[m + 1][1] - p1) / abs(p1 - p0)
            res = (retr, (piv[m + 2][1] - p1) * d > 0)
        rows.append((back, d, size, res))
print(f" swings in clean Exness data: {len(rows)}")
for bname, b in (("UP backdrop (price above 5 days ago)", 1), ("DOWN backdrop (price below 5 days ago)", -1)):
    r = [x for x in rows if x[0] == b]
    up = [x for x in r if x[1] > 0]; dn = [x for x in r if x[1] < 0]
    print(f"\n {bname}: swings {len(r)}")
    print(f"   legs WITH backdrop   : n {len(up) if b > 0 else len(dn):5d}  mean size {np.mean([x[2] for x in (up if b > 0 else dn)]):.2f} ADR  | >= 50% ADR: {np.mean([x[2] >= 0.5 for x in (up if b > 0 else dn)]):.0%}")
    print(f"   legs AGAINST backdrop: n {len(dn) if b > 0 else len(up):5d}  mean size {np.mean([x[2] for x in (dn if b > 0 else up)]):.2f} ADR  | >= 50% ADR: {np.mean([x[2] >= 0.5 for x in (dn if b > 0 else up)]):.0%}")
    for lab, grp in (("impulse WITH backdrop", up if b > 0 else dn), ("impulse AGAINST backdrop", dn if b > 0 else up)):
        z = [x[3] for x in grp if x[3] is not None]
        if not z: continue
        for band, lo, hi in (("shallow", 0, 0.382), ("mid", 0.382, 0.618), ("deep", 0.618, 1.0)):
            q = [ok for rt, ok in z if lo <= rt < hi]
            print(f"   {lab:25s} pullback {band:7s}: resumed {np.mean(q):.0%} (n {len(q)})" if q else "")
