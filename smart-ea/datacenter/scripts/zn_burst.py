r"""Step 2b (user 2026-09-30): accumulation then burst. Find every sideways box on M1 and what happened when it broke, then ask
(a) do boxes break into a burst more often than in a random-direction market, (b) WHY there - which zones (zn_lib) sat at the box,
(c) what the box looked like before a burst vs before a failed break (behaviour that repeats before a burst).
Box (per X = $10 / $20 / $30 / $50 / $100): a maximal run of >= 30 M1 bars in one session whose high-low <= 0.3 X (two-pointer scan,
non-overlapping). Break = the first bar that would widen the box beyond 0.3 X: up if its high is above the box, down if its low is below
(both sides in one bar -> skipped). Burst = price then travels X beyond the broken edge before touching the opposite edge (4-point path,
within 2 trading days); otherwise FAIL.
Zones: distances from the box middle measured with the zones known at the box START (the zones that were there before price began to
accumulate); a zone is "at the box" if within half the box height + $1 of the middle. First touch / created today as in zn_why.
Box behaviour (known at the break): duration, touches of the top / bottom (visits within 10% of the height), last-10-bar range / height,
tick-volume last third / first third, position of the box in today's range so far, break side vs the box's own drift (close of the last
bar vs the first), break side vs day direction so far.
Output: zn\zn_burst.txt + zn\zn_burst_<market>.npz"""
import sys, os, time, calendar, datetime
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, po_lib as PO, zn_lib as ZL, broker as BK
OUT = r"C:\trade datacenter\zn"; FROM = calendar.timegm(datetime.datetime(2024, 5, 13).timetuple())
XS = [10, 20, 30, 50, 100]; MK = ["real", "sf1", "sf2", "sf3"]; MINB = 30; WF = 0.3

def boxes(M, X):
    hi = np.rint(M["h"] / BK.POINT).astype(np.int64); lo = np.rint(M["l"] / BK.POINT).astype(np.int64); sid = M["sid"]; n = len(hi)
    W = int(round(WF * X / BK.POINT)); out = []; a = 0
    from collections import deque
    qh, ql = deque(), deque()
    for j in range(n):
        if j > a and sid[j] != sid[j - 1]: a = j; qh.clear(); ql.clear()
        # would bar j widen the window [a, j-1] beyond W ?
        if qh and (max(hi[qh[0]], hi[j]) - min(lo[ql[0]], lo[j]) > W):
            L_ = j - a
            if L_ >= MINB:
                bh, bl = hi[qh[0]], lo[ql[0]]; up = hi[j] > bh; dn = lo[j] < bl
                if up != dn: out.append((a, j - 1, j, 1 if up else -1, bh * BK.POINT, bl * BK.POINT))
                a = j; qh.clear(); ql.clear()
            else:
                while qh and (max(hi[qh[0]], hi[j]) - min(lo[ql[0]], lo[j]) > W):     # shrink from the left until bar j fits
                    a += 1
                    while qh and qh[0] < a: qh.popleft()
                    while ql and ql[0] < a: ql.popleft()
        while qh and hi[qh[-1]] <= hi[j]: qh.pop()
        qh.append(j)
        while ql and lo[ql[-1]] >= lo[j]: ql.pop()
        ql.append(j)
    return np.array(out, dtype=float).reshape(-1, 6)

def outcome(M, PATH, b, s, bh, bl, X, maxbars):
    """1 = burst (X beyond the broken edge before the opposite edge), 0 = fail; path from the break bar"""
    seg = PATH[4 * b: 4 * min(len(M["t"]), b + maxbars)]
    if s > 0: tgt = np.flatnonzero(seg >= bh + X); opp = np.flatnonzero(seg <= bl)
    else: tgt = np.flatnonzero(seg <= bl - X); opp = np.flatnonzero(seg >= bh)
    t_ = tgt[0] if len(tgt) else 1 << 40; o_ = opp[0] if len(opp) else 1 << 40
    return 1 if t_ < o_ else 0

def run(mkt):
    f = os.path.join(OUT, f"zn_burst_{mkt}.npz")
    if os.path.exists(f): return dict(np.load(f))
    t0 = time.time(); M = PO.load_market(mkt); Z = ZL.Zones(M); i0 = np.searchsorted(M["t"], FROM)
    bull = M["c"] >= M["o"]; PATH = np.empty(4 * len(M["t"])); PATH[0::4] = M["o"]; PATH[1::4] = np.where(bull, M["l"], M["h"])
    PATH[2::4] = np.where(bull, M["h"], M["l"]); PATH[3::4] = M["c"]
    res = {}
    for X in XS:
        Bx = boxes(M, X); Bx = Bx[Bx[:, 0] >= i0]; a, e, b = Bx[:, 0].astype(int), Bx[:, 1].astype(int), Bx[:, 2].astype(int)
        s, bh, bl = Bx[:, 3].astype(int), Bx[:, 4], Bx[:, 5]; H = bh - bl; mid = (bh + bl) / 2
        ok = np.array([outcome(M, PATH, bb, ss, h_, l_, X, 2 * 1450) for bb, ss, h_, l_ in zip(b, s, bh, bl)])
        D = Z.distances(a, mid, s); Q = Z.quality(a, D, near=H / 2 + 1.0)             # zones known at the box start
        today = Z.dstart[Z.di[a]]
        feat = {}
        feat["dur"] = e - a + 1
        tt, tb, r10, vr, pos, drift, dayd = [], [], [], [], [], [], []
        for aa, ee, h_, l_, ss in zip(a, e, bh, bl, s):
            hh, ll = M["h"][aa:ee + 1], M["l"][aa:ee + 1]; band = 0.1 * (h_ - l_)
            top = hh >= h_ - band; bot = ll <= l_ + band
            tt.append(int(top[0]) + int(np.sum(top[1:] & ~top[:-1]))); tb.append(int(bot[0]) + int(np.sum(bot[1:] & ~bot[:-1])))
            r10.append((hh[-10:].max() - ll[-10:].min()) / max(h_ - l_, 1e-9))
            v = M["tv"][aa:ee + 1]; k3 = max(1, len(v) // 3); vr.append(v[-k3:].mean() / max(v[:k3].mean(), 1e-9))
            s0 = Z.dstart[Z.di[aa]]; dh, dl = M["h"][s0:ee + 1].max(), M["l"][s0:ee + 1].min()
            pos.append(((h_ + l_) / 2 - dl) / max(dh - dl, 1e-9)); drift.append(np.sign(M["c"][ee] - M["o"][aa]) * ss)
            dayd.append(np.sign(M["c"][ee] - M["o"][s0]) * ss)
        feat.update(top=np.array(tt), bot=np.array(tb), r10=np.array(r10), vr=np.array(vr), pos=np.array(pos), drift=np.array(drift), dayd=np.array(dayd))
        # touches on the break side / the opposite side
        feat["t_break"] = np.where(s > 0, feat["top"], feat["bot"]); feat["t_opp"] = np.where(s > 0, feat["bot"], feat["top"])
        res[f"x{X}_ok"] = ok; res[f"x{X}_s"] = s; res[f"x{X}_H"] = H; res[f"x{X}_a"] = a; res[f"x{X}_today"] = today
        for k, v in {**D, **Q, **feat}.items(): res[f"x{X}_{k}"] = v
        res["types"] = np.array(Z.types(D))
        print(mkt, "X", X, "boxes", len(a), "bursts", int(ok.sum()), f"{time.time() - t0:.0f}s", flush=True)
    res["ndays"] = len(np.unique(M["day"][i0:]))
    np.savez(f + ".tmp.npz", **res); os.replace(f + ".tmp.npz", f); return res

if __name__ == "__main__":
    R = {m: run(m) for m in (sys.argv[1:] or MK)}
    if len(R) < 4: sys.exit()
    types = [str(x) for x in R["real"]["types"]]; nd = int(R["real"]["ndays"]); txt = []
    def say(s=""): print(s); txt.append(s)
    say(f"boxes: >= {MINB} M1 bars, height <= {WF} X, events from 2024-05-13, {nd} trading days. BURST = X beyond the broken edge before the opposite edge")
    for X in XS:
        r = R["real"]; ok = r[f"x{X}_ok"] == 1; n = len(ok)
        sfn = [len(R[m][f"x{X}_ok"]) for m in MK[1:]]; sfr = [np.mean(R[m][f"x{X}_ok"]) for m in MK[1:]]
        say(f"\n=== X = ${X}: boxes {n} ({n / nd:.1f}/day), bursts {ok.sum()} ({ok.sum() / nd:.2f}/day) = {ok.mean():.1%} | random-direction boxes {np.mean(sfn):.0f}, burst rate {np.mean(sfr):.1%} ===")
        say(f"  burst rate by break side: up {np.mean(ok[r[f'x{X}_s'] > 0]):.1%} / down {np.mean(ok[r[f'x{X}_s'] < 0]):.1%}")
        hit = lambda rr, ty: rr[f"x{X}_{ty}"] <= rr[f"x{X}_H"] / 2 + 1.0
        say("  [zone at the box] type                real burst  real fail  random-dir burst | burst-rate at zone real / random-dir")
        rows = []
        for ty in types:
            hr = hit(r, ty); a1 = np.mean(hr[ok]); a2 = np.mean(hr[~ok])
            c1 = np.mean([np.mean(hit(R[m], ty)[R[m][f"x{X}_ok"] == 1]) for m in MK[1:]])
            br = np.mean(ok[hr]) if hr.any() else np.nan
            bs = np.mean([np.mean(R[m][f"x{X}_ok"][hit(R[m], ty)]) if hit(R[m], ty).any() else np.nan for m in MK[1:]])
            nz = hr.sum(); se = np.sqrt(bs * (1 - bs) / max(nz, 1)) if np.isfinite(bs) else np.nan
            rows.append((ty, a1, a2, c1, br, bs, (br - bs) / se if se and se > 0 else np.nan, nz))
        for q in sorted(rows, key=lambda q: -np.nan_to_num(q[6]))[:14] + sorted(rows, key=lambda q: np.nan_to_num(q[6]))[:6]:
            say(f"            {q[0]:20s} {q[1]:8.1%} {q[2]:10.1%} {q[3]:10.1%}        | {q[4]:6.1%} / {q[5]:6.1%}  z {q[6]:+5.1f}  (n {q[7]})")
        say("  [box behaviour before the break]  median / mean: real burst | real fail | random-dir burst | random-dir fail")
        for fk in ("dur", "t_break", "t_opp", "r10", "vr", "pos", "drift", "dayd"):
            v = r[f"x{X}_{fk}"]; sv = [(R[m][f"x{X}_{fk}"], R[m][f"x{X}_ok"] == 1) for m in MK[1:]]
            f_ = (lambda x: np.mean(x)) if fk in ("drift", "dayd") else (lambda x: np.median(x))
            say(f"            {fk:8s} {f_(v[ok]):7.2f} | {f_(v[~ok]):7.2f} | {np.mean([f_(a[b]) for a, b in sv]):7.2f} | {np.mean([f_(a[~b]) for a, b in sv]):7.2f}")
        # burst rate by behaviour bins (real vs random-direction)
        for fk, edges in (("t_break", [0, 1, 2, 3, 5, 99]), ("t_opp", [0, 1, 2, 3, 5, 99]), ("drift", [-1.5, -0.5, 0.5, 1.5]), ("dayd", [-1.5, -0.5, 0.5, 1.5]),
                          ("r10", [0, 0.3, 0.5, 0.7, 1.01]), ("vr", [0, 0.7, 1.0, 1.4, 99]), ("pos", [-0.01, 0.2, 0.4, 0.6, 0.8, 1.01]), ("dur", [30, 45, 60, 90, 150, 100000])):
            line = f"  burst rate by {fk:7s}:"
            for lo_, hi_ in zip(edges[:-1], edges[1:]):
                v = r[f"x{X}_{fk}"]; m_ = (v >= lo_) & (v < hi_)
                sv = np.mean([np.mean(R[m][f"x{X}_ok"][(R[m][f"x{X}_{fk}"] >= lo_) & (R[m][f"x{X}_{fk}"] < hi_)]) for m in MK[1:]])
                line += f"  [{lo_:g},{hi_:g}) {np.mean(ok[m_]) if m_.any() else np.nan:5.1%}/{sv:5.1%} n{m_.sum()}"
            say(line)
    open(os.path.join(OUT, "zn_burst.txt"), "w", encoding="utf-8").write("\n".join(txt))
