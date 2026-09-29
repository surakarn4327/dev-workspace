r"""Phase 3: statistics of every pattern (p3lib.specs) for the real library or a synthetic null library.
Usage: python p3_screen.py [adx_trades.sqlite path] [out.pkl]   (default = the real library -> p3_real.pkl)"""
import os, sys, time, pickle
import numpy as np
import p3lib as L, adx_asof

def main():
    dbt = sys.argv[1] if len(sys.argv) > 1 else adx_asof.DBT
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(adx_asof.DBT), "p3_real.pkl")
    t0 = time.time()
    T, X = L.load(dbt)
    print(f"sandbox trades {len(T['r'])}, distinct entries {len(np.unique(T['entry_t']))}, days {len(np.unique(T['day']))}, "
          f"last entry {time.strftime('%Y-%m-%d', time.gmtime(int(T['entry_t'].max())))}  ({time.time() - t0:.0f}s)", flush=True)
    res = L.all_patterns(T, X)
    pickle.dump(dict(res=res, n_trades=len(T["r"]), db=dbt), open(out, "wb"))
    print(f"patterns {len(res)} -> {out} ({time.time() - t0:.0f}s)")

if __name__ == "__main__":
    main()
