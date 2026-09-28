"""Task 1 (2026-09-28): does the anatomy of a small-TF episode change with the state of the bigger TF it sits in?
Each small-TF UP/DOWN episode (cat_episodes.episodes, zigzag k ATR of that TF) is labelled with the BIG-TF regime known at the moment the
small episode became known (big-TF bars fully closed at or before that time, pivots confirmed by then) -> no future data.
  WITH    small episode goes the same way as the big TF (e.g. M5 up while H1 up)
  AGAINST small episode goes against the big TF (= the big TF's pullback, e.g. M5 down while H1 up)
  SIDE    big TF sideway
Real vs 3 sign-flipped copies (every TF rebuilt from the same flipped M1, so the mechanical nesting is kept in the null too).
usage: python cat_nest.py [k]      (k = zigzag ATR multiple used on BOTH TFs, default 3)"""
import sys, pickle, numpy as np
import cat_bars as CB, cat_struct as CS, cat_episodes as CE
K = float(sys.argv[1]) if len(sys.argv) > 1 else 3.0
M = CB.m1(); FS = CB.full_list(); ND = len(FS); tv = M["tv"].astype(float)
SER = {"real": (M["o"], M["h"], M["l"], M["c"])}
for s in range(3): SER[f"flip{s}"] = CS.signflip_m1(M["o"], M["h"], M["l"], M["c"], tv, M["sid"], 1300 + s)[:4]
PAIRS = ((1, 5), (1, 15), (1, 60), (5, 15), (5, 60), (15, 60), (15, 240))
TFS = sorted({x for pr in PAIRS for x in pr})
def nm(tf): return f"M{tf}" if tf < 60 else f"H{tf // 60}"
EP = {}
for name in SER:
    Bs = {tf: CS.resample(tf, M["t"], M["sid"], *SER[name], tv) for tf in TFS}
    R = {tf: CE.regime_bars(Bs[tf], K) for tf in TFS}
    E = {}
    for tf in TFS:
        B = Bs[tf]; bday = M["day"][B["m1_end"] - 1]; ok = np.isin(bday, FS); L = []
        for e in CE.episodes(B, K):
            if not ok[e["i_ext"]]: continue
            e["minutes"] = (B["t"][e["i_ext"]] - B["t"][e["i_first"]]) / 60; e["t_known"] = B["t"][e["i_known"]]; e["t_end"] = B["t"][e["i_end"]]
            L.append(e)
        E[tf] = L
    for c, pa in PAIRS:
        tp = Bs[pa]["t"]
        for e in E[c]:
            j0 = np.searchsorted(tp, e["t_known"], "right") - 1; j1 = np.searchsorted(tp, e["t_end"], "right") - 1
            e[f"par{pa}"] = int(R[pa][j0]) if j0 >= 0 else 0; e[f"par{pa}_end"] = int(R[pa][j1]) if j1 >= 0 else 0
    EP[name] = E
    print(name, "done", {nm(tf): len(E[tf]) for tf in TFS}, flush=True)
pickle.dump(EP, open(f"cat_nest_k{K:g}.pkl", "wb"))

def rel(e, pa):
    s = e[f"par{pa}"]; return "side" if s == 0 else ("with" if s == e["dir"] else "against")
KEYS = ["n", "episodes/day", "pullbacks=0", "pullbacks=1", "pullbacks>=3", "depth 1 median", "depth 2 median", "impulse 2/1 median",
        "move ATR median", "minutes median", "end = new extreme failed", "last push shorter", "final break / last push median", "parent changed by end"]
def summ(E):
    r = CE.summarize(E, ND)
    if E: r["parent changed by end"] = np.mean([e["_pc"] for e in E])
    return r
def fmt(key, x):
    if x is None or (isinstance(x, float) and not np.isfinite(x)): return "   -  "
    if key == "n": return f"{x:6d}"
    if key == "minutes median": return f"{x:6.0f}"
    if key in ("episodes/day",) or "median" in key: return f"{x:6.2f}"
    return f"{x:6.0%}"
for c, pa in PAIRS:
    cols = []; heads = []
    for d, dn in ((1, "UP"), (-1, "DN")):
        for rl in ("with", "against", "side"):
            E = [e for e in EP["real"][c] if e["dir"] == d and rel(e, pa) == rl]
            for e in E: e["_pc"] = e[f"par{pa}_end"] != e[f"par{pa}"]
            cols.append(summ(E)); heads.append(f"{dn}-{rl[:4]}")
    for rl in ("with", "against", "side"):
        per = []
        for s in range(3):
            E = [e for e in EP[f"flip{s}"][c] if rel(e, pa) == rl]
            for e in E: e["_pc"] = e[f"par{pa}_end"] != e[f"par{pa}"]
            per.append(summ(E))
        cols.append({k: (np.nanmean([p.get(k, np.nan) for p in per]) if k != "n" else int(sum(p.get(k, 0) for p in per) / 3)) for k in KEYS})
        heads.append(f"rnd-{rl[:4]}")
        cols[-1]["_rng"] = {k: (np.nanmin([p.get(k, np.nan) for p in per]), np.nanmax([p.get(k, np.nan) for p in per])) for k in KEYS if k != "n"}
    for x in cols[6:]: x["episodes/day"] = x["episodes/day"] / 2 if np.isfinite(x["episodes/day"]) else x["episodes/day"]   # per direction
    print(f"\n=== {nm(c)} episodes inside {nm(pa)} state (k={K:g}) | UP/DN = small-TF direction ; with/agai/side = big-TF state ; rnd = sign-flip mean (per direction)")
    print(f"  {'':30s}| " + " | ".join(f"{h:>8s}" for h in heads))
    for key in KEYS:
        print(f"  {key:30s}| " + " | ".join(f"{fmt(key, col.get(key)):>8s}" for col in cols))
