r"""Phase 2 audit part 3: the ctx columns that had no pre-phase-2 reference in audits 1-2.
1) M1/M5 zigzag 3 ATR position-in-cycle vs the catalog tables `pivots` and `legs` (dc_catalog.py) + raw bars:
   leg_dir = opposite of the last confirmed pivot's kind, leg_min from the pivot time, rng_pos from the two last pivot prices,
   previous leg (implied leg_atr*ATR/leg_ratio) = legs.size_atr * pivots.atr, extreme of the running leg (pivot + leg_atr*ATR)
   = highest high / lowest low of the TF bars from the confirming bar to the last closed bar
2) invariants that must hold if the definitions mean what they say (every row, all TFs / zigzags where they apply)
Usage: python adx_ctx_audit3.py"""
import sqlite3
import numpy as np
import broker as BK, adx_ctx as X, adx_asof as AS

bad_total = 0
def rep(name, nbad, extra=""):
    global bad_total; bad_total += nbad > 0
    print(f"{'OK ' if nbad == 0 else 'BAD'} {name}: {nbad} {extra}", flush=True)

db = sqlite3.connect(AS.DBT); g = sqlite3.connect(BK.DB)
cols = [r[1] for r in db.execute("PRAGMA table_info(ctx)")]; ci = {c: i for i, c in enumerate(cols)}
CT = np.array(db.execute("SELECT * FROM ctx ORDER BY entry_t").fetchall(), dtype=float); E = CT[:, 0].astype(np.int64); N = len(E)
def col(c): return CT[:, ci[c]]
_, dE, _ = X.sessions(E); M = X.load(None)
now = M["c"][np.searchsorted(M["t"], col("m1_last_t").astype(np.int64))]

# ================= 1) vs catalog pivots / legs ====================================================================================
for tf in (1, 5):
    B = X.resample(M, tf); jB = X.last_closed(B, E, dE); pre = f"m{tf}k3"
    P = np.array(g.execute("SELECT t_pivot, t_confirm, price, kind, atr FROM pivots WHERE tf=? ORDER BY t_confirm", (tf,)).fetchall())
    L = dict(g.execute("SELECT t_end, size_atr FROM legs WHERE tf=?", (tf,)).fetchall())
    pos = {int(x): i for i, x in enumerate(B["t_last"])}
    cidx = np.array([pos[int(x)] for x in P[:, 1]]); pidx = np.array([pos[int(x)] for x in P[:, 0]])
    q = np.searchsorted(cidx, jB, "right") - 1; has = q >= 0; qq = np.clip(q, 0, None)
    a_now = col(f"a_m{tf}_atr_usd")
    ok = has & ~np.isnan(col(f"{pre}_leg_dir"))
    rep(f"1a) M{tf}: rows where catalog has a confirmed pivot but ctx has none (or vice versa)", int(np.sum(has != ~np.isnan(col(f"{pre}_leg_dir")))))
    rep(f"1b) M{tf}: leg_dir != -kind of the last catalog pivot", int(np.sum(col(f"{pre}_leg_dir")[ok] != -P[qq, 3][ok])))
    rep(f"1c) M{tf}: leg_min != minutes since the catalog pivot bar closed", int(np.sum(col(f"{pre}_leg_min")[ok] != (E[ok] - (P[qq, 0][ok] + 60)) // 60)))
    two = ok & (q >= 1); q1 = np.clip(q - 1, 0, None)
    hi = np.where(P[qq, 3] > 0, P[qq, 2], P[q1, 2]); lo = np.where(P[qq, 3] < 0, P[qq, 2], P[q1, 2])
    rp = (now - lo) / (hi - lo)
    rep(f"1d) M{tf}: rng_pos != position vs the two last catalog pivot prices", int(np.sum(~np.isclose(col(f"{pre}_rng_pos")[two], rp[two], rtol=1e-9, atol=1e-9))))
    prev_ctx = col(f"{pre}_leg_atr") * a_now / col(f"{pre}_leg_ratio")
    prev_tab = np.array([L.get(int(t_), np.nan) for t_ in P[qq, 0]]) * P[qq, 4]
    rep(f"1e) M{tf}: previous leg implied by ctx != legs.size_atr x ATR (catalog)", int(np.sum(~np.isclose(prev_ctx[two], prev_tab[two], rtol=1e-7, atol=1e-6))))
    ld = col(f"{pre}_leg_dir"); ep_ctx = P[qq, 2] + ld * col(f"{pre}_leg_atr") * a_now
    ep_raw = np.full(N, np.nan)
    for r in np.flatnonzero(ok):
        a, b = cidx[q[r]], jB[r]
        ep_raw[r] = B["h"][a:b + 1].max() if ld[r] > 0 else B["l"][a:b + 1].min()
    rep(f"1f) M{tf}: extreme of the running leg != highest high / lowest low of raw bars since the confirming bar",
        int(np.sum(~np.isclose(ep_ctx[ok], ep_raw[ok], rtol=1e-9, atol=1e-6))))
    # previous same-kind pivot from the catalog table
    lastH = np.full(len(P), np.nan); prevH = np.full(len(P), np.nan); lastL = np.full(len(P), np.nan); prevL = np.full(len(P), np.nan); hh = []; ll = []
    for m in range(len(P)):
        (hh if P[m, 3] > 0 else ll).append(P[m, 2])
        if len(hh) >= 2 and len(ll) >= 2: lastH[m], prevH[m], lastL[m], prevL[m] = hh[-1], hh[-2], ll[-1], ll[-2]
    kn = ~np.isnan(col(f"{pre}_reg"))
    dh_t = (lastH[qq] - prevH[qq]) / a_now; dl_t = (lastL[qq] - prevL[qq]) / a_now
    rep(f"1h) M{tf}: dh_atr / dl_atr != catalog pivot-high / pivot-low differences / ATR",
        int(np.sum(~np.isclose(col(f"{pre}_dh_atr")[kn], dh_t[kn], rtol=1e-7, atol=1e-7)) + np.sum(~np.isclose(col(f"{pre}_dl_atr")[kn], dl_t[kn], rtol=1e-7, atol=1e-7))))
    rep(f"1g) M{tf}: retr_atr != (extreme - now) x dir / ATR from raw bars",
        int(np.sum(~np.isclose(col(f"{pre}_retr_atr")[ok], ((ep_raw - now) * ld / a_now)[ok], rtol=1e-7, atol=1e-7))))

# ================= 2) invariants ==================================================================================================
T = 1e-9
for tf in (1, 3, 5):
    B = X.resample(M, tf); jB = X.last_closed(B, E, dE); LB = 1440 // tf; a_now = col(f"a_m{tf}_atr_usd"); bn = col(f"f_m{tf}_box_n")
    inside_bad = grow_bad = 0; checked = 0
    for r in range(N):
        n, j = bn[r], jB[r]
        if np.isnan(n) or n < 1: continue
        n = int(n); checked += 1
        s = slice(j - n + 1, j + 1)
        if B["h"][s].max() - B["l"][s].min() > 4 * a_now[r] + 1e-6 or B["day"][j - n + 1] != B["day"][j]: inside_bad += 1
        k = j - n
        if n < LB and k >= 0 and B["day"][k] == B["day"][j]:
            if B["h"][k:j + 1].max() - B["l"][k:j + 1].min() <= 4 * a_now[r] - 1e-6: grow_bad += 1
    rep(f"2a) M{tf}: box_n bars NOT inside a 4-ATR range (same day)", inside_bad, f"({checked} rows)")
    rep(f"2b) M{tf}: one more bar (same day, within look-back) would still fit in 4 ATR = box_n too small", grow_bad)
    for k in (2, 3, 4):
        p = f"m{tf}k{k}"
        rep(f"2c) M{tf} k{k}: leg_atr <= 0 / leg_min < {tf} / n_sw < 0 / reg not in -1,0,1",
            int(np.sum(col(f"{p}_leg_atr") <= 0) + np.sum(col(f"{p}_leg_min") < tf) + np.sum(col(f"{p}_n_sw") < 0) +
                np.sum(~np.isnan(col(f"{p}_reg")) & ~np.isin(col(f"{p}_reg"), [-1, 0, 1]))))
        if tf == 1: rep(f"2d) M1 k{k}: retr_atr < 0 (latest price is inside the last closed M1 bar, cannot be beyond its extreme)", int(np.sum(col(f"{p}_retr_atr") < -T)))
for tf in ("m1", "m3", "m5", "m15", "h1"):
    for k in (2, 3, 4):
        p = f"{tf}k{k}"; rg, dh, dl = col(f"{p}_reg"), col(f"{p}_dh_atr"), col(f"{p}_dl_atr")
        exp = np.where((dh > 0) & (dl > 0), 1, np.where((dh < 0) & (dl < 0), -1, 0))
        rep(f"2l) {p}: regime label disagrees with the signs of dh_atr / dl_atr, or NULL pattern differs",
            int(np.sum(~np.isnan(rg) & (exp != rg)) + np.sum(np.isnan(rg) != np.isnan(dh)) + np.sum(np.isnan(rg) != np.isnan(dl))))
dr, ar = col("a_day_rng_adr"), col("d_asia_rng_adr")
rep("2e) asia range wider than today's range", int(np.sum(ar > dr + T)))
asia_now = col("d_asia_done") == 0; ap = col("d_asia_pos")
rep("2f) still in the asia session but price outside the asia range (asia_pos not in [0,1])", int(np.sum(asia_now & ~np.isnan(ap) & ((ap < -T) | (ap > 1 + T)))))
rep("2g) asia finished but asia range == today's range while asia_pos outside [0,1]",
    int(np.sum(~asia_now & np.isclose(ar, dr) & ((ap < -T) | (ap > 1 + T)))))
dp = col("d_day_pos"); rep("2h) day_pos outside [0,1]", int(np.sum((dp < -T) | (dp > 1 + T))))
rep("2i) never broke yesterday's high but price above it / never broke low but price below it",
    int(np.sum((col("d_broke_pdh") == 0) & (col("d_pdh_adr") > T)) + np.sum((col("d_broke_pdl") == 0) & (col("d_pdl_adr") < -T))))
gp, gf, pc = col("d_gap_adr"), col("d_gap_filled"), col("d_pdc_adr")
rep("2j) gap not filled but price already beyond yesterday's close", int(np.sum((gf == 0) & (((gp > 0) & (pc <= 0)) | ((gp < 0) & (pc >= 0))))))
rep("2k) today_bars = 0 but a_day_rng/day_pos present, or today_bars > 0 and day_pos missing",
    int(np.sum((col("d_today_bars") == 0) & ~np.isnan(dp)) + np.sum((col("d_today_bars") > 0) & np.isnan(dp) & (dr > 0))))
print("RESULT:", "all part-3 audit checks passed" if bad_total == 0 else f"{bad_total} check(s) failed")
