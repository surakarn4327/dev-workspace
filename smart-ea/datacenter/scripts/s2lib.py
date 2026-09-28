"""Stage-2 helpers: load clean bars + events from the data center and simulate tradable outcomes on a fine SL/TP grid.

Trade model (conservative, matches the EA rules):
- entry at the close of the event bar (bid) ; cost = spread at entry bar, charged as spread/(SL) in R
- SL / TP measured on bid highs/lows from the entry price; if both touched in the same M1 bar -> SL first
- forced exit at the cutoff (16:00 UTC = 23:00 Thai, EA rule 1) or session end if earlier; no entry after `last_entry_h` (UTC hour)
- sizes in ADR20 units of that session (U)
- all times UTC (broker clock converted by broker.py)
NOTE: bar spread before broker.SPREAD_OK_FROM is not a real cost (see brokers\<name>.json)
"""
import numpy as np, sqlite3, os
from datetime import datetime, timezone
import broker as BK
HERE = os.path.dirname(os.path.abspath(__file__))
DB = BK.DB
T0 = BK.T0
SLS = np.array([0.05, 0.075, 0.10, 0.125, 0.15, 0.20, 0.25, 0.30])
TPS = np.array([0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0, 9.0])       # 9.0 = no TP (exit at cutoff)
CUTOFF_H = 16                                                   # UTC hour = 23:00 Thai (user's cutoff)
LAST_ENTRY_H = 14                                               # UTC hour = 21:00 Thai (no entry 120 min before cutoff)

_B = None
def bars():
    global _B
    if _B is None:
        B = np.load(BK.BARS); tu = BK.server_to_utc(B["t"]); k = tu >= T0
        _B = {x: B[x][k] for x in ("o", "h", "l", "c", "tv", "sp")}; _B["t"] = tu[k]
        _B["sp"] = _B["sp"] * BK.POINT
        from dc_sessions import sessions
        _B["sid"], _B["day"], _B["et"] = sessions(_B["t"])
    return _B

def events(types=None):
    db = sqlite3.connect(DB)
    q = ("SELECT e.id,e.type,e.t,e.day,e.dir,e.hour,e.session,e.activity_so_far,e.backdrop5_aligned,e.spread_adr,e.x1,d.adr20,"
         "o.fwd240,o.fwd_end FROM events e JOIN days d ON d.day=e.day JOIN outcomes o ON o.event_id=e.id")
    if types: q += " WHERE e.type IN (" + ",".join("'" + x + "'" for x in types) + ")"
    rows = db.execute(q + " ORDER BY e.t").fetchall()
    cols = ["id", "type", "t", "day", "dir", "hour", "session", "so_far", "bk5", "spread_adr", "x1", "U", "fwd240", "fwd_end"]
    E = {c: np.array([r[k] for r in rows]) for k, c in enumerate(cols)}
    for c in ("so_far", "spread_adr", "x1", "U", "fwd240", "fwd_end"): E[c] = E[c].astype(float)
    return E

def days():
    db = sqlite3.connect(DB)
    rows = db.execute("SELECT day,date,open,high,low,close,range,adr20,net_adr,efficiency,day_type,activity_1m_range_pct,"
                      "spread_median,tick_vol_sum FROM days ORDER BY day").fetchall()
    cols = ["day", "date", "open", "high", "low", "close", "range", "adr20", "net_adr", "eff", "day_type", "act", "spread_med", "tv"]
    D = {c: np.array([r[k] for r in rows]) for k, c in enumerate(cols)}
    for c in ("open", "high", "low", "close", "range", "adr20", "net_adr", "eff", "act", "spread_med"):
        D[c] = np.array([np.nan if v is None else v for v in D[c]], dtype=float)
    return D

def simulate(ev_t, ev_dir, ev_U, cutoff_h=CUTOFF_H, sls=SLS, tps=TPS, last_entry_h=LAST_ENTRY_H):
    """Returns R[n, len(sls), len(tps)] after spread (nan = not tradable), plus hold minutes for (sl,tp) grid."""
    B = bars(); t, h, l, c, sp, day = B["t"], B["h"], B["l"], B["c"], B["sp"], B["day"]
    n = len(ev_t); R = np.full((n, len(sls), len(tps)), np.nan); HOLD = np.full((n, len(sls), len(tps)), np.nan)
    idx = np.searchsorted(t, ev_t)
    for k in range(n):
        i = idx[k]; d = ev_dir[k]; U = ev_U[k]
        if i >= len(t) or t[i] != ev_t[k] or not np.isfinite(U): continue
        hr = (t[i] // 3600) % 24
        # session hours: 23 (open) .. 22 ; tradable window is 23..last_entry_h
        if not (hr == 23 or hr < last_entry_h): continue
        dk = day[i]
        cut_t = (dk * 86400 - 86400) + (24 + cutoff_h) * 3600      # server cutoff hour on the session date (EA uses fixed server hours)
        j_end = np.searchsorted(t, cut_t) - 1
        j_end = min(j_end, np.searchsorted(day, dk, "right") - 1)
        if j_end <= i + 1: continue
        seg = slice(i + 1, j_end + 1); px = c[i]
        fav = np.maximum.accumulate((h[seg] - px) if d > 0 else (px - l[seg])) / U
        adv = np.maximum.accumulate((px - l[seg]) if d > 0 else (h[seg] - px)) / U
        last = d * (c[j_end] - px) / U; cost = sp[i] / U; m = len(fav)
        fs = np.searchsorted(adv, sls, "left")          # first bar where adverse >= SL (m if never)
        ft = np.searchsorted(fav, tps, "left")
        for a, slv in enumerate(sls):
            for b, tpv in enumerate(tps):
                if fs[a] < m and fs[a] <= ft[b]: r = -1.0; hm = fs[a] + 1
                elif ft[b] < m: r = tpv / slv; hm = ft[b] + 1
                else: r = last / slv; hm = m
                R[k, a, b] = r - cost / slv; HOLD[k, a, b] = hm
    return R, HOLD

def max_losing_streak(r):
    best = cur = 0
    for x in r:
        cur = cur + 1 if x < 0 else 0; best = max(best, cur)
    return best

def stats(r):
    r = r[np.isfinite(r)]
    if len(r) < 2: return dict(n=len(r), mean=np.nan, se=np.nan, t=np.nan, wr=np.nan, aw=np.nan, al=np.nan, streak=0)
    w = r[r > 0]; lo = r[r <= 0]
    return dict(n=len(r), mean=r.mean(), se=r.std(ddof=1) / np.sqrt(len(r)), t=r.mean() / (r.std(ddof=1) / np.sqrt(len(r))),
                wr=len(w) / len(r), aw=w.mean() if len(w) else 0, al=lo.mean() if len(lo) else 0, streak=max_losing_streak(r))

def quarter_key(ts):
    d = [datetime.fromtimestamp(int(x), timezone.utc) for x in ts]
    return np.array([x.year * 10 + (x.month - 1) // 3 + 1 for x in d])
