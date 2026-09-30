r"""Independent check of po_lib on a small piece: re-simulate random bars tick-point by tick-point with a plain loop over M1 bars
(no cummax / searchsorted), for BUY/SELL, several SL/TP, with and without break-even, trailing and checkpoints; compare with po_lib."""
import sys
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, po_lib as PO

def brute(M, e, j, je, a, side, s, tp, be):
    """walk points; returns result in ATR before cost"""
    o, h, l, c = M["o"], M["h"], M["l"], M["c"]
    stop = -s; armed = False
    for jj in range(j, je + 1):
        pts = [o[jj], l[jj], h[jj], c[jj]] if c[jj] >= o[jj] else [o[jj], h[jj], l[jj], c[jj]]
        for pi, p in enumerate(pts):
            x = side * (p - e) / a
            if x <= stop:                                        # stop (initial or break-even) touched
                return x if pi == 0 and x < stop else stop       # gap at the open -> fill at the open
            if tp is not None and x >= tp:
                return x if pi == 0 and x > tp else tp
            if be is not None and not armed and x >= be:
                armed = True; stop = 0.0
                # the same point cannot also be <= 0
    return side * (c[je] - e) / a

def brute_trail(M, e, j, je, a, side, d):
    o, h, l, c = M["o"], M["h"], M["l"], M["c"]; best = 0.0
    for jj in range(j, je + 1):
        pts = [o[jj], l[jj], h[jj], c[jj]] if c[jj] >= o[jj] else [o[jj], h[jj], l[jj], c[jj]]
        for pi, p in enumerate(pts):
            x = side * (p - e) / a; best = max(best, x)
            if best - x >= d: return x if pi == 0 else best - d
    return side * (c[je] - e) / a

M = PO.load_market("real")
R, E = PO.build(M, 5, verbose=False, limit=None) if False else (None, None)
# build only a slice for speed: take every bar but keep 4000 random ones from the full build of the first 40,000 bars
R, E = PO.build(M, 5, limit=40000, verbose=False)
rng = np.random.default_rng(0); pick = rng.choice(len(R["b"]), 1500, replace=False)
t = M["t"]; bad = 0; nchk = 0
for q in pick:
    bi = R["b"][q]; dec = R["dec_t"][q]; j = np.searchsorted(t, dec); a = R["atr"][q]; e = R["entry"][q]
    je = j + R["n_pts"][q] // 4 - 1
    assert M["o"][j] == e
    for side in (1, -1):
        for s_k, tp_k, be in ((3, 7, None), (1, 11, None), (7, 23, None), (3, None, None), (3, 11, 1), (5, 15, 0), (11, 47, 3)):
            got = PO.trade_R(R, np.array([q]), side, s_k, tp_k, be, cost=0.0)[0]
            want = brute(M, e, j, je, a, side, PO.LV[s_k], None if tp_k is None else PO.LV[tp_k], None if be is None else PO.BE_LV[be]) / PO.LV[s_k]
            nchk += 1
            if abs(got - want) > 1e-9: bad += 1; print("MISMATCH", q, side, s_k, tp_k, be, got, want) if bad < 10 else None
        for kk, d in enumerate(PO.TR_D):
            got = (R["tr_b"] if side > 0 else R["tr_s"])[q, kk]; want = brute_trail(M, e, j, je, a, side, d); nchk += 1
            if abs(got - want) > 1e-9: bad += 1; print("TRAIL MISMATCH", q, side, d, got, want) if bad < 10 else None
        s = (R["s_b"] if side > 0 else R["s_s"])[q]
        if s > 0:
            for rk in (0, 3, 6):
                got = PO.trade_R_struct(R, np.array([q]), side, rk, cost=0.0)[0]
                # brute: stop fill at open when gapped; TP filled at level (as documented)
                want = brute(M, e, j, je, a, side, s, PO.RR[rk] * s, None)
                o_ = M["o"]; nchk += 1
                if abs(got - want / s) > 1e-9:
                    # allowed difference: TP gapped at an open point (struct TP fill at level by design)
                    if not (want / s > PO.RR[rk] + 1e-12): bad += 1; print("STRUCT MISMATCH", q, side, rk, got, want / s)
    for kk, N in enumerate(PO.CHK_N):
        jj = j + 5 * N - 1
        if jj <= je:
            nchk += 1
            if abs(R["chk"][q, kk] - (M["c"][jj] - e) / a) > 1e-9: bad += 1
        elif not np.isnan(R["chk"][q, kk]): bad += 1
    # exit rule: last bar before next 16:00 UTC or end of session; entry window
    cut = (dec // 86400) * 86400 + 16 * 3600
    if cut <= dec: cut += 86400
    assert t[je] < cut and M["sid"][je] == M["sid"][j]
    assert je + 1 >= len(t) or t[je + 1] >= cut or M["sid"][je + 1] != M["sid"][j]
    hr = (dec // 3600) % 24; assert hr < 16 or hr >= 21
print(f"checked {nchk} results on {len(pick)} bars: mismatches {bad}")
