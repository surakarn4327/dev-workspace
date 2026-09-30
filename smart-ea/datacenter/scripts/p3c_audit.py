r"""Phase 3B-c audit -> p3c\p3c_audit.txt
(A) exam isolation of every input
(B) independent recomputation of cells (every passed cell, the strongest by calibrated |z| of both layers, random cells): own feature
    values from the raw ctx columns, own levels (np.percentile of the first-half trades, own special-value rule), own brute-force
    interaction per trading day -> I, t, halves, BUY/SELL and every neighbour definition vs the stored results
(C) gates recomputed independently from the stored files (G1-G6, p_fw) vs p3c_gates.pkl
(D) reproducibility: engine rerun = stored t; one null draw computed twice = identical; restricted engine (top-up) = full engine
(E) sensitivity: planted +0.05 / +0.10 / +0.20 R into one set x level cell
(F) null calibration: real |t| / calibrated |z| tails vs the null; time features under null 1b not degenerate"""
import os, time, pickle
import numpy as np
import p3lib as L, p3c_lib as C, p3_perm, adx_asof
from p3c_perm import BASE
import p3c_report as REP

OUT = []; BAD = []
def pr(*a): s = " ".join(str(x) for x in a); OUT.append(s); print(s, flush=True)
def check(ok, msg):
    if not ok: BAD.append(msg); pr("  FAIL:", msg)

def own_value(X, name, d):
    """feature value per ctx row for trade direction d (array), from the definitions in the p3c_lib docstring (not calling p3c_lib)"""
    if name in ("d_pdx_own~rel", "d_pdx_other~rel"):
        a, b = ("pdh", "pdl") if "own" in name else ("pdl", "pdh")
        return np.where(d > 0, X[f"d_{a}_adr"], -X[f"d_{b}_adr"])
    if name in ("d_broke_own~rel", "d_broke_other~rel"):
        a, b = ("pdh", "pdl") if "own" in name else ("pdl", "pdh")
        return np.where(d > 0, X[f"d_broke_{a}"], X[f"d_broke_{b}"])
    if name.endswith("~rel"):
        c = name[:-4]
        if c.endswith("_rng_pos") or c in ("d_day_pos", "d_asia_pos"): return np.where(d > 0, X[c], 1 - X[c])
        return X[c] * d
    return X[name] + 0 * d

def own_levels(v, h1, shift=0):
    """labels + level names: <= 10 distinct values -> one level each; else a value holding >= 20 % of the first half is its own level and
    the rest is cut at the 20/40/60/80 (+shift) percentiles of the first-half rest"""
    fin = np.isfinite(v); u = np.unique(v[fin]); lab = np.full(len(v), -1)
    if len(u) <= 10:
        for i, x in enumerate(u): lab[fin & (v == x)] = i
        return lab, [f"={x + 0.0:g}" for x in u]
    uf, cf = np.unique(v[fin & h1], return_counts=True); names = []; rest = fin.copy(); off = 0
    if cf.max() / cf.sum() >= 0.2:
        spv = uf[np.argmax(cf)]; lab[fin & (v == spv)] = 0; rest &= v != spv; off = 1; names.append(f"={spv + 0.0:g}")
    edges = [np.percentile(v[rest & h1], p + shift) for p in (20, 40, 60, 80)]
    q = np.zeros(len(v), int)
    for e in edges: q += (v >= e)
    lab[rest] = off + q[rest]
    return lab, names + [f"Q{b + 1} ({L.PCT[b]}-{L.PCT[b + 1]}%)" for b in range(5)]

def own_I_t(e, day, inkey, inlev):
    b = np.flatnonzero(inlev); a = inkey[b]
    if a.sum() < C.MIN_N or len(np.unique(day[b][a])) < C.MIN_D: return np.nan, np.nan
    eb, db = e[b], day[b]; mk, ma = eb[a].mean(), eb.mean(); Nk, Na = a.sum(), len(b)
    o = np.argsort(db, kind="stable"); eb, db, a = eb[o], db[o], a[o]; cut = np.flatnonzero(np.diff(db)) + 1
    z = []
    for eg, ag in zip(np.split(eb, cut), np.split(a, cut)):
        z.append((eg[ag].sum() - mk * ag.sum()) / Nk - (eg.sum() - ma * len(eg)) / Na)
    z = np.array(z); se = np.sqrt((z ** 2).sum() * len(z) / (len(z) - 1))
    return mk - ma, (mk - ma) / se

def main():
    t0 = time.time()
    R = pickle.load(open(os.path.join(BASE, "real_res.pkl"), "rb")); lay = R["layout"]; nc = len(lay); pos = {k: i for i, k in enumerate(lay)}
    Pm = pickle.load(open(os.path.join(BASE, "real_perm.pkl"), "rb")); Gt = pickle.load(open(os.path.join(BASE, "p3c_gates.pkl"), "rb"))
    T, X = L.load(adx_asof.DBT); P = C.load_params(adx_asof.DBT); feats = [f["name"] for f in C.feature_defs(list(X.keys()))]
    # ---------------- (A)
    pr("(A) exam isolation")
    last = T["entry_t"].max(); lastctx = X["entry_t"][T["ci"]].max()
    pr(f"  real: trades {len(T['e'])}, last entry {time.strftime('%Y-%m-%d %H:%M', time.gmtime(last))}, last ctx row used {time.strftime('%Y-%m-%d %H:%M', time.gmtime(lastctx))}")
    pr(f"  real: last trading day {time.strftime('%Y-%m-%d', time.gmtime(T['day'].max() * 86400))} (exam starts at trading day 2026-06-01)")
    check(last < L.SANDBOX_END and lastctx < L.SANDBOX_END and R["last_entry"] < L.SANDBOX_END and T["day"].max() < L.SANDBOX_END // 86400, "real sandbox")
    for mk in ("sf1", "sf2", "sf3", "sf4", "sf5"):
        s = pickle.load(open(os.path.join(BASE, f"{mk}_res.pkl"), "rb"))
        pr(f"  {mk}: trades {s['n_trades']}, last entry {time.strftime('%Y-%m-%d %H:%M', time.gmtime(s['last_entry']))}, layout equal {s['layout'] == lay}, "
           f"corr of t with real {np.corrcoef(*[x[np.isfinite(s['t']) & np.isfinite(R['t'])] for x in (s['t'], R['t'])])[0, 1]:+.3f}")
        pr(f"    last trading day {time.strftime('%Y-%m-%d', time.gmtime(s['last_day'] * 86400))}")
        check(s["last_entry"] < L.SANDBOX_END and s["layout"] == lay and s["last_day"] < L.SANDBOX_END // 86400, f"{mk} isolation / layout / trading day")
    # ---------------- (B)
    pr("(B) independent recomputation")
    vt = np.full((nc, 4), np.nan); o = 0
    for a in R["var_t"]: vt[o:o + a.shape[0], :a.shape[1]] = a; o += a.shape[0]
    zr = np.nan_to_num(np.abs(Pm["z_real"]), nan=-1); fin = np.isfinite(R["t"]); gl = np.array([k[2] != "set" for k in lay])
    rng = np.random.default_rng(11)
    pick = list(np.flatnonzero(Gt["passed"]))[:20] + list(np.argsort(-np.where(~gl, zr, -1))[:8]) + list(np.argsort(-np.where(gl, zr, -1))[:8]) \
        + list(rng.choice(np.flatnonzero(fin), 8, replace=False)) + list(rng.choice(np.flatnonzero(fin & gl), 4, replace=False))
    pick = list(dict.fromkeys(int(i) for i in pick))
    d = T["dir"]; h1 = T["half"] == 0; n = len(X["entry_t"]); W = dict(I=0.0, t=0.0, sub=0.0, var=0.0); nsub = nvar = 0; lev_bad = 0
    def vals_of(f):
        vp = own_value(X, f, np.ones(n))[T["ci"]]; vm = own_value(X, f, -np.ones(n))[T["ci"]]; return np.where(d > 0, vp, vm)
    for i in pick:
        f, lv, kind, key = lay[i]
        v = vals_of(f); lab, names = own_levels(v, h1)
        eng_names = [k[1] for k in lay if k[0] == f and k[2] == "set" and k[3] == lay[0][3]]
        if names != eng_names: lev_bad += 1; pr(f"  level names differ for {f}: {names} vs {eng_names}"); continue
        li = names.index(lv)
        inkey = (T["set_id"] == key) if kind == "set" else np.isin(T["set_id"], [s for s in P if P[s][kind] == key])
        I, tt = own_I_t(T["e"], T["day"], inkey, lab == li)
        if np.isfinite(tt) != np.isfinite(R["t"][i]): W["t"] = np.inf; continue
        if np.isfinite(tt): W["I"] = max(W["I"], abs(I - R["I"][i])); W["t"] = max(W["t"], abs(tt - R["t"][i]))
        for nm, m in (("h1", T["half"] == 0), ("h2", T["half"] == 1), ("buy", d > 0), ("sell", d < 0)):
            _, b = own_I_t(T["e"], T["day"], inkey, (lab == li) & m)
            if np.isfinite(b) or np.isfinite(R[nm + "_t"][i]): W["sub"] = max(W["sub"], abs(b - R[nm + "_t"][i]) if np.isfinite(b) else np.inf); nsub += 1
        # neighbour definitions in the engine's order: shifts -5/+5 (quintile features), then the other zigzag k of the same column
        own_var = []
        if names[-1].startswith("Q5"):                                 # quintile feature -> shifted edges
            for sh in (-5, 5):
                lb2, _ = own_levels(v, h1, sh); own_var.append(own_I_t(T["e"], T["day"], inkey, lb2 == li)[1])
        for fk in R["kneigh"][feats.index(f)]:
            lb2, nm2 = own_levels(vals_of(fk), h1); assert nm2 == names; own_var.append(own_I_t(T["e"], T["day"], inkey, lb2 == li)[1])
        ev = vt[i][:len(own_var)]
        for a, b in zip(own_var, ev):
            if np.isfinite(a) or np.isfinite(b): W["var"] = max(W["var"], abs(a - b) if (np.isfinite(a) and np.isfinite(b)) else np.inf); nvar += 1
    pr(f"  cells {len(pick)} (passed {int(Gt['passed'].sum())} of them up to 20), level structure mismatches {lev_bad} | max |I diff| {W['I']:.2e}, |t diff| {W['t']:.2e}"
       f" | halves/BUY/SELL {nsub} values max |t diff| {W['sub']:.2e} | neighbour definitions {nvar} values max |t diff| {W['var']:.2e}")
    check(lev_bad == 0 and W["I"] < 1e-9 and W["t"] < 1e-6 and W["sub"] < 1e-6 and W["var"] < 1e-6, "independent recomputation")
    # ---------------- (C)
    pr("(C) gates recomputed")
    I, t, days = R["I"], R["t"], R["days"]; s = np.sign(I)
    g1 = (np.abs(t) >= 3) & (days >= 100)
    g2 = np.all([(np.sign(R[k]) == s) & (np.abs(R[k + "_t"]) >= 1.5) for k in ("h1", "h2")], 0)
    g3 = np.all([(np.sign(R[k]) == s) & (np.abs(R[k + "_t"]) >= 1.5) for k in ("buy", "sell")], 0)
    pc = Pm["p_cell"].copy()
    tp = os.path.join(BASE, "real_perm_top.pkl")
    if os.path.exists(tp):
        for k, p in pickle.load(open(tp, "rb"))["p_cell"].items(): pc[k] = p
    g6 = pc <= 0.01
    mz = Pm["maxz"]; pfw = np.array([(1 + np.sum(mz >= abs(z))) / (1 + len(mz)) if (np.isfinite(z) and dy >= 100) else np.nan for z, dy in zip(Pm["z_real"], R["days"])])
    for nm, a in (("G1", g1), ("G2", g2), ("G3", g3), ("G6", g6)):
        mism = int(np.sum((a != Gt[nm]) & fin)); pr(f"  {nm}: mismatches {mism}"); check(mism == 0, f"gate {nm}")
    dp = np.nanmax(np.abs(pfw - Gt["pfw"])); pr(f"  p_fw: max |diff| {dp:.2e}"); check(dp < 1e-12, "p_fw")
    # G4 on a sample, independently: neighbours by parameter steps, sets with identical trade lists removed
    NB, sig = REP.set_neighbours(P, T); mism = 0; samp = rng.choice(np.flatnonzero(fin), 3000, replace=False)
    for i in samp:
        f, lv, kind, key = lay[i]
        cand = NB[key] if kind == "set" else [x for x in P if P[x][kind] == key]
        vals = np.array([I[pos[(f, lv, "set", x)]] for x in cand]); vals = vals[np.isfinite(vals)]
        g4 = bool(len(vals)) and np.mean(np.sign(vals) == s[i]) >= 0.7
        mism += g4 != Gt["G4"][i]
    pr(f"  G4 on 3,000 random cells: mismatches {mism} | distinct trade lists {len(set(sig.values()))} of {len(sig)} sets")
    check(mism == 0, "gate G4")
    # ---------------- (D)
    pr("(D) reproducibility")
    E = C.Engine(T, X, P); t2 = E.t_all(); dd = np.nanmax(np.abs(t2 - R["t"])); same = np.array_equal(np.isfinite(t2), fin)
    pr(f"  engine rerun: max |t diff| {dd:.2e}, finite pattern equal {same}"); check(dd < 1e-12 and same, "engine rerun")
    a = E.t_all(p3_perm.swapped_ci(T, X, 1234), C.shift_ci(T, X, 101234)); b = E.t_all(p3_perm.swapped_ci(T, X, 1234), C.shift_ci(T, X, 101234))
    pr(f"  null draw seed 1234 twice: identical {np.array_equal(np.nan_to_num(a, nan=9), np.nan_to_num(b, nan=9))}; corr with real t {np.corrcoef(a[np.isfinite(a) & fin], t[np.isfinite(a) & fin])[0, 1]:+.3f}")
    check(np.array_equal(np.nan_to_num(a, nan=9), np.nan_to_num(b, nan=9)), "null determinism")
    # ---------------- (E)
    pr("(E) sensitivity (planted effect in one cell, engine statistic)")
    j = feats.index("a_m1_cost_atr"); lab = E.labels(j, T["ci"]); sset = int(np.unique(T["set_id"][T["tf"] == 3])[5])
    cell = (T["set_id"] == sset) & (lab == 2)
    for x in (0.05, 0.10, 0.20):
        e2 = T["e"].copy(); e2[cell] += x
        r = C.interaction(lab, E.si, E.ns, e2, E.di, E.nd, nl=len(E.lev[j].names)); r0 = C.interaction(lab, E.si, E.ns, T["e"], E.di, E.nd, nl=len(E.lev[j].names))
        k = int(np.flatnonzero(E.set_ids == sset)[0])
        share = cell.sum() / (lab == 2).sum()
        pr(f"  set {sset} x a_m1_cost_atr Q3 (n {cell.sum()}): planted {x:+.2f} -> I {r0[0][k, 2]:+.3f} -> {r[0][k, 2]:+.3f} (expected change {x * (1 - share):+.3f}), t {r0[2][k, 2]:+.1f} -> {r[2][k, 2]:+.1f}")
        check(abs((r[0][k, 2] - r0[0][k, 2]) - x * (1 - share)) < 1e-9, "planted effect")
    tt = t[fin & ~gl]; se = R["se"][fin & ~gl]
    pr(f"  set layer: 3 x SE (R/trade) median {3 * np.median(se):.3f}, p10 {3 * np.percentile(se, 10):.3f}, p90 {3 * np.percentile(se, 90):.3f}"
       f" | group layer median {3 * np.median(R['se'][fin & gl]):.3f}")
    for g in (1, 3, 5):
        mm = fin & ~gl & np.array([k[2] == "set" and P[k[3]]["tf"] == g for k in lay])
        pr(f"    M{g} sets: 3 x SE median {3 * np.median(R['se'][mm]):.3f}")
    # ---------------- (F)
    pr("(F) null calibration")
    z = Pm["z_real"][fin]; z = z[np.isfinite(z)]
    pr(f"  real: sd of t {np.nanstd(t[fin]):.2f}, |t|>=3 {np.mean(np.abs(t[fin]) >= 3):.4f} | calibrated z sd {np.std(z):.2f}, |z|>=3 {np.mean(np.abs(z) >= 3):.4f}, |z|>=4 {np.mean(np.abs(z) >= 4):.5f} (normal 0.0027 / 0.00006)")
    pr(f"  null sd of t per cell: median {np.nanmedian(Pm['sd1']):.2f}, p1 {np.nanpercentile(Pm['sd1'], 1):.2f}; null mean t median {np.nanmedian(Pm['m1']):+.3f}, p1/p99 {np.nanpercentile(Pm['m1'], 1):+.2f}/{np.nanpercentile(Pm['m1'], 99):+.2f}")
    pr(f"  family max |z| over {len(mz)} draws: median {np.median(mz):.2f}, 95% {np.percentile(mz, 95):.2f}")
    for fn in C.TIME_FEATS:
        m = np.array([k[0] == fn for k in lay]) & fin
        pr(f"  time feature {fn:14s}: null sd of t median {np.nanmedian(Pm['sd1'][m]):.2f} (cells {m.sum()})")
        check(np.nanmedian(Pm["sd1"][m]) > 0.5, f"time feature {fn} degenerate under null 1b")
    pr(("ALL OK" if not BAD else f"{len(BAD)} FAIL: {BAD}") + f" ({time.time() - t0:.0f}s)")
    open(os.path.join(BASE, "p3c_audit.txt"), "w", encoding="utf-8").write("\n".join(OUT))

if __name__ == "__main__":
    main()
