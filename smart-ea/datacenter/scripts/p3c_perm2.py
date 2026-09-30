r"""Phase 3B-c: pass 2 of the null again, with the family-wise maximum taken over the G1-ELIGIBLE cells only (real days >= 100).
Why (2026-09-30): the first pass-2 maxima reached |z| 80 / 30 / 17 in 3 of 100 draws, always in cells of 30-45 days (just above the
minimum size): those cells are empty (nan) in most null draws, so their null sd came from a few draws and was tiny (0.009). They can
never pass G1 (>= 100 days), so they must not set the bar for the whole search.
Same seeds as p3c_perm pass 2 (5000 + i) and the same pass-1 calibration (real_perm.pkl m1 / sd1) -> the per-cell p must come out
identical to the stored ones (checked). Usage: python p3c_perm2.py [n2=100] [workers=7] -> updates p3c\real_perm.pkl
(maxz = eligible family, maxz_all = the old all-cell maxima)."""
import os, sys, time, pickle
import numpy as np
from multiprocessing import Pool
import p3c_perm as PP
from p3c_perm import BASE

def main():
    n2 = int(sys.argv[1]) if len(sys.argv) > 1 else 100; w = int(sys.argv[2]) if len(sys.argv) > 2 else 7; t0 = time.time()
    Pm = pickle.load(open(os.path.join(BASE, "real_perm.pkl"), "rb")); R = pickle.load(open(os.path.join(BASE, "real_res.pkl"), "rb"))
    m1, sd1, zr, real = Pm["m1"], Pm["sd1"], Pm["z_real"], Pm["real_t"]
    el = np.isfinite(zr) & (R["days"] >= 100)
    print(f"eligible cells {el.sum()} of {np.isfinite(zr).sum()} finite", flush=True)
    ex = np.zeros(len(zr)); c2 = np.zeros(len(zr)); maxz = []; maxz_all = []
    with Pool(w, initializer=PP._init, initargs=("real",)) as P:
        for k, (seed, t) in enumerate(P.imap(PP.one, range(5000, 5000 + n2)), start=1):
            with np.errstate(invalid="ignore", divide="ignore"): z = (t - m1) / sd1
            f = np.isfinite(z) & np.isfinite(zr); ex[f] += np.abs(z[f]) >= np.abs(zr[f]); c2[f] += 1
            maxz.append(np.nanmax(np.abs(z[el & np.isfinite(z)]))); maxz_all.append(np.nanmax(np.abs(z[np.isfinite(zr)])))
            if k % 25 == 0: print(f"pass2 {k}/{n2} {time.time() - t0:.0f}s", flush=True)
    pc = (1 + ex) / (1 + c2)
    same = np.allclose(np.nan_to_num(pc, nan=-1), np.nan_to_num(Pm["p_cell"], nan=-1)) and np.allclose(maxz_all, Pm["maxz"])
    print(f"per-cell p identical to the first run: {same}; old all-cell max identical: {np.allclose(maxz_all, Pm['maxz'])}", flush=True)
    assert same, "rerun differs from the first pass 2"
    Pm["maxz_all"] = Pm["maxz"]; Pm["maxz"] = np.array(maxz); Pm["family"] = "G1-eligible cells (real days >= 100)"; Pm["eligible"] = el
    pickle.dump(Pm, open(os.path.join(BASE, "real_perm.pkl"), "wb"))
    print(f"done: eligible family max |z| median {np.median(maxz):.2f}, 95% {np.percentile(maxz, 95):.2f}, max {np.max(maxz):.2f} ({time.time() - t0:.0f}s)")

if __name__ == "__main__":
    main()
