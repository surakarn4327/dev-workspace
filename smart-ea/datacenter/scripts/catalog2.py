"""Behaviour catalogue v2: unit U = ADR20 (mean session range of the previous 20 sessions, known before the day).
Swing/minute behaviours measured as fractions of U so years are comparable. Counts per year + what follows."""
import numpy as np, pickle
from datetime import datetime, timezone
from collections import defaultdict
B = np.load("bars.npz"); t, o, h, l, c = B["t"], B["o"], B["h"], B["l"], B["c"]
sess = (t + 3600) // 86400; mfo = (((t // 3600) % 24 - 23) % 24) * 60 + (t // 60) % 60
ii = np.where(mfo < 17 * 60)[0]; ss = sess[ii]; bd = np.flatnonzero(np.diff(ss)) + 1
S = [ii[a:e] for a, e in zip(np.concatenate([[0], bd]), np.concatenate([bd, [len(ss)]]))]
S = [w for w in S if len(w) >= 600]
Y = [datetime.fromtimestamp(int(t[w[0]]) + 3600, timezone.utc).year for w in S]
EV = defaultdict(list); ndays = defaultdict(int); rngs = []
def zigzag(w, th):
    piv = []; d = 0; ep = c[w[0]]; ei = 0; start = c[w[0]]
    for n in range(1, len(w)):
        hi_, lo_ = h[w[n]], l[w[n]]
        if d == 0:
            if hi_ >= start + th: d = 1; ep, ei = hi_, n
            elif lo_ <= start - th: d = -1; ep, ei = lo_, n
        elif d == 1:
            if hi_ >= ep: ep, ei = hi_, n
            elif lo_ <= ep - th: piv.append((ei, ep, 1)); d = -1; ep, ei = lo_, n
        else:
            if lo_ <= ep: ep, ei = lo_, n
            elif hi_ >= ep + th: piv.append((ei, ep, -1)); d = 1; ep, ei = hi_, n
    return piv
for w, y in zip(S, Y):
    R = h[w].max() - l[w].min()
    U = np.mean(rngs[-20:]) if len(rngs) >= 20 else np.nan
    rngs.append(R)
    if not np.isfinite(U) or U <= 0: continue
    ndays[y] += 1
    # ----- swings: reversal threshold 0.2 U
    piv = zigzag(w, 0.2 * U)
    EV["S0 swing legs (reversal >= 20% of ADR)"].extend([(y, {})] * max(len(piv) - 1, 0))
    for m in range(1, len(piv)):
        i0, p0, _ = piv[m - 1]; i1, p1, t1 = piv[m]; leg = abs(p1 - p0) / U
        if leg >= 0.5 and m + 1 < len(piv):
            p2 = piv[m + 1][1]; retr = abs(p2 - p1) / abs(p1 - p0)
            if m + 2 < len(piv): resumed = (piv[m + 2][1] - p1) * np.sign(p1 - p0) > 0
            else:
                tail = c[w[piv[m + 1][0]:]]; resumed = bool(((tail.max() - p1) if p1 > p0 else (p1 - tail.min())) > 0)
            band = "A shallow <38%" if retr < 0.382 else ("B mid 38-62%" if retr < 0.618 else ("C deep 62-100%" if retr < 1.0 else "D reversed >100%"))
            EV[f"S1 impulse >= 50% ADR, pullback {band}"].append((y, dict(resumed=resumed)))
        if m >= 2:
            q0, s0 = piv[m - 2][1], piv[m - 2][2]
            if s0 == t1:
                beyond = (p1 - q0) * t1 / U
                nxt = abs(piv[m + 1][1] - p1) / U if m + 1 < len(piv) else np.nan
                if abs(beyond) <= 0.03: EV["S2 double top/bottom (within 3% ADR)"].append((y, dict(next=nxt)))
                elif 0.03 < beyond <= 0.08: EV["S3 sweep: new extreme 3-8% ADR beyond, then reversal >= 20%"].append((y, dict(next=nxt)))
                elif beyond > 0.08: EV["S4 breakout: new extreme > 8% ADR beyond previous swing"].append((y, dict(next=nxt)))
                else: EV["S5 lower high / higher low (failed to reach previous extreme)"].append((y, dict(next=nxt)))
    # ----- minute level
    rng1 = h[w] - l[w]
    EV["M1 spike bar (1-min range >= 8% ADR)"].extend([(y, {})] * int(np.sum(rng1 >= 0.08 * U)))
    k = 60; n = len(w)
    while k + 60 < n:
        r60 = (h[w[k - 60:k]].max() - l[w[k - 60:k]].min()) / U
        if r60 <= 0.12:
            nx = (h[w[k:k + 60]].max() - l[w[k:k + 60]].min()) / U
            EV["M2 squeeze (60-min range <= 12% ADR)"].append((y, dict(next_range=nx, expanded=nx >= 0.2)))
            k += 60
        else: k += 15
    k = 30
    while k + 60 < n:
        mv = (c[w[k]] - c[w[k - 30]]) / U
        if abs(mv) >= 0.25:
            nxt = c[w[k:k + 60]]; back = ((c[w[k]] - nxt.min()) if mv > 0 else (nxt.max() - c[w[k]])) / U
            cont = ((nxt.max() - c[w[k]]) if mv > 0 else (c[w[k]] - nxt.min())) / U
            EV["M3 fast move >= 25% ADR in 30 min"].append((y, dict(vrev=back >= 0.6 * abs(mv), cont=cont >= 0.1)))
            k += 60
        else: k += 5
years = [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]
print(" behaviour (unit = ADR20)                                           | " + " | ".join(f"{y}" for y in years) + " | per day 2024-26 | per day 2019-23")
for name in sorted(EV):
    rows = EV[name]; cnt = {y: sum(1 for r in rows if r[0] == y) for y in years}
    pd_new = sum(cnt[y] for y in (2024, 2025, 2026)) / sum(ndays[y] for y in (2024, 2025, 2026))
    pd_old = sum(cnt[y] for y in range(2019, 2024)) / sum(ndays[y] for y in range(2019, 2024))
    print(f" {name[:66]:66s} | " + " | ".join(f"{cnt[y]:4d}" for y in years) + f" | {pd_new:6.2f} | {pd_old:6.2f}")
print("\n WHAT FOLLOWS (2024-26 | 2019-23):")
def frac(name, key, ys):
    v = [r[1][key] for r in EV[name] if r[0] in ys and r[1].get(key) is not None and not (isinstance(r[1][key], float) and np.isnan(r[1][key]))]
    return (np.mean(v), len(v)) if v else (np.nan, 0)
NEW, OLD = (2024, 2025, 2026), tuple(range(2019, 2024))
for band in ("A shallow <38%", "B mid 38-62%", "C deep 62-100%", "D reversed >100%"):
    nm = f"S1 impulse >= 50% ADR, pullback {band}"
    a, na = frac(nm, "resumed", NEW); b, nb = frac(nm, "resumed", OLD)
    print(f"  after impulse, pullback {band:18s}: trend resumed to a new extreme {a:.0%} (n {na}) | {b:.0%} (n {nb})")
for nm in ("S2 double top/bottom (within 3% ADR)", "S3 sweep: new extreme 3-8% ADR beyond, then reversal >= 20%",
           "S4 breakout: new extreme > 8% ADR beyond previous swing", "S5 lower high / higher low (failed to reach previous extreme)"):
    a, na = frac(nm, "next", NEW); b, nb = frac(nm, "next", OLD)
    print(f"  {nm[:60]:60s}: next leg median-ish mean {a:.2f} ADR (n {na}) | {b:.2f} (n {nb})")
a, na = frac("M2 squeeze (60-min range <= 12% ADR)", "expanded", NEW); b, nb = frac("M2 squeeze (60-min range <= 12% ADR)", "expanded", OLD)
print(f"  squeeze -> next 60 min range >= 20% ADR (expansion): {a:.0%} (n {na}) | {b:.0%} (n {nb})")
a, na = frac("M3 fast move >= 25% ADR in 30 min", "vrev", NEW); b, nb = frac("M3 fast move >= 25% ADR in 30 min", "vrev", OLD)
a2, _ = frac("M3 fast move >= 25% ADR in 30 min", "cont", NEW); b2, _ = frac("M3 fast move >= 25% ADR in 30 min", "cont", OLD)
print(f"  fast move -> V-reversal (>=60% back in 60 min): {a:.0%} | {b:.0%} ;  -> continued >= 10% ADR further: {a2:.0%} | {b2:.0%}")
print("\n days used:", dict(ndays))
pickle.dump((dict(EV), dict(ndays)), open("catalog2.pkl", "wb"))
