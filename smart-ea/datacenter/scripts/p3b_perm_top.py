r"""Phase 3B-b: top up the day-swap null to the registered 2,000 draws ONLY for the patterns that pass gates G1-G5 (G6 decides only there).
The first 500 draws (seeds 1000-1499) of every pattern are in p3b\real_perm.pkl; this adds seeds 1500-2999 for the candidates (primary and
their BE-far column), i.e. exactly the draws a full 2,000-draw run would have produced (same seeds, same engine: checked bit-identical on
the stored seeds before running). S patterns: sign flip redone with 2,000 draws for every S pattern (cheap).
Family-wise p stays on the 500 draws of all patterns. Output p3b\real_perm_top.pkl. Checkpoint every 250 draws (resumable).
Usage: python p3b_perm_top.py [workers=4]   (needs p3b_rows.pkl from p3b_report.py run on the 500 draws)"""
import os, sys, time, pickle
import numpy as np
from multiprocessing import Pool
import broker as BK
import p3b_lib as B, p3b_perm as PP

BASE = os.path.join(os.path.dirname(BK.DB), "p3b")
_M = _E = _S = None

def candidates():
    rows = pickle.load(open(os.path.join(BASE, "p3b_rows.pkl"), "rb"))
    return sorted(i for i, r in enumerate(rows) if all(r[g] for g in ("G1", "G2", "G3", "G4", "G5")) and r["grp"] != "S")

def _init(sub):
    global _M, _E, _S
    _M = B.load_market(os.path.join(BASE, "real"), slim=True); _E = B.Engine(_M, neighbours=False); _S = set(sub)

def one(seed):
    bd, cd = B.day_perm_donors(_M, seed)
    return _E.run(bd, cd, only_t=True, far_be=True, groups=("E", "C"), subset=_S)

def main():
    w = int(sys.argv[1]) if len(sys.argv) > 1 else 4; t0 = time.time()
    sub = candidates(); P = pickle.load(open(os.path.join(BASE, "real_perm.pkl"), "rb")); npr = P["n_primary"]
    res = pickle.load(open(os.path.join(BASE, "real_res.pkl"), "rb"))["res"]
    be_idx = [i for i, r in enumerate(res) if r["alt"] == "be"]; far_col = {i: npr + j for j, i in enumerate(be_idx)}
    cols = sub + [far_col[i] for i in sub if i in far_col]
    print(f"candidates (G1-G5, E/C): {len(sub)} -> columns {len(cols)}", flush=True)
    part = os.path.join(BASE, "real_perm_top_partial.pkl"); out = []
    if os.path.exists(part):
        z = pickle.load(open(part, "rb"))
        if z["cols"] == cols: out = list(z["t"]); print(f"resuming from {len(out)}", flush=True)
    seeds = list(range(1500, 3000))
    if len(out) < len(seeds):
        with Pool(w, initializer=_init, initargs=(sub,)) as Pl:
            for k, r in enumerate(Pl.imap(one, seeds[len(out):]), start=len(out)):
                out.append(r[cols])
                if (k + 1) % 250 == 0 or k + 1 == len(seeds):
                    pickle.dump(dict(t=np.vstack(out), cols=cols), open(part + ".tmp", "wb")); os.replace(part + ".tmp", part)
                    print(f"top-up {k + 1}/{len(seeds)} {time.time() - t0:.0f}s", flush=True)
    Tt = np.vstack(out)
    R = pickle.load(open(os.path.join(BASE, "real_res.pkl"), "rb"))
    order, npr2, nfar = PP.layout()
    SF = PP.sign_flip_t(R["s_vals"], R["tday"], len(R["days"]), [5000 + i for i in range(2000)])
    s_cols = [p if kind == "p" else npr + p for kind, p in order]
    pickle.dump(dict(cols=cols, t_top=Tt, seeds=seeds, s_cols=s_cols, t_s2000=SF), open(os.path.join(BASE, "real_perm_top.pkl"), "wb"))
    if os.path.exists(part): os.remove(part)
    print(f"done {Tt.shape} + sign flip {SF.shape} ({time.time() - t0:.0f}s)")

if __name__ == "__main__":
    main()
