"""Task 4: tradable sequence conditions. For each candidate: does what happened BEFORE the signal (within a lookback window, known at entry)
change the R? Conditions: squeeze break / fast move / prev-day false break / swing events (same or opposite dir) in the prior 60 or 240 min,
and yesterday's day type. Reports mean R with/without, H1/H2, BUY/SELL. Many comparisons -> only |diff| with both halves same sign matter."""
import numpy as np
import s2lib as L
CANDS = [("PREVDAY_BREAK", 1, 0.10, 0.5), ("SWING_BREAKOUT_THEN_REVERSAL", -1, 0.30, 1.0)]
ALL = L.events(); D = L.days(); di = {k: i for i, k in enumerate(D["day"])}
PRE = ["SQUEEZE_BREAK", "FASTMOVE", "PREVDAY_FALSEBREAK", "PREVDAY_BREAK", "SWING_LOWERHIGH_HIGHERLOW", "SWING_BREAKOUT_THEN_REVERSAL", "SWING_DOUBLE", "SWING_SWEEP"]
for ty, o, sl, tp in CANDS:
    E = L.events([ty]); d = E["dir"] * o
    r = L.simulate(E["t"], d, E["U"], sls=np.array([sl]), tps=np.array([tp]))[0][:, 0, 0]; ok = np.isfinite(r)
    t = E["t"]; tmid = np.median(t[ok]); h1 = t < tmid
    print(f"\n=== {ty} {'rev' if o < 0 else 'def'} SL{sl}/TP{tp}  n {ok.sum()} mean {r[ok].mean():+.3f}")
    print("  condition (before signal, same session)        | with: n  mean  H1    H2    BUY   SELL | without: mean | diff")
    def show(name, cm):
        m = ok & cm; w = ok & ~cm
        if m.sum() < 25 or w.sum() < 25: return
        f = lambda mm: f"{r[mm].mean():+.2f}" if mm.sum() >= 8 else "  -- "
        print(f"  {name:46s} | {m.sum():4d} {r[m].mean():+.2f} {f(m & h1)} {f(m & ~h1)} {f(m & (d > 0))} {f(m & (d < 0))} | {r[w].mean():+.2f}"
              f"          | {r[m].mean() - r[w].mean():+.2f} {'*' if np.sign(r[m & h1].mean() - r[w & h1].mean()) == np.sign(r[m & ~h1].mean() - r[w & ~h1].mean()) else ''}")
    for pt in PRE:
        mp = ALL["type"] == pt
        for win in (60, 240):
            for rel in ("same", "opp"):
                cm = np.zeros(len(t), bool)
                for k in range(len(t)):
                    sd = d[k] if rel == "same" else -d[k]
                    sel = mp & (ALL["day"] == E["day"][k]) & (ALL["t"] < t[k]) & (ALL["t"] >= t[k] - win * 60) & (ALL["dir"] == sd)
                    cm[k] = sel.any()
                show(f"{pt[:28]} {rel} dir <= {win} min", cm)
    yt = np.array([str(D["day_type"][di[k] - 1]) if di[k] > 0 else "None" for k in E["day"]])
    for v in ("trend", "quiet", "normal", "two_sided"): show(f"yesterday = {v}", yt == v)
    ynet = np.array([np.sign(D["net_adr"][di[k] - 1]) * dd if di[k] > 0 else 0 for k, dd in zip(E["day"], d)])
    show("yesterday closed in trade dir", ynet > 0)
