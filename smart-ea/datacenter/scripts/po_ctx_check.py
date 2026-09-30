r"""Independent check of the contexts used by po_eval2 (real market): at every library row whose decision time equals an AdxEma entry
time (table ctx of adx_trades.sqlite, built and audited in phase 2), compare
  regime  <-> ctx.m5k3_reg  (M5 zigzag-3 regime of the last closed M5 bar)
  day pos <-> ctx.d_day_pos (position of the last close in today's range so far)
  session <-> ctx session column (New York clock)
The po_eval2 functions are taken from its source (definitions only; the evaluation part is not run)."""
import sys, os, sqlite3
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, po_lib as PO

src = open(r"C:\trade datacenter\scripts\po_eval2.py", encoding="utf-8").read().split("t0 = time.time()")[0]
ns = {}; exec(compile(src, "po_eval2_defs", "exec"), ns)
db = sqlite3.connect(r"C:\trade datacenter\adx_trades.sqlite")
cols = [r[1] for r in db.execute("PRAGMA table_info(ctx)")]
scol = ["t_phase"]   # phase of the ENTRY time; library uses the bar OPEN time -> may differ only in the first bar of a phase
print("session-like ctx columns:", scol, "| descr:", list(db.execute(f"SELECT name, description FROM columns WHERE name IN ({','.join('?' * len(scol))})", scol)))
TF = int(os.environ.get("PO_TF", 5))
R = dict(np.load(PO.OUTD + rf"\po_m{TF}_real.npz")); M = PO.load_market("real")
C = ns["context_arrays"](M, R)
q = f"SELECT entry_t, m{TF}k3_reg, d_day_pos{',' + scol[0] if scol else ''} FROM ctx"
X = np.array(db.execute(q).fetchall(), dtype=float)
et = X[:, 0].astype(np.int64); pos = np.searchsorted(et, R["dec_t"]); ok = (pos < len(et)) & (et[np.minimum(pos, len(et) - 1)] == R["dec_t"])
# only rows where the last closed M5 bar at the entry is this library bar: entry on an M5 boundary
ok &= (R["dec_t"] % (60 * TF) == 0)
i = np.flatnonzero(ok); j = pos[ok]
print("rows compared", len(i))
reg_ok = np.isfinite(X[j, 1]); print("regime equal", np.mean(C["reg"][i][reg_ok] == X[j, 1][reg_ok]), "(n", reg_ok.sum(), ")")
dp_ok = np.isfinite(X[j, 2]); d = np.abs(C["pos"][i][dp_ok] - X[j, 2][dp_ok])
print("day pos |diff| max", d.max(), " share > 1e-9", np.mean(d > 1e-9))
if scol:
    print("session codes ctx", np.unique(X[j, 3]), "mine", np.unique(C["sess"][i]))
    tab = {}
    for a, b in zip(X[j, 3], C["sess"][i]): tab[(a, b)] = tab.get((a, b), 0) + 1
    print("pairs (ctx, mine): count", tab)


