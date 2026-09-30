r"""Phase 3B-b audit part 2 (user 2026-09-30: "check this phase before moving on, or it falls like dominoes") -> p3b\p3b_audit2.txt
Closes what p3b_audit.py did not cover:
(A) the full grid, not only the rows shared with adx_hold.sqlite: for EVERY unique trade the list of grid rows = every TF bar between entry and
    the plan exit of adx_lib.walk_exit (the MT5-verified walker) with a decision tick; and a sample of rows that adx_hold does NOT store
    (no event, not a checkpoint) recomputed with adx_lib.walk_exit from the decision bar (cut / BE / hold)
(B) neighbour event definitions (used by gate G5) recomputed with separate code: big 1.5/2.5 ATR, pin wick 50/70 %, volume 2.5/4 x (Python ints
    on sampled bars), zigzag 2/4 pivots vs the catalog zigzag (cat_struct.zigzag, float: ties may differ), box 15/30 bars (brute force on
    sampled bars), new day extreme after 30/120 min (plain loop over every bar)
(C) the day swap: every day gets its events / context from exactly one other day of the same half, bars and ctx use the same day map,
    minute offset small; identity map = real
(D) the random-direction markets are synthetic (other trades than real, other statistics) and built from the sandbox only
(E) robustness of the patterns that passed every gate: finer state strata for the baseline (the method's known weak point), weekly clusters,
    trimming the largest 1 % values, dropping the 10 worst / best days, sign per quarter, per family
(F) the numbers written into smart-ea\CLAUDE.md = the result files"""
import os, sys, pickle, glob, time, sqlite3
import numpy as np
import broker as BK, adx_lib as A, hold_lib as H, p3lib as L, p3b_lib as B

BASE = os.path.join(os.path.dirname(BK.DB), "p3b"); OUT = []; BAD = []
def pr(*a): s = " ".join(str(x) for x in a); OUT.append(s); print(s, flush=True)
def bad(msg): BAD.append(msg); pr("  BAD:", msg)
COST = 0.31; FAR = 1e9

def main():
    t0 = time.time()
    M = B.load_market(os.path.join(BASE, "real")); T = M["T"]
    h = sqlite3.connect(os.path.join(os.path.dirname(BK.DB), "adx_hold.sqlite"))
    UT = {r[0]: r for r in h.execute("SELECT uid, tf, exit_mode, entry_t, exit_t, day, dir, entry_px, sl_px, tp1_px, tp2_px, tp3_px, risk_px, "
                                     "spread_entry, exit_reason, r_std FROM utrades")}
    mk = H.walk_market(); tu = mk.tu; W = mk.M
    pr(f"loaded {len(UT)} trades {time.time() - t0:.0f}s")
    # ======================= (A) grid completeness + non-stored rows via walk_exit
    pr("(A) full grid vs adx_lib.walk_exit")
    rng = np.random.default_rng(11); nA_bad = nA_trades = nA_rows = 0; nC = 0; nC_bad = 0; worst = 0.0; cov = dict(be=0, t3=0, tp_hit=0, sell=0)
    for tf in B.TFS:
        R, ev = M["G"][tf]["R"], M["G"][tf]["ev"]; ti = R["ti"]; b = R["b"]; tO = ev["t_open"]; dT = ev["dec_t"]
        st = np.r_[0, np.flatnonzero(np.diff(ti)) + 1]; en = np.r_[st[1:], len(ti)]; rows_of = dict(zip(ti[st].tolist(), zip(st.tolist(), en.tolist())))
        stored = (ev["fl_base"][b] != 0) | R["check"]
        for k in np.flatnonzero(T["tf"] == tf).tolist():
            U = UT[int(T["uid"][k])]; d_ = U[6]; e = int(np.searchsorted(tu, U[3]))
            Wp = A.walk_exit(mk, e, d_, U[8], U[9], U[10], U[11], U[2] == "L", U[7])
            b0 = int(np.searchsorted(tO, U[3])); b1 = int(np.searchsorted(tO, U[4], "right")); bb = np.arange(b0, b1)
            dt = dT[bb]; ok = dt > 0; bb, dt = bb[ok], dt[ok]; di = np.searchsorted(tu, dt)
            opn = (di < Wp["exit_i"]) | ((di == Wp["exit_i"]) & (not Wp["at_open"])); exp = bb[opn]
            s, t_ = rows_of.get(k, (0, 0)); got = b[s:t_]
            nA_trades += 1; nA_rows += len(exp)
            if not np.array_equal(exp, got) or not np.array_equal(R["bar_n"][s:t_], got - b0 + 1): nA_bad += 1
        # sampled non-stored rows: alternatives recomputed from the decision bar with walk_exit
        ns = np.flatnonzero(~stored); pick = ns[rng.random(len(ns)) < 12000 / max(len(ns), 1)]
        for r in pick.tolist():
            U = UT[int(T["uid"][ti[r]])]; d_ = U[6]; ent = U[7]; risk = U[12]; lad = U[2] == "L"; cR = (COST - U[13]) / risk
            di = int(np.searchsorted(tu, int(dT[b[r]]))); nt = int(R["ntp"][r]); rem = 1 - nt / 3.0
            e = int(np.searchsorted(tu, U[3])); Wp = A.walk_exit(mk, e, d_, U[8], U[9], U[10], U[11], lad, ent)
            real = sum(f * (p - ent) * d_ for f, p in Wp["fills"][:nt])                       # TP1/TP2 fills done before the decision
            px = W["o"][di] + (W["sp"][di] if d_ == -1 else 0.0)
            tp1, tp2, tp3 = U[9], U[10], U[11]; far = d_ * FAR
            def alt(slv, keep):
                if not keep: Wx = A.walk_exit(mk, di, d_, slv, far, far, far, False, ent); return (real + rem * (Wx["fills"][-1][1] - ent) * d_) / risk - cR
                if not lad or nt == 2: Wx = A.walk_exit(mk, di, d_, slv, tp3, tp3, tp3, False, ent); return (real + rem * (Wx["fills"][-1][1] - ent) * d_) / risk - cR
                if nt == 1:
                    Wx = A.walk_exit(mk, di, d_, slv, tp2, far, tp3, True, ent); pnl = real; left = rem
                    if Wx["hit1"]: pnl += (Wx["fills"][0][1] - ent) * d_ / 3.0; left -= 1.0 / 3.0
                    return (pnl + left * (Wx["fills"][-1][1] - ent) * d_) / risk - cR
                Wx = A.walk_exit(mk, di, d_, slv, tp1, tp2, tp3, True, ent); return sum(f * (p - ent) * d_ for f, p in Wx["fills"]) / risk - cR
            exp = dict(open_r=(px - ent) * d_ / risk, r_cut=(real + rem * (px - ent) * d_) / risk - cR, r_hold=alt(U[8], False))
            exp["r_be"] = alt(ent, True) if exp["open_r"] > 0 else np.nan
            got = dict(open_r=R["open_r"][r], r_cut=R["d_cut"][r] + U[15], r_hold=R["d_hold"][r] + U[15], r_be=R["d_be"][r] + U[15])
            dmax = max(abs(exp[k_] - got[k_]) if np.isfinite(exp[k_]) else (0.0 if not np.isfinite(got[k_]) else 9.0) for k_ in exp)
            nC += 1; worst = max(worst, dmax); nC_bad += dmax > 1e-9
            cov["be"] += np.isfinite(exp["r_be"]); cov["t3"] += not lad; cov["tp_hit"] += nt > 0; cov["sell"] += d_ < 0
        pr(f"  M{tf}: done {time.time() - t0:.0f}s")
    pr(f"  trades whose grid rows != every TF bar before the walk_exit plan exit: {nA_bad} of {nA_trades} ({nA_rows} rows)")
    pr(f"  non-stored rows recomputed with walk_exit: {nC}, differing {nC_bad}, worst {worst:.1e}; coverage {cov}")
    if nA_bad: bad("grid rows incomplete / extra")
    if nC_bad: bad("non-stored rows differ from walk_exit")
    # ======================= (B) neighbour event definitions with separate code
    pr("(B) neighbour event definitions")
    import adx_ctx as X, cat_struct as CS
    Mb = H.load_ctx_bars(); SLv = H.sessions_levels(Mb)
    for tf in B.TFS:
        ev = M["G"][tf]["ev"]; Bb = X.resample(Mb, tf); n = len(Bb["c"])
        hi, lo, op, cl, S, tv, sid = (Bb[k].tolist() for k in ("hi", "li", "oi", "ci", "s20p", "tv", "sid"))
        smp = rng.choice(np.arange(60, n), 6000, replace=False).tolist(); nb = 0
        Wv = max(20, X.DAYBARS // tf); tvi = [int(x) for x in tv]
        for j in smp:
            rg = hi[j] - lo[j]; body = abs(cl[j] - op[j]); up = hi[j] - max(op[j], cl[j]); dn = min(op[j], cl[j]) - lo[j]; s20 = S[j]
            for vn, k in (("big15", 1.5), ("big25", 2.5)):
                exp_ = s20 > 0 and rg * 20 * 10 >= int(k * 10) * s20
                nb += exp_ != bool(ev["fl_" + vn][j] & B.BITS["big"])
            for vn, w in (("pin50", 50), ("pin70", 70)):
                exp_ = s20 > 0 and 20 * rg >= s20 and 10 * body <= 3 * rg and (100 * up >= w * rg or 100 * dn >= w * rg)
                nb += exp_ != bool(ev["fl_" + vn][j] & B.BITS["pin"])
            base = sum(tvi[j - Wv:j]) if j >= Wv else -1
            for vn, k in (("vsp25", 25), ("vsp40", 40)):
                exp_ = base >= 0 and 10 * Wv * tvi[j] >= k * base
                nb += exp_ != bool(ev["fl_" + vn][j] & B.BITS["vspike"])
        pr(f"  M{tf} big/pin/volume variants on 6,000 sampled bars x 6 definitions: mismatches {nb}"); nb and bad(f"M{tf} footprint variants")
        # zigzag 2/4: pivots vs the catalog zigzag (float ATR -> exact ties may differ)
        atr = np.where(Bb["s20p"] >= 0, Bb["s20p"] / 20.0, np.nan)
        for vn, k in (("zz2", 2), ("zz4", 4)):
            idx, pp, kind, conf = CS.zigzag(Bb["hi"].astype(float), Bb["li"].astype(float), Bb["ci"].astype(float), atr, k)
            mine = set(np.flatnonzero(ev["fl_" + vn] & B.BITS["pivot"]).tolist()); cat = set(np.asarray(conf).tolist())
            diff = len(mine ^ cat); share = diff / max(len(cat), 1)
            pr(f"  M{tf} {vn}: pivots {len(mine)} vs catalog zigzag {len(cat)}, symmetric difference {diff} ({share:.3%})")
            if share > 0.002: bad(f"M{tf} {vn} pivots differ from the catalog zigzag")
        # box 15/30: brute force on sampled bars
        csi = Bb["csi"]; nbx = 0; smp2 = rng.choice(np.arange(60, n - 1), 3000, replace=False).tolist()
        for vn, bn in (("box15", 15), ("box30", 30)):
            for j in smp2:
                u = j - 1; s_now = int(csi[u + 1] - csi[u - 19])
                run = 0; mx = -10 ** 18; mn = 10 ** 18
                while u - run >= 0 and sid[u - run] == sid[u] and run < X.LB_MIN // tf:
                    mx = max(mx, hi[u - run]); mn = min(mn, lo[u - run])
                    if 20 * (mx - mn) > 4 * s_now: break
                    run += 1
                if run >= bn and sid[j] == sid[u]:
                    mx = max(hi[u - q] for q in range(run)); mn = min(lo[u - q] for q in range(run))
                    exp_ = 1 if cl[j] > mx else (-1 if cl[j] < mn else 0)
                else: exp_ = 0
                got_ = int(ev[f"box_{vn}"][j]) if ev["fl_" + vn][j] & B.BITS["boxbreak"] else 0
                nbx += exp_ != got_
        pr(f"  M{tf} box 15/30 on 3,000 sampled bars: mismatches {nbx}"); nbx and bad(f"M{tf} box variants")
        # new day extreme after 30 / 120 min: plain loop over every bar
        for vn, sm in (("st30", 30), ("st120", 120)):
            tO = Bb["t_open"].tolist(); nd = 0; hv = lv = None
            for j in range(n):
                if j == 0 or sid[j] != sid[j - 1]: hv, ht, lv, lt = hi[j], tO[j], lo[j], tO[j]; eh = el = False
                else:
                    eh = hi[j] > hv and tO[j] - ht >= sm * 60; el = lo[j] < lv and tO[j] - lt >= sm * 60
                    if hi[j] > hv: hv, ht = hi[j], tO[j]
                    if lo[j] < lv: lv, lt = lo[j], tO[j]
                f = int(ev["fl_" + vn][j])
                nd += (eh != bool(f & B.BITS["dayhigh"])) + (el != bool(f & B.BITS["daylow"]))
            pr(f"  M{tf} {vn} over all {n} bars: mismatches {nd}"); nd and bad(f"M{tf} {vn}")
    # ======================= (C) day swap
    pr("(C) day swap")
    for sd in (1000, 1777, 2999):
        bd, cd = B.day_perm_donors(M, sd); issues = 0
        for tf in B.TFS:
            ev = M["G"][tf]["ev"]; day = ev["day"].astype(np.int64); used = np.isin(day, M["days"])
            dd = day[bd[tf]]; pairs = {}
            for a_, b_ in zip(day[used].tolist(), dd[used].tolist()): pairs.setdefault(a_, set()).add(b_)
            multi = sum(len(v) != 1 for v in pairs.values()); cross = sum((a_ >= B.HALF_DAY) != (next(iter(v)) >= B.HALF_DAY) for a_, v in pairs.items())
            inj = len(set(next(iter(v)) for v in pairs.values())) != len(pairs)
            t = ev["t_open"].astype(np.int64); first = np.r_[True, day[1:] != day[:-1]]; dop = t[first][np.cumsum(first) - 1]
            mi = (t - dop) // 60; gap = np.abs(mi[bd[tf]] - mi)[used]
            pr(f"  seed {sd} M{tf}: days {len(pairs)}, days with >1 donor day {multi}, crossing halves {cross}, map not one-to-one {inj}, "
               f"minute offset median {np.median(gap):.0f} p99 {np.percentile(gap, 99):.0f}, days mapped to themselves {sum(a_ in v for a_, v in pairs.items())}")
            issues += multi + cross + inj
        cday = np.zeros(len(M["C"]["t"]), np.int64)
        for tf in B.TFS:
            R, ev = M["G"][tf]["R"], M["G"][tf]["ev"]; m = R["cix"] >= 0; cday[R["cix"][m]] = ev["day"][R["b"][m]]
        # ctx donors must come from the same donor day as the bars of that day
        ev1 = M["G"][1]["ev"]; day1 = ev1["day"].astype(np.int64); used = np.isin(day1, M["days"])
        dm = dict(zip(day1[used].tolist(), day1[bd[1]][used].tolist()))
        cmis = int(np.sum([dm.get(a_, a_) != b_ for a_, b_ in zip(cday.tolist(), cday[cd].tolist())]))
        pr(f"  seed {sd}: ctx times whose donor day != the bar donor day: {cmis}"); issues += cmis
        issues and bad(f"day swap seed {sd}")
    # ======================= (D) random-direction markets
    pr("(D) random-direction markets")
    Rr = pickle.load(open(os.path.join(BASE, "real_res.pkl"), "rb"))
    tr = np.array([r["t"] for r in Rr["res"]])
    for f in sorted(glob.glob(os.path.join(BASE, "sf*_res.pkl"))):
        S = pickle.load(open(f, "rb")); ts = np.array([r["t"] for r in S["res"]]); m = np.isfinite(ts) & np.isfinite(tr)
        cor = np.corrcoef(ts[m], tr[m])[0, 1]
        pr(f"  {os.path.basename(f)}: unique trades {S['n_trades']} (real {Rr['n_trades']}), last trading day {time.strftime('%Y-%m-%d', time.gmtime(int(S['days'].max()) * 86400))}, "
           f"corr of pattern t with real {cor:+.2f}, identical t {int(np.sum(np.abs(ts[m] - tr[m]) < 1e-12))}")
        if S["n_trades"] == Rr["n_trades"] or int(S["days"].max()) >= L.SANDBOX_END // 86400: bad(f"{f} not a distinct sandbox market")
    for s in range(1, 6):
        lg = os.path.join(os.path.dirname(BK.DB), "p3_null", f"sf{s}", "bars.npz")
        z = np.load(lg); zr = np.load(BK.BARS); tt = BK.server_to_utc(z["t"].astype(np.int64))
        common = np.intersect1d(z["t"], zr["t"]); iz = np.searchsorted(z["t"], common); ir = np.searchsorted(zr["t"], common)
        same_dir = np.mean(np.sign(z["c"][iz] - z["o"][iz]) == np.sign(zr["c"][ir] - zr["o"][ir]))
        pr(f"  sf{s} bars: last bar {time.strftime('%Y-%m-%d %H:%M', time.gmtime(int(tt.max())))}, bar direction equal to real {same_dir:.2f}")
        if tt.max() >= L.SANDBOX_END: bad(f"sf{s} bars reach the exam")
    # ======================= (E) robustness of the passers
    pr("(E) robustness of the patterns that passed every gate")
    rows = pickle.load(open(os.path.join(BASE, "p3b_rows.pkl"), "rb")); E = B.Engine(M, neighbours=False)
    for i, rw in enumerate(rows):
        if not rw["passed"]: continue
        p = dict(tf=rw["tf"], alt=rw["alt"], grp=rw["grp"], feat=rw["feat"], level=(int(rw["level"]) if rw["grp"] != "E" else rw["level"]))
        tf = rw["tf"]; R, ev = M["G"][tf]["R"], M["G"][tf]["ev"]; b = R["b"]; E._bits = {}
        fl_of = lambda vn: ev["fl_" + vn][b]
        co = np.flatnonzero(R["check"] & ((fl_of("base") & B.MKT_MASK) == 0))
        lab = lambda f_, v: E.tab[(tf, f_, v)][R["cix"][co], (R["dir"][co] < 0).astype(int)]
        fr, _, _ = E._rows(p, R, ev, b, fl_of, co, lab, R["half"][co] == 0)
        delta = R["d_" + rw["alt"]]; ti = R["ti"]
        if rw["grp"] == "S": x = delta[fr]; base_txt = "raw delta (S)"
        else:
            base = B.baseline(R, delta, co); x = (delta - base[R["stratum"]])[fr]
            # finer strata: open R in 0.25 R steps, bars held 6 bins
            ob2 = np.searchsorted(np.arange(-1.0, 2.01, 0.25), R["open_r"], side="left")
            hb2 = np.searchsorted(np.array([5, 10, 20, 30, 60]), R["bar_n"], side="left")
            fam = T["fam"][ti]; s2 = ((((fam * 2 + (R["dir"] > 0)) * 2 + R["half"]) * 14 + ob2) * 3 + np.minimum(R["ntp"], 2)) * 6 + hb2
            ok = np.isfinite(delta[co]); rr = co[ok]; nt = int(ti.max()) + 1
            key = s2[rr].astype(np.int64) * nt + ti[rr]; uk, inv = np.unique(key, return_inverse=True)
            tm = np.bincount(inv, delta[rr]) / np.bincount(inv); ks = uk // nt; nS = int(s2.max()) + 1
            cnt = np.bincount(ks, minlength=nS); sm = np.bincount(ks, tm, minlength=nS)
            with np.errstate(invalid="ignore", divide="ignore"): b2 = sm / cnt
            b2[cnt < B.MIN_BASE] = np.nan
            x2 = (delta - b2[s2])[fr]; s_f = B.stats(x2, ti[fr], M, False)
            base_txt = f"finer strata {s_f['mean']:+.3f} t {s_f['t']:+.1f} (n {s_f['n']}) vs registered {rw['mean']:+.3f} t {rw['t']:+.1f}"
        tt_ = ti[fr]; ok = np.isfinite(x); x, tt_ = x[ok], tt_[ok]; day = T["day"][tt_]
        wk = (day + 3) // 7; uw, wi = np.unique(wk, return_inverse=True); mw, _, tw, _ = L.cstat(x, np.ones(len(x), bool), wi, len(uw))
        cut = np.percentile(np.abs(x), 99); kt = np.abs(x) <= cut; st_trim = B.stats(x[kt], tt_[kt], M, False)
        ud, di = np.unique(day, return_inverse=True); dsum = np.bincount(di, x); order = np.argsort(dsum)
        keep = ~np.isin(di, np.r_[order[:10], order[-10:]]); st_days = B.stats(x[keep], tt_[keep], M, False)
        q = (np.array([(np.datetime64(int(d_), "D").astype("datetime64[M]").astype(int)) for d_ in day]) // 3)
        qs = [np.sign(x[q == v].mean()) == np.sign(rw["mean"]) for v in np.unique(q)]
        pr(f"  M{tf} {rw['alt']} {rw['grp']} {rw['feat']} {rw['level']} [{rw.get('null2', '')}]: {base_txt} | weekly clusters t {tw:+.1f} | "
           f"trim top 1% t {st_trim['t']:+.1f} ({st_trim['mean']:+.3f}) | drop 10 worst+best days t {st_days['t']:+.1f} | quarters same sign {sum(qs)}/{len(qs)}")
    # ======================= (F) numbers in CLAUDE.md
    pr("(F) CLAUDE.md numbers")
    md = open(r"C:\Users\surak\Documents\GitHub\dev-workspace\smart-ea\CLAUDE.md", encoding="utf-8").read()
    gs = [sum(r[g] for r in rows) for g in ("G1", "G2", "G3", "G4", "G5", "G6")]
    claims = {f"ผ่าน G1 {gs[0]} / G2 {gs[1]} / G3 {gs[2]} / G4 {gs[3]} / G5 {gs[4]} / G6 {gs[5]}": True, f"ผ่านครบ {sum(r['passed'] for r in rows)} ตัว": True}
    m3 = [r for r in rows if r["tf"] == 3 and r["alt"] == "cut" and r["feat"] == "dayext_against" and r["level"] == "all"][0]
    m5 = [r for r in rows if r["tf"] == 5 and r["alt"] == "cut" and r["feat"] == "S_open" and r["level"] == "3"][0]
    claims[f"+{m3['mean']:.3f}R/ไม้ (t +{m3['t']:.1f}"] = True; claims[f"−{abs(m5['mean']):.3f}R (t −{abs(m5['t']):.1f}"] = True
    for c in claims:
        ok = c in md; pr(f"  '{c}' in CLAUDE.md: {ok}"); ok or bad(f"CLAUDE.md number: {c}")
    pr(f"\n{'ALL OK' if not BAD else 'BAD: ' + '; '.join(BAD)} ({time.time() - t0:.0f}s)")
    open(os.path.join(BASE, "p3b_audit2.txt"), "w", encoding="utf-8").write("\n".join(OUT))

if __name__ == "__main__":
    main()
