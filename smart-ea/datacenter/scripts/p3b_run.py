r"""Phase 3B-b: statistics of every pattern (p3b_lib) on one market grid.
Usage: python p3b_run.py real             -> p3b\real_res.pkl  (all statistics + neighbours + BE-far + per-trade values of the S patterns)
       python p3b_run.py sf<seed> [--clean] -> p3b\sf<seed>_res.pkl (primary statistics only; --clean deletes that market's grid files
                                               afterwards, they can be rebuilt with p3b_grid.py)"""
import os, sys, time, pickle, glob
import broker as BK
import p3b_lib as B

def main():
    name = sys.argv[1]; t0 = time.time(); base = os.path.join(os.path.dirname(BK.DB), "p3b"); D = os.path.join(base, name)
    M = B.load_market(D); real = name.startswith("real")
    E = B.Engine(M, neighbours=real); sc = [] if real else None
    res = E.run(far_be=True, s_collect=sc)
    out = dict(res=res, s_vals=sc, days=M["days"], tday=M["tday"], n_trades=len(M["T"]["uid"]))
    pickle.dump(out, open(os.path.join(base, f"{name}_res.pkl.tmp"), "wb")); os.replace(os.path.join(base, f"{name}_res.pkl.tmp"), os.path.join(base, f"{name}_res.pkl"))
    print(f"[{name}] {len(res)} patterns {time.time() - t0:.0f}s", flush=True)
    if "--clean" in sys.argv and not real:
        for f in glob.glob(os.path.join(D, "*.npz")): os.remove(f)
        os.rmdir(D); print(f"[{name}] grid files removed", flush=True)

if __name__ == "__main__":
    main()
