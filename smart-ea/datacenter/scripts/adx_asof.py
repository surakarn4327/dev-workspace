r"""The ONLY way decision code (Strategy Selector, walk-forward tests) should read adx_trades.sqlite.

as_of(T) returns the library exactly as it would have looked at time T: only trades that were fully closed before T
(exit_t + 60 <= T, exit_t is the open of the M1 bar in which the trade closed, so the close happened at most 60 s later).
Trades still open at T and anything after T are invisible. T accepts 'YYYY-MM-DD', 'YYYY-MM-DD HH:MM' (UTC) or epoch seconds.

    from adx_asof import as_of, months
    for T in months("2025-02-01", "2025-12-01"):       # walk forward month by month
        lib = as_of(T)                                 # dict of numpy columns, sorted by set_id, entry_t
        ...decide with lib only, then trade [T, next month)...
"""
import os, sqlite3
from datetime import datetime, timezone
import numpy as np
import broker as BK

DBT = os.path.join(os.path.dirname(BK.DB), "adx_trades.sqlite")
_ALL = None

def to_ts(T):
    if isinstance(T, (int, np.integer)): return int(T)
    fmt = "%Y-%m-%d %H:%M" if len(str(T)) > 10 else "%Y-%m-%d"
    return int(datetime.strptime(str(T), fmt).replace(tzinfo=timezone.utc).timestamp())

def _load():
    global _ALL
    if _ALL is None:
        db = sqlite3.connect(DBT)
        cols = [r[1] for r in db.execute("PRAGMA table_info(trades)")]
        rows = np.array(db.execute(f"SELECT {','.join(cols)} FROM trades ORDER BY set_id, entry_t").fetchall(), dtype=float)
        _ALL = {c: rows[:, i] for i, c in enumerate(cols)}
        for c in ("set_id", "n", "sig_t", "entry_t", "exit_t", "day", "dir", "exit_reason", "hit_tp1", "hit_tp2", "hold_min"):
            _ALL[c] = _ALL[c].astype(np.int64)
    return _ALL

def as_of(T, set_ids=None):
    """Trades fully closed before T (optionally only some set_ids). Returns a dict of numpy arrays (copies)."""
    t = to_ts(T); A = _load()
    m = A["exit_t"] + 60 <= t
    if set_ids is not None: m &= np.isin(A["set_id"], np.asarray(set_ids))
    return {c: v[m].copy() for c, v in A.items()}

_CTX = None
def ctx_for(entry_t, columns=None):
    """Market context at entry (table ctx, phase 2) for an array of entry times, e.g. ctx_for(as_of(T)["entry_t"]).
    Every value was computed only from data before its entry time (see adx_ctx.py / adx_ctx_check.py), so it is safe to use
    together with as_of(). Returns a dict of numpy float arrays (NULL -> nan) aligned with entry_t."""
    global _CTX
    if _CTX is None:
        db = sqlite3.connect(DBT)
        cols = [r[1] for r in db.execute("PRAGMA table_info(ctx)")]
        rows = np.array(db.execute(f"SELECT {','.join(cols)} FROM ctx ORDER BY entry_t").fetchall(), dtype=float)
        _CTX = {c: rows[:, i] for i, c in enumerate(cols)}
    e = np.asarray(entry_t, dtype=np.int64); key = _CTX["entry_t"].astype(np.int64)
    pos = np.searchsorted(key, e)
    if len(e) and (np.any(pos >= len(key)) or np.any(key[np.clip(pos, 0, len(key) - 1)] != e)):
        raise KeyError("entry_t without a ctx row — rerun adx_ctx.py after adx_build.py")
    return {c: v[pos].copy() for c, v in _CTX.items() if columns is None or c in columns or c == "entry_t"}

def params():
    db = sqlite3.connect(DBT)
    cols = [r[1] for r in db.execute("PRAGMA table_info(params)")]
    return [dict(zip(cols, r)) for r in db.execute(f"SELECT {','.join(cols)} FROM params ORDER BY set_id")]

def months(first, last):
    """First day of every month from `first` to `last` inclusive, as UTC epoch seconds."""
    a, b = datetime.strptime(first, "%Y-%m-%d"), datetime.strptime(last, "%Y-%m-%d"); out = []
    y, m = a.year, a.month
    while (y, m) <= (b.year, b.month):
        out.append(int(datetime(y, m, 1, tzinfo=timezone.utc).timestamp())); y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out
