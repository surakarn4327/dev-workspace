r"""Phase 3 report: apply the pass gates to every pattern, compare with both nulls, test pairs of passers, write
p3_results.csv (every pattern, every gate) + p3_summary.txt. Needs p3_real.pkl, p3_perm.pkl, p3_null\p3_sf*.pkl.

Gates (fixed before looking at the results, 2026-09-28):
 G1 |t| >= 3 over the whole sandbox (residual vs own set x direction x half, SE clustered by trading day), and >= 100 days
 G2 both halves the same sign as the whole, each |t| >= 1.5
 G3 BUY and SELL the same sign, each |t| >= 1.5
 G4 >= 70 % of the parameter sets (with >= 30 trades in the pattern) have the same sign
 G5 every neighbour definition (percentile band -5/+5, zigzag 2/4, regime tolerance 0.25/0.5 ATR, footprint age, windows) the same
    sign with |t| >= 1.5 (patterns without any neighbour definition cannot pass G5 -> reported as "not verifiable")
 G6 day-swap permutation p <= 0.01 (share of permutations with |t| >= real |t|)
 Null 2 (random-direction markets, 5 seeds): label "gold" if real lift differs from the synthetic lift by |z| >= 2 in the direction of
 the real lift, "mechanical" if the synthetic markets show the same sign with >= half the size, else "between"."""
import os, glob, pickle, csv
import numpy as np
import p3lib as L, adx_asof

HERE = os.path.dirname(adx_asof.DBT)

def gates(r, pt):
    s = np.sign(r["lift"]); g = {}
    g["G1"] = abs(r["t"]) >= 3 and r["days"] >= 100
    g["G2"] = all(np.sign(r[h]) == s and abs(r[h + "_t"]) >= 1.5 for h in ("h1", "h2"))
    g["G3"] = all(np.sign(r[h]) == s and abs(r[h + "_t"]) >= 1.5 for h in ("buy", "sell"))
    g["G4"] = bool(r["sets_same"] >= 0.7)
    g["G5"] = (r["n_var"] > 0) and all(np.sign(a) == s and abs(t) >= 1.5 for a, t in zip(r["var_lift"], r["var_t"]))
    g["G6"] = pt <= 0.01
    return g

def main():
    real = pickle.load(open(os.path.join(HERE, "p3_real.pkl"), "rb"))["res"]
    P = pickle.load(open(os.path.join(HERE, "p3_perm.pkl"), "rb")); Tn = P["t_null"]
    assert P["keys"] == [(r["tf"], r["feat"], r["level"]) for r in real]
    sfs = [pickle.load(open(f, "rb"))["res"] for f in sorted(glob.glob(os.path.join(HERE, "p3_null", "p3_sf*.pkl")))]
    for s in sfs: assert [(r["tf"], r["feat"], r["level"]) for r in s] == P["keys"]
    nP = Tn.shape[0]; lines = []
    pr = lambda *a: lines.append(" ".join(str(x) for x in a))
    rows = []
    for i, r in enumerate(real):
        pt = (1 + np.sum(np.abs(Tn[:, i]) >= abs(r["t"]))) / (nP + 1)
        pfw = (1 + np.sum(np.abs(Tn).max(1) >= abs(r["t"]))) / (nP + 1)   # family-wise: vs the largest |t| of all patterns per permutation
        g = gates(r, pt)
        sl = np.array([s[i]["lift"] for s in sfs]); st = np.array([s[i]["t"] for s in sfs])
        msf = np.nanmean(sl); ssf = np.nanstd(sl, ddof=1)
        z = (r["lift"] - msf) / np.sqrt(r["se"] ** 2 + ssf ** 2 / len(sl))
        if np.sign(r["lift"] - msf) == np.sign(r["lift"]) and abs(z) >= 2: lab = "gold"
        elif np.sign(msf) == np.sign(r["lift"]) and abs(msf) >= 0.5 * abs(r["lift"]): lab = "mechanical"
        else: lab = "between"
        rows.append(dict(r, p_perm=pt, p_fw=pfw, sf_lift=msf, sf_sd=ssf, sf_t_mean=np.nanmean(st), z_vs_sf=z, null2=lab, **g,
                         passed=all(g.values()), failed=",".join(k for k, v in g.items() if not v)))
    # ---- summary numbers
    nT = len(rows); rate_perm = np.mean(np.abs(Tn) >= 3); sd_perm = Tn.std()
    sf_t = np.array([[s[i]["t"] for i in range(nT)] for s in sfs])
    pr(f"patterns tested (primary definitions): {nT} = M1 {sum(r['tf']==1 for r in rows)}, M3 {sum(r['tf']==3 for r in rows)}, M5 {sum(r['tf']==5 for r in rows)}")
    pr(f"neighbour definitions evaluated: {sum(r['n_var'] for r in rows)}  -> total statistics {nT + sum(r['n_var'] for r in rows)} (+ halves/BUY/SELL/sets per pattern)")
    pr(f"real |t|>=3: {sum(abs(r['t'])>=3 for r in rows)}, |t|>=2: {sum(abs(r['t'])>=2 for r in rows)}  | sd of real t {np.std([r['t'] for r in rows]):.2f}")
    pr(f"day-swap null ({nP} perms): sd of t {sd_perm:.2f}, share |t|>=3 {rate_perm:.4f} -> expected by chance {rate_perm*nT:.1f} patterns with |t|>=3, "
       f"|t|>=2 {np.mean(np.abs(Tn)>=2)*nT:.1f}; max |t| per perm median {np.median(np.abs(Tn).max(1)):.2f}, 95% {np.percentile(np.abs(Tn).max(1),95):.2f}")
    pr(f"random-direction markets ({len(sfs)}): sd of t {sf_t.std():.2f}, |t|>=3 per market {np.mean(np.sum(np.abs(sf_t)>=3,1)):.1f}, |t|>=2 {np.mean(np.sum(np.abs(sf_t)>=2,1)):.1f}")
    for gk in ("G1", "G2", "G3", "G4", "G5", "G6"):
        pr(f"  pass {gk}: {sum(r[gk] for r in rows)}")
    pr(f"  pass G1-G4: {sum(r['G1'] and r['G2'] and r['G3'] and r['G4'] for r in rows)}, all: {sum(r['passed'] for r in rows)}")
    # ---- lists
    def fmt(r):
        return (f"M{r['tf']} {r['feat']:10s} {r['level'][:32]:32s} share {r['share']:.2f} n {r['n']:6d} days {r['days']:3d} | lift {r['lift']:+.3f}R "
                f"t {r['t']:+.1f} win {r['wlift']*100:+.1f}pt | H1/H2 {r['h1']:+.3f}/{r['h2']:+.3f} ({r['h1_t']:+.1f}/{r['h2_t']:+.1f}) "
                f"BUY/SELL {r['buy']:+.3f}/{r['sell']:+.3f} ({r['buy_t']:+.1f}/{r['sell_t']:+.1f}) sets {r['sets_same']:.2f} "
                f"var t {np.round(r['var_t'],1).tolist()} p_perm {r['p_perm']:.3f} p_fw {r['p_fw']:.3f} | sf {r['sf_lift']:+.3f} (t {r['sf_t_mean']:+.1f}) z {r['z_vs_sf']:+.1f} {r['null2']} | fail {r['failed'] or '-'}")
    pr("\n=== PASSED ALL GATES ==="); [pr(fmt(r)) for r in rows if r["passed"]]
    pr("\n=== |t| >= 2.5 (all, sorted) ==="); [pr(fmt(r)) for r in sorted(rows, key=lambda r: -abs(r["t"])) if abs(r["t"]) >= 2.5]
    pr("\n=== pass G2-G6 but |t| < 3 (hints only) ===")
    [pr(fmt(r)) for r in rows if not r["G1"] and r["G2"] and r["G3"] and r["G4"] and r["G5"] and abs(r["t"]) >= 2]
    pr("\n=== strongest in the random-direction markets (mechanical effects of strategy/definitions) ===")
    for i in np.argsort(-np.abs(sf_t.mean(0)))[:15]:
        r = rows[i]; pr(f"M{r['tf']} {r['feat']:10s} {r['level'][:32]:32s} sf lift {r['sf_lift']:+.3f} (t mean {r['sf_t_mean']:+.1f}) | real {r['lift']:+.3f} (t {r['t']:+.1f})")
    # ---- pairs of passers (same TF, different features)
    T, X = L.load(adx_asof.DBT); npair = 0
    pr("\n=== pairs of passers ===")
    for g in L.TFS:
        ps = [r for r in rows if r["passed"] and r["tf"] == g]
        if len(ps) < 2: pr(f"M{g}: {len(ps)} passer(s) -> no pairs"); continue
        G = L.group_arrays(T, g); masks = {}
        for sp in L.specs(g):
            for ln, pm, vms in L.pattern_masks(T, X, g, sp): masks[(sp["name"], ln)] = (pm, vms)
        for a in range(len(ps)):
            for b in range(a + 1, len(ps)):
                A, B = ps[a], ps[b]
                if A["feat"] == B["feat"]: continue
                npair += 1; pa, va = masks[(A["feat"], A["level"])]; pb, vb = masks[(B["feat"], B["level"])]
                R = L.evaluate(G, pa & pb, [pa & v for v in vb] + [v & pb for v in va])
                ok = all(gates(dict(R, n_var=len(R["var_t"])), 0.0).values())
                better = abs(R["lift"]) - max(abs(A["lift"]), abs(B["lift"])) > R["se"]
                pr(f"M{g} {A['feat']}={A['level']} & {B['feat']}={B['level']}: share {R['share']:.2f} lift {R['lift']:+.3f} t {R['t']:+.1f} "
                   f"(singles {A['lift']:+.3f}/{B['lift']:+.3f}) gates {'ok' if ok else 'fail'} stronger-than-both {better}")
    pr(f"pairs tested: {npair}")
    with open(os.path.join(HERE, "p3_results.csv"), "w", newline="", encoding="utf-8-sig") as f:
        keys = ["tf", "grp", "feat", "level", "desc", "share", "n", "days", "lift", "se", "t", "wlift", "r_mean", "h1", "h1_t", "h2", "h2_t", "buy", "buy_t",
                "sell", "sell_t", "sets_n", "sets_same", "n_var", "var_t", "p_perm", "p_fw","sf_lift", "sf_sd", "sf_t_mean", "z_vs_sf", "null2",
                "G1", "G2", "G3", "G4", "G5", "G6", "passed", "failed"]
        w = csv.writer(f); w.writerow(keys)
        for r in rows: w.writerow([np.round(r[k], 4).tolist() if isinstance(r[k], (list, float, np.floating)) else r[k] for k in keys])
    open(os.path.join(HERE, "p3_summary.txt"), "w", encoding="utf-8").write("\n".join(lines))
    print("\n".join(lines))

if __name__ == "__main__":
    main()
