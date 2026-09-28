r"""Independent checks that the library cannot leak the future (run after adx_build.py).
1) as_of(T) == a plain SQL filter written separately (many T: every month start + random minutes), and nothing returned closes after T
2) time travel: rebuild the whole library from bars cut at T (ADX_LIB_TO=T, separate file) and compare with as_of(T) of the full
   library row by row, every column. Equal = what the selector sees at T is exactly what could have been built at T."""
import os, sys, sqlite3, subprocess
import numpy as np
import adx_asof as AS

bad = 0
def rep(name, n, extra=""):
    global bad; bad += n > 0
    print(f"{'OK ' if n == 0 else 'BAD'} {name}: {n} {extra}")

db = sqlite3.connect(AS.DBT)
cols = [r[1] for r in db.execute("PRAGMA table_info(trades)")]
tmin, tmax = db.execute("SELECT MIN(entry_t), MAX(exit_t) FROM trades").fetchone()
rng = np.random.default_rng(7)
Ts = AS.months("2024-05-01", "2026-10-01") + [int(x) // 60 * 60 for x in rng.integers(tmin, tmax, 40)]
n_bad = n_late = 0
for T in Ts:
    a = AS.as_of(T)
    ka = set(zip(a["set_id"].tolist(), a["entry_t"].tolist()))
    kb = set(db.execute("SELECT set_id, entry_t FROM trades WHERE exit_t <= ?", (T - 60,)).fetchall())
    n_bad += ka != kb
    n_late += int((a["exit_t"] + 60 > T).sum()) if len(a["exit_t"]) else 0
rep(f"as_of(T) differs from independent SQL (of {len(Ts)} T)", n_bad)
rep("trades closing after T returned", n_late)

py = sys.executable; here = os.path.dirname(os.path.abspath(__file__))
for Tday in ("2025-03-01", "2026-02-01", "2026-06-17"):
    out = os.path.join(os.environ.get("TEMP", here), f"adx_trades_cut_{Tday}.sqlite")
    env = dict(os.environ, ADX_LIB_TO=Tday, ADX_OUT=out)
    subprocess.run([py, os.path.join(here, "adx_build.py")], env=env, check=True, stdout=subprocess.DEVNULL)
    c = sqlite3.connect(out)
    cut = np.array(c.execute(f"SELECT {','.join(cols)} FROM trades ORDER BY set_id, entry_t").fetchall(), dtype=float)
    a = AS.as_of(Tday); full = np.column_stack([a[k].astype(float) for k in cols])
    same_shape = cut.shape == full.shape
    diff = int(np.sum(~np.isclose(cut, full, rtol=0, atol=1e-9))) if same_shape else -1
    rep(f"time-travel {Tday}: rebuilt-from-cut vs as_of (rows {len(cut)} vs {len(full)})", 0 if (same_shape and diff == 0) else 1,
        "" if same_shape else "row count differs")
    if same_shape and diff: print("   differing cells", diff)
    c.close(); os.remove(out)
print("RESULT:", "all as-of checks passed" if bad == 0 else f"{bad} check(s) failed")
