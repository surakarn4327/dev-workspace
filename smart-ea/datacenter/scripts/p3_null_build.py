r"""Phase 3 null 2: a synthetic "random direction" gold market -> run the SAME AdxEmaVol simulator (432 sets) and the SAME ctx builder on it.
Market = real M1 bars with every bar mirrored with probability 1/2 (cat_struct.signflip_m1: gap, body and wicks flip; volatility clustering,
news spikes, session rhythm, tick volume and spread stay exactly where they were). If a pattern wins/loses as much in this market as in
the real one, it is a property of the definitions / of the strategy geometry, not a directional habit of gold.
Only the sandbox is built (bars before 2026-06-01): the exam period is never touched, not even in synthetic form.
Usage: python p3_null_build.py <seed>   -> <data dir>\p3_null\sf<seed>\ {bars.npz, gold_dc.sqlite (bars_m1 only), adx_trades.sqlite (+ctx)}"""
import os, sys, time, sqlite3
import numpy as np
import broker as BK
import p3lib as L
from dc_sessions import sessions
from cat_struct import signflip_m1

def main():
    seed = int(sys.argv[1]); t0 = time.time()
    out = os.path.join(os.path.dirname(BK.DB), "p3_null", f"sf{seed}"); os.makedirs(out, exist_ok=True)
    z = np.load(BK.BARS); t = z["t"].astype(np.int64)
    lo = BK.utc_ts("2024-02-01") - 3 * 86400
    keep = (BK.server_to_utc(t) >= lo) & (BK.server_to_utc(t) < L.SANDBOX_END)
    t = t[keep]; o, h, l, c, tv, sp = (z[k][keep] for k in ("o", "h", "l", "c", "tv", "sp"))
    sid, _, _ = sessions(BK.server_to_utc(t))
    O, H, Lo, C, TV = signflip_m1(o, h, l, c, tv, sid, seed)
    # the flipped path is a random walk of the real DOLLAR moves (so ATR, spread / ATR and cost / ATR stay exactly real) and can wander
    # far from the real level (even below 0). Shift the whole path by a constant: same mean level as real, never below $500.
    # Only %-of-price features (a_adr_pct, a_mv60_pct) see a different price level; they are cut into percentile bands anyway.
    off = max(np.mean(c) - np.mean(C), 500.0 - Lo.min()); O, H, Lo, C = O + off, H + off, Lo + off, C + off
    rnd = lambda x: np.round(x / BK.POINT) * BK.POINT
    O, H, Lo, C = rnd(O), rnd(H), rnd(Lo), rnd(C)
    assert np.all(H >= np.maximum(O, C) - 1e-9) and np.all(Lo <= np.minimum(O, C) + 1e-9) and Lo.min() > 0
    bars = os.path.join(out, "bars.npz"); np.savez(bars, t=t, o=O, h=H, l=Lo, c=C, tv=TV, sp=sp)
    dbp = os.path.join(out, "gold_dc.sqlite")
    if os.path.exists(dbp): os.remove(dbp)
    db = sqlite3.connect(dbp)
    db.execute("CREATE TABLE bars_m1(t INTEGER PRIMARY KEY, o REAL, h REAL, l REAL, c REAL, tick_vol INTEGER, spread REAL)")
    tu = BK.server_to_utc(t); m = tu >= BK.T0
    db.executemany("INSERT INTO bars_m1 VALUES (?,?,?,?,?,?,?)", zip(tu[m].tolist(), O[m].tolist(), H[m].tolist(), Lo[m].tolist(), C[m].tolist(),
                                                                   TV[m].astype(np.int64).tolist(), (sp[m] * BK.POINT).tolist()))
    db.commit(); db.close()
    print(f"synthetic bars {len(t)} (price {C.min():.0f}-{C.max():.0f}) {time.time() - t0:.0f}s", flush=True)
    # point the whole pipeline at the synthetic files (same process, modules read BK.BARS / BK.DB when called; DBT/OUT at import)
    BK.BARS, BK.DB = bars, dbp
    os.environ["ADX_OUT"] = os.path.join(out, "adx_trades.sqlite"); os.environ["ADX_LIB_TO"] = "2026-06-01"
    import adx_build, adx_ctx
    assert adx_build.OUT == os.environ["ADX_OUT"] and adx_ctx.DBT == os.environ["ADX_OUT"]
    adx_build.main(); adx_ctx.build()
    print(f"done {out} {time.time() - t0:.0f}s")

if __name__ == "__main__":
    main()
