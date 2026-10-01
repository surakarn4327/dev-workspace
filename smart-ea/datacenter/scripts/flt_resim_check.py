r"""The no-filter re-simulation must equal the stored library: per set n, entry_t, exit_t, dir, r_std, vol_mult identical."""
import sys, pickle, sqlite3
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np
res = pickle.load(open(r"C:\trade datacenter\flt\flt_resim.pkl", "rb"))["none"]
db = sqlite3.connect(r"C:\trade datacenter\adx_trades.sqlite")
R = np.array(db.execute("SELECT set_id, entry_t, exit_t, day, dir, r_std, vol_mult FROM trades ORDER BY set_id, entry_t").fetchall(), float)
bad = 0; nt = 0
for s in range(1, 433):
    a = R[R[:, 0] == s][:, 1:]; b = res[s]
    if a.shape != b.shape: bad += 1; print("set", s, "shape", a.shape, b.shape); continue
    d = np.abs(a - b).max() if len(a) else 0.0; nt += len(a)
    if d > 1e-9: bad += 1; print("set", s, "max diff", d)
print(f"sets {len(res)}, trades compared {nt}, sets with a difference {bad}:", "PASS" if not bad else "FAIL")
