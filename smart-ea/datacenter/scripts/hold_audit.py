r"""Phase 3B-a final audit (after hold_build.py + hold_check.py) — closes the gaps hold_check.py leaves:
hold_check re-simulates with MY second implementation of the same spec (a spec mistake would pass both) and only samples rows.
Here:
A) invariants on EVERY row that must hold by definition (rem vs TP hits, r_cut formula, MFE/MAE vs open R, SL/TP distances, exit-time order
   of the alternatives vs the plan, alternatives that must equal the plan when the removed/moved level is never reached, event directions)
B) the full decision list of EVERY unique trade rebuilt from tf_events + the plan exit of adx_lib.walk_exit (the MT5-verified walker)
C) every alternative of a large sample (all TP-hit states) recomputed by calling adx_lib.walk_exit from the decision bar with the changed
   levels — ties the new simulator to the code checked against MT5; reports how often the rare branches were exercised
D) extra time-travel points chosen for risky cases (TP2 already hit, minutes before cutoff, first bar of a session / of the week, day of a DST
   switch, bars carrying level / structure events): events, state and ctx_dec from data cut at D must be unchanged
E) reproducibility: rebuild two months (one of them the last sandbox month) into a temp file -> identical rows
F) sandbox boundary: no time at or after 2026-06-01 anywhere, no bar after it loaded
G) descriptive per half of the sandbox (no outcome): rows per trade, share of each event bit, state medians — looks for a broken period
Usage: python hold_audit.py > ..\hold_audit.txt       (prints counts only; no totals of R)"""
import os, sys, sqlite3, time, subprocess, tempfile
import numpy as np
import broker as BK, adx_lib as A, adx_ctx as X, hold_lib as H, hold_build as HB

T0 = time.time(); bad_total = 0
def rep(name, nbad, extra=""):
    global bad_total; bad_total += nbad > 0
    print(f"{'OK ' if nbad == 0 else 'BAD'} {name}: {nbad} {extra}", flush=True)
HOLD = HB.OUT
db = sqlite3.connect(HOLD); db.execute(f"ATTACH DATABASE '{H.X.DBT}' AS T")
meta = dict(db.execute("SELECT k, v FROM T.meta").fetchall()); COST = float(meta["cost_std_price"]); CUT_H = int(meta["cutoff_server_hour"])
UT = {r[0]: r for r in db.execute("SELECT uid, tf, exit_mode, entry_t, exit_t, day, dir, entry_px, sl_px, tp1_px, tp2_px, tp3_px, risk_px, "
                                   "spread_entry, exit_reason, r_std, n_sets, n_dec FROM utrades")}
first = {}
for s_, n_, u_ in db.execute("SELECT set_id, n, uid FROM set_map"): first.setdefault(u_, (s_, n_))
HIT = {}
q = {k: u for u, k in first.items()}
for s_, n_, h1, h2 in db.execute("SELECT set_id, n, hit_tp1, hit_tp2 FROM T.trades WHERE entry_t >= ?", (H.LIB_FROM,)):
    u_ = q.get((s_, n_))
    if u_ is not None: HIT[u_] = h1 + h2
print(f"loaded {len(UT)} unique trades, {time.time() - T0:.0f}s", flush=True)

M = H.load_ctx_bars(); SLv = H.sessions_levels(M); EVT = {tf: H.tf_events(M, tf, SLv) for tf in H.TFS}
mk = H.walk_market(); tu = mk.tu; W = mk.M
rep("F) bars loaded for events / ctx / walk reach 2026-06-01", int(M["t"].max() >= H.SANDBOX_END) + int(tu.max() >= H.SANDBOX_END),
    f"(last event bar {M['t'].max()}, last walk bar {tu.max()}, boundary {H.SANDBOX_END})")
for nm, sql in (("dec_t", "SELECT MAX(dec_t) FROM dec"), ("be_exit_t", "SELECT MAX(be_exit_t) FROM dec"), ("hold_exit_t", "SELECT MAX(hold_exit_t) FROM dec"),
                ("ctx_dec", "SELECT MAX(dec_t) FROM ctx_dec"), ("utrades.exit_t", "SELECT MAX(exit_t) FROM utrades")):
    v = db.execute(sql).fetchone()[0]; rep(f"F) max {nm} < 2026-06-01", int(v >= H.SANDBOX_END), f"({v})")
rep("F) trading day of every trade < 2026-06-01", db.execute("SELECT COUNT(*) FROM utrades WHERE day >= ?", (H.END_DAY,)).fetchone()[0])

cols = [r[1] for r in db.execute("PRAGMA table_info(dec)")]; ci = {c: i for i, c in enumerate(cols)}
FAR = 1e9; HALF_DAY = 20216                               # trading day key of 2025-05-08 (= p3lib.HALF_DAY)
def fills_r(W_, ent, d, risk):
    return sum(f * ((p - ent) * d) for f, p in W_["fills"]) / risk

cnt = {k: 0 for k in ("rem", "t3hit", "realized", "rcut", "mfe", "mae", "distsl", "disttp", "slconst", "be_before", "hold_after", "exit_ge_dec",
                      "reasons", "t3hold", "ladhold", "be2", "be3", "hold3", "dirs")}
B_bad = B_rows = B_trades = 0; Bw_bad = 0
C_bad = 0; C_rows = 0; C_cov = {k: 0 for k in ("plan_open_fill", "plan_cutoff", "plan_tp_partial", "be_applied", "be_sl", "be_open_fill", "be_tp", "be_cutoff",
                                              "hold_sl", "hold_open_fill", "hold_cutoff", "n_tp1", "n_tp2", "t3", "sell")}
C_worst = 0.0
G = {h: dict(rows=0, trades=0, bits=np.zeros(14), held=[], openr=[]) for h in (0, 1)}
rng = np.random.default_rng(3)
uids = np.array(sorted(UT)); CH = 4000
for a in range(0, len(uids), CH):
    lo, hi = int(uids[a]), int(uids[min(a + CH, len(uids)) - 1])
    R = db.execute(f"SELECT {','.join(cols)} FROM dec WHERE uid BETWEEN ? AND ? ORDER BY uid, dec_t", (lo, hi)).fetchall()
    if not R: continue
    Z = {c: np.array([r[i] for r in R], dtype=float) for c, i in ci.items()}
    uid = Z["uid"].astype(np.int64)
    ut = np.array([[UT[u][1], UT[u][2] == "L", UT[u][3], UT[u][4], UT[u][6], UT[u][7], UT[u][8], UT[u][11], UT[u][12], UT[u][13], UT[u][14],
                                                  HIT.get(u, -1)] for u in uid.tolist()], dtype=float)
    tf, lad, et, xt, d, ent, sl, tp3, risk, sp, xr, nh = ut.T
    costR = (COST - sp) / risk
    # ---------------- A) invariants
    cnt["rem"] += int(np.sum(np.abs(Z["rem"] - (1 - Z["n_tp_hit"] / 3)) > 1e-12))
    cnt["t3hit"] += int(np.sum((lad == 0) & (Z["n_tp_hit"] != 0)))
    cnt["realized"] += int(np.sum((Z["realized_r"] == 0) != (Z["n_tp_hit"] == 0)))
    cnt["rcut"] += int(np.sum(np.abs(Z["r_cut"] - (Z["realized_r"] + Z["rem"] * Z["open_r"] - costR)) > 1e-9))
    cnt["mfe"] += int(np.sum(Z["mfe_r"] < np.maximum(0, Z["open_r"]) - 1e-12))
    cnt["mae"] += int(np.sum(Z["mae_r"] < np.maximum(0, -Z["open_r"]) - 1e-12))
    cnt["distsl"] += int(np.sum(Z["dist_sl_r"] <= 0)); cnt["disttp"] += int(np.sum(Z["dist_tp_r"] <= 0))
    cnt["slconst"] += int(np.sum(np.abs(ent + (Z["open_r"] - Z["dist_sl_r"]) * risk * d - sl) > 1e-6))
    be = np.isfinite(Z["r_be"])
    cnt["be_before"] += int(np.sum(be & (Z["be_exit_t"] > xt)))
    cnt["hold_after"] += int(np.sum(Z["hold_exit_t"] < xt))
    cnt["exit_ge_dec"] += int(np.sum((be & (Z["be_exit_t"] < Z["dec_t"])) | (Z["hold_exit_t"] < Z["dec_t"])))
    cnt["reasons"] += int(np.sum(be & ~np.isin(Z["be_reason"], (1, 2, 3)))) + int(np.sum(~np.isin(Z["hold_reason"], (1, 3))))
    same = lambda x, y: np.abs(x - y) <= 1e-9
    cnt["t3hold"] += int(np.sum((lad == 0) & np.isin(xr, (1, 3)) & ~(same(Z["r_hold"], Z["r_plan"]) & (Z["hold_exit_t"] == xt))))
    cnt["ladhold"] += int(np.sum((lad == 1) & np.isin(xr, (1, 3)) & (nh == Z["n_tp_hit"]) & ~(same(Z["r_hold"], Z["r_plan"]) & (Z["hold_exit_t"] == xt))))
    cnt["be2"] += int(np.sum(be & (Z["be_reason"] == 2) & ~(same(Z["r_be"], Z["r_plan"]) & (Z["be_exit_t"] == xt) & (xr == 2))))
    cnt["be3"] += int(np.sum(be & (Z["be_reason"] == 3) & ~(same(Z["r_be"], Z["r_plan"]) & (xr == 3))))
    cnt["hold3"] += int(np.sum((Z["hold_reason"] == 3) & (xr == 3) & (Z["hold_exit_t"] != xt)))
    fl = Z["flags"].astype(np.int64)
    for nm, bit in (("ev_big_dir", "big"), ("ev_pin_dir", "pin"), ("ev_piv_dir", "pivot"), ("ev_reg_new", "regime"), ("ev_box_dir", "boxbreak")):
        cnt["dirs"] += int(np.sum(((fl & H.BIT[bit]) == 0) & (Z[nm] != 0)))
    # ---------------- B) full decision list of every trade in the chunk, plan exit from adx_lib.walk_exit
    st = np.r_[0, np.flatnonzero(np.diff(uid)) + 1]; en = np.r_[st[1:], len(uid)]; have = dict(zip(uid[st].tolist(), zip(st.tolist(), en.tolist())))
    for u in uids[a:a + CH].tolist():
        U = UT[u]; tfu = U[1]; Ev = EVT[tfu]; tO = Ev["B"]["t_open"]
        e = int(np.searchsorted(tu, U[3])); d_ = U[6]
        Wp = A.walk_exit(mk, e, d_, U[8], U[9], U[10], U[11], U[2] == "L", U[7])
        if abs(fills_r(Wp, U[7], d_, U[12]) - (COST - U[13]) / U[12] - U[15]) > 1e-9: Bw_bad += 1
        b0 = int(np.searchsorted(tO, U[3])); b1 = int(np.searchsorted(tO, U[4], "right")); bb = np.arange(b0, b1); bn = bb - b0 + 1
        f_ = Ev["flags"][bb] | np.where(bn % H.CHECK_N == 0, H.BIT["check"], 0); dt = Ev["dec_t"][bb]
        ok = (f_ != 0) & (dt > 0); bb, bn, f_, dt = bb[ok], bn[ok], f_[ok], dt[ok]
        di = np.searchsorted(tu, dt)
        opn = (di < Wp["exit_i"]) | ((di == Wp["exit_i"]) & (not Wp["at_open"]))
        bb, bn, f_, dt = bb[opn], bn[opn], f_[opn], dt[opn]
        exp = np.stack([dt, bn, f_] + [Ev["dirs"][k][bb] for k in ("big", "pin", "piv", "reg", "box")], 1) if len(bb) else np.zeros((0, 8))
        s, t_ = have.get(u, (0, 0))
        got = np.stack([Z[c][s:t_] for c in ("dec_t", "bar_n", "flags", "ev_big_dir", "ev_pin_dir", "ev_piv_dir", "ev_reg_new", "ev_box_dir")], 1)
        B_trades += 1; B_rows += len(exp)
        if exp.shape != got.shape or not np.array_equal(exp.astype(np.int64), got.astype(np.int64)): B_bad += 1
        if U[17] != len(exp): B_bad += 1
    # ---------------- C) alternatives via adx_lib.walk_exit from the decision bar, sample ~1.2 %
    pick = np.flatnonzero(rng.random(len(uid)) < 0.012)
    for r in pick.tolist():
        u = int(uid[r]); U = UT[u]; d_ = U[6]; ent = U[7]; risk = U[12]; lad_ = U[2] == "L"; cR = (COST - U[13]) / risk
        di = int(np.searchsorted(tu, int(Z["dec_t"][r]))); nt = int(Z["n_tp_hit"][r]); real = Z["realized_r"][r] * risk; rem = Z["rem"][r]
        tp1, tp2, tp3 = U[9], U[10], U[11]; far = d_ * FAR
        def alt(slv, keep_tps):
            if not keep_tps:
                Wx = A.walk_exit(mk, di, d_, slv, far, far, far, False, ent); pnl = real + rem * (Wx["fills"][-1][1] - ent) * d_
            elif not lad_ or nt == 2:
                Wx = A.walk_exit(mk, di, d_, slv, tp3, tp3, tp3, False, ent); pnl = real + rem * (Wx["fills"][-1][1] - ent) * d_
            elif nt == 1:                                          # TP1 done: TP2 (1/3) still pending -> pass it as the only partial level
                Wx = A.walk_exit(mk, di, d_, slv, tp2, far, tp3, True, ent)
                pnl = real; left = rem
                if Wx["hit1"]: pnl += (Wx["fills"][0][1] - ent) * d_ / 3.0; left -= 1.0 / 3.0
                pnl += left * (Wx["fills"][-1][1] - ent) * d_
            else:
                Wx = A.walk_exit(mk, di, d_, slv, tp1, tp2, tp3, True, ent); pnl = sum(f * (p - ent) * d_ for f, p in Wx["fills"])
            return pnl / risk - cR, Wx
        px = W["o"][di] + (W["sp"][di] if d_ == -1 else 0.0)
        exp = {"open_r": (px - ent) * d_ / risk, "r_cut": (real + rem * (px - ent) * d_) / risk - cR}
        rp, Wp = alt(U[8], True); exp["r_plan"] = rp
        rh, Wh = alt(U[8], False); exp.update(r_hold=rh, hold_exit_t=tu[Wh["exit_i"]], hold_reason=Wh["reason"])
        if exp["open_r"] > 0:
            rb, Wb = alt(ent, True); exp.update(r_be=rb, be_exit_t=tu[Wb["exit_i"]], be_reason=Wb["reason"]); C_cov["be_applied"] += 1
            C_cov["be_sl"] += Wb["reason"] == 1; C_cov["be_tp"] += Wb["reason"] == 2; C_cov["be_cutoff"] += Wb["reason"] == 3
            C_cov["be_open_fill"] += bool(Wb["at_open"] and Wb["reason"] != 3)
        else: exp.update(r_be=np.nan)
        C_cov["plan_open_fill"] += bool(Wp["at_open"] and Wp["reason"] != 3); C_cov["plan_cutoff"] += Wp["reason"] == 3
        C_cov["plan_tp_partial"] += bool(Wp["hit1"] or Wp["hit2"]); C_cov["hold_sl"] += Wh["reason"] == 1; C_cov["hold_cutoff"] += Wh["reason"] == 3
        C_cov["hold_open_fill"] += bool(Wh["at_open"] and Wh["reason"] != 3)
        C_cov["n_tp1"] += nt == 1; C_cov["n_tp2"] += nt == 2; C_cov["t3"] += not lad_; C_cov["sell"] += d_ == -1
        C_rows += 1; badr = False
        for k, v in exp.items():
            g = Z[k][r]
            if (isinstance(v, float) and np.isnan(v)) or np.isnan(g):
                badr |= bool(np.isnan(v) != np.isnan(g)); continue
            dv = abs(float(v) - float(g)); C_worst = max(C_worst, dv if k not in ("hold_exit_t", "be_exit_t", "hold_reason", "be_reason") else 0)
            badr |= dv > 1e-9
        C_bad += badr
    # ---------------- G) descriptive per half
    half = (np.array([UT[u][5] for u in uid.tolist()]) >= HALF_DAY).astype(int)
    for h in (0, 1):
        m = half == h
        if not m.any(): continue
        G[h]["rows"] += int(m.sum()); G[h]["bits"] += np.array([np.sum((fl[m] >> i) & 1) for i in range(14)])
        G[h]["held"].append(Z["held_min"][m][::50]); G[h]["openr"].append(Z["open_r"][m][::50])
    for u in uids[a:a + CH].tolist(): G[int(UT[u][5] >= HALF_DAY)]["trades"] += 1
    if (a // CH) % 10 == 0: print(f"  chunk {a // CH + 1}/{-(-len(uids) // CH)} {time.time() - T0:.0f}s", flush=True)

labels = {"rem": "rem != 1 - n_tp_hit/3", "t3hit": "T3 trade with a TP hit", "realized": "realized_r == 0 <-> n_tp_hit == 0 broken",
          "rcut": "r_cut != realized + rem*open_r - cost", "mfe": "mfe_r < max(0, open_r)", "mae": "mae_r < max(0, -open_r)", "distsl": "dist_sl_r <= 0 while open",
          "disttp": "dist_tp_r <= 0 while open", "slconst": "SL implied by open_r - dist_sl_r != sl_px", "be_before": "BE exits after the plan exit",
          "hold_after": "hold exits before the plan exit", "exit_ge_dec": "alternative exits before the decision", "reasons": "invalid exit reason codes",
          "t3hold": "T3, plan exit SL/cutoff: hold != plan", "ladhold": "ladder, plan exit SL/cutoff, no more TP hits after decision: hold != plan",
          "be2": "BE exits at TP3 but != plan (plan must also reach TP3 unchanged)", "be3": "BE exits at cutoff but != plan", "hold3": "hold and plan both cutoff but different times",
          "dirs": "event direction set without its event bit"}
for k, v in cnt.items(): rep(f"A) {labels[k]}", v)
rep("B) unique trades whose FULL list of decision rows differs from tf_events + walk_exit plan exit (or n_dec wrong)", B_bad, f"({B_trades} trades, {B_rows} rows)")
rep("B) walk_exit (MT5-verified) plan from entry != r_std", Bw_bad)
rep("C) sampled rows where an alternative recomputed with adx_lib.walk_exit differs", C_bad, f"({C_rows} rows, worst R diff {C_worst:.1e})")
print("   C branch coverage: " + ", ".join(f"{k} {v}" for k, v in C_cov.items()), flush=True)
rep("C) branches never exercised in the sample", sum(1 for v in C_cov.values() if v == 0))

# ---------------- D) time travel at risky decision times
def one(sql, *p):
    r = db.execute(sql, p).fetchone(); return None if r is None else int(r[0])
dst_days = [BK.utc_ts(x) for x in ("2025-03-10", "2025-11-03", "2026-03-09")]
picks = {
    "TP2 already hit (M1)": one("SELECT d.dec_t FROM dec d JOIN utrades u USING(uid) WHERE d.n_tp_hit = 2 AND u.tf = 1 LIMIT 1 OFFSET 500"),
    "TP1 hit, M5": one("SELECT d.dec_t FROM dec d JOIN utrades u USING(uid) WHERE d.n_tp_hit = 1 AND u.tf = 5 LIMIT 1 OFFSET 300"),
    "<= 5 min before cutoff (M3)": one("SELECT d.dec_t FROM dec d JOIN utrades u USING(uid) WHERE d.min_to_cut <= 5 AND u.tf = 3 LIMIT 1 OFFSET 50"),
    "first decision of a session (M1, held <= 3 min after a session-opening entry)": one(
        "SELECT d.dec_t FROM dec d JOIN ctx_dec c USING(dec_t) WHERE c.d_today_bars <= 3 LIMIT 1 OFFSET 20"),
    "first hours of the week (Monday, <= 120 M1 bars of the session)": one(   # trading starts 23:00 server, >= 60 min after the week opens
        "SELECT d.dec_t FROM dec d JOIN ctx_dec c USING(dec_t) WHERE c.t_weekday = 0 AND c.d_today_bars <= 120 LIMIT 1 OFFSET 5"),
    "US DST switch day 2025-03-10": one("SELECT dec_t FROM dec WHERE dec_t BETWEEN ? AND ? LIMIT 1 OFFSET 200", dst_days[0], dst_days[0] + 86400),
    "US DST end 2025-11-03": one("SELECT dec_t FROM dec WHERE dec_t BETWEEN ? AND ? LIMIT 1 OFFSET 200", dst_days[1], dst_days[1] + 86400),
    "PDH break bar": one("SELECT dec_t FROM dec WHERE (flags & 128) != 0 LIMIT 1 OFFSET 700"),
    "Asia low break bar": one("SELECT dec_t FROM dec WHERE (flags & 4096) != 0 LIMIT 1 OFFSET 400"),
    "new day high after 60 min": one("SELECT dec_t FROM dec WHERE (flags & 512) != 0 LIMIT 1 OFFSET 3000"),
    "box break M5": one("SELECT d.dec_t FROM dec d JOIN utrades u USING(uid) WHERE (d.flags & 64) != 0 AND u.tf = 5 LIMIT 1 OFFSET 900"),
    "regime change M3": one("SELECT d.dec_t FROM dec d JOIN utrades u USING(uid) WHERE (d.flags & 32) != 0 AND u.tf = 3 LIMIT 1 OFFSET 2000"),
    "last sandbox week": one("SELECT MAX(dec_t) FROM dec"),
}
ctx_cols = [r[1] for r in db.execute("PRAGMA table_info(ctx_dec)")]
scol = ["n_tp_hit", "rem", "realized_r", "open_r", "mfe_r", "mae_r", "dist_sl_r", "dist_tp_r"]
import adx_build as AB
for name, D in picks.items():
    if D is None: rep(f"D) time travel [{name}]: no such decision found", 1); continue
    Mc = H.load_ctx_bars(cut=D); SLc = H.sessions_levels(Mc); nb = 0
    for tfv in H.TFS:
        cutv = H.tf_events(Mc, tfv, SLc); k = int(np.sum(cutv["B"]["end"] <= D)); full = EVT[tfv]
        nb += int(np.sum(cutv["flags"][:k] != full["flags"][:k])) + sum(int(np.sum(cutv["dirs"][x][:k] != full["dirs"][x][:k])) for x in full["dirs"])
    Mw = A.load_m1(BK.utc_ts(H.WARM_FROM) - 86400, D + 60)
    for x in ("h", "l", "c"): Mw[x][-1] = Mw["o"][-1]
    mkc = A.Market(Mw, AB.START_H, AB.CUTOFF_H, AB.NO_ENTRY_MIN); ns = 0
    for r in db.execute(f"SELECT uid, {','.join(scol)} FROM dec WHERE dec_t = ?", (D,)).fetchall():
        U = UT[r[0]]
        T = dict(e=int(np.searchsorted(Mw["t"], U[3])), dir=U[6], entry_px=U[7], sl_px=U[8], tp1_px=U[9], tp2_px=U[10], tp3_px=U[11], risk_px=U[12],
                 spread_entry=U[13], ladder=U[2] == "L")
        _, O = H.trade_rows(mkc, T, np.array([len(Mw["t"]) - 1]), COST, future=False); ns += 1
        if not O["ok"][0] or any(abs(float(O[c][0]) - float(v)) > 1e-12 for c, v in zip(scol, r[1:])): nb += 1
    C, Dd, dE, i1 = X.compute(np.array([D]), Mc, COST, CUT_H, log=lambda *a: None)
    ref = db.execute(f"SELECT {','.join(ctx_cols)} FROM ctx_dec WHERE dec_t = ?", (D,)).fetchone()
    for c_, v in zip(ctx_cols[3:], ref[3:]):
        x = C[c_][0][0]
        if (v is None) != (not np.isfinite(x)) or (v is not None and abs(x - v) > 1e-12): nb += 1
    rep(f"D) time travel [{name}] dec_t {D}: values changed when data after D removed", nb, f"({ns} trade rows)")

# ---------------- E) reproducibility
tmp = os.path.join(tempfile.gettempdir(), "hold_repro.sqlite")
if os.path.exists(tmp): os.remove(tmp)
env = dict(os.environ, HOLD_OUT=tmp, HOLD_MONTHS="2024-11,2026-05")
subprocess.run([sys.executable, "hold_build.py", "--fresh"], env=env, check=True, capture_output=True, cwd=os.path.dirname(os.path.abspath(__file__)))
r2 = sqlite3.connect(tmp)
A_ = r2.execute("SELECT * FROM dec ORDER BY uid, dec_t").fetchall()
ids = [r[0] for r in r2.execute("SELECT DISTINCT uid FROM dec")]
B_ = []
for k in range(0, len(ids), 900):
    B_ += db.execute(f"SELECT * FROM dec WHERE uid IN ({','.join(map(str, ids[k:k + 900]))})").fetchall()
B_.sort(key=lambda r: (r[0], r[1]))
rep("E) rebuilt months 2024-11 + 2026-05: dec rows not identical to the full file", int(A_ != B_), f"({len(A_)} rows)")
c2 = r2.execute("SELECT * FROM ctx_dec ORDER BY dec_t").fetchall()
tt = [r[0] for r in c2]; c1 = []
for k in range(0, len(tt), 900): c1 += db.execute(f"SELECT * FROM ctx_dec WHERE dec_t IN ({','.join(map(str, tt[k:k + 900]))}) ORDER BY dec_t").fetchall()
rep("E) rebuilt ctx_dec rows not identical", int(c1 != c2), f"({len(c2)} rows)")
r2.close(); os.remove(tmp)

# ---------------- G) descriptive per half (no outcome)
print("G) per half of the sandbox (trading day < / >= 2025-05-08) — descriptive only:")
for h in (0, 1):
    g = G[h]; hm = np.concatenate(g["held"]); orr = np.concatenate(g["openr"])
    print(f"   half {h}: trades {g['trades']}, rows {g['rows']} ({g['rows'] / max(g['trades'], 1):.1f}/trade), median held {np.median(hm):.0f} min, "
          f"open_r p10/p50/p90 {np.percentile(orr, 10):.2f}/{np.median(orr):.2f}/{np.percentile(orr, 90):.2f}")
    print("      share of rows with bit: " + ", ".join(f"{n} {g['bits'][i] / g['rows'] * 100:.1f}%" for i, n in enumerate(H.EV)))
print(f"{'ALL OK' if bad_total == 0 else str(bad_total) + ' CHECK(S) FAILED'}  ({time.time() - T0:.0f}s)")
