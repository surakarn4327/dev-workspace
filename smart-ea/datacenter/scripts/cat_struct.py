"""Shared structure detectors (catalog step 2). Pure functions on arrays so the SAME code runs on real bars and on shuffled (null) bars.
All sizes in ATR20 of the timeframe; pivots from a 3-ATR zigzag (same rule as dc_catalog.py)."""
import numpy as np

def shuffle_m1(o, h, l, c, tv, sid, seed):
    """Null series: each session's M1 bars shuffled in time (each bar keeps its gap, body, wicks and tick volume), so volatility and volume
    distributions are kept but any serial dependence is destroyed. Same method as cat_null.py."""
    rng = np.random.default_rng(seed); pc = np.r_[c[0], c[:-1]]
    gap, bo, up, dn = o - pc, c - o, h - np.maximum(o, c), np.minimum(o, c) - l
    O, H, L, C, TV = (np.empty_like(c) for _ in range(5))
    starts = np.r_[0, np.flatnonzero(np.diff(sid)) + 1]; ends = np.r_[starts[1:], len(c)]; last = c[0]
    for a, b in zip(starts, ends):
        p = a + rng.permutation(b - a); g = gap[p].copy(); g[0] = gap[a]
        oo = last + np.cumsum(g + np.r_[0, bo[p][:-1]]); cc = oo + bo[p]
        O[a:b] = oo; C[a:b] = cc; H[a:b] = np.maximum(oo, cc) + up[p]; L[a:b] = np.minimum(oo, cc) - dn[p]; TV[a:b] = tv[p]; last = cc[-1]
    return O, H, L, C, TV

def signflip_m1(o, h, l, c, tv, sid, seed):
    """Second null: keep every bar in its place (so volatility clustering, news spikes, session rhythm and tick volume stay exactly as real)
    but mirror each bar with probability 1/2 (gap, body and the up/down wicks flip). Destroys only DIRECTIONAL dependence.
    Behaviour real >> this null = directional property of gold; real ~ this null but >> shuffle null = volatility clustering."""
    rng = np.random.default_rng(seed); pc = np.r_[c[0], c[:-1]]
    gap, bo, up, dn = o - pc, c - o, h - np.maximum(o, c), np.minimum(o, c) - l
    f = np.where(rng.random(len(c)) < 0.5, -1.0, 1.0)
    g2, b2 = gap * f, bo * f; u2 = np.where(f > 0, up, dn); d2 = np.where(f > 0, dn, up)
    starts = np.r_[0, np.flatnonzero(np.diff(sid)) + 1]; g2[starts] = gap[starts]            # keep the real session-open gap
    O = c[0] + np.cumsum(g2 + np.r_[0, b2[:-1]]); C = O + b2
    return O, np.maximum(O, C) + u2, np.minimum(O, C) - d2, C, tv.copy()

def resample(tf, t, sid, o, h, l, c, tv):
    """TF bars inside sessions + ATR20 of previous bars (same as cat_bars.tf_bars, on arbitrary arrays)"""
    key = sid * 10 ** 7 + t // (tf * 60)
    st = np.r_[0, np.flatnonzero(np.diff(key)) + 1]; en = np.r_[st[1:], len(t)]
    bh = np.maximum.reduceat(h, st); bl = np.minimum.reduceat(l, st); bc = c[en - 1]; bo = o[st]; btv = np.add.reduceat(tv, st)
    pc = np.r_[bc[0], bc[:-1]]; tr = np.maximum(bh, pc) - np.minimum(bl, pc); cs = np.r_[0, np.cumsum(tr)]; n = len(bc)
    atr = np.full(n, np.nan); atr[20:] = (cs[20:n] - cs[:n - 20]) / 20
    return dict(t=t[en - 1], sid=sid[st], o=bo, h=bh, l=bl, c=bc, tv=btv, atr=atr, m1_end=en)

def zigzag(bh, bl, bc, atr, k=3.0):
    """returns pivots as arrays: idx (bar of the extreme), price, kind (+1 high / -1 low), conf (bar where it was confirmed)"""
    n = len(bh); out = []; dirn = 0; ep = bc[0]; ei = 0; stp = bc[0]
    for j in range(1, n):
        th = k * atr[j]
        if not np.isfinite(th): continue
        if dirn == 0:
            if bh[j] >= stp + th: dirn, ep, ei = 1, bh[j], j
            elif bl[j] <= stp - th: dirn, ep, ei = -1, bl[j], j
        elif dirn == 1:
            if bh[j] >= ep: ep, ei = bh[j], j
            elif bl[j] <= ep - th: out.append((ei, ep, 1, j)); dirn, ep, ei = -1, bl[j], j
        else:
            if bl[j] <= ep: ep, ei = bl[j], j
            elif bh[j] >= ep + th: out.append((ei, ep, -1, j)); dirn, ep, ei = 1, bh[j], j
    a = np.array(out, dtype=float).reshape(-1, 4)
    return a[:, 0].astype(int), a[:, 1], a[:, 2].astype(int), a[:, 3].astype(int)

def formations(idx, p, kind, conf, atr):
    """Multi-pivot formations, reported when the last pivot is confirmed. returns list of (type, conf_bar, dir, x1)
    HS / IHS    head & shoulders: 5 pivots; head beyond both shoulders by >= 1 ATR, shoulders within 1 ATR, neckline pivots within 1 ATR
                (dir = expected break side: -1 after a top, +1 after an inverse)
    TRIPLE      3 same-kind pivots within 0.5 ATR (dir = -kind)
    TRIANGLE    4 consecutive legs each <= 0.85 x the previous (contracting)          x1 = last leg / first leg
    BROADEN     4 consecutive legs each >= 1.18 x the previous (expanding)            x1 = last leg / first leg
    FLAG        impulse leg >= 8 ATR, then 3 legs each <= 0.5 x impulse and price stays in the impulse's outer half (dir = impulse)
    V_REV       leg >= 6 ATR in <= 10 bars, next leg retraces >= 80% of it in <= 10 bars (dir = the retracing leg)
    EXHAUST     3 impulses in one direction, each makes a new extreme, each shorter than the one before (dir = the trend)"""
    ev = []; n = len(p)
    for j in range(4, n):
        a = atr[idx[j - 2]]
        if not np.isfinite(a) or a <= 0: continue
        legs = np.abs(np.diff(p[j - 4:j + 1]))                         # 4 legs ending at pivot j
        s = kind[j]; head = p[j - 2]; sh1, sh2 = p[j - 4], p[j]; nk1, nk2 = p[j - 3], p[j - 1]
        head_out = (head - max(sh1, sh2) >= a) if s > 0 else (min(sh1, sh2) - head >= a)       # head beyond both shoulders
        if head_out and abs(sh1 - sh2) <= a and abs(nk1 - nk2) <= a:
            ev.append(("HS" if s > 0 else "IHS", conf[j], -s, (head - (sh1 + sh2) / 2) * s / a))
        same = p[[j - 4, j - 2, j]]
        if same.max() - same.min() <= 0.5 * a: ev.append(("TRIPLE", conf[j], -s, (same.max() - same.min()) / a))
        if np.all(legs[1:] <= 0.85 * legs[:-1]): ev.append(("TRIANGLE", conf[j], 0, legs[-1] / legs[0]))
        if np.all(legs[1:] >= 1.18 * legs[:-1]): ev.append(("BROADEN", conf[j], 0, legs[-1] / legs[0]))
        imp = legs[0]; d = np.sign(p[j - 3] - p[j - 4])
        if imp >= 8 * a and np.all(legs[1:] <= 0.5 * imp):
            ext = p[j - 3]; lo_bound = ext - d * 0.5 * imp
            if np.all((p[j - 2:j + 1] - lo_bound) * d >= 0): ev.append(("FLAG", conf[j], int(d), imp / a))
        la, lb = abs(p[j - 1] - p[j - 2]), abs(p[j] - p[j - 1])
        if la >= 6 * a and idx[j - 1] - idx[j - 2] <= 10 and lb >= 0.8 * la and idx[j] - idx[j - 1] <= 10:
            ev.append(("V_REV", conf[j], int(np.sign(p[j] - p[j - 1])), lb / la))
        if j >= 5:
            s = np.sign(p[j] - p[j - 1])
            imps = [abs(p[j - 4] - p[j - 5]), abs(p[j - 2] - p[j - 3]), abs(p[j] - p[j - 1])]
            if np.sign(p[j - 2] - p[j - 3]) == s and np.sign(p[j - 4] - p[j - 5]) == s and (p[j] - p[j - 2]) * s > 0 and (p[j - 2] - p[j - 4]) * s > 0 \
                    and imps[2] < imps[1] < imps[0]:
                ev.append(("EXHAUST", conf[j], int(s), imps[2] / imps[0]))
    return ev

def retests(idx, p, kind, conf, bh, bl, bc, atr, sid, horizon=200, hold=20):
    """Break-and-retest of swing levels (same session, each step within `horizon` bars). For every pivot (level L, kind k) after it is confirmed:
    BREAK   = first close beyond L by > 0.25 ATR
    DEPART  = after the break, a close >= 1 ATR beyond L (price really left the level; otherwise outcome NODEPART)
    RETEST  = after departing, the first bar that comes back within 0.25 ATR of L (otherwise NORETEST)
    then FAIL if a close goes back through L by > 0.25 ATR within `hold` bars, else HOLD.
    returns list of (outcome, bar_of_break, bar_of_retest_or_-1, dir, bars_break_to_retest)"""
    out = []; n = len(bc)
    def seg_from(b0):
        s_ = np.arange(b0 + 1, min(n, b0 + horizon)); return s_[sid[s_] == sid[b0]]
    for q in range(len(p)):
        L = p[q]; s = kind[q]; a = atr[idx[q]]; c0 = conf[q]
        if not np.isfinite(a): continue
        seg = seg_from(c0); br = seg[(bc[seg] - L) * s > 0.25 * a]
        if not len(br): continue
        b = br[0]; seg2 = seg_from(b); dep = seg2[(bc[seg2] - L) * s >= 1.0 * a]
        if not len(dep): out.append(("NODEPART", b, -1, int(s), -1)); continue
        seg3 = seg_from(dep[0]); touch = seg3[((bl[seg3] - L) <= 0.25 * a) if s > 0 else ((bh[seg3] - L) >= -0.25 * a)]
        if not len(touch): out.append(("NORETEST", b, -1, int(s), -1)); continue
        r = touch[0]; seg4 = np.arange(r, min(n, r + hold)); seg4 = seg4[sid[seg4] == sid[r]]
        fail = np.any((bc[seg4] - L) * s < -0.25 * a)
        out.append(("RETEST_FAIL" if fail else "RETEST_HOLD", b, r, int(s), int(r - b)))
    return out
