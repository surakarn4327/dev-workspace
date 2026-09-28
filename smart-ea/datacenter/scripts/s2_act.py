"""Task 1: is the 2026 weakening explained by market activity (measurable before entry)?
For the two stage-2 candidates: activity features at entry, effect WITHIN each half (so time and activity are not confounded),
quarter table of activity vs R, and a joint regression R ~ time + activity."""
import numpy as np
from datetime import datetime, timezone
from scipy import stats as ss
import s2lib as L
CANDS = [("PREVDAY_BREAK", 1, 0.10, 0.5), ("SWING_BREAKOUT_THEN_REVERSAL", -1, 0.30, 1.0)]
B = L.bars(); D = L.days(); di = {k: i for i, k in enumerate(D["day"])}
def features(E, d):
    ix = np.searchsorted(B["t"], E["t"]); f = {}
    f["ADR % of price"] = np.array([D["adr20"][di[k]] / D["open"][di[k]] * 100 for k in E["day"]])
    f["60m range / ADR"] = np.array([(B["h"][max(0, i - 59):i + 1].max() - B["l"][max(0, i - 59):i + 1].min()) / U for i, U in zip(ix, E["U"])])
    f["60m path / ADR"] = np.array([np.abs(np.diff(B["c"][max(0, i - 60):i + 1])).sum() / U for i, U in zip(ix, E["U"])])
    f["yday range / ADR"] = np.array([D["range"][di[k] - 1] / D["adr20"][di[k]] if di[k] > 0 else np.nan for k in E["day"]])
    f["ADR5 / ADR20"] = np.array([np.mean(D["range"][max(0, di[k] - 5):di[k]]) / D["adr20"][di[k]] for k in E["day"]])
    f["spread / SL"] = E["spread_adr"]
    return f
for ty, orient, sl, tp in CANDS:
    E = L.events([ty]); d = E["dir"] * orient
    R, _ = L.simulate(E["t"], d, E["U"], sls=np.array([sl]), tps=np.array([tp])); r = R[:, 0, 0]; ok = np.isfinite(r)
    F = features(E, d); F["spread / SL"] = E["spread_adr"] / sl
    t = E["t"]; tmid = np.median(t[ok]); h = [ok & (t < tmid), ok & (t >= tmid)]
    print(f"\n=== {ty} {'rev' if orient < 0 else 'def'} SL{sl}/TP{tp}  n={ok.sum()}  mean H1 {r[h[0]].mean():+.3f} H2 {r[h[1]].mean():+.3f}")
    print("  feature            | median H1 -> H2 | Spearman rho H1 / H2 | tercile mean R (edges on all data): H1 [lo mid hi] | H2 [lo mid hi]")
    for name, x in F.items():
        e = np.nanquantile(x[ok], [1 / 3, 2 / 3]); tb = np.digitize(x, e)
        rho = [ss.spearmanr(x[m], r[m], nan_policy="omit")[0] for m in h]
        tm = [" ".join(f"{r[m & (tb == k)].mean():+.2f}({(m & (tb == k)).sum()})" for k in range(3)) for m in h]
        print(f"  {name:18s} | {np.nanmedian(x[h[0]]):6.3f} -> {np.nanmedian(x[h[1]]):6.3f} | {rho[0]:+.3f} / {rho[1]:+.3f}        | {tm[0]} | {tm[1]}")
    # joint regression R ~ time(years) + z(feature)
    yrs = (t - t[ok].min()) / 86400 / 365
    for name in ("ADR % of price", "60m range / ADR", "ADR5 / ADR20"):
        x = F[name]; m = ok & np.isfinite(x); z = (x - np.nanmean(x[m])) / np.nanstd(x[m])
        X = np.column_stack([np.ones(m.sum()), yrs[m], z[m]]); b, res, *_ = np.linalg.lstsq(X, r[m], rcond=None)
        e = r[m] - X @ b; s2 = e @ e / (m.sum() - 3); se = np.sqrt(np.diag(s2 * np.linalg.inv(X.T @ X)))
        print(f"  regress R ~ years + z({name}): years {b[1]:+.3f} (t {b[1] / se[1]:+.1f}) | activity {b[2]:+.3f} per SD (t {b[2] / se[2]:+.1f})")
    q = L.quarter_key(t)
    print("  quarter | n  | mean R | ADR%price | 60m range/ADR | ADR5/ADR20")
    for k in sorted(set(q[ok])):
        m = ok & (q == k)
        print(f"  {k // 10}Q{k % 10}  | {m.sum():3d} | {r[m].mean():+.2f}  | {np.median(F['ADR % of price'][m]):.2f}      | {np.median(F['60m range / ADR'][m]):.3f}         | {np.median(F['ADR5 / ADR20'][m]):.2f}")
