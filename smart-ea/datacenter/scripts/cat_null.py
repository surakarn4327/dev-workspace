"""Baseline for catalog part B: are trend runs / boxes / zigzag legs a property of gold or of any series with the same volatility?
Null series = each session's M1 bars shuffled in time (each bar keeps its own gap, body and wicks relative to its open), so the
volatility distribution and the day's total variance are kept but any serial dependence (momentum / mean reversion) is destroyed.
The same zigzag (3 ATR), structure-run and box rules are applied to real and to 3 shuffled copies, on M1 and M5."""
import numpy as np
import cat_bars as CB
M = CB.m1(); t, o, h, l, c, sid = M["t"], M["o"], M["h"], M["l"], M["c"], M["sid"]
FULL = set(CB.full_list().tolist())
nfull = len(FULL); fullbar = np.isin(M["day"], list(FULL))
def shuffled(seed):
    rng = np.random.default_rng(seed); pc = np.r_[c[0], c[:-1]]
    gap, bo, up, dn = o - pc, c - o, h - np.maximum(o, c), np.minimum(o, c) - l
    newc = np.empty_like(c); newo = np.empty_like(c); newh = np.empty_like(c); newl = np.empty_like(c)
    starts = np.r_[0, np.flatnonzero(np.diff(sid)) + 1]; ends = np.r_[starts[1:], len(c)]; last = c[0]
    for a, b in zip(starts, ends):
        p = a + rng.permutation(b - a)
        g = gap[p].copy(); g[0] = gap[a]                              # keep the real session-open gap at the start
        oo = last + np.cumsum(g + np.r_[0, bo[p][:-1]]); cc = oo + bo[p]
        newo[a:b] = oo; newc[a:b] = cc; newh[a:b] = np.maximum(oo, cc) + up[p]; newl[a:b] = np.minimum(oo, cc) - dn[p]; last = cc[-1]
    return newo, newh, newl, newc
def resample(tf, O, H, L, C):
    key = sid * 10 ** 7 + t // (tf * 60)
    st = np.r_[0, np.flatnonzero(np.diff(key)) + 1]; en = np.r_[st[1:], len(t)]
    bh = np.maximum.reduceat(H, st); bl = np.minimum.reduceat(L, st); bc = C[en - 1]; bs = sid[st]; bfull = fullbar[en - 1]
    pc = np.r_[bc[0], bc[:-1]]; tr = np.maximum(bh, pc) - np.minimum(bl, pc); cs = np.r_[0, np.cumsum(tr)]; n = len(bc)
    atr = np.full(n, np.nan); atr[20:] = (cs[20:n] - cs[:n - 20]) / 20
    return bh, bl, bc, bs, atr, bfull
def measure(bh, bl, bc, bs, atr, bfull):
    n = len(bc); piv = []; dirn = 0; ep = bc[0]; ei = 0; stp = bc[0]
    for k in range(1, n):
        th = 3 * atr[k]
        if not np.isfinite(th): continue
        if dirn == 0:
            if bh[k] >= stp + th: dirn, ep, ei = 1, bh[k], k
            elif bl[k] <= stp - th: dirn, ep, ei = -1, bl[k], k
        elif dirn == 1:
            if bh[k] >= ep: ep, ei = bh[k], k
            elif bl[k] <= ep - th: piv.append((ei, ep)); dirn, ep, ei = -1, bl[k], k
        else:
            if bl[k] <= ep: ep, ei = bl[k], k
            elif bh[k] >= ep + th: piv.append((ei, ep)); dirn, ep, ei = 1, bh[k], k
    P = np.array(piv); legs = int(np.sum(bfull[P[1:, 0].astype(int)]))
    runs = []; k = 2
    while k < len(P):
        s = 1 if P[k, 1] > P[k - 2, 1] else -1; k0 = k
        while k < len(P) and ((P[k, 1] > P[k - 2, 1]) if s > 0 else (P[k, 1] < P[k - 2, 1])): k += 1
        if k - k0 >= 2 and bfull[int(P[k - 1, 0])]: runs.append(k - k0)
        if k == k0: k += 1
    runs = np.array(runs)
    boxes = 0; boxbars = 0; i = 0
    while i < n - 1:
        a = atr[i]
        if not np.isfinite(a): i += 1; continue
        hi_, lo_ = bh[i], bl[i]; j = i
        while j + 1 < n and bs[j + 1] == bs[i] and max(hi_, bh[j + 1]) - min(lo_, bl[j + 1]) <= 4 * a:
            j += 1; hi_ = max(hi_, bh[j]); lo_ = min(lo_, bl[j])
        if j - i + 1 >= 20:
            if bfull[j]: boxes += 1; boxbars += j - i + 1
            i = j + 1
        else: i += 1
    cont = [np.mean(runs >= q + 1) / max(np.mean(runs >= q), 1e-9) for q in (2, 3, 4)]
    return legs / nfull, len(runs) / nfull, cont, np.mean(runs >= 5), boxes / nfull, boxbars / max(1, bfull.sum())
print(" series      TF | legs/day | runs/day | P(cont) n2->3 3->4 4->5 | share runs n>=5 | boxes/day | time in box")
for tf in (1, 5):
    res = [("real", measure(*resample(tf, o, h, l, c)))]
    for s in range(3): res.append((f"shuffle{s}", measure(*resample(tf, *shuffled(100 + s)))))
    for name, (lg, rn, ct, r5, bx, sh) in res:
        print(f" {name:10s} M{tf:<2}| {lg:7.1f}  | {rn:7.2f}  |        {ct[0]:.2f} {ct[1]:.2f} {ct[2]:.2f}       | {r5:6.1%}          | {bx:8.2f}  | {sh:.0%}", flush=True)
