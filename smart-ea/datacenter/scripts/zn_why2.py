r"""Step 2, small-TF version (user 2026-09-30: "look from inside the small TF"). Reversals are sized in ATR of each traded TF instead of
fixed dollars: zigzag on the M1 4-point path with threshold k x ATR20 of TF (known at that bar), TF = M1 / M3 / M5, k = 2 / 3 / 5 / 8.
Zones now also come from the small TF itself (zn_lib: FVG / order block / demand-supply / EMA / Bollinger / Keltner on M1 and M3, swings in
ATR of M1 / M3 / M5 with short lifetimes) next to the M5 / M15 / H1 / day / week zones.
"Near" = within 0.3 x ATR of the event's TF (so the tolerance shrinks with the TF and the market's speed); quality band = 0.15 ATR.
Compared with the same events in 3 random-direction markets. Sets with more than 25,000 events are sampled (25,000, fixed seed).
Output: zn\zn_why2.txt (per event set: top / bottom zone types by z) + zn\zn_why2_matrix.csv (every type x set: shares, lift, z)
        + zn\zn_why2_<market>.npz"""
import sys, os, time, csv, calendar, datetime
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, po_lib as PO, zn_lib as ZL
OUT = r"C:\trade datacenter\zn"; FROM = calendar.timegm(datetime.datetime(2024, 5, 13).timetuple())
SETS = [(tf, k) for tf in (1, 3, 5) for k in (2, 3, 5, 8)]; MK = ["real", "sf1", "sf2", "sf3"]; CAP = 25000; TOLK = 0.3

def run(mkt):
    f = os.path.join(OUT, f"zn_why2_{mkt}.npz")
    if os.path.exists(f): return dict(np.load(f))
    t0 = time.time(); M = PO.load_market(mkt); Z = ZL.Zones(M); i0 = np.searchsorted(M["t"], FROM)
    print(mkt, "zones built", f"{time.time() - t0:.0f}s", flush=True); res = {}
    for tf, k in SETS:
        A = Z.atr_tf[tf]; idx, p, kd, conf = ZL.zigzag_path(M, k * A); m = np.flatnonzero((idx >= i0) & np.isfinite(A[idx]))
        res[f"n_m{tf}k{k}"] = len(m)
        if len(m) > CAP: m = np.sort(np.random.default_rng(tf * 10 + k).choice(m, CAP, replace=False))
        i, P, K = idx[m], p[m], kd[m]; a = A[i]
        D = Z.distances(i, P, K); Q = Z.quality(i, D, near=TOLK * a, band=0.5 * TOLK * a)
        tag = f"m{tf}k{k}"; res[f"{tag}_i"] = i; res[f"{tag}_atr"] = a; res[f"{tag}_today"] = Z.dstart[Z.di[i]]
        for kk, v in {**D, **Q}.items(): res[f"{tag}_{kk}"] = v
        res["types"] = np.array(Z.types(D))
        print(mkt, tag, "events", len(m), "of", res[f"n_m{tf}k{k}"], f"{time.time() - t0:.0f}s", flush=True)
    res["ndays"] = len(np.unique(M["day"][i0:]))
    np.savez(f + ".tmp.npz", **res); os.replace(f + ".tmp.npz", f); return res

if __name__ == "__main__":
    R = {m: run(m) for m in (sys.argv[1:] or MK)}
    if len(R) < 4: sys.exit()
    types = [str(x) for x in R["real"]["types"]]; nd = int(R["real"]["ndays"]); txt = []; rows = []
    def say(s=""): print(s); txt.append(s)
    def share(r, tag, ty, extra):
        m = r[f"{tag}_{ty}"] <= TOLK * r[f"{tag}_atr"]
        if extra == "first": m &= r[f"{tag}_{ty}_vis"] == 0
        if extra == "today": m &= r[f"{tag}_{ty}_s"] >= r[f"{tag}_today"]
        return np.mean(m)
    say(f"reversals of k x ATR(TF) on the M1 path, near = within {TOLK} ATR(TF), {nd} trading days from 2024-05-13 | real / random-direction (mean of 3), lift, z")
    for tf, k in SETS:
        tag = f"m{tf}k{k}"; n = len(R["real"][f"{tag}_i"]); ns = np.mean([len(R[m][f"{tag}_i"]) for m in MK[1:]])
        size = np.median(k * R["real"][f"{tag}_atr"])
        say(f"\n=== M{tf} reversal >= {k} ATR: {int(R['real'][f'n_{tag}']) / nd:.1f}/day (median size ${size:.2f}), evaluated {n} ===")
        for extra in (None, "first", "today"):
            res = []
            for ty in types:
                if extra and not np.any(R["real"][f"{tag}_{ty}_s"] >= 0): continue
                a = share(R["real"], tag, ty, extra); c = np.mean([share(R[m], tag, ty, extra) for m in MK[1:]])
                se = np.sqrt(c * (1 - c) / max(n, 1) + c * (1 - c) / max(3 * ns, 1)); z = (a - c) / se if se > 0 else np.nan
                res.append((ty, a, c, a / c if c > 0 else np.nan, z))
                rows.append(dict(set=tag, extra=extra or "presence", type=ty, real=round(a, 4), random_dir=round(c, 4), lift=round(a / c, 3) if c > 0 else "", z=round(z, 2) if np.isfinite(z) else ""))
            res.sort(key=lambda r: -np.nan_to_num(r[4]))
            say(f"  [{extra or 'presence'}] top: " + "; ".join(f"{r[0]} {r[1]:.1%}/{r[2]:.1%} x{r[3]:.2f} z{r[4]:+.1f}" for r in res[:8]))
            say(f"  [{extra or 'presence'}] bottom: " + "; ".join(f"{r[0]} {r[1]:.1%}/{r[2]:.1%} x{r[3]:.2f} z{r[4]:+.1f}" for r in res[-5:]))
    with open(os.path.join(OUT, "zn_why2_matrix.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
    open(os.path.join(OUT, "zn_why2.txt"), "w", encoding="utf-8").write("\n".join(txt))
