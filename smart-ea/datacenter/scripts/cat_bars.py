"""Shared loader: M1 bars from gold_dc.sqlite resampled to TF bars inside real trading sessions (same method as dc_catalog.py),
with ATR20 = mean true range of the 20 PREVIOUS bars of that TF."""
import numpy as np, sqlite3, os
from dc_sessions import sessions, phase, full_days
from broker import DB
_M1 = None
def m1():
    global _M1
    if _M1 is None:
        db = sqlite3.connect(DB)
        R = np.array(db.execute("SELECT t,o,h,l,c,tick_vol,spread FROM bars_m1 ORDER BY t").fetchall())
        T = R[:, 0].astype(np.int64); sid, day, et = sessions(T)
        _M1 = dict(t=T, o=R[:, 1], h=R[:, 2], l=R[:, 3], c=R[:, 4], tv=R[:, 5], sp=R[:, 6], sid=sid, day=day, et=et)
    return _M1
def tf_bars(tf):
    M = m1(); T, SID = M["t"], M["sid"]
    key = SID * 10 ** 7 + T // (tf * 60)
    st = np.concatenate([[0], np.flatnonzero(np.diff(key)) + 1]); en = np.concatenate([st[1:], [len(T)]])
    B = dict(t=T[en - 1], t_open=T[st], o=M["o"][st], c=M["c"][en - 1], h=np.maximum.reduceat(M["h"], st), l=np.minimum.reduceat(M["l"], st),
             sid=SID[st], day=M["day"][en - 1], et=M["et"][en - 1], m1_start=st, m1_end=en, tv=np.add.reduceat(M["tv"], st))
    n = len(B["t"]); pc = np.r_[B["c"][0], B["c"][:-1]]
    tr = np.maximum(B["h"], pc) - np.minimum(B["l"], pc); cs = np.r_[0, np.cumsum(tr)]
    atr = np.full(n, np.nan); atr[20:] = (cs[20:n] - cs[:n - 20]) / 20; B["atr"] = atr; B["phase"] = phase(B["et"])
    return B
def adr_map():
    db = sqlite3.connect(DB); return dict(db.execute("SELECT day, adr20 FROM days").fetchall())
def full_list():
    """trading dates with normal data (>= 90% of median bars/day) and a known ADR20, sorted"""
    A = adr_map(); return np.array([d for d in full_days(m1()["day"]) if A.get(int(d))], dtype=np.int64)
