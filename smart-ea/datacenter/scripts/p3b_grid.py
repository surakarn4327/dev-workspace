r"""Phase 3B-b step 1: the FULL decision grid of one market = every bar of the trade's own TF that closes while the trade is open (not only
the bars with an event / checkpoint that adx_hold.sqlite stores), with the state and the outcome of the alternatives, + the event bits of
every TF bar (base definitions and the neighbour definitions of phase 3B-b) + market context at the checkpoint times.
Why a full grid: neighbour event definitions (e.g. big bar 1.5 ATR) and the day-swap null put events on bars that adx_hold.sqlite does
not store. Same simulator (hold_lib.trade_rows) and same event code (hold_lib.tf_events) as 3B-a; the real grid is checked row by row
against adx_hold.sqlite (p3b_audit.py) and the unique trades are the same (hold_build.load_trades, same uid numbering).
Sandbox only (bars before 2026-06-01, trades of trading days < 2026-06-01).

Usage: python p3b_grid.py real          -> <data dir>\p3b\real\
       python p3b_grid.py sf<seed>      -> <data dir>\p3b\sf<seed>\  (random-direction market of p3_null_build.py, same pipeline)
Files: trades.npz (per unique trade), grid_<tf>.npz (rows sorted by uid, bar_n), ev_<tf>.npz (every TF bar: time, day, flags of every
definition variant + directions), ctx.npz (context columns at every checkpoint time). Env P3B_MONTHS='YYYY-MM,...' = small test build."""
import os, sys, time, datetime
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
VARIANTS = {"base": {}, "big15": dict(big_k=1.5), "big25": dict(big_k=2.5), "pin50": dict(pin_w=0.5), "pin70": dict(pin_w=0.7),
            "vsp25": dict(vsp_k=2.5), "vsp40": dict(vsp_k=4.0), "zz2": dict(zz_k=2), "zz4": dict(zz_k=4), "box15": dict(box_n=15),
            "box30": dict(box_n=30), "st30": dict(stand_min=30), "st120": dict(stand_min=120)}
CHECK_N = 5
CTX_CHUNK = 60000

def ctx_columns():
    """context columns used by the phase-3B-b ctx patterns (p3lib.specs subset + neighbours)"""
    c = ["t_et_hour", "a_mv60_pct", "d_day_pos"]
    for o in ("m1", "m3", "m5"):
        c += [f"a_{o}_cost_atr"]
        for k in (2, 3, 4): c += [f"{o}k{k}_{x}" for x in ("reg", "dh_atr", "dl_atr", "leg_dir", "retr_atr")]
    for o in ("m15", "h1"):
        for k in (2, 3, 4): c += [f"{o}k{k}_{x}" for x in ("reg", "dh_atr", "dl_atr")]
    return c

def main():
    name = sys.argv[1]; t0 = time.time()
    import broker as BK
    out = os.path.join(os.path.dirname(BK.DB), "p3b", name)
    if name.startswith("sf"):
        src = os.path.join(os.path.dirname(BK.DB), "p3_null", name)
        BK.BARS, BK.DB = os.path.join(src, "bars.npz"), os.path.join(src, "gold_dc.sqlite")      # before importing adx_ctx / hold_lib
    else: assert name == "real"
    import adx_ctx as X, hold_lib as H, hold_build as HB
    assert os.path.dirname(X.DBT) == os.path.dirname(BK.DB)
    ONLY = [m for m in os.environ.get("P3B_MONTHS", "").split(",") if m]
    if ONLY: out += "_test"
    os.makedirs(out, exist_ok=True)
    ut, smap, cost, cut_h = HB.load_trades()
    import sqlite3
    db = sqlite3.connect(X.DBT); P = {r[0]: r[1] for r in db.execute("SELECT set_id, sl_atr FROM params")}; db.close()
    sl_of = {}
    for s, n, u in smap: sl_of.setdefault(u, P[s])
    U = np.array([[u[0], u[1], 0 if u[2] == "L" else 1, u[3], u[4], u[5], u[6]] for u in ut], dtype=np.int64)
    fam = np.array([{4.0: 0, 8.0: 2, 12.0: 4}[sl_of[u[0]]] + (0 if u[2] == "L" else 1) for u in ut], dtype=np.int64)   # 0..5 = SL4L SL4T3 SL8L ...
    risk = np.array([u[12] for u in ut]); rstd = np.array([u[15] for u in ut])
    print(f"[{name}] unique trades {len(ut)} {time.time() - t0:.0f}s", flush=True)
    M = H.load_ctx_bars(); SLv = H.sessions_levels(M)
    EVT = {}
    for tf in H.TFS:
        EV = {}
        for vn, kw in VARIANTS.items():
            E = H.tf_events(M, tf, SLv, **kw)
            EV[f"fl_{vn}"] = E["flags"]
            for k, v in E["dirs"].items(): EV[f"{k}_{vn}"] = v.astype(np.int8)
            if vn == "base": B = E["B"]; EV["dec_t"] = E["dec_t"]; EV["t_open"] = B["t_open"]; EV["day"] = B["day"]
        EVT[tf] = EV
        np.savez(os.path.join(out, f"ev_{tf}.npz"), **EV)
    print(f"[{name}] events {time.time() - t0:.0f}s", flush=True)
    mk = H.walk_market(); tu = mk.tu
    month = lambda day: (datetime.date(1970, 1, 1) + datetime.timedelta(days=int(day))).strftime("%Y-%m")
    keep_t = [i for i, u in enumerate(ut) if not ONLY or month(u[5]) in ONLY]
    cols = {tf: {k: [] for k in ("uid", "b", "bar_n", "ntp", "open_r", "mfe_r", "dist_tp", "mtc", "r_cut", "r_be", "r_hold")} for tf in H.TFS}
    bad = 0
    for cnt, i in enumerate(keep_t):
        u = ut[i]; uid, tf, ex, et, xt, day, d = u[:7]
        G = EVT[tf]; tO = G["t_open"]
        b0 = int(np.searchsorted(tO, et)); assert tO[b0] == et
        b1 = int(np.searchsorted(tO, xt, "right"))
        bb = np.arange(b0, b1); dt = G["dec_t"][bb]; kp = dt > 0; bb, dt = bb[kp], dt[kp]
        di = np.searchsorted(tu, dt); e = int(np.searchsorted(tu, et)); assert tu[e] == et
        assert np.all(tu[np.minimum(di, len(tu) - 1)] == dt)
        T = dict(e=e, dir=d, entry_px=u[7], sl_px=u[8], tp1_px=u[9], tp2_px=u[10], tp3_px=u[11], risk_px=u[12], spread_entry=u[13], ladder=(ex == "L"))
        r0, O = H.trade_rows(mk, T, di, cost)
        if abs(r0 - u[15]) > 1e-9: bad += 1
        ok = O["ok"]
        if not ok.any(): continue
        if np.max(np.abs(O["r_plan"] - u[15])) > 1e-9: bad += 1
        bb, dt = bb[ok], dt[ok]
        off = dt - BK.server_to_utc(dt); serv = dt + off
        nxt = (serv // 86400) * 86400 + cut_h * 3600; nxt = np.where(nxt <= serv, nxt + 86400, nxt)
        C = cols[tf]
        C["uid"].append(np.full(len(bb), uid, np.int32)); C["b"].append(bb.astype(np.int32)); C["bar_n"].append((bb - b0 + 1).astype(np.int32))
        C["ntp"].append(O["n_tp_hit"].astype(np.int8)); C["open_r"].append(O["open_r"]); C["mfe_r"].append(O["mfe_r"])
        C["dist_tp"].append(O["dist_tp_r"]); C["mtc"].append(((nxt - serv) // 60).astype(np.int32))
        C["r_cut"].append(O["r_cut"]); C["r_be"].append(O["r_be"]); C["r_hold"].append(O["r_hold"])
        if (cnt + 1) % 20000 == 0: print(f"[{name}] trades {cnt + 1}/{len(keep_t)} {time.time() - t0:.0f}s", flush=True)
    if bad: raise RuntimeError(f"{bad} trades where the simulator does not reproduce r_std -> nothing written")
    check_t = []
    for tf in H.TFS:
        C = {k: np.concatenate(v) if v else np.zeros(0) for k, v in cols[tf].items()}
        np.savez(os.path.join(out, f"grid_{tf}.npz"), **C)
        if len(C["uid"]): check_t.append(EVT[tf]["dec_t"][C["b"][C["bar_n"] % CHECK_N == 0]])
        print(f"[{name}] grid M{tf}: {len(C['uid'])} rows", flush=True)
    sel = np.isin(U[:, 0], [ut[i][0] for i in keep_t])
    np.savez(os.path.join(out, "trades.npz"), uid=U[sel, 0], tf=U[sel, 1], exit_t3=U[sel, 2], entry_t=U[sel, 3], exit_t=U[sel, 4], day=U[sel, 5],
             dir=U[sel, 6], fam=fam[sel], risk=risk[sel], r_std=rstd[sel])
    Et = np.unique(np.concatenate(check_t)); need = ctx_columns(); CT = {k: [] for k in need}
    for a in range(0, len(Et), CTX_CHUNK):
        Cc, Dd, dE, i1 = X.compute(Et[a:a + CTX_CHUNK], M, cost, cut_h, log=lambda *x: None)
        for k in need: CT[k].append(Cc[k][0])
    np.savez(os.path.join(out, "ctx.npz"), t=Et, **{k: np.concatenate(v) for k, v in CT.items()})
    print(f"[{name}] ctx {len(Et)} times; done {time.time() - t0:.0f}s", flush=True)

if __name__ == "__main__":
    main()
