"""Phase 1 integrity checks for adx_trades.sqlite: duplicates, overlapping trades, trading hours, missing days, NaN, column docs."""
import sqlite3, os
import numpy as np
import broker as BK
from dc_sessions import full_days
DBT = os.path.join(os.path.dirname(BK.DB), "adx_trades.sqlite")
db = sqlite3.connect(DBT); g = sqlite3.connect(BK.DB)
bad = 0
def rep(name, n, show=None):
    global bad; bad += n > 0
    print(f"{'OK ' if n == 0 else 'BAD'} {name}: {n}" + (f"  e.g. {show}" if n and show else ""))

cols = [r[1] for r in db.execute("PRAGMA table_info(trades)")]
doc = {r[0] for r in db.execute("SELECT name FROM columns WHERE tbl='trades'")}
rep("trade columns without description", len(set(cols) - doc), set(cols) - doc)
pcols = [r[1] for r in db.execute("PRAGMA table_info(params)")]
pdoc = {r[0] for r in db.execute("SELECT name FROM columns WHERE tbl='params'")}
rep("param columns without description", len(set(pcols) - pdoc))
nsets = db.execute("SELECT COUNT(*) FROM params").fetchone()[0]; print("sets", nsets, "trades", db.execute("SELECT COUNT(*) FROM trades").fetchone()[0])
rep("sets != 432", int(nsets != 432))
rep("duplicate (set_id, entry_t)", db.execute("SELECT COUNT(*) FROM (SELECT set_id, entry_t FROM trades GROUP BY 1,2 HAVING COUNT(*)>1)").fetchone()[0])
rep("params.n_trades != rows", db.execute("SELECT COUNT(*) FROM params p WHERE n_trades != (SELECT COUNT(*) FROM trades t WHERE t.set_id=p.set_id)").fetchone()[0])
# overlap: next entry before previous exit (same minute allowed only when the exit happened at that bar's open)
T = np.array(db.execute("SELECT set_id, entry_t, exit_t, exit_reason FROM trades ORDER BY set_id, entry_t").fetchall())
same = T[1:, 0] == T[:-1, 0]
rep("overlapping trades (entry < previous exit)", int((same & (T[1:, 1] < T[:-1, 2])).sum()))
# hours: server = UTC for Exness; entries must be in [23,16), exits of cutoff type at hour 16..22
srv = T[:, 1]  # Exness server clock == UTC
h = (srv // 3600) % 24
rep("entries outside 23:00-15:59 server", int(((h >= 16) & (h < 23)).sum()))
hx = (T[:, 2] // 3600) % 24
rep("exits held past cutoff (non-cutoff exit in 16-22h)", int((((hx >= 16) & (hx < 23)) & (T[:, 3] != 3)).sum()))
rep("data-end exits (reason 4)", int((T[:, 3] == 4).sum()))
rep("hold > 18h", int(((T[:, 2] - T[:, 1]) > 18 * 3600).sum()))
nan = db.execute("SELECT COUNT(*) FROM trades WHERE r_raw IS NULL OR r_std IS NULL OR risk_px<=0 OR atr<=0 OR r_raw != r_raw").fetchone()[0]
rep("NULL/NaN/non-positive risk", nan)
# missing days: every full trading day in range should have M1 trades in the loosest M1 sets (min_adx 0, gap 0)
lo, hi = db.execute("SELECT MIN(day), MAX(day) FROM trades").fetchone()
M1 = np.array(g.execute("SELECT t FROM bars_m1").fetchall())[:, 0]
from dc_sessions import sessions
_, dd, _ = sessions(M1); fd = [int(d) for d in full_days(dd) if lo <= d <= hi]
loose = [r[0] for r in db.execute("SELECT set_id FROM params WHERE tf=1 AND min_adx=0 AND min_gap=0")]
have = {r[0] for r in db.execute(f"SELECT DISTINCT day FROM trades WHERE set_id IN ({','.join(map(str, loose))})")}
miss = [d for d in fd if d not in have]
rep(f"full trading days without any M1 trade (of {len(fd)})", len(miss), miss[:10])
for tf in (1, 3, 5):
    ids = [r[0] for r in db.execute(f"SELECT set_id FROM params WHERE tf={tf}")]
    days = {r[0] for r in db.execute(f"SELECT DISTINCT day FROM trades WHERE set_id IN ({','.join(map(str, ids))})")}
    print(f"   M{tf}: trades on {len(days & set(fd))}/{len(fd)} full days")
# phase 2: table ctx must exist and cover every entry time (adx_build.py rebuilds it; missing = run adx_ctx.py)
has_ctx = db.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='ctx'").fetchone()[0]
if has_ctx:
    miss_ctx = db.execute("SELECT COUNT(*) FROM (SELECT DISTINCT entry_t FROM trades) t LEFT JOIN ctx c USING(entry_t) WHERE c.entry_t IS NULL").fetchone()[0]
    extra_ctx = db.execute("SELECT COUNT(*) FROM ctx WHERE entry_t NOT IN (SELECT DISTINCT entry_t FROM trades)").fetchone()[0]
    rep("entry times without a ctx row / ctx rows without trades (run adx_ctx.py)", miss_ctx + extra_ctx)
else:
    rep("table ctx missing (run adx_ctx.py)", 1)
# the code in C:\trade datacenter must match its copy in the git repo (dev-workspace\smart-ea\datacenter), see sync_repo.py
import sync_repo
rep("files differing from the repo copy (run sync_repo.py, then commit)", len(sync_repo.diff()), sync_repo.diff()[:5])
print("RESULT:", "all checks passed" if bad == 0 else f"{bad} check(s) failed")
