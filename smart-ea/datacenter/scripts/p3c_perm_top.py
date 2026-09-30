r"""Phase 3B-c: top-up of the null for the candidate cells (pass G1-G5) from 500 to 2,000 pass-2 draws (seeds 5500-6999 continue the
seeds 5000-5499 of p3c_perm pass 2, so the result equals one uninterrupted 2,000-draw run for these cells). Same calibration (pass-1
mean / sd). Only the features of the candidates are computed (engine restricted to those features; level structure checked equal).
Usage: python p3c_perm_top.py [n_total=2000] [workers=6] -> p3c\real_perm_top.pkl"""
import os, sys, time, pickle
import numpy as np
from multiprocessing import Pool
import p3lib as L, p3c_lib as C, p3_perm, adx_asof
from p3c_perm import BASE

_T = _X = _E = None; _FE = None
def _init(feats):
    global _T, _X, _E
    _T, _X = L.load(adx_asof.DBT); _E = C.Engine(_T, _X, C.load_params(adx_asof.DBT), feats=feats)

def one(seed):
    return _E.t_all(p3_perm.swapped_ci(_T, _X, seed), C.shift_ci(_T, _X, 100000 + seed))

def main():
    ntot = int(sys.argv[1]) if len(sys.argv) > 1 else 2000; w = int(sys.argv[2]) if len(sys.argv) > 2 else 6; t0 = time.time()
    Pm = pickle.load(open(os.path.join(BASE, "real_perm.pkl"), "rb")); Gt = pickle.load(open(os.path.join(BASE, "p3c_gates.pkl"), "rb"))
    R = pickle.load(open(os.path.join(BASE, "real_res.pkl"), "rb")); lay = R["layout"]
    cand = np.flatnonzero(Gt["G1"] & Gt["G2"] & Gt["G3"] & Gt["G4"] & Gt["G5"] & np.isfinite(R["t"]))
    feats = sorted(set(lay[i][0] for i in cand)); print(f"candidates {len(cand)} in {len(feats)} features", flush=True)
    if not len(cand):
        pickle.dump(dict(n=Pm["n2"], p_cell={}), open(os.path.join(BASE, "real_perm_top.pkl"), "wb")); return
    _init(feats); sub = _E.layout(); spos = {k: i for i, k in enumerate(sub)}
    real_sub = _E.t_all(); idx = np.array([spos[lay[i]] for i in cand])
    assert np.allclose(real_sub[idx], R["t"][cand], atol=1e-9), "restricted engine differs from the full engine"
    m1, sd1, zr = Pm["m1"][cand], Pm["sd1"][cand], Pm["z_real"][cand]
    # exceed counts of the first draws, recovered from p = (1 + ex) / (1 + c2); valid when the cell was finite in every draw (c2 = n2) ->
    # then p * (1 + n2) is an integer, checked
    raw = Pm["p_cell"][cand] * (1 + Pm["n2"]); assert np.allclose(raw, raw.round(), atol=1e-6), "candidate cell not finite in every draw"
    ex = raw.round() - 1; c2 = np.full(len(cand), float(Pm["n2"]))
    with Pool(w, initializer=_init, initargs=(feats,)) as P:
        for k, t in enumerate(P.imap(one, range(5000 + Pm["n2"], 5000 + ntot)), start=Pm["n2"] + 1):
            z = (t[idx] - m1) / sd1; f = np.isfinite(z); ex[f] += np.abs(z[f]) >= np.abs(zr[f]); c2[f] += 1
            if k % 250 == 0: print(f"top-up {k}/{ntot} {time.time() - t0:.0f}s", flush=True)
    pc = (1 + ex) / (1 + c2)
    pickle.dump(dict(n=ntot, p_cell={int(i): float(p) for i, p in zip(cand, pc)}, cand=cand), open(os.path.join(BASE, "real_perm_top.pkl"), "wb"))
    print(f"done: {len(cand)} cells, p <= 0.01: {np.sum(pc <= 0.01)} ({time.time() - t0:.0f}s)")

if __name__ == "__main__":
    main()
