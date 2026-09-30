r"""Step 2 (user 2026-09-30): take the real reversals first, then ask WHY price turned there = which zone (zn_lib) was at that price.
Events: every pivot of a fixed-$ zigzag on the M1 4-point path (the price then moved >= X the other way), X = $10, $20 ... $100 (user:
1,000 points = $10). Compared with (a) random M1 bar highs / lows (ordinary prices) and (b) the reversals of 3 random-direction markets
(sf1-3: same volatility, no direction -> how often a reversal sits on a zone purely by mechanics).
Report per X and tolerance: share of events within tol of each zone type (real / random bars / random-direction), lift, z; then the
zone QUALITY part (item 1): within $1 AND first touch (price never came back to that level since it was known), within $1 AND created
today, and confluence (number of distinct sparse zone types within $1). Events from 2024-05-13 (one month warm-up).
Output: zn\zn_why.txt + zn\zn_why_<market>.npz"""
import sys, os, time, calendar, datetime
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, po_lib as PO, zn_lib as ZL
OUT = r"C:\trade datacenter\zn"; os.makedirs(OUT, exist_ok=True)
FROM = calendar.timegm(datetime.datetime(2024, 5, 13).timetuple())
XS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]; MK = ["real", "sf1", "sf2", "sf3"]; TOL = (1.0, 2.0)

def run(mkt):
    f = os.path.join(OUT, f"zn_why_{mkt}.npz")
    if os.path.exists(f): return dict(np.load(f, allow_pickle=True))
    t0 = time.time(); M = PO.load_market(mkt); Z = ZL.Zones(M); i0 = np.searchsorted(M["t"], FROM)
    print(mkt, "zones built", f"{time.time() - t0:.0f}s", flush=True)
    res = {}
    def one(tag, i, p, k):
        D = Z.distances(i, p, k); Q = Z.quality(i, D); res[f"{tag}_i"] = i; res[f"{tag}_k"] = k; res["types"] = np.array(Z.types(D))
        res[f"{tag}_today"] = Z.dstart[Z.di[i]]
        for kk, v in {**D, **Q}.items(): res[f"{tag}_{kk}"] = v
    for x in XS:
        idx, p, k, conf = ZL.zigzag_usd(M, x); m = idx >= i0; one(f"x{x}", idx[m], p[m], k[m])
        print(mkt, "X", x, "events", m.sum(), f"{time.time() - t0:.0f}s", flush=True)
    rng = np.random.default_rng(7); ri = rng.integers(i0, len(M["t"]), 30000); rk = rng.choice([-1, 1], 30000)
    one("rnd", ri, np.where(rk > 0, M["h"][ri], M["l"][ri]), rk)
    res["ndays"] = len(np.unique(M["day"][i0:]))
    np.savez(f + ".tmp.npz", **res); os.replace(f + ".tmp.npz", f); print(mkt, "done", f"{time.time() - t0:.0f}s", flush=True)
    return res

if __name__ == "__main__":
    R = {m: run(m) for m in (sys.argv[1:] or MK)}
    if len(R) < 4: sys.exit()
    types = [str(x) for x in R["real"]["types"]]
    txt = []
    def say(s=""): print(s); txt.append(s)
    nd = int(R["real"]["ndays"])
    def share(r, tag, ty, tol, extra=None):
        m = r[f"{tag}_{ty}"] <= tol
        if extra == "first": m = m & (r[f"{tag}_{ty}_vis"] == 0)
        if extra == "today": m = m & (r[f"{tag}_{ty}_s"] >= r[f"{tag}_today"])
        return np.mean(m)
    def table(x, tol, extra, only=None):
        n = len(R["real"][f"x{x}_i"]); ns = np.mean([len(R[m][f"x{x}_i"]) for m in MK[1:]]); rows = []
        for ty in (only or types):
            a = share(R["real"], f"x{x}", ty, tol, extra); b = share(R["real"], "rnd", ty, tol, extra)
            c = np.mean([share(R[m], f"x{x}", ty, tol, extra) for m in MK[1:]])
            se = np.sqrt(c * (1 - c) / max(n, 1) + c * (1 - c) / max(3 * ns, 1))
            rows.append((ty, a, b, c, a / c if c > 0 else np.nan, (a - c) / se if se > 0 else np.nan))
        return rows
    say(f"events from 2024-05-13, {nd} trading days. share of events within TOL of each zone | real reversals / random bar prices / "
        f"random-direction reversals (mean of 3) | lift = real / random-direction, z")
    for x in XS:
        n = len(R["real"][f"x{x}_i"]); ns = np.mean([len(R[m][f"x{x}_i"]) for m in MK[1:]])
        say(f"\n=== X = ${x}: real reversals {n} ({n / nd:.1f}/day), random-direction markets {ns:.0f} ===")
        for tol in TOL:
            say(f"  [presence] tol ${tol:g}   " + "type".ljust(20) + "real   rndbar  sfrev   lift   z")
            for r in sorted(table(x, tol, None), key=lambda r: -np.nan_to_num(r[5])):
                say(f"            {r[0]:20s}{r[1]:6.1%} {r[2]:6.1%} {r[3]:6.1%}  {r[4]:5.2f} {r[5]:+5.1f}")
        withs = [ty for ty in types if np.any(R["real"][f"x{x}_{ty}_s"] >= 0)]
        for extra, title in (("first", "within $1 AND first touch (never revisited since known)"), ("today", "within $1 AND level/zone created today")):
            say(f"  [{title}]")
            for r in sorted(table(x, 1.0, extra, withs), key=lambda r: -np.nan_to_num(r[5]))[:12]:
                say(f"            {r[0]:20s}{r[1]:6.1%} {r[2]:6.1%} {r[3]:6.1%}  {r[4]:5.2f} {r[5]:+5.1f}")
        sparse = [ty for ty in types if np.mean(R["real"][f"rnd_{ty}"] <= 1.0) < 0.15]
        cnt = lambda r, tag: np.sum(np.c_[[r[f"{tag}_{ty}"] <= 1.0 for ty in sparse]].T, axis=1)
        cr = cnt(R["real"], f"x{x}"); cs = np.concatenate([cnt(R[m], f"x{x}") for m in MK[1:]]); cb = cnt(R["real"], "rnd")
        say(f"  [confluence: number of sparse zone types (random-bar share < 15%) within $1]  mean real {cr.mean():.2f} / random bars {cb.mean():.2f} / random-direction {cs.mean():.2f}")
        for kk in (1, 2, 3, 4, 5):
            a, b = np.mean(cr >= kk), np.mean(cs >= kk); say(f"            >= {kk}: real {a:6.1%}  random-direction {b:6.1%}  lift {a / b if b else np.nan:5.2f}")
    open(os.path.join(OUT, "zn_why.txt"), "w", encoding="utf-8").write("\n".join(txt))
