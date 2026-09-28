"""Task 2 report (reads cat_eptime_k{2,3,4}.pkl).
Part 1 (k=3): per TF and group -> episodes/day by direction, UP share, anatomy of UP / DOWN / sign-flip.
Part 2 (k=2,3,4): tests with bootstrap SE
  ASYM  inside a group: UP - DOWN (null expectation 0 by symmetry)
  GROUP for one direction: [real(group) - real(rest)] - [null(group) - null(rest)]  -> is the change with time/vol more than volatility alone gives?"""
import pickle, numpy as np
rng = np.random.default_rng(5)
TFS = (1, 5, 15, 60)
def nm(tf): return f"M{tf}" if tf < 60 else f"H{tf // 60}"
GROUPS = [("asia", lambda e: e["phase"] == "asia"), ("london", lambda e: e["phase"] == "london"), ("newyork", lambda e: e["phase"] == "newyork"),
          ("late", lambda e: e["phase"] == "late"), ("news0830", lambda e: e["news"]), ("vol low", lambda e: e["volq"] == 0),
          ("vol mid", lambda e: e["volq"] == 1), ("vol high", lambda e: e["volq"] == 2)]
HOURS = {"asia": 10, "london": 5, "newyork": 5, "late": 4}
MET = {"depth1": lambda E: np.median([e["depths"][0] for e in E if e["depths"]]) if any(e["depths"] for e in E) else np.nan,
       "imp2/1": lambda E: np.median([e["imps"][1] / e["imps"][0] for e in E if len(e["imps"]) > 1]) if any(len(e["imps"]) > 1 for e in E) else np.nan,
       "minutes": lambda E: 2 ** np.median(np.log2([max(e["minutes"], 1) for e in E])),
       "moveATR": lambda E: np.median([e["move_atr"] for e in E]),
       "lastShorter": lambda E: np.mean([e["last_shorter"] for e in E if len(e["imps"]) > 1]) if any(len(e["imps"]) > 1 for e in E) else np.nan,
       "endFailed": lambda E: np.mean([e["end_failed"] for e in E])}
LOGM = {"minutes"}
COL = {"depth1": lambda e: e["depths"][0] if e["depths"] else np.nan, "imp2/1": lambda e: e["imps"][1] / e["imps"][0] if len(e["imps"]) > 1 else np.nan,
       "minutes": lambda e: np.log2(max(e["minutes"], 1)), "moveATR": lambda e: e["move_atr"],
       "lastShorter": lambda e: float(e["last_shorter"]) if len(e["imps"]) > 1 else np.nan, "endFailed": lambda e: float(e["end_failed"])}
AGG = {m: (np.nanmean if m in ("lastShorter", "endFailed") else np.nanmedian) for m in COL}
def arr(m, E): return np.array([COL[m](e) for e in E])
def val(m, E): return AGG[m](arr(m, E))                    # minutes -> log2 scale
def boot(m, E, reps=100):
    a = arr(m, E); a = a[np.isfinite(a)]
    if len(a) < 5: return np.nan
    ix = rng.integers(0, len(a), (reps, len(a))); f = np.mean if m in ("lastShorter", "endFailed") else np.median
    return np.std(f(a[ix], axis=1))
import cat_bars as CB
ND = len(CB.full_list())
EP = {K: pickle.load(open(f"cat_eptime_k{K}.pkl", "rb")) for K in (2, 3, 4)}
# ---------- part 1
R = EP[3]
for tf in TFS:
    real = R["real"][tf]; nul = [e for s in range(3) for e in R[f"flip{s}"][tf]]
    print(f"\n=== {nm(tf)} (k=3)  real {len(real)} episodes, null {len(nul) // 3}/copy")
    print(f"  {'group':9s}| {'ep/day UP':>9s} {'DN':>5s} {'rnd':>5s} | {'UP%':>5s} | " + " | ".join(f"{m:>18s}" for m in MET))
    print(f"  {'':9s}| {'':21s} | {'':5s} | " + " | ".join(f"{'UP':>5s} {'DN':>5s} {'rnd':>5s}" for m in MET))
    for g, f in [("all", lambda e: True)] + GROUPS:
        U = [e for e in real if f(e) and e["dir"] > 0]; D = [e for e in real if f(e) and e["dir"] < 0]; N = [e for e in nul if f(e)]
        if min(len(U), len(D)) < 15: continue
        up = len(U) / (len(U) + len(D))
        cells = []
        for m in MET:
            fm = "{:5.0f}" if m == "minutes" else ("{:5.0%}" if m in ("lastShorter", "endFailed") else "{:5.2f}")
            cells.append(" ".join(fm.format(MET[m](X)) for X in (U, D, N)))
        print(f"  {g:9s}| {len(U) / ND:9.2f} {len(D) / ND:5.2f} {len(N) / 6 / ND:5.2f} | {up:5.1%} | " + " | ".join(cells))
    hr = {g: (sum(1 for e in real if e["phase"] == g) / ND / HOURS[g], sum(1 for e in nul if e["phase"] == g) / 3 / ND / HOURS[g]) for g in HOURS}
    print("  episodes per hour of phase (real | null): " + ", ".join(f"{g} {a:.2f}|{b:.2f}" for g, (a, b) in hr.items()))
# ---------- part 2
ROWS = []
for K in (2, 3, 4):
    for tf in TFS:
        real = EP[K]["real"][tf]; nul = [e for s in range(3) for e in EP[K][f"flip{s}"][tf]]
        for g, f in GROUPS:
            for m in ("depth1", "imp2/1", "minutes", "lastShorter", "endFailed", "moveATR"):
                U = [e for e in real if f(e) and e["dir"] > 0]; D = [e for e in real if f(e) and e["dir"] < 0]
                if min(len(U), len(D)) < 30: continue
                d = val(m, U) - val(m, D); se = np.hypot(boot(m, U), boot(m, D))
                ROWS.append(("ASYM", K, nm(tf), g, "UP-DN", m, d, d / se, len(U), len(D)))
                Ng = [e for e in nul if f(e)]; Nr = [e for e in nul if not f(e)]; nd = val(m, Ng) - val(m, Nr); nse = np.hypot(boot(m, Ng), boot(m, Nr))
                for dn, X in (("UP", U), ("DN", D)):
                    Xr = [e for e in real if not f(e) and np.sign(e["dir"]) == np.sign(X[0]["dir"])]
                    rd = val(m, X) - val(m, Xr); se2 = np.hypot(np.hypot(boot(m, X), boot(m, Xr)), nse)
                    ROWS.append(("GROUP", K, nm(tf), g, dn, m, rd - nd, (rd - nd) / se2, len(X), len(Xr), rd, nd))
    print(f"k={K} tests done", flush=True)
pickle.dump(ROWS, open("cat_eptime_tests.pkl", "wb"))
for kind in ("ASYM", "GROUP"):
    rows = [r for r in ROWS if r[0] == kind]; Z = np.array([r[7] for r in rows])
    print(f"\n##### {kind}: {len(rows)} cells, |z|>=2 {np.sum(np.abs(Z) >= 2)} (chance ~{0.046 * len(rows):.0f}), |z|>=3 {np.sum(np.abs(Z) >= 3)}")
    keys = sorted({r[2:6] for r in rows})
    for key in keys:
        rr = {r[1]: r for r in rows if r[2:6] == key}
        zs = [rr[K][7] for K in (2, 3, 4) if K in rr]
        if len(zs) == 3 and (min(zs) >= 2 or max(zs) <= -2):
            print(f"  {key[0]:3s} {key[1]:9s} {key[2]:5s} {key[3]:11s} " + "  ".join(
                f"k{K}: {rr[K][6]:+.3f} z{rr[K][7]:+.1f}" + (f" (real {rr[K][10]:+.3f} null {rr[K][11]:+.3f})" if kind == "GROUP" else "") for K in (2, 3, 4)))
