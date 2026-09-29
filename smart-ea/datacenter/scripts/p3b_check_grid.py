r"""Phase 3B-b check of the full grid (p3b_grid.py) against the verified 3B-a library adx_hold.sqlite:
(A) the grid rows that 3B-a stores (a base event or a checkpoint) must be exactly the rows of table dec (same uid, dec_t, bar_n, flags,
    directions, state columns, r_plan (= utrades.r_std), r_cut, r_be, r_hold, min_to_cut) — and no other row of dec may be missing
(B) ctx.npz = ctx_dec at the same times for every column used
(C) trades.npz = utrades (uid, tf, entry/exit, dir, day, r_std) and the exit family = params of every mapped set
Usage: python p3b_check_grid.py real|real_test"""
import os, sys, sqlite3, time
import numpy as np
import broker as BK

def main():
    name = sys.argv[1]; t0 = time.time(); D = os.path.join(os.path.dirname(BK.DB), "p3b", name)
    HOLD = os.path.join(os.path.dirname(BK.DB), "adx_hold.sqlite"); h = sqlite3.connect(HOLD)
    T = dict(np.load(os.path.join(D, "trades.npz"))); bad = []
    # (C) trades
    U = np.array(h.execute("SELECT uid, tf, entry_t, exit_t, day, dir, r_std, exit_mode FROM utrades ORDER BY uid").fetchall(), dtype=object)
    pos = np.searchsorted(U[:, 0].astype(np.int64), T["uid"])
    for j, k in ((1, "tf"), (2, "entry_t"), (3, "exit_t"), (4, "day"), (5, "dir")):
        if not np.array_equal(U[pos, j].astype(np.int64), T[k]): bad.append(f"trades.{k}")
    if np.max(np.abs(U[pos, 6].astype(float) - T["r_std"])) > 1e-12: bad.append("trades.r_std")
    if not np.array_equal((U[pos, 7] == "T3").astype(np.int64), T["exit_t3"]): bad.append("trades.exit_t3")
    tdb = sqlite3.connect(os.path.join(os.path.dirname(BK.DB), "adx_trades.sqlite"))
    P = {r[0]: (r[1], r[2]) for r in tdb.execute("SELECT set_id, sl_atr, exit_mode FROM params")}
    fam_of = {}
    for s, u in h.execute("SELECT set_id, uid FROM set_map"):
        sl, ex = P[s]; f = {4.0: 0, 8.0: 2, 12.0: 4}[sl] + (0 if ex == "L" else 1)
        if fam_of.setdefault(u, f) != f: bad.append(f"uid {u} mapped to two exit families")
    if not all(fam_of[u] == f for u, f in zip(T["uid"].tolist(), T["fam"].tolist())): bad.append("trades.fam")
    print(f"(C) trades {len(T['uid'])} checked {time.time() - t0:.0f}s", flush=True)
    # (A) grid vs dec
    uids = set(T["uid"].tolist()); rstd = dict(zip(T["uid"].tolist(), T["r_std"].tolist()))
    cur = h.execute("SELECT uid, dec_t, bar_n, flags, ev_big_dir, ev_pin_dir, ev_piv_dir, ev_reg_new, ev_box_dir, min_to_cut, n_tp_hit, "
                    "open_r, mfe_r, dist_tp_r, r_plan, r_cut, r_be, r_hold FROM dec")
    parts = []
    while True:
        rows = cur.fetchmany(1_000_000)
        if not rows: break
        a = np.array(rows, dtype=float)
        if len(uids) < 215017: a = a[np.isin(a[:, 0].astype(np.int64), list(uids))]
        parts.append(a)
    Dc = np.concatenate(parts); o = np.lexsort((Dc[:, 1], Dc[:, 0])); Dc = Dc[o]
    print(f"dec rows {len(Dc)} loaded {time.time() - t0:.0f}s", flush=True)
    G = []
    for tf in (1, 3, 5):
        g = np.load(os.path.join(D, f"grid_{tf}.npz")); ev = np.load(os.path.join(D, f"ev_{tf}.npz")); b = g["b"]
        fl = ev["fl_base"][b] | np.where(g["bar_n"] % 5 == 0, 1 << 13, 0)
        st = fl != 0
        cols = [g["uid"], ev["dec_t"][b], g["bar_n"], fl, ev["big_base"][b], ev["pin_base"][b], ev["piv_base"][b], ev["reg_base"][b],
                ev["box_base"][b], g["mtc"], g["ntp"], g["open_r"], g["mfe_r"], g["dist_tp"],
                np.array([rstd[u] for u in g["uid"].tolist()]), g["r_cut"], g["r_be"], g["r_hold"]]
        G.append(np.stack([np.asarray(c, dtype=float)[st] for c in cols], 1))
        print(f"M{tf}: grid rows {len(b)}, stored subset {st.sum()}", flush=True)
    Gm = np.concatenate(G); o = np.lexsort((Gm[:, 1], Gm[:, 0])); Gm = Gm[o]
    if Gm.shape != Dc.shape: bad.append(f"(A) row count grid-stored {len(Gm)} vs dec {len(Dc)}")
    else:
        names = ["uid", "dec_t", "bar_n", "flags", "big", "pin", "piv", "reg", "box", "min_to_cut", "n_tp_hit", "open_r", "mfe_r", "dist_tp",
                 "r_plan", "r_cut", "r_be", "r_hold"]
        for j, nm in enumerate(names):
            a, c = Gm[:, j], Dc[:, j]; nan = np.isnan(a) | np.isnan(c)
            if not np.array_equal(np.isnan(a), np.isnan(c)): bad.append(f"(A) {nm} NULL pattern differs"); continue
            dmax = np.max(np.abs(a[~nan] - c[~nan])) if (~nan).any() else 0.0
            if dmax > (1e-12 if j >= 11 else 0): bad.append(f"(A) {nm} max diff {dmax}")
            print(f"  {nm:10s} max |diff| {dmax:.2e}  NULL rows {nan.sum()}")
    # (B) ctx
    C = np.load(os.path.join(D, "ctx.npz")); need = [k for k in C.files if k != "t"]
    Q = np.array(h.execute(f"SELECT dec_t, {','.join(need)} FROM ctx_dec").fetchall(), dtype=float)
    Q = Q[np.argsort(Q[:, 0])]; p = np.searchsorted(Q[:, 0], C["t"])
    if not np.array_equal(Q[np.minimum(p, len(Q) - 1), 0], C["t"].astype(float)): bad.append("(B) checkpoint time missing in ctx_dec")
    else:
        for j, k in enumerate(need):
            a, c = C[k], Q[p, j + 1]
            if not (np.array_equal(np.isnan(a), np.isnan(c)) and np.allclose(a[~np.isnan(a)], c[~np.isnan(c)], rtol=0, atol=1e-9)):
                bad.append(f"(B) ctx {k}")
        print(f"(B) ctx {len(C['t'])} times x {len(need)} columns compared")
    print(f"{'ALL OK' if not bad else 'BAD: ' + '; '.join(bad)}  ({time.time() - t0:.0f}s)")

if __name__ == "__main__":
    main()
