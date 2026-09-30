r"""Phase 3B-c audit, round 2 -> p3c\p3c_audit2.txt  (round 1 = p3c_audit.py: 48 cells recomputed, gates, reproducibility)
(A) identities that must hold in EVERY cell of the table (not a sample):
    - per level, the trade-weighted sum of the set interactions is 0: sum_s N_s I_s = 0  (I_s = mean_s - mean_all)
    - per level and dimension, the group I = trade-weighted mean of its sets' I; group N = sum of its sets' N
    - the same for the half / BUY / SELL splits
(B) calibration per null: calibrated z of the real cells by null type (day swap vs time shift), and by cell size
(C) robustness of the hints written in CLAUDE.md (weekly clusters, trim top/bottom 1 %, drop 10 worst + 10 best days, quarters)
(D) CLAUDE.md numbers = result files"""
import os, time, pickle, csv
import numpy as np
import p3lib as L, p3c_lib as C, adx_asof
from p3c_perm import BASE

OUT = []; BAD = []
def pr(*a): s = " ".join(str(x) for x in a); OUT.append(s); print(s, flush=True)
def check(ok, msg):
    if not ok: BAD.append(msg); pr("  FAIL:", msg)

def main():
    t0 = time.time()
    R = pickle.load(open(os.path.join(BASE, "real_res.pkl"), "rb")); lay = R["layout"]; nc = len(lay)
    Pm = pickle.load(open(os.path.join(BASE, "real_perm.pkl"), "rb")); Gt = pickle.load(open(os.path.join(BASE, "p3c_gates.pkl"), "rb"))
    T, X = L.load(adx_asof.DBT); P = C.load_params(adx_asof.DBT)
    kind = np.array([k[2] for k in lay]); key = [k[3] for k in lay]
    # block structure: for every (feature, level): 432 set cells, then groups
    starts = [i for i in range(nc) if kind[i] == "set" and (i == 0 or kind[i - 1] != "set")]
    pr("(A) identities over every cell")
    W = dict(sumI=0.0, grpI=0.0, grpN=0.0); nb = 0; sub_w = 0.0
    for s0 in starts:
        sets = np.arange(s0, s0 + 432); gidx = np.arange(s0 + 432, s0 + 432 + 17)
        assert all(kind[i] == "set" for i in sets) and all(kind[i] != "set" for i in gidx)
        N = np.nan_to_num(R["n"][sets]); I = R["I"][sets]; ok = N > 0
        if ok.sum() == 0: continue
        nb += 1; Ntot = N.sum()
        W["sumI"] = max(W["sumI"], abs(np.sum(N[ok] * I[ok])) / Ntot)
        sid = np.array([key[i] for i in sets])
        for g in gidx:
            mem = np.array([P[s][kind[g]] == key[g] for s in sid]); m = mem & ok
            if R["n"][g] > 0:
                W["grpN"] = max(W["grpN"], abs(N[mem].sum() - R["n"][g]))
                W["grpI"] = max(W["grpI"], abs(np.sum(N[m] * I[m]) / N[m].sum() - R["I"][g]))
    pr(f"  blocks {nb}: max |sum_s N_s I_s| / N {W['sumI']:.2e} | group N vs sum of sets max |diff| {W['grpN']:.1f} | group I vs weighted mean of sets max |diff| {W['grpI']:.2e}")
    check(W["sumI"] < 1e-12 and W["grpN"] < 0.5 and W["grpI"] < 1e-12, "table identities")
    # split identity: recompute split counts per set x level for 20 random features with the engine labels and check sum N I = 0
    E = C.Engine(T, X, P); rng = np.random.default_rng(3); worst = 0.0
    for j in rng.choice(len(E.F), 20, replace=False):
        lab = E.labels(j, T["ci"]); nl = len(E.lev[j].names)
        for nm, m in (("h1", T["half"] == 0), ("h2", T["half"] == 1), ("buy", T["dir"] > 0), ("sell", T["dir"] < 0)):
            r = C.interaction(lab, E.si, E.ns, T["e"], E.di, E.nd, sub=m, nl=nl)
            N = r[3]; I = np.nan_to_num(r[0]); tot = N.sum(0)
            with np.errstate(invalid="ignore"): v = np.abs((N * I).sum(0)) / np.maximum(tot, 1)
            worst = max(worst, np.nanmax(v))
    pr(f"  halves / BUY / SELL (20 features): max |sum_s N_s I_s| / N {worst:.2e}"); check(worst < 1e-12, "split identities")
    # ---------------- (B)
    pr("(B) calibration by null type and cell size")
    zr = Pm["z_real"]; el = np.isfinite(zr) & (R["days"] >= 100)
    tf = np.array([k[0] in C.TIME_FEATS for k in lay])
    for nm, m in (("day swap (null 1)", el & ~tf), ("time shift (null 1b)", el & tf)):
        z = zr[m]; pr(f"  {nm}: cells {m.sum()}, real z mean {z.mean():+.3f} sd {z.std():.3f}, |z|>=3 {np.mean(np.abs(z) >= 3):.4f}, |z|>=4 {np.mean(np.abs(z) >= 4):.5f}")
        check(abs(z.mean()) < 0.1 and 0.8 < z.std() < 1.3, f"calibration {nm}")
    for lo, hi in ((100, 200), (200, 400), (400, 551)):
        m = el & (R["days"] >= lo) & (R["days"] < hi); z = zr[m]
        pr(f"  days {lo}-{hi - 1}: cells {m.sum()}, real z sd {z.std():.3f}, |z|>=3 {np.mean(np.abs(z) >= 3):.4f}")
    for g in (1, 3, 5):
        m = el & (kind == "set") & np.array([k[2] == "set" and P[k[3]]["tf"] == g for k in lay]); z = zr[m]
        pr(f"  M{g} set cells: {m.sum()}, real z sd {z.std():.3f}, |z|>=3 {np.mean(np.abs(z) >= 3):.4f}")
    # random-direction markets through the same calibration (their t vs the REAL null mean / sd): excess over the null?
    for mk in ("sf1", "sf3", "sf5"):
        s = pickle.load(open(os.path.join(BASE, f"{mk}_res.pkl"), "rb"))
        with np.errstate(invalid="ignore", divide="ignore"): zs = (s["t"] - Pm["m1"]) / Pm["sd1"]
        m = el & np.isfinite(zs); pr(f"  {mk} through the real calibration: z sd {zs[m].std():.3f}, |z|>=3 {np.mean(np.abs(zs[m]) >= 3):.4f} (real {np.mean(np.abs(zr[el]) >= 3):.4f})")
    # time-of-day cells: raw |t| >= 3 share in the real market vs the random-direction markets (independent of the null-1b calibration)
    tfm = el & tf
    shr = {mk: np.mean(np.abs(pickle.load(open(os.path.join(BASE, f"{mk}_res.pkl"), "rb"))["t"][tfm]) >= 3) for mk in ("sf1", "sf2", "sf3", "sf4", "sf5")}
    pr(f"  time-of-day cells raw |t|>=3: real {np.mean(np.abs(R['t'][tfm]) >= 3):.4f} vs random-direction markets " + " / ".join(f"{v:.4f}" for v in shr.values()))
    # ---------------- (C)
    pr("(C) robustness of the CLAUDE.md hints")
    pos = {k: i for i, k in enumerate(lay)}; feats = [f["name"] for f in E.F]
    hints = [("m1k3_retr_atr", "Q1 (0-20%)", "sl_atr", 12.0), ("m1k2_retr_atr", "Q1 (0-20%)", "sl_atr", 12.0), ("m1k3_rng_pos~rel", "Q1 (0-20%)", "tf", 1)]
    # late-day hints: the strongest late-day set cells that passed every gate
    late = [i for i in np.flatnonzero(Gt["passed"]) if lay[i][0] in ("t_min_open", "d_today_bars", "t_th_hour", "t_min_cutoff")]
    hints += [lay[i] for i in sorted(late, key=lambda i: -abs(Pm["z_real"][i]))[:3]]
    wk = (T["day"] + 3) // 7
    # outliers: winsorize r_std at the 1st / 99th percentile WITHIN each set, then the same residual as p3lib.load (set x dir x half).
    # (A pooled trim over all sets is wrong: sets with fat tails lose more trades, which shifts I by itself.)
    rw = T["r"].copy()
    for s_ in np.unique(T["set_id"]):
        m_ = T["set_id"] == s_; lo_, hi_ = np.percentile(rw[m_], [1, 99]); rw[m_] = np.clip(rw[m_], lo_, hi_)
    g_ = (T["set_id"] * 2 + (T["dir"] > 0)) * 2 + T["half"]; _, gi_ = np.unique(g_, return_inverse=True)
    ew = rw - (np.bincount(gi_, rw) / np.bincount(gi_))[gi_]
    for h in hints:
        f, lv, kd, kv = h; i = pos[h]; j = feats.index(f); lab = E.labels(j, T["ci"]); li = E.lev[j].names.index(lv)
        inkey = (T["set_id"] == kv) if kd == "set" else np.isin(T["set_id"], [s for s in P if P[s][kd] == kv])
        inl = lab == li; e = T["e"]
        def stat(mask_all, clus, ea=None):
            a = mask_all & inkey; b = mask_all
            ea = e if ea is None else ea
            mk, ma = ea[a].mean(), ea[b].mean(); Nk, Na = a.sum(), b.sum()
            u, inv = np.unique(clus[b], return_inverse=True)
            sa = np.bincount(inv, (ea * a)[b], len(u)); ca = np.bincount(inv, a[b].astype(float), len(u))
            sb = np.bincount(inv, ea[b], len(u)); cb = np.bincount(inv, None, len(u))
            z = (sa - mk * ca) / Nk - (sb - ma * cb) / Na; se = np.sqrt((z ** 2).sum() * len(u) / (len(u) - 1))
            return mk - ma, (mk - ma) / se
        I0, t0_ = stat(inl, T["day"]); Iw, tw = stat(inl, wk); It, tt = stat(inl, T["day"], ew)
        # drop the 10 worst and 10 best days of the key's contribution
        d_in = T["day"][inl & inkey]; ud = np.unique(d_in); cont = np.array([e[inl & inkey & (T["day"] == d)].sum() for d in ud])
        drop = set(ud[np.argsort(cont)[:10]]) | set(ud[np.argsort(cont)[-10:]]); keepd = ~np.isin(T["day"], list(drop))
        Id, td = stat(inl & keepd, T["day"])
        q = (T["day"] - T["day"].min()) // 91; qs = []
        for qq in np.unique(q):
            mm = inl & (q == qq)
            if (mm & inkey).sum() >= 30: qs.append(np.sign(stat(mm, T["day"])[0]))
        same = int(np.sum(np.array(qs) == np.sign(I0)))
        pr(f"  {kd}={kv} x {f} {lv}: stored I {R['I'][i]:+.3f} t {R['t'][i]:+.1f} | recomputed {I0:+.3f} t {t0_:+.1f} | weekly t {tw:+.1f} | winsorized 1% within set {It:+.3f} t {tt:+.1f}"
           f" | drop 20 days {Id:+.3f} t {td:+.1f} | quarters same sign {same}/{len(qs)} | p_fw {Gt['pfw'][i]:.3f}")
        check(abs(I0 - R["I"][i]) < 1e-9, f"hint {h} recomputed")
    # ---------------- (D)
    pr("(D) CLAUDE.md numbers")
    md = open(r"C:\Users\surak\Documents\GitHub\dev-workspace\smart-ea\CLAUDE.md", encoding="utf-8").read()
    s = open(os.path.join(BASE, "p3c_summary.txt"), encoding="utf-8").read()
    fin = np.isfinite(R["t"]); setl = kind == "set"
    facts = {"**530,269 ช่อง**": nc == 530269, "(มีค่าพอทดสอบ 498,060)": int(fin.sum()) == 498060,
             "ผ่าน G1-G5 106 / ครบทุกด่าน 102 ช่อง": int((Gt["G1"] & Gt["G2"] & Gt["G3"] & Gt["G4"] & Gt["G5"] & fin & setl).sum()) == 106 and int((Gt["passed"] & setl).sum()) == 102,
             "ผ่านครบ 3 ช่อง": int((Gt["passed"] & ~setl).sum()) == 3,
             "ค่ากลาง 5.18, 95% ที่ 5.82": f"{np.median(Pm['maxz']):.2f}" == "5.18" and f"{np.percentile(Pm['maxz'], 95):.2f}" == "5.82",
             "p รวมทั้งการค้น ≥ 0.97 ทุกช่อง": np.nanmin(Gt["pfw"][Gt["passed"]]) >= 0.97,
             "410 รายการไม้ไม่ซ้ำจาก 432 ชุด": "410 distinct" in s}
    for k, v in facts.items():
        pr(f"  '{k}' in CLAUDE.md: {k in md}, equals the files: {bool(v)}"); check(k in md and bool(v), f"CLAUDE.md {k}")
    pr(("ALL OK" if not BAD else f"{len(BAD)} FAIL: {BAD}") + f" ({time.time() - t0:.0f}s)")
    open(os.path.join(BASE, "p3c_audit2.txt"), "w", encoding="utf-8").write("\n".join(OUT))

if __name__ == "__main__":
    main()
