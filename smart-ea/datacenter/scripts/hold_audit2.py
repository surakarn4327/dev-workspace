r"""Phase 3B-a audit part 2 — ties the EVENT DEFINITIONS of hold_lib.py to things verified before phase 3B (hold_check / hold_audit only
compared hold_lib with code written from the same understanding):
1) every distinct (TF, decision time) of table dec vs table ctx_dec at that time, i.e. the phase-2 ctx code that was checked against the
   catalog (dc_catalog*): big / pin / vspike / inside  <->  f_<tf>_big_age = 0 / f_<tf>_pin_age = 0 / f_<tf>_vspike_age = 0 / f_<tf>_inside = 1
   (both directions + directions), regime bit <-> <tf>k3_reg_age = 0 and value = <tf>k3_reg, pivot bit -> <tf>k3_leg_dir = new leg direction,
   pdh/pdl -> d_broke_* = 1 and price beyond the level, asia high/low -> Asia over and price outside the Asia range
2) pivot-confirmation bits of M1 / M5 (every bar before 2026-06-01) vs the catalog table pivots (gold_dc.sqlite, zigzag 3 ATR)
3) every NULL of ctx_dec explained (ADR < 3 days / first 10 days of data), none of the "today" NULLs (a decision never falls on the first bar
   of a session); descriptions of ctx_dec mentioning the entry are listed for review
Usage: python hold_audit2.py > ..\hold_audit2.txt   (counts only, no outcome read)"""
import sqlite3, time
import numpy as np
import broker as BK, hold_lib as H, hold_build as HB

T0 = time.time(); bad_total = 0
def rep(name, nbad, extra=""):
    global bad_total; bad_total += nbad > 0
    print(f"{'OK ' if nbad == 0 else 'BAD'} {name}: {nbad} {extra}", flush=True)
db = sqlite3.connect(HB.OUT)

# ---------------- 1) dec events vs ctx_dec (phase-2 definitions)
R = np.array(db.execute("SELECT u.tf, d.dec_t, d.flags & ?, d.ev_big_dir, d.ev_pin_dir, d.ev_piv_dir, d.ev_reg_new, COUNT(*) FROM dec d JOIN utrades u USING(uid) "
                        "GROUP BY 1, 2, 3, 4, 5, 6, 7", (8191,)).fetchall(), dtype=np.int64)
key = R[:, 0] * 10 ** 10 + R[:, 1]
rep("1) (TF, decision time) pairs with more than one event pattern across trades", int(len(key) - len(np.unique(key))), f"({len(key)} pairs, {time.time() - T0:.0f}s)")
cols = [r[1] for r in db.execute("PRAGMA table_info(ctx_dec)")]
CX = np.array(db.execute("SELECT * FROM ctx_dec ORDER BY dec_t").fetchall(), dtype=float); ci = {c: i for i, c in enumerate(cols)}
pos = np.searchsorted(CX[:, 0].astype(np.int64), R[:, 1]); assert np.all(CX[pos, 0] == R[:, 1])
EVT = {}; M = H.load_ctx_bars(); SLv = H.sessions_levels(M)
for tf in H.TFS: EVT[tf] = H.tf_events(M, tf, SLv)
for tf in H.TFS:
    m = R[:, 0] == tf; fl = R[m, 2]; X = CX[pos[m]]; p = f"m{tf}"; k3 = f"{p}k3"
    col = lambda c: X[:, ci[c]]
    bit = lambda n: (fl & H.BIT[n]) != 0
    n = int(m.sum()); noadr = col("a_adr_days") < 3            # price-vs-level in ADR units is NULL while ADR has < 3 days (first sandbox days)
    rep(f"1) M{tf} big bit <-> ctx f_{p}_big_age == 0", int(np.sum(bit("big") != (col(f"f_{p}_big_age") == 0))), f"({n} pairs, big {int(bit('big').sum())})")
    rep(f"1) M{tf} big direction = ctx f_{p}_big_dir", int(np.sum(bit("big") & (R[m, 3] != col(f"f_{p}_big_dir")))))
    rep(f"1) M{tf} pin bit <-> ctx f_{p}_pin_age == 0", int(np.sum(bit("pin") != (col(f"f_{p}_pin_age") == 0))), f"(pin {int(bit('pin').sum())})")
    rep(f"1) M{tf} pin direction = ctx f_{p}_pin_dir", int(np.sum(bit("pin") & (R[m, 4] != col(f"f_{p}_pin_dir")))))
    rep(f"1) M{tf} vspike bit <-> ctx f_{p}_vspike_age == 0", int(np.sum(bit("vspike") != (col(f"f_{p}_vspike_age") == 0))), f"(vspike {int(bit('vspike').sum())})")
    rep(f"1) M{tf} inside bit <-> ctx f_{p}_inside == 1", int(np.sum(bit("inside") != (col(f"f_{p}_inside") == 1))), f"(inside {int(bit('inside').sum())})")
    # regime: reg_age counts minutes from the close of the confirming bar; the decision tick is that close unless a data gap follows the bar
    B = EVT[tf]["B"]; bi = np.searchsorted(B["t_open"], R[m, 1], "left") - 1; nogap = (B["t_last"][bi] + 60) == R[m, 1]
    ra = col(f"{k3}_reg_age")
    rep(f"1) M{tf} regime bit <-> ctx {k3}_reg_age == 0 (decision tick right at the bar close)", int(np.sum(nogap & (bit("regime") != (ra == 0)))),
        f"(regime {int(bit('regime').sum())}, pairs after a data gap skipped {int((~nogap).sum())})")
    rep(f"1) M{tf} regime value = ctx {k3}_reg", int(np.sum(bit("regime") & (R[m, 6] != col(f"{k3}_reg")))))
    rep(f"1) M{tf} pivot bit -> ctx {k3}_leg_dir = new leg direction", int(np.sum(bit("pivot") & (R[m, 5] != col(f"{k3}_leg_dir")))), f"(pivot {int(bit('pivot').sum())})")
    rep(f"1) M{tf} pdh bit -> ctx d_broke_pdh = 1 and price above yesterday's high", int(np.sum(bit("pdh") & ~((col("d_broke_pdh") == 1) & ((col("d_pdh_adr") > 0) | noadr)))), f"(pdh {int(bit('pdh').sum())}, of which ADR not yet defined {int((bit('pdh') & noadr).sum())})")
    rep(f"1) M{tf} pdl bit -> ctx d_broke_pdl = 1 and price below yesterday's low", int(np.sum(bit("pdl") & ~((col("d_broke_pdl") == 1) & ((col("d_pdl_adr") < 0) | noadr)))), f"(pdl {int(bit('pdl').sum())}, of which ADR not yet defined {int((bit('pdl') & noadr).sum())})")
    rep(f"1) M{tf} asiahigh bit -> Asia over and price above the Asia range", int(np.sum(bit("asiahigh") & ~((col("d_asia_done") == 1) & (col("d_asia_pos") > 1)))))
    rep(f"1) M{tf} asialow bit -> Asia over and price below the Asia range", int(np.sum(bit("asialow") & ~((col("d_asia_done") == 1) & (col("d_asia_pos") < 0)))))

# ---------------- 2) pivots vs catalog
g = sqlite3.connect(BK.DB)
for tf in (1, 5):
    B = EVT[tf]["B"]; ours = set(B["t_last"][(EVT[tf]["flags"] & H.BIT["pivot"]) != 0].tolist())
    cat = {int(r[0]): int(r[1]) for r in g.execute("SELECT t_confirm, kind FROM pivots WHERE tf = ? AND t_confirm < ?", (tf, H.SANDBOX_END))}
    only_o, only_c = ours - set(cat), set(cat) - ours
    rep(f"2) M{tf} pivot confirmations: ours vs catalog table pivots", len(only_o) + len(only_c), f"(ours {len(ours)}, catalog {len(cat)}, only ours {len(only_o)}, only catalog {len(only_c)})")
    idx = {int(t): i for i, t in enumerate(B["t_last"].tolist())}; dv = EVT[tf]["dirs"]["piv"]
    rep(f"2) M{tf} pivot kind differs (new leg dir = -kind)", sum(1 for t, kd in cat.items() if t in ours and dv[idx[t]] != -kd))
    if only_o or only_c:
        print("   first differences (UTC):", sorted(only_o)[:5], sorted(only_c)[:5])

# ---------------- 3) ctx_dec NULLs
warm = CX[:, 0] < BK.T0 + 10 * 86400; adrlow = CX[:, ci["a_adr_days"]] < 3
un = {c: int(np.sum(np.isnan(CX[:, i]) & ~(warm | adrlow))) for c, i in ci.items()}
rep("3) ctx_dec NULLs not explained by the first 10 days / ADR < 3 days", sum(un.values()), str({k: v for k, v in un.items() if v}))
rep("3) ctx_dec rows with no bar of today (d_today_bars = 0)", int(np.sum(CX[:, ci["d_today_bars"]] == 0)))
print(f"   ctx_dec rows {len(CX)}, rows in the first 10 days {int(warm.sum())}, rows with any NULL {int(np.isnan(CX).any(1).sum())}")
for nm, ds in db.execute("SELECT name, description FROM columns WHERE tbl = 'ctx_dec' AND description LIKE '%เข้าไม้%'"): print(f"   review description {nm}: {ds}")
print(f"{'ALL OK' if bad_total == 0 else str(bad_total) + ' CHECK(S) FAILED'}  ({time.time() - T0:.0f}s)")
