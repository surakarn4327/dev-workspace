r"""Phase 3 audit (user 2026-09-29: "check phase 3 before phase 4, or it falls like dominoes"). Independent checks of everything the
phase 3 conclusions rest on:
 A scope: no trade / ctx row / synthetic bar from the exam period (>= 2026-06-01) in anything phase 3 read
 B random-direction markets really are synthetic: trades were simulated on the flipped bars (entry prices match synthetic bars, not real)
 C day-swap null mechanics: identity swap reproduces every real t exactly; a random swap takes ctx from the permuted day, same half,
   nearest minute, and leaves each trade's own outcome/direction untouched
 D power: smallest effect each pattern could have detected (3 x SE) -> what "found nothing" actually rules out
 E hidden opposite effects: a pattern could help one kind of set and hurt another and average to ~0. Lift per exit family
   (SL 4/8/12 x ladder/TP3) -> heterogeneity statistic Q, compared with the same Q under the day-swap null (Q is not chi2: families
   share days and entries)
 F the two passers: gate values exactly, SE clustered by WEEK instead of day, without the 1 % largest trades, per year-quarter
Usage: python p3_audit.py [--fast] [n_perm_for_E=1000] [workers=7]   (--fast = skip E)"""
import os, sys, glob, sqlite3, pickle, time
import numpy as np
from multiprocessing import Pool
import p3lib as L, adx_asof, p3_perm, broker as BK

HERE = os.path.dirname(adx_asof.DBT)
FAMS = [(sl, ex) for sl in (4.0, 8.0, 12.0) for ex in ("L", "T3")]

def fam_of(dbt):
    db = sqlite3.connect(dbt); return {s: FAMS.index((sl, ex)) for s, sl, ex in db.execute("SELECT set_id, sl_atr, exit_mode FROM params")}

def q_stats(T, X, fam):
    """Q per pattern (primary definitions): sum over families of ((lift_f - weighted mean) / se_f)^2"""
    out = []; F = np.array([fam[s] for s in T["set_id"]])
    for g in L.TFS:
        G = L.group_arrays(T, g); Fg = F[G["m"]]
        for sp in L.specs(g):
            for ln, pm, _ in L.pattern_masks(T, X, g, sp, prim_only=True):
                ls, ss = [], []
                for f in range(len(FAMS)):
                    mu, se, t, n = L.cstat(G["e"], pm & (Fg == f), G["di"], G["nd"])
                    if n >= 200 and se > 0: ls.append(mu); ss.append(se)
                ls, ss = np.array(ls), np.array(ss)
                if len(ls) < 2: out.append(np.nan); continue
                w = 1 / ss ** 2; m = np.sum(w * ls) / w.sum(); out.append(float(np.sum(((ls - m) / ss) ** 2)))
    return np.array(out)

class _Spy(dict):
    """records which ctx columns a pattern function reads"""
    def __init__(self, used, X): super().__init__(X); self.used = used
    def __getitem__(self, k): self.used.add(k); return dict.__getitem__(self, k)

FAST = "--fast" in sys.argv
if FAST: sys.argv.remove("--fast")

_T = _X = _E = None
def _init():
    global _T, _X, _E
    import p3fast
    _T, _X = L.load(adx_asof.DBT); _E = p3fast.Fast(_T, _X, fam_of(adx_asof.DBT))

def _perm_q(seed):
    # fast engine: identical to q_stats on swapped rows (p3_fast_check.py)
    return _E.q_all(p3_perm.swapped_ci(_T, _X, seed))

def main():
    nperm = int(sys.argv[1]) if len(sys.argv) > 1 else 1000; w = int(sys.argv[2]) if len(sys.argv) > 2 else 7
    t0 = time.time(); bad = 0
    def ok(cond, msg):
        nonlocal bad; bad += not cond; print(("OK   " if cond else "FAIL ") + msg, flush=True)
    real = pickle.load(open(os.path.join(HERE, "p3_real.pkl"), "rb"))["res"]
    keys = [(r["tf"], r["feat"], r["level"]) for r in real]
    T, X = L.load(adx_asof.DBT)
    # ---------------- A scope
    print("== A scope")
    ok(T["entry_t"].max() < L.SANDBOX_END and X["entry_t"].max() < L.SANDBOX_END, "real: every trade and ctx row read has entry < 2026-06-01")
    db = sqlite3.connect(adx_asof.DBT)
    mx = db.execute("SELECT MAX(exit_t) FROM trades WHERE entry_t >= ? AND exit_t + 60 <= ?", (L.LIB_FROM, L.SANDBOX_END)).fetchone()[0]
    ok(mx + 60 <= L.SANDBOX_END, f"real: last exit used {time.strftime('%Y-%m-%d %H:%M', time.gmtime(mx))} UTC (closed before the exam)")
    for d in sorted(glob.glob(os.path.join(HERE, "p3_null", "sf*"))):
        z = np.load(os.path.join(d, "bars.npz")); s = sqlite3.connect(os.path.join(d, "gold_dc.sqlite")); a = sqlite3.connect(os.path.join(d, "adx_trades.sqlite"))
        lb = max(BK.server_to_utc(z["t"][-1:])[0], s.execute("SELECT MAX(t) FROM bars_m1").fetchone()[0])
        le = max(a.execute("SELECT MAX(exit_t) FROM trades").fetchone()[0], a.execute("SELECT MAX(entry_t) FROM ctx").fetchone()[0])
        ok(lb < L.SANDBOX_END and le < L.SANDBOX_END, f"{os.path.basename(d)}: synthetic bars/trades/ctx all before 2026-06-01")
    # ---------------- B synthetic markets are really synthetic
    print("== B random-direction markets")
    rz = np.load(BK.BARS); rt = BK.server_to_utc(rz["t"])
    for d in sorted(glob.glob(os.path.join(HERE, "p3_null", "sf*"))):
        z = np.load(os.path.join(d, "bars.npz")); st = BK.server_to_utc(z["t"])
        a = sqlite3.connect(os.path.join(d, "adx_trades.sqlite"))
        E = np.array(a.execute("SELECT entry_t, entry_px, spread_entry, dir FROM trades WHERE set_id = 1").fetchall())
        i = np.searchsorted(st, E[:, 0].astype(np.int64)); j = np.searchsorted(rt, E[:, 0].astype(np.int64))
        bid = np.where(E[:, 3] > 0, E[:, 1] - E[:, 2], E[:, 1])
        syn = np.mean(np.abs(bid - z["o"][i]) < 1e-6); rea = np.mean(np.abs(bid - rz["o"][j]) < 1e-6)
        same_rng = np.allclose(z["h"] - z["l"], rz["h"][np.isin(rt, st)] - rz["l"][np.isin(rt, st)], atol=2e-3)
        up = np.mean(np.sign(z["c"] - z["o"]) == np.sign(rz["c"][np.isin(rt, st)] - rz["o"][np.isin(rt, st)]))
        ok(syn > 0.999 and rea < 0.05 and same_rng and 0.45 < up < 0.60,
           f"{os.path.basename(d)}: entries at synthetic open {syn:.3f} / at real open {rea:.3f}; bar ranges = real {same_rng}; bar direction agrees with real {up:.3f} (~0.5 + dojis)")
    # ---------------- C day-swap mechanics
    print("== C day-swap null")
    Ti = dict(T); res_id = []
    for g in L.TFS:
        G = L.group_arrays(Ti, g)
        for sp in L.specs(g):
            for ln, pm, _ in L.pattern_masks(Ti, X, g, sp, prim_only=True): res_id.append(L.cstat(G["e"], pm, G["di"], G["nd"])[2])
    ok(np.allclose(res_id, [r["t"] for r in real], atol=1e-9), "no swap (identity) reproduces all 549 real t exactly")
    rng = np.random.default_rng(7); g = 1; m = T["tf"] == g; ci2 = p3_perm.swap_ci(T, X, g, rng)
    dday = X["day"][ci2[m]]; oday = T["day"][m]; dmo = X["t_min_open"][ci2[m]]; omo = X["t_min_open"][T["ci"][m]]
    dh = (X["day"][ci2[m]] >= L.HALF_DAY); oh = T["half"][m] == 1
    pairs = {}
    for a_, b_ in zip(oday, dday): pairs.setdefault(a_, set()).add(b_)
    ok(all(len(v) == 1 for v in pairs.values()), "every day's trades all take ctx from ONE other day (a permutation of days)")
    ok(np.all(dh == oh), "donor day is always in the same half")
    ok(np.mean(dday != oday) > 0.99, f"donor day differs from own day for {np.mean(dday != oday):.3f} of trades")
    ok(np.median(np.abs(dmo - omo)) <= 10, f"minute-of-day distance to donor entry: median {np.median(np.abs(dmo - omo)):.0f}, 90% {np.percentile(np.abs(dmo - omo), 90):.0f} min")
    # ---------------- D power
    print("== D power (smallest lift detectable at |t| = 3)")
    for g in L.TFS:
        se = np.array([r["se"] for r in real if r["tf"] == g and r["share"] >= 0.1])
        print(f"   M{g}: patterns with >= 10% of trades: median 3xSE {3 * np.median(se):.3f}R (10-90% {3 * np.percentile(se, 10):.3f}-{3 * np.percentile(se, 90):.3f})")
        sdr = np.std(T["r"][T["tf"] == g]); print(f"         spread of one trade (SD of r_std) {sdr:.2f}R")
    # ---------------- F passers
    print("== F the two passers")
    for key in [(1, "C_daypos", "Q1 (0-20%)"), (1, "C_pdc", "Q1 (0-20%)")]:
        r = real[keys.index(key)]
        print(f"   {key}: t {r['t']:+.3f} h1 {r['h1_t']:+.3f} h2 {r['h2_t']:+.3f} buy {r['buy_t']:+.3f} sell {r['sell_t']:+.3f} var {np.round(r['var_t'], 3).tolist()} sets {r['sets_same']:.3f}")
        g = key[0]; G = L.group_arrays(T, g)
        sp = [s for s in L.specs(g) if s["name"] == key[1]][0]
        pm = [p for ln, p, _ in L.pattern_masks(T, X, g, sp, prim_only=True) if ln == key[2]][0]
        wk = (G["day"] + 3) // 7; uw, wi = np.unique(wk, return_inverse=True)
        mu, se, t, n = L.cstat(G["e"], pm, wi, len(uw)); print(f"      SE clustered by week: lift {mu:+.3f} t {t:+.2f}")
        cut = np.percentile(np.abs(G["e"]), 99); keep = np.abs(G["e"]) <= cut
        mu2, se2, t2, _ = L.cstat(G["e"], pm & keep, G["di"], G["nd"]); print(f"      without the 1% largest |residual| trades: lift {mu2:+.3f} t {t2:+.2f}")
        ds = np.bincount(G["di"][pm], G["e"][pm], minlength=G["nd"]); top = np.argsort(ds)[:10]
        k2 = pm & ~np.isin(G["di"], top); mu3, _, t3, _ = L.cstat(G["e"], k2, G["di"], G["nd"]); print(f"      without its 10 worst days: lift {mu3:+.3f} t {t3:+.2f}")
        qt = [time.strftime("%Y", time.gmtime(int(x))) + "Q" + str((int(time.strftime("%m", time.gmtime(int(x)))) - 1) // 3 + 1) for x in G["entry"]]
        qt = np.array(qt); line = []
        for q in sorted(set(qt)):
            mq, _, tq, nq = L.cstat(G["e"], pm & (qt == q), G["di"], G["nd"]); line.append(f"{q} {mq:+.2f}")
        print("      per quarter: " + ", ".join(line) + f"  (negative {sum(float(x.split()[1]) < 0 for x in line)}/{len(line)})")
    # ---------------- G definitions: missing values, level coverage, percentile band sizes
    print("== G pattern definitions")
    used = set()
    for g in L.TFS:
        for sp in L.specs(g):
            try: sp["fn"](_Spy(used, X), np.ones(len(X["entry_t"])), sp["variants"][0] if sp["kind"] == "cat" else 3)
            except Exception: pass
    for g in L.TFS:
        m = T["tf"] == g; ci = T["ci"][m]
        nanc = {c: float(np.mean(~np.isfinite(X[c][ci]))) for c in sorted(used) if c in X}
        big = {c: round(v, 4) for c, v in nanc.items() if v > 0}
        print(f"   M{g}: columns with missing values among its trades: {big if big else 'none'}")
        for sp in L.specs(g):
            pms = L.pattern_masks(T, X, g, sp)
            cov = np.zeros(int(m.sum()), int)
            for ln, pm, _ in pms: cov += pm.astype(int)
            if cov.max() > 1: ok(False, f"M{g} {sp['name']}: a trade is in two levels at once")
            excl = np.mean(cov == 0)
            if sp["kind"] == "q":
                h1 = T["half"][m] == 0
                sh = [np.mean(pm[h1]) / max(np.mean(cov[h1] > 0), 1e-9) for _, pm, _ in pms]
                if min(sh) < 0.15 or max(sh) > 0.25: print(f"   note M{g} {sp['name']}: first-half band shares {np.round(sh, 3).tolist()} (ties at the cut points)")
            if excl > 0.02: print(f"   note M{g} {sp['name']}: {excl:.3f} of trades in no level (missing value / excluded)")
    ok(True, "level coverage checked (no trade in two levels unless reported above)")
    if FAST: print(f"\n{'ALL CHECKS OK' if bad == 0 else f'{bad} CHECK(S) FAILED'} (fast mode, E skipped) ({time.time() - t0:.0f}s)"); return
    # ---------------- E heterogeneity across exit families
    print("== E opposite effects hidden inside the average (exit families SL 4/8/12 x L/T3)")
    fam = fam_of(adx_asof.DBT); Qr = q_stats(T, X, fam)
    with Pool(w, initializer=_init) as P: Qn = np.vstack(list(P.imap(_perm_q, range(5000, 5000 + nperm))))
    pq = np.array([(1 + np.sum(Qn[:, i] >= Qr[i])) / (nperm + 1) if np.isfinite(Qr[i]) else np.nan for i in range(len(Qr))])
    fw = np.nanmax(Qn, axis=1)
    print(f"   Q real: median {np.nanmedian(Qr):.1f}, null median {np.nanmedian(Qn):.1f}; patterns with p <= {1/(nperm+1):.3f} (above every null): "
          f"{int(np.nansum(pq <= 1 / (nperm + 1)))} of {len(Qr)} (expected by chance ~{len(Qr) / (nperm + 1):.0f}); "
          f"real max Q {np.nanmax(Qr):.1f} vs null max Q per perm median {np.median(fw):.1f}, max {fw.max():.1f}")
    hot = [i for i in np.argsort(-Qr) if np.isfinite(Qr[i])][:12]
    F = np.array([fam[s] for s in T["set_id"]])
    for i in hot:
        g, fe, lv = keys[i]; G = L.group_arrays(T, g); Fg = F[G["m"]]
        sp = [s for s in L.specs(g) if s["name"] == fe][0]
        pm = [p for ln, p, _ in L.pattern_masks(T, X, g, sp, prim_only=True) if ln == lv][0]
        fl = [L.cstat(G["e"], pm & (Fg == f), G["di"], G["nd"]) for f in range(len(FAMS))]
        print(f"   M{g} {fe} {lv[:26]:26s} Q {Qr[i]:5.1f} p {pq[i]:.3f} null-max-share {np.mean(fw >= Qr[i]):.2f} | " +
              " ".join(f"SL{int(FAMS[f][0])}{FAMS[f][1]} {fl[f][0]:+.2f}({fl[f][2]:+.1f})" for f in range(len(FAMS))))
    pickle.dump(dict(Qr=Qr, Qn=Qn, keys=keys), open(os.path.join(HERE, "p3_audit.pkl"), "wb"))
    print(f"\n{'ALL CHECKS OK' if bad == 0 else f'{bad} CHECK(S) FAILED'} ({time.time() - t0:.0f}s)")

if __name__ == "__main__":
    main()
