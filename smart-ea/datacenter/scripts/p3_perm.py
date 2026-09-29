r"""Phase 3 null 1: "day swap" of the market context. Every trade keeps its own outcome and direction, but its ctx row is replaced by the
ctx of an entry of the SAME TF on another (randomly permuted) day of the SAME half, at the nearest minute-of-day. This keeps the
time-of-day rhythm, the day-level clustering of context and the per-half distributions, and breaks only the link context <-> outcome.
For every pattern (primary definition) it stores the day-clustered t of each permutation -> calibration of the t statistic and a
permutation p-value per pattern.
Usage: python p3_perm.py [n_perm=2000] [workers=6]  -> p3_perm.pkl  (fast engine p3fast.py, ~1 s per permutation per worker;
checkpoint every 200 in p3_perm_partial.pkl, a rerun resumes)"""
import os, sys, time, pickle
import numpy as np
from multiprocessing import Pool
import p3lib as L, adx_asof

_T = _X = _F = None
def _init():
    global _T, _X, _F
    import p3fast
    _T, _X = L.load(adx_asof.DBT); _F = p3fast.Fast(_T, _X)

def swap_ci(T, X, g, rng):
    m = T["tf"] == g
    ue = np.unique(T["entry_t"][m]); row = np.searchsorted(X["entry_t"].astype(np.int64), ue)
    day = X["day"][row].astype(np.int64); mo = X["t_min_open"][row].astype(np.int64); half = (day >= L.HALF_DAY).astype(int)
    key = day * 10000 + mo; o = np.argsort(key); key, row, day, mo, half = key[o], row[o], day[o], mo[o], half[o]
    newrow = np.empty(len(key), np.int64)
    for h in (0, 1):
        ds = np.unique(day[half == h]); pm = dict(zip(ds, rng.permutation(ds)))
        sel = half == h; tgt = np.array([pm[x] for x in day[sel]]) * 10000 + mo[sel]
        p = np.searchsorted(key, tgt); p0 = np.clip(p - 1, 0, len(key) - 1); p1 = np.clip(p, 0, len(key) - 1)
        td = tgt // 10000
        ok0 = day[p0] == td; ok1 = day[p1] == td
        d0 = np.where(ok0, np.abs(key[p0] - tgt), 1 << 40); d1 = np.where(ok1, np.abs(key[p1] - tgt), 1 << 40)
        assert np.all(ok0 | ok1)
        newrow[np.flatnonzero(sel)] = np.where(d1 < d0, row[p1], row[p0])
    # map every trade of group g: its entry -> index in sorted list -> new ctx row
    ent_sorted = X["entry_t"][row].astype(np.int64)
    idx = np.searchsorted(ent_sorted, T["entry_t"][m])
    # ent_sorted is sorted by (day, minute) which is chronological -> searchsorted valid
    out = T["ci"].copy(); out[np.flatnonzero(m)] = newrow[idx]
    return out

def swapped_ci(T, X, seed):
    """ctx row per trade after one day swap (rng used TF 1, 3, 5 in this order, as in the first slow version)"""
    rng = np.random.default_rng(seed); ci = T["ci"].copy()
    for g in L.TFS:
        m = T["tf"] == g; ci[m] = swap_ci(T, X, g, rng)[m]
    return ci

def one(seed):
    # fast engine (p3fast.py): identical numbers to the first per-pattern version, proved by p3_fast_check.py
    return _F.t_all(swapped_ci(_T, _X, seed))

def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 2000; w = int(sys.argv[2]) if len(sys.argv) > 2 else 6
    t0 = time.time()
    real = pickle.load(open(os.path.join(os.path.dirname(adx_asof.DBT), "p3_real.pkl"), "rb"))["res"]
    import hashlib
    code = hashlib.sha1(b"".join(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), f), "rb").read()
                                 for f in ("p3lib.py", "p3_perm.py", "p3fast.py"))).hexdigest()
    keys = [(r["tf"], r["feat"], r["level"]) for r in real] + [("code", code, "")]   # a checkpoint from other code is never resumed
    # checkpoint every 20 permutations: a stopped run resumes where it stopped (bugs.md 2026-09-29). Seeds are 1000 + i, so a resumed run
    # gives exactly the same permutations as one uninterrupted run.
    part = os.path.join(os.path.dirname(adx_asof.DBT), "p3_perm_partial.pkl"); out = []
    if os.path.exists(part):
        z = pickle.load(open(part, "rb"))
        if z["keys"] == keys: out = list(z["t_null"])[:n]; print(f"resuming from {len(out)} saved permutations", flush=True)
    done0 = len(out)
    with Pool(w, initializer=_init) as P:
        for i, r in enumerate(P.imap(one, range(1000 + done0, 1000 + n)), start=done0):
            out.append(r)
            if (i + 1) % 200 == 0 or i + 1 == n:
                pickle.dump(dict(t_null=np.vstack(out), keys=keys), open(part + ".tmp", "wb")); os.replace(part + ".tmp", part)
                print(f"perm {i + 1}/{n} saved {time.time() - t0:.0f}s", flush=True)
    Tn = np.vstack(out)
    assert Tn.shape[1] == len(real), (Tn.shape, len(real))
    pickle.dump(dict(t_null=Tn, keys=keys[:-1], code=code), open(os.path.join(os.path.dirname(adx_asof.DBT), "p3_perm.pkl"), "wb"))
    if os.path.exists(part): os.remove(part)
    print(f"done {Tn.shape} sd of null t {Tn.std():.2f}, share |t|>=3 {np.mean(np.abs(Tn) >= 3):.4f} ({time.time() - t0:.0f}s)")

if __name__ == "__main__":
    main()
