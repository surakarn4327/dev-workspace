r"""Independent checks of step 4 (zn_bh.py), real market:
A  labels: plain per-row code from raw bar prices (no orientation trick: written separately for side +1 and side -1) for random rows of
   every variant; unnamed codes from cat-style thresholds
B  after-bar results: walk the M1 4-point path from the entry (open of the first M1 bar after the bar) to the forced exit (16:00 UTC /
   session end) for hit1 / hit2 / t_up1 / t_dn1 / mfe24 / mae24 and the SL1 TP2R and SL2 TPnone cells (cost $0.31)
C  rows: every stretch bar with a po row is present exactly once per event
D  no future data: labels rebuilt from data cut at T equal the full-data labels of rows whose bar closed before T
usage: zn_bh_check.py <tf>"""
import sys, os
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, po_lib as PO, zn_lib as ZL, zn_ev as EV, zn_bh as BH, adx_ctx as X, broker as BK
tf = int(sys.argv[1]); OUT = r"C:\trade datacenter\zn"; rng = np.random.default_rng(11 + tf); bad = []
def fail(*a): bad.append(a); print("  FAIL", *a, flush=True)
M = PO.load_market("real"); Z = ZL.Zones(M); B = EV.obs_bars(M, tf); S, Lns = EV.instances(Z, M, B, tf)
E = dict(np.load(os.path.join(OUT, f"zn_ev_m{tf}_real.npz"))); H = dict(np.load(os.path.join(OUT, f"zn_bh_m{tf}_real.npz")))
P = lambda x: np.rint(B[x] / BK.POINT).astype(np.int64)
o, h, l, c = P("o"), P("h"), P("l"), P("c"); s20 = B["s20p"]; tv = B["tv"].astype(float); sid = B["sid"]

def zone_at(vi, e, b):
    var, D = EV.VARIANTS[vi]; sh = {"real": 0.0, "fake+": 2.0, "fake-": -2.0}[var]; ty = EV.TYPES[E[f"v{vi}_type"][e]]
    if ty in Lns:
        L_, H_, _ = Lns[ty][E[f"v{vi}_inst"][e]]; return L_[b] / EV.Q + sh * s20[b] / 20, H_[b] / EV.Q + sh * s20[b] / 20
    return E[f"v{vi}_lo"][e] / EV.Q, E[f"v{vi}_hi"][e] / EV.Q

from fractions import Fraction as Fr
def code(i, up):
    r = int(h[i] - l[i]); s = int(s20[i])
    if not (s > 0 and r > 0): return -1
    ra = Fr(20 * r, s); sz = 0 if ra < Fr(1, 2) else (1 if ra < 1 else (2 if ra < 2 else 3))     # exact fractions
    bb = Fr(int(abs(c[i] - o[i])), r); bd = 0 if bb < Fr(3, 10) else (1 if bb < Fr(7, 10) else 2)
    cpos = Fr(int(c[i] - l[i]), r); p = 0 if cpos < Fr(1, 3) else (1 if cpos < Fr(2, 3) else 2)
    return sz * 9 + bd * 3 + (p if up else 2 - p)                      # mirror image = close position flipped (lib definition)

print(f"A labels M{tf}", flush=True); nA = 0
for vi in range(len(EV.VARIANTS)):
    n = len(H[f"v{vi}_b"])
    for q in rng.choice(n, 1500, replace=False):
        e = H[f"v{vi}_ev"][q]; b = int(H[f"v{vi}_b"][q]); pos = int(H[f"v{vi}_pos"][q]); s = int(E[f"v{vi}_side"][e]); lo, hi = zone_at(vi, e, b)
        a = s20[b] / 20.0; r = h[b] - l[b]; body = (c[b] - o[b]) * s; pb = b - 1
        if s > 0: lw = min(o[b], c[b]) - l[b]; uw = h[b] - max(o[b], c[b]); far, near = lo, hi; beyond = c[b] < far; swept = l[b] < far and c[b] > far; out_ = c[b] > near
        else: lw = h[b] - max(o[b], c[b]); uw = min(o[b], c[b]) - l[b]; far, near = hi, lo; beyond = c[b] > far; swept = h[b] > far and c[b] < far; out_ = c[b] < near
        pbody = (c[pb] - o[pb]) * s
        if s > 0: eng_r = body > 0 and pbody < 0 and c[b] >= o[pb] and o[b] <= c[pb]; eng_b = body < 0 and pbody > 0 and c[b] <= o[pb] and o[b] >= c[pb]
        else: eng_r = body > 0 and pbody < 0 and c[b] <= o[pb] and o[b] >= c[pb]; eng_b = body < 0 and pbody > 0 and c[b] >= o[pb] and o[b] <= c[pb]
        prevbeyond = (c[pb] < far) if s > 0 else (c[pb] > far)
        j0 = b - pos; rg3 = sum(h[j0 - k] - l[j0 - k] for k in (1, 2, 3)) / 3
        m20 = tv[b - 20:b].mean() if b >= 20 else np.nan
        exp = dict(any=True, rej_pin=r >= a and abs(body) <= 0.3 * r and lw >= 0.6 * r, against_pin=r >= a and abs(body) <= 0.3 * r and uw >= 0.6 * r,
                   wick_half=r > 0 and lw >= 0.5 * r, engulf_rev=eng_r and body >= 0.5 * a, engulf_brk=eng_b and -body >= 0.5 * a, sweep_ret=swept,
                   close_through=beyond, hold_through=beyond and pos > 0 and prevbeyond, close_out=out_, inside=h[b] < h[pb] and l[b] > l[pb],
                   small=r < 0.5 * a, decel=r < 0.5 * rg3, vspike=tv[b] >= 3 * m20 if np.isfinite(m20) else False,
                   big_rev=r >= 2 * a and body >= 0.5 * r, big_brk=r >= 2 * a and -body >= 0.5 * r, bull=body > 0, bear=body < 0)
        got = int(H[f"v{vi}_bits"][q])
        for k, v in exp.items():
            if bool(got & BH.BIT[k]) != bool(v): fail("A", vi, q, b, k, bool(got & BH.BIT[k]), v)
        k1 = code(b, s > 0); k0 = code(pb, s > 0); k2 = k0 * 36 + k1 if (sid[pb] == sid[b] and k0 >= 0 and k1 >= 0) else -1
        if (k1, k2) != (int(H[f"v{vi}_k1"][q]), int(H[f"v{vi}_k2"][q])): fail("A code", vi, q, (k1, k2), (H[f"v{vi}_k1"][q], H[f"v{vi}_k2"][q]))
        nA += 1
print(f"  A checked {nA} rows", flush=True)

print("B after-bar results", flush=True)
t = M["t"]; mo, mh, ml, mc = (np.rint(M[x] / BK.POINT).astype(np.int64) for x in ("o", "h", "l", "c")); msid = M["sid"]; ties = [0]
for vi in (0, 3):
    n = len(H[f"v{vi}_b"])
    for q in rng.choice(n, 800, replace=False):
        e = H[f"v{vi}_ev"][q]; b = int(H[f"v{vi}_b"][q]); s = int(E[f"v{vi}_side"][e]); s20b = int(s20[b])
        m0 = B["en"][b]; dec = t[m0]; cut = (dec // 86400) * 86400 + 16 * 3600
        if cut <= dec: cut += 86400
        me = m0
        while me + 1 < len(t) and t[me + 1] < cut and msid[me + 1] == msid[m0]: me += 1
        ent = mo[m0]
        for nm, sg in (("rev", s), ("brk", -s)):
            pts = []
            for mm in range(m0, me + 1):
                seq = (mo[mm], ml[mm], mh[mm], mc[mm]) if mc[mm] >= mo[mm] else (mo[mm], mh[mm], ml[mm], mc[mm])
                pts += [(mm, i_, x) for i_, x in enumerate(seq)]
            mv = [(sg * (x - ent) * 20) for _, _, x in pts]                              # 20 x points; 1 ATR = s20b
            first = lambda f: next((k for k, v in enumerate(mv) if f(v)), None)
            for kk, lv in ((1, 1), (2, 2)):
                u = first(lambda v: v >= lv * s20b); d = first(lambda v: v <= -lv * s20b)
                hexp = np.nan if u is None and d is None else (1.0 if d is None or (u is not None and u < d) else 0.0)
                g = float(H[f"v{vi}_{nm}_hit{kk}"][q])
                if not ((np.isnan(hexp) and np.isnan(g)) or hexp == g): fail("B hit", vi, q, nm, kk, hexp, g)
            u = first(lambda v: v >= s20b); d = first(lambda v: v <= -s20b)
            if (u // 4 if u is not None else -1) != H[f"v{vi}_{nm}_t_up1"][q] or (d // 4 if d is not None else -1) != H[f"v{vi}_{nm}_t_dn1"][q]: fail("B time", vi, q, nm)
            lim = 4 * tf * 24; w = mv[:lim]
            best = max(w) / s20b; worst = -min(w) / s20b
            mf = max([x for x in PO.LV if x <= best + 1e-12], default=0.0); ma = max([x for x in PO.LV if x <= worst + 1e-12], default=0.0)
            # po_lib finds levels on float (price - entry) / ATR: a move of EXACTLY a level can come out a hair short (known po tie,
            # bugs.md 2026-10-01) -> accept the level below only when the exact move sits on a level
            def okm(x, lvl, g): return abs(lvl - g) < 1e-6 or (abs(x - lvl) < 1e-9 and abs(g - PO.LV[max(np.searchsorted(PO.LV, lvl) - 1, 0)]) < 1e-6)
            if not okm(best, mf, H[f"v{vi}_{nm}_mfe24"][q]) or not okm(worst, ma, H[f"v{vi}_{nm}_mae24"][q]): fail("B mfe", vi, q, nm, mf, H[f"v{vi}_{nm}_mfe24"][q], ma, H[f"v{vi}_{nm}_mae24"][q])
            ties[0] += int(abs(best - mf) < 1e-9 and abs(mf - H[f"v{vi}_{nm}_mfe24"][q]) > 1e-6) + int(abs(worst - ma) < 1e-9 and abs(ma - H[f"v{vi}_{nm}_mae24"][q]) > 1e-6)
            A = s20b / 20 * BK.POINT
            for cell, sl, tp in (("SL1_TP2R", 1, 2), ("SL2_TPnone", 2, None)):
                res = None
                for k, (mm, i_, x) in enumerate(pts):
                    v = mv[k]
                    if v <= -sl * s20b: res = (sg * (x - ent) * BK.POINT if i_ == 0 else -sl * A); break
                    if tp is not None and v >= sl * tp * s20b: res = (sg * (x - ent) * BK.POINT if i_ == 0 else sl * tp * A); break
                if res is None: res = sg * (mc[me] - ent) * BK.POINT
                rr = res / (sl * A) - PO.COST / (sl * A)
                g = float(H[f"v{vi}_{nm}_{cell}"][q])
                if abs(rr - g) > 1e-4: fail("B R", vi, q, nm, cell, rr, g)
print(f"  B done (po exact-level ties accepted: {ties[0]})", flush=True)

print("C rows", flush=True)
fz = np.load(os.path.join(PO.OUTD, f"po_m{tf}_real.npz")); inpo = np.zeros(len(B["c"]), bool); inpo[fz["b"]] = True
for vi in range(len(EV.VARIANTS)):
    j, xe = E[f"v{vi}_j"], E[f"v{vi}_xend"]; exp = int(sum(inpo[a:z].sum() for a, z in zip(j, xe)))
    if exp != len(H[f"v{vi}_b"]): fail("C count", vi, exp, len(H[f"v{vi}_b"]))
    k = H[f"v{vi}_ev"].astype(np.int64) * 10 ** 7 + H[f"v{vi}_b"]
    if len(np.unique(k)) != len(k): fail("C dup", vi)
    if not np.all((H[f"v{vi}_b"] >= j[H[f"v{vi}_ev"]]) & (H[f"v{vi}_b"] < xe[H[f"v{vi}_ev"]])): fail("C range", vi)
print("  C done", flush=True)

print("D truncation (labels)", flush=True)
nd = len(Z.days)
for cut_day in (int(nd * 0.4), nd - 3):
    T = int(M["t"][Z.dstart[cut_day] + 333]); Mc = X.load(T); Zc = ZL.Zones(Mc); Bc = EV.obs_bars(Mc, tf); Sc, Lc = EV.instances(Zc, Mc, Bc, tf)
    J = len(Bc["c"]) - 2
    for vi in (0, 3):
        var, D = EV.VARIANTS[vi]; Rc = EV.collect(Mc, Bc, Sc, Lc, tf, var, D); Ec = {f"v{vi}_{k}": v for k, v in Rc.items()}
        ev, b, pos = BH.stretch_rows(Ec, vi); keep = b <= J; ev, b, pos = ev[keep], b[keep], pos[keep]
        bits, k1, k2, d = BH.label_rows(Bc, Ec, vi, Lc, ev, b, pos)
        kc = {(Rc["type"][e], Rc["j"][e], Rc["side"][e], bb): (bt, a1, a2) for e, bb, bt, a1, a2 in zip(ev, b, bits, k1, k2)}
        ef = H[f"v{vi}_ev"]; bf = H[f"v{vi}_b"]; nchk = 0
        for q in np.flatnonzero(bf <= J - EV.MAXST):
            e = ef[q]; key = (E[f"v{vi}_type"][e], E[f"v{vi}_j"][e], E[f"v{vi}_side"][e], bf[q])
            if E[f"v{vi}_xend"][e] > J: continue
            g = kc.get(key)
            if g is None: fail("D missing", cut_day, vi, key); continue
            nchk += 1
            if (int(g[0]), int(g[1]), int(g[2])) != (int(H[f"v{vi}_bits"][q]), int(H[f"v{vi}_k1"][q]), int(H[f"v{vi}_k2"][q])): fail("D labels", cut_day, vi, key)
        print(f"  cut day {cut_day} v{vi}: {nchk} rows compared", flush=True)
print("RESULT", "PASS" if not bad else f"FAIL {len(bad)}")
