r"""Phase 3B-c: all statistics of every cell for the real market and for the random-direction markets (null 2).
Usage: python p3c_run.py real|sf1..sf5  -> p3c\<mk>_res.pkl  (layout, I, se, t, n, days, halves, BUY/SELL, neighbour definitions)
Synthetic markets use the REAL level structure (p3c_lib.Engine lev=...) so that every cell means the same state; their quintile edges are
cut from their own first half (as the permutations do)."""
import os, sys, time, pickle
import numpy as np
import p3lib as L, p3c_lib as C, adx_asof
from p3c_perm import dbt_of, BASE

def main():
    mk = sys.argv[1] if len(sys.argv) > 1 else "real"; t0 = time.time(); os.makedirs(BASE, exist_ok=True)
    Tr, Xr = L.load(adx_asof.DBT); assert Tr["day"].max() < L.SANDBOX_END // 86400; Er = C.Engine(Tr, Xr, C.load_params(adx_asof.DBT))
    if mk == "real":
        E = Er
    else:
        T, X = C.load_sandbox(dbt_of(mk)); P = C.load_params(dbt_of(mk))
        assert P == C.load_params(adx_asof.DBT), "synthetic market must have the same 432 parameter sets"
        assert T["entry_t"].max() < L.SANDBOX_END and T["day"].max() < L.SANDBOX_END // 86400
        E = C.Engine(T, X, P, lev=([f["name"] for f in Er.F], Er.lev))
    lay = E.layout(); assert lay == Er.layout()
    R = E.full(); R["layout"] = lay
    R["kneigh"] = [[E.F[i]["name"] for i in E.kneighbours(j)] for j in range(len(E.F))]
    R["n_trades"] = len(E.T["e"]); R["last_entry"] = int(E.T["entry_t"].max()); R["last_day"] = int(E.T["day"].max())
    pickle.dump(R, open(os.path.join(BASE, f"{mk}_res.pkl"), "wb"))
    print(f"{mk}: cells {len(lay)}, finite t {np.isfinite(R['t']).sum()}, trades {R['n_trades']} ({time.time() - t0:.0f}s)")

if __name__ == "__main__":
    main()
