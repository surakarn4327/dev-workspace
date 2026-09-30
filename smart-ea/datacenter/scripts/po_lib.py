r"""Pattern-outcome library (user 2026-09-30): for EVERY bar of a TF, what does price do afterwards, in units of that TF's ATR, so
that the outcome of any pattern x direction x SL x TP x management rule can be read from one table. Pilot = M5.
Data = all clean data (2024-04-15 .. latest); user decided there is no exam hold-out any more (they walk-forward themselves).

Per bar b (a candidate entry after the bar closed):
  entry     = open of the first M1 bar at/after the bar end (= dec_t of hold_lib.tf_events, the same timing as the EA)  e (bid)
  allowed   = decision time in the EA trading window: UTC hour < 16 (cutoff) or >= 21 (new session, 23:00 server) and same session
  exit_end  = forced exit at the close of the last M1 bar before the next 16:00 UTC cutoff (or before the session ends, whichever first)
  unit      = A = ATR20 of the TF from the 20 bars BEFORE b (B["atr_prev"], known at the close of b), in $
  path      = 4 points per M1 bar: O, L, H, C (bull bar, c >= o) or O, H, L, C (bear bar) = the adx_lib / MT5-verified ordering
  up_t[k]   = first path point where price >= e + LV[k] * A   (-1 = never before exit_end);  dn_t[k] same downwards
  up_g[k]   = extra move beyond the level at that point when it is an OPEN point (gap: fill at the open, not at the level), else 0
  fin       = (close at exit_end - e) / A ;  chk[N] = move at the close N TF bars after entry (nan if past exit_end), chk_i = its point
  bk_up[a]  = first point AFTER up_t[a] where price <= e (return to entry = break-even stop hit), bk_dn[a] mirror  (-1 = never)
  tr_b[d] / tr_s[d] = result (in ATR, before cost) of a pure trailing stop at distance d from the best price, initial stop d, no TP
  struct    = stop behind the bar's own wick: BUY e - (low_b - 0.1 A), SELL (high_b + 0.1 A) - e ; its first passage + TPs at RR x it
Costs are NOT in the table: a trade pays COST_STD = $0.31 per round trip (same standard cost as the AdxEma library), R = result / SL - 0.31 / (SL$).
"""
import sys, os, calendar, datetime, time
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np
import broker as BK, adx_ctx as X, hold_lib as H

LIB_FROM = calendar.timegm(datetime.datetime(2024, 4, 15).timetuple())
COST = 0.31
LV = np.r_[np.arange(0.25, 12.01, 0.25), [14, 16, 18, 20, 24]]            # first-passage levels (ATR)
BE_LV = np.array([0.5, 1.0, 1.5, 2.0, 3.0])
TR_D = np.array([1.0, 1.5, 2.0, 3.0])
CHK_N = np.array([3, 6, 12, 24, 48])
RR = np.array([0.5, 1, 1.5, 2, 3, 4, 6])
OUTD = r"C:\trade datacenter\po"

def load_market(mkt):
    """real market or a random-direction market 'sfN' (every M1 bar mirrored with prob 1/2, cat_struct.signflip_m1, same as phase 3)"""
    M = X.load(None)
    if mkt != "real":
        from cat_struct import signflip_m1
        seed = int(mkt[2:])
        O, Hh, Lo, C, TV = signflip_m1(M["o"], M["h"], M["l"], M["c"], M["tv"], M["sid"], seed)
        off = max(np.mean(M["c"]) - np.mean(C), 500.0 - Lo.min())
        rnd = lambda x: np.round((x + off) / BK.POINT) * BK.POINT
        M = dict(M, o=rnd(O), h=rnd(Hh), l=rnd(Lo), c=rnd(C), tv=TV)
    return M

def first_ge(cm, x):
    i = np.searchsorted(cm, x, "left")
    return np.where(i < len(cm), i, -1)

def build(M, tf=5, limit=None, verbose=True):
    t0 = time.time()
    E = H.tf_events(M, tf); B = E["B"]; n = len(B["c"])
    t = M["t"]; o, h, l, c = M["o"], M["h"], M["l"], M["c"]
    bull = c >= o
    P = np.empty(4 * len(t)); P[0::4] = o; P[1::4] = np.where(bull, l, h); P[2::4] = np.where(bull, h, l); P[3::4] = c
    isopen = np.zeros(4 * len(t), bool); isopen[0::4] = True
    sid = M["sid"]; send = np.r_[np.flatnonzero(np.diff(sid)), len(t) - 1]; sess_end = send[np.searchsorted(send, np.arange(len(t)))]
    dec = E["dec_t"]; A = B["atr_prev"]
    hr = (dec // 3600) % 24
    j0 = np.searchsorted(t, dec, "left")
    ok = (dec >= LIB_FROM) & (dec > 0) & np.isfinite(A) & (A > 0) & ((hr < 16) | (hr >= 21))
    ok &= j0 < len(t)
    ok[ok] &= sid[j0[ok]] == B["sid"][ok]
    idx = np.flatnonzero(ok)
    if limit is not None: idx = idx[:limit]
    m = len(idx); K = len(LV)
    R = dict(b=idx, dec_t=dec[idx], day=B["day"][idx], atr=A[idx], flags=E["flags"][idx],
             **{f"dir_{k}": v[idx] for k, v in E["dirs"].items()},
             entry=np.zeros(m), n_pts=np.zeros(m, np.int32), fin=np.zeros(m),
             up_t=np.full((m, K), -1, np.int32), dn_t=np.full((m, K), -1, np.int32),
             up_g=np.zeros((m, K)), dn_g=np.zeros((m, K)),
             chk=np.full((m, len(CHK_N)), np.nan), chk_i=np.full((m, len(CHK_N)), -1, np.int32),
             bk_up=np.full((m, len(BE_LV)), -1, np.int32), bk_dn=np.full((m, len(BE_LV)), -1, np.int32),
             bk_up_v=np.zeros((m, len(BE_LV))), bk_dn_v=np.zeros((m, len(BE_LV))),
             tr_b=np.zeros((m, len(TR_D))), tr_s=np.zeros((m, len(TR_D))),
             s_b=np.zeros(m), s_s=np.zeros(m),
             sb_t=np.full(m, -1, np.int32), ss_t=np.full(m, -1, np.int32), sb_g=np.zeros(m), ss_g=np.zeros(m),
             sbT_t=np.full((m, len(RR)), -1, np.int32), ssT_t=np.full((m, len(RR)), -1, np.int32))
    lvidx = {a: int(np.flatnonzero(np.isclose(LV, a))[0]) for a in BE_LV}
    for q, bi in enumerate(idx):
        j = j0[bi]; a = A[bi]; e = o[j]
        cut = (dec[bi] // 86400) * 86400 + 16 * 3600
        if cut <= dec[bi]: cut += 86400
        je = min(np.searchsorted(t, cut, "left") - 1, sess_end[j])
        seg = (P[4 * j: 4 * (je + 1)] - e) / a; op = isopen[4 * j: 4 * (je + 1)]
        cu = np.maximum.accumulate(seg); cd = np.maximum.accumulate(-seg)
        R["entry"][q] = e; R["n_pts"][q] = len(seg); R["fin"][q] = seg[-1]
        ut = first_ge(cu, LV); dt_ = first_ge(cd, LV)
        R["up_t"][q] = ut; R["dn_t"][q] = dt_
        g = ut >= 0; R["up_g"][q, g] = np.where(op[ut[g]], seg[ut[g]] - LV[g], 0)
        g = dt_ >= 0; R["dn_g"][q, g] = np.where(op[dt_[g]], -seg[dt_[g]] - LV[g], 0)
        ci = 4 * tf * CHK_N - 1; v = ci < len(seg)
        R["chk"][q, v] = seg[ci[v]]; R["chk_i"][q, v] = ci[v]
        for kk, lv in enumerate(BE_LV):
            k = lvidx[lv]
            if ut[k] >= 0:
                w = np.flatnonzero(seg[ut[k] + 1:] <= 0)
                if len(w):
                    p = ut[k] + 1 + w[0]; R["bk_up"][q, kk] = p; R["bk_up_v"][q, kk] = seg[p] if op[p] else 0.0
            if dt_[k] >= 0:
                w = np.flatnonzero(seg[dt_[k] + 1:] >= 0)
                if len(w):
                    p = dt_[k] + 1 + w[0]; R["bk_dn"][q, kk] = p; R["bk_dn_v"][q, kk] = -seg[p] if op[p] else 0.0
        for kk, d in enumerate(TR_D):
            w = np.flatnonzero(cu - seg >= d)                                  # BUY: drawdown from the best price >= d
            R["tr_b"][q, kk] = (seg[w[0]] if op[w[0]] else cu[w[0]] - d) if len(w) else seg[-1]
            w = np.flatnonzero(cd + seg >= d)                                  # SELL mirror
            R["tr_s"][q, kk] = (-seg[w[0]] if op[w[0]] else cd[w[0]] - d) if len(w) else -seg[-1]
        sb = (e - B["l"][bi]) / a + 0.1; ss = (B["h"][bi] - e) / a + 0.1
        R["s_b"][q] = sb; R["s_s"][q] = ss
        if sb > 0:
            i = first_ge(cd, np.array([sb]))[0]; R["sb_t"][q] = i
            if i >= 0 and op[i]: R["sb_g"][q] = -seg[i] - sb
            R["sbT_t"][q] = first_ge(cu, RR * sb)
        if ss > 0:
            i = first_ge(cu, np.array([ss]))[0]; R["ss_t"][q] = i
            if i >= 0 and op[i]: R["ss_g"][q] = seg[i] - ss
            R["ssT_t"][q] = first_ge(cd, RR * ss)
        if verbose and q % 20000 == 0: print(f"  {q}/{m} {time.time() - t0:.0f}s", flush=True)
    return R, E

# ---------------------------------------------------------------------------------------------------------------------------
def trade_R(R, rows, side, s_k, tp, be=None, cost=COST):
    """R per trade after cost. side +1 BUY / -1 SELL; s_k = SL level index in LV; tp = TP level index in LV or None (no TP, exit at
    cutoff); be = index in BE_LV (move SL to entry once +BE_LV reached) or None. Fills: at the level, or at the open when gapped."""
    U, D = (R["up_t"], R["dn_t"]) if side > 0 else (R["dn_t"], R["up_t"])
    UG, DG = (R["up_g"], R["dn_g"]) if side > 0 else (R["dn_g"], R["up_g"])
    fin = side * R["fin"][rows]; s = LV[s_k]
    tS = D[rows, s_k].astype(np.int64); tS = np.where(tS < 0, 1 << 40, tS)
    if tp is None: tT = np.full(len(rows), 1 << 40)
    else: tT = U[rows, tp].astype(np.int64); tT = np.where(tT < 0, 1 << 40, tT)
    out = fin.copy()
    if be is not None:
        k = int(np.flatnonzero(np.isclose(LV, BE_LV[be]))[0]); tA = U[rows, k].astype(np.int64); tA = np.where(tA < 0, 1 << 40, tA)
        BK_ = (R["bk_up"] if side > 0 else R["bk_dn"])[rows, be].astype(np.int64); BK_ = np.where(BK_ < 0, 1 << 40, BK_)
        BKV = (R["bk_up_v"] if side > 0 else R["bk_dn_v"])[rows, be]            # fill of the break-even stop (open when gapped)
        armed = (tA < tS) & (tA < tT)                      # break-even armed before SL / TP
        tS = np.where(armed, 1 << 40, tS)                  # the original SL can no longer be hit
        tB = np.where(armed, BK_, 1 << 40)
    else: tB = np.full(len(rows), 1 << 40); BKV = np.zeros(len(rows))
    first = np.minimum(np.minimum(tS, tT), tB)
    NEVER = 1 << 40                                        # nothing hit -> exit at the cutoff close (bugs.md 2026-09-30)
    out = np.where((first == tS) & (tS < NEVER), -s - DG[rows, s_k], out)
    if tp is not None: out = np.where((first == tT) & (tT < 1 << 40), LV[tp] + UG[rows, tp], out)
    out = np.where((first == tB) & (tB < 1 << 40), BKV, out)
    return out / s - cost / (s * R["atr"][rows])

def trade_R_struct(R, rows, side, rr_k, cost=COST):
    """R per trade with the stop behind the event bar's own wick (+0.1 ATR) and TP = RR[rr_k] x that stop. None where the stop
    would be on the wrong side of the entry (s <= 0)."""
    s = (R["s_b"] if side > 0 else R["s_s"])[rows]
    tS = (R["sb_t"] if side > 0 else R["ss_t"])[rows].astype(np.int64); gS = (R["sb_g"] if side > 0 else R["ss_g"])[rows]
    tT = (R["sbT_t"] if side > 0 else R["ssT_t"])[rows, rr_k].astype(np.int64)
    NEVER = 1 << 40; tS = np.where(tS < 0, NEVER, tS); tT = np.where(tT < 0, NEVER, tT)
    out = side * R["fin"][rows]
    out = np.where((tS < tT) & (tS < NEVER), -s - gS, out)
    out = np.where((tT < tS) & (tT < NEVER), RR[rr_k] * s, out)        # TP gap not stored for the struct TP: fill at the level
    with np.errstate(divide="ignore", invalid="ignore"):
        r = out / s - cost / (s * R["atr"][rows])
    return np.where(s > 0, r, np.nan)
