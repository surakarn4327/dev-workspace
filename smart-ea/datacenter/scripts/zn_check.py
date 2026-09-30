r"""Checks of zn_lib (real market):
 A. no future data: build Zones on bars cut at time T (4 cuts), distances of every $10-reversal before the cut must equal the full build
 B. brute force for 400 random events (plain loops, no zn_lib internals): previous-day high/low, round $10, today's VWAP, unfilled M5 FVG,
    unbroken same-kind swing ($5/$10/$20/$50 zigzag from zn_lib.zigzag_usd, break = first close beyond after confirmation)"""
import sys
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, po_lib as PO, zn_lib as ZL, adx_ctx as X
M = PO.load_market("real"); t = M["t"]; n = len(t)
Z = ZL.Zones(M); idx, p, k, conf = ZL.zigzag_usd(M, 10)
i0 = np.searchsorted(t, 1715558400); m = idx >= i0; idx, p, k = idx[m], p[m], k[m]
FULL = Z.distances(idx, p, k); FULL.update(Z.quality(idx, FULL)); bad = 0
for T in (1725000000, 1745000000, 1765000000, 1785000000):
    c = np.searchsorted(t, T); Mc = {kk: (v[:c] if isinstance(v, np.ndarray) and len(v) == n else v) for kk, v in M.items()}
    Zc = ZL.Zones(Mc); sel = idx < c
    # the pivot itself must be known in the cut data: its confirmation bar < c (otherwise it would not be an event yet)
    D = Zc.distances(idx[sel], p[sel], k[sel]); D.update(Zc.quality(idx[sel], D)); nd = 0
    for kk in FULL:
        a, b = FULL[kk][sel], D[kk]; nd += int(np.sum(~((np.isnan(a) & np.isnan(b)) | (np.abs(a - b) < 1e-9))))
    bad += nd; print(f"A cut {T}: events {sel.sum()} differences {nd}", flush=True)
rng = np.random.default_rng(3); pick = rng.choice(len(idx), 400, replace=False); bB = 0
days = M["day"]; ud = np.unique(days)
PIV = {sc: ZL.zigzag_usd(M, sc) for sc in ZL.SW_SCALES}
B5 = X.resample(M, 5); m1end = np.searchsorted(t, B5["t_last"], "right")
for q in pick:
    i, P, kk = idx[q], p[q], k[q]; d = days[i]; di = np.searchsorted(ud, d)
    # previous-day high / low
    pm = days == ud[di - 1]; want = min(abs(M["h"][pm].max() - P), abs(M["l"][pm].min() - P))
    if abs(want - FULL["pd_hl"][q]) > 1e-9: bB += 1; print("pd_hl", q, want, FULL["pd_hl"][q])
    if abs(abs(P - round(P / 10) * 10) - FULL["rn10"][q]) > 1e-9: bB += 1
    # vwap of today's bars before i
    s = np.flatnonzero(days == d)[0]; tp = (M["h"][s:i] + M["l"][s:i] + M["c"][s:i]) / 3; v = M["tv"][s:i]
    if i > s and v.sum() > 0:
        if abs(abs((tp * v).sum() / v.sum() - P) - FULL["vwap"][q]) > 1e-6: bB += 1; print("vwap", q)
    # unfilled M5 FVG created before i within 20 trading days
    a0 = np.flatnonzero(days == ud[max(0, di - ZL.MAXAGE)])[0]; best = np.inf
    for c5 in range(2, len(B5["c"])):
        st = m1end[c5]
        if st >= i: break
        if st < a0: continue
        if not (B5["sid"][c5] == B5["sid"][c5 - 1] == B5["sid"][c5 - 2]): continue
        if B5["l"][c5] > B5["h"][c5 - 2]: lo, hi, dead = B5["h"][c5 - 2], B5["l"][c5], np.any(M["l"][st:i] < B5["h"][c5 - 2])
        elif B5["h"][c5] < B5["l"][c5 - 2]: lo, hi, dead = B5["h"][c5], B5["l"][c5 - 2], np.any(M["h"][st:i] > B5["l"][c5 - 2])
        else: continue
        if dead: continue
        best = min(best, 0.0 if lo <= P <= hi else min(abs(P - lo), abs(P - hi)))
    got = FULL["fvg_m5"][q]
    if not ((np.isinf(best) and np.isnan(got)) or abs(best - got) < 1e-9): bB += 1; print("fvg", q, best, got)
    # unbroken same-kind swings
    best = np.inf
    for sc in ZL.SW_SCALES:
        pi, pp, pk, pc = PIV[sc]
        for a, b_, c_ in zip(pp, pk, pc):
            if not (a0 <= c_ < i) or b_ != kk: continue
            if np.any((M["c"][c_ + 1:i] - a) * b_ > 0): continue
            best = min(best, abs(a - P))
    got = FULL["swing_same"][q]
    if not ((np.isinf(best) and np.isnan(got)) or abs(best - got) < 1e-9): bB += 1; print("swing", q, best, got)
print(f"B brute force 400 events x 5 zone types: mismatches {bB}")
print("TOTAL", bad + bB)
