r"""Phase 3B-c null 1: day swap of the market context (same swap as p3_perm.swapped_ci: every trade keeps its outcome and direction, its ctx
row is replaced by the ctx of an entry of the same TF on another day of the same half at the nearest minute of the day).
Too many cells (~530k) to keep every permutation, so two streaming passes:
  pass 1 (seeds 1000 + i, n1 draws): running mean / sd of every cell's null t  -> calibration (the null need not be centred, 3B-b)
  pass 2 (seeds 5000 + i, n2 draws): z = (t - mean1) / sd1 per cell; count per cell |z_null| >= |z_real| (per-cell p) and the largest
          |z| over all cells of every draw (family-wise p). The same for raw |t| (uncalibrated, for reference).
Time-of-day states (p3c_lib.TIME_FEATS) use null 1b = circular time shift inside the same day (p3c_lib.shift_ci) in the same draws.
Usage: python p3c_perm.py real [n1=200] [n2=500] [workers=6] -> p3c\<mk>_perm.pkl ; checkpoint every 25 draws, resumes."""
import os, sys, time, pickle, hashlib
import numpy as np
from multiprocessing import Pool
import p3lib as L, p3c_lib as C, p3_perm, adx_asof

HERE = os.path.dirname(os.path.abspath(__file__)); BASE = os.path.join(os.path.dirname(adx_asof.DBT), "p3c")
_T = _X = _E = None

def dbt_of(mk):
    return adx_asof.DBT if mk == "real" else os.path.join(os.path.dirname(adx_asof.DBT), "p3_null", mk, "adx_trades.sqlite")

def _init(mk):
    global _T, _X, _E
    _T, _X = L.load(dbt_of(mk)); _E = C.Engine(_T, _X, C.load_params(dbt_of(mk)))

def one(seed):
    # null 1 = day swap (p3_perm, as in phase 3 / 3B-b); TIME_FEATS use null 1b = circular time shift inside the day (own rng stream)
    return seed, _E.t_all(p3_perm.swapped_ci(_T, _X, seed), C.shift_ci(_T, _X, 100000 + seed)).astype(np.float64)

def main():
    mk = sys.argv[1] if len(sys.argv) > 1 else "real"; assert mk == "real", "day swap is run on the real market only"
    n1 = int(sys.argv[2]) if len(sys.argv) > 2 else 200; n2 = int(sys.argv[3]) if len(sys.argv) > 3 else 500
    w = int(sys.argv[4]) if len(sys.argv) > 4 else 6
    os.makedirs(BASE, exist_ok=True); t0 = time.time()
    code = hashlib.sha1(b"".join(open(os.path.join(HERE, f), "rb").read() for f in ("p3lib.py", "p3c_lib.py", "p3_perm.py", "p3c_perm.py"))).hexdigest()
    _init(mk); real = _E.t_all(); nc = len(real)
    part = os.path.join(BASE, f"{mk}_perm_partial.pkl")
    st = dict(code=code, nc=nc, s1=np.zeros(nc), q1=np.zeros(nc), c1=np.zeros(nc), n1done=0,
              ex_z=np.zeros(nc), ex_t=np.zeros(nc), c2=np.zeros(nc), maxz=[], maxt=[], n2done=0)
    if os.path.exists(part):
        z = pickle.load(open(part, "rb"))
        if z["code"] == code and z["nc"] == nc: st = z; print(f"resume: pass1 {st['n1done']}, pass2 {st['n2done']}", flush=True)
    def save():
        pickle.dump(st, open(part + ".tmp", "wb")); os.replace(part + ".tmp", part)
    with Pool(w, initializer=_init, initargs=(mk,)) as P:
        if st["n1done"] < n1:
            for k, (seed, t) in enumerate(P.imap(one, range(1000 + st["n1done"], 1000 + n1)), start=st["n1done"] + 1):
                f = np.isfinite(t); st["s1"][f] += t[f]; st["q1"][f] += t[f] ** 2; st["c1"][f] += 1; st["n1done"] = k
                if k % 25 == 0 or k == n1: save(); print(f"pass1 {k}/{n1} {time.time() - t0:.0f}s", flush=True)
        with np.errstate(invalid="ignore", divide="ignore"):
            m1 = st["s1"] / st["c1"]; sd1 = np.sqrt(np.maximum(st["q1"] / st["c1"] - m1 ** 2, 0) * st["c1"] / np.maximum(st["c1"] - 1, 1))
            zr = (real - m1) / sd1
        if st["n2done"] < n2:
            for k, (seed, t) in enumerate(P.imap(one, range(5000 + st["n2done"], 5000 + n2)), start=st["n2done"] + 1):
                with np.errstate(invalid="ignore", divide="ignore"): z = (t - m1) / sd1
                f = np.isfinite(z) & np.isfinite(zr)
                st["ex_z"][f] += np.abs(z[f]) >= np.abs(zr[f]); st["ex_t"][f] += np.abs(t[f]) >= np.abs(real[f]); st["c2"][f] += 1
                st["maxz"].append(np.nanmax(np.abs(z[np.isfinite(zr)]))); st["maxt"].append(np.nanmax(np.abs(t[np.isfinite(real)])))
                st["n2done"] = k
                if k % 25 == 0 or k == n2: save(); print(f"pass2 {k}/{n2} {time.time() - t0:.0f}s", flush=True)
    out = dict(code=code, real_t=real, m1=m1, sd1=sd1, n1=st["n1done"], z_real=zr,
               p_cell=(1 + st["ex_z"]) / (1 + st["c2"]), p_cell_raw=(1 + st["ex_t"]) / (1 + st["c2"]), n2=st["n2done"],
               maxz=np.array(st["maxz"]), maxt=np.array(st["maxt"]))
    pickle.dump(out, open(os.path.join(BASE, f"{mk}_perm.pkl"), "wb")); os.remove(part)
    print(f"done {mk}: null t mean {np.nanmean(m1):+.3f}, mean sd {np.nanmean(sd1):.2f}, family max |z| median {np.median(out['maxz']):.2f} ({time.time() - t0:.0f}s)")

if __name__ == "__main__":
    main()
