r"""Phase 3B-a audit part 3 — the two things not yet tied to something verified before:
1) the TF bars on which events are found (adx_ctx.resample, grouped by trading day, gold_dc.sqlite) must be the SAME bars the EA sees
   (adx_lib.tf_bars = MT5 clock buckets on the bars file, verified against MT5 in phase 1): time, O/H/L/C, tick volume, every bar
   2024-04-12 .. 2026-06-01, M1/M3/M5.
2) BE realism: the simulator moves the SL to the entry price whenever the decision price is in profit, ignoring the broker's minimum
   stop distance (unknown for XAUUSDc — not in any file). Share of BE rows whose price is within $0.05 / 0.10 / 0.20 / 0.31 / 0.50
   of the entry = rows that a stop-level rule could make infeasible. Descriptive only (no outcome read).
Usage: python hold_audit3.py > ..\hold_audit3.txt"""
import sqlite3
import numpy as np
import broker as BK, adx_lib as A, adx_ctx as X, hold_lib as H, hold_build as HB

bad_total = 0
def rep(name, nbad, extra=""):
    global bad_total; bad_total += nbad > 0
    print(f"{'OK ' if nbad == 0 else 'BAD'} {name}: {nbad} {extra}", flush=True)

M = H.load_ctx_bars(); mk = H.walk_market(); W = mk.M; tu = mk.tu
keep = (tu >= BK.T0) & (tu < H.SANDBOX_END)
for tf in H.TFS:
    Bc = X.resample(M, tf)
    Wm = {k: (v[keep] if hasattr(v, "__len__") and len(v) == len(tu) else v) for k, v in W.items()}
    Wm["t"] = tu[keep]
    Bw = A.tf_bars(Wm, tf)
    same_n = len(Bw["t"]) == len(Bc["t_open"])
    nb = 0 if not same_n else int(np.sum(Bw["t"] // (tf * 60) != Bc["t_open"] // (tf * 60)))
    for a, b in (("o", "o"), ("h", "h"), ("l", "l"), ("c", "c"), ("tv", "tv")):
        if same_n: nb += int(np.sum(np.abs(Bw[a] - Bc[b]) > 1e-9))
    rep(f"1) M{tf} event bars (ctx, trading-day grouping) != EA bars (adx_lib.tf_bars, MT5 buckets)", nb + int(not same_n),
        f"(ctx {len(Bc['t_open'])} bars, EA {len(Bw['t'])} bars)")
    if same_n:
        rep(f"1) M{tf} first-M1 time of the bar differs (ctx t_open vs EA first M1 bar)", int(np.sum(Wm['t'][Bw['st']] != Bc['t_open'])))

db = sqlite3.connect(HB.OUT)
print("2) BE rows: distance between the decision price and the entry (where the SL is moved), in $ — share of BE rows")
for tf in H.TFS:
    g = np.array(db.execute("SELECT d.open_r * u.risk_px FROM dec d JOIN utrades u USING(uid) WHERE u.tf = ? AND d.r_be IS NOT NULL", (tf,)).fetchall(), dtype=float)[:, 0]
    print(f"   M{tf}: {len(g)} BE rows, " + ", ".join(f"< ${x:.2f}: {np.mean(g < x) * 100:.1f}%" for x in (0.05, 0.10, 0.20, 0.31, 0.50)) +
          f", median ${np.median(g):.2f}")
print("ALL OK" if bad_total == 0 else f"{bad_total} CHECK(S) FAILED")
