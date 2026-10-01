r"""Robustness of the step 3-4 findings that passed all gates (zone plan, 2026-10-01), real vs the 3 random-direction markets:
  SE clustered by WEEK instead of day | only events with no overlapping instance of the same type (dup == 0) | drop the 20 most extreme
  days (by real day mean) | sign per calendar quarter | step 4 trades: only the first bar of each event that shows the behaviour
  (one trade per zone entry), one trade at a time (skip while the previous trade of the same cell is open), share of the best 1%
  trades, drop the best 10 / 20 days | M1 trades: model (bars) vs real ticks 2026-01..09 (same rules as po_tickcheck: tickA = bid path,
  tickB = real ask/bid fills).
Output zn\zn_audit_robust.txt"""
import sys, os
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, po_lib as PO, zn_ev as EV, zn_bh as BH, adx_ctx as X, broker as BK
OUT = r"C:\trade datacenter\zn"; MK = ["real", "sf1", "sf2", "sf3"]; txt = []
def say(s=""): print(s, flush=True); txt.append(s)
def clus(y, g):
    ok = np.isfinite(y); y = y[ok]; g = g[ok]
    if len(y) < 30: return np.nan, np.nan
    u, inv = np.unique(g, return_inverse=True); s = np.bincount(inv, y); c = np.bincount(inv); mu = y.mean()
    return mu, np.sqrt(((s - c * mu) ** 2).sum()) / len(y)
def excess(ys, gs):
    """ys/gs: dict market -> values, cluster keys. returns excess, t"""
    mu, se = clus(ys["real"], gs["real"]); n = [clus(ys[m], gs[m]) for m in MK[1:]]
    nm = np.nanmean([a for a, _ in n]); ns = np.sqrt(np.nanmean([b ** 2 for _, b in n]) / 3)
    return mu, mu - nm, (mu - nm) / np.sqrt(se ** 2 + ns ** 2)
M = X.load(None)
def QTR(d):
    dt = np.asarray(d, np.int64).astype("datetime64[D]"); mo = dt.astype("datetime64[M]").astype(np.int64)    # months since 1970-01
    return mo // 3

# ---------------- step 3 ----------------
say("=== step 3: reversal share after entering the zone (k ATR), real vs random ===")
F3 = [(1, "swing_big", "all", 1), (1, "swing_big", "all", 2), (3, "swing_big", "all", 1), (5, "pd_hl", "first", 1), (1, "ema_own_50", "leg12_high", 1)]
for tf, ty, cond, k in F3:
    B = EV.obs_bars(M, tf); ti = EV.TYPES.index(ty); kk = EV.KS.index(k)
    E = {m: dict(np.load(os.path.join(OUT, f"zn_ev_m{tf}_{m}.npz"))) for m in MK}
    e0 = E["real"]; m0 = e0["v0_type"] == ti; ed = np.nanquantile(e0["v0_leg12"][m0], [1 / 3, 2 / 3])
    def rows(m, extra=None, kx=kk):
        e = E[m]; s = e["v0_type"] == ti
        if cond == "first": s &= ~e["v0_prior"]
        if cond == "leg12_high": s &= e["v0_leg12"] >= ed[1]
        if extra is not None: s &= extra(e)
        o = e["v0_oc"][s, kx]; y = np.where(o == 1, 1.0, np.where(o == -1, 0.0, np.nan)); d = B["day"][e["v0_j"][s]]
        return y, d
    res = {}
    for nm, extra, key, kx in (("as published", None, "day", kk), ("week clusters", None, "week", kk), ("no overlapping zone (dup 0)", lambda e: e["v0_dup"] == 0, "day", kk),
                               ("k = 3", None, "day", 2)):
        ys, gs = {}, {}
        for m in MK:
            y, d = rows(m, extra, kx); ys[m] = y; gs[m] = d if key == "day" else d // 7
        res[nm] = excess(ys, gs)
    y, d = rows("real"); u = np.unique(d); dm = np.array([np.nanmean(y[d == x]) for x in u]); drop = u[np.argsort(-np.abs(dm - np.nanmean(y)))[:20]]
    ys, gs = {}, {}
    for m in MK:
        yy, dd = rows(m); k_ = ~np.isin(dd, drop); ys[m] = yy[k_]; gs[m] = dd[k_]
    res["drop 20 most extreme days"] = excess(ys, gs)
    q = {m: QTR(rows(m)[1]) for m in MK}; qs = np.unique(q["real"]); sg = []
    for qq in qs:
        ys = {m: rows(m)[0][q[m] == qq] for m in MK}; gs = {m: rows(m)[1][q[m] == qq] for m in MK}
        sg.append(excess(ys, gs)[1])
    say(f"M{tf} {ty} {cond} k{k}: " + " | ".join(f"{nm}: rev {v[0]:.3f} ex {v[1]:+.3f} t {v[2]:+.1f}" for nm, v in res.items())
        + f" | quarters same sign {sum(np.sign(x) == np.sign(res['as published'][1]) for x in sg)}/{len(sg)} ({' '.join(f'{x:+.3f}' for x in sg)})")

# ---------------- step 4 ----------------
say("\n=== step 4: after the behaviour bar ===")
F4 = [(1, "PASS", "any", "brk", "hit1"), (3, "PASS", "any", "brk", "hit1"), (5, "PASS", "any", "brk", "hit1"), (5, "bb_own", "any", "brk", "hit1"),
      (1, "swing_big", "hold_through", "brk", "SL2_TP1R"), (1, "swing_big", "close_through", "brk", "SL2_TP1R"), (3, "ob_m15", "engulf_rev", "rev", "SL2_TP2R")]
GR = {"PASS": EV.PASS, "REASON": EV.REASON}
cachePO = {}
for tf, g, lab, dirn, meas in F4:
    E = {m: np.load(os.path.join(OUT, f"zn_ev_m{tf}_{m}.npz")) for m in MK}; H = {m: np.load(os.path.join(OUT, f"zn_bh_m{tf}_{m}.npz")) for m in MK}
    tys = [EV.TYPES.index(x) for x in GR.get(g, [g])]
    def sel(m, first=False, dup0=False):
        ev = H[m]["v0_ev"]; ty = E[m]["v0_type"][ev]; s = np.isin(ty, tys) & ((H[m]["v0_bits"] & BH.BIT[lab]) != 0)
        if dup0: s &= E[m]["v0_dup"][ev] == 0
        idx = np.flatnonzero(s)
        if first: _, f = np.unique(ev[idx], return_index=True); idx = idx[np.sort(f)]
        return idx
    Y = {m: H[m][f"v0_{dirn}_{meas}"].astype(float) for m in MK}; D = {m: H[m]["v0_day"] for m in MK}
    res = {}
    for nm, kw, key in (("as published", {}, "day"), ("week clusters", {}, "week"), ("first bar per zone entry", {"first": True}, "day"), ("dup 0", {"dup0": True}, "day")):
        ix = {m: sel(m, **kw) for m in MK}
        res[nm] = excess({m: Y[m][ix[m]] for m in MK}, {m: (D[m][ix[m]] if key == "day" else D[m][ix[m]] // 7) for m in MK}) + (len(ix["real"]),)
    ix = {m: sel(m) for m in MK}; y = Y["real"][ix["real"]]; d = D["real"][ix["real"]]
    q = {m: QTR(D[m][ix[m]]) for m in MK}; sg = []
    for qq in np.unique(q["real"]):
        sg.append(excess({m: Y[m][ix[m]][q[m] == qq] for m in MK}, {m: D[m][ix[m]][q[m] == qq] for m in MK})[1])
    line = f"M{tf} {g} {lab} {dirn} {meas}: " + " | ".join(f"{nm}: n {v[3]} mean {v[0]:+.3f} ex {v[1]:+.3f} t {v[2]:+.1f}" for nm, v in res.items())
    line += f" | quarters same sign {sum(np.sign(x) == np.sign(res['as published'][1]) for x in sg)}/{len(sg)}"
    if meas != "hit1":
        yy = y[np.isfinite(y)]; dd = d[np.isfinite(y)]; tot = yy.sum(); top = np.sort(yy)[::-1][:max(1, len(yy) // 100)].sum()
        u = np.unique(dd); ds_ = np.array([yy[dd == x].sum() for x in u]); o = np.argsort(-ds_)
        line += f" | total {tot:+.1f}R, best 1% trades = {top / tot:.0%} of it" if tot > 0 else f" | total {tot:+.1f}R"
        for kd in (10, 20):
            keep = ~np.isin(dd, u[o[:kd]]); line += f" | drop best {kd} days mean {yy[keep].mean():+.3f}"
        # one trade at a time (first bar per entry, skip while open): exit point from the po first passages
        if tf not in cachePO:
            fz = np.load(os.path.join(PO.OUTD, f"po_m{tf}_real.npz")); cachePO[tf] = {k: fz[k] for k in ("b", "dec_t", "n_pts", "up_t", "dn_t", "atr", "entry", "fin", "up_g", "dn_g")}
        R = cachePO[tf]; rowof = np.full(int(R["b"].max()) + 2, -1); rowof[R["b"]] = np.arange(len(R["b"]))
        i1 = sel("real", first=True); b = H["real"]["v0_b"][i1]; pr = rowof[b]; side = E["real"]["v0_side"][H["real"]["v0_ev"][i1]] * (1 if dirn == "rev" else -1)
        sl = 2.0; rr = 1.0 if meas == "SL2_TP1R" else 2.0; LVi = lambda v: int(np.flatnonzero(np.isclose(PO.LV, v))[0])
        U = np.where(side > 0, R["up_t"][pr, LVi(sl * rr)], R["dn_t"][pr, LVi(sl * rr)]).astype(np.int64)
        Dn = np.where(side > 0, R["dn_t"][pr, LVi(sl)], R["up_t"][pr, LVi(sl)]).astype(np.int64)
        ext = np.where(U < 0, 1 << 40, U); exs = np.where(Dn < 0, 1 << 40, Dn); xi = np.minimum(np.minimum(ext, exs), R["n_pts"][pr] - 1)
        t_in = R["dec_t"][pr]; t_out = t_in + (xi // 4 + 1) * 60; o = np.argsort(t_in); free = 0; take = []
        for q_ in o:
            if t_in[q_] >= free: take.append(q_); free = t_out[q_]
        yv = Y["real"][i1][take]; line += f" | one at a time: n {len(take)} mean {np.nanmean(yv):+.3f} winrate {np.mean(yv > 0):.1%} total {np.nansum(yv):+.1f}R"
        if tf == 1:
            import ticks_lib as TL
            if "TK" not in cachePO:
                TK = TL.load(); cachePO["TK"] = (TK["msc"], TK["bid"] * BK.POINT, TK["ask"] * BK.POINT)
            msc, bid, ask = cachePO["TK"]; T0, T1 = msc[0] // 1000, msc[-1] // 1000 - 86400; mr, ar, br = [], [], []
            t = M["t"]
            for q_ in take:
                p = pr[q_]; dec = int(R["dec_t"][p]);
                if not (T0 <= dec < T1): continue
                a = R["atr"][p]; e = R["entry"][p]; j0 = np.searchsorted(t, dec); je = j0 + R["n_pts"][p] // 4 - 1; tend = int(t[je]) + 60
                i0 = np.searchsorted(msc, dec * 1000); i9 = np.searchsorted(msc, tend * 1000)
                if i9 - i0 < 2 or abs(bid[i0] - e) > 1e-6: continue
                sd = side[q_]; s_abs = sl * a; tp = sl * rr * a
                def walk(path, ent):
                    x = sd * (path - ent); hs = np.flatnonzero(x <= -s_abs); ht = np.flatnonzero(x >= tp)
                    iS = hs[0] if len(hs) else 1 << 40; iT = ht[0] if len(ht) else 1 << 40
                    return path[-1] if iS == iT == 1 << 40 else path[min(iS, iT)]
                bb = bid[i0:i9]; kk_ = ask[i0:i9]
                ar.append(sd * (walk(bb, e) - e) / s_abs - PO.COST / s_abs)
                ent = kk_[0] if sd > 0 else bb[0]; br.append(sd * (walk(bb if sd > 0 else kk_, ent) - ent) / s_abs)
                mr.append(Y["real"][i1][q_])
            if mr: line += f" | 2026 real ticks n {len(mr)}: model {np.mean(mr):+.3f} tickA {np.mean(ar):+.3f} tickB {np.mean(br):+.3f} (mean |model-tickA| {np.mean(np.abs(np.array(mr) - np.array(ar))):.3f})"
    say(line)
open(os.path.join(OUT, "zn_audit_robust.txt"), "w", encoding="utf-8").write("\n".join(txt))
