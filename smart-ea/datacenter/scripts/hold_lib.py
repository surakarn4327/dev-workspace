r"""Phase 3B-a (smart-ea): library of decision points WHILE a trade is open + the outcome of 4 alternatives vs "hold as planned".
Shared code of hold_build.py (writer), hold_check.py (independent checks) and the time-travel test. Descriptive only: nothing here
picks rules or parameters (that is phase 3B-b/c and 4).

Decisions agreed with the user 2026-09-29:
- every trade of the sandbox (entries 2024-04-15 .., trading day < 2026-06-01), all 432 sets on M1/M3/M5. Identical trades of different
  sets (same TF, exit mode, entry time, direction and levels; they differ only by the MinADX / DI-gap filter) are simulated once
  ("unique trade", table utrades) and mapped back to every (set_id, n) in table set_map.
- decision point = a bar of the trade's OWN TF that closed while the trade is open; the decision is taken at the first tick after
  that close (open of the next M1 bar, the same moment an entry is taken). One row per (unique trade, bar) with a bitmask of the
  events of that bar; bars without any event and not on the time checkpoint are not stored.
- events (definitions = the phase-2 ctx / catalog ones, every threshold in integer price points):
    footprints: big bar (range >= 2 ATR of the 20 bars before it), pinbar (range >= 1 ATR, wick >= 60 %, body <= 30 %),
                tick-volume spike (>= 3 x the mean of the previous ~1 day of TF bars), inside bar (same session)
    structure (zigzag 3 ATR): new pivot confirmed, regime label changed (or became known), close out of a sideway box
                (>= 20 bars within 4 ATR, same session, box = the run ending at the previous bar)
    levels (close of the TF bar): first close above yesterday's high / below yesterday's low of the day,
                new high / low of the day after the old one stood >= 60 min, first close above / below the Asia range
                (17:00-02:59 New York) once Asia is over
    time checkpoint: every CHECK_N bars of the trade's TF counted from the entry bar (comparison baseline)
- alternatives from the decision tick (walked with the same tick order / fill rules as adx_lib.walk_exit, verified with MT5):
    plan  = keep the broker levels (must equal trades.r_std exactly: the identity check)
    cut   = close what is left at the decision tick (BUY at Bid, SELL at Ask)
    be    = SL of what is left moved to the entry price, only when the decision-tick price is in profit (else NULL)
    hold  = remove every TP not reached yet, keep the original SL, exit at SL or cutoff
    half  = close half of what is left now, the other half follows the plan = (r_cut + r_plan) / 2 exactly (P&L is linear in size),
            so it is not stored separately
  every R includes partial closes already done before the decision and the same standard cost as r_std:
  r = pnl / risk_px - (COST_STD - spread_entry) / risk_px
TIME RULE for everything that describes the moment (event bits, state columns, ctx_dec): only data up to the decision tick (closed TF
bars, the open price of the decision M1 bar). Outcome columns r_* / *_exit_t / *_reason are the future by definition (labels)."""
import calendar, datetime
import numpy as np
import broker as BK, adx_lib as A, adx_ctx as X
from dc_sessions import sessions

LIB_FROM = calendar.timegm(datetime.datetime(2024, 4, 15).timetuple())
SANDBOX_END = calendar.timegm(datetime.datetime(2026, 6, 1).timetuple())     # exam = 2026-06-01 onwards: bars after this are never loaded
END_DAY = SANDBOX_END // 86400                                                # trading-day key of 2026-06-01 (trades of that day are exam)
WARM_FROM = "2024-02-01"                                                      # same warm-up as adx_build.py for the walk market
TFS = (1, 3, 5)
CHECK_N = 5                                                                   # user 2026-09-29
STAND_MIN = 60                                                                # new day high/low: old extreme stood >= 60 min (user 2026-09-29)
ZZ_K = 3.0
BIG = 10 ** 12

EV = ["big", "pin", "vspike", "inside", "pivot", "regime", "boxbreak", "pdh", "pdl", "dayhigh", "daylow", "asiahigh", "asialow", "check"]
BIT = {n: 1 << i for i, n in enumerate(EV)}
EV_DESC = {
    "big": "แท่งใหญ่: ช่วงแท่ง ≥ 2 ATR ของ 20 แท่งก่อนมัน (ทิศ = ev_big_dir)",
    "pin": "pinbar: ช่วง ≥ 1 ATR, ไส้ ≥ 60% ของช่วง, ตัว ≤ 30% (ทิศ = ev_pin_dir)",
    "vspike": "tick volume ≥ 3 เท่าของค่าเฉลี่ยแท่งก่อนหน้า ~1 วัน (max(20, 1380/TF) แท่ง)",
    "inside": "inside bar: high ต่ำกว่าและ low สูงกว่าแท่งก่อน (วันเดียวกัน)",
    "pivot": "pivot ใหม่ของ zigzag 3 ATR ถูกยืนยันที่แท่งนี้ = ขาใหม่เริ่ม (ทิศขาใหม่ = ev_piv_dir)",
    "regime": "ป้ายสภาพตลาด (zigzag 3 ATR) เปลี่ยน หรือเพิ่งรู้ค่าครั้งแรก ที่แท่งนี้ (ค่าใหม่ = ev_reg_new)",
    "boxbreak": "ราคาปิดหลุดกรอบ sideway (≥ 20 แท่งติดกันในวันเดียวกันที่ high−low รวม ≤ 4 ATR สิ้นสุดที่แท่งก่อน) (ทิศ = ev_box_dir)",
    "pdh": "ปิดเหนือ high เมื่อวานเป็นครั้งแรกของวัน (แท่ง TF นี้)",
    "pdl": "ปิดใต้ low เมื่อวานเป็นครั้งแรกของวัน (แท่ง TF นี้)",
    "dayhigh": f"ทำ high ใหม่ของวัน หลัง high เดิมยืนมา ≥ {STAND_MIN} นาที",
    "daylow": f"ทำ low ใหม่ของวัน หลัง low เดิมยืนมา ≥ {STAND_MIN} นาที",
    "asiahigh": "ปิดเหนือ high กรอบเอเชีย (17:00-02:59 นิวยอร์ก) เป็นครั้งแรกหลังช่วงเอเชียจบ",
    "asialow": "ปิดใต้ low กรอบเอเชีย เป็นครั้งแรกหลังช่วงเอเชียจบ",
    "check": f"จุดตรวจตามเวลา: ทุก {CHECK_N} แท่ง TF ของไม้ นับจากแท่งที่เข้าไม้ (ตัวเทียบ ไม่ใช่เหตุการณ์ของตลาด)",
}

# ---------------------------------------------------------------------------------------------------------------------------
def load_ctx_bars(cut=SANDBOX_END):
    """M1 bars of gold_dc.sqlite (UTC, sessions) before `cut` — the source of events and ctx (same as adx_ctx.py)."""
    return X.load(cut)

def sessions_levels(M):
    """per session: high/low of the previous VALID session (stub sessions excluded, same rule as adx_ctx.compute), Asia high/low."""
    t = M["t"]; sid = M["sid"]; ss = np.r_[0, np.flatnonzero(np.diff(sid)) + 1]; se = np.r_[ss[1:], len(t)]
    sday = M["day"][ss]; nb = se - ss
    shi = np.maximum.reduceat(M["h"], ss); slo = np.minimum.reduceat(M["l"], ss)
    stub = np.zeros(len(ss), bool)
    for s in range(1, len(ss)): stub[s] = nb[s] < 0.25 * np.median(nb[max(0, s - 20):s])
    V = np.flatnonzero(~stub); vday = sday[V]
    m = np.searchsorted(vday, sday, "left"); has = m >= 1; pv = V[np.clip(m - 1, 0, None)]
    pdh = np.where(has, shi[pv], np.nan); pdl = np.where(has, slo[pv], np.nan)
    et = ((t - np.where(BK.us_dst(t), 4, 5) * 3600) // 3600) % 24; asia = (et >= 17) | (et < 3)
    ah = np.full(len(ss), np.nan); al = np.full(len(ss), np.nan)
    for s, (a, b) in enumerate(zip(ss, se)):
        am = asia[a:b]
        if am.any(): ah[s] = M["h"][a:b][am].max(); al[s] = M["l"][a:b][am].min()
    return dict(ss=ss, pdh=pdh, pdl=pdl, ah=ah, al=al)

def tf_events(M, tf, SL=None):
    """event bits + directions for every bar of TF `tf` (session-aware bars of adx_ctx.resample). Every value of bar b uses bars <= b only.
    Returns dict with B (the bars), flags, dirs, dec_t (UTC time of the decision tick = first M1 bar at/after the natural bar end;
    -1 when no later M1 bar exists in the data)."""
    SL = sessions_levels(M) if SL is None else SL
    B = X.resample(M, tf); n = len(B["c"]); P = BK.POINT
    h, l, o, c, S = B["hi"], B["li"], B["oi"], B["ci"], B["s20p"]
    rng = h - l; body = np.abs(c - o); up = h - np.maximum(o, c); dn = np.minimum(o, c) - l; okb = S > 0
    fl = np.zeros(n, np.int64); dirs = {k: np.zeros(n, np.int64) for k in ("big", "pin", "piv", "reg", "box")}
    big = okb & (20 * rng >= 2 * S); fl[big] |= BIT["big"]; dirs["big"][big] = np.sign(c - o)[big]
    pin = okb & (20 * rng >= S) & (10 * body <= 3 * rng) & ((10 * up >= 6 * rng) | (10 * dn >= 6 * rng))
    fl[pin] |= BIT["pin"]; dirs["pin"][pin] = np.where(10 * dn >= 6 * rng, 1, -1)[pin]
    W = max(20, X.DAYBARS // tf); tvi = B["tv"].astype(np.int64); ctb = np.r_[0, np.cumsum(tvi)]
    sw = np.full(n, -1, np.int64); sw[W:] = ctb[W:n] - ctb[:n - W]
    fl[(sw >= 0) & (W * tvi >= 3 * sw)] |= BIT["vspike"]
    same = np.r_[False, B["sid"][1:] == B["sid"][:-1]]; hp = np.r_[h[0], h[:-1]]; lp = np.r_[l[0], l[:-1]]
    fl[okb & same & (h < hp) & (l > lp)] |= BIT["inside"]
    # structure: zigzag 3 ATR (adx_ctx.zigzag_state / regime_after = the verified phase-2 code)
    idx, pp, kind, conf, ncf, EP = X.zigzag_state(B, ZZ_K)
    reg, known, chg, dH, dL = X.regime_after(pp, kind)
    fl[conf] |= BIT["pivot"]; dirs["piv"][conf] = -kind
    rc = known & (chg == np.arange(len(pp)))
    fl[conf[rc]] |= BIT["regime"]; dirs["reg"][conf[rc]] = reg[rc]
    # box break: box = maximal run of bars ending at u = b-1 (same session, <= 1440 min) with high-low <= 4 x ATR(20 TR ending at u)
    csi = B["csi"]; LB = X.LB_MIN // tf; sidb = B["sid"]
    if n > 40:
        from numpy.lib.stride_tricks import sliding_window_view as swv
        wh = swv(h, 20).max(1); wl = swv(l, 20).min(1)                          # window ending at u = i + 19
        u = np.arange(20, n - 1); s_now = np.full(n, -1, np.int64); s_now[19:] = csi[20:n + 1] - csi[:n - 19]
        cand = u[(sidb[u - 19] == sidb[u]) & (sidb[u + 1] == sidb[u]) & (20 * (wh[u - 19] - wl[u - 19]) <= 4 * s_now[u])]
        sstart = np.searchsorted(sidb, sidb, "left")
        for uu in cand:
            lo_i = max(uu - LB + 1, sstart[uu])
            hs = h[lo_i:uu + 1][::-1]; ls = l[lo_i:uu + 1][::-1]
            mx = np.maximum.accumulate(hs); mn = np.minimum.accumulate(ls)
            bad = np.flatnonzero(20 * (mx - mn) > 4 * s_now[uu]); nn = bad[0] if len(bad) else len(hs)
            if nn < 20: continue
            bh, bl = mx[nn - 1], mn[nn - 1]; b = uu + 1
            if c[b] > bh: fl[b] |= BIT["boxbreak"]; dirs["box"][b] = 1
            elif c[b] < bl: fl[b] |= BIT["boxbreak"]; dirs["box"][b] = -1
    # levels, per session
    sb = np.searchsorted(SL["ss"], np.searchsorted(M["t"], B["t_open"]), "right") - 1      # session index of each TF bar
    pdh = np.rint(SL["pdh"][sb] / P); pdl = np.rint(SL["pdl"][sb] / P); ah = np.rint(SL["ah"][sb] / P); al = np.rint(SL["al"][sb] / P)
    et = ((B["t_open"] - np.where(BK.us_dst(B["t_open"]), 4, 5) * 3600) // 3600) % 24; after_asia = (et >= 3) & (et < 17)
    bs = np.r_[0, np.flatnonzero(np.diff(sidb)) + 1]; be = np.r_[bs[1:], n]
    INF = float("inf")
    cL, hL, lL, tL, aaL = c.tolist(), h.tolist(), l.tolist(), B["t_open"].tolist(), after_asia.tolist()
    pdhL, pdlL = np.nan_to_num(pdh, nan=INF).tolist(), np.nan_to_num(pdl, nan=-INF).tolist()   # no previous day -> never broken
    ahL, alL = np.nan_to_num(ah, nan=INF).tolist(), np.nan_to_num(al, nan=-INF).tolist()
    add = []
    for a, z in zip(bs.tolist(), be.tolist()):
        s_pdh = s_pdl = s_ah = s_al = False
        hi_v, hi_t, lo_v, lo_t = hL[a], tL[a], lL[a], tL[a]
        for b in range(a, z):
            cb = cL[b]
            if not s_pdh and cb > pdhL[b]: add.append((b, BIT["pdh"])); s_pdh = True
            if not s_pdl and cb < pdlL[b]: add.append((b, BIT["pdl"])); s_pdl = True
            if aaL[b]:
                if not s_ah and cb > ahL[b]: add.append((b, BIT["asiahigh"])); s_ah = True
                if not s_al and cb < alL[b]: add.append((b, BIT["asialow"])); s_al = True
            if b > a:
                tb = tL[b]
                if hL[b] > hi_v:
                    if tb - hi_t >= STAND_MIN * 60: add.append((b, BIT["dayhigh"]))
                    hi_v, hi_t = hL[b], tb
                if lL[b] < lo_v:
                    if tb - lo_t >= STAND_MIN * 60: add.append((b, BIT["daylow"]))
                    lo_v, lo_t = lL[b], tb
    for b, bit in add: fl[b] |= bit
    # decision tick of bar b: first M1 bar with t >= natural end of the TF bar (the bar is closed then; the same rule as ctx last_closed)
    j = np.searchsorted(M["t"], B["end"], "left")
    dec_t = np.where(j < len(M["t"]), M["t"][np.minimum(j, len(M["t"]) - 1)], -1)
    return dict(B=B, flags=fl, dirs=dirs, dec_t=dec_t)

# ---------------------------------------------------------------------------------------------------------------------------
def walk_market(to_utc=SANDBOX_END):
    """the same M1 market as adx_build.py (bars file, server clock, same trading window), bars strictly before to_utc."""
    import adx_build as AB
    M = A.load_m1(BK.utc_ts(WARM_FROM) - 86400, int(to_utc) + (to_utc - int(BK.server_to_utc(np.array([to_utc]))[0])))
    mk = A.Market(M, AB.START_H, AB.CUTOFF_H, AB.NO_ENTRY_MIN)
    mk.tu = BK.server_to_utc(M["t"])
    return mk

def _nxt(mask):
    """first index >= p where mask is True, for p = 0..L (BIG if none)"""
    L = len(mask); x = np.where(mask, np.arange(L), BIG)
    return np.r_[np.minimum.accumulate(x[::-1])[::-1], BIG]

def trade_rows(mk, T, dec_i, cost, future=True):
    """state + alternatives for one unique trade T (dict with e, dir, entry_px, sl_px, tp1..3_px, risk_px, spread_entry, ladder) at the
    walk M1 indices dec_i (decision ticks = opens of those bars). Returns (r_plan_from_entry, dict of arrays for the decisions where the
    trade is still open). future=False: state columns only, the loaded data may end at the decision tick (time-travel test)."""
    M = mk.M; n = len(M["t"]); e = T["e"]; d = T["dir"]; ent = T["entry_px"]; risk = T["risk_px"]
    cut = int(mk.next_blk[e + 1]) if e + 1 < n else n
    if cut >= n and future: raise RuntimeError("trade reaches the end of the loaded data (exam period?)")
    Pp = mk.P[e:cut].copy()
    if d == -1: Pp += M["sp"][e:cut, None]
    flat = Pp.ravel()[1:]; L = len(flat); isopen = np.zeros(L, bool); isopen[3::4] = True
    sl, tps = T["sl_px"], (T["tp1_px"], T["tp2_px"], T["tp3_px"])
    if d == 1: hS, hT, hB = flat <= sl, [flat >= x for x in tps], flat <= ent
    else: hS, hT, hB = flat >= sl, [flat <= x for x in tps], flat >= ent
    NS = _nxt(hS); NT = [_nxt(x) for x in hT]; NB = _nxt(hB)
    cut_fill = (M["o"][cut] + (M["sp"][cut] if d == -1 else 0.0)) if cut < n else np.nan
    fp = np.r_[flat, np.nan]; op = np.r_[isopen, False]                     # index BIG is never read (guarded by np.where)
    def at(arr, k): return arr[np.minimum(k, L)]
    ex_i = lambda k: np.where(k < BIG, e + (k + 1) // 4, cut)
    costR = (cost - T["spread_entry"]) / risk
    def fin(pnl): return pnl / risk - costR
    ladder = T["ladder"]
    # ---- the plan from the entry tick (walk_exit) -> the fills of TP1/TP2 (if any) with their indices
    iS0, i30 = NS[0], NT[2][0]; iX0 = min(iS0, i30); pk = []
    if ladder:
        for q in (0, 1):
            k = NT[q][0]
            if k < iX0 or (k == iX0 and i30 < iS0): pk.append((k, fp[k] if op[k] else tps[q]))
    pnl0 = 0.0; rem0 = 1.0
    for k, fpx in pk: pnl0 += (fpx - ent) * d / 3.0; rem0 -= 1.0 / 3.0
    fill0 = (fp[iX0] if op[iX0] else (sl if iS0 <= i30 else tps[2])) if iX0 < BIG else cut_fill
    r_entry = fin(pnl0 + rem0 * (fill0 - ent) * d)
    # ---- decisions
    s = (np.asarray(dec_i, np.int64) - e) * 4 - 1                             # flat index of the decision tick (open of bar dec_i)
    ok = (np.asarray(dec_i) > e) & (np.asarray(dec_i) < cut) & (s < iX0)       # trade still open after the broker handled that tick
    s = s[ok]; D = len(s)
    out = dict(ok=ok)
    if D == 0: return r_entry, out
    px = flat[s]
    real = np.zeros(D); rem = np.ones(D); done = np.zeros((D, 2), bool)
    for q, (k, fpx) in enumerate(pk):
        dn = k <= s; real += np.where(dn, (fpx - ent) * d / 3.0, 0.0); rem -= np.where(dn, 1.0 / 3.0, 0.0); done[:, q] = dn
    upto = np.maximum.accumulate(flat) if d == 1 else np.minimum.accumulate(flat)
    lowto = np.minimum.accumulate(flat) if d == 1 else np.maximum.accumulate(flat)
    out["n_tp_hit"] = done.sum(1)
    out["rem"] = rem; out["realized_r"] = real / risk; out["open_r"] = (px - ent) * d / risk
    out["mfe_r"] = np.maximum(0.0, (upto[s] - ent) * d / risk); out["mae_r"] = np.maximum(0.0, (ent - lowto[s]) * d / risk)
    out["dist_sl_r"] = (px - sl) * d / risk
    nxt_tp = np.where(done[:, 1], tps[2], np.where(done[:, 0], tps[1], tps[0])) if ladder else np.full(D, tps[2])
    out["dist_tp_r"] = (nxt_tp - px) * d / risk
    if not future: return r_entry, out
    st = s + 1
    def rest(stop_idx, stop_lvl, use_tps):
        """walk from st with SL level index array stop_idx (first hit), TPs (remaining) if use_tps -> pnl of the part still open, exit idx, reason"""
        i3 = NT[2][st] if use_tps else np.full(D, BIG)
        iX = np.minimum(stop_idx, i3); pnl = np.zeros(D); r_ = rem.copy()
        if use_tps and ladder:
            for q in (0, 1):
                k = NT[q][st]; hit = ~done[:, q] & ((k < iX) | ((k == iX) & (i3 < stop_idx)))
                fpx = np.where(at(op, k), at(fp, k), tps[q])
                pnl += np.where(hit, (fpx - ent) * d / 3.0, 0.0); r_ -= np.where(hit, 1.0 / 3.0, 0.0)
        is_sl = stop_idx <= i3
        fill = np.where(iX < BIG, np.where(at(op, iX), at(fp, iX), np.where(is_sl, stop_lvl, tps[2])), cut_fill)
        reason = np.where(iX < BIG, np.where(is_sl, 1, 2), 3)
        return pnl + r_ * (fill - ent) * d, ex_i(iX), reason
    p, xi, rs = rest(NS[st], sl, True)
    out["r_plan"] = fin(real + p)
    out["r_cut"] = fin(real + rem * (px - ent) * d)
    inprof = (px - ent) * d > 0
    p, xi, rs = rest(NB[st], ent, True)
    out["r_be"] = np.where(inprof, fin(real + p), np.nan); out["be_exit_i"] = np.where(inprof, xi, -1); out["be_reason"] = np.where(inprof, rs, -1)
    p, xi, rs = rest(NS[st], sl, False)
    out["r_hold"] = fin(real + p); out["hold_exit_i"] = xi; out["hold_reason"] = rs
    out["cut_i"] = cut
    return r_entry, out
