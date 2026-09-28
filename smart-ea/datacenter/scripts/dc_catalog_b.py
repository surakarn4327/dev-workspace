"""Catalog part B -> tables level_visits, boxes, trends in gold_dc.sqlite (re-runnable; run after dc_catalog.py). Descriptive only.

1) level_visits: how price behaves around reference levels, measured on M1 bars; ruler = ATR20 of M5 at that moment (a5).
   Levels per session: round numbers R10 / R50 / R100 (each level labelled by its highest roundness), pseudo levels P10a/P10b (= R10 grid
   shifted +3.3 / +6.7 USD, the "nothing special" baseline), PDH / PDL / PDC (previous session high/low/close), DOPEN (session open),
   LOPEN (price at London open 03:00 ET), NYOPEN (08:00 ET), PWH / PWL (previous ISO week), PMH / PML (previous calendar month).
   A visit = price was >= 1 a5 away (close), then a bar range came within 0.25 a5 of the level, then price is >= 1 a5 away again:
     BOUNCE  back to the side it came from, no close beyond the level by more than 0.25 a5
     POKE    back to the side it came from, but closed beyond the level by > 0.25 a5 in between
     CROSS   ended on the other side
   (levels that are only reachable from price already near them at the open are ignored until price first moves 1 a5 away)
2) boxes (M1/M5/M15): greedy scan inside a session - a box starts at bar i and is extended while the high-low of the box <= 4 ATR(i);
   kept if it lasts >= 20 bars. exit = UP / DOWN (the bar that broke the height went above / below) or END (session ended).
   touches_top / touches_bot = times price came back into the top / bottom 25% of the final box after visiting the middle.
3) trends (M1/M5/M15): from the zigzag pivots, a structure run = consecutive pivots each beyond the previous pivot of the same kind
   (higher highs AND higher lows, or lower lows AND lower highs). n = number of pivots in the run that confirm the structure (>= 2).
   size = distance from the run's first pivot to its last extreme, in ATR (at start) and ADR."""
import numpy as np, sqlite3
from datetime import datetime, timezone
import cat_bars as CB
db = sqlite3.connect(CB.DB); cur = db.cursor()
cur.executescript("""DROP TABLE IF EXISTS level_visits; DROP TABLE IF EXISTS boxes; DROP TABLE IF EXISTS trends;
CREATE TABLE level_visits(id INTEGER PRIMARY KEY, level_type TEXT, day INTEGER, t_touch INTEGER, t_end INTEGER, side INTEGER, outcome TEXT, level REAL, et_hour INTEGER, pen_atr REAL);
CREATE TABLE boxes(id INTEGER PRIMARY KEY, tf INTEGER, day INTEGER, t_start INTEGER, t_end INTEGER, bars INTEGER, height_atr REAL, height_adr REAL, touches_top INTEGER, touches_bot INTEGER, exit TEXT, et_hour INTEGER);
CREATE TABLE trends(id INTEGER PRIMARY KEY, tf INTEGER, day INTEGER, t_start INTEGER, t_end INTEGER, dir INTEGER, n INTEGER, size_atr REAL, size_adr REAL, minutes INTEGER);""")
M = CB.m1(); ADR = CB.adr_map()
t, h, l, c, sid, day, et = M["t"], M["h"], M["l"], M["c"], M["sid"], M["day"], M["et"]
# ---------------- 1) levels
B5 = CB.tf_bars(5); a5 = np.full(len(t), np.nan)
for k in range(len(B5["t"])): a5[B5["m1_start"][k]:B5["m1_end"][k]] = B5["atr"][k]
sess = [np.flatnonzero(sid == s) for s in np.unique(sid)]
S = [(w, int(day[w[-1]])) for w in sess if len(w) >= 0.25 * np.median([len(x) for x in sess])]   # drop stub days (relative)
hi_s = {d: h[w].max() for w, d in S}; lo_s = {d: l[w].min() for w, d in S}; cl_s = {d: c[w[-1]] for w, d in S}
days_sorted = [d for _, d in S]
def iso(d): return datetime.fromtimestamp(d * 86400, timezone.utc).isocalendar()[:2]
def ym(d): x = datetime.fromtimestamp(d * 86400, timezone.utc); return (x.year, x.month)
wk_hl, mo_hl = {}, {}
for w, d in S:
    for dic, k in ((wk_hl, iso(d)), (mo_hl, ym(d))):
        a, b = dic.get(k, (-np.inf, np.inf)); dic[k] = (max(a, hi_s[d]), min(b, lo_s[d]))
VIS = []
def visits(w, L, typ, dk):
    a = a5[w]; ok = np.isfinite(a)
    if ok.sum() < 30: return
    d_ = (c[w] - L) / a; far = ok & (np.abs(d_) >= 1); side = np.sign(d_)
    band = ok & (l[w] <= L + 0.25 * a) & (h[w] >= L - 0.25 * a)
    F = np.flatnonzero(far)
    if len(F) < 2: return
    cb = np.r_[0, np.cumsum(band)]
    for f0, f1 in zip(F[:-1], F[1:]):
        if f1 == f0 + 1 and side[f0] == side[f1]: continue
        s0, s1 = side[f0], side[f1]
        if s0 == s1:
            if cb[f1] - cb[f0 + 1] == 0: continue
            beyond = ((c[w[f0 + 1:f1]] - L) * s0 < -0.25 * a[f0 + 1:f1]).any()
            out = "POKE" if beyond else "BOUNCE"
        else: out = "CROSS"
        seg = np.arange(f0 + 1, f1 + 1); bi = seg[band[seg]]
        j = bi[0] if len(bi) else f0 + 1
        pen = np.max(((L - l[w[f0 + 1:f1 + 1]]) if s0 > 0 else (h[w[f0 + 1:f1 + 1]] - L)) / a[f0 + 1:f1 + 1])
        VIS.append((typ, dk, int(t[w[j]]), int(t[w[f1]]), int(s0), out, float(L), int(et[w[j]]), float(pen)))
prev = None
for w, dk in S:
    lvls = []
    lo_, hi_ = l[w].min(), h[w].max()
    for g in np.arange(np.floor(lo_ / 10) * 10, hi_ + 10, 10):
        typ = "R100" if g % 100 == 0 else ("R50" if g % 50 == 0 else "R10"); lvls += [(g, typ), (g + 3.3, "P10a"), (g + 6.7, "P10b")]
    if prev is not None: lvls += [(hi_s[prev], "PDH"), (lo_s[prev], "PDL"), (cl_s[prev], "PDC")]
    lvls.append((c[w[0]], "DOPEN"))
    for e_, nm in ((3, "LOPEN"), (8, "NYOPEN")):
        k = np.flatnonzero((et[w] >= e_) & (et[w] < 17))
        if len(k): lvls.append((M["o"][w[k[0]]], nm))
    pw = max((k for k in wk_hl if k < iso(dk)), default=None); pm = max((k for k in mo_hl if k < ym(dk)), default=None)
    if pw: lvls += [(wk_hl[pw][0], "PWH"), (wk_hl[pw][1], "PWL")]
    if pm: lvls += [(mo_hl[pm][0], "PMH"), (mo_hl[pm][1], "PML")]
    for L, typ in lvls:
        if lo_ - 5 <= L <= hi_ + 5: visits(w, L, typ, dk)
    prev = dk
cur.executemany("INSERT INTO level_visits(level_type,day,t_touch,t_end,side,outcome,level,et_hour,pen_atr) VALUES (?,?,?,?,?,?,?,?,?)", VIS)
print("level visits", len(VIS), flush=True)
# ---------------- 2) boxes, 3) trends
BOX = []; TR = []
for tf in (1, 5, 15):
    B = B5 if tf == 5 else CB.tf_bars(tf); n = len(B["t"]); bh, bl, bc, bs, atr = B["h"], B["l"], B["c"], B["sid"], B["atr"]
    i = 0
    while i < n - 1:
        a = atr[i]
        if not np.isfinite(a) or a <= 0: i += 1; continue
        hi_, lo_ = bh[i], bl[i]; j = i
        while j + 1 < n and bs[j + 1] == bs[i] and max(hi_, bh[j + 1]) - min(lo_, bl[j + 1]) <= 4 * a:
            j += 1; hi_ = max(hi_, bh[j]); lo_ = min(lo_, bl[j])
        if j - i + 1 >= 20:
            if j + 1 < n and bs[j + 1] == bs[i]: ex = "UP" if bh[j + 1] > hi_ else "DOWN"
            else: ex = "END"
            H_ = hi_ - lo_; top, bot, mid = hi_ - 0.25 * H_, lo_ + 0.25 * H_, (hi_ + lo_) / 2
            tt = tb = 0; st_t = st_b = True
            for k in range(i, j + 1):
                if bh[k] >= top and st_t: tt += 1; st_t = False
                if bl[k] <= bot and st_b: tb += 1; st_b = False
                if bl[k] <= mid: st_t = True
                if bh[k] >= mid: st_b = True
            U = ADR.get(int(B["day"][j]))
            BOX.append((tf, int(B["day"][j]), int(B["t_open"][i]), int(B["t"][j]), j - i + 1, float(H_ / a), float(H_ / U) if U else None, tt, tb, ex, int(B["et"][i])))
            i = j + 1
        else: i += 1
    P = np.array(db.execute("SELECT t_pivot, t_confirm, day, price, kind, atr FROM pivots WHERE tf=? ORDER BY t_pivot", (tf,)).fetchall())
    k = 2
    while k < len(P):
        up = P[k, 3] > P[k - 2, 3]; s = 1 if up else -1; k0 = k
        while k < len(P) and ((P[k, 3] > P[k - 2, 3]) if s > 0 else (P[k, 3] < P[k - 2, 3])): k += 1
        nrun = k - k0
        if nrun >= 2:
            first = k0 - 2 if (P[k0 - 2, 4] == -s) else k0 - 1          # run starts at the pivot opposite to its direction (a low for an up-run)
            ext = max(range(k0, k), key=lambda q: P[q, 3] * s)
            U = ADR.get(int(P[ext, 2])); size = abs(P[ext, 3] - P[first, 3])
            TR.append((tf, int(P[k - 1, 2]), int(P[first, 0]), int(P[ext, 0]), s, int(nrun), float(size / P[first, 5]), float(size / U) if U else None,
                       int((P[ext, 0] - P[first, 0]) // 60)))
        if k == k0: k += 1
    print(f"M{tf}: boxes {sum(1 for b in BOX if b[0] == tf)}, trend runs {sum(1 for x in TR if x[0] == tf)}", flush=True)
cur.executemany("INSERT INTO boxes(tf,day,t_start,t_end,bars,height_atr,height_adr,touches_top,touches_bot,exit,et_hour) VALUES (?,?,?,?,?,?,?,?,?,?,?)", BOX)
cur.executemany("INSERT INTO trends(tf,day,t_start,t_end,dir,n,size_atr,size_adr,minutes) VALUES (?,?,?,?,?,?,?,?,?)", TR)
db.commit(); print("done")
