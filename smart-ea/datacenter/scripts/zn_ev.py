r"""Zone-entry events (steps 3-4 of the zone plan, user 2026-10-01). Library only: nothing runs on import.

Observation TF X = M1 / M3 / M5 (closed bars of adx_ctx.resample, session-aware). Unit = ATR20 of X from the 20 bars before the bar
(atr_prev, integer points: s20 = sum of 20 TR in points, 1 ATR = s20 / 20 points). Every comparison is made in integer units
q = points x 2000 (1 ATR = 100 x s20 q), so ties are exact (bugs.md 2026-09-28 / 2026-09-30 lessons).

Zone instances (all known only from their start M1 bar, alive until their last M1 bar; zn_lib.Zones builds the raw zones):
  reason group   flip_own   swing of X (zigzag 3 ATR of X) that price CLOSED beyond today -> line at the pivot, active from the bar after the
                            break to the end of that trading day (role = pivot kind: broken high = support +1)
                 fvg_own / ds_own   FVG / user's demand-supply zone of X (zn_lib ages: M1 2, M3 5, M5 20 trading days), until traded through
                 ob_m15     order block M15 (age 20 days), until closed through
                 rn50 / rn100  round numbers (multiples of 50 that are not of 100 / of 100), every trading day
                 ema_own_20 / _50 / _200   EMA of X's closes; value used at bar j = EMA at the close of bar j-1
  pass group     bb_own / kc_own   Bollinger 20 2 sigma / Keltner EMA20 +- 2 ATR10 of X (upper = role -1, lower = role +1), value of bar j-1
                 swing_big  unbroken $20 / $50 swing (zn_lib.sw), age 20 days, until closed through (role = -kind)
                 pd_hl      previous trading day high (role -1) / low (+1), during the day
Event (= one zone entry): TF-X bar j that intersects the band [lo - TOL ATR, hi + TOL ATR] while the last bar that was FAR from the zone
  (low > hi + D ATR = above, or high < lo - D ATR = below) is later than the last touching bar and in the same session. side = +1 came from
  above (price falling into the zone), -1 from below. Bars of the instance before it was known are never used. D = 1 ATR (neighbours 0.5 / 2).
  The zone/line values and ATR used at bar j are all known at the open of bar j.
Fake zones: the same instance shifted by +2 / -2 ATR of X (ATR at the first bar of the instance; lines: ATR of each bar), same life.
Outcome from the touch (step 3): on the M1 4-point path (O,L,H,C bull / O,H,L,C bear) from the first path point of bar j inside the band:
  reversal k = price back beyond the NEAR edge by k ATR (above: >= hi + k ATR), break k = beyond the FAR edge by k ATR (above: <= lo - k ATR);
  whichever first within HOR bars of X (or the session end); neither = stall. k = 1 / 2 / 3.
Stretch (step 4): the bars j, j+1, ... while the bar still intersects the band, same session, at most MAXST bars — it may continue after the
zone died (traded / closed through), new events may not.
"""
import sys
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, broker as BK, adx_ctx as X

OBS = (1, 3, 5); D_MAIN = 1.0; D_NB = (0.5, 2.0); TOL = 0.15; KS = (1, 2, 3); HOR = 48; FAKE = 2.0; MAXST = 48
REASON = ["flip_own", "fvg_own", "ds_own", "ob_m15", "rn50", "rn100", "ema_own_20", "ema_own_50", "ema_own_200"]
PASS = ["bb_own", "kc_own", "swing_big", "pd_hl"]
TYPES = REASON + PASS
LINES = {"ema_own_20", "ema_own_50", "ema_own_200", "bb_own", "kc_own"}
Q = 2000                                                       # q units per point
VARIANTS = [("real", D_MAIN), ("real", D_NB[0]), ("real", D_NB[1]), ("fake+", D_MAIN), ("fake-", D_MAIN)]

def obs_bars(M, tf):
    B = X.resample(M, tf)
    B["st"] = np.searchsorted(M["t"], B["t_open"], "left"); B["en"] = np.r_[B["st"][1:], len(M["t"])]
    for x in ("o", "h", "l", "c"): B[x + "q"] = B[x + "i"] * Q
    return B

def path_q(M):
    o, h, l, c = (np.rint(M[x] / BK.POINT).astype(np.int64) * Q for x in ("o", "h", "l", "c"))
    bull = c >= o; P = np.empty(4 * len(o), np.int64)
    P[0::4] = o; P[1::4] = np.where(bull, l, h); P[2::4] = np.where(bull, h, l); P[3::4] = c
    return P

def qp(x):
    return np.rint(np.asarray(x, float) / BK.POINT).astype(np.int64) * Q

# ------------------------------------------------------------------------------------------------------------------------------
def instances(Z, M, B, tf):
    """static instances: dict type -> (lo_q, hi_q, st_m1, de_m1, role) ; lines: dict type -> list of (lo_q float array per TF bar, hi_q, role)"""
    n1 = len(M["t"]); nd = len(Z.days); dend = Z.dend - 1; S = {}; Lns = {}
    def fin(lo, hi, st, de, role):
        st = np.asarray(st, np.int64); de = np.asarray(de, np.int64); ok = (st < n1) & (de >= st)
        return qp(lo)[ok], qp(hi)[ok], st[ok], de[ok], np.asarray(role, np.int64)[ok]
    def day_of(m): return Z.di[np.clip(m, 0, n1 - 1)]
    for nm in ("fvg", "ds"):
        R = Z.zn[f"{nm}_m{tf}"]; st = R[:, 3].astype(np.int64); age = Z.zn_age[f"{nm}_m{tf}"]
        de = np.minimum(R[:, 4].astype(np.int64), dend[np.minimum(day_of(st) + age, nd - 1)])
        S[f"{nm}_own"] = fin(R[:, 0], R[:, 1], st, de, R[:, 2])
    R = Z.zn["ob_m15"]; st = R[:, 3].astype(np.int64)
    de = np.minimum(R[:, 4].astype(np.int64), dend[np.minimum(day_of(st) + Z.zn_age["ob_m15"], nd - 1)])
    S["ob_m15"] = fin(R[:, 0], R[:, 1], st, de, R[:, 2])
    z = Z.swa[(tf, 3)]; br = z["brk"]; m = br < n1
    m &= day_of(z["conf"]) >= day_of(br) - z["age"]                                  # pivot still inside its age window when broken
    st = br[m] + 1; S["flip_own"] = fin(z["p"][m], z["p"][m], st, dend[day_of(br[m])], z["kind"][m])
    lo, st, de, ro = [], [], [], []
    for s in (20, 50):
        z = Z.sw[s]; s0 = z["conf"] + 1
        lo.append(z["p"]); st.append(s0); de.append(np.minimum(z["brk"], dend[np.minimum(day_of(z["conf"]) + ZL_MAXAGE, nd - 1)])); ro.append(-z["kind"])
    lo = np.concatenate(lo); S["swing_big"] = fin(lo, lo, np.concatenate(st), np.concatenate(de), np.concatenate(ro))
    d = np.arange(1, nd); S["pd_hl"] = fin(np.r_[Z.dH[d - 1], Z.dL[d - 1]], np.r_[Z.dH[d - 1], Z.dL[d - 1]], np.r_[Z.dstart[d], Z.dstart[d]],
                                         np.r_[dend[d], dend[d]], np.r_[-np.ones(nd - 1), np.ones(nd - 1)])
    for nm, step, keep100 in (("rn50", 50, False), ("rn100", 100, True)):
        lv, st, de = [], [], []
        for di in range(nd):
            a = np.floor((Z.dL[di] - 50) / 50) * 50; b = np.ceil((Z.dH[di] + 50) / 50) * 50
            L_ = np.arange(a, b + 1, 50.0); is100 = np.isclose(np.mod(L_, 100), 0)
            L_ = L_[is100] if keep100 else L_[~is100]
            lv.append(L_); st.append(np.full(len(L_), Z.dstart[di])); de.append(np.full(len(L_), dend[di]))
        lv = np.concatenate(lv); S[nm] = fin(lv, lv, np.concatenate(st), np.concatenate(de), np.zeros(len(lv)))
    nb = len(B["c"]); prev = lambda v: np.r_[np.nan, v[:-1]]
    for p in (20, 50, 200):
        Bl, e = Z.ma[f"ema_m{tf}_{p}"]; assert len(Bl["c"]) == nb and np.array_equal(Bl["t_open"], B["t_open"])
        v = prev(e[:, 0]) / BK.POINT * Q; Lns[f"ema_own_{p}"] = [(v, v, 0)]
    for nm in ("bb", "kc"):
        Bl, e = Z.ma[f"{nm}_m{tf}"]; up = prev(e[:, 0]) / BK.POINT * Q; dn = prev(e[:, 1]) / BK.POINT * Q
        Lns[f"{nm}_own"] = [(up, up, -1), (dn, dn, 1)]
    return S, Lns

ZL_MAXAGE = 20

# ------------------------------------------------------------------------------------------------------------------------------
def scan(Hq, Lq, s20, ses, lo, hi, D100, tol100=int(round(TOL * 100)), nev=None):
    """one instance over a contiguous range of TF bars. lo / hi scalars (int) or float arrays (lines; nan = unknown).
    Events only on the first `nev` bars (the instance's life); the arrays may run up to MAXST bars longer so that a stretch can continue
    after the zone died (bugs.md 2026-10-01: the stretch was cut at the zone's death bar).
    Returns local event indices, side (+1 from above / -1 from below), prior-touch flag, stretch end (exclusive)."""
    n = len(Hq); idx = np.arange(n); ok = s20 > 0
    with np.errstate(invalid="ignore"):
        fa = ok & (Lq > hi + D100 * s20); fb = ok & (Hq < lo - D100 * s20)
        tch = ok & (Lq <= hi + tol100 * s20) & (Hq >= lo - tol100 * s20)
    newses = np.r_[True, ses[1:] != ses[:-1]]; sstart = np.maximum.accumulate(np.where(newses, idx, 0))
    lfa = np.maximum.accumulate(np.where(fa, idx, -1)); lfb = np.maximum.accumulate(np.where(fb, idx, -1)); lf = np.maximum(lfa, lfb)
    lt = np.maximum.accumulate(np.where(tch, idx, -1)); ltp = np.r_[-1, lt[:-1]]
    ev = np.flatnonzero(tch & (lf >= sstart) & (lf > ltp))
    if nev is not None: ev = ev[ev < nev]
    if not len(ev): return ev, ev, ev, ev
    side = np.where(lfa[ev] > lfb[ev], 1, -1); prior = ltp[ev] >= 0
    stop = np.flatnonzero((~tch) | newses); k = np.searchsorted(stop, ev, "right")
    xend = np.where(k < len(stop), stop[np.minimum(k, len(stop) - 1)], n); xend = np.minimum(xend, ev + MAXST)
    return ev, side, prior, xend

def collect(M, B, S, Lns, tf, variant, D):
    """all events of every type for one variant. Returns dict of arrays (one row per event) + stretch rows."""
    D100 = int(round(D * 100)); Hq, Lq, s20, ses, st_b = B["hq"], B["lq"], B["s20p"], B["sid"], B["st"]
    sh = {"real": 0, "fake+": 200, "fake-": -200}[variant]
    rows = {k: [] for k in ("type", "inst", "j", "side", "role", "prior", "visit", "lo", "hi", "xend", "zst")}
    for ti, ty in enumerate(TYPES):
        if ty in Lns:
            for li, (lo, hi, role) in enumerate(Lns[ty]):
                off = sh * s20.astype(float); off = np.where(s20 > 0, off, np.nan)
                lo2, hi2 = lo + off, hi + off
                ev, side, prior, xend = scan(Hq, Lq, s20, ses, lo2, hi2, D100)
                if not len(ev): continue
                vis = np.zeros(len(ev), np.int64)                                     # lines: count of entries earlier in the same session
                sess_ev = ses[ev]; first = np.r_[True, sess_ev[1:] != sess_ev[:-1]]; grp = np.cumsum(first) - 1
                vis = np.arange(len(ev)) - np.flatnonzero(first)[grp]
                for k, v in (("type", np.full(len(ev), ti)), ("inst", np.full(len(ev), li)), ("j", ev), ("side", side), ("role", np.full(len(ev), role)),
                             ("prior", vis > 0), ("visit", vis), ("lo", lo2[ev]), ("hi", hi2[ev]), ("xend", xend), ("zst", st_b[ev])):
                    rows[k].append(np.asarray(v))
            continue
        lo, hi, st, de, role = S[ty]
        jb = np.searchsorted(st_b, st, "left"); je = np.searchsorted(st_b, de, "right") - 1
        for q in np.flatnonzero(je > jb):
            a, b = jb[q], je[q] + 1; b2 = min(b + MAXST, len(Hq))
            if sh:
                if s20[a] <= 0: continue
                o_ = sh * int(s20[a]); l_, h_ = lo[q] + o_, hi[q] + o_
            else: l_, h_ = lo[q], hi[q]
            ev, side, prior, xend = scan(Hq[a:b2], Lq[a:b2], s20[a:b2], ses[a:b2], l_, h_, D100, nev=b - a)
            if not len(ev): continue
            ne = len(ev)
            for k, v in (("type", np.full(ne, ti)), ("inst", np.full(ne, q)), ("j", a + ev), ("side", side), ("role", np.full(ne, role[q])),
                         ("prior", prior), ("visit", np.arange(ne)), ("lo", np.full(ne, l_, float)), ("hi", np.full(ne, h_, float)),
                         ("xend", a + xend), ("zst", np.full(ne, st[q]))):
                rows[k].append(np.asarray(v))
    R = {k: (np.concatenate(v) if v else np.zeros(0)) for k, v in rows.items()}
    for k in ("type", "inst", "j", "side", "role", "visit", "xend", "zst"): R[k] = R[k].astype(np.int64)
    R["prior"] = R["prior"].astype(bool)
    o = np.lexsort((R["inst"], R["type"], R["j"])); R = {k: v[o] for k, v in R.items()}
    # several instances of one type can be entered on the same bar from the same side (overlapping zones): keep one event per
    # (type, bar, side) = the earliest-created instance (lowest inst within the sort), the others are counted in `dup`
    key = (R["j"] * len(TYPES) + R["type"]) * 2 + (R["side"] > 0)
    u, first, cnt = np.unique(key, return_index=True, return_counts=True)
    R = {k: v[first] for k, v in R.items()}; R["dup"] = cnt - 1
    return R

# ------------------------------------------------------------------------------------------------------------------------------
def features(M, B, R, tf):
    """approach features known at the open of the touch bar j: v3 = move toward the zone over the 3 bars before (ATR), leg12 = how far price
    was from the near edge at its extreme of the 12 bars before (ATR), width (ATR), age (min), today (zone start in the event's trading day)"""
    j = R["j"]; s = R["side"]; s20 = B["s20p"][j].astype(float); a = s20 * 100.0; ses = B["sid"]; cq = B["cq"]; hq = B["hq"]; lq = B["lq"]
    j4 = j - 4; okv = (j4 >= 0) & (ses[np.maximum(j4, 0)] == ses[j]) & (ses[np.maximum(j - 1, 0)] == ses[j])
    v3 = np.where(okv, s * (cq[np.maximum(j4, 0)] - cq[np.maximum(j - 1, 0)]) / a, np.nan)
    leg = np.full(len(j), np.nan)
    for q in range(len(j)):
        jj = j[q]; a0 = max(jj - 12, 0)
        w = np.flatnonzero(ses[a0:jj] == ses[jj])
        if not len(w): continue
        w = a0 + w
        leg[q] = (hq[w].max() - R["hi"][q]) / a[q] if s[q] > 0 else (R["lo"][q] - lq[w].min()) / a[q]
    width = (R["hi"] - R["lo"]) / a
    t = M["t"]; age = (B["t_open"][j] - t[np.clip(R["zst"], 0, len(t) - 1)]) / 60.0
    today = M["day"][np.clip(R["zst"], 0, len(t) - 1)] == B["day"][j]
    return dict(v3=v3, leg12=leg, width=width, age=age, today=today)

def outcomes(M, B, R, tf, P=None, sess_end=None):
    """step-3 outcome per event and k: +1 reversal / -1 break / 0 stall, and the M1 bars from the touch to it (-1 for stall)"""
    if P is None: P = path_q(M)
    if sess_end is None:
        sid = M["sid"]; send = np.r_[np.flatnonzero(np.diff(sid)), len(sid) - 1]; sess_end = send[np.searchsorted(send, np.arange(len(sid)))]
    tol100 = int(round(TOL * 100)); ne = len(R["j"]); K = len(KS)
    oc = np.zeros((ne, K), np.int8); tm = np.full((ne, K), -1, np.int32); p0 = np.full(ne, -1, np.int64)
    st_b = B["st"]; s20 = B["s20p"]
    for q in range(ne):
        j = R["j"][q]; m0 = st_b[j]; me = min(m0 + HOR * tf, sess_end[m0] + 1)
        seg = P[4 * m0: 4 * me]; a = int(s20[j]); s = R["side"][q]; lo = R["lo"][q]; hi = R["hi"][q]
        inb = np.flatnonzero(seg <= hi + tol100 * a) if s > 0 else np.flatnonzero(seg >= lo - tol100 * a)
        if not len(inb): continue                                             # cannot happen for a touching bar (kept as a guard)
        i0 = inb[0]; p0[q] = 4 * m0 + i0; x = seg[i0:]
        for kk, k in enumerate(KS):
            if s > 0: r = np.flatnonzero(x >= hi + k * 100 * a); b = np.flatnonzero(x <= lo - k * 100 * a)
            else: r = np.flatnonzero(x <= lo - k * 100 * a); b = np.flatnonzero(x >= hi + k * 100 * a)
            ri = r[0] if len(r) else 1 << 40; bi = b[0] if len(b) else 1 << 40
            if ri < bi: oc[q, kk] = 1; tm[q, kk] = (i0 + ri) // 4 - i0 // 4
            elif bi < ri: oc[q, kk] = -1; tm[q, kk] = (i0 + bi) // 4 - i0 // 4
    return oc, tm, p0
