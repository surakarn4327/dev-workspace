r"""Audit of the M1/M3/M5 pattern-outcome evaluation (po_eval2_m<tf>.csv), written separately from po_eval2:
 A. recompute 60 random cells per TF (+ every 'all gates' cell) from the raw library files: mean R, clustered SE by day, null mean,
    excess, t, halves, BUY/SELL, G1-G4 -> compare with the csv
 B. the random-direction markets are synthetic (candle direction agreement with the real market) and cover the same bars
 C. calibration: distribution of the null-vs-null z by TF and by family (why M3 expects more |t| >= 3 by chance)
Uses its own trade simulation from the stored first-passage columns (not po_lib.trade_R) for grid cells.
Usage: PO_TF=<tf> python po_audit.py   Output: po\po_audit_m<tf>.txt"""
import sys, os, csv
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np
TF = int(os.environ.get("PO_TF", 5)); D = r"C:\trade datacenter\po"; MK = ["real", "sf1", "sf2", "sf3"]
LV = np.r_[np.arange(0.25, 12.01, 0.25), [14, 16, 18, 20, 24]]; RR = np.array([0.5, 1, 1.5, 2, 3, 4, 6]); TR_D = np.array([1.0, 1.5, 2.0, 3.0]); COST = 0.31
BITN = ["big", "pin", "vspike", "inside", "pivot", "regime", "boxbreak", "pdh", "pdl", "dayhigh", "daylow", "asiahigh", "asialow", "check"]
BIT = {n: 1 << i for i, n in enumerate(BITN)}
out = []
def say(s=""): print(s, flush=True); out.append(s)
L = {m: dict(np.load(os.path.join(D, f"po_m{TF}_{m}.npz"))) for m in MK}
# contexts: use po_eval2's context_arrays (checked against the phase-2 ctx table by po_ctx_check)
src = open(r"C:\trade datacenter\scripts\po_eval2.py", encoding="utf-8").read().split("t0 = time.time()")[0]
ns = {}; exec(compile(src, "po_eval2_defs", "exec"), ns)
import po_lib as PO
C = {m: ns["context_arrays"](PO.load_market(m), L[m]) for m in MK}
rows_csv = list(csv.DictReader(open(os.path.join(D, f"po_eval2_m{TF}.csv"), encoding="utf-8")))
key = {(r["fam"], r["mode"], r["ctx"], r["cell"]): r for r in rows_csv}
days = np.unique(L["real"]["day"]); MID = days[len(days) // 2]

def fam(R, Cm, f):
    fl = R["flags"]
    if f in ("big", "pin", "pivot", "regime", "boxbreak", "vspike", "inside"):
        m = (fl & BIT[f]) != 0
        d = {"big": R["dir_big"], "pin": R["dir_pin"], "pivot": R["dir_piv"], "regime": R["dir_reg"], "boxbreak": R["dir_box"],
             "vspike": Cm["cdir"], "inside": Cm["mother"]}[f]
    else:
        a, z = {"pdx": ("pdh", "pdl"), "dayext": ("dayhigh", "daylow"), "asia": ("asiahigh", "asialow")}[f]
        u = (fl & BIT[a]) != 0; w = (fl & BIT[z]) != 0; m = u ^ w; d = np.where(u, 1, -1)
    d = np.asarray(d); r = np.flatnonzero(m & (d != 0)); return r, d[r].astype(np.int64)

def ctxm(Cm, r, side, c):
    if c == "none": return np.ones(len(r), bool)
    if c == "reg_with": return Cm["reg"][r] * side > 0
    if c == "reg_against": return Cm["reg"][r] * side < 0
    if c == "reg_side": return Cm["reg"][r] == 0
    p = np.where(side > 0, Cm["pos"][r], 1 - Cm["pos"][r])
    if c == "day_with": return p >= 0.5
    if c == "day_against": return p < 0.5
    return Cm["sess"][r] == ["sess_asia", "sess_london", "sess_ny", "sess_late"].index(c)

def grid_one(R, q, sd, s, tp):
    """own simulation from first-passage columns for one trade (plain python)"""
    li = int(np.flatnonzero(np.isclose(LV, s))[0]); ti = None if tp is None else int(np.flatnonzero(np.isclose(LV, s * tp))[0])
    U, Dn, UG, DG = (R["up_t"], R["dn_t"], R["up_g"], R["dn_g"]) if sd > 0 else (R["dn_t"], R["up_t"], R["dn_g"], R["up_g"])
    tS = Dn[q, li]; tT = -1 if ti is None else U[q, ti]
    hitS = tS >= 0; hitT = tT >= 0
    if hitS and (not hitT or tS <= tT): x = -s - DG[q, li]           # SL first (same point -> SL)
    elif hitT: x = LV[ti] + UG[q, ti]
    else: x = sd * R["fin"][q]
    return x / s - COST / (s * R["atr"][q])

def cell_vals(R, r, side, cell):
    v = np.empty(len(r))
    if cell.startswith("SLwick"):
        rk = int(np.flatnonzero(np.isclose(RR, float(cell.split("TP")[1][:-1])))[0])
        for i, (q, sd) in enumerate(zip(r, side)):
            s = R["s_b"][q] if sd > 0 else R["s_s"][q]
            if s <= 0: v[i] = np.nan; continue
            tS = (R["sb_t"] if sd > 0 else R["ss_t"])[q]; g = (R["sb_g"] if sd > 0 else R["ss_g"])[q]; tT = (R["sbT_t"] if sd > 0 else R["ssT_t"])[q, rk]
            if tS >= 0 and (tT < 0 or tS < tT): x = -s - g
            elif tT >= 0 and (tS < 0 or tT < tS): x = RR[rk] * s
            else: x = sd * R["fin"][q]
            v[i] = x / s - COST / (s * R["atr"][q])
        return v
    if cell.startswith("trail"):
        k = int(np.flatnonzero(np.isclose(TR_D, float(cell[5:])))[0]); d = TR_D[k]
        return np.array([(R["tr_b"] if sd > 0 else R["tr_s"])[q, k] / d - COST / (d * R["atr"][q]) for q, sd in zip(r, side)])
    s = float(cell.split("_")[0][2:]); tp = cell.split("TP")[1]; tp = None if tp == "none" else float(tp[:-1])
    return np.array([grid_one(R, q, sd, s, tp) for q, sd in zip(r, side)])

def stat(x, day):
    ok = np.isfinite(x); x, day = x[ok], day[ok]
    if len(x) < 30: return np.nan, np.nan, 0
    mu = x.mean(); tot = {}
    for a, b in zip(day, x): tot[a] = tot.get(a, 0.0) + (b - mu)
    return mu, np.sqrt(sum(v * v for v in tot.values())) / len(x), len(tot)

def evaluate(f, mode, c, cell):
    res = {}
    for m in MK:
        R, Cm = L[m], C[m]; r, d = fam(R, Cm, f); side = d * (1 if mode == "with" else -1)
        k = ctxm(Cm, r, side, c); r, side = r[k], side[k]
        res[m] = (cell_vals(R, r, side, cell), R["day"][r], side)
    x, day, side = res["real"]; mu, se, nd = stat(x, day)
    nst = [stat(res[m][0], res[m][1]) for m in MK[1:]]; nmu = np.array([a[0] for a in nst]); nse = np.array([a[1] for a in nst])
    null = np.nanmean(nmu); nse_ = np.sqrt(np.nanmean(nse ** 2) / 3); ex = mu - null; t = ex / np.sqrt(se ** 2 + nse_ ** 2)
    o = dict(mean_R=mu, se=se, days=nd, null_R=null, excess=ex, t_excess=t)
    for nm, sel in (("h1", lambda dd, s: dd < MID), ("h2", lambda dd, s: dd >= MID), ("buy", lambda dd, s: s > 0), ("sell", lambda dd, s: s < 0)):
        k = sel(day, side); m_, s_, _ = stat(x[k], day[k])
        nn = [stat(res[m][0][sel(res[m][1], res[m][2])], res[m][1][sel(res[m][1], res[m][2])])[0] for m in MK[1:]]
        o[nm] = m_ - np.nanmean(nn); o["t_" + nm] = o[nm] / s_
    return o

rng = np.random.default_rng(TF)
pick = [rows_csv[i] for i in rng.choice(len(rows_csv), 60, replace=False)] + [r for r in rows_csv if r["all"] == "True"]
say(f"== A. M{TF}: recompute {len(pick)} cells ({sum(r['all'] == 'True' for r in rows_csv)} all-gate cells included) ==")
bad = 0; worst = 0
for r in pick:
    o = evaluate(r["fam"], r["mode"], r["ctx"], r["cell"])
    for k in ("mean_R", "null_R", "excess", "t_excess", "h1", "t_h1", "h2", "t_h2", "buy", "t_buy", "sell", "t_sell"):
        a = float(r[k]); b = o[k]
        if np.isnan(a) and np.isnan(b): continue
        tol = 0.006 if k.startswith("t_") else 6e-5            # csv rounded to 4 d.p. / 2 d.p.
        dif = abs(a - b); worst = max(worst, dif / tol)
        if not dif <= tol: bad += 1; say(f"  MISMATCH {r['fam']} {r['mode']} {r['ctx']} {r['cell']} {k}: csv {a} mine {b}") if bad < 20 else None
    if int(r["days"]) != o["days"]: bad += 1; say(f"  DAYS MISMATCH {r['cell']} {r['days']} {o['days']}")
say(f"  mismatches {bad}  (worst diff / tolerance {worst:.2f})")
# gates recomputed from the csv values (G4 neighbours) for all rows
SLS = [0.5, 1, 2, 3]; RRS = ["1", "2", "4", "none"]
gb = 0
for r in rows_csv:
    f = lambda k: float(r[k]); sg = np.sign(f("excess"))
    g1 = abs(f("t_excess")) >= 3.5 and int(r["days"]) >= 100
    g2 = np.sign(f("h1")) == sg == np.sign(f("h2")) and abs(f("t_h1")) >= 1.5 and abs(f("t_h2")) >= 1.5
    g3 = np.sign(f("buy")) == sg == np.sign(f("sell")) and abs(f("t_buy")) >= 1.5 and abs(f("t_sell")) >= 1.5
    nb = []
    if r["kind"] == "grid":
        si = SLS.index(float(r["sl"])); ri = RRS.index(r["rr"].replace(".0", "") if r["rr"] != "none" else "none")
        for ds, dr in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            if 0 <= si + ds < 4 and 0 <= ri + dr < 4:
                rr_ = RRS[ri + dr]; nm = f"SL{SLS[si + ds]:g}_TP{'none' if rr_ == 'none' else rr_ + 'R'}"
                nb.append(np.sign(float(key[(r["fam"], r["mode"], r["ctx"], nm)]["excess"])) == sg)
    g4 = bool(nb) and np.mean(nb) >= 0.75
    mine = (g1, g2, g3, g4, g1 and g2 and g3 and g4)
    theirs = tuple(r[k] == "True" for k in ("G1", "G2", "G3", "G4", "all"))
    if mine != theirs: gb += 1
say(f"  gates recomputed for all {len(rows_csv)} rows: mismatches {gb}")

say(f"\n== B. random-direction markets M{TF} ==")
for m in MK[1:]:
    same_b = np.array_equal(L[m]["b"], L["real"]["b"]); agree = np.mean(C[m]["cdir"] == C["real"]["cdir"]) if same_b else np.nan
    say(f"  {m}: rows {len(L[m]['b'])} (real {len(L['real']['b'])}) same bar set {same_b}  candle direction agrees with real {agree:.1%}"
        f"  pdx events {len(fam(L[m], C[m], 'pdx')[0])} (real {len(fam(L['real'], C['real'], 'pdx')[0])})  last day {L[m]['day'].max()} (real {L['real']['day'].max()})")

say(f"\n== C. calibration M{TF}: null market k vs the other two, all cells ==")
zs = {}
for r in rows_csv:
    zs.setdefault(r["fam"], [])
# recompute the null-vs-null z quickly with vectorised po_eval2 functions (same formula as po_eval2)
ev = ns
import itertools
allz = []; famz = {}
for f in ["big", "pin", "vspike", "inside", "pivot", "regime", "boxbreak", "pdx", "dayext", "asia"]:
    for mode in ("with", "against"):
        for c in ns["CTX"]:
            for cell in ns["CELLS"]:
                st = []
                for m in MK[1:]:
                    R, Cm = L[m], C[m]; r, d = ns["fam_rows"](R, Cm, f); side = d * (1 if mode == "with" else -1)
                    k = ns["ctx_mask"](Cm, r, side, c); x = ns["cell_R"](R, r[k], side[k], cell); st.append(ns["cstat"](x, R["day"][r[k]])[:2])
                nmu = np.array([a for a, _ in st]); nse = np.array([b for _, b in st])
                for k in range(3):
                    o = [j for j in range(3) if j != k]
                    z = (nmu[k] - np.nanmean(nmu[o])) / np.sqrt(nse[k] ** 2 + np.nanmean(nse[o] ** 2) / 2)
                    if np.isfinite(z): allz.append(z); famz.setdefault((f, c), []).append(z)
allz = np.array(allz)
say(f"  n {len(allz)}  sd {allz.std():.3f}  share |z|>=3 {np.mean(np.abs(allz) >= 3):.4f} (normal 0.0027)  |z|>=3.5 {np.mean(np.abs(allz) >= 3.5):.4f}")
top = sorted(((np.mean(np.abs(np.array(v)) >= 3), k, len(v)) for k, v in famz.items()), reverse=True)[:8]
say("  (family, ctx) with the largest share of |z|>=3: " + "; ".join(f"{k[0]}/{k[1]} {s:.3f} of {n}" for s, k, n in top))
open(os.path.join(D, f"po_audit_m{TF}.txt"), "w", encoding="utf-8").write("\n".join(out))
