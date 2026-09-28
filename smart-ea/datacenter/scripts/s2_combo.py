"""Task 3: combine the two stage-2 candidates into one stream, one position at a time (first signal wins, skip while a trade is open).
Cells fixed in advance (no tuning): PREVDAY_BREAK SL0.10/TP0.5, SWING_BREAKOUT_THEN_REVERSAL reversed SL0.30/TP1.0.
Reports R stats and a 5%-risk compounding illustration from 10,000 USC reset every calendar year (no lot cap)."""
import numpy as np
from datetime import datetime, timezone
import s2lib as L
LEGS = [("PREVDAY_BREAK", 1, 0.10, 0.5, "PDB"), ("SWING_BREAKOUT_THEN_REVERSAL", -1, 0.30, 1.0, "SWB")]
T, R, H, DIR, SRC = [], [], [], [], []
for ty, o, sl, tp, tag in LEGS:
    E = L.events([ty]); d = E["dir"] * o
    r, hold = L.simulate(E["t"], d, E["U"], sls=np.array([sl]), tps=np.array([tp])); r, hold = r[:, 0, 0], hold[:, 0, 0]; ok = np.isfinite(r)
    T += list(E["t"][ok]); R += list(r[ok]); H += list(hold[ok]); DIR += list(d[ok]); SRC += [tag] * ok.sum()
T, R, H, DIR, SRC = map(np.array, (T, R, H, DIR, SRC)); o = np.argsort(T, kind="stable"); T, R, H, DIR, SRC = T[o], R[o], H[o], DIR[o], SRC[o]
keep = []; busy = -1
for k in range(len(T)):
    if T[k] >= busy: keep.append(k); busy = T[k] + 60 * H[k]
k = np.array(keep); r, t, d, src = R[k], T[k], DIR[k], SRC[k]
def line(name, m):
    st = L.stats(r[m]); eq = np.cumsum(r[m]); dd = np.max(np.maximum.accumulate(eq) - eq) if m.sum() else 0
    return (f"  {name:12s} n {m.sum():4d} mean {st['mean']:+.3f} t {st['t']:+.1f} total {r[m].sum():+6.1f}R wr {st['wr']:.0%} "
            f"W {st['aw']:+.2f} L {st['al']:+.2f} maxDD {dd:.1f}R streak {st['streak']}")
tmid = np.median(t); allm = np.ones(len(r), bool)
print(f"combined one-at-a-time: {len(r)} trades from {len(T)} signals (skipped {len(T) - len(r)})")
for name, m in (("ALL", allm), ("H1", t < tmid), ("H2", t >= tmid), ("BUY", d > 0), ("SELL", d < 0), ("from PDB", src == "PDB"), ("from SWB", src == "SWB")):
    print(line(name, m))
q = L.quarter_key(t); print("  quarters: " + " ".join(f"{x // 10}Q{x % 10} {r[q == x].sum():+.1f}" for x in sorted(set(q))))
mon = np.array([datetime.fromtimestamp(int(x), timezone.utc).strftime("%Y-%m") for x in t]); ms = np.array([r[mon == m].sum() for m in sorted(set(mon))])
print(f"  months positive {(ms > 0).sum()}/{len(ms)}, worst month {ms.min():+.1f}R, best {ms.max():+.1f}R")
yr = np.array([datetime.fromtimestamp(int(x), timezone.utc).year for x in t])
for risk in (0.01, 0.02, 0.05):
    out = []
    for y in sorted(set(yr)):
        eq = 10000.0; peak = eq; mdd = 0
        for x in r[yr == y]:
            eq *= 1 + risk * x; peak = max(peak, eq); mdd = max(mdd, 1 - eq / peak)
        out.append(f"{y}: {eq - 10000:+,.0f} USC (DD {mdd:.0%})")
    print(f"  risk {risk:.0%}/trade, 10,000 reset yearly: " + " | ".join(out))
