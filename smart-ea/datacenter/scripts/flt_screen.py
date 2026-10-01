r"""Screen the entry-time features of flt_feat on the AdxEma trade library (all 432 sets), real market + 5 random-direction markets.
Trades: sandbox (entry >= 2024-04-15, closed before 2026-06-01, trading day < 2026-06-01) like phase 3. Real market also keeps the later
months (2026-06-01 .. latest) as 'post' rows, reported separately (informational: the user decided there is no exam hold-out any more).
Pattern = feature bucket (percentile bucket of the FIRST half of that TF's trades, direction-relative values) per TF M1 / M3 / M5.
Outcome = e = r_std - mean r_std of the same (set, direction, half) (phase-3 residual: a bucket cannot win by BUY-in-uptrend or half effects).
Per cell: n, days, mean e, t (clustered by trading day), halves, BUY/SELL, share of sets (>= 30 trades in the cell) with the same sign.
Output flt\flt_screen_<market>.pkl"""
import sys, os, time, pickle, sqlite3, calendar, datetime
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, po_lib as PO, zn_lib as ZL, flt_feat as FF
OUT = r"C:\trade datacenter\flt"; os.makedirs(OUT, exist_ok=True)
LIB_FROM = calendar.timegm(datetime.datetime(2024, 4, 15).timetuple()); SB_END = calendar.timegm(datetime.datetime(2026, 6, 1).timetuple())
HALF_DAY = calendar.timegm(datetime.datetime(2025, 5, 8).timetuple()) // 86400
DBS = {"real": r"C:\trade datacenter\adx_trades.sqlite", **{f"sf{k}": rf"C:\trade datacenter\p3_null\sf{k}\adx_trades.sqlite" for k in range(1, 6)}}
FEATS = ["rel_pos", "pdc_d", "ahead20", "behind20", "ahead50", "behind50", "pd_ahead", "pd_behind", "pw_ahead", "pw_behind",
         "brk_with20", "brk_against20", "brk_with50", "brk_against50"]
BRK = [c for c in FEATS if c.startswith("brk")]

def load_trades(path):
    db = sqlite3.connect(path); P = {r[0]: r[1] for r in db.execute("SELECT set_id, tf FROM params")}
    R = np.array(db.execute("SELECT set_id, entry_t, exit_t, day, dir, r_std FROM trades WHERE entry_t >= ? ORDER BY set_id, entry_t", (LIB_FROM,)).fetchall(), float)
    T = dict(set_id=R[:, 0].astype(np.int64), entry_t=R[:, 1].astype(np.int64), exit_t=R[:, 2].astype(np.int64), day=R[:, 3].astype(np.int64), dir=R[:, 4].astype(np.int64), r=R[:, 5])
    T["tf"] = np.array([P[s] for s in T["set_id"]], np.int64)
    T["sb"] = (T["exit_t"] + 60 <= SB_END) & (T["day"] < SB_END // 86400)
    T["post"] = T["entry_t"] >= SB_END
    T["half"] = (T["day"] >= HALF_DAY).astype(np.int64)
    return T

def residuals(T):
    g = (T["set_id"] * 2 + (T["dir"] > 0)) * 2 + T["half"]; e = np.full(len(T["r"]), np.nan); sb = T["sb"]
    ug, gi = np.unique(g[sb], return_inverse=True); mu = np.bincount(gi, T["r"][sb]) / np.bincount(gi); e[sb] = T["r"][sb] - mu[gi]
    g2 = T["set_id"] * 2 + (T["dir"] > 0); u2, i2 = np.unique(g2[sb], return_inverse=True); m2 = np.bincount(i2, T["r"][sb]) / np.bincount(i2)
    p = T["post"]; k = np.searchsorted(u2, g2[p]); ok = (k < len(u2)) & (u2[np.minimum(k, len(u2) - 1)] == g2[p])
    ep = np.full(p.sum(), np.nan); ep[ok] = T["r"][p][ok] - m2[k[ok]]; e[p] = ep
    return e

def cstat(e, day):
    ok = np.isfinite(e); e = e[ok]; day = day[ok]
    if len(e) < 30: return np.nan, np.nan, 0
    ud, inv = np.unique(day, return_inverse=True); s = np.bincount(inv, e); cc = np.bincount(inv); mu = e.mean()
    return mu, np.sqrt(((s - cc * mu) ** 2).sum()) / len(e), len(ud)

def labels(v, ref):
    """bucket labels of values v; edges from ref (first-half values of the same TF). brk_* : minutes since break -> 4 fixed buckets"""
    return np.where(np.isfinite(v), np.searchsorted(ref, v, "right"), -1)

def cells(T, e, F, mkt):
    out = []; sb = T["sb"]
    for tf in (1, 3, 5):
        mt = sb & (T["tf"] == tf)
        for ft in FEATS:
            v = F[ft]; fin = np.isfinite(v)
            if ft in BRK: edges = np.array([15.0, 60.0, 239.5]); nb = 4
            else:
                ref = v[mt & (T["half"] == 0) & fin]; edges = np.unique(np.quantile(ref, [0.2, 0.4, 0.6, 0.8])); nb = len(edges) + 1
            lab = np.where(fin, np.searchsorted(edges, v, "right"), -1)
            for b in range(nb):
                for scope in ("sb", "post"):
                    m = (mt if scope == "sb" else (T["post"] & (T["tf"] == tf))) & (lab == b)
                    if scope == "post" and mkt != "real": continue
                    if m.sum() < 200: continue
                    mu, se, nd = cstat(e[m], T["day"][m]); t = mu / se if se > 0 else np.nan
                    row = dict(tf=tf, feat=ft, bucket=b, nb=nb, scope=scope, n=int(m.sum()), days=nd, e=mu, t=t, edges=edges.tolist())
                    if scope == "sb":
                        for h in (0, 1):
                            mh = m & (T["half"] == h); a, s_, _ = cstat(e[mh], T["day"][mh]); row[f"e_h{h}"] = a; row[f"t_h{h}"] = a / s_ if s_ > 0 else np.nan
                        for nm, sd in (("buy", 1), ("sell", -1)):
                            ms = m & (T["dir"] == sd); a, s_, _ = cstat(e[ms], T["day"][ms]); row[f"e_{nm}"] = a; row[f"t_{nm}"] = a / s_ if s_ > 0 else np.nan
                        sg = []
                        for s in np.unique(T["set_id"][m]):
                            ms = m & (T["set_id"] == s)
                            if ms.sum() >= 30: sg.append(np.nanmean(e[ms]))
                        sg = np.array(sg); row["set_share"] = float(np.mean(np.sign(sg) == np.sign(mu))) if len(sg) else np.nan; row["n_sets"] = len(sg)
                    out.append(row)
    return out

def run(mkt):
    f = os.path.join(OUT, f"flt_screen_{mkt}.pkl")
    if os.path.exists(f): return
    t0 = time.time(); T = load_trades(DBS[mkt]); e = residuals(T); M = PO.load_market(mkt); Z = ZL.Zones(M); L = FF.build_levels(Z)
    ue, inv = np.unique(T["entry_t"], return_inverse=True); idx = np.searchsorted(M["t"], ue)
    assert np.all(M["t"][idx] == ue), "entry time not on an M1 bar"
    Fu = FF.feats_at(M, Z, L, idx); fin = np.isfinite(Fu["adr"])
    Dd = FF.directed({k: v[inv] for k, v in Fu.items()}, T["dir"]); good = fin[inv]
    for k in Dd: Dd[k] = np.where(good, Dd[k], np.nan)
    print(mkt, f"trades {len(T['r'])}, sandbox {T['sb'].sum()}, post {T['post'].sum()}, entries {len(ue)}, features {time.time() - t0:.0f}s", flush=True)
    res = cells(T, e, Dd, mkt)
    pickle.dump(dict(cells=res, n=len(T["r"])), open(f, "wb")); print(mkt, "cells", len(res), f"{time.time() - t0:.0f}s", flush=True)

if __name__ == "__main__":
    for m in (sys.argv[1:] or list(DBS)): run(m)
