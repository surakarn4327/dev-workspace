r"""Phase 3B-b report: apply the gates (fixed before looking, see p3b_lib docstring) to every pattern, compare with the random-direction
markets, write p3b\p3b_results.csv (every pattern, every gate) + p3b\p3b_summary.txt.
Needs p3b\real_res.pkl, p3b\real_perm.pkl, p3b\sf*_res.pkl."""
import os, glob, pickle, csv
import numpy as np
import broker as BK
import p3b_lib as B

BASE = os.path.join(os.path.dirname(BK.DB), "p3b")
MK = os.environ.get("P3B_MARKET", "real")                  # test runs only

MIN_DAYS_T = 30

def p_two(col, t):
    """two-sided permutation p of t relative to the null draws `col` (NaN draws ignored)"""
    c = col[np.isfinite(col)]; n = len(c)
    if n == 0: return 1.0
    return float(min(1.0, 2 * min((1 + np.sum(c >= t)) / (n + 1), (1 + np.sum(c <= t)) / (n + 1))))

def gates(r, p_perm, pre=""):
    g = {}; m = r[pre + "mean"]; s = np.sign(m)
    g["G1"] = bool(abs(r[pre + "t"]) >= 3 and r[pre + "days"] >= 100)
    g["G2"] = bool(all(np.sign(r[pre + h]) == s and abs(r[pre + h + "_t"]) >= 1.5 for h in ("h1", "h2")))
    g["G3"] = bool(all(np.sign(r[pre + h]) == s and abs(r[pre + h + "_t"]) >= 1.5 for h in ("buy", "sell")))
    g["G4"], nf = B.fam_gate(dict(mean=m, fam_mean=r[pre + "fam_mean"], fam_n=r[pre + "fam_n"]))
    vt, vm = r.get(pre + "var_t", []), r.get(pre + "var_mean", [])
    g["G5"] = bool(len(vt) > 0 and all(np.sign(a) == s and abs(t) >= 1.5 for a, t in zip(vm, vt)))
    g["G6"] = bool(p_perm <= 0.01)
    return g, nf

def main():
    R = pickle.load(open(os.path.join(BASE, f"{MK}_res.pkl"), "rb")); res = R["res"]
    P = pickle.load(open(os.path.join(BASE, f"{MK}_perm.pkl"), "rb")); Tn = P["t_null"]; npr = P["n_primary"]
    assert npr == len(res)
    sfs = [pickle.load(open(f, "rb"))["res"] for f in sorted((glob.glob(os.path.join(BASE, "sf*_res.pkl")) if MK == "real" else []))]
    for s in sfs: assert [(x["tf"], x["alt"], x["grp"], x["feat"], x["level"]) for x in s] == [(x["tf"], x["alt"], x["grp"], x["feat"], x["level"]) for x in res]
    nP = Tn.shape[0]
    # 2,000 draws where G6 decides: candidates (G1-G5) topped up by p3b_perm_top.py, S patterns by a 2,000-draw sign flip; others 500
    full = {}
    topf = os.path.join(BASE, f"{MK}_perm_top.pkl")
    if os.path.exists(topf):
        TP = pickle.load(open(topf, "rb"))
        for k, c in enumerate(TP["cols"]): full[c] = np.r_[Tn[:, c], TP["t_top"][:, k]]
        for k, c in enumerate(TP["s_cols"]): full[c] = TP["t_s2000"][:, k]
    ncol = lambda c: full.get(c, Tn[:, c])
    # The day-swap null is NOT centred at 0 for every pattern (the first occurrence of an event picks systematic moments of the trade,
    # e.g. the first bar in a small profit, which the coarse state strata do not remove). So (fixed 2026-09-29, before the gate results were
    # read): G6 = two-sided permutation p relative to the null distribution of that pattern, and the family-wise p uses the per-pattern
    # standardised z = (t - null mean) / null sd, max over the testable patterns (real days >= 30; fewer days -> day-clustered SE unreliable,
    # such patterns cannot pass G1 anyway).
    mu_n = np.nanmean(Tn, 0); sd_n = np.nanstd(Tn, 0)
    testable = np.array([r["days"] >= MIN_DAYS_T and np.isfinite(r["t"]) and sd_n[i] > 0 for i, r in enumerate(res)])
    Zn = (Tn[:, :npr][:, testable] - mu_n[:npr][testable]) / sd_n[:npr][testable]; mxz = np.nanmax(np.abs(Zn), 1)
    be_idx = [i for i, r in enumerate(res) if r["alt"] == "be"]; far_col = {i: npr + j for j, i in enumerate(be_idx)}
    rows = []
    for i, r in enumerate(res):
        t = r["t"]; col = ncol(i)
        pp = p_two(col, t) if np.isfinite(t) and r["n"] > 0 and r["days"] >= MIN_DAYS_T else 1.0
        zr = (t - mu_n[i]) / sd_n[i] if testable[i] else np.nan
        pfw = (1 + np.sum(mxz >= abs(zr))) / (nP + 1) if testable[i] else 1.0
        g, nf = gates(r, pp)
        row = dict(tf=r["tf"], alt=r["alt"], grp=r["grp"], feat=r["feat"], level=str(r["level"]), n=r["n"], days=r["days"], mean=r["mean"], se=r["se"],
                   t=t, half_mean=(r["mean"] / 2 if r["alt"] == "cut" else np.nan), h1=r["h1"], h1_t=r["h1_t"], h2=r["h2"], h2_t=r["h2_t"],
                   buy=r["buy"], buy_t=r["buy_t"], sell=r["sell"], sell_t=r["sell_t"], fam_mean=np.round(r["fam_mean"], 4).tolist(),
                   fam_n=r["fam_n"], fam_ok_n=nf, var_t=np.round(r.get("var_t", []), 2).tolist(), null_t_mean=mu_n[i], null_t_sd=sd_n[i],
                   z_null=zr, testable=bool(testable[i]), p_perm=pp, n_draws=int(np.isfinite(col).sum()), p_fw=pfw, **g)
        passed = all(g.values())
        if r["alt"] == "be":
            c = ncol(far_col[i]); ft = r["far_t"]
            fpp = p_two(c, ft) if np.isfinite(ft) and r["far_n"] > 0 and r["far_days"] >= MIN_DAYS_T else 1.0
            fg, _ = gates(r, fpp, "far_")
            row.update(far_mean=r["far_mean"], far_t=ft, far_n=r["far_n"], far_p_perm=fpp, far_gates="".join(k[1] for k, v in fg.items() if v))
            row["far_all"] = all(fg.values()); passed = passed and row["far_all"]
        if sfs:
            sl = np.array([s[i]["mean"] for s in sfs], float); msf = np.nanmean(sl); ssf = np.nanstd(sl, ddof=1)
            z = (r["mean"] - msf) / np.sqrt(r["se"] ** 2 + ssf ** 2 / np.isfinite(sl).sum()) if np.isfinite(r["se"]) else np.nan
            if np.sign(r["mean"] - msf) == np.sign(r["mean"]) and abs(z) >= 2: lab = "gold"
            elif np.sign(msf) == np.sign(r["mean"]) and abs(msf) >= 0.5 * abs(r["mean"]): lab = "mechanical"
            else: lab = "between"
            row.update(sf_mean=msf, sf_sd=ssf, sf_t_mean=np.nanmean([s[i]["t"] for s in sfs]), z_vs_sf=z, null2=lab)
        row["passed"] = passed; row["failed"] = ",".join(k for k, v in g.items() if not v)
        rows.append(row)
    L = []; pr = lambda *a: L.append(" ".join(str(x) for x in a))
    nT = len(rows); rt = np.array([r["t"] for r in rows]); ok = np.array([r["n"] > 0 for r in rows])
    pr(f"patterns (primary): {nT}  (with >= 1 trade: {ok.sum()}); per TF x alt: " +
       ", ".join(f"M{tf}/{a} {sum(1 for r in rows if r['tf']==tf and r['alt']==a)}" for tf in B.TFS for a in B.ALTS))
    pr(f"neighbour statistics: {sum(len(r['var_t']) for r in rows)}; BE-far versions: {sum(1 for r in rows if r['alt']=='be')}")
    tst = np.array([r["days"] >= MIN_DAYS_T for r in rows]) & ok
    pr(f"real |t|>=3: {np.sum(np.abs(rt[ok])>=3)} (testable {np.sum(np.abs(rt[tst])>=3)}), |t|>=2: {np.sum(np.abs(rt[ok])>=2)}, "
       f"sd of t (testable, days >= {MIN_DAYS_T}) {np.std(rt[tst]):.2f}")
    Tp = Tn[:, :npr][:, ok]
    zr_all = np.array([r["z_null"] for r in rows])
    pr(f"null ({nP} draws): sd of t {np.nanstd(Tp):.2f}, share |t|>=3 {np.nanmean(np.abs(Tp)>=3):.4f} (x {ok.sum()} = {np.nanmean(np.abs(Tp)>=3)*ok.sum():.1f}); "
       f"patterns whose null is off-centre (|null mean t| >= 1): {int(np.sum(np.abs(mu_n[:npr][ok]) >= 1))}")
    pr(f"testable (days >= {MIN_DAYS_T}): {testable.sum()} | real |z vs null| >= 3: {np.sum(np.abs(zr_all[testable]) >= 3)}, null expected "
       f"{np.nanmean(np.abs(Zn) >= 3) * testable.sum():.1f}; max |z| per draw median {np.median(mxz):.2f}, 95% {np.percentile(mxz, 95):.2f}")
    for grp in ("E", "S", "C"):
        m = np.array([r["grp"] == grp for r in rows]) & ok
        m = m & tst
        pr(f"  group {grp}: {m.sum()} testable patterns, real |t|>=3 {np.sum(np.abs(rt[m])>=3)}, null expected {np.nanmean(np.abs(Tn[:, :npr][:, m])>=3)*m.sum():.1f}, "
           f"real sd {np.std(rt[m]):.2f} null sd {np.nanstd(Tn[:, :npr][:, m]):.2f}")
    if sfs:
        st = np.array([[s[i]["t"] for i in range(nT)] for s in sfs])
        pr(f"random-direction markets ({len(sfs)}): sd of t {np.nanstd(st):.2f}, |t|>=3 per market {np.mean(np.sum(np.abs(st)>=3,1)):.1f}")
    for gk in ("G1", "G2", "G3", "G4", "G5", "G6"): pr(f"  pass {gk}: {sum(r[gk] for r in rows)}")
    pr(f"  pass G1-G6: {sum(all(r[g] for g in ('G1','G2','G3','G4','G5','G6')) for r in rows)}; + BE-far (BE only) = passed: {sum(r['passed'] for r in rows)}")
    # minimal detectable effect at |t| = 3 (median over patterns with >= 1000 trades)
    pr("\nsensitivity: effect detectable at |t| = 3 (median 3 x SE, patterns with >= 1000 trades), R per trade:")
    for grp in ("E", "S", "C"):
        pr("  " + grp + " " + "  ".join(f"M{tf}/{a} {3*np.median([r['se'] for r in rows if r['tf']==tf and r['alt']==a and r['grp']==grp and r['n']>=1000] or [np.nan]):.3f}"
                                   for tf in B.TFS for a in B.ALTS))
    def fmt(r):
        s = (f"M{r['tf']} {r['alt']:4s} {r['grp']} {r['feat']:18s} {r['level'][:10]:10s} n {r['n']:6d} d {r['days']:3d} | {r['mean']:+.3f}R t {r['t']:+.1f} "
             f"H1/H2 {r['h1']:+.3f}/{r['h2']:+.3f} ({r['h1_t']:+.1f}/{r['h2_t']:+.1f}) B/S {r['buy']:+.3f}/{r['sell']:+.3f} ({r['buy_t']:+.1f}/{r['sell_t']:+.1f}) "
             f"fam {r['fam_mean']} var t {r['var_t']} null t {r['null_t_mean']:+.1f}±{r['null_t_sd']:.1f} z {r['z_null']:+.1f} p {r['p_perm']:.4f} ({r['n_draws']}) pfw {r['p_fw']:.3f}")
        if r["alt"] == "be": s += f" | far {r['far_mean']:+.3f} t {r['far_t']:+.1f} gates {r['far_gates']}"
        if "null2" in r: s += f" | sf {r['sf_mean']:+.3f} z {r['z_vs_sf']:+.1f} {r['null2']}"
        return s + f" | fail {r['failed'] or '-'}"
    pr("\n=== PASSED ALL GATES ==="); [pr(fmt(r)) for r in rows if r["passed"]]
    pr("\n=== |t| >= 3 (sorted) ==="); [pr(fmt(r)) for r in sorted(rows, key=lambda r: -abs(r["t"])) if abs(r["t"]) >= 3]
    pr("\n=== pass G2-G6 but |t| < 3 (hints only) ===")
    [pr(fmt(r)) for r in rows if not r["G1"] and all(r[g] for g in ("G2", "G3", "G4", "G5", "G6")) and abs(r["t"]) >= 2]
    keys = list(rows[0].keys()) + [k for k in ("far_mean", "far_t", "far_n", "far_p_perm", "far_gates", "far_all") if k not in rows[0]]
    with open(os.path.join(BASE, f"p3b_results{"" if MK == "real" else "_" + MK}.csv"), "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f); w.writerow(keys)
        for r in rows: w.writerow([r.get(k, "") if not isinstance(r.get(k), (float, np.floating)) else round(float(r[k]), 5) for k in keys])
    pickle.dump(rows, open(os.path.join(BASE, f"p3b_rows{"" if MK == "real" else "_" + MK}.pkl"), "wb"))
    open(os.path.join(BASE, f"p3b_summary{"" if MK == "real" else "_" + MK}.txt"), "w", encoding="utf-8").write("\n".join(L)); print("\n".join(L))

if __name__ == "__main__":
    main()
