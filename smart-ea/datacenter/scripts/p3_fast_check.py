r"""Proof that the fast engine (p3fast.py) gives the SAME numbers as the slow per-pattern code:
 1 identity (no swap): t of all 549 patterns = p3_real.pkl (slow p3lib.all_patterns)
 2 day-swap seeds 1000-1039: t = the slow p3_perm.py results kept in p3_perm_slow_ref.pkl (same swap_ci, same seeds)
 3 heterogeneity Q (real rows) = the slow p3_audit.q_stats
 + speed per permutation. Usage: python p3_fast_check.py"""
import os, pickle, time
import numpy as np
import p3lib as L, adx_asof, p3_perm, p3fast
from p3_audit import q_stats, fam_of

HERE = os.path.dirname(adx_asof.DBT)

def swapped(T, X, seed):
    rng = np.random.default_rng(seed); ci = T["ci"].copy()
    for g in L.TFS:                                           # same order of rng use as the slow p3_perm.one()
        m = T["tf"] == g; ci[m] = p3_perm.swap_ci(T, X, g, rng)[m]
    return ci

def main():
    t0 = time.time(); bad = 0
    T, X = L.load(adx_asof.DBT); fam = fam_of(adx_asof.DBT)
    F = p3fast.Fast(T, X, fam); print(f"fast engine built {time.time() - t0:.0f}s", flush=True)
    real = pickle.load(open(os.path.join(HERE, "p3_real.pkl"), "rb"))["res"]
    tr = np.array([r["t"] for r in real]); tf = F.t_all()
    d = np.max(np.abs(tf - tr)); bad += d > 1e-9; print(f"1 identity: max |t fast - t slow| over 549 = {d:.2e} -> {'OK' if d <= 1e-9 else 'DIFF'}")
    ref = pickle.load(open(os.path.join(HERE, "p3_perm_slow_ref.pkl"), "rb"))["t_null"]
    t1 = time.time(); fa = np.vstack([F.t_all(swapped(T, X, 1000 + i)) for i in range(len(ref))]); dt = (time.time() - t1) / len(ref)
    d = np.max(np.abs(fa - ref)); bad += d > 1e-9
    print(f"2 seeds 1000-{999 + len(ref)}: max |t fast - t slow| over {ref.size} = {d:.2e} -> {'OK' if d <= 1e-9 else 'DIFF'}  ({dt:.2f}s per permutation incl. swap)")
    qs = q_stats(T, X, fam); qf = F.q_all()
    same = np.array_equal(np.isnan(qs), np.isnan(qf)); dq = np.nanmax(np.abs(qs - qf)); bad += (not same) or dq > 1e-6
    print(f"3 Q heterogeneity: same missing {same}, max |Q fast - Q slow| = {dq:.2e} -> {'OK' if same and dq <= 1e-6 else 'DIFF'}")
    print("ALL OK" if bad == 0 else f"{bad} DIFFERENCES", f"({time.time() - t0:.0f}s)")

if __name__ == "__main__":
    main()
