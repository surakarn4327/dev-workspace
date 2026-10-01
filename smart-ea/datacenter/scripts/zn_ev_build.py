r"""Build the zone-entry event library (steps 3-4, zn_ev.py definitions) for every market x observation TF x variant.
Output zn\zn_ev_m<tf>_<market>.npz, keys v<variant index>_<field> (variants = zn_ev.VARIANTS). Resumable per (tf, market).
usage: zn_ev_build.py [market ...] [--tf 1,3,5]"""
import sys, os, time
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, po_lib as PO, zn_lib as ZL, zn_ev as EV
OUT = r"C:\trade datacenter\zn"

def build_one(M, Z, tf, f):
    t0 = time.time(); B = EV.obs_bars(M, tf); S, L = EV.instances(Z, M, B, tf); P = EV.path_q(M)
    sid = M["sid"]; send = np.r_[np.flatnonzero(np.diff(sid)), len(sid) - 1]; se = send[np.searchsorted(send, np.arange(len(sid)))]
    res = {"types": np.array(EV.TYPES), "data_to": M["t"][-1]}
    for vi, (var, D) in enumerate(EV.VARIANTS):
        R = EV.collect(M, B, S, L, tf, var, D); F = EV.features(M, B, R, tf); oc, tm, p0 = EV.outcomes(M, B, R, tf, P, se)
        for k, v in {**R, **F, "oc": oc, "tm": tm, "p0": p0}.items(): res[f"v{vi}_{k}"] = v
        print(f"  m{tf} {var} D{D}: {len(R['j'])} events {time.time() - t0:.0f}s", flush=True)
    np.savez(f + ".tmp.npz", **res); os.replace(f + ".tmp.npz", f)

if __name__ == "__main__":
    a = sys.argv[1:]; tfs = EV.OBS
    if "--tf" in a: i = a.index("--tf"); tfs = tuple(int(x) for x in a[i + 1].split(",")); a = a[:i] + a[i + 2:]
    for mkt in (a or ["real", "sf1", "sf2", "sf3"]):
        todo = [tf for tf in tfs if not os.path.exists(os.path.join(OUT, f"zn_ev_m{tf}_{mkt}.npz"))]
        if not todo: continue
        t0 = time.time(); M = PO.load_market(mkt); Z = ZL.Zones(M); print(mkt, "zones", f"{time.time() - t0:.0f}s", flush=True)
        for tf in todo: build_one(M, Z, tf, os.path.join(OUT, f"zn_ev_m{tf}_{mkt}.npz"))
