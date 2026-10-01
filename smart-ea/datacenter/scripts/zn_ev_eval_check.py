r"""Recompute step-3 evaluation rows (zn_ev_eval.csv) with separate plain code: every row that passed all gates + 40 random rows.
rev share / random / excess / t / fake / halves / above-below / D neighbours, day-clustered SE written as an explicit loop over days."""
import sys, os, csv, math
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, adx_ctx as X, zn_ev as EV
OUT = r"C:\trade datacenter\zn"; MK = ["real", "sf1", "sf2", "sf3"]
rows = list(csv.DictReader(open(os.path.join(OUT, "zn_ev_eval.csv"), encoding="utf-8")))
rng = np.random.default_rng(3); pick = [r for r in rows if r["all"] == "True"] + [rows[i] for i in rng.choice(len(rows), 40, replace=False)]
M = X.load(None); bad = 0

def clus(vals, days):
    by = {}
    for v, d in zip(vals, days): by.setdefault(int(d), []).append(v)
    n = sum(len(x) for x in by.values())
    if n < 30: return float("nan"), float("nan")
    mu = sum(sum(x) for x in by.values()) / n
    return mu, math.sqrt(sum((sum(x) - len(x) * mu) ** 2 for x in by.values())) / n

cache = {}
for r in pick:
    tf = int(r["tf"]); ti = EV.TYPES.index(r["type"]); kk = EV.KS.index(int(r["k"]))
    if tf not in cache:
        B = EV.obs_bars(M, tf); cache[tf] = (B, {m: dict(np.load(os.path.join(OUT, f"zn_ev_m{tf}_{m}.npz"))) for m in MK})
    B, E = cache[tf]; days = np.unique(B["day"]); MID = days[len(days) // 2]
    e0 = E["real"]; k0 = e0["v0_type"] == ti
    edges = {f: np.nanquantile(e0[f"v0_{f}"][k0], [1 / 3, 2 / 3]) for f in ("v3", "leg12")}
    def cond(e, vi, i):
        c = r["cond"]; g = lambda f: e[f"v{vi}_{f}"][i]
        if c == "all": return True
        if c == "first": return not g("prior")
        if c == "again": return bool(g("prior"))
        if c == "today": return bool(g("today"))
        if c == "older": return not g("today")
        if c in ("role_with", "role_against"): return (g("role") * g("side") > 0) if c == "role_with" else (g("role") * g("side") < 0)
        f, q = c.rsplit("_", 1); v = g(f); ed = edges[f]
        if not np.isfinite(v): return False
        return {"low": v < ed[0], "mid": ed[0] <= v < ed[1], "high": v >= ed[1]}[q]
    def vals(m, vi, extra=lambda e, i: True):
        e = E[m]; ys, ds = [], []
        for i in np.flatnonzero(e[f"v{vi}_type"] == ti):
            if not cond(e, vi, i) or not extra(e, i): continue
            o = e[f"v{vi}_oc"][i, kk]
            if o == 0: continue
            ys.append(1.0 if o == 1 else 0.0); ds.append(B["day"][e[f"v{vi}_j"][i]])
        return ys, ds
    mu, se = clus(*vals("real", 0)); nl = [clus(*vals(m, 0)) for m in MK[1:]]
    null = np.nanmean([a for a, _ in nl]); nse = math.sqrt(np.nanmean([b ** 2 for _, b in nl]) / 3); ex = mu - null; t = ex / math.sqrt(se ** 2 + nse ** 2)
    fy, fd = vals("real", 3); fy2, fd2 = vals("real", 4); fmu, _ = clus(fy + fy2, fd + fd2)
    h1 = clus(*vals("real", 0, lambda e, i: B["day"][e["v0_j"][i]] < MID))[0] - np.nanmean([clus(*vals(m, 0, lambda e, i: B["day"][e["v0_j"][i]] < MID))[0] for m in MK[1:]])
    ab = clus(*vals("real", 0, lambda e, i: e["v0_side"][i] > 0))[0] - np.nanmean([clus(*vals(m, 0, lambda e, i: e["v0_side"][i] > 0))[0] for m in MK[1:]])
    d2 = clus(*vals("real", 2))[0] - np.nanmean([clus(*vals(m, 2))[0] for m in MK[1:]])
    got = dict(rev_share=mu, random=null, excess=ex, t=t, fake=fmu, h1=h1, above=ab, D2=d2)
    for k, v in got.items():
        tol = 0.011 if k == "t" else 6e-5
        if abs(float(r[k]) - v) > tol: bad += 1; print("FAIL", r["tf"], r["type"], r["cond"], r["k"], k, r[k], v)
print(f"checked {len(pick)} rows ({sum(r['all'] == 'True' for r in pick)} that pass all gates):", "PASS" if not bad else f"FAIL {bad}")
