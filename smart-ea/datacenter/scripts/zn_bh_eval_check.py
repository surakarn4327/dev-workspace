r"""Recompute step-4 evaluation rows (zn_bh_eval_m<tf>.csv) with separate plain code: every row passing all gates + 30 random rows per TF.
mean / random / excess / t / fake / first half / from-above, SE clustered by trading day written as an explicit per-day loop."""
import sys, os, csv, math
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, zn_ev as EV, zn_bh as BH
OUT = r"C:\trade datacenter\zn"; MK = ["real", "sf1", "sf2", "sf3"]; bad = 0; nchk = 0
GR = {"REASON": EV.REASON, "PASS": EV.PASS}

def clus(y, d):
    ok = np.isfinite(y); y = y[ok]; d = d[ok]
    if len(y) < 30: return float("nan"), float("nan")
    tot = {}; cnt = {}
    for v, dd in zip(y.tolist(), d.tolist()): tot[dd] = tot.get(dd, 0.0) + v; cnt[dd] = cnt.get(dd, 0) + 1
    n = len(y); mu = sum(tot.values()) / n
    return mu, math.sqrt(sum((tot[k] - cnt[k] * mu) ** 2 for k in tot)) / n

for tf in EV.OBS:
    rows = list(csv.DictReader(open(os.path.join(OUT, f"zn_bh_eval_m{tf}.csv"), encoding="utf-8")))
    rng = np.random.default_rng(5 + tf); pick = [r for r in rows if r["all"] == "True"][:60] + [rows[i] for i in rng.choice(len(rows), 30, replace=False)]
    E = {m: np.load(os.path.join(OUT, f"zn_ev_m{tf}_{m}.npz")) for m in MK}; H = {m: np.load(os.path.join(OUT, f"zn_bh_m{tf}_{m}.npz")) for m in MK}
    days = np.unique(H["real"]["v0_day"]); MID = days[len(days) // 2]; cache = {}
    def base(m, vi):
        if (m, vi) not in cache:
            ev = H[m][f"v{vi}_ev"]; cache[(m, vi)] = dict(type=E[m][f"v{vi}_type"][ev], side=E[m][f"v{vi}_side"][ev], bits=H[m][f"v{vi}_bits"],
                                                          k1=H[m][f"v{vi}_k1"], k2=H[m][f"v{vi}_k2"], day=H[m][f"v{vi}_day"])
        return cache[(m, vi)]
    for r in pick:
        tys = [EV.TYPES.index(x) for x in GR.get(r["group"], [r["group"]])]
        def sel(b):
            m = np.zeros(len(b["type"]), bool)
            for t_ in tys: m |= b["type"] == t_
            if r["kind"] == "named": m &= (b["bits"] & BH.BIT[r["label"]]) != 0
            else: m &= (b["k1"] if r["kind"] == "code1" else b["k2"]) == int(r["label"])
            return m
        def stat(m, vi, sub=None):
            b = base(m, vi); k = sel(b)
            if sub == "h1": k &= b["day"] < MID
            if sub == "above": k &= b["side"] > 0
            return clus(H[m][f"v{vi}_{r['dir']}_{r['meas']}"][k].astype(float), b["day"][k])
        mu, se = stat("real", 0); nl = [stat(m, 0) for m in MK[1:]]
        null = np.nanmean([a for a, _ in nl]); nse = math.sqrt(np.nanmean([b_ ** 2 for _, b_ in nl]) / 3); ex = mu - null; t = ex / math.sqrt(se ** 2 + nse ** 2)
        fk = np.nanmean([stat("real", vi)[0] for vi in (3, 4)])
        h1 = stat("real", 0, "h1")[0] - np.nanmean([stat(m, 0, "h1")[0] for m in MK[1:]])
        ab = stat("real", 0, "above")[0] - np.nanmean([stat(m, 0, "above")[0] for m in MK[1:]])
        for k, v in dict(mean=mu, random=null, excess=ex, t=t, fake=fk, h1=h1, above=ab).items():
            if abs(float(r[k]) - v) > (0.011 if k == "t" else 6e-5): bad += 1; print("FAIL", tf, r["group"], r["label"], r["dir"], r["meas"], k, r[k], v, flush=True)
        nchk += 1
    print(f"M{tf} checked {len(pick)}", flush=True)
print(f"checked {nchk} rows:", "PASS" if not bad else f"FAIL {bad}")
