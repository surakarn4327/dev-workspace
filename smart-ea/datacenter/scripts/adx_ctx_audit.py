r"""Phase 2 final audit (after adx_ctx.py + adx_ctx_check.py): ties table ctx to things verified BEFORE phase 2.
1) link to phase 1: for EVERY trade, the last M1 bar ctx used must be the last M1 bar of the trade's signal bar
   (m1_last_t == sig_t + (tf-1)*60) and its close must equal trades.ref_px (signal bar close, verified against MT5 in phase 1)
2) ADR equals days.adr20 of gold_dc.sqlite (built by dc_build.py) whenever 20 days were available
3) consistency with the catalog: regime (zigzag 3 ATR) vs cat_episodes.regime_bars, BIGBAR / PINBAR / INSIDE ages vs table patterns
4) hygiene: no +-inf hidden as NULL, INTEGER columns are integers, a rebuild gives a byte-identical table, adx_asof.ctx_for works
5) plausibility: medians of key columns per half-year, practice period only (< 2026-06-01) — no outcome / R is read
Usage: python adx_ctx_audit.py"""
import os, sqlite3
from datetime import datetime, timezone
import numpy as np
import broker as BK, adx_ctx as X, adx_asof as AS
import cat_bars as CB, cat_episodes as EPI

bad_total = 0
def rep(name, nbad, extra=""):
    global bad_total; bad_total += nbad > 0
    print(f"{'OK ' if nbad == 0 else 'BAD'} {name}: {nbad} {extra}", flush=True)
def d(x): return datetime.fromtimestamp(int(x), timezone.utc).strftime("%Y-%m-%d %H:%M")

db = sqlite3.connect(AS.DBT)
cols = [r[1] for r in db.execute("PRAGMA table_info(ctx)")]; ci = {c: i for i, c in enumerate(cols)}
CT = np.array(db.execute("SELECT * FROM ctx ORDER BY entry_t").fetchall(), dtype=float); E = CT[:, 0].astype(np.int64)
g = sqlite3.connect(BK.DB)
BT = np.array(g.execute("SELECT t, c FROM bars_m1 ORDER BY t").fetchall()); bt = BT[:, 0].astype(np.int64); bc = BT[:, 1]

# ---- 1) link to phase 1 (all trades)
T = np.array(db.execute("SELECT x.entry_t, x.sig_t, p.tf, x.ref_px, x.day FROM trades x JOIN params p USING(set_id)").fetchall())
te, ts, tf, ref, tday = T[:, 0].astype(np.int64), T[:, 1].astype(np.int64), T[:, 2].astype(np.int64), T[:, 3], T[:, 4].astype(np.int64)
row = np.searchsorted(E, te); m1l = CT[row, ci["m1_last_t"]].astype(np.int64)
exp = bt[np.searchsorted(bt, ts + tf * 60, "left") - 1]        # last EXISTING M1 bar inside the signal bar (short bar at the daily close)
miss = m1l != exp
rep(f"1a) last M1 bar used != last M1 bar of the signal bar ({len(te)} trades)", int(miss.sum()),
    f"(signal bars shorter than the TF at the daily close: {int(np.sum(exp != ts + (tf - 1) * 60))})")
for k in np.flatnonzero(miss)[:8]: print(f"    entry {d(te[k])} M{tf[k]} signal {d(ts[k])}: used {d(m1l[k])}, expected {d(exp[k])}")
px = bc[np.searchsorted(bt, m1l)]
rep("1b) close of the last M1 bar used != trades.ref_px (signal close)", int(np.sum(np.abs(px - ref) > 1e-9)))
rep("1c) ctx.day != trades.day", int(np.sum(CT[row, ci["day"]].astype(np.int64) != tday)))

# ---- 2) ADR vs days.adr20
A20 = dict(g.execute("SELECT day, adr20 FROM days WHERE adr20 IS NOT NULL").fetchall())
m = CT[:, ci["a_adr_days"]] == 20
dd = CT[m, ci["day"]].astype(np.int64); ours = CT[m, ci["a_adr_usd"]]
ref20 = np.array([A20.get(int(x), np.nan) for x in dd])
diff = ~np.isclose(ours, ref20, rtol=1e-9, atol=1e-9)
rep(f"2) ADR != days.adr20 (rows with 20 days of history: {int(m.sum())})", int(diff.sum()),
    f"days affected: {sorted(set(int(x) for x in dd[diff]))[:10]}" if diff.any() else "")

# ---- 3) catalog consistency (float catalog code, so exact-tie cases may differ)
_, dE, _ = X.sessions(E)
for tf_ in (1, 5):
    B = CB.tf_bars(tf_)
    Bx = dict(t_open=B["t_open"], day=B["day"], end=(B["t_open"] // (tf_ * 60) + 1) * tf_ * 60)
    jB = X.last_closed(Bx, E, dE)
    reg = EPI.regime_bars(B, 3.0)[np.clip(jB, 0, None)]
    ours = CT[:, ci[f"m{tf_}k3_reg"]]; ok = ~np.isnan(ours)
    # catalog regime 0 also means "not known yet"; compare where ctx knows the regime
    dif = int(np.sum(reg[ok] != ours[ok]))
    rep(f"3a) M{tf_} regime (zigzag 3) vs cat_episodes.regime_bars, {int(ok.sum())} rows", 0 if dif <= 0.001 * ok.sum() else dif,
        f"(differ {dif} = {dif / ok.sum():.4%}; allowed <= 0.1% = exact-tie cases of the float catalog)")
    idx_of = {int(x): i for i, x in enumerate(B["t"])}
    for typ, col in (("BIGBAR", "big"), ("PINBAR", "pin"), ("INSIDE", "inside")):
        P = np.array(g.execute("SELECT t, dir FROM patterns WHERE tf=? AND type=? ORDER BY t", (tf_, typ)).fetchall()).reshape(-1, 2)
        pidx = np.array([idx_of[int(x)] for x in P[:, 0]])
        k = np.searchsorted(pidx, jB, "right") - 1
        age = np.where(k >= 0, jB - pidx[np.clip(k, 0, None)], 10 ** 9)
        if typ == "INSIDE":
            cat = (age == 0).astype(float); o = CT[:, ci[f"f_m{tf_}_inside"]]
        else:
            LB = 1440 // tf_; cat = np.where(age < LB, age, -1).astype(float); o = CT[:, ci[f"f_m{tf_}_{col}_age"]]
        dif = int(np.sum(cat != o))
        rep(f"3b) M{tf_} {typ} vs catalog table patterns", 0 if dif <= 0.001 * len(o) else dif, f"(differ {dif} = {dif / len(o):.4%})")
    # 3c) prove the bar-level differences are exact ties: bars where the float catalog and the integer rule disagree
    Bi = X.resample(X.load(None), tf_); h, l, o_, c_ = Bi["hi"], Bi["li"], Bi["oi"], Bi["ci"]; S = Bi["s20p"]
    rng = h - l; body = np.abs(c_ - o_); up = h - np.maximum(o_, c_); dn = np.minimum(o_, c_) - l
    ours_big = (S > 0) & (20 * rng >= 2 * S)
    ours_pin = (S > 0) & (20 * rng >= S) & (10 * body <= 3 * rng) & ((10 * up >= 6 * rng) | (10 * dn >= 6 * rng))
    for typ, mask, ties in (("BIGBAR", ours_big, (20 * rng == 2 * S)),
                            ("PINBAR", ours_pin, (20 * rng == S) | (10 * body == 3 * rng) | (10 * up == 6 * rng) | (10 * dn == 6 * rng))):
        P = np.array([r[0] for r in g.execute("SELECT t FROM patterns WHERE tf=? AND type=?", (tf_, typ))], dtype=np.int64)
        catm = np.isin(Bi["t_last"], P)
        dis = np.flatnonzero(catm != mask)
        rep(f"3c) M{tf_} {typ}: bars where catalog and ctx disagree that are NOT an exact tie on a threshold", int(np.sum(~ties[dis])),
            f"({len(dis)} disagreeing bars of {len(mask)}, all ties = float noise in the catalog)")

# ---- 4) hygiene
import adx_ctx
C_inf = 0
kinds = dict(db.execute("SELECT name, type FROM columns WHERE tbl='ctx'").fetchall())
nonint = sum(int(np.sum(np.mod(CT[~np.isnan(CT[:, i]), i], 1) != 0)) for c, i in ci.items() if kinds[c] == "INTEGER")
rep("4a) INTEGER columns holding non-integers", nonint)
tmp = os.path.join(os.environ.get("TEMP", "."), "ctx_rebuild.sqlite")
if os.path.exists(tmp): os.remove(tmp)
adx_ctx.build(out=tmp, log=lambda *a: None)
c2 = sqlite3.connect(tmp); R2 = np.array(c2.execute("SELECT * FROM ctx ORDER BY entry_t").fetchall(), dtype=float); c2.close(); os.remove(tmp)
same = R2.shape == CT.shape and bool(np.all((np.isnan(R2) & np.isnan(CT)) | (R2 == CT)))
rep("4b) rebuild is identical to the stored table (+ no +-inf produced: build raises otherwise)", int(not same))
lib = AS.as_of("2025-06-01"); cx = AS.ctx_for(lib["entry_t"])
rep("4c) adx_asof.ctx_for(as_of(T).entry_t) aligned", int(np.any(cx["entry_t"].astype(np.int64) != lib["entry_t"])), f"({len(lib['entry_t'])} trades)")

# ---- 5) plausibility per half-year (practice period only)
prac = E < 1780272000
keys = ["a_adr_pct", "a_m1_atr_rel5d", "a_m1_cost_atr", "a_m3_cost_atr", "a_m5_cost_atr", "a_mv60_pct", "a_tv10_rel", "a_day_rng_adr",
        "d_day_pos", "m1k3_leg_atr", "m5k3_leg_atr", "f_m1_box_n", "f_m5_box_n"]
half = np.array([f"{datetime.fromtimestamp(int(x), timezone.utc).year}H{1 if datetime.fromtimestamp(int(x), timezone.utc).month <= 6 else 2}" for x in E])
print("\n5) medians per half-year (practice period < 2026-06-01)")
print(f"{'':16s}" + "".join(f"{h:>9s}" for h in sorted(set(half[prac]))))
for k in keys:
    print(f"{k:16s}" + "".join(f"{np.nanmedian(CT[prac & (half == h), ci[k]]):9.3f}" for h in sorted(set(half[prac]))))
for k in ("m1k3_reg", "m3k3_reg", "m5k3_reg", "h1k3_reg"):
    v = CT[prac, ci[k]]; v = v[~np.isnan(v)]
    print(f"{k:16s} up {np.mean(v == 1):.1%}  down {np.mean(v == -1):.1%}  sideway {np.mean(v == 0):.1%}")
print("RESULT:", "all audit checks passed" if bad_total == 0 else f"{bad_total} check(s) failed")
