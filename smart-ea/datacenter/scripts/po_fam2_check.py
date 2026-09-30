r"""Checks of the layer-1a labels (po_fam2), real market:
 A. no future data: rebuild the labels from bars cut at time T (several T) and compare every row whose decision time <= T
 B. htf regime vs the phase-2 ctx table (m5k3_reg for M1, m15k3_reg for M3/M5) at AdxEma entry times that are library decision times
 C. pullback families recomputed with a separate loop from the pivots (zigzag_state), incl. the depth class
 D. formation counts vs the catalog table patterns_c (gold_dc.sqlite) where the catalog stored them (TF 1/5, per type) - sanity only
Usage: python po_fam2_check.py <tf>"""
import sys, os, sqlite3
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, po_lib as PO, po_fam2 as F2, adx_ctx as X
tf = int(sys.argv[1]); bad = 0
M = PO.load_market("real")
R = {k: v for k, v in np.load(os.path.join(PO.OUTD, f"po_m{tf}_real.npz")).items() if k in ("b", "dec_t", "day")}
Z = dict(np.load(os.path.join(PO.OUTD, f"po_fam2_m{tf}_real.npz")))
# A
t = M["t"]
for T in (1718000000, 1735700000, 1750000000, 1767300000, 1780000000, 1790000000):
    k = np.searchsorted(t, T, "left"); Mc = {kk: (v[:k] if isinstance(v, np.ndarray) and len(v) == len(t) else v) for kk, v in M.items()}
    Bc = X.resample(Mc, tf); keep = R["b"] < len(Bc["c"])
    # rows whose bar is complete in the cut data and whose decision time is before T
    ok = keep & (R["dec_t"] <= T)
    Rc = {"b": R["b"][ok], "dec_t": R["dec_t"][ok], "day": R["day"][ok]}
    Oc = F2.labels(Mc, tf, Rc)
    diff = {kk: int(np.sum(Oc[kk] != Z[kk][ok])) for kk in Oc if kk != "htf_bar"}
    nd = sum(diff.values()); bad += nd
    print(f"A T={T}: rows {ok.sum()}  differences {nd}  " + ("" if nd == 0 else str({a: b for a, b in diff.items() if b})))
# B
db = sqlite3.connect(r"C:\trade datacenter\adx_trades.sqlite"); col = "m5k3_reg" if tf == 1 else "m15k3_reg"
Q = np.array(db.execute(f"SELECT entry_t, {col} FROM ctx").fetchall(), dtype=float)
et = Q[:, 0].astype(np.int64); pos = np.searchsorted(et, R["dec_t"]); pos = np.minimum(pos, len(et) - 1)
m = (et[pos] == R["dec_t"]) & np.isfinite(Q[pos, 1])
eq = np.mean(Z["htf_reg"][m] == Q[pos[m], 1]); bad += int(np.sum(Z["htf_reg"][m] != Q[pos[m], 1]))
print(f"B htf regime vs ctx.{col}: rows {m.sum()} equal {eq:.4%}")
# C
B = X.resample(M, tf); idx, pp, kind, conf, _, _ = X.zigzag_state(B, 3)
want = {f: np.zeros(len(B["c"]), np.int8) for f in ("pb_shallow", "pb_mid", "pb_deep")}
for j in range(3, len(pp)):
    if kind[j] < 0: up = pp[j] > pp[j - 2] and pp[j - 1] > pp[j - 3]; s = 1 if up else 0
    else: dn = pp[j] < pp[j - 2] and pp[j - 1] < pp[j - 3]; s = -1 if dn else 0
    if s == 0: continue
    q = (pp[j - 1] - pp[j]) / (pp[j - 1] - pp[j - 2])                  # same sign for both directions
    want["pb_shallow" if q < 0.382 else ("pb_mid" if q <= 0.618 else "pb_deep")][conf[j]] = s
for f in want:
    nd = int(np.sum(want[f][R["b"]] != Z["f_" + f])); bad += nd; print(f"C {f}: events {int((Z['f_' + f] != 0).sum())} differences {nd}")
# D
try:
    g = sqlite3.connect(r"C:\trade datacenter\gold_dc.sqlite")
    cols = [r[1] for r in g.execute("PRAGMA table_info(patterns_c)")]
    print("D patterns_c columns:", cols)
    if "tf" in cols:
        for r in g.execute("SELECT type, COUNT(*) FROM patterns_c WHERE tf = ? GROUP BY type", (tf,)).fetchall(): print("   catalog", r)
except Exception as e: print("D skipped:", e)
for f in F2.FAM2: print(f"   library M{tf} {f}: {int((Z['f_' + f] != 0).sum())}")
print("TOTAL differences", bad)
