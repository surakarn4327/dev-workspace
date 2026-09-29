r"""Independent checks of adx_hold.sqlite (phase 3B-a) — run after hold_build.py. Prints agreement counts only (no totals of R are shown).
A) structure: set_map = every sandbox trade exactly once; utrades = the trades rows; dec.r_plan = utrades.r_std on EVERY row (the
   "nothing changed" identity); NULLs only where defined; decisions strictly inside the holding period and before 2026-06-01; every
   column of every table/view described; ctx_dec has a row for every decision time with m1_last_t <= dec_t - 60.
B) tick-by-tick re-simulation with separately written code (plain Python loop over the M1 ticks O-L-H-C / O-H-L-C, SELL on Ask, SL before TPs,
   partial 1/3 at TP1/TP2, cutoff = first bar outside the trading hours) for a random sample of rows: state at the decision tick and all
   4 alternatives + exit times/reasons.
C) events: every TF bar of M1/M3/M5 recomputed with own code (trading day from zoneinfo New York, own TF grouping, own ATR sums, own zigzag
   and regime, own boxes, own day/Asia levels) -> flags, directions, decision tick, compared for ALL bars; then for a sample of trades the
   full list of decision rows (which bars, bar_n, flags, directions) rebuilt from those bars + the tick simulation's "still open" and compared.
D) time travel: for chosen decision times D, rebuild events from bars cut at D, the trade state from a market that ends at the decision
   tick (bar D reduced to its open price) and ctx_dec from bars cut at D -> must equal the full build = nothing after D is used.
E) ctx_dec rows whose time is also an entry time must equal table ctx of adx_trades.sqlite (same verified definitions).
Usage: python hold_check.py [hold file] [n_sample]"""
import os, sys, sqlite3, time, calendar, datetime as DT
from zoneinfo import ZoneInfo
import numpy as np
import broker as BK

HOLD = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].isdigit() else os.path.join(os.path.dirname(BK.DB), "adx_hold.sqlite")
NS = int(sys.argv[-1]) if sys.argv[-1].isdigit() else 3000
DBT = os.path.join(os.path.dirname(BK.DB), "adx_trades.sqlite")
NY = ZoneInfo("America/New_York")
END = calendar.timegm(DT.datetime(2026, 6, 1).timetuple()); LIBF = calendar.timegm(DT.datetime(2024, 4, 15).timetuple())
assert BK.P["server_time"] == "UTC", "this checker assumes a UTC server clock (Exness)"
bad_total = 0
def rep(name, nbad, extra=""):
    global bad_total; bad_total += nbad > 0
    print(f"{'OK ' if nbad == 0 else 'BAD'} {name}: {nbad} {extra}", flush=True)

db = sqlite3.connect(HOLD); db.execute(f"ATTACH DATABASE '{DBT}' AS T")
tmeta = dict(db.execute("SELECT k, v FROM T.meta").fetchall())
COST = float(tmeta["cost_std_price"]); START_H = int(tmeta["start_server_hour"]); CUT_H = int(tmeta["cutoff_server_hour"])
months = sorted(r[0][5:] for r in db.execute("SELECT k FROM meta WHERE k LIKE 'done_%'"))
def mon(day): return (DT.date(1970, 1, 1) + DT.timedelta(days=int(day))).strftime("%Y-%m")
UT = {r[0]: r for r in db.execute("SELECT uid, tf, exit_mode, entry_t, exit_t, day, dir, entry_px, sl_px, tp1_px, tp2_px, tp3_px, risk_px, "
                                   "spread_entry, exit_reason, r_std, n_sets, n_dec FROM utrades")}
done_uid = np.array(sorted(u for u, r in UT.items() if mon(r[5]) in months))
print(f"file {HOLD}: months done {len(months)} ({months[0]} .. {months[-1]}), unique trades in them {len(done_uid)}", flush=True)

# ================= A) structure ======================================================================================================
nsand = db.execute("SELECT COUNT(*) FROM T.trades WHERE entry_t >= ? AND exit_t + 60 <= ? AND day < ?", (LIBF, END, END // 86400)).fetchone()[0]
rep("set_map rows vs sandbox trades", abs(db.execute("SELECT COUNT(*) FROM set_map").fetchone()[0] - nsand), f"({nsand} trades)")
rep("set_map duplicates (set_id, n)", db.execute("SELECT COUNT(*) FROM (SELECT set_id, n, COUNT(*) c FROM set_map GROUP BY 1,2 HAVING c > 1)").fetchone()[0])
# compared in Python: trades has no index on (set_id, n) and an SQL join scans ~1,500 rows per lookup (hung on the full file)
PR = {r[0]: (r[1], r[2]) for r in db.execute("SELECT set_id, tf, exit_mode FROM T.params")}
TR = {(r[0], r[1]): r[2:] for r in db.execute("SELECT set_id, n, entry_t, exit_t, day, dir, entry_px, sl_px, tp1_px, tp2_px, tp3_px, risk_px, "
                                              "spread_entry, exit_reason, r_std FROM T.trades WHERE entry_t >= ?", (LIBF,))}
nbm = 0
for s_, n_, uid in db.execute("SELECT set_id, n, uid FROM set_map"):
    t_ = TR.get((s_, n_)); u_ = UT[uid]
    if t_ is None or PR[s_] != (u_[1], u_[2]) or tuple(t_) != tuple(u_[3:16]): nbm += 1
rep("set_map rows whose trade differs from its utrades row (all columns, tf, exit mode)", nbm)
del TR
nsm = dict(db.execute("SELECT uid, COUNT(*) FROM set_map GROUP BY uid").fetchall())
rep("utrades.n_sets vs set_map", sum(1 for u, r in UT.items() if r[16] != nsm.get(u, 0)))
ndc = dict(db.execute("SELECT uid, COUNT(*) FROM dec GROUP BY uid").fetchall())
rep("utrades.n_dec vs dec rows (done months)", sum(1 for u in done_uid.tolist() if UT[u][17] != ndc.get(u, 0)))
mx = db.execute("SELECT MAX(ABS(d.r_plan - u.r_std)), COUNT(*) FROM dec d JOIN utrades u USING(uid)").fetchone()
rep("IDENTITY: rows where r_plan != r_std (|diff| > 1e-9)", db.execute("SELECT COUNT(*) FROM dec d JOIN utrades u USING(uid) WHERE ABS(d.r_plan - u.r_std) > 1e-9").fetchone()[0],
    f"(rows {mx[1]}, max |diff| {mx[0]:.2e})")
rep("decision outside the holding period (dec_t <= entry_t or > exit_t) or >= 2026-06-01", db.execute(
    "SELECT COUNT(*) FROM dec d JOIN utrades u USING(uid) WHERE d.dec_t <= u.entry_t OR d.dec_t > u.exit_t OR d.dec_t >= ?", (END,)).fetchone()[0])
rep("held_min != (dec_t - entry_t)/60", db.execute("SELECT COUNT(*) FROM dec d JOIN utrades u USING(uid) WHERE d.held_min != (d.dec_t - u.entry_t) / 60").fetchone()[0])
dcols = [r[1] for r in db.execute("PRAGMA table_info(dec)")]
nulls = dict(zip(dcols, db.execute("SELECT " + ",".join(f"SUM({c} IS NULL)" for c in dcols) + " FROM dec").fetchone()))
rep("NULLs outside r_be / be_exit_t / be_reason", sum(v for c, v in nulls.items() if c not in ("r_be", "be_exit_t", "be_reason")))
rep("r_be NULL <-> open_r <= 0 (BE only when in profit)", db.execute("SELECT COUNT(*) FROM dec WHERE (r_be IS NULL) != (open_r <= 0)").fetchone()[0])
rep("be_exit_t / be_reason NULL <-> r_be NULL", db.execute("SELECT COUNT(*) FROM dec WHERE (be_exit_t IS NULL) != (r_be IS NULL) OR (be_reason IS NULL) != (r_be IS NULL)").fetchone()[0])
rep("dec rows without any event bit (incl. checkpoint)", db.execute("SELECT COUNT(*) FROM dec WHERE flags = 0").fetchone()[0])
desc = {(a, b) for a, b, c in db.execute("SELECT tbl, name, description FROM columns") if c}
miss = [(tb, c) for tb in ("utrades", "set_map", "dec", "ctx_dec") for c in [r[1] for r in db.execute(f"PRAGMA table_info({tb})")] if (tb, c) not in desc]
vcols = [r[1] for r in db.execute("PRAGMA table_info(dec_v)")]
miss += [("dec_v", c) for c in vcols if c not in dcols and ("dec_v", c) not in desc]
rep("columns without a Thai description", len(miss), str(miss[:5]))
rep("decision times without a ctx_dec row", db.execute("SELECT COUNT(*) FROM (SELECT DISTINCT dec_t FROM dec) d LEFT JOIN ctx_dec c ON c.dec_t = d.dec_t WHERE c.dec_t IS NULL").fetchone()[0])
rep("ctx_dec m1_last_t > dec_t - 60", db.execute("SELECT COUNT(*) FROM ctx_dec WHERE m1_last_t > dec_t - 60").fetchone()[0])
rep("dec.min_to_cut != ctx_dec.t_min_cutoff", db.execute("SELECT COUNT(*) FROM dec d JOIN ctx_dec c ON c.dec_t = d.dec_t WHERE d.min_to_cut != c.t_min_cutoff").fetchone()[0])
rep("r_half in view != (r_cut + r_plan)/2", db.execute("SELECT COUNT(*) FROM dec_v WHERE ABS(r_half - (r_cut + r_plan) / 2.0) > 1e-12").fetchone()[0])

# ================= own M1 data (bars file for the walk, gold_dc for events) ===========================================================
z = np.load(BK.BARS); keep = z["t"].astype(np.int64) < END
Wt = z["t"].astype(np.int64)[keep]; WO, WH, WL, WC = (z[k][keep].astype(float) for k in ("o", "h", "l", "c")); WSP = z["sp"][keep] * BK.POINT
Wt_l = Wt.tolist(); WO_l, WH_l, WL_l, WC_l, WSP_l = WO.tolist(), WH.tolist(), WL.tolist(), WC.tolist(), WSP.tolist()
def allowed(ts):
    h = (ts // 3600) % 24
    return (h >= START_H or h < CUT_H) if START_H > CUT_H else (START_H <= h < CUT_H)

def simulate(u, i_dec, action):
    """own walk of unique trade u (utrades row). i_dec = bars-file index of the decision bar (its open = decision tick) or None.
    action: 'plan' / 'cut' / 'be' / 'hold'. Returns dict (open_at_dec False when the trade is no longer open at that tick)."""
    _, tf, ex, et, xt, day, d, ent, sl, tp1, tp2, tp3, risk, spe = u[:14]
    e = int(np.searchsorted(Wt, et)); assert Wt_l[e] == et
    ladder = ex == "L"; rem = 1.0; pnl = 0.0; done = [False, False]; sl_cur = sl; tps_on = True
    best = None; worst = None; st = None; res = {}
    i = e
    while True:
        if i > e and not allowed(Wt_l[i]):                                     # cutoff at this bar's open
            x = WO_l[i] + (WSP_l[i] if d == -1 else 0.0); pnl += rem * (x - ent) * d; res.update(exit_i=i, reason=3); break
        o, h, l, c = WO_l[i], WH_l[i], WL_l[i], WC_l[i]; sp = WSP_l[i] if d == -1 else 0.0
        pts = [o, l, h, c] if c >= o else [o, h, l, c]
        fin = False
        for j, x0 in enumerate(pts):
            if i == e and j == 0: continue                                     # entry tick
            x = x0 + sp; isop = j == 0
            if (x <= sl_cur) if d == 1 else (x >= sl_cur):
                pnl += rem * ((x if isop else sl_cur) - ent) * d; rem = 0; res.update(exit_i=i, reason=1); fin = True; break
            if tps_on:
                if ladder:
                    for q, lv in ((0, tp1), (1, tp2)):
                        if not done[q] and ((x >= lv) if d == 1 else (x <= lv)):
                            pnl += ((x if isop else lv) - ent) * d / 3.0; rem -= 1.0 / 3.0; done[q] = True
                if (x >= tp3) if d == 1 else (x <= tp3):
                    pnl += rem * ((x if isop else tp3) - ent) * d; rem = 0; res.update(exit_i=i, reason=2); fin = True; break
            fav = (x - ent) * d
            best = fav if best is None else max(best, fav); worst = fav if worst is None else min(worst, fav)
            if i_dec is not None and i == i_dec and j == 0:                    # decision tick, after the broker handled it
                st = dict(n_tp_hit=sum(done), rem=rem, realized_r=pnl / risk, open_r=fav / risk, mfe_r=max(0.0, best) / risk,
                          mae_r=max(0.0, -worst) / risk, dist_sl_r=(x - sl) * d / risk,
                          dist_tp_r=((tp3 if (not ladder or done[1]) else (tp2 if done[0] else tp1)) - x) * d / risk)
                if action == "cut":
                    pnl += rem * (x - ent) * d; rem = 0; res.update(exit_i=i, reason=0); fin = True; break
                if action == "be":
                    if fav > 0: sl_cur = ent
                    else: st["be_na"] = True
                if action == "hold": tps_on = False
        if fin: break
        i += 1
    if i_dec is not None and (st is None or res["exit_i"] < i_dec): return dict(open_at_dec=False)
    res.update(open_at_dec=True, r=pnl / risk - (COST - spe) / risk, st=st, exit_t=Wt_l[res["exit_i"]])
    if i_dec is not None: res["min_to_cut"] = None
    return res

# ================= B) tick-by-tick re-simulation of sampled rows ======================================================================
nrow = db.execute("SELECT MAX(rowid) FROM dec").fetchone()[0]
rng = np.random.default_rng(7); rid = np.unique(rng.integers(1, nrow + 1, NS))
q = ",".join(map(str, rid.tolist()))
dnames = dcols
S = db.execute(f"SELECT {','.join(dnames)} FROM dec WHERE rowid IN ({q})").fetchall()
cix = {c: i for i, c in enumerate(dnames)}
t0 = time.time(); nb = 0; worst = {}
for row in S:
    u = UT[row[cix["uid"]]]; D = row[cix["dec_t"]]; idec = int(np.searchsorted(Wt, D)); assert Wt_l[idec] == D
    P = simulate(u, idec, "plan"); Cc = simulate(u, idec, "cut"); B = simulate(u, idec, "be"); Hh = simulate(u, idec, "hold")
    ok = P["open_at_dec"]
    if not ok: nb += 1; continue
    exp = dict(P["st"]); exp.update(r_plan=P["r"], r_cut=Cc["r"], r_hold=Hh["r"], hold_exit_t=Hh["exit_t"], hold_reason=Hh["reason"])
    if B["st"].get("be_na"): exp.update(r_be=None, be_exit_t=None, be_reason=None)
    else: exp.update(r_be=B["r"], be_exit_t=B["exit_t"], be_reason=B["reason"])
    # minutes to the next CUT_H:00 server by the clock (server = UTC here)
    du = DT.datetime.fromtimestamp(D, DT.timezone.utc); cu = du.replace(hour=CUT_H, minute=0, second=0)
    if cu <= du: cu += DT.timedelta(days=1)
    exp["min_to_cut"] = int((cu - du).total_seconds() // 60)
    for kk, v in exp.items():
        got = row[cix[kk]]
        if v is None or got is None: diff = 0.0 if (v is None) == (got is None) else 1.0
        else: diff = abs(float(v) - float(got))
        worst[kk] = max(worst.get(kk, 0.0), diff)
        if diff > 1e-9: nb += 1; break
rep(f"B) sampled rows where own tick simulation differs (state + 4 alternatives + exits)", nb, f"(rows {len(S)}, {time.time() - t0:.0f}s, worst per column "
    + ", ".join(f"{k} {v:.1e}" for k, v in worst.items() if v > 0) + ")")

# ================= C) events recomputed with own code ================================================================================
g = sqlite3.connect(BK.DB)
R = np.array(g.execute("SELECT t,o,h,l,c,tick_vol FROM bars_m1 WHERE t < ? ORDER BY t", (END,)).fetchall(), dtype=float)
t = R[:, 0].astype(np.int64); PT = lambda a: np.rint(a / BK.POINT).astype(np.int64)
Oi, Hi, Li, Ci = PT(R[:, 1]), PT(R[:, 2]), PT(R[:, 3]), PT(R[:, 4]); TV = R[:, 5].astype(np.int64)
offs = {}
def nyoff(ts):
    hk = int(ts) // 3600
    if hk not in offs: offs[hk] = int(DT.datetime.fromtimestamp(hk * 3600, NY).utcoffset().total_seconds())
    return offs[hk]
nysec = np.array([x + nyoff(x) for x in t.tolist()], dtype=np.int64); nyh = (nysec // 3600) % 24
TD = nysec // 86400 + (nyh >= 17)                                           # trading date: 17:00 NY belongs to the next date
sd, sf = np.unique(TD, return_index=True); sl_ = np.r_[sf[1:], len(t)]
sinfo = []
for k, (a, b) in enumerate(zip(sf, sl_)):
    prevn = [sl_[j] - sf[j] for j in range(max(0, k - 20), k)]
    stub = bool(prevn) and (b - a) < 0.25 * float(np.median(prevn))
    am = (nyh[a:b] >= 17) | (nyh[a:b] < 3)
    sinfo.append(dict(a=a, b=b, hi=int(Hi[a:b].max()), lo=int(Li[a:b].min()), stub=stub,
                      ah=int(Hi[a:b][am].max()) if am.any() else None, al=int(Li[a:b][am].min()) if am.any() else None))
prevvalid = []; last = None
for k, s in enumerate(sinfo):
    prevvalid.append(last)
    if not s["stub"]: last = k

def own_events(tf):
    key = TD * 10 ** 7 + t // (tf * 60)
    st = [0] + (np.flatnonzero(np.diff(key)) + 1).tolist(); en = st[1:] + [len(t)]
    n = len(st); h = [int(Hi[a:b].max()) for a, b in zip(st, en)]; l = [int(Li[a:b].min()) for a, b in zip(st, en)]
    o = [int(Oi[a]) for a in st]; c = [int(Ci[b - 1]) for b in en]; tv = [int(TV[a:b].sum()) for a, b in zip(st, en)]
    tdb_ = [int(TD[a]) for a in st]; t0b = [int(t[a]) for a in st]
    tr = [h[0] - l[0]] + [max(h[j], c[j - 1]) - min(l[j], c[j - 1]) for j in range(1, n)]
    s20 = [None] * n; run = 0
    for j in range(n):
        if j >= 20: s20[j] = run; run -= tr[j - 20]
        run += tr[j]
    F = [0] * n; Dd = {k: [0] * n for k in ("big", "pin", "piv", "reg", "box")}
    W = max(20, 1380 // tf); tvs = 0
    for j in range(n):
        S_ = s20[j]; rg = h[j] - l[j]; body = abs(c[j] - o[j]); up = h[j] - max(o[j], c[j]); dn = min(o[j], c[j]) - l[j]
        if S_ is not None and S_ > 0:
            if 20 * rg >= 2 * S_: F[j] |= 1; Dd["big"][j] = (c[j] > o[j]) - (c[j] < o[j])
            if 20 * rg >= S_ and 10 * body <= 3 * rg and (10 * up >= 6 * rg or 10 * dn >= 6 * rg): F[j] |= 2; Dd["pin"][j] = 1 if 10 * dn >= 6 * rg else -1
            if j > 0 and tdb_[j] == tdb_[j - 1] and h[j] < h[j - 1] and l[j] > l[j - 1]: F[j] |= 8
        if j >= W and W * tv[j] >= 3 * tvs: F[j] |= 4
        tvs += tv[j]
        if j >= W: tvs -= tv[j - W]
    # zigzag 3 ATR (own state machine) + regime from the list of confirmed pivots
    dirn = 0; ep = c[0]; start = c[0]; Hs = []; Ls = []; prev_reg = None
    for j in range(1, n):
        if j < 20: continue
        th = 3 * s20[j]; conf = None
        if dirn == 0:
            if 20 * (h[j] - start) >= th: dirn, ep = 1, h[j]
            elif 20 * (start - l[j]) >= th: dirn, ep = -1, l[j]
        elif dirn == 1:
            if h[j] >= ep: ep = h[j]
            elif 20 * (ep - l[j]) >= th: conf = (1, ep); dirn, ep = -1, l[j]
        else:
            if l[j] <= ep: ep = l[j]
            elif 20 * (h[j] - ep) >= th: conf = (-1, ep); dirn, ep = 1, h[j]
        if conf:
            F[j] |= 16; Dd["piv"][j] = -conf[0]
            (Hs if conf[0] > 0 else Ls).append(conf[1])
            if len(Hs) >= 2 and len(Ls) >= 2:
                rg_ = 1 if (Hs[-1] > Hs[-2] and Ls[-1] > Ls[-2]) else (-1 if (Hs[-1] < Hs[-2] and Ls[-1] < Ls[-2]) else 0)
                if prev_reg is None or rg_ != prev_reg: F[j] |= 32; Dd["reg"][j] = rg_
                prev_reg = rg_
    # boxes: run of bars ending at j-1 (same trading date, <= 1440 min) with high-low <= 4 x (20 TR ending at j-1)
    LB = 1440 // tf; ctr = [0]
    for x in tr: ctr.append(ctr[-1] + x)
    for j in range(21, n):
        u_ = j - 1
        if tdb_[j] != tdb_[u_]: continue
        s_now = ctr[u_ + 1] - ctr[u_ - 19]; mxh = -10 ** 18; mnl = 10 ** 18; cnt = 0
        for v in range(u_, max(u_ - LB, -1), -1):
            if tdb_[v] != tdb_[u_]: break
            nh = max(mxh, h[v]); nl = min(mnl, l[v])
            if 20 * (nh - nl) > 4 * s_now: break
            mxh, mnl, cnt = nh, nl, cnt + 1
        if cnt >= 20:
            if c[j] > mxh: F[j] |= 64; Dd["box"][j] = 1
            elif c[j] < mnl: F[j] |= 64; Dd["box"][j] = -1
    # levels per trading date
    sidx = np.searchsorted(sf, st, "right") - 1
    j = 0
    while j < n:
        k = sidx[j]; z_ = j
        while z_ < n and sidx[z_] == k: z_ += 1
        pv = prevvalid[k]; pdh = sinfo[pv]["hi"] if pv is not None else None; pdl = sinfo[pv]["lo"] if pv is not None else None
        ah, al = sinfo[k]["ah"], sinfo[k]["al"]; seen = set(); hv, ht, lv, lt = h[j], t0b[j], l[j], t0b[j]
        for b in range(j, z_):
            hr = int(nyh[st[b]])
            if pdh is not None and "h" not in seen and c[b] > pdh: F[b] |= 128; seen.add("h")
            if pdl is not None and "l" not in seen and c[b] < pdl: F[b] |= 256; seen.add("l")
            if 3 <= hr < 17 and ah is not None:
                if "ah" not in seen and c[b] > ah: F[b] |= 2048; seen.add("ah")
                if "al" not in seen and c[b] < al: F[b] |= 4096; seen.add("al")
            if b > j:
                if h[b] > hv:
                    if t0b[b] - ht >= 3600: F[b] |= 512
                    hv, ht = h[b], t0b[b]
                if l[b] < lv:
                    if t0b[b] - lt >= 3600: F[b] |= 1024
                    lv, lt = l[b], t0b[b]
        j = z_
    bend = [(x // (tf * 60) + 1) * tf * 60 for x in t0b]
    di = np.searchsorted(t, bend, "left"); dect = [int(t[x]) if x < len(t) else -1 for x in di]
    return dict(t0=np.array(t0b), F=np.array(F), D={k: np.array(v) for k, v in Dd.items()}, dec_t=np.array(dect))

import hold_lib as H
M = H.load_ctx_bars(); SLv = H.sessions_levels(M); OWN = {}; FULL = {}
for tf in H.TFS:
    t1 = time.time(); ev = H.tf_events(M, tf, SLv); ow = own_events(tf); OWN[tf] = ow; FULL[tf] = ev
    same_bars = len(ow["t0"]) == len(ev["B"]["t_open"]) and np.array_equal(ow["t0"], ev["B"]["t_open"])
    rep(f"C) M{tf} TF bars identical (own grouping)", int(not same_bars), f"({len(ow['t0'])} bars)")
    if not same_bars: continue
    fb = np.flatnonzero(ow["F"] != ev["flags"])
    rep(f"C) M{tf} bars with different event bits", len(fb), f"(bars with any event {int((ow['F'] != 0).sum())}; per event "
        + ", ".join(f"{n} {int(((ow['F'] >> i) & 1).sum())}" for i, n in enumerate(H.EV[:-1])) + f"; {time.time() - t1:.0f}s)")
    rep(f"C) M{tf} bars with different event directions", sum(int(np.sum(ow["D"][k] != ev["dirs"][k])) for k in ow["D"]))
    rep(f"C) M{tf} bars with a different decision tick", int(np.sum(ow["dec_t"] != ev["dec_t"])))
# per-trade decision lists for a sample of trades
pick = rng.choice(done_uid, min(1500, len(done_uid)), replace=False); nbad = 0; nrows = 0
for uid in pick.tolist():
    u = UT[uid]; tf = u[1]; ow = OWN[tf]; b0 = int(np.searchsorted(ow["t0"], u[3])); assert ow["t0"][b0] == u[3]
    b1 = int(np.searchsorted(ow["t0"], u[4], "right")); exp = []
    for b in range(b0, b1):
        fl = int(ow["F"][b]) | (8192 if (b - b0 + 1) % 5 == 0 else 0); D = int(ow["dec_t"][b])
        if fl == 0 or D < 0: continue
        idec = int(np.searchsorted(Wt, D))
        if not simulate(u, idec, "plan")["open_at_dec"]: continue
        exp.append((D, b - b0 + 1, fl, int(ow["D"]["big"][b]), int(ow["D"]["pin"][b]), int(ow["D"]["piv"][b]), int(ow["D"]["reg"][b]), int(ow["D"]["box"][b])))
    got = db.execute("SELECT dec_t, bar_n, flags, ev_big_dir, ev_pin_dir, ev_piv_dir, ev_reg_new, ev_box_dir FROM dec WHERE uid = ? ORDER BY dec_t", (uid,)).fetchall()
    nrows += len(exp); nbad += int(exp != [tuple(x) for x in got])
rep("C) sampled trades whose full list of decision rows differs from own rebuild", nbad, f"({len(pick)} trades, {nrows} rows)")

# ================= D) time travel ====================================================================================================
import adx_lib as A, adx_ctx as X
cand = db.execute("SELECT d.dec_t, u.tf, d.n_tp_hit FROM dec d JOIN utrades u USING(uid) ORDER BY d.rowid").fetchall()
cand = np.array(cand, dtype=np.int64); picks = []
for tf in (1, 3, 5):
    m = np.flatnonzero(cand[:, 1] == tf)
    if len(m): picks += [int(cand[m[len(m) // 3], 0]), int(cand[m[2 * len(m) // 3], 0])]
m = np.flatnonzero(cand[:, 2] > 0)
if len(m): picks.append(int(cand[m[len(m) // 2], 0]))
picks = sorted(set(picks))
scol = ["n_tp_hit", "rem", "realized_r", "open_r", "mfe_r", "mae_r", "dist_sl_r", "dist_tp_r"]
ctx_cols = [r[1] for r in db.execute("PRAGMA table_info(ctx_dec)")]
nb_ev = nb_st = nb_cx = nst = 0
for D in picks:
    Mc = H.load_ctx_bars(cut=D); SLc = H.sessions_levels(Mc)
    for tf in H.TFS:
        full = FULL[tf]; cutv = H.tf_events(Mc, tf, SLc); k = int(np.sum(cutv["B"]["end"] <= D))
        nb_ev += int(np.sum(cutv["flags"][:k] != full["flags"][:k])) + sum(int(np.sum(cutv["dirs"][x][:k] != full["dirs"][x][:k])) for x in full["dirs"])
    # market ending at the decision tick: bars before D + bar D reduced to its open
    Mw = A.load_m1(BK.utc_ts(H.WARM_FROM) - 86400, D + 60)
    for x in ("h", "l", "c"): Mw[x][-1] = Mw["o"][-1]
    assert Mw["t"][-1] == D
    import adx_build as AB
    mk = A.Market(Mw, AB.START_H, AB.CUTOFF_H, AB.NO_ENTRY_MIN)
    rows = db.execute(f"SELECT d.uid, {','.join(scol)} FROM dec d WHERE d.dec_t = ?", (D,)).fetchall()
    for r in rows:
        u = UT[r[0]]; e = int(np.searchsorted(Mw["t"], u[3]))
        T = dict(e=e, dir=u[6], entry_px=u[7], sl_px=u[8], tp1_px=u[9], tp2_px=u[10], tp3_px=u[11], risk_px=u[12], spread_entry=u[13], ladder=u[2] == "L")
        _, O = H.trade_rows(mk, T, np.array([len(Mw["t"]) - 1]), COST, future=False); nst += 1
        if not O["ok"][0] or any(abs(float(O[c][0]) - float(v)) > 1e-12 for c, v in zip(scol, r[1:])): nb_st += 1
    C, Dd, dE, i1 = X.compute(np.array([D]), Mc, COST, CUT_H, log=lambda *a: None)
    ref = db.execute(f"SELECT {','.join(ctx_cols)} FROM ctx_dec WHERE dec_t = ?", (D,)).fetchone()
    for c_, v in zip(ctx_cols[3:], ref[3:]):
        x = C[c_][0][0]
        if (v is None) != (not np.isfinite(x)) or (v is not None and abs(x - v) > 1e-12): nb_cx += 1
rep("D) time travel: event bits/directions that change when bars after D are removed", nb_ev, f"({len(picks)} decision times)")
rep("D) time travel: trade-state rows that change when the market ends at the decision tick", nb_st, f"({nst} rows)")
rep("D) time travel: ctx_dec values that change when bars after D are removed", nb_cx)

# ================= E) ctx_dec vs ctx at the same times ================================================================================
cc = ",".join(f"c.{x}" for x in ctx_cols[3:]); dd = ",".join(f"d.{x}" for x in ctx_cols[3:])
Rr = db.execute(f"SELECT {cc}, {dd} FROM ctx_dec d JOIN T.ctx c ON c.entry_t = d.dec_t").fetchall()
k = len(ctx_cols) - 3; nbx = sum(1 for r in Rr if any((a is None) != (b is None) or (a is not None and abs(a - b) > 1e-12) for a, b in zip(r[:k], r[k:])))
rep("E) ctx_dec rows != ctx rows at the same time", nbx, f"({len(Rr)} shared times)")
print("ALL OK" if bad_total == 0 else f"{bad_total} CHECK(S) FAILED")
