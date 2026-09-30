r"""Phase 4 - Strategy Selector, step 2: exit rules from 3B-B applied to every trade of the library (training field only).

Rule (a)  M3: cut the whole remaining position at the FIRST decision tick where price makes a new day extreme against the trade
          (BUY: bit daylow, SELL: bit dayhigh; old extreme stood >= 60 min) = pattern "dayext_against" / level all / first
          occurrence of p3b. Result = dec.r_cut of that row (includes TP1/TP2 already banked, standard cost), exit time = dec_t.
Rule (b)  M5: never cut a trade that floats +0.5..+1R before plan  -> the plan already never does that, so (b) changes nothing;
          it is recorded here only as a constraint for later rules (no other exit rule may cut such M5 trades).
M1 trades: unchanged (the M1 version of (a) was labelled "mechanism" and weakened under finer state bins).

adjusted(L) -> (r_adj, exit_adj, cut) aligned with the rows of an adx_asof.as_of() dict. Trades outside the 3B-A library
(trade-day >= 2026-06-01, the exam) raise, so the exam cannot be touched by accident.
"""
import sqlite3, numpy as np

DBH = r"C:\trade datacenter\adx_hold.sqlite"
B_DAYHIGH, B_DAYLOW = 1 << 9, 1 << 10
_CACHE = None

def _load():
    global _CACHE
    if _CACHE is None:
        db = sqlite3.connect(DBH)
        ut = np.array(db.execute("SELECT uid, tf, dir FROM utrades ORDER BY uid").fetchall(), dtype=np.int64)
        sm = np.array(db.execute("SELECT set_id, n, uid FROM set_map").fetchall(), dtype=np.int64)
        rows = np.array(db.execute(
            "SELECT d.uid, d.dec_t, d.r_cut FROM dec d JOIN utrades u ON u.uid = d.uid "
            "WHERE u.tf = 3 AND ((u.dir > 0 AND (d.flags & ?) != 0) OR (u.dir < 0 AND (d.flags & ?) != 0)) "
            "ORDER BY d.uid, d.dec_t", (B_DAYLOW, B_DAYHIGH)).fetchall(), dtype=float)
        first = np.r_[True, rows[1:, 0] != rows[:-1, 0]] if len(rows) else np.zeros(0, bool)
        f = rows[first]
        cut = {int(u): (float(r), int(t)) for u, t, r in f}
        key = {int(s) * 1_000_000 + int(n): int(u) for s, n, u in sm}
        _CACHE = (cut, key)
    return _CACHE

def adjusted(L):
    cut, key = _load()
    k = L["set_id"].astype(np.int64) * 1_000_000 + L["n"].astype(np.int64)
    r = L["r_std"].astype(float).copy(); ex = L["exit_t"].astype(np.int64).copy(); c = np.zeros(len(r), bool)
    for i, kk in enumerate(k):
        u = key.get(int(kk))
        if u is None: raise KeyError(f"trade (set {kk // 1_000_000}, n {kk % 1_000_000}) not in the 3B-A library (exam period?)")
        if u in cut:
            r[i], ex[i] = cut[u]; c[i] = True
    return r, ex, c
