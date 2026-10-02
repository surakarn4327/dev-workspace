r"""Report for flip_events.py (see there). Rules compared against "hold T to its planned exit" (delta = r_cut + r_new - r_plan, R units;
weighted version multiplies by the EA's volume size multipliers 0.5 / 1.5 for T and for the new trade N).
SE = clustered by trading day. Gates (same spirit as phase 3B): G1 |t|>=3 and >=100 days; G2 both halves same sign |t|>=1.5;
G3 T=BUY and T=SELL same sign |t|>=1.5; G4 >=70% of the 108 (TF x ADX x EMA x SL x exit) combos same sign; G5 M1/M3/M5 all same sign.
Usage: python flip_report.py"""
import os, pickle, datetime
import numpy as np
import broker as BK

ROOT = os.path.dirname(BK.DB)
HALF_DAY = (datetime.date(2025, 5, 8) - datetime.date(1970, 1, 1)).days

def load(tag):
    with open(os.path.join(ROOT, f"flip_events_{tag}.pkl") if tag == "real" else os.path.join(ROOT, "p3_null", tag, f"flip_events_{tag}.pkl"), "rb") as f:
        E = pickle.load(f)["events"]
    keys = ("tf", "adx_p", "ema_p", "sl", "dT", "eT", "es", "day", "hold_min", "vrT", "vrN", "cls", "r_plan", "r_cut", "r_new", "hit1", "hit2", "plan_reason", "new_reason", "adxN", "gapN")
    A = {k: np.array([e[k] for e in E], dtype=float) for k in keys}
    A["ex"] = np.array([1 if e["ex"] == "L" else 0 for e in E])
    A["combo"] = np.array([hash((e["tf"], e["adx_p"], e["ema_p"], e["sl"], e["ex"])) for e in E])
    # trade id = (family, sl, exit, entry time)
    A["tid"] = np.array([hash((e["tf"], e["adx_p"], e["ema_p"], e["sl"], e["ex"], e["eT"])) for e in E])
    wT = np.where(A["vrT"] < 0, 1.0, np.where(A["vrT"] < 0.9, 0.5, 1.5)); wN = np.where(A["cls"] == 1, 1.5, 0.5)
    A["d_u"] = A["r_cut"] + A["r_new"] - A["r_plan"]
    A["d_w"] = wT * (A["r_cut"] - A["r_plan"]) + wN * A["r_new"]
    A["w_plan"] = wT * A["r_plan"]
    A["half"] = (A["day"] >= HALF_DAY).astype(int)
    return A

def cl_stat(x, day):
    """mean, day-clustered SE, t, n, ndays"""
    n = len(x)
    if n < 2: return (np.nan, np.nan, np.nan, n, 0)
    m = x.mean(); u, inv = np.unique(day, return_inverse=True)
    s = np.bincount(inv, weights=x - m); se = np.sqrt((s ** 2).sum()) / n
    return (m, se, m / se if se > 0 else np.nan, n, len(u))

def sel_rule(A, rule):
    c = A["cls"]; vT = A["vrT"]
    if rule == "any1":                                   # first opposite signal of any volume class per trade
        # keep the earlier one of the two events of the same trade
        order = np.lexsort((A["es"], A["tid"])); first = np.zeros(len(c), bool)
        t = A["tid"][order]; first[order[np.r_[True, t[1:] != t[:-1]]]] = True
        return first
    if rule == "high": return c == 1
    if rule == "user": return (c == 1) & (vT >= 0) & (vT < 0.9)
    if rule == "high_high": return (c == 1) & (vT >= 0.9)
    if rule == "low": return c == 0
    if rule == "low_low": return (c == 0) & (vT >= 0) & (vT < 0.9)
    if rule == "low_high": return (c == 0) & (vT >= 0.9)
    raise KeyError(rule)

RULES = ["any1", "high", "user", "high_high", "low", "low_low", "low_high"]
LABEL = {"any1": "สัญญาณสวนตัวแรก (volume ใดก็ได้)", "high": "สวน volume สูง (>=0.90)", "user": "ไม้เดิม volume ต่ำ + สวน volume สูง (เคสผู้ใช้)",
         "high_high": "ไม้เดิม volume สูง + สวน volume สูง", "low": "สวน volume ต่ำ (<0.90)", "low_low": "ไม้เดิมต่ำ + สวนต่ำ", "low_high": "ไม้เดิมสูง + สวนต่ำ"}

def main():
    R = load("real"); nulls = []
    for s in ("sf1", "sf2", "sf3", "sf4", "sf5"):
        try: nulls.append(load(s))
        except FileNotFoundError: pass
    print(f"events real {len(R['d_u'])}  null markets {len(nulls)}")
    for rule in RULES:
        m = sel_rule(R, rule)
        print(f"\n=== {LABEL[rule]}  [{rule}] ===")
        for name in ("d_u", "d_w"):
            mu, se, t, n, nd = cl_stat(R[name][m], R["day"][m])
            nl = [cl_stat(N[name][sel_rule(N, rule)], N["day"][sel_rule(N, rule)])[0] for N in nulls]
            print(f"  {name}: mean {mu:+.3f} R  t {t:+.1f}  n {n} days {nd} | components plan {R['r_plan'][m].mean():+.3f} cut {R['r_cut'][m].mean():+.3f} new {R['r_new'][m].mean():+.3f}"
                  + (f" | null markets mean {np.mean(nl):+.3f} (sd {np.std(nl):.3f})" if nl else ""))
    # detailed gates for the user's rule and for "high"
    for rule in ("user", "high", "any1"):
        m = sel_rule(R, rule); print(f"\n--- gates: {LABEL[rule]} ---")
        for name in ("d_u", "d_w"):
            x = R[name]; out = []
            for lab, mm in (("half1", m & (R["half"] == 0)), ("half2", m & (R["half"] == 1)), ("T=BUY", m & (R["dT"] == 1)), ("T=SELL", m & (R["dT"] == -1)),
                            ("M1", m & (R["tf"] == 1)), ("M3", m & (R["tf"] == 3)), ("M5", m & (R["tf"] == 5)), ("ladder", m & (R["ex"] == 1)), ("T3", m & (R["ex"] == 0))):
                mu, se, t, n, nd = cl_stat(x[mm], R["day"][mm]); out.append(f"{lab} {mu:+.3f}(t{t:+.1f},n{n})")
            print(f"  {name}: " + "  ".join(out))
            # share of the 108 combos with the same sign
            cs = np.unique(R["combo"][m]); pos = [x[m & (R["combo"] == c)].mean() > 0 for c in cs]
            print(f"     combos with positive mean: {np.mean(pos):.0%} of {len(cs)}")
    # by floating result of T at the signal (r_cut is T's result if closed now)
    for rule in ("high", "user"):
        m = sel_rule(R, rule); print(f"\n--- {LABEL[rule]}: split by T's result if closed now (r_cut) ---")
        edges = [-9, -0.5, 0, 0.5, 1, 9]
        for a, b in zip(edges[:-1], edges[1:]):
            mm = m & (R["r_cut"] >= a) & (R["r_cut"] < b)
            r1 = cl_stat(R["d_u"][mm], R["day"][mm]); r2 = cl_stat(R["d_w"][mm], R["day"][mm])
            print(f"  r_cut [{a:+.1f},{b:+.1f}): n {r1[3]:6d}  d_u {r1[0]:+.3f} (t{r1[2]:+.1f})  d_w {r2[0]:+.3f} (t{r2[2]:+.1f})  plan {R['r_plan'][mm].mean():+.2f}  new {R['r_new'][mm].mean():+.2f}")

if __name__ == "__main__":
    main()
