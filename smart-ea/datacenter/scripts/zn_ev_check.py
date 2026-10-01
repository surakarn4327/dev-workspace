r"""Independent checks of the zone-entry library (zn_ev.py / zn_ev_build.py), real market.
A  events: plain bar-by-bar state machine (armed side / touch) for random static instances of every type and random sessions of every line,
   variants real D=1, D=0.5, fake+ ; compared with the stored events (bar, side, prior, visit, stretch end)
B  outcomes: plain loop over M1 bars and their 4 path points for random events (comparisons in 20 x points, exact)
C  features: plain loops (v3, leg12, width)
D  instance properties: flip = pivot closed through today, starts after the break bar, ends with that day; imbalance zones start at a bar end
E  no future data: rebuild zones / instances / events / features / outcomes from data cut at T (4 times) and compare every event whose bar
   closed before T, and its outcome / stretch when those finished before T
usage: zn_ev_check.py <tf> [n_per_type]"""
import sys, os, time
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, po_lib as PO, zn_lib as ZL, zn_ev as EV, adx_ctx as X, broker as BK
tf = int(sys.argv[1]); NS = int(sys.argv[2]) if len(sys.argv) > 2 else 150
OUT = r"C:\trade datacenter\zn"; rng = np.random.default_rng(7 + tf); bad = []
def fail(*a): bad.append(a); print("  FAIL", *a, flush=True)
def eq(a, b):
    try:
        if np.isnan(a) and np.isnan(b): return True
    except TypeError: pass
    return a == b

MKT = os.environ.get("ZN_MKT", "real")                                   # random-direction markets: A-D only (E needs a cut of the real data)
M = PO.load_market(MKT); Z = ZL.Zones(M); B = EV.obs_bars(M, tf); S, L = EV.instances(Z, M, B, tf)
F = dict(np.load(os.path.join(OUT, f"zn_ev_m{tf}_{MKT}.npz"))); TY = EV.TYPES
t = M["t"]; sid = M["sid"]; s20 = B["s20p"]; bs = B["sid"]; st_b = B["st"]; nb = len(B["c"])
hp = np.rint(B["h"] / BK.POINT).astype(np.int64); lp = np.rint(B["l"] / BK.POINT).astype(np.int64); cp = np.rint(B["c"] / BK.POINT).astype(np.int64)

def brute(lo_of, hi_of, jb, je, D):
    """list of (bar, side, prior, visit, stretch end); zone in POINTS at bar j. far: 20 x price vs 20 x level + D x sum20 (1 ATR = sum20/20);
    touch band 0.15 ATR: 2000 x price vs 2000 x level + 15 x sum20"""
    out = []; armed = 0; cur = None; touched = False; nvis = 0; sesvis = {}
    def touch(j):
        lo, hi = lo_of(j), hi_of(j)
        return s20[j] > 0 and np.isfinite(lo) and 2000 * lp[j] <= 2000 * hi + 15 * s20[j] and 2000 * hp[j] >= 2000 * lo - 15 * s20[j]
    for j in range(jb, je + 1):
        if bs[j] != cur: armed = 0; cur = bs[j]
        s = int(s20[j]); lo = lo_of(j); hi = hi_of(j)
        if s <= 0 or not np.isfinite(lo): continue
        if 20 * lp[j] > 20 * hi + D * s: armed = 1; continue
        if 20 * hp[j] < 20 * lo - D * s: armed = -1; continue
        if touch(j):
            if armed != 0:
                x = j + 1
                while x < nb and x < j + EV.MAXST and bs[x] == bs[j] and touch(x): x += 1
                sv = sesvis.get(bs[j], 0); sesvis[bs[j]] = sv + 1
                out.append((j, armed, touched, nvis, x, sv)); nvis += 1; armed = 0
            touched = True
    return out

def stored(vi, ti):
    m = F[f"v{vi}_type"] == ti
    return {k: F[f"v{vi}_{k}"][m] for k in ("j", "side", "prior", "visit", "xend", "inst")}

# ---------------- A events ----------------
print(f"A events M{tf}", flush=True); t0 = time.time(); nA = 0
for vi in (0, 1, 3):
    var, D = EV.VARIANTS[vi]; sh = {"real": 0.0, "fake+": 2.0, "fake-": -2.0}[var]
    for ti, ty in enumerate(TY):
        G = stored(vi, ti)
        if ty in L:
            for li, (lo, hi, role) in enumerate(L[ty]):
                lop = lo / EV.Q; hip = hi / EV.Q
                for ses in rng.choice(np.unique(bs), 12, replace=False):
                    w = np.flatnonzero(bs == ses); jb, je = w[0], w[-1]
                    ev = brute(lambda j: lop[j] + sh * s20[j] / 20.0, lambda j: hip[j] + sh * s20[j] / 20.0, jb, je, D); nA += len(ev)
                    m = (G["inst"] == li) & (G["j"] >= jb) & (G["j"] <= je)
                    got = {(int(a), int(b)): (bool(c), int(d), int(x)) for a, b, c, d, x in zip(G["j"][m], G["side"][m], G["prior"][m], G["visit"][m], G["xend"][m])}
                    exp = {(a, b): (sv > 0, sv, x) for a, b, c, d, x, sv in ev}
                    other = (G["inst"] != li)
                    for k, v in exp.items():
                        if k in got:
                            if got[k] != v: fail("A line fields", vi, ty, li, k, got[k], v)
                        elif not (li > 0 and np.any(other & (G["j"] == k[0]) & (G["side"] == k[1]))): fail("A line missing", vi, ty, li, k)
                    if set(got) - set(exp): fail("A line extra", vi, ty, li, sorted(set(got) - set(exp))[:3])
            continue
        lo, hi, st, de, role = S[ty]
        if not len(lo): continue
        for q in rng.choice(len(lo), min(NS, len(lo)), replace=False):
            jb = np.searchsorted(st_b, st[q], "left"); je = np.searchsorted(st_b, de[q], "right") - 1
            if je <= jb or (sh and s20[jb] <= 0): continue
            o_ = sh * s20[jb] / 20.0
            lq, hq = lo[q] / EV.Q + o_, hi[q] / EV.Q + o_
            ev = brute(lambda j: lq, lambda j: hq, jb, je, D); nA += len(ev)
            m = G["inst"] == q
            got = {(int(a), int(b)): (bool(c), int(d), int(x)) for a, b, c, d, x in zip(G["j"][m], G["side"][m], G["prior"][m], G["visit"][m], G["xend"][m])}
            for a, b, c, d, x, sv in ev:
                if (a, b) in got:
                    if got[(a, b)] != (c, d, x): fail("A fields", vi, ty, q, a, b, got[(a, b)], (c, d, x))
                else:
                    k = (G["j"] == a) & (G["side"] == b)              # taken by an earlier-created instance in the de-duplication?
                    if not k.any() or G["inst"][k][0] >= q: fail("A missing", vi, ty, q, a, b)
            if set(got) - set((a, b) for a, b, *_ in ev): fail("A extra", vi, ty, q, sorted(set(got) - set((a, b) for a, b, *_ in ev))[:3])
print(f"  A checked {nA} events {time.time() - t0:.0f}s", flush=True)

# ---------------- B outcomes / C features ----------------
print("B outcomes, C features", flush=True)
send = np.r_[np.flatnonzero(np.diff(sid)), len(sid) - 1]; sess_end = send[np.searchsorted(send, np.arange(len(sid)))]
op, hi1, lo1, cl = (np.rint(M[x] / BK.POINT).astype(np.int64) for x in ("o", "h", "l", "c"))
nB = 0
for vi in (0, 3):
    ne = len(F[f"v{vi}_j"])
    for q in rng.choice(ne, 1500, replace=False):
        j = int(F[f"v{vi}_j"][q]); s = int(F[f"v{vi}_side"][q]); lo = F[f"v{vi}_lo"][q] / EV.Q; hi = F[f"v{vi}_hi"][q] / EV.Q; sm = int(s20[j])
        m0 = st_b[j]; me = min(m0 + EV.HOR * tf, sess_end[m0] + 1); entered = False; res = {}
        for mm in range(m0, me):
            pts = (op[mm], lo1[mm], hi1[mm], cl[mm]) if cl[mm] >= op[mm] else (op[mm], hi1[mm], lo1[mm], cl[mm])
            for x in pts:
                if not entered:
                    if (s > 0 and 2000 * x <= 2000 * hi + 15 * sm) or (s < 0 and 2000 * x >= 2000 * lo - 15 * sm): entered = True; m_in = mm
                    else: continue
                for k in EV.KS:
                    if k in res: continue
                    up = 20 * x >= 20 * hi + k * sm; dn = 20 * x <= 20 * lo - k * sm
                    if (up if s > 0 else dn): res[k] = (1, mm - m_in)
                    elif (dn if s > 0 else up): res[k] = (-1, mm - m_in)
        for kk, k in enumerate(EV.KS):
            e = res.get(k, (0, -1)); g = (int(F[f"v{vi}_oc"][q, kk]), int(F[f"v{vi}_tm"][q, kk]))
            if e != g: fail("B", vi, q, j, k, e, g)
        nB += 1
        a = sm / 20.0; okv = j - 4 >= 0 and bs[j - 4] == bs[j] and bs[j - 1] == bs[j]
        v3 = s * (cp[j - 4] - cp[j - 1]) / a if okv else np.nan
        close = lambda x, y: (np.isnan(x) and np.isnan(y)) or abs(x - y) <= 1e-9        # (was round(.., 9): 2e-13 apart can round apart)
        if not close(v3, float(F[f"v{vi}_v3"][q])): fail("C v3", vi, q, v3, F[f"v{vi}_v3"][q])
        ws = [x for x in range(max(j - 12, 0), j) if bs[x] == bs[j]]
        lg = ((max(hp[x] for x in ws) - hi) / a if s > 0 else (lo - min(lp[x] for x in ws)) / a) if ws else np.nan
        if not close(lg, float(F[f"v{vi}_leg12"][q])): fail("C leg", vi, q, lg, F[f"v{vi}_leg12"][q])
        if abs((hi - lo) / a - F[f"v{vi}_width"][q]) > 1e-9: fail("C width", vi, q)
print(f"  B/C checked {nB} events", flush=True)

# ---------------- D instance properties ----------------
print("D instances", flush=True)
lo, hi, st, de, role = S["flip_own"]
for q in rng.choice(len(lo), 300, replace=False):
    b = st[q] - 1; p = lo[q] / EV.Q
    if not ((role[q] > 0 and cl[b] > p) or (role[q] < 0 and cl[b] < p)): fail("D flip close", q)
    if Z.dend[Z.di[b]] - 1 != de[q]: fail("D flip day", q)
for ty, bt in (("fvg_own", tf), ("ds_own", tf), ("ob_m15", 15)):
    lo, hi, st, de, role = S[ty]; Bt = X.resample(M, bt); endm = np.searchsorted(t, Bt["t_last"], "right")
    if not np.all(np.isin(st, endm)): fail("D start not at a bar end", ty)
    if not np.all(de >= st) or not np.all(hi >= lo): fail("D life/range", ty)
print("  D done", flush=True)

# ---------------- E truncation ----------------
print("E truncation", flush=True)
nd = len(Z.days)
for cut_day in ((int(nd * 0.2), int(nd * 0.45), int(nd * 0.7), nd - 3) if MKT == "real" else ()):
    T = int(t[Z.dstart[cut_day] + 333]); Mc = X.load(T); Zc = ZL.Zones(Mc); Bc = EV.obs_bars(Mc, tf); Sc, Lc = EV.instances(Zc, Mc, Bc, tf)
    nc = len(Mc["t"]); J = len(Bc["c"]) - 2                                               # bars j <= J are complete in the cut data
    for vi in (0, 3):
        var, D = EV.VARIANTS[vi]; Rc = EV.collect(Mc, Bc, Sc, Lc, tf, var, D); Fc = EV.features(Mc, Bc, Rc, tf); oc, tm, p0 = EV.outcomes(Mc, Bc, Rc, tf)
        mf = F[f"v{vi}_j"] <= J; mc = Rc["j"] <= J
        kf = set(zip(F[f"v{vi}_type"][mf], F[f"v{vi}_j"][mf], F[f"v{vi}_side"][mf])); kc = set(zip(Rc["type"][mc], Rc["j"][mc], Rc["side"][mc]))
        if kf != kc: fail("E events", cut_day, vi, len(kf - kc), len(kc - kf), sorted(kf ^ kc)[:3])
        idf = {k: i for i, k in enumerate(zip(F[f"v{vi}_type"], F[f"v{vi}_j"], F[f"v{vi}_side"]))}; nchk = 0
        for i in np.flatnonzero(mc):
            g = idf.get((Rc["type"][i], Rc["j"][i], Rc["side"][i]))
            if g is None: continue
            for nm, a_, b_ in (("lo", Rc["lo"][i], F[f"v{vi}_lo"][g]), ("hi", Rc["hi"][i], F[f"v{vi}_hi"][g]), ("prior", Rc["prior"][i], F[f"v{vi}_prior"][g]),
                               ("visit", Rc["visit"][i], F[f"v{vi}_visit"][g]), ("v3", Fc["v3"][i], F[f"v{vi}_v3"][g]), ("leg", Fc["leg12"][i], F[f"v{vi}_leg12"][g]),
                               ("today", Fc["today"][i], F[f"v{vi}_today"][g]), ("age", Fc["age"][i], F[f"v{vi}_age"][g])):
                if not eq(a_, b_): fail("E field", cut_day, vi, nm, i, a_, b_)
            m0 = st_b[Rc["j"][i]]
            if min(m0 + EV.HOR * tf, sess_end[m0] + 1) <= nc - 1:
                nchk += 1
                if not np.array_equal(oc[i], F[f"v{vi}_oc"][g]) or not np.array_equal(tm[i], F[f"v{vi}_tm"][g]): fail("E outcome", cut_day, vi, i)
            if F[f"v{vi}_xend"][g] <= J and Rc["xend"][i] != F[f"v{vi}_xend"][g]: fail("E stretch", cut_day, vi, i)
        print(f"  cut day {cut_day} v{vi}: {int(mc.sum())} events before T, same set {kf == kc}, {nchk} finished outcomes compared", flush=True)
print("RESULT", "PASS" if not bad else f"FAIL {len(bad)}")
