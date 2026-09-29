r"""Phase 2: market context at entry for every trade in adx_trades.sqlite -> table `ctx` (one row per distinct entry_t) + descriptions
in table `columns` (tbl = 'ctx'). Descriptive only: no outcome / R / P&L is read or written here.

TIME RULE (the whole point of this file): a row for entry time E uses ONLY M1 bars that were closed before E (bar open t <= E - 60)
and only TF bars that were fully closed at E (natural end of the TF bucket <= E, or the bucket belongs to an earlier trading day).
Pivots count only once confirmed by a closed bar. Checked by adx_ctx_check.py (independent recomputation + rebuilding from bars cut at E).

Context is a property of the moment, not of the parameter set, so it is stored once per entry_t; join trades.entry_t = ctx.entry_t.
Signed values (regime, leg direction, bar direction, distances) are stored as they are (+ = up); to read them relative to a trade
multiply by trades.dir.

Units: sizes in ATR of that TF (mean true range of the 20 closed bars ending at the last closed bar) or ADR (mean day range of up to 20
previous trading days, needs >= 3 days: user decision 2026-09-28, a_adr_days tells how many were used). NULL = not enough history yet
(only in the first days after data start, see adx_ctx_check.py) or not defined (e.g. no pivot yet).
Usage: python adx_ctx.py   (after adx_build.py; ~2-3 min). Env CTX_TO (UTC 'YYYY-MM-DD HH:MM' or epoch) + CTX_OUT (file) = build from
bars before CTX_TO only, entries <= CTX_TO, into a separate file (time-travel test)."""
import os, sqlite3, time, json
import numpy as np
import broker as BK
from dc_sessions import sessions

KS = (2.0, 3.0, 4.0)                 # zigzag reversal thresholds in ATR of the TF (user chose all three, 2026-09-28)
TF_FULL, TF_BG = (1, 3, 5), (15, 60) # M1/M3/M5 full structure; M15/H1 regime only (background)
DAYBARS = 1380                       # nominal M1 bars of one trading day (23 h), same window as dc_catalog_c.py
LB_MIN = 1440                        # footprint look-back (minutes); older than this -> age -1
DBT = os.path.join(os.path.dirname(BK.DB), "adx_trades.sqlite")

def to_ts(s):
    if s is None: return None
    s = str(s)
    if s.isdigit(): return int(s)
    from datetime import datetime, timezone
    return int(datetime.strptime(s, "%Y-%m-%d %H:%M" if len(s) > 10 else "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp())

def load(cut):
    db = sqlite3.connect(BK.DB)
    q = "SELECT t,o,h,l,c,tick_vol FROM bars_m1" + (f" WHERE t < {cut}" if cut else "") + " ORDER BY t"
    R = np.array(db.execute(q).fetchall(), dtype=float)
    t = R[:, 0].astype(np.int64); sid, day, et = sessions(t)
    return dict(t=t, o=R[:, 1], h=R[:, 2], l=R[:, 3], c=R[:, 4], tv=R[:, 5], sid=sid, day=day)

def resample(M, tf):
    t = M["t"]; key = M["sid"] * 10 ** 7 + t // (tf * 60)
    st = np.r_[0, np.flatnonzero(np.diff(key)) + 1]; en = np.r_[st[1:], len(t)]
    B = dict(t_open=t[st], t_last=t[en - 1], o=M["o"][st], c=M["c"][en - 1], h=np.maximum.reduceat(M["h"], st),
             l=np.minimum.reduceat(M["l"], st), tv=np.add.reduceat(M["tv"], st), day=M["day"][st], sid=M["sid"][st])
    B["end"] = (B["t_open"] // (tf * 60) + 1) * tf * 60
    # every threshold decision is made in INTEGER price points (prices are on the broker's tick grid), so ties such as
    # "moved exactly k x ATR" are decided exactly, not by floating-point noise of a long running sum (bugs.md 2026-09-28)
    for x in ("o", "h", "l", "c"): B[x + "i"] = np.rint(B[x] / BK.POINT).astype(np.int64)
    pci = np.r_[B["ci"][0], B["ci"][:-1]]
    B["tri"] = np.maximum(B["hi"], pci) - np.minimum(B["li"], pci); B["csi"] = np.r_[0, np.cumsum(B["tri"])]
    B["tr"] = B["tri"] * BK.POINT; B["cs"] = B["csi"] * BK.POINT
    n = len(st); s20 = np.full(n, -1, np.int64); s20[20:] = B["csi"][20:n] - B["csi"][:n - 20]   # sum of the 20 PREVIOUS true ranges
    B["s20p"] = s20; B["atr_prev"] = np.where(s20 >= 0, s20 * BK.POINT / 20, np.nan)
    return B

def last_closed(B, E, dE):
    j = np.searchsorted(B["t_open"], E - 60, "right") - 1
    jj = np.clip(j, 0, None)
    closed = (B["end"][jj] <= E) | (B["day"][jj] < dE)
    return np.where(closed, j, j - 1)

def zigzag_state(B, k):
    """same rule as cat_struct.zigzag (reversal >= k x ATR20 of the 20 previous bars), in integer points with the threshold kept as
    20ths (20*move >= k*sum20) so every comparison is exact; plus per-bar state: ncf[j] = pivots confirmed after bar j,
    EP[j] = extreme of the leg in progress. Pivot prices returned in price units."""
    bh, bl, bc, S = B["hi"].tolist(), B["li"].tolist(), B["ci"].tolist(), B["s20p"].tolist(); k = int(k)
    n = len(bh); piv = []; dirn = 0; ep = bc[0]; ei = 0; stp = bc[0]
    ncf = np.zeros(n, np.int64); EP = np.full(n, np.nan)
    for j in range(1, n):
        if S[j] >= 0:
            th = k * S[j]; h20 = 20 * bh[j]; l20 = 20 * bl[j]
            if dirn == 0:
                if h20 >= 20 * stp + th: dirn, ep, ei = 1, bh[j], j
                elif l20 <= 20 * stp - th: dirn, ep, ei = -1, bl[j], j
            elif dirn == 1:
                if bh[j] >= ep: ep, ei = bh[j], j
                elif l20 <= 20 * ep - th: piv.append((ei, ep, 1, j)); dirn, ep, ei = -1, bl[j], j
            else:
                if bl[j] <= ep: ep, ei = bl[j], j
                elif h20 >= 20 * ep + th: piv.append((ei, ep, -1, j)); dirn, ep, ei = 1, bh[j], j
        ncf[j] = len(piv)
        if dirn != 0: EP[j] = ep * BK.POINT
    a = np.array(piv, dtype=np.int64).reshape(-1, 4)
    return a[:, 0], a[:, 1] * BK.POINT, a[:, 2], a[:, 3], ncf, EP

def regime_after(p, kind):
    """regime once pivot q is confirmed (+1 higher high & higher low / -1 lower high & lower low / 0 otherwise), known once >= 2 highs
    and >= 2 lows exist (same rule as cat_episodes.regime_bars); chg[q] = pivot at which the current regime value started"""
    n = len(p); reg = np.zeros(n, np.int64); known = np.zeros(n, bool); chg = np.zeros(n, np.int64); H = []; L = []
    dH = np.full(n, np.nan); dL = np.full(n, np.nan)                 # last high - previous high, last low - previous low (price units)
    for q in range(n):
        (H if kind[q] > 0 else L).append(p[q])
        if len(H) >= 2 and len(L) >= 2:
            known[q] = True
            reg[q] = 1 if (H[-1] > H[-2] and L[-1] > L[-2]) else (-1 if (H[-1] < H[-2] and L[-1] < L[-2]) else 0)
            dH[q] = H[-1] - H[-2]; dL[q] = L[-1] - L[-2]
        chg[q] = q if (q == 0 or not known[q - 1] or reg[q] != reg[q - 1]) else chg[q - 1]
    return reg, known, chg, dH, dL

def build(cut=None, out=None, log=print):
    t0 = time.time()
    tdb = sqlite3.connect(DBT)
    meta = dict(tdb.execute("SELECT k, v FROM meta").fetchall())
    COST = float(meta["cost_std_price"]); CUT_H = int(meta["cutoff_server_hour"])
    E = np.array([r[0] for r in tdb.execute("SELECT DISTINCT entry_t FROM trades" + (f" WHERE entry_t <= {cut}" if cut else "") +
                                             " ORDER BY entry_t")], dtype=np.int64)
    M = load(cut); t = M["t"]; nE = len(E)
    if not cut:
        # guard: ctx reads bars from gold_dc.sqlite, the trade library was built from the bars file. If new bars were added and only one
        # of the two was rebuilt, ctx would silently describe new trades with stale bars -> refuse (rebuild dc_build.py first).
        z = np.load(BK.BARS); tb = BK.server_to_utc(z["t"].astype(np.int64)); keep = tb >= BK.T0
        same = keep.sum() == len(t) and np.array_equal(tb[keep], t) and np.allclose(z["c"][keep], M["c"], rtol=0, atol=1e-9)
        last_lib = meta.get("last_bar_utc", ""); last_dc = time.strftime("%Y-%m-%d %H:%M", time.gmtime(int(t[-1])))
        if not same or last_lib != last_dc:
            raise RuntimeError(f"bars differ: gold_dc.sqlite last bar {last_dc} ({len(t)} bars), trade library last bar {last_lib}, bars file "
                               f"{int(keep.sum())} bars -> run dc_build.py (+ catalog steps) and adx_build.py on the same bars file first")
        if E.max() - 60 > t[-1]: raise RuntimeError("entries after the last bar of gold_dc.sqlite")
    C, D, dE, i1 = compute(E, M, COST, CUT_H, log, t0)
    return _write(E, M, C, D, dE, i1, tdb, out, cut, log, t0)

def compute(E, M, COST, CUT_H, log=print, t0=None):
    """context columns for an array of UTC times E (sorted), as if a trade entered at each E. Same TIME RULE as the ctx table:
    only M1 bars with t <= E-60 and TF bars fully closed at E. Used by build() (E = entry times) and by phase 3B (E = decision
    times while a trade is open, hold_build.py). Returns (columns {name: (array, sql type)}, descriptions, trading day, last M1 index)."""
    t0 = time.time() if t0 is None else t0
    E = np.asarray(E, dtype=np.int64); t = M["t"]; nE = len(E)
    _, dE, _ = sessions(E)
    i1 = np.searchsorted(t, E - 60, "right") - 1                     # last M1 bar closed before E
    now = M["c"][i1]
    C = {}; D = {}                                                    # column arrays / descriptions
    def put(name, arr, desc, kind="REAL"): C[name] = (np.asarray(arr, dtype=float), kind); D[name] = desc
    nan = np.nan

    # ---------------- time -------------------------------------------------------------------------------------------------------
    dst = BK.us_dst(E); et_sec = E - np.where(dst, 4, 5) * 3600
    eth = (et_sec // 3600) % 24
    ph = np.where((eth >= 17) | (eth < 3), 0, np.where(eth < 8, 1, np.where(eth < 13, 2, 3)))
    off = E - BK.server_to_utc(E); serv = E + off
    nxt = (serv // 86400) * 86400 + CUT_H * 3600; nxt = np.where(nxt <= serv, nxt + 86400, nxt)
    put("t_et_hour", eth, "ชั่วโมงตามนาฬิกานิวยอร์ก ณ เวลาเข้าไม้ (0-23)", "INTEGER")
    put("t_et_min", (et_sec // 60) % 60, "นาทีของชั่วโมง (นาฬิกานิวยอร์ก) ณ เวลาเข้าไม้", "INTEGER")
    put("t_phase", ph, "ช่วงของวัน (นาฬิกานิวยอร์ก): 0 asia 17:00-02:59, 1 london 03:00-07:59, 2 newyork 08:00-12:59, 3 late 13:00-16:59", "INTEGER")
    put("t_th_hour", ((E // 3600) + 7) % 24, "ชั่วโมงเวลาไทย (UTC+7) ณ เวลาเข้าไม้", "INTEGER")
    put("t_weekday", (dE + 3) % 7, "วันในสัปดาห์ของวันเทรด (0 จันทร์ ... 4 ศุกร์; วันเทรดเริ่ม 17:00 นิวยอร์กของเย็นก่อนหน้า)", "INTEGER")
    put("t_min_open", (et_sec - (dE * 86400 - 7 * 3600)) // 60, "นาทีนับจากเปิดวันเทรด (17:00 นิวยอร์ก) ถึงเวลาเข้าไม้", "INTEGER")
    put("t_min_cutoff", (nxt - serv) // 60, f"นาทีที่เหลือจากเวลาเข้าไม้ถึง cutoff ของ EA ({CUT_H}:00 เวลา server ของ broker)", "INTEGER")
    put("t_us_dst", dst.astype(int), "1 = ช่วงเวลาออมแสงสหรัฐ (ฤดูร้อน: ตลาดเปิด 05:00 ไทย), 0 = ฤดูหนาว (06:00 ไทย)", "INTEGER")
    put("t_min_830", (et_sec - ((et_sec // 86400) * 86400 + 510 * 60)) // 60,
        "นาทีห่างจาก 08:30 นิวยอร์ก (เวลาประกาศตัวเลขสหรัฐ) ของวันปฏิทินนิวยอร์กเดียวกัน: ลบ = ก่อน 08:30, บวก = หลัง", "INTEGER")
    log(f"entries {nE}, M1 bars {len(t)}, time done {time.time() - t0:.0f}s")

    # ---------------- sessions / ADR / day levels ----------------------------------------------------------------------------------
    sid = M["sid"]; ss = np.r_[0, np.flatnonzero(np.diff(sid)) + 1]; se = np.r_[ss[1:], len(t)]
    sday = M["day"][ss]; nb = se - ss
    shi = np.maximum.reduceat(M["h"], ss); slo = np.minimum.reduceat(M["l"], ss); sop = M["o"][ss]; scl = M["c"][se - 1]
    stub = np.zeros(len(ss), bool)
    for s in range(1, len(ss)):                                        # stub = < 25% of the median bars of up to 20 previous sessions
        stub[s] = nb[s] < 0.25 * np.median(nb[max(0, s - 20):s])
    V = np.flatnonzero(~stub); vday = sday[V]; vR = (shi - slo)[V]
    m = np.searchsorted(vday, dE, "left")                             # number of valid sessions before today's date
    adr_days = np.minimum(m, 20); cR = np.r_[0, np.cumsum(vR)]
    adr = np.where(adr_days >= 3, (cR[m] - cR[m - adr_days]) / np.maximum(adr_days, 1), nan)
    has_prev = m >= 1; pv = V[np.clip(m - 1, 0, None)]
    pdh = np.where(has_prev, shi[pv], nan); pdl = np.where(has_prev, slo[pv], nan); pdc = np.where(has_prev, scl[pv], nan)
    pR = pdh - pdl
    # previous day type with its own ADR (>= 3 days)
    pm = np.clip(m - 1, 0, None); pad = np.minimum(pm, 20)
    padr = np.where(has_prev & (pad >= 3), (cR[pm] - cR[pm - pad]) / np.maximum(pad, 1), nan)
    peff = np.where(pR > 0, np.abs(scl[pv] - sop[pv]) / np.where(pR > 0, pR, 1), 0); rr = pR / padr
    ptype = np.where(~np.isfinite(rr), nan, np.where((peff >= 0.6) & (rr >= 0.8), 1, np.where(rr < 0.7, 2,
                     np.where((peff < 0.25) & (rr >= 1.0), 3, 0))))
    # today so far (running within each session)
    rhi = np.empty(len(t)); rlo = np.empty(len(t)); ahi = np.full(len(t), nan); alo = np.full(len(t), nan)
    et_m1 = ((t - np.where(BK.us_dst(t), 4, 5) * 3600) // 3600) % 24; asia_m1 = (et_m1 >= 17) | (et_m1 < 3)
    for a, b in zip(ss, se):
        rhi[a:b] = np.maximum.accumulate(M["h"][a:b]); rlo[a:b] = np.minimum.accumulate(M["l"][a:b])
        am = asia_m1[a:b]
        if am.any():
            hh = np.where(am, M["h"][a:b], -np.inf); ll = np.where(am, M["l"][a:b], np.inf)
            x = np.maximum.accumulate(hh); y = np.minimum.accumulate(ll)
            ok = np.isfinite(x); ahi[a:b] = np.where(ok, x, nan); alo[a:b] = np.where(ok, y, nan)
    sess_of_i1 = np.searchsorted(ss, i1, "right") - 1
    today = M["day"][i1] == dE                                         # latest closed M1 bar belongs to today's session
    thi = np.where(today, rhi[i1], nan); tlo = np.where(today, rlo[i1], nan); top = np.where(today, sop[sess_of_i1], nan)
    tah = np.where(today, ahi[i1], nan); tal = np.where(today, alo[i1], nan)
    hist = m
    put("d_today_bars", np.where(today, i1 - ss[sess_of_i1] + 1, 0), "จำนวนแท่ง M1 ของวันนี้ที่ปิดแล้วก่อนเข้าไม้ (0 = ไม้เข้าที่แท่งแรกของวัน เช่นฤดูหนาว 23:01 UTC → "
        "ค่าที่ต้องใช้ข้อมูลของวันนี้ (a_day_rng_adr, d_broke_*, d_day_pos, d_gap_*, d_asia_rng_adr, d_asia_pos) เป็น NULL)", "INTEGER")
    put("a_hist_days", hist, "จำนวนวันเทรด (ไม่นับวันสั้นผิดปกติ) ที่มีข้อมูลก่อนวันนี้ (นับจาก data_start ของ broker) — น้อย = ช่วงวอร์มอัพ", "INTEGER")
    put("a_adr_days", adr_days, "จำนวนวันที่ใช้คำนวณ ADR (สูงสุด 20; < 3 = ADR และทุกค่าที่หารด้วย ADR เป็น NULL; < 20 = ADR ยังไม่เต็ม)", "INTEGER")
    put("a_adr_usd", adr, "ADR = ช่วงราคาเฉลี่ยต่อวัน (high-low) ของวันเทรดก่อนหน้าสูงสุด 20 วัน ($) ไม่นับวันที่มีแท่ง < 25% ของค่ากลาง 20 วันก่อน")
    put("a_adr_pct", adr / now * 100, "ADR เป็น % ของราคาปัจจุบัน (ความคึกคักรายวันที่เทียบข้ามปีได้)")
    put("a_day_rng_adr", (thi - tlo) / adr, "ช่วงราคาของวันนี้ตั้งแต่เปิดวันถึงแท่ง M1 ล่าสุดที่ปิดแล้ว ÷ ADR")
    put("a_yday_rng_adr", pR / adr, "ช่วงราคาของวันเทรดก่อนหน้า ÷ ADR")
    put("d_pdh_adr", (now - pdh) / adr, "(ราคาปัจจุบัน − high เมื่อวาน) ÷ ADR; บวก = อยู่เหนือ high เมื่อวาน (ราคาปัจจุบัน = ปิดแท่ง M1 ล่าสุดที่ปิดแล้ว, Bid)")
    put("d_pdl_adr", (now - pdl) / adr, "(ราคาปัจจุบัน − low เมื่อวาน) ÷ ADR; ลบ = อยู่ใต้ low เมื่อวาน")
    put("d_pdc_adr", (now - pdc) / adr, "(ราคาปัจจุบัน − ราคาปิดเมื่อวาน) ÷ ADR")
    put("d_broke_pdh", np.where(today & has_prev, (thi > pdh).astype(float), nan), "1 = วันนี้ (ถึงตอนนี้) high เคยเกิน high เมื่อวานแล้ว", "INTEGER")
    put("d_broke_pdl", np.where(today & has_prev, (tlo < pdl).astype(float), nan), "1 = วันนี้ (ถึงตอนนี้) low เคยต่ำกว่า low เมื่อวานแล้ว", "INTEGER")
    put("d_day_pos", np.where(thi > tlo, (now - tlo) / np.where(thi > tlo, thi - tlo, 1), nan),
        "ตำแหน่งราคาในกรอบวันนี้ถึงตอนนี้: 0 = ที่ low ของวัน, 1 = ที่ high ของวัน")
    gap = top - pdc
    put("d_gap_adr", gap / adr, "gap เปิดวัน = (ราคาเปิดวันนี้ − ราคาปิดเมื่อวาน) ÷ ADR")
    put("d_gap_filled", np.where(today & has_prev, np.where(gap > 0, tlo <= pdc, np.where(gap < 0, thi >= pdc, True)).astype(float), nan),
        "1 = ตั้งแต่เปิดวันถึงตอนนี้ ราคาเคยกลับไปแตะราคาปิดเมื่อวานแล้ว (gap ปิดแล้ว; gap 0 = 1)", "INTEGER")
    put("d_asia_rng_adr", (tah - tal) / adr, "ช่วงราคากรอบเอเชียของวันนี้ (17:00-02:59 นิวยอร์ก, ถึงตอนนี้ถ้ายังอยู่ในช่วงเอเชีย) ÷ ADR")
    put("d_asia_pos", np.where(tah > tal, (now - tal) / np.where(tah > tal, tah - tal, 1), nan),
        "ตำแหน่งราคาเทียบกรอบเอเชียวันนี้: 0 = low เอเชีย, 1 = high เอเชีย, > 1 หรือ < 0 = อยู่นอกกรอบ")
    put("d_asia_done", (ph != 0).astype(int), "1 = ช่วงเอเชียของวันนี้จบแล้ว (กรอบเอเชียครบ), 0 = ยังอยู่ในช่วงเอเชีย (กรอบยังโตได้)", "INTEGER")
    put("d_prev_type", ptype, "ประเภทวันเทรดก่อนหน้า (นิยามเดียวกับ days.day_type ใช้ ADR ของวันนั้นเอง): 0 normal, 1 trend (efficiency ≥ 0.6 และช่วง ≥ 0.8 ADR), "
        "2 quiet (ช่วง < 0.7 ADR), 3 two_sided (efficiency < 0.25 และช่วง ≥ 1.0 ADR)", "INTEGER")
    log(f"days done {time.time() - t0:.0f}s")

    # ---------------- M1 activity over the last bars ------------------------------------------------------------------------------
    c1 = M["c"]; ad = np.r_[0, np.abs(np.diff(c1))]; cad = np.r_[0, np.cumsum(ad)]
    ok60 = i1 >= 60
    path60 = np.where(ok60, cad[i1 + 1] - cad[np.clip(i1 - 59, 0, None)], nan)       # 60 moves ending at bar i1
    put("a_mv60_pct", path60 / 60 / now * 100, "ราคาขยับเฉลี่ยต่อนาที (|ปิด − ปิดก่อนหน้า| ของแท่ง M1) ใน 60 แท่ง M1 ล่าสุด เป็น % ของราคา (นาฬิกากิจกรรม)")
    put("a_path60_adr", path60 / adr, "ระยะทางที่ราคาวิ่งจริง (ผลรวม |ปิด − ปิดก่อนหน้า|) ใน 60 แท่ง M1 ล่าสุด ÷ ADR")
    w60h = np.array([M["h"][max(0, i - 59):i + 1].max() for i in i1]); w60l = np.array([M["l"][max(0, i - 59):i + 1].min() for i in i1])
    put("a_rng60_adr", np.where(ok60, (w60h - w60l) / adr, nan), "ช่วงราคา (high − low) ของ 60 แท่ง M1 ล่าสุด ÷ ADR")
    ctv = np.r_[0, np.cumsum(M["tv"])]
    a10 = (ctv[i1 + 1] - ctv[i1 - 9]) / 10; bs = i1 - 9
    b = np.where(bs >= DAYBARS, (ctv[bs] - ctv[np.clip(bs - DAYBARS, 0, None)]) / DAYBARS, nan)
    put("a_tv10_rel", a10 / b, f"tick volume เฉลี่ย 10 แท่ง M1 ล่าสุด ÷ tick volume เฉลี่ยต่อแท่งของ {DAYBARS} แท่ง M1 ก่อนหน้านั้น (~1 วัน; ไม่ผูก broker)")

    # ---------------- per-TF: ATR, activity, footprints, structure ----------------------------------------------------------------
    for tf in TF_FULL + TF_BG:
        B = resample(M, tf); n = len(B["c"]); jB = last_closed(B, E, dE); p_ = f"m{tf}" if tf < 60 else "h1"
        if tf == 15: p_ = "m15"
        cs = B["cs"]
        atrn = np.where(jB >= 20, (cs[jB + 1] - cs[np.clip(jB - 19, 0, None)]) / 20, nan)
        if tf in TF_FULL:
            N5 = 5 * DAYBARS // tf; need = DAYBARS // tf; lo5 = np.clip(jB + 1 - N5, 1, None); cnt = jB + 1 - lo5
            base5 = np.where(cnt >= need, (cs[jB + 1] - cs[lo5]) / np.maximum(cnt, 1), nan)
            put(f"a_{p_}_atr_usd", atrn, f"ATR ของ M{tf} = true range เฉลี่ย 20 แท่ง M{tf} ล่าสุดที่ปิดแล้ว ($)")
            put(f"a_{p_}_atr_adr", atrn / adr, f"ATR ของ M{tf} ÷ ADR")
            put(f"a_{p_}_atr_rel5d", atrn / base5, f"ATR ของ M{tf} ÷ true range เฉลี่ยต่อแท่ง M{tf} ของ 5 วันล่าสุด ({N5} แท่ง, ใช้เท่าที่มีถ้า ≥ 1 วัน) = ตอนนี้คึกกว่าปกติกี่เท่า")
            put(f"a_{p_}_cost_atr", COST / atrn, f"ต้นทุนมาตรฐานต่อไม้ ${COST} ÷ ATR ของ M{tf} (ต้นทุนเทียบการขยับของ TF นั้น — สูง = TF นี้แพงเกินไป)")
            # footprints (catalog definitions, ATR = atr_prev = 20 bars BEFORE the bar)
            # integer points; ATR comparisons as 20ths of the 20-bar TR sum, percentages as integer ratios (exact)
            h, l, o, c = B["hi"], B["li"], B["oi"], B["ci"]; S = B["s20p"]; rng = h - l; body = np.abs(c - o)
            up = h - np.maximum(o, c); dn = np.minimum(o, c) - l; col = np.sign(c - o); okb = S > 0
            LB = LB_MIN // tf; ar = np.arange(n); jc = np.clip(jB, 0, None)
            def age(mask, dirs=None, lbl="", dsc="", ddsc=""):
                last = np.maximum.accumulate(np.where(mask, ar, -1))[jc]; g = jc - last
                valid = (jB >= 0) & (last >= 0) & (g < LB)
                put(f"f_{p_}_{lbl}_age", np.where(valid, g, -1), dsc, "INTEGER")
                if dirs is not None: put(f"f_{p_}_{lbl}_dir", np.where(valid, dirs[np.clip(last, 0, None)], 0), ddsc, "INTEGER")
            age(okb & (20 * rng >= 2 * S), col, "big", f"แท่ง M{tf} ใหญ่ (ช่วง ≥ 2 ATR ของ 20 แท่งก่อนมัน) ล่าสุดเกิดกี่แท่งก่อน (0 = แท่งล่าสุดที่ปิดแล้ว; -1 = ไม่มีใน {LB_MIN} นาที)",
                f"ทิศของแท่ง M{tf} ใหญ่ล่าสุดนั้น (+1 ปิดขึ้น, -1 ปิดลง, 0 = ไม่มี)")
            pin = okb & (20 * rng >= S) & (10 * body <= 3 * rng) & ((10 * up >= 6 * rng) | (10 * dn >= 6 * rng))
            age(pin, np.where(10 * dn >= 6 * rng, 1, -1), "pin", f"pinbar M{tf} (ช่วง ≥ 1 ATR, ไส้ ≥ 60%, ตัว ≤ 30%) ล่าสุดเกิดกี่แท่งก่อน (-1 = ไม่มีใน {LB_MIN} นาที)",
                f"ทิศ pinbar M{tf} ล่าสุด (+1 ไส้ล่างยาว = ปฏิเสธราคาต่ำ, -1 ไส้บนยาว, 0 = ไม่มี)")
            W = max(20, DAYBARS // tf); tvi = B["tv"].astype(np.int64); ctb = np.r_[0, np.cumsum(tvi)]
            sw = np.full(n, -1, np.int64); sw[W:] = ctb[W:n] - ctb[:n - W]
            vs = (sw >= 0) & (W * tvi >= 3 * sw)
            age(vs, None, "vspike", f"แท่ง M{tf} ที่ tick volume ≥ 3 เท่าของค่าเฉลี่ย {W} แท่งก่อนหน้า (~1 วัน) ล่าสุดเกิดกี่แท่งก่อน (-1 = ไม่มีใน {LB_MIN} นาที)")
            same = np.r_[False, B["sid"][1:] == B["sid"][:-1]]; hp = np.r_[h[0], h[:-1]]; lp = np.r_[l[0], l[:-1]]
            ins = okb & same & (h < hp) & (l > lp)
            put(f"f_{p_}_inside", np.where(jB >= 0, ins[jc], 0).astype(int), f"1 = แท่ง M{tf} ล่าสุดที่ปิดแล้วเป็น inside bar (high ต่ำกว่าและ low สูงกว่าแท่งก่อน ในวันเดียวกัน)", "INTEGER")
            box = np.zeros(nE); csi = B["csi"]
            for u in np.unique(jB):
                if u < 20: continue
                sel = jB == u; s_now = csi[u + 1] - csi[u - 19]                       # 20 x ATR ending at bar u, in points
                lo_i = max(u - LB + 1, np.searchsorted(B["sid"], B["sid"][u], "left"))
                hs = h[lo_i:u + 1][::-1]; ls = l[lo_i:u + 1][::-1]
                span = np.maximum.accumulate(hs) - np.minimum.accumulate(ls); bad = np.flatnonzero(20 * span > 4 * s_now)
                box[sel] = bad[0] if len(bad) else len(hs)
            put(f"f_{p_}_box_n", np.where(jB >= 20, box, nan), f"จำนวนแท่ง M{tf} ล่าสุด (ในวันเดียวกัน, สูงสุด {LB_MIN} นาที) ที่ high−low รวมกันยังอยู่ในกรอบ ≤ 4 ATR = อยู่ในกรอบ sideway มานานเท่าไร (≥ 20 = นับเป็นกรอบในแคตตาล็อก)", "INTEGER")
        for k in KS:
            idx, pp, kind, conf, ncf, EP = zigzag_state(B, k)
            reg, known, chg, dH, dL = regime_after(pp, kind)
            q = np.where(jB >= 0, ncf[np.clip(jB, 0, None)] - 1, -1); qq = np.clip(q, 0, None)
            kn = (q >= 0) & (known[qq] if len(pp) else False)
            pk = f"{p_}k{int(k)}"; T_close = lambda j: B["t_last"][j] + 60
            put(f"{pk}_reg", np.where(kn, reg[qq], nan), f"สภาพตลาดของ {p_.upper()} (zigzag {k:g} ATR, pivot ที่ยืนยันแล้ว): +1 ขาขึ้น (high และ low ล่าสุดสูงกว่าตัวก่อน), -1 ขาลง, 0 sideway; NULL = pivot ยังไม่พอ", "INTEGER")
            cg = chg[qq] if len(pp) else qq
            put(f"{pk}_reg_age", np.where(kn, (E - T_close(conf[cg] if len(pp) else 0)) // 60, nan), f"อยู่ในสภาพตลาดนี้มากี่นาทีแล้ว (นับจากแท่งที่ยืนยัน pivot ที่ทำให้สภาพนี้เริ่ม)", "INTEGER")
            # user decision 2026-09-28 (option C): keep the raw margins behind the strict regime label so phase 3 can set its own tolerance
            put(f"{pk}_dh_atr", np.where(kn, (dH[qq] if len(pp) else nan) / atrn, nan),
                f"(pivot high ล่าสุด − pivot high ก่อนหน้า) ÷ ATR ของ {p_.upper()} (zigzag {k:g}) — บวก = ยอดสูงขึ้น; ป้าย _reg ใช้แค่เครื่องหมาย ไม่มีระยะเผื่อ "
                "(ค่าใกล้ 0 = ยอดเกือบเท่ากัน ป้ายตัดสินด้วยส่วนต่างเล็กมาก)")
            put(f"{pk}_dl_atr", np.where(kn, (dL[qq] if len(pp) else nan) / atrn, nan),
                f"(pivot low ล่าสุด − pivot low ก่อนหน้า) ÷ ATR ของ {p_.upper()} (zigzag {k:g}) — บวก = ก้นสูงขึ้น; ขาขึ้น = dh > 0 และ dl > 0, ขาลง = ทั้งคู่ < 0, "
                "นอกนั้น sideway")
            if tf not in TF_FULL: continue
            has = q >= 0; jc = np.clip(jB, 0, None)
            put(f"{pk}_n_sw", np.where(kn, q - cg, nan), "จำนวน pivot ที่ยืนยันเพิ่มหลังสภาพนี้เริ่ม (= ย่อ/เด้งไปแล้วกี่ขาในรอบนี้)", "INTEGER")
            ld = np.where(has, -kind[qq], 0) if len(pp) else np.zeros(nE)
            ep = EP[jc]; lastp = pp[qq] if len(pp) else np.full(nE, nan)
            leg = np.abs(ep - lastp)
            put(f"{pk}_leg_dir", np.where(has, ld, nan), "ทิศของขาที่กำลังวิ่ง (ยังไม่ยืนยัน) = ทิศออกจาก pivot ล่าสุด: +1 ขึ้น, -1 ลง", "INTEGER")
            put(f"{pk}_leg_atr", np.where(has, leg / atrn, nan), "ขาที่กำลังวิ่งยาวแค่ไหน = |จุดสุดของขานี้ถึงตอนนี้ − pivot ล่าสุด| ÷ ATR")
            prevleg = np.abs(lastp - (pp[np.clip(q - 1, 0, None)] if len(pp) else nan))
            put(f"{pk}_leg_ratio", np.where(q >= 1, leg / prevleg, nan), "ขาที่กำลังวิ่ง ÷ ขาก่อนหน้า (ที่ยืนยันแล้ว) = ย่อ/ต่อไปลึกแค่ไหน (< 1 = ยังไม่ถึงจุดเริ่มขาก่อน)")
            put(f"{pk}_retr_atr", np.where(has, (ep - now) * ld / atrn, nan), "ราคาถอยกลับจากจุดสุดของขาที่กำลังวิ่งกี่ ATR (บวก = ถอยกลับ, ลบ = ราคาล่าสุดเลยจุดสุดของแท่งที่ปิดแล้วไปอีก)")
            hi_p = np.where(kind[qq] > 0, pp[qq], pp[np.clip(q - 1, 0, None)]) if len(pp) else np.full(nE, nan)
            lo_p = np.where(kind[qq] < 0, pp[qq], pp[np.clip(q - 1, 0, None)]) if len(pp) else np.full(nE, nan)
            put(f"{pk}_rng_pos", np.where(q >= 1, (now - lo_p) / (hi_p - lo_p), nan), "ตำแหน่งราคาเทียบ pivot high และ low ล่าสุด: 0 = ที่ low, 1 = ที่ high, > 1 = ทำ high ใหม่, < 0 = ทำ low ใหม่")
            put(f"{pk}_leg_min", np.where(has, (E - T_close(idx[qq] if len(pp) else 0)) // 60, nan), "นาทีนับจากแท่งที่เป็น pivot ล่าสุด (จุดเริ่มขาที่กำลังวิ่ง)", "INTEGER")
            if k == 3.0:                                                  # triangle (catalog definition, zigzag 3 ATR)
                tri = np.zeros(n, bool); S = B["s20p"]; ppi = np.rint(pp / BK.POINT).astype(np.int64)
                for j in range(4, len(pp)):
                    if not S[idx[j - 2]] > 0: continue
                    lg = np.abs(np.diff(ppi[j - 4:j + 1]))
                    if np.all(20 * lg[1:] <= 17 * lg[:-1]): tri[conf[j]] = True
                LB = LB_MIN // tf; last = np.maximum.accumulate(np.where(tri, np.arange(n), -1))[jc]; g = jc - last
                put(f"f_{p_}_tri_age", np.where((jB >= 0) & (last >= 0) & (g < LB), g, -1), f"สามเหลี่ยมบีบตัว M{tf} (zigzag 3 ATR, 4 ขาติดกันแต่ละขา ≤ 0.85 เท่าขาก่อน) ยืนยันล่าสุดกี่แท่งก่อน (-1 = ไม่มีใน {LB_MIN} นาที)", "INTEGER")
        log(f"TF {tf} done {time.time() - t0:.0f}s")
    put("d_r10_atr5", (now - np.round(now / 10) * 10) / C["a_m5_atr_usd"][0], "ระยะจากราคาปัจจุบันถึงเลขกลม $10 ที่ใกล้สุด ÷ ATR ของ M5 (บวก = อยู่เหนือเลขกลม)")

    infs = {x: int(np.isinf(v).sum()) for x, (v, _) in C.items() if np.isinf(v).any()}
    if infs: raise ValueError(f"+-inf values (would be stored as NULL silently): {infs}")
    return C, D, dE, i1

def column_order(C):
    names = list(C)
    return [x for x in names if x.startswith("t_")] + [x for x in names if x.startswith("a_")] + [x for x in names if x.startswith("d_")] + \
           [x for x in names if x.startswith("f_")] + [x for x in names if x[0] in "mh" and not x.startswith("f_")]

def _write(E, M, C, D, dE, i1, tdb, out, cut, log, t0):
    # ---------------- write ------------------------------------------------------------------------------------------------------
    t = M["t"]; nE = len(E)
    order = column_order(C)
    base_cols = [("entry_t", "INTEGER", "เวลาเข้าไม้ (UTC epoch วินาที) = คีย์จับคู่กับ trades.entry_t; ทุกค่าในแถวใช้เฉพาะข้อมูลก่อนเวลานี้"),
                 ("day", "INTEGER", "วันเทรดมาตรฐาน (คีย์เดียวกับ trades.day / days.day)"),
                 ("m1_last_t", "INTEGER", "เวลาเปิดของแท่ง M1 ล่าสุดที่ใช้ (ต้อง ≤ entry_t − 60)")]
    dst_db = sqlite3.connect(out) if out else tdb
    dst_db.execute("DROP TABLE IF EXISTS ctx")
    dst_db.execute("CREATE TABLE ctx (" + ", ".join(f"{a} {b}" for a, b, _ in base_cols) + ", " + ", ".join(f"{x} {C[x][1]}" for x in order) + ")")
    try: dst_db.execute("DELETE FROM columns WHERE tbl='ctx'")
    except sqlite3.OperationalError: dst_db.execute("CREATE TABLE columns (tbl TEXT, name TEXT, type TEXT, description TEXT)")
    dst_db.executemany("INSERT INTO columns VALUES ('ctx',?,?,?)", [(a, b, c_) for a, b, c_ in base_cols] + [(x, C[x][1], D[x]) for x in order])
    cols = [E, dE, t[i1]] + [C[x][0] for x in order]; kinds = ["INTEGER"] * 3 + [C[x][1] for x in order]
    rows = []
    for r in range(nE):
        row = []
        for v, kd in zip(cols, kinds):
            x = v[r]
            if isinstance(x, (float, np.floating)) and not np.isfinite(x): row.append(None)
            else: row.append(int(x) if kd == "INTEGER" else float(x))
        rows.append(row)
    dst_db.executemany("INSERT INTO ctx VALUES (" + ",".join("?" * len(cols)) + ")", rows)
    dst_db.execute("CREATE UNIQUE INDEX ix_ctx ON ctx(entry_t)")
    try:
        dst_db.execute("DELETE FROM meta WHERE k LIKE 'ctx_%'")
        dst_db.executemany("INSERT INTO meta VALUES (?,?)", [("ctx_built_utc", time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())),
                           ("ctx_rule", "row for entry_t uses only M1 bars with t <= entry_t-60 and TF bars fully closed at entry_t (adx_ctx.py)"),
                           ("ctx_zigzag_k", json.dumps(KS)), ("ctx_cut", str(cut))])
    except sqlite3.OperationalError: pass
    dst_db.commit()
    if out: dst_db.close()
    tdb.close()
    log(f"ctx rows {nE}, columns {len(cols)}, {time.time() - t0:.0f}s")
    return order

if __name__ == "__main__":
    build(to_ts(os.environ.get("CTX_TO")), os.environ.get("CTX_OUT"))
