r"""Audit of step 2, part 2 (every zone type not covered by zn_check.py), real market, 300 random $20 reversals, plain loops:
pd_c pd_o pw_hl pm_hl piv vp_pd sess_hl orng adr vwap_b1 vwap_b2 ema_* bb_* swing_flip swing_unbroken_any eq_pool fib_r fib_x tl
fvg_m15 ds_m5 ds_m15 ob_m5 ob_m15 rn50 rn100 (+ any extra types present) ; plus properties of zn_lib.zigzag_usd for every X."""
import sys, datetime
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, po_lib as PO, zn_lib as ZL, adx_ctx as X, broker as BK
M = PO.load_market("real"); t = M["t"]; n = len(t); days = M["day"]; ud, ds0 = np.unique(days, return_index=True); de0 = np.r_[ds0[1:], n]
bad = 0
# zigzag properties on the 4-point path (O, L, H, C bull / O, H, L, C bear), independent path build
bull = M["c"] >= M["o"]; PATH = np.empty(4 * n); PATH[0::4] = M["o"]; PATH[1::4] = np.where(bull, M["l"], M["h"])
PATH[2::4] = np.where(bull, M["h"], M["l"]); PATH[3::4] = M["c"]
for x in (10, 20, 50, 100):
    ip, p, k, cp = ZL.zigzag_usd(M, x, points=True); e = 0; bi, _, _, cb = ZL.zigzag_usd(M, x)
    e += int(np.sum(k[1:] == k[:-1])) + int(np.sum(bi != ip // 4)) + int(np.sum(cb != cp // 4))
    e += int(np.sum(np.abs(PATH[ip] - p) > 1e-6))                                             # pivot price = path price
    for q in range(len(p) - 1):
        a, b = ip[q], ip[q + 1]; seg = PATH[a:b + 1]
        if abs(p[q + 1] - p[q]) < x - 1e-6: e += 1                                          # every leg >= X
        if k[q] > 0 and (seg.max() > p[q] + 1e-6 or seg.min() < p[q + 1] - 1e-6): e += 1    # pivots are the extremes of the leg
        if k[q] < 0 and (seg.min() < p[q] - 1e-6 or seg.max() > p[q + 1] + 1e-6): e += 1
        c = cp[q]; r = (p[q] - PATH[a:c + 1]) if k[q] > 0 else (PATH[a:c + 1] - p[q])       # confirmation = first point with reversal >= X
        if not (r[-1] >= x - 1e-6 and np.all(r[:-1] < x - 1e-6)): e += 1
        if not (a < c <= b + 0 or c <= b): e += 1
    print(f"zigzag ${x}: pivots {len(p)} rule violations {e}"); bad += e
Z = ZL.Zones(M); idx, p, k, conf = ZL.zigzag_usd(M, 20); i0 = np.searchsorted(t, 1715558400)
m = idx >= i0; idx, p, k = idx[m], p[m], k[m]
rng = np.random.default_rng(11); pick = np.sort(rng.choice(len(idx), 300, replace=False))
D = Z.distances(idx[pick], p[pick], k[pick]); Q = Z.quality(idx[pick], D)
def vprof(bars):
    """POC, VAH, VAL written independently (dict of bin sums)"""
    bins = {}
    for j in bars:
        lo, hi = int(np.floor(M["l"][j] / 0.5)), int(np.floor(M["h"][j] / 0.5)); w = M["tv"][j] / (hi - lo + 1)
        for b in range(lo, hi + 1): bins[b] = bins.get(b, 0) + w
    ks = sorted(bins); full = list(range(ks[0], ks[-1] + 1)); vals = np.array([bins.get(b, 0.0) for b in full])
    pi_ = int(np.argmax(vals)); a_, b_ = pi_, pi_; acc = vals[pi_]
    while acc < 0.7 * vals.sum():
        up = vals[b_ + 1] if b_ + 1 < len(vals) else -1; dn = vals[a_ - 1] if a_ > 0 else -1
        if up >= dn: b_ += 1; acc += up
        else: a_ -= 1; acc += dn
    return (full[pi_] + 0.5) * 0.5, (full[b_] + 1) * 0.5, full[a_] * 0.5
et_min = ((t - np.where(BK.us_dst(t), 4, 5) * 3600) // 60) % 1440
def near(P, lv):
    lv = [v for v in lv if v is not None and np.isfinite(v)]; return min(abs(v - P) for v in lv) if lv else np.nan
def tfbars(tf):
    B = X.resample(M, tf); return B
BB = {tf: tfbars(tf) for tf in (1, 3, 5, 15, 60)}
def closed_idx(B, tf, T, d):
    j = np.searchsorted(B["t_open"], T - 60, "right") - 1
    while j >= 0 and not ((B["t_open"][j] // (tf * 60) + 1) * tf * 60 <= T or B["day"][j] < d): j -= 1
    return j
def ema(c, pp):
    a = 2 / (pp + 1); e = [c[0]]
    for v in c[1:]: e.append(e[-1] + a * (v - e[-1]))
    e = np.array(e); e[:pp] = np.nan; return e
EM = {(tf, pp): ema(BB[tf]["c"], pp) for tf in (1, 3, 5, 15, 60) for pp in (20, 50, 200)}
PIV = {s: ZL.zigzag_usd(M, s) for s in ZL.SW_SCALES}
def brk_close(c_, lvl, kd, i):
    return np.any((M["c"][c_ + 1:i] - lvl) * kd > 0)
def zones_tf(tf):
    """independent FVG / user's demand-supply chain / order block list: (lo, hi, dir, first M1 index usable, dead rule)"""
    B = BB[tf]; fv, dz, ob = [], [], []; last = 0; exp = -1
    for c in range(2, len(B["c"])):
        if not (B["sid"][c] == B["sid"][c - 1] == B["sid"][c - 2]): continue
        if B["l"][c] > B["h"][c - 2]: s = 1
        elif B["h"][c] < B["l"][c - 2]: s = -1
        else: continue
        a = c - 2; st = np.searchsorted(t, B["t_last"][c], "right")
        fv.append((B["h"][a], B["l"][c], s, st) if s > 0 else (B["h"][c], B["l"][a], s, st))
        if s != last or a > exp: mk = True
        else: mk = a == exp
        if mk: dz.append((B["l"][a], B["h"][a], s, st)); exp = c
        last = s
        for kk in range(a, max(a - 6, -1), -1):
            if B["sid"][kk] != B["sid"][a]: break
            if (B["c"][kk] - B["o"][kk]) * s < 0: ob.append((B["l"][kk], B["h"][kk], s, st)); break
    return dict(fvg=fv, ds=dz, ob=ob)
ZT = {tf: zones_tf(tf) for tf in (1, 3, 5, 15)}
ZST = {tf: {nm: np.array([z[3] for z in ZT[tf][nm]]) for nm in ZT[tf]} for tf in ZT}      # start index of each zone (ascending)
# independent ATR of each TF per M1 bar (own true range, mean of the 20 TF bars before the containing bar)
def atr_bar(tf):
    # integer price points (exact), because a zigzag chain is sensitive to the last digit of its threshold (bugs.md 2026-09-30)
    B = BB[tf]; H_, L_, C_ = (np.rint(B[x] / BK.POINT).astype(np.int64) for x in ("h", "l", "c")); pc = np.r_[C_[0], C_[:-1]]
    tr = np.maximum(H_, pc) - np.minimum(L_, pc); a = np.full(len(tr), np.nan)
    for b in range(20, len(tr)): a[b] = int(tr[b - 20:b].sum()) * BK.POINT / 20
    return a[np.searchsorted(B["t_open"], t, "right") - 1]
ATRB = {tf: atr_bar(tf) for tf in ZL.ATR_SW}
SWA = {(tf, k): ZL.zigzag_path(M, k * ATRB[tf]) for tf, ks in ZL.ATR_SW.items() for k in ks}
for tf in ZL.ATR_SW:
    dA = np.abs(ATRB[tf] - Z.atr_tf[tf]); e_ = int(np.sum(~((np.isnan(ATRB[tf]) & np.isnan(Z.atr_tf[tf])) | (dA == 0))))
    print(f"ATR of M{tf} per M1 bar vs zn_lib: differences {e_}"); bad += e_
# zigzag with a varying threshold: rule check on the 4-point path (threshold of the bar that holds the point)
# rule: retracement = DEEPEST point since the pivot; the pivot is confirmed at the first point where that depth >= the threshold of that
# point; the next pivot is the extreme of the leg (so it may lie before the confirmation point)
for (tf, kz) in ((1, 3), (3, 2), (5, 5)):
    th = np.repeat(kz * ATRB[tf], 4); ip, p_, k_, cp = ZL.zigzag_path(M, kz * ATRB[tf], points=True); e = int(np.sum(k_[1:] == k_[:-1]))
    e += int(np.sum(np.abs(PATH[ip] - p_) > 1e-6))
    # definition (causal, a confirmed pivot is never removed): pivot q = the extreme of the path from the previous pivot to q's
    # confirmation; confirmed at the first point, from the previous confirmation on, where the deepest retracement since q >= the
    # threshold of that point. (A later move beyond q under a grown threshold does not remove q.)
    for q in range(1, len(p_) - 1):
        a, c, a0_, c0 = ip[q], cp[q], ip[q - 1], cp[q - 1]; seg = PATH[a0_ + 1:c + 1]
        if not (a0_ < a <= c and abs((seg.max() if k_[q] > 0 else seg.min()) - p_[q]) < 1e-6): e += 1
        r = (p_[q] - PATH[a:c + 1]) if k_[q] > 0 else (PATH[a:c + 1] - p_[q]); depth = np.maximum.accumulate(r)
        thr = np.round(th[a:c + 1] / BK.POINT) * BK.POINT; okb = np.isfinite(thr)
        pre = np.arange(a, c + 1) < c; act = np.arange(a, c + 1) >= c0                     # points before confirmation while the leg is active
        if not (depth[-1] >= thr[-1] - 1e-6 and np.all(~(pre & act & okb) | (depth < thr - 1e-6))): e += 1
    print(f"zigzag {kz} x ATR(M{tf}): pivots {len(p_)} rule violations {e}"); bad += e
# with a constant threshold zigzag_path must give zigzag_usd's pivots (after the first one)
for x in (10, 20):
    A1 = ZL.zigzag_path(M, np.full(n, float(x))); B1 = ZL.zigzag_usd(M, x)
    e = sum(int(np.sum(a_[1:] != b_[1:])) if len(a_) == len(b_) else 10 ** 6 for a_, b_ in zip(A1, B1))
    print(f"zigzag_path(constant ${x}) vs zigzag_usd: differences {e}"); bad += e
wk = (ud + 3) // 7; mo = np.array([(datetime.date(1970, 1, 1) + datetime.timedelta(days=int(x))).strftime("%Y%m") for x in ud])
nb = 0; cnt = {}
for q, (i, P, kd) in enumerate(zip(idx[pick], p[pick], k[pick])):
    di = np.searchsorted(ud, days[i]); a0 = ds0[max(0, di - ZL.MAXAGE)]; W = {}
    s0, e0 = ds0[di - 1], de0[di - 1]; H, L, C, O = M["h"][s0:e0].max(), M["l"][s0:e0].min(), M["c"][e0 - 1], M["o"][s0]
    W["pd_c"] = near(P, [C]); W["pd_o"] = near(P, [O])
    for nm, key in (("pw_hl", wk), ("pm_hl", mo)):
        prev = [u for u in np.unique(key) if u < key[di]]
        if prev:
            sel = np.isin(key, [prev[-1]]); bars = np.concatenate([np.arange(ds0[j], de0[j]) for j in np.flatnonzero(sel)])
            W[nm] = near(P, [M["h"][bars].max(), M["l"][bars].min()])
        else: W[nm] = np.nan
    pp_ = (H + L + C) / 3; W["piv"] = near(P, [pp_, 2 * pp_ - L, 2 * pp_ - H, pp_ + (H - L), pp_ - (H - L)])
    W["vp_pd"] = near(P, list(vprof(np.arange(s0, e0))))
    # sessions of today
    bars = np.arange(ds0[di], de0[di]); mm = et_min[bars]; lv = []; olv = []
    for a1, a2, isasia in ((17 * 60, 3 * 60, True), (3 * 60, 8 * 60, False), (8 * 60, 13 * 60, False)):
        ins = bars[((mm >= a1) | (mm < a2)) if isasia else ((mm >= a1) & (mm < a2))]
        if a1 != 8 * 60 and len(ins) and ins.max() < i: lv += [M["h"][ins].max(), M["l"][ins].min()]
        orr = bars[(mm >= a1) & (mm < a1 + 30)]
        if len(orr) and orr.max() < i: olv += [M["h"][orr].max(), M["l"][orr].min()]
    W["sess_hl"] = near(P, lv); W["orng"] = near(P, olv)
    if di >= 20:
        adr = np.mean([M["h"][ds0[j]:de0[j]].max() - M["l"][ds0[j]:de0[j]].min() for j in range(di - 20, di)])
        s_ = ds0[di]; lo_, hi_ = (M["l"][s_:i].min(), M["h"][s_:i].max()) if i > s_ else (np.nan, np.nan)
        W["adr"] = near(P, [M["o"][s_] + adr, M["o"][s_] - adr, lo_ + adr, hi_ - adr])
    s_ = ds0[di]; tp = (M["h"][s_:i] + M["l"][s_:i] + M["c"][s_:i]) / 3; v = M["tv"][s_:i]
    if i > s_ and v.sum() > 0:
        x_ = tp - tp[0]; mu_ = (x_ * v).sum() / v.sum(); vw = tp[0] + mu_; sd = np.sqrt(max((x_ * x_ * v).sum() / v.sum() - mu_ * mu_, 0))   # centred sums
        W["vwap_b1"] = near(P, [vw + sd, vw - sd]); W["vwap_b2"] = near(P, [vw + 2 * sd, vw - 2 * sd])
    for tf, nm in ZL.LINE_TF:
        j = closed_idx(BB[tf], tf, t[i], days[i])
        for pp in (20, 50, 200): W[f"ema_{nm}_{pp}"] = near(P, [EM[(tf, pp)][j]]) if j >= 0 else np.nan
        if tf < 60 and j >= 19:
            w_ = BB[tf]["c"][j - 19:j + 1]; W[f"bb_{nm}"] = near(P, [w_.mean() + 2 * w_.std(), w_.mean() - 2 * w_.std()])
    fl, an, pool = [], [], []
    for s in ZL.SW_SCALES:
        pi, pp_s, pk, pc = PIV[s]
        for lvl, kk, c_ in zip(pp_s, pk, pc):
            if not (a0 <= c_ < i): continue
            b = brk_close(c_, lvl, kk, i)
            if not b: an.append(lvl)
            if b and kk == -kd: fl.append(lvl)
            if s == 5 and not b and kk == kd: pool.append(lvl)
    W["swing_flip"] = near(P, fl); W["swing_unbroken_any"] = near(P, an)
    pool = sorted(pool); W["eq_pool"] = near(P, [(pool[j] + pool[j + 1]) / 2 for j in range(len(pool) - 1) if pool[j + 1] - pool[j] <= 1.0])
    pi, pp_s, pk, pc = PIV[10]; kn = [j for j in range(len(pc)) if pc[j] < i]
    if len(kn) >= 2:
        p1, p2 = pp_s[kn[-2]], pp_s[kn[-1]]; lg = p2 - p1
        W["fib_r"] = near(P, [p2 - f * lg for f in (0.382, 0.5, 0.618)]); W["fib_x"] = near(P, [p1 + f * lg for f in (1.272, 1.618)])
        same = [j for j in kn if pk[j] == kd]
        if len(same) >= 2:
            q1, q2 = same[-2], same[-1]; t1, t2 = t[pi[q1]], t[pi[q2]]
            W["tl"] = near(P, [pp_s[q2] + (pp_s[q2] - pp_s[q1]) / (t2 - t1) * (t[i] - t2)]) if (t2 > t1 and t2 - t1 <= 5 * 86400) else np.nan
        else: W["tl"] = np.nan
    for tf in (1, 3, 5, 15):
        a0z = ds0[max(0, di - ZL.ZONE_AGE[tf])]
        for nm in ("fvg", "ds", "ob"):
            best = np.inf; lo_i, hi_i = np.searchsorted(ZST[tf][nm], a0z), np.searchsorted(ZST[tf][nm], i)
            for lo, hi, s, st in ZT[tf][nm][lo_i:hi_i]:
                if not (a0z <= st < i): continue
                edge = lo if s > 0 else hi
                if nm == "ob": dead = np.any((M["c"][st:i] - edge) * -s > 0)
                elif nm == "fvg": dead = np.any((M["l"][st:i] < edge) if s > 0 else (M["h"][st:i] > edge))
                else: dead = np.any((M["l"][st:i] < edge) if s > 0 else (M["h"][st:i] > edge))
                if dead: continue
                best = min(best, 0.0 if lo <= P <= hi else min(abs(P - lo), abs(P - hi)))
            W[f"{nm}_m{tf}"] = best if np.isfinite(best) else np.nan
    W["rn50"] = abs(P - round(P / 50) * 50); W["rn100"] = abs(P - round(P / 100) * 100)
    # --- types added in the audit (2026-09-30) ---
    for nm, key in (("pw", wk), ("pm", mo)):
        prev = [u for u in np.unique(key) if u < key[di]]
        if prev:
            dd_ = np.flatnonzero(key == prev[-1]); W[f"{nm}_c"] = near(P, [M["c"][de0[dd_[-1]] - 1]]); W[f"{nm}_o"] = near(P, [M["o"][ds0[dd_[0]]]])
            if nm == "pw":
                bars = np.arange(ds0[dd_[0]], de0[dd_[-1]]); W["vp_pw"] = near(P, list(vprof(bars)))
        else: W[f"{nm}_c"] = W[f"{nm}_o"] = np.nan
    if i > ds0[di]: W["vp_td"] = near(P, [vprof(np.arange(ds0[di], i))[0]])
    so = [M["o"][ds0[di]]] if ds0[di] < i else []
    for mm_ in (3 * 60, 8 * 60, 9 * 60 + 30):
        bb_ = [j for j in range(ds0[di], de0[di]) if mm_ <= et_min[j] < 17 * 60]
        if bb_ and bb_[0] < i: so.append(M["o"][bb_[0]])
    W["sess_open"] = near(P, so)
    ws = ds0[np.flatnonzero(wk == wk[di])[0]]; tp = (M["h"][ws:i] + M["l"][ws:i] + M["c"][ws:i]) / 3; v = M["tv"][ws:i]
    if i > ws and v.sum() > 0: W["vwap_w"] = near(P, [(tp * v).sum() / v.sum()])
    for tf, nm in ((1, "m1"), (3, "m3"), (5, "m5"), (15, "m15")):
        j = closed_idx(BB[tf], tf, t[i], days[i]); B_ = BB[tf]
        if j >= 10:
            tr = [max(B_["h"][jj], B_["c"][jj - 1]) - min(B_["l"][jj], B_["c"][jj - 1]) for jj in range(j - 9, j + 1)]
            e20 = EM[(tf, 20)][j]
            W[f"kc_{nm}"] = near(P, [e20 + 2 * np.mean(tr), e20 - 2 * np.mean(tr)])
    for s in ZL.SW_SCALES:
        pi, pp_s, pk, pc = PIV[s]; W[f"swing_same_s{s}"] = near(P, [lvl for lvl, kk, c_ in zip(pp_s, pk, pc) if a0 <= c_ < i and kk == kd and not brk_close(c_, lvl, kk, i)])
    for (tf, kk), (pi, pp_s, pk, pc) in SWA.items():
        a0a = ds0[max(0, di - ZL.ATR_SW_AGE[tf])]
        w0, w1 = np.searchsorted(pc, a0a), np.searchsorted(pc, i); cand = list(zip(pp_s[w0:w1], pk[w0:w1], pc[w0:w1]))
        W[f"swa_same_m{tf}k{kk}"] = near(P, [lvl for lvl, k_, c_ in cand if a0a <= c_ < i and k_ == kd and not brk_close(c_, lvl, k_, i)])
        W[f"swa_flip_m{tf}k{kk}"] = near(P, [lvl for lvl, k_, c_ in cand if a0a <= c_ < i and k_ == -kd and brk_close(c_, lvl, k_, i)])
    # visits before this approach, from the level identity reported by zn_lib (plain loop)
    for ty in ("pd_hl", "swing_same", "fvg_m5", "ds_m5", "rn10", "sess_hl"):
        if not (D[ty][q] <= 1.0 and D[ty + "_s"][q] >= 0): continue
        s_ = int(D[ty + "_s"][q]); lo_, hi_ = D[ty + "_lo"][q] - 0.5, D[ty + "_hi"][q] + 0.5; runs = 0; prev = False
        for j in range(s_, i):
            tt = M["l"][j] <= hi_ and M["h"][j] >= lo_
            if tt and not prev: runs += 1
            prev = tt
        want_v = runs - (1 if prev else 0) if s_ < i else 0
        cnt["vis_" + ty] = cnt.get("vis_" + ty, 0) + 1
        if Q[ty + "_vis"][q] != want_v: nb += 1; print("VIS MISMATCH", ty, q, want_v, Q[ty + "_vis"][q]) if nb < 25 else None
    for key, want in W.items():
        got = D[key][q]; cnt[key] = cnt.get(key, 0) + 1
        if not ((np.isnan(want) and np.isnan(got)) or abs(want - got) < 1e-6):
            nb += 1
            if nb < 25: print("MISMATCH", key, q, i, want, got)
untested = [k_ for k_ in Z.types(D) if k_ not in cnt and k_ not in ("pd_hl", "rn10", "vwap", "fvg_m5", "swing_same")]
print(f"brute force 300 events: types checked {len(cnt)}, mismatches {nb}; types not checked by zn_check / zn_check2: {untested}")
print("TOTAL", bad + nb)
