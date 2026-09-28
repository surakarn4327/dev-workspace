r"""Build the gold data center (SQLite) for the active broker profile (broker.py / brokers\<name>.json), clean data only (data_start_utc onward).
Tables: meta, bars_m1, days, swings, events, outcomes. All sizes in ADR20 units (mean day range of the previous 20 trading days).
Broker-neutral: bar times are converted to UTC on load; trading day = 17:00 New York -> 17:00 New York (dc_sessions.py);
phases (asia/london/newyork/late) use the New York clock; events.hour = UTC hour. Re-runnable: rebuilds the file from the bars file."""
import numpy as np, sqlite3, os, json
from dc_sessions import sessions, phase
from datetime import datetime, timezone
import broker as BK
OUT = BK.DB
if os.path.exists(OUT): os.remove(OUT)
B = np.load(BK.BARS)
tu = BK.server_to_utc(B["t"]); k = tu >= BK.T0
t = tu[k]; o, h, l, c, tv, sp = (B[x][k] for x in ("o", "h", "l", "c", "tv", "sp"))
sp = sp * BK.POINT                                            # points -> price units
db = sqlite3.connect(OUT); cur = db.cursor()
cur.executescript("""
CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE bars_m1(t INTEGER PRIMARY KEY, o REAL, h REAL, l REAL, c REAL, tick_vol INTEGER, spread REAL);
CREATE TABLE days(day INTEGER PRIMARY KEY, date TEXT, open REAL, high REAL, low REAL, close REAL, range REAL, adr20 REAL,
  net_adr REAL, efficiency REAL, close_pos REAL, day_type TEXT, inside INTEGER, outside INTEGER,
  broke_prev_high INTEGER, broke_prev_low INTEGER, closed_above_prev_high INTEGER, closed_below_prev_low INTEGER,
  activity_1m_range_pct REAL, spread_median REAL, tick_vol_sum INTEGER);
CREATE TABLE swings(id INTEGER PRIMARY KEY, day INTEGER, pivot_t INTEGER, confirm_t INTEGER, price REAL, kind INTEGER,
  leg_size_adr REAL, leg_minutes INTEGER);
CREATE TABLE events(id INTEGER PRIMARY KEY, type TEXT, t INTEGER, day INTEGER, dir INTEGER, hour INTEGER, session TEXT,
  activity_so_far REAL, backdrop5_aligned INTEGER, spread_adr REAL, x1 REAL);
CREATE TABLE outcomes(event_id INTEGER PRIMARY KEY, fwd15 REAL, fwd60 REAL, fwd240 REAL, fwd_end REAL, mfe240 REAL, mae240 REAL,
  g_sl10_tp10 REAL, g_sl10_tp20 REAL, g_sl10_tp30 REAL, g_sl10_tp50 REAL,
  g_sl20_tp20 REAL, g_sl20_tp40 REAL, g_sl20_tp60 REAL, g_sl30_tp30 REAL, g_sl30_tp60 REAL);
""")
cur.executemany("INSERT INTO meta VALUES (?,?)", [("broker", BK.NAME), ("profile", json.dumps(BK.P, ensure_ascii=False)), ("time", "UTC"),
                ("day", "17:00 New York -> 17:00 New York"), ("built_utc", datetime.now(timezone.utc).isoformat())])
cur.executemany("INSERT INTO bars_m1 VALUES (?,?,?,?,?,?,?)",
                zip(t.tolist(), o.tolist(), h.tolist(), l.tolist(), c.tolist(), tv.astype(int).tolist(), sp.tolist()))
sid, day, et = sessions(t); hour = (t // 3600) % 24; PH = phase(et)
bd = np.flatnonzero(np.diff(sid)) + 1
SESS = [np.arange(a, e) for a, e in zip(np.concatenate([[0], bd]), np.concatenate([bd, [len(t)]]))]
SESS = [w for w in SESS if len(w) >= 0.25 * np.median([len(x) for x in SESS])]     # drop stub days (broker-neutral, relative)
GRID = [(0.1, 0.1), (0.1, 0.2), (0.1, 0.3), (0.1, 0.5), (0.2, 0.2), (0.2, 0.4), (0.2, 0.6), (0.3, 0.3), (0.3, 0.6)]
ev_id = 0; sw_id = 0; ranges = []; closes = []; prev = None
wk_hilo = {}; cur_wk = None; wk_broken = set()                  # previous-week levels (ISO week of the session date)
def add_event(typ, i, w, d, U, extra=np.nan):
    """i = index into t (event bar, known at its close); w = session indices; outcomes computed forward to session end."""
    global ev_id
    j0 = int(np.searchsorted(w, i)); rest = w[j0:]
    if len(rest) < 6 or d == 0: return
    so_far = (h[w[0]:i + 1].max() - l[w[0]:i + 1].min()) / U
    bk = np.sign(c[i] - closes[-6]) * d if len(closes) >= 6 else 0
    ev_id += 1
    cur.execute("INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?,?,?)", (ev_id, typ, int(t[i]), int(day[i]), int(d), int(hour[i]),
                str(PH[i]), float(so_far), int(bk), float(sp[i] / U), None if np.isnan(extra) else float(extra)))
    px = c[i]; seg = rest[1:]
    def fw(m): jj = seg[min(m, len(seg)) - 1]; return float(d * (c[jj] - px) / U)
    s240 = seg[:240]
    fav = (h[s240] - px) if d > 0 else (px - l[s240]); adv = (px - l[s240]) if d > 0 else (h[s240] - px)
    g = []
    favall = (h[seg] - px) * d if d > 0 else (px - l[seg]); advall = (px - l[seg]) if d > 0 else (h[seg] - px)
    for slv, tpv in GRID:
        hs = np.flatnonzero(advall >= slv * U); ht = np.flatnonzero(favall >= tpv * U)
        fs = hs[0] if len(hs) else 10 ** 9; ft = ht[0] if len(ht) else 10 ** 9
        if fs <= ft and fs < 10 ** 9: g.append(-1.0)
        elif ft < 10 ** 9: g.append(tpv / slv)
        else: g.append(float(d * (c[seg[-1]] - px) / (slv * U)))
    cur.execute("INSERT INTO outcomes VALUES (" + ",".join("?" * 16) + ")",
                (ev_id, fw(15), fw(60), fw(240), float(d * (c[seg[-1]] - px) / U), float(fav.max() / U), float(adv.max() / U), *g))
for w in SESS:
    hi, lo, op, cl = h[w].max(), l[w].min(), o[w[0]], c[w[-1]]; R = hi - lo
    U = np.mean(ranges[-20:]) if len(ranges) >= 20 else np.nan
    ranges.append(R)
    dk = int(day[w[0]]); date = datetime.fromtimestamp(dk * 86400, timezone.utc).strftime("%Y-%m-%d")
    eff = abs(cl - op) / R if R > 0 else 0; rr = R / U if np.isfinite(U) else np.nan
    dtype = None
    if np.isfinite(rr):
        dtype = "trend" if (eff >= 0.6 and rr >= 0.8) else ("quiet" if rr < 0.7 else ("two_sided" if (eff < 0.25 and rr >= 1.0) else "normal"))
    ph, pl = prev if prev else (np.nan, np.nan)
    cur.execute("INSERT INTO days VALUES (" + ",".join("?" * 21) + ")", (dk, date, float(op), float(hi), float(lo), float(cl), float(R),
                None if not np.isfinite(U) else float(U), None if not np.isfinite(U) else float((cl - op) / U), float(eff),
                float((cl - lo) / R) if R > 0 else None, dtype, int(prev is not None and hi < ph and lo > pl), int(prev is not None and hi > ph and lo < pl),
                int(prev is not None and hi > ph), int(prev is not None and lo < pl), int(prev is not None and cl > ph), int(prev is not None and cl < pl),
                float(np.median((h[w] - l[w]) / c[w]) * 100), float(np.median(sp[w])), int(tv[w].sum())))
    if np.isfinite(U) and U > 0:
        # --- prev-day level break / false break
        if prev:
            for side, lvl in ((1, ph), (-1, pl)):
                beyond = (c[w] - lvl) * side > 0
                if beyond.any(): add_event("PREVDAY_BREAK", w[int(np.argmax(beyond))], w, side, U)
                ext = (h[w] - lvl) if side > 0 else (lvl - l[w]); poke = np.flatnonzero(ext >= 0.05 * U)
                if len(poke):
                    p0 = poke[0]; back = np.flatnonzero(((c[w[p0:p0 + 30]] - lvl) * side) < 0)
                    if len(back): add_event("PREVDAY_FALSEBREAK", w[p0 + back[0]], w, -side, U)
        # --- asia range (open 17:00 ET .. 02:59 ET) break after london open, first close beyond per side; x1 = asia range / ADR
        asia = PH[w] == "asia"
        if asia.sum() >= 240 and (~asia).any():
            ah, al = h[w[asia]].max(), l[w[asia]].min(); later = w[~asia]
            for side, lvl in ((1, ah), (-1, al)):
                beyond = (c[later] - lvl) * side > 0
                if beyond.any(): add_event("ASIA_BREAK", later[int(np.argmax(beyond))], w, side, U, (ah - al) / U)
        # --- previous-week high/low break, first close beyond per side per week; x1 = distance of level from session open / ADR
        wk = datetime.fromtimestamp(dk * 86400, timezone.utc).isocalendar()[:2]
        if wk != cur_wk: cur_wk = wk; wk_broken = set()
        pw = max((k for k in wk_hilo if k < wk), default=None)
        if pw is not None:
            wh, wl = wk_hilo[pw]
            for side, lvl in ((1, wh), (-1, wl)):
                if side in wk_broken: continue
                beyond = (c[w] - lvl) * side > 0
                if beyond.any():
                    wk_broken.add(side); add_event("PREVWEEK_BREAK", w[int(np.argmax(beyond))], w, side, U, (lvl - op) * side / U)
        # --- zigzag swings (reversal >= 20% ADR), with confirmation index
        th = 0.2 * U; piv = []; dd = 0; ep = c[w[0]]; ei = 0; st = c[w[0]]
        for n in range(1, len(w)):
            hh_, ll_ = h[w[n]], l[w[n]]
            if dd == 0:
                if hh_ >= st + th: dd = 1; ep, ei = hh_, n
                elif ll_ <= st - th: dd = -1; ep, ei = ll_, n
            elif dd == 1:
                if hh_ >= ep: ep, ei = hh_, n
                elif ll_ <= ep - th: piv.append((ei, ep, 1, n)); dd = -1; ep, ei = ll_, n
            else:
                if ll_ <= ep: ep, ei = ll_, n
                elif hh_ >= ep + th: piv.append((ei, ep, -1, n)); dd = 1; ep, ei = hh_, n
        for m, (pi, pp, kind, cn) in enumerate(piv):
            sw_id += 1
            size = abs(pp - piv[m - 1][1]) / U if m else None; mins = pi - piv[m - 1][0] if m else None
            cur.execute("INSERT INTO swings VALUES (?,?,?,?,?,?,?,?)", (sw_id, dk, int(t[w[pi]]), int(t[w[cn]]), float(pp), kind, size, mins))
            ci = w[cn]; newdir = -kind                                   # the leg that starts after this extreme
            if m >= 2:
                q0 = piv[m - 2][1]; beyond = (pp - q0) * kind / U
                typ = ("SWING_DOUBLE" if abs(beyond) <= 0.03 else ("SWING_SWEEP" if beyond <= 0.08 and beyond > 0.03 else
                       ("SWING_BREAKOUT_THEN_REVERSAL" if beyond > 0.08 else "SWING_LOWERHIGH_HIGHERLOW")))
                add_event(typ, ci, w, newdir, U, beyond)
            if m >= 2:
                imp = abs(piv[m - 1][1] - piv[m - 2][1]) / U
                if imp >= 0.5:                                           # this pivot ends a pullback after an impulse
                    retr = abs(pp - piv[m - 1][1]) / (imp * U)
                    band = "SHALLOW" if retr < 0.382 else ("MID" if retr < 0.618 else ("DEEP" if retr < 1.0 else "REVERSED"))
                    add_event("PULLBACK_" + band, ci, w, int(np.sign(piv[m - 1][1] - piv[m - 2][1])), U, retr)
        # --- fast move >= 25% ADR in 30 min
        n = 30
        while n < len(w) - 6:
            mv = (c[w[n]] - c[w[n - 30]]) / U
            if abs(mv) >= 0.25: add_event("FASTMOVE", w[n], w, int(np.sign(mv)), U, abs(mv)); n += 60
            else: n += 5
        # --- squeeze end (60-min range <= 12% ADR), direction = first break of the squeeze box within 60 min
        n = 60
        while n < len(w) - 6:
            box_h, box_l = h[w[n - 60:n]].max(), l[w[n - 60:n]].min()
            if (box_h - box_l) / U <= 0.12:
                nxt = w[n:n + 60]; up = np.flatnonzero(c[nxt] > box_h); dn = np.flatnonzero(c[nxt] < box_l)
                fu = up[0] if len(up) else 10 ** 9; fd = dn[0] if len(dn) else 10 ** 9
                if min(fu, fd) < 10 ** 9: add_event("SQUEEZE_BREAK", nxt[min(fu, fd)], w, 1 if fu < fd else -1, U)
                n += 60
            else: n += 15
    closes.append(cl); prev = (hi, lo)
    wkk = datetime.fromtimestamp(int(day[w[0]]) * 86400, timezone.utc).isocalendar()[:2]
    wh0, wl0 = wk_hilo.get(wkk, (-np.inf, np.inf)); wk_hilo[wkk] = (max(wh0, hi), min(wl0, lo))
db.commit()
for tb in ("bars_m1", "days", "swings", "events", "outcomes"):
    print(tb, cur.execute(f"SELECT COUNT(*) FROM {tb}").fetchone()[0])
print(cur.execute("SELECT type, COUNT(*) FROM events GROUP BY type ORDER BY 2 DESC").fetchall())
db.close(); print("->", OUT, os.path.getsize(OUT) // 1024 // 1024, "MB")
