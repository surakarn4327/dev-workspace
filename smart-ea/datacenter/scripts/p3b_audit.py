r"""Phase 3B-b audit (separate code from p3b_lib wherever it matters) -> p3b\p3b_audit.txt
(A) exam isolation: nothing of the grid / trades / ctx / event bars used reaches 2026-06-01
(B) independent recomputation of a sample of patterns (every group, TF, alternative, BE-far, the passers and the largest |t|): events from the
    raw flags with separate code, first occurrence by per-trade minimum of bar_n, baseline by a Python dict over the strata rebuilt from raw
    columns, cluster SE with an explicit per-day loop
(C) gates recomputed from the raw result files and compared with p3b_results.csv
(D) reproducibility: the engine run again = real_res.pkl; permutation seeds redone = stored draws; sign-flip draws redone with a per-draw loop
(E) sensitivity: a known effect planted into the deltas of one pattern per TF is found with the expected size; minimal detectable effect
(F) 3B-a reading: decision tick = first M1 tick after the TF bar closed (dec_t = first M1 bar >= bar end); BE exists iff open_r > 0;
    hold never exits at a TP; cut = closing at the decision tick price (r_cut - realized from open_r and cost)
(G) null calibration (sd of t, share |t| >= 3) per group"""
import os, sys, pickle, time, csv
import numpy as np
import broker as BK
import p3lib as L, p3b_lib as B, p3b_perm as PP, p3b_report as RP

BASE = os.path.join(os.path.dirname(BK.DB), "p3b"); OUT = []; BAD = []
MK = os.environ.get("P3B_MARKET", "real")                  # test runs only
SUF = "" if MK == "real" else "_" + MK
def pr(*a): s = " ".join(str(x) for x in a); OUT.append(s); print(s, flush=True)
def bad(msg): BAD.append(msg); pr("  BAD:", msg)

SANDBOX_END = L.SANDBOX_END

def indep_stat(v, days):
    """cluster-robust mean / t with an explicit per-day loop (ratio estimator)"""
    ok = np.isfinite(v); v = v[ok]; days = days[ok]
    if not len(v): return np.nan, 0.0, 0
    s = {}; c = {}
    for x, d in zip(v.tolist(), days.tolist()): s[d] = s.get(d, 0.0) + x; c[d] = c.get(d, 0) + 1
    N = len(v); mu = sum(s.values()) / N; D = len(s)
    ss = sum((s[d] - mu * c[d]) ** 2 for d in s)
    se = (ss * D / max(D - 1, 1)) ** 0.5 / N
    return mu, (mu / se if se > 0 else 0.0), N

def indep_pattern(M, p, far=False, plant=None):
    """recompute one pattern with separate code. Returns (mean, t, n)."""
    tf = p["tf"]; G = M["G"][tf]; R, ev = G["R"], G["ev"]; T = M["T"]
    ti = R["ti"]; b = R["b"]; d = R["dir"].astype(int); op = R["open_r"]; bar_n = R["bar_n"]
    fl = ev["fl_base"][b].astype(np.int64)
    def bit(name): return (fl >> ["big", "pin", "vspike", "inside", "pivot", "regime", "boxbreak", "pdh", "pdl", "dayhigh", "daylow", "asiahigh", "asialow"].index(name)) & 1
    mkt_any = (fl & 8191) != 0
    checkonly = (bar_n % 5 == 0) & ~mkt_any
    delta = {"cut": R["d_cut"], "be": R["d_be"], "hold": R["d_hold"]}[p["alt"]].astype(float).copy()
    if far: delta[~(op * T["risk"][ti] >= 0.31)] = np.nan
    # stratum rebuilt from raw columns
    fam = T["fam"][ti]; half = (T["day"][ti] >= L.HALF_DAY).astype(int)
    ob = np.where(op <= -0.5, 0, np.where(op <= 0, 1, np.where(op <= 0.5, 2, np.where(op <= 1, 3, 4))))
    hb = np.where(bar_n <= 10, 0, np.where(bar_n <= 30, 1, 2))
    strat = [(int(a), int(bb), int(c), int(e_), int(f), int(g)) for a, bb, c, e_, f, g in
             zip(fam[checkonly], (d[checkonly] > 0).astype(int), half[checkonly], ob[checkonly], np.minimum(R["ntp"][checkonly], 2), hb[checkonly])]
    # event rows (separate code)
    grp, feat, lv = p["grp"], p["feat"], p["level"]
    if grp == "E":
        cond = "profit" if p["alt"] == "be" else lv
        cm = np.ones(len(ti), bool) if cond == "all" else (op > 0 if cond == "profit" else op <= 0)
        base_ev = feat.rsplit("_", 1)[0] if feat not in ("vspike", "inside", "regime_to_with", "regime_to_against", "regime_to_side") else feat
        rel = {"with": 1, "against": -1}.get(feat.rsplit("_", 1)[-1], 0)
        if feat.startswith("regime_to_"): rel = {"regime_to_with": 1, "regime_to_against": -1, "regime_to_side": 0}[feat]
        if base_ev in ("prevday", "dayext", "asia"):
            hi, lo = {"prevday": ("pdh", "pdl"), "dayext": ("dayhigh", "daylow"), "asia": ("asiahigh", "asialow")}[base_ev]
            m = ((bit(hi) == 1) & (d * rel > 0)) | ((bit(lo) == 1) & (d * rel < 0))
        elif feat in ("vspike", "inside"):
            m = bit(feat) == 1
        else:
            nm, key = {"big": ("big", "big"), "pin": ("pin", "pin"), "pivot": ("pivot", "piv"), "box": ("boxbreak", "box")}.get(base_ev, ("regime", "reg"))
            dv = ev[f"{key}_base"][b].astype(int)
            m = (bit(nm) == 1) & ((dv * d == 1) if rel == 1 else (dv * d == -1) if rel == -1 else (dv == 0))
        m &= cm
    else:
        rows = checkonly & (np.isfinite(delta) if p["alt"] == "be" else True)
        ref_rows = checkonly & (half == 0)
        if grp == "S":
            if feat == "S_open": m = rows & (ob == lv)
            elif feat == "S_ntp": m = rows & (np.minimum(R["ntp"], 2) == lv)
            else:
                x = {"S_give": R["mfe_r"] - op, "S_held": bar_n.astype(float), "S_mtc": R["mtc"], "S_dtp": R["dist_tp"]}[feat]
                lo, hi = L.PCT[lv], L.PCT[lv + 1]; ref = x[ref_rows]
                a = np.percentile(ref, lo) if lo > 0 else -np.inf; z = np.percentile(ref, hi) if hi < 100 else np.inf
                m = rows & (x >= a) & (x < z)
        else:
            sp = [s for s in L.specs(tf) if s["name"] == feat][0]
            ci = np.where(R["cix"] >= 0, R["cix"], 0); X = {k: v[ci] for k, v in M["C"].items() if k != "t"}
            if sp["kind"] == "cat": lab = np.asarray(sp["fn"](X, d, sp["variants"][0])); m = rows & (lab == lv)
            else:
                x = np.asarray(sp["fn"](X, d, 3), float); lo, hi = L.PCT[lv], L.PCT[lv + 1]; ref = x[ref_rows]; ref = ref[np.isfinite(ref)]
                a = np.percentile(ref, lo) if lo > 0 else -np.inf; z = np.percentile(ref, hi) if hi < 100 else np.inf
                m = rows & np.isfinite(x) & (x >= a) & (x < z)
    if far: m &= op * T["risk"][ti] >= 0.31
    # first occurrence = the row with the smallest bar_n of every trade (np.minimum.reduceat on the trade blocks)
    idx = np.flatnonzero(m)
    if not len(idx): return np.nan, 0.0, 0
    tt = ti[idx]; starts = np.r_[0, np.flatnonzero(np.diff(tt)) + 1]
    mb = np.minimum.reduceat(bar_n[idx], starts); tr = tt[starts]
    key_all = ti.astype(np.int64) * 1_000_000 + bar_n; tgt = tr.astype(np.int64) * 1_000_000 + mb
    first = np.searchsorted(key_all, tgt); assert np.array_equal(key_all[first], tgt)
    x = delta[first].copy()
    if plant is not None: x = x + plant
    if grp != "S":
        acc = {}
        for s, t_, v in zip(strat, ti[checkonly].tolist(), delta[checkonly].tolist()):
            if v != v: continue
            acc.setdefault(s, {}).setdefault(t_, []).append(v)
        base = {s: (np.mean([np.mean(v) for v in dd.values()]) if len(dd) >= 30 else np.nan) for s, dd in acc.items()}
        fs = [(int(fam[i]), int(d[i] > 0), int(half[i]), int(ob[i]), int(min(R["ntp"][i], 2)), int(hb[i])) for i in first.tolist()]
        x = x - np.array([base.get(s, np.nan) for s in fs])
    return indep_stat(x, T["day"][ti[first]])

def main():
    t0 = time.time()
    M = B.load_market(os.path.join(BASE, MK))
    Rr = pickle.load(open(os.path.join(BASE, f"{MK}_res.pkl"), "rb")); res = Rr["res"]
    P = pickle.load(open(os.path.join(BASE, f"{MK}_perm.pkl"), "rb")); Tn = P["t_null"]; npr = P["n_primary"]
    rows = pickle.load(open(os.path.join(BASE, f"p3b_rows{SUF}.pkl"), "rb"))
    # ---- (A)
    pr("(A) exam isolation")
    for tf in B.TFS:
        R, ev = M["G"][tf]["R"], M["G"][tf]["ev"]
        mx = int(ev["dec_t"][R["b"]].max()); mo = int(ev["t_open"].max())
        pr(f"  M{tf}: last decision {time.strftime('%Y-%m-%d %H:%M', time.gmtime(mx))}, last TF bar loaded {time.strftime('%Y-%m-%d %H:%M', time.gmtime(mo))}")
        if mx >= SANDBOX_END or mo >= SANDBOX_END: bad(f"M{tf} reaches the exam")
    if int(M["T"]["day"].max()) >= L.SANDBOX_END // 86400 or int(M["T"]["exit_t"].max()) + 60 > SANDBOX_END: bad("trade in the exam")
    if int(M["C"]["t"].max()) >= SANDBOX_END: bad("ctx time in the exam")
    pr(f"  trades {len(M['T']['uid'])}, last trading day {time.strftime('%Y-%m-%d', time.gmtime(int(M['T']['day'].max()) * 86400))}")
    # ---- (F) reading of 3B-a
    pr("(F) 3B-a reading")
    for tf in B.TFS:
        R, ev = M["G"][tf]["R"], M["G"][tf]["ev"]
        if not np.array_equal(np.isfinite(R["d_be"]), R["open_r"] > 0): bad(f"M{tf} BE exists iff open_r > 0")
        # cut = realized + rem * open_r - cost term: r_cut - r_plan must equal  (realized + rem*open) - (r_plan + costR) ... check via grid file
    g = np.load(os.path.join(BASE, MK, "grid_5.npz")); T = M["T"]; ti = np.searchsorted(T["uid"], g["uid"])
    import sqlite3
    h = sqlite3.connect(os.path.join(os.path.dirname(BK.DB), "adx_hold.sqlite"))
    hr = dict(h.execute("SELECT uid, spread_entry FROM utrades").fetchall()); sp = np.array([hr[u] for u in g["uid"].tolist()])
    rem = np.select([g["ntp"] == 0, g["ntp"] == 1], [1.0, 2 / 3], 1 / 3)
    real_r = h.execute("SELECT uid, bar_n, realized_r FROM dec WHERE uid IN (SELECT uid FROM utrades WHERE tf = 5) AND (bar_n % 5) = 0 LIMIT 200000").fetchall()
    key = {(u, bn): rz for u, bn, rz in real_r}
    sel = np.array([(u, bn) in key for u, bn in zip(g["uid"].tolist(), g["bar_n"].tolist())])
    realized = np.array([key[(u, bn)] for u, bn, s in zip(g["uid"].tolist(), g["bar_n"].tolist(), sel.tolist()) if s])
    cutrec = realized + rem[sel] * g["open_r"][sel] - (0.31 - sp[sel]) / T["risk"][ti][sel]
    dmax = np.max(np.abs(cutrec - g["r_cut"][sel])); pr(f"  M5 cut = realized + rem x open_r - cost: max |diff| {dmax:.2e} over {sel.sum()} rows")
    if dmax > 1e-9: bad("cut reconstruction")
    ev5 = M["G"][5]["ev"]; import adx_ctx as X
    Mb = X.load(SANDBOX_END); B5 = X.resample(Mb, 5); j = np.searchsorted(Mb["t"], B5["end"], "left")
    exp = np.where(j < len(Mb["t"]), Mb["t"][np.minimum(j, len(Mb["t"]) - 1)], -1)
    if not np.array_equal(exp, ev5["dec_t"]): bad("decision tick != first M1 bar at/after the TF bar end")
    else: pr(f"  decision tick = first M1 bar >= bar end for all {len(exp)} M5 bars; ticks before the bar end: {int(np.sum((exp >= 0) & (exp < B5['end'])))}")
    hold_tp = h.execute("SELECT COUNT(*) FROM dec WHERE hold_reason = 2").fetchone()[0]; pr(f"  hold exits at a TP: {hold_tp}")
    if hold_tp: bad("hold exited at a TP")
    # ---- (B) independent recomputation
    pr("(B) independent recomputation")
    pick = []
    want = [(1, "cut", "E", "big_against", "loss"), (3, "hold", "E", "prevday_with", "all"), (5, "be", "E", "pivot_against", "profit"),
            (1, "cut", "E", "regime_to_side", "profit"), (5, "cut", "E", "dayext_against", "all"), (3, "cut", "S", "S_give", 4),
            (5, "hold", "S", "S_open", 2), (1, "be", "S", "S_mtc", 0), (3, "cut", "C", "A_cyc", 1), (5, "hold", "C", "C_daypos", 0),
            (1, "be", "C", "B_phase", 2), (5, "cut", "S", "S_ntp", 1)]
    for i, r in enumerate(res):
        if (r["tf"], r["alt"], r["grp"], r["feat"], r["level"]) in want: pick.append((i, False))
    top = sorted(range(len(rows)), key=lambda i: -abs(rows[i]["t"]) if np.isfinite(rows[i]["t"]) else 0)[:6]
    pick += [(i, False) for i in top] + [(i, False) for i, r in enumerate(rows) if r["passed"]]
    pick += [(i, True) for i, r in enumerate(res) if r["alt"] == "be" and ((r["tf"], r["alt"], r["grp"], r["feat"], r["level"]) in want or rows[i]["passed"])]
    seen = set()
    for i, far in pick:
        if (i, far) in seen: continue
        seen.add((i, far)); r = res[i]
        mu, t, n = indep_pattern(M, r, far=far)
        a, bt, bn = (r["far_mean"], r["far_t"], r["far_n"]) if far else (r["mean"], r["t"], r["n"])
        ok = n == bn and (np.isnan(mu) and np.isnan(a) or abs(mu - a) < 1e-9) and abs(t - bt) < 1e-6
        pr(f"  M{r['tf']} {r['alt']:4s}{'-far' if far else ''} {r['grp']} {r['feat']} {r['level']}: engine n {bn} t {bt:+.3f} | independent n {n} t {t:+.3f} {'ok' if ok else 'DIFF'}")
        if not ok: bad(f"independent recomputation {r['tf']} {r['alt']} {r['feat']} {r['level']} far={far}")
    # ---- (C) gates
    pr("(C) gates recomputed")
    with open(os.path.join(BASE, f"p3b_results{SUF}.csv"), encoding="utf-8-sig") as f: csvr = list(csv.DictReader(f))
    nP = Tn.shape[0]; nbad = 0
    TP = pickle.load(open(os.path.join(BASE, f"{MK}_perm_top.pkl"), "rb")) if os.path.exists(os.path.join(BASE, f"{MK}_perm_top.pkl")) else None
    def draws(i):
        if TP is not None and i in TP["s_cols"]: return TP["t_s2000"][:, TP["s_cols"].index(i)]
        if TP is not None and i in TP["cols"]: return np.concatenate([Tn[:, i], TP["t_top"][:, TP["cols"].index(i)]])
        return Tn[:, i]
    if TP is not None:
        pr(f"  top-up: {len(TP['cols'])} candidate columns x {TP['t_top'].shape[0]} extra draws (seeds {TP['seeds'][0]}-{TP['seeds'][-1]}), "
           f"S sign flip {TP['t_s2000'].shape}")
        # the sign-flip draws 5000-5499 of the 2,000-draw set must be the ones stored with the 500-draw file
        d = max(np.nanmax(np.abs(TP["t_s2000"][:nP, k] - Tn[:, c])) for k, c in enumerate(TP["s_cols"]))
        pr(f"  S sign flip: first {nP} of 2,000 draws = stored draws, max |diff| {d:.1e}"); d > 1e-9 and bad("sign flip draws differ")
    for i, r in enumerate(res):
        t = r["t"]; c = draws(i); c = c[~np.isnan(c)]
        if r["n"] > 0 and r["days"] >= 30 and len(c):
            up = (1 + sum(1 for x in c.tolist() if x >= t)) / (len(c) + 1); lo = (1 + sum(1 for x in c.tolist() if x <= t)) / (len(c) + 1)
            pp = min(1.0, 2 * min(up, lo))
        else: pp = 1.0
        s = np.sign(r["mean"])
        g1 = abs(t) >= 3 and r["days"] >= 100
        g2 = np.sign(r["h1"]) == s and np.sign(r["h2"]) == s and min(abs(r["h1_t"]), abs(r["h2_t"])) >= 1.5
        g3 = np.sign(r["buy"]) == s and np.sign(r["sell"]) == s and min(abs(r["buy_t"]), abs(r["sell_t"])) >= 1.5
        fm = [m for m, k in zip(r["fam_mean"], r["fam_n"]) if k >= 100 and np.isfinite(m)]
        g4 = len(fm) >= 2 and sum(np.sign(m) == s for m in fm) * 6 >= 5 * len(fm)
        g5 = len(r["var_t"]) > 0 and all(np.sign(m) == s and abs(tt) >= 1.5 for m, tt in zip(r["var_mean"], r["var_t"]))
        g6 = pp <= 0.01
        c = csvr[i]; mine = [g1, g2, g3, g4, g5, g6]; theirs = [c[k] == "True" for k in ("G1", "G2", "G3", "G4", "G5", "G6")]
        if mine != theirs or abs(float(c["p_perm"]) - pp) > 1e-5: nbad += 1
        if r["alt"] == "be":                                       # BE-far gates (rows >= $0.31 from the entry)
            fc = draws(npr + [j for j, x in enumerate(res) if x["alt"] == "be"].index(i)); fc = fc[~np.isnan(fc)]; ft = r["far_t"]; fs = np.sign(r["far_mean"])
            if r["far_n"] > 0 and r["far_days"] >= 30 and len(fc):
                fp = min(1.0, 2 * min((1 + np.sum(fc >= ft)) / (len(fc) + 1), (1 + np.sum(fc <= ft)) / (len(fc) + 1)))
            else: fp = 1.0
            ffm = [m for m, k in zip(r["far_fam_mean"], r["far_fam_n"]) if k >= 100 and np.isfinite(m)]
            fg = [abs(ft) >= 3 and r["far_days"] >= 100,
                  np.sign(r["far_h1"]) == fs and np.sign(r["far_h2"]) == fs and min(abs(r["far_h1_t"]), abs(r["far_h2_t"])) >= 1.5,
                  np.sign(r["far_buy"]) == fs and np.sign(r["far_sell"]) == fs and min(abs(r["far_buy_t"]), abs(r["far_sell_t"])) >= 1.5,
                  len(ffm) >= 2 and sum(np.sign(m) == fs for m in ffm) * 6 >= 5 * len(ffm),
                  len(r["far_var_t"]) > 0 and all(np.sign(m) == fs and abs(tt) >= 1.5 for m, tt in zip(r["far_var_mean"], r["far_var_t"])), fp <= 0.01]
            if "".join(str(k + 1) for k, v in enumerate(fg) if v) != c["far_gates"]: nbad += 1
    pr(f"  {len(res)} patterns: gate / p mismatches {nbad}")
    if nbad: bad("gates")
    # ---- (D) reproducibility
    pr("(D) reproducibility")
    E = B.Engine(M); res2 = E.run(far_be=True)
    diff = max(abs(a["t"] - b["t"]) for a, b in zip(res, res2) if np.isfinite(a["t"]))
    pr(f"  engine rerun: max |t diff| {diff:.2e}"); diff > 1e-12 and bad("engine rerun")
    Ms = B.load_market(os.path.join(BASE, MK), slim=True); Es = B.Engine(Ms, neighbours=False)
    for sd in sorted({1000, 1001, 1000 + Tn.shape[0] // 2, 999 + Tn.shape[0]}):
        bd, cd = B.day_perm_donors(Ms, sd); tt = Es.run(bd, cd, only_t=True, far_be=True, groups=("E", "C"))
        m = ~np.isnan(tt); dd = np.max(np.abs(tt[m] - Tn[sd - 1000][m]))
        pr(f"  day-swap seed {sd}: max |t diff| {dd:.2e}"); dd > 1e-9 and bad(f"perm seed {sd}")
    if TP is not None:
        sub = set(c for c in TP["cols"] if c < npr)
        for sd in (TP["seeds"][0], TP["seeds"][-1]):
            bd, cd = B.day_perm_donors(Ms, sd); tt = Es.run(bd, cd, only_t=True, far_be=True, groups=("E", "C"), subset=sub)
            dd = np.max(np.abs(tt[TP["cols"]] - TP["t_top"][sd - TP["seeds"][0]]))
            pr(f"  top-up seed {sd}: max |t diff| {dd:.2e}"); dd > 1e-9 and bad(f"top-up seed {sd}")
    order, npr2, nfar = PP.layout(); be_list = [r for r in res if r["alt"] == "be"]
    for sd in (5000, 4999 + Tn.shape[0]):
        f = np.random.default_rng(sd).choice([-1.0, 1.0], len(Rr["days"])); worst = 0
        for (kind, p), (tix, v) in zip(order, Rr["s_vals"]):
            col = p if kind == "p" else npr + p
            _, t, _ = indep_stat(v * f[Rr["tday"][tix]], Rr["tday"][tix]); worst = max(worst, abs(t - Tn[sd - 5000, col]) if np.isfinite(t) else 0)
        pr(f"  sign-flip draw {sd}: max |t diff| {worst:.2e}"); worst > 1e-9 and bad(f"sign flip {sd}")
    # ---- (E) sensitivity: planted effect
    pr("(E) sensitivity")
    for tf, feat in ((1, "big_against"), (3, "pivot_against"), (5, "prevday_with")):
        p = [r for r in res if r["tf"] == tf and r["alt"] == "cut" and r["grp"] == "E" and r["feat"] == feat and r["level"] == "all"][0]
        base_mu, base_t, n = indep_pattern(M, p)
        for k in (0.05, 0.1, 0.2):
            mu, t, _ = indep_pattern(M, p, plant=k)
            pr(f"  M{tf} {feat}: planted +{k:.2f}R -> mean {base_mu:+.3f} -> {mu:+.3f} (found {mu - base_mu:+.3f}), t {base_t:+.1f} -> {t:+.1f} (n {n})")
            if abs((mu - base_mu) - k) > 1e-9: bad("planted effect not recovered")
    for grp in ("E", "S", "C"):
        pr("  3 x SE (R/trade) " + grp + ": " + ", ".join(f"M{tf}/{a} {3 * np.median([r['se'] for r in res if r['tf'] == tf and r['alt'] == a and r['grp'] == grp and r['n'] >= 1000] or [np.nan]):.3f}"
                                                         for tf in B.TFS for a in B.ALTS))
    # ---- (G) null calibration
    pr("(G) null calibration")
    for grp in ("E", "S", "C"):
        m = np.array([r["grp"] == grp and r["n"] > 0 for r in res])
        x = Tn[:, :npr][:, m]; pr(f"  {grp}: null sd of t {np.nanstd(x):.2f}, share |t|>=3 {np.nanmean(np.abs(x) >= 3):.4f}, |t|>=2 {np.nanmean(np.abs(x) >= 2):.4f}")
    pr(f"\n{'ALL OK' if not BAD else 'BAD: ' + '; '.join(BAD)} ({time.time() - t0:.0f}s)")
    open(os.path.join(BASE, f"p3b_audit{SUF}.txt"), "w", encoding="utf-8").write("\n".join(OUT))

if __name__ == "__main__":
    main()
