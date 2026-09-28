"""Behaviour catalog on small timeframes (M1, M5, M15) -> tables `patterns` and `legs` inside gold_dc.sqlite (re-runnable; run after dc_build.py).
Descriptive only (no outcomes / R). Every size is relative to that timeframe's own ATR20 (mean true range of the 20 PREVIOUS bars),
so a behaviour means the same thing on every TF. Bars are clock-aligned inside each real trading session (dc_sessions.py).

Candle patterns (known at bar close; dir +1 bullish / -1 bearish):
  PINBAR   range >= 1 ATR, one wick >= 60% of range, body <= 30% of range (dir = side of the long wick's rejection)
  ENGULF   body >= 0.5 ATR, colour opposite to previous bar, body covers previous body
  INSIDE   high < prev high and low > prev low            OUTSIDE  high > prev high and low < prev low
  BIGBAR   range >= 2 ATR (x1 = range / ATR)              DOJI     body <= 10% of range and range >= 0.5 ATR
  RUN3     3 bars in a row closing beyond the previous close in one direction (counted once, then reset)
Market-state onsets:
  SQUEEZE  12-bar high-low <= 2.5 ATR (ATR measured before the window); counted at onset, re-armed after the squeeze ends
  PUSH     12-bar efficiency (|net| / path) >= 0.6 and |net| >= 4 ATR; counted at onset, re-armed after it ends
Structure (zigzag, reversal threshold 3 ATR of the TF, continuous across sessions):
  table `legs`: every completed leg (dir, size in ATR and ADR, bars, minutes)
  pivots classified when confirmed, relative to the previous pivot of the same kind:
    SW_NEWEXT  new extreme beyond the previous one by > 1 ATR (higher high / lower low)   SW_SWEEP  beyond by 0.3-1 ATR then reversed
    SW_DOUBLE  within 0.3 ATR of the previous one                                        SW_FAIL   short of the previous one by > 0.3 ATR (lower high / higher low)
    dir = direction of the leg that starts after the pivot; x1 = (pivot - previous pivot) / ATR in the pivot's direction
  PULLBACK_xx at each pivot that ends a retracement of the previous leg: x1 = retracement / previous leg (SHALLOW < 0.382 <= MID < 0.618 <= DEEP < 1 <= OVER)"""
import numpy as np, sqlite3, os
from dc_sessions import sessions, phase
from broker import DB
db = sqlite3.connect(DB); cur = db.cursor()
cur.executescript("""DROP TABLE IF EXISTS patterns; DROP TABLE IF EXISTS legs; DROP TABLE IF EXISTS pivots;
CREATE TABLE pivots(id INTEGER PRIMARY KEY, tf INTEGER, t_pivot INTEGER, t_confirm INTEGER, day INTEGER, price REAL, kind INTEGER, atr REAL);
CREATE TABLE patterns(id INTEGER PRIMARY KEY, tf INTEGER, type TEXT, t INTEGER, day INTEGER, dir INTEGER, et_hour INTEGER, phase TEXT, x1 REAL);
CREATE TABLE legs(id INTEGER PRIMARY KEY, tf INTEGER, day INTEGER, t_start INTEGER, t_end INTEGER, dir INTEGER, size_atr REAL, size_adr REAL, bars INTEGER, minutes INTEGER);
CREATE INDEX ix_pat ON patterns(tf, type, day);""")
rows = db.execute("SELECT t,o,h,l,c FROM bars_m1 ORDER BY t").fetchall()
T, O, H, Lo, C = (np.array(x) for x in zip(*rows)); T = T.astype(np.int64)
SID, DAY, ET = sessions(T)
ADR = dict(db.execute("SELECT day, adr20 FROM days").fetchall())
PAT = []; LEGS = []; PIV = []
for tf in (1, 5, 15):
    # --- resample inside sessions, clock aligned
    key = SID * 10 ** 7 + T // (tf * 60)
    st = np.concatenate([[0], np.flatnonzero(np.diff(key)) + 1]); en = np.concatenate([st[1:], [len(T)]])
    t = T[en - 1]; o = O[st]; c = C[en - 1]
    h = np.maximum.reduceat(H, st); l = np.minimum.reduceat(Lo, st)
    sid = SID[st]; day = DAY[en - 1]; et = ET[en - 1]; ph = phase(et); n = len(t)
    pc = np.r_[c[0], c[:-1]]; tr = np.maximum(h, pc) - np.minimum(l, pc)
    cs = np.r_[0, np.cumsum(tr)]; atr = np.full(n, np.nan); atr[20:] = (cs[20:n] - cs[:n - 20]) / 20      # mean of the 20 previous bars
    rng = h - l; body = np.abs(c - o); up = h - np.maximum(o, c); dn = np.minimum(o, c) - l; col = np.sign(c - o)
    same = np.r_[False, sid[1:] == sid[:-1]]                                                              # previous bar is in the same session
    ok = np.isfinite(atr) & (atr > 0)
    def add(typ, idx, d, x=None):
        for k, i in enumerate(idx):
            PAT.append((tf, typ, int(t[i]), int(day[i]), int(d[k] if hasattr(d, "__len__") else d), int(et[i]), str(ph[i]),
                        None if x is None else float(x[k])))
    m = ok & (rng >= atr) & (body <= 0.3 * rng) & ((up >= 0.6 * rng) | (dn >= 0.6 * rng))
    i = np.flatnonzero(m); add("PINBAR", i, np.where(dn[i] >= 0.6 * rng[i], 1, -1))
    pb_o, pb_c = np.r_[o[0], o[:-1]], np.r_[c[0], c[:-1]]; pcol = np.sign(pb_c - pb_o)
    m = ok & same & (body >= 0.5 * atr) & (col != 0) & (pcol == -col) & (np.maximum(o, c) >= np.maximum(pb_o, pb_c)) & (np.minimum(o, c) <= np.minimum(pb_o, pb_c))
    i = np.flatnonzero(m); add("ENGULF", i, col[i])
    ph_, pl_ = np.r_[h[0], h[:-1]], np.r_[l[0], l[:-1]]
    i = np.flatnonzero(ok & same & (h < ph_) & (l > pl_)); add("INSIDE", i, 0)
    i = np.flatnonzero(ok & same & (h > ph_) & (l < pl_)); add("OUTSIDE", i, col[i])
    i = np.flatnonzero(ok & (rng >= 2 * atr)); add("BIGBAR", i, col[i], rng[i] / atr[i])
    i = np.flatnonzero(ok & (rng >= 0.5 * atr) & (body <= 0.1 * rng)); add("DOJI", i, 0)
    # RUN3
    step = np.sign(c - pc); run = 0; last = 0; idx = []; dd = []
    for k in range(n):
        if not same[k] or step[k] == 0 or step[k] != last: run = 0
        last = step[k] if same[k] else 0
        if same[k] and step[k] != 0: run += 1
        if run == 3 and ok[k]: idx.append(k); dd.append(step[k]); run = -10 ** 9      # reset until direction changes
    add("RUN3", idx, dd)
    # SQUEEZE / PUSH onsets (12-bar windows inside a session)
    W = 12; armed_s = True; armed_p = True; si = []; sd = []; pi_ = []; pd_ = []
    for k in range(W, n):
        if sid[k - W + 1] != sid[k]: armed_s = armed_p = True; continue
        a0 = atr[k - W + 1]
        if not np.isfinite(a0) or a0 <= 0: continue
        wr = h[k - W + 1:k + 1].max() - l[k - W + 1:k + 1].min()
        if wr <= 2.5 * a0:
            if armed_s: si.append(k); sd.append(0); armed_s = False
        else: armed_s = True
        net = c[k] - c[k - W]; path = np.abs(np.diff(c[k - W:k + 1])).sum()
        if path > 0 and abs(net) / path >= 0.6 and abs(net) >= 4 * a0:
            if armed_p: pi_.append(k); pd_.append(np.sign(net)); armed_p = False
        else: armed_p = True
    add("SQUEEZE", si, sd); add("PUSH", pi_, pd_)
    # zigzag over the continuous series (not reset each session, otherwise the session open can never produce classified pivots),
    # threshold 3 ATR (ATR at the bar); every leg / pivot is filed under the session of the bar where it ends / is confirmed
    if True:
        w = np.arange(n)
        piv = []; dirn = 0; ep = c[w[0]]; ei = 0; stp = c[w[0]]
        for j in range(1, len(w)):
            k = w[j]; th = 3 * atr[k]
            if not np.isfinite(th): continue
            if dirn == 0:
                if h[k] >= stp + th: dirn, ep, ei = 1, h[k], j
                elif l[k] <= stp - th: dirn, ep, ei = -1, l[k], j
            elif dirn == 1:
                if h[k] >= ep: ep, ei = h[k], j
                elif l[k] <= ep - th: piv.append((ei, ep, 1, j)); dirn, ep, ei = -1, l[k], j
            else:
                if l[k] <= ep: ep, ei = l[k], j
                elif h[k] >= ep + th: piv.append((ei, ep, -1, j)); dirn, ep, ei = 1, h[k], j
        for m_, (pi, pp, kind, cj) in enumerate(piv):
            ci = w[cj]; a = atr[w[pi]]; U = ADR.get(int(day[w[pi]]))
            PIV.append((tf, int(t[w[pi]]), int(t[ci]), int(day[ci]), float(pp), int(kind), float(a)))
            if m_ >= 1:
                q = piv[m_ - 1]; size = abs(pp - q[1])
                LEGS.append((tf, int(day[w[pi]]), int(t[w[q[0]]]), int(t[w[pi]]), int(kind), float(size / a),
                             float(size / U) if U else None, int(pi - q[0]), int((t[w[pi]] - t[w[q[0]]]) // 60)))
            if m_ >= 2:
                beyond = (pp - piv[m_ - 2][1]) * kind / a
                typ = "SW_NEWEXT" if beyond > 1 else ("SW_SWEEP" if beyond > 0.3 else ("SW_DOUBLE" if beyond >= -0.3 else "SW_FAIL"))
                add(typ, [ci], [-kind], [beyond])
                prev_leg = abs(piv[m_ - 1][1] - piv[m_ - 2][1]); retr = abs(pp - piv[m_ - 1][1]) / prev_leg
                band = "SHALLOW" if retr < 0.382 else ("MID" if retr < 0.618 else ("DEEP" if retr < 1 else "OVER"))
                add("PULLBACK_" + band, [ci], [int(np.sign(piv[m_ - 1][1] - piv[m_ - 2][1]))], [retr])
    print(f"M{tf}: bars {n}, patterns so far {len(PAT)}, legs so far {len(LEGS)}", flush=True)
cur.executemany("INSERT INTO patterns(tf,type,t,day,dir,et_hour,phase,x1) VALUES (?,?,?,?,?,?,?,?)", PAT)
cur.executemany("INSERT INTO legs(tf,day,t_start,t_end,dir,size_atr,size_adr,bars,minutes) VALUES (?,?,?,?,?,?,?,?,?)", LEGS)
cur.executemany("INSERT INTO pivots(tf,t_pivot,t_confirm,day,price,kind,atr) VALUES (?,?,?,?,?,?,?)", PIV)
db.commit(); print(db.execute("SELECT tf, type, COUNT(*) FROM patterns GROUP BY tf, type").fetchall())
