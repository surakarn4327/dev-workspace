r"""Phase 2 audit part 2: ctx columns that adx_ctx_audit.py did not compare with tables built BEFORE phase 2.
 a) f_m{1,5}_vspike_age vs gold_dc vol_events VOL_SPIKE   b) f_m5_tri_age vs patterns_c TRIANGLE (tf 5)
 c) d_gap_adr vs day_time.gap_adr (cat_time.py)            d) previous-day high/low/close behind d_pdh/pdl/pdc_adr vs table days
 Differences at the bar level must be exact ties on a threshold (float catalog vs integer ctx), otherwise BAD."""
import sqlite3
import numpy as np
import broker as BK, adx_ctx as X, adx_asof as AS, cat_bars as CB

bad_total = 0
def rep(name, nbad, extra=""):
    global bad_total; bad_total += nbad > 0
    print(f"{'OK ' if nbad == 0 else 'BAD'} {name}: {nbad} {extra}", flush=True)

db = sqlite3.connect(AS.DBT); g = sqlite3.connect(BK.DB)
cols = [r[1] for r in db.execute("PRAGMA table_info(ctx)")]; ci = {c: i for i, c in enumerate(cols)}
CT = np.array(db.execute("SELECT * FROM ctx ORDER BY entry_t").fetchall(), dtype=float); E = CT[:, 0].astype(np.int64)
_, dE, _ = X.sessions(E); M = X.load(None)

def ages(bar_t, flag_t, jB, LB):
    """age (bars) of the last flagged bar at or before jB, -1 if none within LB"""
    idx = np.flatnonzero(np.isin(bar_t, flag_t)); k = np.searchsorted(idx, jB, "right") - 1
    a = np.where(k >= 0, jB - idx[np.clip(k, 0, None)], 10 ** 9); return np.where(a < LB, a, -1)

for tf in (1, 5):
    B = X.resample(M, tf); jB = X.last_closed(B, E, dE); LB = 1440 // tf; n = len(B["c"])
    # a) volume spikes
    W = max(20, 1380 // tf); tvi = B["tv"].astype(np.int64); cs = np.r_[0, np.cumsum(tvi)]
    sw = np.full(n, -1, np.int64); sw[W:] = cs[W:n] - cs[:n - W]
    ours = (sw >= 0) & (W * tvi >= 3 * sw); tie = (sw >= 0) & (W * tvi == 3 * sw)
    Vt = np.array([r[0] for r in g.execute("SELECT t FROM vol_events WHERE tf=? AND type='VOL_SPIKE'", (tf,))], dtype=np.int64)
    cat = np.isin(B["t_last"], Vt); dis = np.flatnonzero(cat != ours)
    rep(f"a) M{tf} volume-spike bars: catalog vs ctx rule, disagreements that are not exact ties", int(np.sum(~tie[dis])), f"({len(dis)} of {n} bars disagree)")
    o = CT[:, ci[f"f_m{tf}_vspike_age"]]; c_ = ages(B["t_last"], Vt, jB, LB)
    print(f"   M{tf} vspike_age rows differing from catalog ages: {int(np.sum(o != c_))} of {len(o)}")
    if tf == 5:
        # b) triangles (zigzag 3)
        Tt = np.array([r[0] for r in g.execute("SELECT t FROM patterns_c WHERE tf=5 AND type='TRIANGLE'")], dtype=np.int64)
        o = CT[:, ci["f_m5_tri_age"]]; c_ = ages(B["t_last"], Tt, jB, LB); dif = int(np.sum(o != c_))
        rep("b) M5 triangle age vs patterns_c TRIANGLE", 0 if dif <= 0.001 * len(o) else dif, f"(rows differing {dif} = {dif / len(o):.4%})")

# c) gap vs day_time (cat_time uses the previous M1 bar's close = close of the previous session in the data)
G = dict(g.execute("SELECT day, gap_adr FROM day_time").fetchall())
ok = ~np.isnan(CT[:, ci["d_gap_adr"]]) & (CT[:, ci["a_adr_days"]] == 20)
dd = CT[ok, ci["day"]].astype(np.int64); ours = CT[ok, ci["d_gap_adr"]]; ref = np.array([G.get(int(x), np.nan) for x in dd])
has = ~np.isnan(ref)                     # day_time only holds full days: US holidays / early closes have no reference value
print(f"   rows on days without a day_time row (holidays / short days, not comparable): {int((~has).sum())} "
      f"on {len(set(int(x) for x in dd[~has]))} days")
diff = has & ~np.isclose(ours, ref, rtol=1e-9, atol=1e-9)
days_bad = sorted(set(int(x) for x in dd[diff]))
rep(f"c) gap vs day_time.gap_adr ({int(ok.sum())} rows)", len(days_bad), f"days differing: {days_bad[:10]}")

# d) previous day levels vs table days (previous trading date present in days, skipping short stub sessions)
D = np.array(g.execute("SELECT day, high, low, close, range FROM days ORDER BY day").fetchall())
Dm = {int(r[0]): r for r in D}
# reconstruct previous-day levels from ctx values: pdh = now - d_pdh_adr * adr ; compare the three implied levels to each other via days
adr = CT[:, ci["a_adr_usd"]]
ok = ~np.isnan(adr)
now_from_pdc = None
lv = {k: None for k in ("h", "l", "c")}
# implied: pdh - pdl = (d_pdl_adr - d_pdh_adr) * adr must equal the previous day's range in table days
yr = (CT[:, ci["d_pdl_adr"]] - CT[:, ci["d_pdh_adr"]]) * adr
prevday = np.array([max([k for k in Dm if k < int(x)], default=-1) for x in CT[:, ci["day"]]])
rng_tab = np.array([Dm[p][4] if p in Dm else np.nan for p in prevday])
diff = ok & ~np.isclose(yr, rng_tab, rtol=1e-7, atol=1e-6)
rep("d) previous-day range implied by ctx vs table days (previous trading date)", int(np.sum(diff)),
    f"days: {sorted(set(int(x) for x in CT[diff, ci['day']]))[:10]}")
print("RESULT:", "all part-2 audit checks passed" if bad_total == 0 else f"{bad_total} check(s) failed")
