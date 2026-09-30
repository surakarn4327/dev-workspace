r"""Phase 3 (smart-ea): in which market patterns do AdxEmaVol trades win or lose? Shared code for p3_screen / p3_perm / p3_null_build.

Decisions agreed with the user 2026-09-28:
- all 432 parameter sets; a pattern "wins"/"loses" RELATIVE TO ITS OWN SET: residual e = r_std - mean r_std of the same
  (set, direction, half). Removing the set x direction x half mean means a pattern cannot look good just because BUY trades did
  better in a rising market, or because one half of the sandbox was better for that set.
- sandbox only: trades with entry >= 2024-04-15 and fully closed before 2026-06-01 (adx_asof.as_of). Halves split at HALF_T.
- a pattern = one level of a feature from table ctx at entry (structure/position in the cycle of the trade's OWN TF, activity/cost,
  time, footprints, day levels, M15/H1 background). Direction-carrying features are read relative to the trade (x dir).
- trades at the same entry time in different sets are not independent -> standard errors are clustered by trading day
  (ratio estimator), which also absorbs several trades of one set on one day.
- continuous features are cut at percentiles of the FIRST half (the first-half TRADES of that TF, so direction-relative values use each
  trade's own direction); neighbour thresholds = the same
  percentile band shifted -5 / +5 points; structural features are also recomputed with zigzag 2 and 4 ATR; regime labels also with
  a tolerance of 0.25 / 0.5 ATR on the pivot differences (dh/dl).
Outputs are descriptive statistics of trade outcomes per pattern; nothing here selects parameters (that is phase 4)."""
import os, sqlite3, calendar, datetime
import numpy as np

LIB_FROM = calendar.timegm(datetime.datetime(2024, 4, 15).timetuple())
SANDBOX_END = calendar.timegm(datetime.datetime(2026, 6, 1).timetuple())     # exam = 2026-06-01 onwards: never read
HALF_T = calendar.timegm(datetime.datetime(2025, 5, 8).timetuple())          # middle of the sandbox (by calendar)
# halves are split by TRADING DAY (17:00 New York key, same as trades.day), not by UTC midnight: the trading day 2025-05-08 starts at
# 17:00 NY on May 7 and was cut in two by a UTC split (bugs.md 2026-09-29). Second half = trading days >= 2025-05-08.
HALF_DAY = HALF_T // 86400
TFS = (1, 3, 5)
PCT = [0, 20, 40, 60, 80, 100]

# ---------------------------------------------------------------------------------------------------------------------------
def load(dbt):
    """trades of the sandbox + their ctx rows (aligned) from an adx_trades.sqlite file (real or synthetic null)."""
    db = sqlite3.connect(dbt)
    P = {r[0]: r[1] for r in db.execute("SELECT set_id, tf FROM params")}
    q = ("SELECT set_id, entry_t, exit_t, day, dir, r_std FROM trades WHERE entry_t >= ? AND exit_t + 60 <= ? ORDER BY set_id, entry_t")
    R = np.array(db.execute(q, (LIB_FROM, SANDBOX_END)).fetchall(), dtype=float)
    # the exam starts at TRADING DAY 2026-06-01 (17:00 NY May 31), not at UTC midnight: a trade opened after the Sunday-evening open and
    # closed before midnight UTC passes the time filter above but belongs to the exam. None in the real library; 36 / 72 in the
    # random-direction markets sf3 / sf5 (bugs.md 2026-09-30) -> drop by trading day.
    R = R[R[:, 3] < SANDBOX_END // 86400]
    T = dict(set_id=R[:, 0].astype(np.int64), entry_t=R[:, 1].astype(np.int64), day=R[:, 3].astype(np.int64),
             dir=R[:, 4].astype(np.int64), r=R[:, 5])
    assert T["entry_t"].max() < SANDBOX_END
    T["tf"] = np.array([P[s] for s in T["set_id"]], dtype=np.int64)
    cols = [r[1] for r in db.execute("PRAGMA table_info(ctx)")]
    C = np.array(db.execute(f"SELECT {','.join(cols)} FROM ctx WHERE entry_t < ? ORDER BY entry_t", (SANDBOX_END,)).fetchall(), dtype=float)
    key = C[:, 0].astype(np.int64); pos = np.searchsorted(key, T["entry_t"])
    assert np.all(key[pos] == T["entry_t"]), "trade without ctx row"
    X = {c: C[:, i] for i, c in enumerate(cols)}
    T["ci"] = pos                                                    # row of ctx for every trade
    T["half"] = (T["day"] >= HALF_DAY).astype(np.int64)
    # residual vs own set x direction x half
    g = (T["set_id"] * 2 + (T["dir"] > 0)) * 2 + T["half"]
    ug, gi = np.unique(g, return_inverse=True)
    mu = np.bincount(gi, T["r"]) / np.bincount(gi)
    win = (T["r"] > 0).astype(float); wmu = np.bincount(gi, win) / np.bincount(gi)
    T["e"] = T["r"] - mu[gi]; T["ew"] = win - wmu[gi]
    return T, X

# ---------------------------------------------------------------------------------------------------------------------------
def rel_pos(p, d):   return np.where(d > 0, p, 1.0 - p)             # position in a range, 1 = far side in trade direction

def _reg(X, pre, k, m):
    reg = X[f"{pre}k{k}_reg"]; dh = X[f"{pre}k{k}_dh_atr"]; dl = X[f"{pre}k{k}_dl_atr"]
    if m == 0: return reg
    r = np.where((dh > m) & (dl > m), 1.0, np.where((dh < -m) & (dl < -m), -1.0, 0.0))
    return np.where(np.isfinite(reg), r, np.nan)

REGV = [dict(k=3, m=0.0), dict(k=2, m=0.0), dict(k=4, m=0.0), dict(k=3, m=0.25), dict(k=3, m=0.5)]   # first = primary
KV = [3, 2, 4]

def specs(g):
    """feature specifications for trades of TF M<g>. cat: fn(X, d, v) -> int labels (-1 = excluded), levels, variants (first = primary).
    q: fn(X, d, k) -> float values, percentile bands of the first half, variants = shifts +-5 and zigzag k 2/4 when structural."""
    o = f"m{g}"; S = []
    def cat(name, grp, levels, variants, fn, desc): S.append(dict(name=name, grp=grp, kind="cat", levels=levels, variants=variants, fn=fn, desc=desc))
    def qf(name, grp, fn, structural, desc): S.append(dict(name=name, grp=grp, kind="q", structural=structural, fn=fn, desc=desc))
    nanl = lambda a, lab: np.where(np.isfinite(a), lab, -1)
    # ---- A: structure / position in the cycle of the trade's OWN TF
    def f_reg(X, d, v, pre=o):
        r = _reg(X, pre, v["k"], v["m"]) * d
        return nanl(r, np.where(r > 0, 0, np.where(r < 0, 1, 2)))
    cat("A_reg", "A", ["ตาม", "สวน", "sideway"], REGV, f_reg, f"สภาพตลาด {o.upper()} เทียบทิศไม้")
    def f_nsw(X, d, v):
        n = X[f"{o}k{v['k']}_n_sw"]; return nanl(n, np.minimum(np.nan_to_num(n), 3).astype(int))
    cat("A_nsw", "A", ["0 ขา", "1 ขา", "2 ขา", "3+ ขา"], [dict(k=k) for k in KV], f_nsw, f"ย่อ/เด้งไปแล้วกี่ขาในสภาพ {o.upper()} ปัจจุบัน")
    def f_leg(X, d, v):
        x = X[f"{o}k{v['k']}_leg_dir"] * d; return nanl(x, np.where(x > 0, 0, 1))
    cat("A_leg", "A", ["ขาปัจจุบันไปทางไม้", "ขาปัจจุบันสวนไม้"], [dict(k=k) for k in KV], f_leg, f"ทิศขาที่กำลังวิ่ง {o.upper()} เทียบไม้")
    def f_cyc(X, d, v):
        r = _reg(X, o, v["k"], v["m"]) * d; x = X[f"{o}k{v['k']}_leg_dir"] * d
        lab = np.where(r > 0, 0, np.where(r < 0, 2, 4)) + np.where(x > 0, 0, 1)
        return np.where(np.isfinite(r) & np.isfinite(x), lab, -1)
    cat("A_cyc", "A", ["เทรนด์ตาม+ขาไปทางไม้", "เทรนด์ตาม+กำลังย่อ", "เทรนด์สวน+ขาไปทางไม้(เด้ง)", "เทรนด์สวน+ขาสวนไม้",
                       "sideway+ขาไปทางไม้", "sideway+ขาสวนไม้"], REGV, f_cyc, f"สภาพ {o.upper()} × ขาปัจจุบัน เทียบไม้ (ตำแหน่งในรอบ)")
    for nm, col, dsc in (("A_regage", "reg_age", "อยู่ในสภาพตลาดนี้มากี่นาที"), ("A_legatr", "leg_atr", "ขาปัจจุบันยาวกี่ ATR"),
                         ("A_legratio", "leg_ratio", "ขาปัจจุบัน ÷ ขาก่อน"), ("A_retr", "retr_atr", "ถอยจากจุดสุดของขาปัจจุบันกี่ ATR"),
                         ("A_legmin", "leg_min", "ขาปัจจุบันเริ่มมากี่นาที")):
        qf(nm, "A", (lambda c: lambda X, d, k: X[f"{o}k{k}_{c}"])(col), True, f"{dsc} ({o.upper()})")
    qf("A_rngpos", "A", lambda X, d, k: rel_pos(X[f"{o}k{k}_rng_pos"], d), True, f"ตำแหน่งราคาเทียบ pivot H/L ล่าสุด {o.upper()} (1 = ฝั่งทิศไม้)")
    # ---- D: background M15 / H1 regime relative to the trade
    for pre in ("m15", "h1"):
        cat(f"D_{pre}", "D", ["ตาม", "สวน", "sideway"], REGV, (lambda p: lambda X, d, v: f_reg(X, d, v, p))(pre), f"สภาพตลาด {pre.upper()} เทียบทิศไม้")
    # ---- B: activity / cost / time
    for nm, col, dsc in (("B_cost", f"a_{o}_cost_atr", "ต้นทุน ÷ ATR ของ TF ไม้"), ("B_atrrel", f"a_{o}_atr_rel5d", "ATR TF ไม้ ÷ ค่าเฉลี่ย 5 วัน"),
                         ("B_atradr", f"a_{o}_atr_adr", "ATR TF ไม้ ÷ ADR"), ("B_adrpct", "a_adr_pct", "ADR % ของราคา"),
                         ("B_mv60", "a_mv60_pct", "ขยับต่อนาที 60 นาที (% ราคา)"), ("B_path60", "a_path60_adr", "ระยะวิ่ง 60 นาที ÷ ADR"),
                         ("B_rng60", "a_rng60_adr", "ช่วงราคา 60 นาที ÷ ADR"), ("B_tv10", "a_tv10_rel", "tick volume 10 นาที ÷ 1 วัน"),
                         ("B_dayrng", "a_day_rng_adr", "ช่วงวันนี้ถึงตอนนี้ ÷ ADR"), ("B_ydayrng", "a_yday_rng_adr", "ช่วงเมื่อวาน ÷ ADR"),
                         ("B_mincut", "t_min_cutoff", "นาทีที่เหลือถึง cutoff"), ("B_minopen", "t_min_open", "นาทีจากเปิดวัน")):
        qf(nm, "B", (lambda c: lambda X, d, k: X[c])(col), False, dsc)
    def f_phase(X, d, v):
        h = (X["t_et_hour"] + v["s"]) % 24
        return np.where((h >= 17) | (h < 3), 0, np.where(h < 8, 1, np.where(h < 13, 2, 3)))
    cat("B_phase", "B", ["asia", "london", "newyork", "late"], [dict(s=0), dict(s=1), dict(s=-1)], f_phase, "ช่วงของวัน (นาฬิกานิวยอร์ก; ค่าข้างเคียง = เลื่อนขอบ ±1 ชม.)")
    def f_news(X, d, v):
        m = X["t_min_830"]; f = v["f"]
        return np.where((m >= -60 * f) & (m < 0), 0, np.where((m >= 0) & (m < 30 * f), 1, np.where((m >= 30 * f) & (m < 120 * f), 2, 3)))
    cat("B_news", "B", ["60 นาทีก่อน 08:30 NY", "0-30 นาทีหลัง 08:30", "30-120 นาทีหลัง", "เวลาอื่น"], [dict(f=1.0), dict(f=0.67), dict(f=1.5)],
        f_news, "ระยะจากเวลาประกาศตัวเลขสหรัฐ 08:30 NY (ค่าข้างเคียง = หน้าต่าง ×0.67/×1.5)")
    cat("B_wd", "B", ["จันทร์", "อังคาร", "พุธ", "พฤหัส", "ศุกร์"], [dict()], lambda X, d, v: np.where(X["t_weekday"] <= 4, X["t_weekday"], -1).astype(int), "วันในสัปดาห์")
    cat("B_dst", "B", ["ฤดูหนาว", "ฤดูร้อนสหรัฐ"], [dict()], lambda X, d, v: X["t_us_dst"].astype(int), "ช่วงเวลาออมแสงสหรัฐ")
    # ---- C: footprints (own TF) and day levels
    def f_fp(kind):
        def f(X, d, v):
            a = X[f"f_{o}_{kind}_age"]; x = X[f"f_{o}_{kind}_dir"] * d; rec = (a >= 0) & (a <= v["a"])
            return np.where(rec, np.where(x > 0, 0, 1), 2)
        return f
    AV = [dict(a=5), dict(a=3), dict(a=10)]
    cat("C_big", "C", ["แท่งใหญ่ทิศไม้ ≤ N แท่ง", "แท่งใหญ่สวนไม้ ≤ N แท่ง", "ไม่มีแท่งใหญ่ล่าสุด"], AV, f_fp("big"), f"แท่งใหญ่ ≥ 2 ATR {o.upper()} ล่าสุด (N = 5; ข้างเคียง 3/10)")
    cat("C_pin", "C", ["pinbar ทิศไม้ ≤ N แท่ง", "pinbar สวนไม้ ≤ N แท่ง", "ไม่มี pinbar ล่าสุด"], AV, f_fp("pin"), f"pinbar {o.upper()} ล่าสุด (ทิศ = ด้านที่ปฏิเสธ; N = 5)")
    def f_age(kind):
        return lambda X, d, v: np.where((X[f"f_{o}_{kind}_age"] >= 0) & (X[f"f_{o}_{kind}_age"] <= v["a"]), 0, 1)
    cat("C_vsp", "C", ["volume พุ่ง ≤ N แท่ง", "ไม่มี"], AV, f_age("vspike"), f"tick volume ≥ 3 เท่า {o.upper()} ล่าสุด (N = 5)")
    cat("C_tri", "C", ["สามเหลี่ยมบีบตัว ≤ N แท่ง", "ไม่มี"], [dict(a=10), dict(a=5), dict(a=20)], f_age("tri"), f"สามเหลี่ยมบีบตัว {o.upper()} ล่าสุด (N = 10)")
    cat("C_inside", "C", ["แท่งล่าสุด inside", "ไม่ใช่"], [dict()], lambda X, d, v: np.where(X[f"f_{o}_inside"] > 0, 0, 1), f"แท่ง {o.upper()} ล่าสุดเป็น inside bar")
    cat("C_box", "C", ["อยู่ในกรอบ ≥ N แท่ง", "ไม่อยู่ในกรอบ"], [dict(a=20), dict(a=15), dict(a=30)],
        lambda X, d, v: nanl(X[f"f_{o}_box_n"], np.where(X[f"f_{o}_box_n"] >= v["a"], 0, 1)), f"อยู่ในกรอบ ≤ 4 ATR {o.upper()} มา ≥ N แท่ง (N = 20)")
    def f_brk(X, d, v):
        a = np.where(d > 0, X["d_broke_pdh"], X["d_broke_pdl"]); b = np.where(d > 0, X["d_broke_pdl"], X["d_broke_pdh"])
        return np.where(np.isfinite(a) & np.isfinite(b), np.where(a > 0, np.where(b > 0, 2, 0), np.where(b > 0, 1, 3)), -1)
    cat("C_brk", "C", ["ทะลุ H/L เมื่อวานฝั่งไม้แล้ว", "ทะลุฝั่งตรงข้ามแล้ว", "ทะลุทั้งสองฝั่ง", "ยังไม่ทะลุ"], [dict()], f_brk, "วันนี้ทะลุ high/low เมื่อวานแล้วหรือยัง (เทียบทิศไม้)")
    cat("C_gapf", "C", ["gap ปิดแล้ว", "gap ยังไม่ปิด"], [dict()], lambda X, d, v: nanl(X["d_gap_filled"], np.where(X["d_gap_filled"] > 0, 0, 1)), "gap เปิดวันปิดแล้วหรือยัง")
    def f_asia(X, d, v):
        p = rel_pos(X["d_asia_pos"], d); m = v["m"]; ok = np.isfinite(p) & (X["d_asia_done"] > 0)
        return np.where(ok, np.where(p > 1 + m, 0, np.where(p < -m, 1, 2)), -1)
    cat("C_asia", "C", ["เลยกรอบเอเชียฝั่งไม้", "เลยกรอบเอเชียฝั่งตรงข้าม", "ในกรอบเอเชีย"], [dict(m=0.0), dict(m=0.1), dict(m=0.25)], f_asia,
        "หลังช่วงเอเชีย ราคาเทียบกรอบเอเชีย (ข้างเคียง = ต้องเลยขอบ 10%/25% ของกรอบ)")
    cat("C_prev", "C", ["เมื่อวานปกติ", "เมื่อวานเทรนด์", "เมื่อวานเงียบ", "เมื่อวานสองทาง"], [dict()],
        lambda X, d, v: nanl(X["d_prev_type"], np.nan_to_num(X["d_prev_type"]).astype(int)), "ประเภทวันเมื่อวาน")
    for nm, fn, dsc in (("C_daypos", lambda X, d, k: rel_pos(X["d_day_pos"], d), "ตำแหน่งในกรอบวันนี้ (1 = ฝั่งทิศไม้)"),
                        ("C_pdx", lambda X, d, k: np.where(d > 0, X["d_pdh_adr"], -X["d_pdl_adr"]), "ระยะเลย high/low เมื่อวานฝั่งทิศไม้ ÷ ADR (บวก = เลยไปแล้ว)"),
                        ("C_pdc", lambda X, d, k: X["d_pdc_adr"] * d, "ราคาเทียบราคาปิดเมื่อวานตามทิศไม้ ÷ ADR"),
                        ("C_gap", lambda X, d, k: X["d_gap_adr"] * d, "gap เปิดวันตามทิศไม้ ÷ ADR"),
                        ("C_asiarng", lambda X, d, k: X["d_asia_rng_adr"], "ขนาดกรอบเอเชีย ÷ ADR"),
                        ("C_r10", lambda X, d, k: np.abs(X["d_r10_atr5"]), "ห่างเลขกลม $10 ÷ ATR M5")):
        qf(nm, "C", fn, False, dsc)
    return S

# ---------------------------------------------------------------------------------------------------------------------------
def q_bands(vals_h1, lo, hi):
    """value interval of the percentile band [lo, hi) of the first-half values (hi = 100 -> open ended)"""
    v = vals_h1[np.isfinite(vals_h1)]
    a = -np.inf if lo <= 0 else np.percentile(v, lo); b = np.inf if hi >= 100 else np.percentile(v, hi)
    return a, b

def pattern_masks(T, X, g, sp, prim_only=False):
    """all patterns of one spec for trades of TF g. Returns list of (level_name, primary_mask, [variant masks]).
    Percentile bands of q features come from the first-half trades of this TF."""
    m = T["tf"] == g; ci = T["ci"][m]; d = T["dir"][m]
    Xm = {c: v[ci] for c, v in X.items()}
    out = []
    if sp["kind"] == "cat":
        labs = [sp["fn"](Xm, d, v) for v in (sp["variants"][:1] if prim_only else sp["variants"])]
        for li, ln in enumerate(sp["levels"]):
            out.append((ln, labs[0] == li, [L == li for L in labs[1:]]))
        return out
    # q feature: percentile bands of the first half computed for each k separately (distinct entries, both directions -> use +1 and -1
    # rows so direction-relative features get the distribution the trades actually see)
    ks = KV if (sp["structural"] and not prim_only) else [3]
    Tm = {k: sp["fn"](Xm, d, k) for k in ks}
    # reference distribution: the first-half TRADES of this TF (dir-relative values need the trade direction)
    mh = T["half"][m] == 0
    ref = {k: Tm[k][mh] for k in ks}
    for b in range(5):
        lo, hi = PCT[b], PCT[b + 1]; nm = f"Q{b + 1} ({lo}-{hi}%)"
        def band(k, l, h):
            a, z = q_bands(ref[k], l, h); x = Tm[k]
            return np.isfinite(x) & (x >= a) & ((x < z) if h < 100 else True)
        prim = band(3, lo, hi)
        if prim_only: out.append((nm, prim, [])); continue
        var = [band(3, max(0, lo - 5), hi - 5 if hi < 100 else 100), band(3, lo + 5 if lo > 0 else 0, min(100, hi + 5))]
        if sp["structural"]: var += [band(2, lo, hi), band(4, lo, hi)]
        out.append((nm, prim, var))
    return out

# ---------------------------------------------------------------------------------------------------------------------------
def cstat(e, mask, di, nd):
    """mean of e over mask with a day-clustered SE (ratio estimator). returns mean, se, t, n"""
    if not mask.any(): return np.nan, np.nan, 0.0, 0
    cnt = np.bincount(di[mask], minlength=nd).astype(float); s = np.bincount(di[mask], e[mask], minlength=nd)
    N = cnt.sum(); mu = s.sum() / N; D = (cnt > 0).sum()
    se = np.sqrt(((s - mu * cnt) ** 2).sum() * D / max(D - 1, 1)) / N
    return mu, se, (mu / se if se > 0 else 0.0), int(N)

def group_arrays(T, g):
    m = T["tf"] == g
    ud, di = np.unique(T["day"][m], return_inverse=True)
    us, si = np.unique(T["set_id"][m], return_inverse=True)
    return dict(m=m, e=T["e"][m], ew=T["ew"][m], r=T["r"][m], di=di, nd=len(ud), si=si, ns=len(us),
                half=T["half"][m], dir=T["dir"][m], entry=T["entry_t"][m], day=T["day"][m])

def evaluate(G, mask, variants=()):
    """all statistics for one pattern (mask over the TF-group trades)"""
    e, di, nd = G["e"], G["di"], G["nd"]
    mu, se, t, n = cstat(e, mask, di, nd)
    R = dict(n=n, days=int(len(np.unique(di[mask]))) if n else 0, lift=mu, se=se, t=t,
             wlift=cstat(G["ew"], mask, di, nd)[0], r_mean=(G["r"][mask].mean() if n else np.nan), share=n / len(e))
    for nm, sub in (("h1", G["half"] == 0), ("h2", G["half"] == 1), ("buy", G["dir"] > 0), ("sell", G["dir"] < 0)):
        a, b, c, k = cstat(e, mask & sub, di, nd); R[nm] = a; R[nm + "_t"] = c; R[nm + "_n"] = k
    # per-set agreement (sets with >= 30 trades in the pattern)
    cs = np.bincount(G["si"][mask], minlength=G["ns"]); ss = np.bincount(G["si"][mask], e[mask], minlength=G["ns"])
    ok = cs >= 30
    R["sets_n"] = int(ok.sum()); R["sets_same"] = float(np.mean(np.sign(ss[ok]) == np.sign(mu))) if ok.any() and np.isfinite(mu) else np.nan
    R["var_lift"] = []; R["var_t"] = []
    for vm in variants:
        a, b, c, k = cstat(e, vm, di, nd); R["var_lift"].append(a); R["var_t"].append(c)
    return R

def all_patterns(T, X, stats=True):
    """evaluate every pattern of every TF. returns list of result dicts"""
    res = []
    for g in TFS:
        G = group_arrays(T, g)
        for sp in specs(g):
            for ln, pm, vms in pattern_masks(T, X, g, sp):
                R = evaluate(G, pm, vms) if stats else {}
                R.update(tf=g, feat=sp["name"], grp=sp["grp"], level=ln, desc=sp["desc"], n_var=len(vms))
                res.append(R)
    return res
