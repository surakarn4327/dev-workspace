r"""Independent checks of table ctx (phase 2) — run after adx_ctx.py. Shares NO code with adx_ctx.py except reading the same tables.
A) structure: one row per distinct trades.entry_t, every trade joins, every column described, last M1 bar used <= entry_t - 60,
   every NULL explained (ADR history < 3 days / no bar of today yet / first 10 days after data start)
B) recompute every column for a sample of entry times with separately written code: New York clock from zoneinfo (not broker.us_dst),
   own trading-day grouping, own TF bars, own ATR, own zigzag state machine, footprints by plain loops per entry, day levels by plain loops.
   Structures are built on the whole series once; each entry only uses TF bars closed at its time and pivots confirmed by them.
C) time travel: rebuild ctx from bars cut exactly at chosen entry times (adx_ctx.build(cut=E)) and compare with the full table, every row
   with entry_t <= E, every column (NULLs included). Equal = nothing after the entry time can change a row = no look-ahead.
Usage: python adx_ctx_check.py [n_sample]    (prints only agreement counts — no outcome / R is read)"""
import os, sys, sqlite3, time
from datetime import datetime, timezone, timedelta, date
from zoneinfo import ZoneInfo
import numpy as np
import broker as BK

NY = ZoneInfo("America/New_York")
DBT = os.path.join(os.path.dirname(BK.DB), "adx_trades.sqlite")
NS = int(sys.argv[1]) if len(sys.argv) > 1 else 2000
bad_total = 0
def rep(name, nbad, extra=""):
    global bad_total; bad_total += nbad > 0
    print(f"{'OK ' if nbad == 0 else 'BAD'} {name}: {nbad} {extra}", flush=True)

tdb = sqlite3.connect(DBT)
cols = [r[1] for r in tdb.execute("PRAGMA table_info(ctx)")]
CT = np.array(tdb.execute("SELECT * FROM ctx ORDER BY entry_t").fetchall(), dtype=float)
ci = {c: i for i, c in enumerate(cols)}
E_all = CT[:, 0].astype(np.int64)
meta = dict(tdb.execute("SELECT k, v FROM meta").fetchall()); COST = float(meta["cost_std_price"]); CUTH = int(meta["cutoff_server_hour"])
assert BK.P["server_time"] == "UTC", "this checker assumes a UTC server clock (Exness); extend for other brokers"

# ================= A) structure ===================================================================================================
te = np.array([r[0] for r in tdb.execute("SELECT DISTINCT entry_t FROM trades ORDER BY entry_t")], dtype=np.int64)
rep("ctx rows vs distinct trades.entry_t", int(len(te) != len(E_all) or np.any(te != E_all)), f"({len(E_all)} rows)")
rep("trades without a ctx row", tdb.execute("SELECT COUNT(*) FROM trades t LEFT JOIN ctx c ON c.entry_t=t.entry_t WHERE c.entry_t IS NULL").fetchone()[0])
desc = dict(tdb.execute("SELECT name, description FROM columns WHERE tbl='ctx'").fetchall())
rep("ctx columns without description", sum(1 for c in cols if not desc.get(c)))
rep("last M1 bar used later than entry_t - 60", int(np.sum(CT[:, ci["m1_last_t"]] > E_all - 60)))
g = sqlite3.connect(BK.DB)
TB = np.array([r[0] for r in g.execute("SELECT t FROM bars_m1 ORDER BY t")], dtype=np.int64)
rep("m1_last_t is not the last bar with t <= entry_t - 60 (independent search)",
    int(np.sum(TB[np.searchsorted(TB, E_all - 60, 'right') - 1] != CT[:, ci["m1_last_t"]])))
warm = E_all < BK.T0 + 10 * 86400    # H1 zigzag 4 ATR needs ~7 days of data for 2 highs + 2 lows
adrlow = CT[:, ci["a_adr_days"]] < 3; notoday = CT[:, ci["d_today_bars"]] == 0
unexpl = {c: int(np.sum(np.isnan(CT[:, i]) & ~(warm | adrlow | notoday))) for c, i in ci.items()}
rep("NULLs not explained by warm-up / ADR < 3 days / no bar of today", sum(unexpl.values()), str({k: v for k, v in unexpl.items() if v}))
TODAY_COLS = ["a_day_rng_adr", "d_broke_pdh", "d_broke_pdl", "d_day_pos", "d_gap_adr", "d_gap_filled", "d_asia_rng_adr", "d_asia_pos"]
rep("rows with no bar of today but a today-value present", int(sum(np.sum(~np.isnan(CT[notoday, ci[c]])) for c in TODAY_COLS)),
    f"({int(notoday.sum())} rows without a bar of today)")
nn = int(np.isnan(CT).any(axis=1).sum()); print(f"   rows with any NULL: {nn} of {len(CT)}; after the first 10 days: {int((np.isnan(CT).any(axis=1) & ~warm).sum())}")

# ================= B) independent recomputation ===================================================================================
R = np.array(g.execute("SELECT t,o,h,l,c,tick_vol FROM bars_m1 ORDER BY t").fetchall(), dtype=float)
t = R[:, 0].astype(np.int64); O, H, L, Cc, TV = R[:, 1], R[:, 2], R[:, 3], R[:, 4], R[:, 5]
hrs = np.unique(t // 3600)
offs = {int(x): int(datetime.fromtimestamp(int(x) * 3600, NY).utcoffset().total_seconds()) for x in hrs}
def ny(ts): return datetime.fromtimestamp(int(ts), NY)
def tdate(ts):
    d = ny(ts); dd = d.date() + (timedelta(days=1) if d.hour >= 17 else timedelta(0)); return (dd - date(1970, 1, 1)).days
off_bar = np.array([offs[int(x)] for x in t // 3600])
nysec = t + off_bar; nyh = (nysec // 3600) % 24
DK = np.array([(x // 86400) + (1 if h_ >= 17 else 0) for x, h_ in zip(nysec, nyh)], dtype=np.int64)
# sessions (trading dates) in order
sdates, sfirst = np.unique(DK, return_index=True); slast = np.r_[sfirst[1:], len(t)] - 1
S = {}
for k_, (d_, a, b) in enumerate(zip(sdates, sfirst, slast)):
    S[int(d_)] = dict(k=k_, a=a, b=b, n=b - a + 1, hi=H[a:b + 1].max(), lo=L[a:b + 1].min(), op=O[a], cl=Cc[b])
order = [int(x) for x in sdates]
for k_, d_ in enumerate(order):
    prevn = [S[order[j]]["n"] for j in range(max(0, k_ - 20), k_)]
    S[d_]["stub"] = bool(prevn) and S[d_]["n"] < 0.25 * float(np.median(prevn))

def tfbars(tf):
    """own grouping: consecutive M1 bars with the same (trading date, tf-bucket)"""
    key = [(int(d_), int(x) // (tf * 60)) for d_, x in zip(DK, t)]
    starts = [0] + [i for i in range(1, len(key)) if key[i] != key[i - 1]]; ends = starts[1:] + [len(key)]
    st = np.array(starts); en = np.array(ends)
    # prices as integer points (tick grid) so every threshold test is exact
    b = dict(t0=t[st], day=DK[st], o=[PT(O[a]) for a in st], c=[PT(Cc[e - 1]) for e in en], h=[max(PT(x) for x in H[a:e]) for a, e in zip(st, en)],
             l=[min(PT(x) for x in L[a:e]) for a, e in zip(st, en)], tv=[int(TV[a:e].sum()) for a, e in zip(st, en)], tl=t[en - 1])
    b["bend"] = (b["t0"] // (tf * 60)) * (tf * 60) + tf * 60
    n = len(st); tr = [b["h"][0] - b["l"][0]]
    for j in range(1, n): tr.append(max(b["h"][j], b["c"][j - 1]) - min(b["l"][j], b["c"][j - 1]))
    b["tr"] = tr
    return b
P_ = BK.POINT
def PT(x): return int(round(float(x) / P_))

def zz(b, k):
    """zigzag reversal k x ATR20 (20 bars before the bar); returns pivots [(bar, price, kind, confirm_bar)], per-bar state (count, extreme)"""
    n = len(b["h"]); piv = []; cnt = np.zeros(n, int); ext = np.full(n, np.nan)
    state = {"d": 0, "ep": b["c"][0], "ei": 0, "start": b["c"][0]}
    if "s20" not in b:                                    # sum of the 20 previous true ranges (points), plain running sum
        s20 = [None] * n; s_ = 0
        for j in range(n):
            if j >= 20: s20[j] = s_; s_ -= b["tr"][j - 20]
            s_ += b["tr"][j]
        b["s20"] = s20
    for j in range(1, n):
        if j >= 20:
            th20 = k * b["s20"][j]                        # threshold x 20 (points)
            s = state
            if s["d"] == 0:
                if 20 * (b["h"][j] - s["start"]) >= th20: s.update(d=1, ep=b["h"][j], ei=j)
                elif 20 * (s["start"] - b["l"][j]) >= th20: s.update(d=-1, ep=b["l"][j], ei=j)
            elif s["d"] > 0:
                if b["h"][j] >= s["ep"]: s.update(ep=b["h"][j], ei=j)
                elif 20 * (s["ep"] - b["l"][j]) >= th20: piv.append((s["ei"], s["ep"], 1, j)); s.update(d=-1, ep=b["l"][j], ei=j)
            else:
                if b["l"][j] <= s["ep"]: s.update(ep=b["l"][j], ei=j)
                elif 20 * (b["h"][j] - s["ep"]) >= th20: piv.append((s["ei"], s["ep"], -1, j)); s.update(d=1, ep=b["h"][j], ei=j)
        cnt[j] = len(piv); ext[j] = state["ep"] * P_ if state["d"] != 0 else np.nan
    return piv, cnt, ext

rng = np.random.default_rng(11)
early = np.flatnonzero(E_all < BK.T0 + 10 * 86400)[:150]
notd = np.flatnonzero(notoday)[:60]
pick = np.unique(np.r_[early, notd, rng.choice(len(E_all), NS, replace=False)])
PE = E_all[pick]; print(f"B) sample {len(PE)} entry times (random + first 10 days + session-open entries)", flush=True)
V = {c: np.full(len(PE), np.nan) for c in cols}
V["entry_t"][:] = PE
nowv = np.zeros(len(PE)); i1v = np.searchsorted(t, PE - 60, "right") - 1
t_ = time.time()
for r, (E, i1) in enumerate(zip(PE, i1v)):
    now = Cc[i1]; nowv[r] = now; dE = tdate(E); V["day"][r] = dE; V["m1_last_t"][r] = t[i1]
    et = ny(E); V["t_et_hour"][r] = et.hour; V["t_et_min"][r] = et.minute
    V["t_phase"][r] = 0 if (et.hour >= 17 or et.hour < 3) else (1 if et.hour < 8 else (2 if et.hour < 13 else 3))
    V["t_th_hour"][r] = (datetime.fromtimestamp(int(E), timezone.utc) + timedelta(hours=7)).hour
    V["t_weekday"][r] = (date(1970, 1, 1) + timedelta(days=dE)).weekday()
    opn = datetime.combine(date(1970, 1, 1) + timedelta(days=dE - 1), datetime.min.time()) + timedelta(hours=17)
    V["t_min_open"][r] = int((et.replace(tzinfo=None) - opn).total_seconds() // 60)
    u = datetime.fromtimestamp(int(E), timezone.utc); cut = u.replace(hour=CUTH, minute=0, second=0)
    if cut <= u: cut += timedelta(days=1)
    V["t_min_cutoff"][r] = int((cut - u).total_seconds() // 60)
    V["t_us_dst"][r] = int(datetime.fromtimestamp(int(E), NY).utcoffset() == timedelta(hours=-4))
    V["t_min_830"][r] = int((et.replace(tzinfo=None) - et.replace(tzinfo=None, hour=8, minute=30, second=0)).total_seconds() // 60)
    # ADR and previous day
    prev = [d_ for d_ in order if d_ < dE and not S[d_]["stub"]]
    V["a_hist_days"][r] = len(prev); used = prev[-20:]; V["a_adr_days"][r] = len(used)
    adr = np.mean([S[d_]["hi"] - S[d_]["lo"] for d_ in used]) if len(used) >= 3 else np.nan
    V["a_adr_usd"][r] = adr; V["a_adr_pct"][r] = adr / now * 100
    if prev:
        P = S[prev[-1]]; pR = P["hi"] - P["lo"]
        V["a_yday_rng_adr"][r] = pR / adr
        V["d_pdh_adr"][r] = (now - P["hi"]) / adr; V["d_pdl_adr"][r] = (now - P["lo"]) / adr; V["d_pdc_adr"][r] = (now - P["cl"]) / adr
        pu = prev[:-1][-20:]
        if len(pu) >= 3:
            pa = np.mean([S[d_]["hi"] - S[d_]["lo"] for d_ in pu]); eff = abs(P["cl"] - P["op"]) / pR if pR > 0 else 0; q = pR / pa
            V["d_prev_type"][r] = 1 if (eff >= 0.6 and q >= 0.8) else (2 if q < 0.7 else (3 if (eff < 0.25 and q >= 1.0) else 0))
    # today so far
    tb = [i for i in range(S[dE]["a"], i1 + 1)] if dE in S and S[dE]["a"] <= i1 else []
    V["d_today_bars"][r] = len(tb)
    V["d_asia_done"][r] = int(V["t_phase"][r] != 0)
    if tb:
        thi = max(H[i] for i in tb); tlo = min(L[i] for i in tb); top = O[tb[0]]
        V["a_day_rng_adr"][r] = (thi - tlo) / adr
        V["d_day_pos"][r] = (now - tlo) / (thi - tlo) if thi > tlo else np.nan
        if prev:
            P = S[prev[-1]]; V["d_broke_pdh"][r] = int(thi > P["hi"]); V["d_broke_pdl"][r] = int(tlo < P["lo"])
            gp = top - P["cl"]; V["d_gap_adr"][r] = gp / adr
            V["d_gap_filled"][r] = int(tlo <= P["cl"]) if gp > 0 else (int(thi >= P["cl"]) if gp < 0 else 1)
        asia = [i for i in tb if nyh[i] >= 17 or nyh[i] < 3]
        if asia:
            ah = max(H[i] for i in asia); al = min(L[i] for i in asia)
            V["d_asia_rng_adr"][r] = (ah - al) / adr; V["d_asia_pos"][r] = (now - al) / (ah - al) if ah > al else np.nan
    # last 60 / 10 M1 bars
    if i1 >= 60:
        mv = sum(abs(Cc[i] - Cc[i - 1]) for i in range(i1 - 59, i1 + 1))
        V["a_mv60_pct"][r] = mv / 60 / now * 100; V["a_path60_adr"][r] = mv / adr
        V["a_rng60_adr"][r] = (H[i1 - 59:i1 + 1].max() - L[i1 - 59:i1 + 1].min()) / adr
    if i1 - 9 >= 1380: V["a_tv10_rel"][r] = TV[i1 - 9:i1 + 1].mean() / TV[i1 - 9 - 1380:i1 - 9].mean()
print(f"   time/day/M1 values done {time.time() - t_:.0f}s", flush=True)

LBM = 1440
for tf, pre in ((1, "m1"), (3, "m3"), (5, "m5"), (15, "m15"), (60, "h1")):
    b = tfbars(tf); n = len(b["h"])
    # last closed TF bar at each sampled entry: plain scan of candidates
    jBs = []
    for E in PE:
        dE = tdate(E); j = int(np.searchsorted(b["t0"], E - 60, "right")) - 1
        while j >= 0 and not (b["bend"][j] <= E or b["day"][j] < dE): j -= 1
        jBs.append(j)
    def s_at(j): return sum(b["tr"][j - 19:j + 1])                                   # 20 x ATR ending at the last closed bar (points)
    def s_prev(j): return sum(b["tr"][j - 20:j]) if j >= 20 else None                # 20 x ATR of the 20 bars before bar j (points)
    def atr_at(j): return s_at(j) * P_ / 20 if j >= 20 else np.nan
    full = tf in (1, 3, 5); LB = LBM // tf
    for r, (E, jB) in enumerate(zip(PE, jBs)):
        if not full: break
        adr = V["a_adr_usd"][r]; a = atr_at(jB); now = nowv[r]
        V[f"a_{pre}_atr_usd"][r] = a; V[f"a_{pre}_atr_adr"][r] = a / adr; V[f"a_{pre}_cost_atr"][r] = COST / a
        N5 = 5 * 1380 // tf; lo5 = max(1, jB + 1 - N5)
        if jB + 1 - lo5 >= 1380 // tf: V[f"a_{pre}_atr_rel5d"][r] = a / (sum(b["tr"][lo5:jB + 1]) * P_ / (jB + 1 - lo5))
        def okb(j): sp = s_prev(j); return (sp is not None and sp > 0), sp
        big = pin = vsp = None
        W = max(20, 1380 // tf)
        for g_ in range(0, LB):
            j = jB - g_
            if j < 0: break
            ok, sp = okb(j); rg = b["h"][j] - b["l"][j]; bd = abs(b["c"][j] - b["o"][j])
            uw = b["h"][j] - max(b["o"][j], b["c"][j]); dw = min(b["o"][j], b["c"][j]) - b["l"][j]
            if big is None and ok and 20 * rg >= 2 * sp: big = (g_, int(np.sign(b["c"][j] - b["o"][j])))
            if pin is None and ok and 20 * rg >= sp and 10 * bd <= 3 * rg and (10 * uw >= 6 * rg or 10 * dw >= 6 * rg):
                pin = (g_, 1 if 10 * dw >= 6 * rg else -1)
            if vsp is None and j >= W and W * b["tv"][j] >= 3 * sum(b["tv"][j - W:j]): vsp = g_
        V[f"f_{pre}_big_age"][r], V[f"f_{pre}_big_dir"][r] = big if big else (-1, 0)
        V[f"f_{pre}_pin_age"][r], V[f"f_{pre}_pin_dir"][r] = pin if pin else (-1, 0)
        V[f"f_{pre}_vspike_age"][r] = vsp if vsp is not None else -1
        ok, _ = okb(jB)
        V[f"f_{pre}_inside"][r] = int(jB >= 1 and ok and b["day"][jB] == b["day"][jB - 1] and b["h"][jB] < b["h"][jB - 1] and b["l"][jB] > b["l"][jB - 1])
        if jB >= 20:
            cnt = 0; hi = None; lo = None; s4 = 4 * s_at(jB)
            for j in range(jB, max(-1, jB - LB), -1):
                if b["day"][j] != b["day"][jB]: break
                hi = b["h"][j] if hi is None else max(hi, b["h"][j]); lo = b["l"][j] if lo is None else min(lo, b["l"][j])
                if 20 * (hi - lo) > s4: break
                cnt += 1
            V[f"f_{pre}_box_n"][r] = cnt
    for k in (2, 3, 4):
        piv, cnt, ext = zz(b, k); pc_ = f"{pre}k{k}"
        conf = np.array([x[3] for x in piv]); price = np.array([x[1] for x in piv]); kind = np.array([x[2] for x in piv]); pbar = np.array([x[0] for x in piv])
        # regime after each pivot + start pivot of the current regime value
        reg = []; kn = []; start = []; Hs = []; Ls = []; gaps = []
        for q in range(len(piv)):
            (Hs if kind[q] > 0 else Ls).append(price[q])
            if len(Hs) >= 2 and len(Ls) >= 2:
                rv = 1 if (Hs[-1] > Hs[-2] and Ls[-1] > Ls[-2]) else (-1 if (Hs[-1] < Hs[-2] and Ls[-1] < Ls[-2]) else 0); kv = True
                gaps.append(((int(Hs[-1]) - int(Hs[-2])) * P_, (int(Ls[-1]) - int(Ls[-2])) * P_))
            else: rv, kv = 0, False; gaps.append(None)
            st_ = q if (q == 0 or not kn[q - 1] or rv != reg[q - 1]) else start[q - 1]
            reg.append(rv); kn.append(kv); start.append(st_)
        tri = []
        if k == 3 and full:
            for j in range(4, len(piv)):
                sp = s_prev(pbar[j - 2])
                if not (sp is not None and sp > 0): continue
                lg = [abs(int(price[m]) - int(price[m - 1])) for m in range(j - 3, j + 1)]
                if all(20 * lg[m] <= 17 * lg[m - 1] for m in range(1, 4)): tri.append(conf[j])
            tri = np.array(sorted(tri))
        for r, (E, jB) in enumerate(zip(PE, jBs)):
            if jB < 0: continue
            q = int(np.searchsorted(conf, jB, "right")) - 1 if len(conf) else -1     # pivots confirmed by a closed bar
            if q >= 0 and kn[q]:
                V[f"{pc_}_reg"][r] = reg[q]; V[f"{pc_}_reg_age"][r] = (E - (b["tl"][conf[start[q]]] + 60)) // 60
                V[f"{pc_}_dh_atr"][r] = gaps[q][0] / atr_at(jB); V[f"{pc_}_dl_atr"][r] = gaps[q][1] / atr_at(jB)
                if full: V[f"{pc_}_n_sw"][r] = q - start[q]
            if not full: continue
            if q >= 0:
                a = atr_at(jB); ld = -kind[q]; lg = abs(ext[jB] - price[q] * P_); now = nowv[r]
                V[f"{pc_}_leg_dir"][r] = ld; V[f"{pc_}_leg_atr"][r] = lg / a
                V[f"{pc_}_retr_atr"][r] = (ext[jB] - now) * ld / a
                V[f"{pc_}_leg_min"][r] = (E - (b["tl"][pbar[q]] + 60)) // 60
                if q >= 1:
                    V[f"{pc_}_leg_ratio"][r] = lg / (abs(int(price[q]) - int(price[q - 1])) * P_)
                    hp = (price[q] if kind[q] > 0 else price[q - 1]) * P_; lp = (price[q] if kind[q] < 0 else price[q - 1]) * P_
                    V[f"{pc_}_rng_pos"][r] = (now - lp) / (hp - lp)
            if k == 3:
                g_ = [jB - x for x in tri if x <= jB and jB - x < LB]
                V[f"f_{pre}_tri_age"][r] = min(g_) if g_ else -1
    print(f"   TF {tf} done {time.time() - t_:.0f}s", flush=True)
for r in range(len(PE)): V["d_r10_atr5"][r] = (nowv[r] - round(nowv[r] / 10) * 10) / V["a_m5_atr_usd"][r]

rows = np.searchsorted(E_all, PE); mism = {}
for c in cols:
    a = CT[rows, ci[c]]; bb = V[c]
    same = (np.isnan(a) & np.isnan(bb)) | np.isclose(a, bb, rtol=1e-7, atol=1e-9)
    if (~same).sum():
        mism[c] = int((~same).sum())
        for r in np.flatnonzero(~same)[:3]:
            print(f"   {c} @ {datetime.fromtimestamp(int(PE[r]), timezone.utc):%Y-%m-%d %H:%M}: table {a[r]} vs recomputed {bb[r]}")
rep(f"B) independent recomputation, {len(PE)} entries x {len(cols)} columns: mismatching columns", len(mism), str(mism))

# ================= C) time travel ================================================================================================
import adx_ctx
cand = [E_all[np.flatnonzero(notoday)[len(np.flatnonzero(notoday)) // 2]]]                       # a session-open entry
tfq = dict(tdb.execute("SELECT x.entry_t, MIN(p.tf) FROM trades x JOIN params p USING(set_id) GROUP BY x.entry_t").fetchall())
for want, when in ((1, "2024-04-16"), (3, "2024-11-04"), (5, "2025-03-10"), (1, "2025-06-18"), (3, "2025-12-31"), (5, "2026-03-09"), (1, "2026-05-29")):
    t0 = adx_ctx.to_ts(when); j = np.searchsorted(E_all, t0)
    while tfq[int(E_all[j])] != want: j += 1
    cand.append(E_all[j])
for Ec in cand:
    out = os.path.join(os.environ.get("TEMP", "."), f"ctx_cut_{int(Ec)}.sqlite")
    if os.path.exists(out): os.remove(out)
    adx_ctx.build(cut=int(Ec), out=out, log=lambda *a: None)
    c2 = sqlite3.connect(out); cc = [r[1] for r in c2.execute("PRAGMA table_info(ctx)")]
    A2 = np.array(c2.execute(f"SELECT {','.join(cols)} FROM ctx ORDER BY entry_t").fetchall(), dtype=float); c2.close(); os.remove(out)
    F = CT[E_all <= Ec]
    ok = A2.shape == F.shape and cc == cols
    diff = int(np.sum(~((np.isnan(A2) & np.isnan(F)) | np.isclose(A2, F, rtol=0, atol=0)))) if ok else -1
    rep(f"C) rebuilt from bars cut at {datetime.fromtimestamp(int(Ec), timezone.utc):%Y-%m-%d %H:%M} (M{tfq[int(Ec)]} entry) vs full table, "
        f"{len(F)} rows", 0 if (ok and diff == 0) else 1, "" if ok else "shape/columns differ" if not ok else "")
    if ok and diff: print("   differing cells", diff)
print("RESULT:", "all ctx checks passed" if bad_total == 0 else f"{bad_total} check(s) failed")
