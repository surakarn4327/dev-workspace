"""Catalog part C (step 2) -> tables patterns_c, retests, vol_events, spread_events, nesting in the active broker's data center.
Descriptive only. Run after dc_catalog.py / dc_catalog_b.py. Definitions of formations / retests: cat_struct.py.
  patterns_c   multi-pivot formations HS, IHS, TRIPLE, TRIANGLE, BROADEN, FLAG, V_REV, EXHAUST (per TF) + SPIKE_REJECT
               (single bar range >= 3 ATR closing in the opposite 30% of the bar)
  retests      break-and-retest of every swing level per TF (NORETEST / RETEST_HOLD / RETEST_FAIL, bars to retest)
  vol_events   tick volume (broker-neutral: always relative to the mean of the previous day's bars of the same TF)
               VOL_SPIKE bar tick volume >= 3x ; VOL_DRY 12-bar tick volume <= 0.4x (onset) ;
               DIVERGENCE / CONFIRM at each new swing extreme: tick volume per bar of the leg vs the previous same-direction leg
  spread_events M1 only, only where the broker profile says bar spread is real: spread >= 2x the day's median, merged runs
  nesting      per lower-TF leg: containing higher-TF leg (M1 in M5, M1 in M15, M5 in M15), same direction or not"""
import numpy as np, sqlite3
import cat_bars as CB, cat_struct as CS, broker as BK
db = sqlite3.connect(CB.DB); cur = db.cursor()
cur.executescript("""DROP TABLE IF EXISTS patterns_c; DROP TABLE IF EXISTS retests; DROP TABLE IF EXISTS vol_events;
DROP TABLE IF EXISTS spread_events; DROP TABLE IF EXISTS nesting;
CREATE TABLE patterns_c(id INTEGER PRIMARY KEY, tf INTEGER, type TEXT, t INTEGER, day INTEGER, dir INTEGER, et_hour INTEGER, phase TEXT, x1 REAL);
CREATE TABLE retests(id INTEGER PRIMARY KEY, tf INTEGER, outcome TEXT, t_break INTEGER, t_retest INTEGER, day INTEGER, dir INTEGER, bars_to_retest INTEGER);
CREATE TABLE vol_events(id INTEGER PRIMARY KEY, tf INTEGER, type TEXT, t INTEGER, day INTEGER, dir INTEGER, et_hour INTEGER, phase TEXT, x1 REAL);
CREATE TABLE spread_events(id INTEGER PRIMARY KEY, t_start INTEGER, t_end INTEGER, day INTEGER, minutes INTEGER, peak_ratio REAL, et_hour INTEGER);
CREATE TABLE nesting(id INTEGER PRIMARY KEY, tf_low INTEGER, tf_high INTEGER, day INTEGER, t_end INTEGER, dir INTEGER, same_dir INTEGER, size_atr REAL);""")
PC, RT, VE, LG = [], [], [], {}
for tf in (1, 5, 15):
    B = CB.tf_bars(tf); bh, bl, bc, bo, atr, sid, t = B["h"], B["l"], B["c"], B["o"], B["atr"], B["sid"], B["t"]
    idx, p, kind, conf = CS.zigzag(bh, bl, bc, atr)
    ntab = db.execute("SELECT COUNT(*) FROM pivots WHERE tf=?", (tf,)).fetchone()[0]
    print(f"M{tf}: pivots {len(p)} (pivots table {ntab} {'OK' if ntab == len(p) else 'DIFF'})", flush=True)
    def rec(typ, j, d, x): return (tf, typ, int(t[j]), int(B["day"][j]), int(d), int(B["et"][j]), str(B["phase"][j]), None if x is None else float(x))
    for typ, j, d, x in CS.formations(idx, p, kind, conf, atr): PC.append(rec(typ, j, d, x))
    rng = bh - bl; ok = np.isfinite(atr) & (rng >= 3 * atr)
    pos = np.where(rng > 0, (bc - bl) / np.where(rng > 0, rng, 1), 0.5); col = np.sign(bc - bo)
    for j in np.flatnonzero(ok & (((col > 0) & (pos <= 0.3)) | ((col < 0) & (pos >= 0.7)) | ((pos <= 0.3) & (bh - np.maximum(bo, bc) >= 0.6 * rng)) | ((pos >= 0.7) & (np.minimum(bo, bc) - bl >= 0.6 * rng)))):
        PC.append(rec("SPIKE_REJECT", j, 1 if pos[j] >= 0.7 else -1, rng[j] / atr[j]))
    for out, b, r, d, nb in CS.retests(idx, p, kind, conf, bh, bl, bc, atr, sid):
        RT.append((tf, out, int(t[b]), int(t[r]) if r >= 0 else None, int(B["day"][b]), d, nb))
    # tick volume, relative to the mean of the previous day's bars of this TF
    tv = B["tv"].astype(float); W = max(20, 1380 // tf); cs = np.r_[0, np.cumsum(tv)]
    base = np.full(len(tv), np.nan); base[W:] = (cs[W:len(tv)] - cs[:len(tv) - W]) / W
    rel = tv / base
    for j in np.flatnonzero(np.isfinite(rel) & (rel >= 3)):
        VE.append((tf, "VOL_SPIKE", int(t[j]), int(B["day"][j]), int(col[j]), int(B["et"][j]), str(B["phase"][j]), float(rel[j])))
    r12 = np.full(len(tv), np.nan); r12[12:] = (cs[13:len(tv) + 1] - cs[1:len(tv) - 11]) / (12 * base[12:]) if len(tv) > 12 else r12[12:]
    armed = True
    for j in range(12, len(tv)):
        if not np.isfinite(r12[j]) or sid[j - 11] != sid[j]: armed = True; continue
        if r12[j] <= 0.4:
            if armed: VE.append((tf, "VOL_DRY", int(t[j]), int(B["day"][j]), 0, int(B["et"][j]), str(B["phase"][j]), float(r12[j]))); armed = False
        else: armed = True
    vpb = [tv[idx[q - 1] + 1:idx[q] + 1].sum() / max(1, idx[q] - idx[q - 1]) for q in range(1, len(p))]      # volume per bar of leg ending at pivot q
    for q in range(3, len(p)):
        if (p[q] - p[q - 2]) * kind[q] > atr[idx[q]]:                                                   # new extreme beyond the previous same-kind pivot by > 1 ATR
            v_now, v_prev = vpb[q - 1], vpb[q - 3]
            j = conf[q]
            VE.append((tf, "DIVERGENCE" if v_now < v_prev else "CONFIRM", int(t[j]), int(B["day"][j]), int(kind[q]), int(B["et"][j]), str(B["phase"][j]), float(v_now / v_prev) if v_prev > 0 else None))
    LG[tf] = (t[idx], p, kind, atr[idx], B["day"][idx])
    print(f"   formations+spikes {sum(1 for x in PC if x[0] == tf)}, retests {sum(1 for x in RT if x[0] == tf)}, volume events {sum(1 for x in VE if x[0] == tf)}", flush=True)
# spread events (M1, reliable period only)
M = CB.m1(); SE = []
if BK.SPREAD_OK_FROM is not None:
    k = M["t"] >= BK.SPREAD_OK_FROM
    for dk in np.unique(M["day"][k]):
        w = np.flatnonzero(k & (M["day"] == dk)); sp = M["sp"][w]; med = np.median(sp)
        if med <= 0: continue
        hot = sp >= 2 * med; st = np.flatnonzero(hot & ~np.r_[False, hot[:-1]])
        for s0 in st:
            e = s0
            while e + 1 < len(w) and hot[e + 1]: e += 1
            SE.append((int(M["t"][w[s0]]), int(M["t"][w[e]]), int(dk), int(e - s0 + 1), float(sp[s0:e + 1].max() / med), int(M["et"][w[s0]])))
# nesting: lower-TF legs inside higher-TF legs
NE = []
for lo_tf, hi_tf in ((1, 5), (1, 15), (5, 15)):
    tl, pl, kl, al, dl = LG[lo_tf]; th, ph, kh, ah, dh = LG[hi_tf]
    for q in range(1, len(pl)):
        te = tl[q]; h = np.searchsorted(th, te, "left")                 # higher-TF leg (th[h-1] -> th[h]) containing this leg's end
        if h <= 0 or h >= len(th): continue
        dlo = int(np.sign(pl[q] - pl[q - 1])); dhi = int(np.sign(ph[h] - ph[h - 1]))
        NE.append((lo_tf, hi_tf, int(dl[q]), int(te), dlo, int(dlo == dhi), float(abs(pl[q] - pl[q - 1]) / al[q - 1])))
cur.executemany("INSERT INTO patterns_c(tf,type,t,day,dir,et_hour,phase,x1) VALUES (?,?,?,?,?,?,?,?)", PC)
cur.executemany("INSERT INTO retests(tf,outcome,t_break,t_retest,day,dir,bars_to_retest) VALUES (?,?,?,?,?,?,?)", RT)
cur.executemany("INSERT INTO vol_events(tf,type,t,day,dir,et_hour,phase,x1) VALUES (?,?,?,?,?,?,?,?)", VE)
cur.executemany("INSERT INTO spread_events(t_start,t_end,day,minutes,peak_ratio,et_hour) VALUES (?,?,?,?,?,?)", SE)
cur.executemany("INSERT INTO nesting(tf_low,tf_high,day,t_end,dir,same_dir,size_atr) VALUES (?,?,?,?,?,?,?)", NE)
db.commit(); print("patterns_c", len(PC), "retests", len(RT), "vol_events", len(VE), "spread_events", len(SE), "nesting", len(NE))
