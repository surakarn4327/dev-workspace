r"""Build the pattern-outcome library of one TF for the real market and random-direction markets. One file per market (resumable:
existing files are skipped).   Usage: python po_build.py <tf> <market> [<market> ...]    e.g. python po_build.py 5 real sf1 sf2 sf3
Output: C:\trade datacenter\po\po_m<tf>_<market>.npz"""
import sys, os, time
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, po_lib as PO

if __name__ == "__main__":
    tf = int(sys.argv[1]); os.makedirs(PO.OUTD, exist_ok=True)
    for mkt in sys.argv[2:]:
        f = os.path.join(PO.OUTD, f"po_m{tf}_{mkt}.npz")
        if os.path.exists(f): print("skip", f); continue
        t0 = time.time(); M = PO.load_market(mkt)
        R, E = PO.build(M, tf)
        np.savez(f + ".tmp.npz", data_to=M["t"].max(), **R)
        os.replace(f + ".tmp.npz", f)
        print(f"{mkt}: {len(R['b'])} bars, data to {M['t'].max()}, {time.time() - t0:.0f}s", flush=True)
