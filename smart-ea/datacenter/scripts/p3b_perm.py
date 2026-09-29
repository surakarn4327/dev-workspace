r"""Phase 3B-b nulls on the REAL market grid:
- E/C patterns: day swap of the market events (every TF bar) and of the context (every checkpoint time) â€” one day permutation within each
  half per draw, donor = nearest minute of the trading day; the trades keep their own path, state and outcomes. seeds 1000 + i.
- S patterns (state of the trade itself): day-level sign flip of the per-trade delta (exact, vectorised on day sums). seeds 5000 + i.
Output p3b\p3b_perm.pkl: t_null (n x (1014 primary + BE-far)) in the order of p3b_lib (primary patterns TF 1/3/5, then BE-far).
Checkpoint every 100 draws in p3b_perm_partial.pkl (a rerun resumes; a checkpoint written by other code is not resumed).
Usage: python p3b_perm.py [n=2000] [workers=4]   (needs p3b\real_res.pkl for the S values)"""
import os, sys, time, pickle, hashlib
import numpy as np
from multiprocessing import Pool
import broker as BK
import p3b_lib as B

BASE = os.path.join(os.path.dirname(BK.DB), "p3b")
MK = os.environ.get("P3B_MARKET", "real")                  # test runs only (a small grid); the null of record is the real market
_M = _E = None

def _init():
    global _M, _E
    _M = B.load_market(os.path.join(BASE, MK), slim=True); _E = B.Engine(_M, neighbours=False)

def one(seed):
    bd, cd = B.day_perm_donors(_M, seed)
    return _E.run(bd, cd, only_t=True, far_be=True, groups=("E", "C"))

def layout():
    """positions of S patterns in the output vector (primary and BE-far), in the order p3b_lib.Engine.run appends s_collect"""
    prim = []; far = []; pos = 0; fpos = 0; order = []
    for tf in B.TFS:
        for p in B.patterns(tf):
            isfar = p["alt"] == "be"
            if p["grp"] == "S":
                order.append(("p", pos))
                if isfar: order.append(("f", fpos))
            pos += 1
            if isfar: fpos += 1
    return order, pos, fpos

def sign_flip_t(s_vals, tday, nd, seeds):
    """t of every S pattern under day-level sign flips (same ratio estimator as p3lib.cstat, f_d = +-1)"""
    F = np.stack([np.random.default_rng(s).choice([-1.0, 1.0], nd) for s in seeds])        # draws x days
    out = []
    for ti, v in s_vals:
        ok = np.isfinite(v); di = tday[ti[ok]]; x = v[ok]
        Sd = np.bincount(di, x, nd); Cd = np.bincount(di, None, nd).astype(float); N = Cd.sum(); D = (Cd > 0).sum()
        if N == 0: out.append(np.full(len(seeds), np.nan)); continue
        mu = F @ Sd / N
        ss = (Sd ** 2).sum() - 2 * mu * (F @ (Sd * Cd)) + mu ** 2 * (Cd ** 2).sum()
        se = np.sqrt(np.maximum(ss, 0) * D / max(D - 1, 1)) / N
        out.append(np.where(se > 0, mu / se, 0.0))
    return np.stack(out, 1)

def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 2000; w = int(sys.argv[2]) if len(sys.argv) > 2 else 4; t0 = time.time()
    here = os.path.dirname(os.path.abspath(__file__))
    code = hashlib.sha1(b"".join(open(os.path.join(here, f), "rb").read() for f in ("p3b_lib.py", "p3b_perm.py", "p3lib.py"))).hexdigest()
    part = os.path.join(BASE, f"{MK}_perm_partial.pkl"); out = []
    if os.path.exists(part):
        z = pickle.load(open(part, "rb"))
        if z["code"] == code: out = list(z["t"])[:n]; print(f"resuming from {len(out)} saved draws", flush=True)
    done0 = len(out)
    if done0 < n:
        with Pool(w, initializer=_init) as P:
            for i, r in enumerate(P.imap(one, range(1000 + done0, 1000 + n)), start=done0):
                out.append(r)
                if (i + 1) % 100 == 0 or i + 1 == n:
                    pickle.dump(dict(t=np.vstack(out), code=code), open(part + ".tmp", "wb")); os.replace(part + ".tmp", part)
                    print(f"swap {i + 1}/{n} saved {time.time() - t0:.0f}s", flush=True)
    Tn = np.vstack(out)
    # S patterns: sign flip, placed at their positions
    R = pickle.load(open(os.path.join(BASE, f"{MK}_res.pkl"), "rb"))
    order, npr, nfar = layout(); assert Tn.shape[1] == npr + nfar and len(order) == len(R["s_vals"])
    SF = sign_flip_t(R["s_vals"], R["tday"], len(R["days"]), [5000 + i for i in range(n)])
    for j, (kind, p) in enumerate(order):
        col = p if kind == "p" else npr + p
        assert np.all(np.isnan(Tn[:, col])); Tn[:, col] = SF[:, j]
    assert not np.isnan(Tn[:, :npr]).all(0).any()
    pickle.dump(dict(t_null=Tn, n_primary=npr, code=code), open(os.path.join(BASE, f"{MK}_perm.pkl"), "wb"))
    if os.path.exists(part): os.remove(part)
    print(f"done {Tn.shape} ({time.time() - t0:.0f}s)")

if __name__ == "__main__":
    main()
