r"""Step 2 (user 2026-09-30): take the real reversals first, then ask WHY price turned there = which zone (zn_lib) was at that price.
Events: every pivot of a fixed-$ zigzag on M1 (the price then moved >= X in the other direction), X = $10, $20 ... $100 (user: 1,000
points = $10). Compared with (a) random M1 bar highs / lows (ordinary prices) and (b) the reversals of 3 random-direction markets
(sf1-3: same volatility, no direction -> shows how often a reversal sits on a zone purely by mechanics).
Share of events within $1 / $2 of each zone type, lift = real / random-direction market. Events from 2024-05-13 (one month warm-up for
previous-week / previous-month / 20-day zones). Output: zn\zn_why.txt + zn\zn_why_<market>.npz (distances per event)."""
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
    for x in XS:
        idx, p, k, conf = ZL.zigzag_usd(M["h"], M["l"], x); m = idx >= i0
        D = Z.distances(idx[m], p[m], k[m]); res[f"x{x}_i"] = idx[m]; res[f"x{x}_k"] = k[m]
        for kk, v in D.items(): res[f"x{x}_{kk}"] = v
        print(mkt, "X", x, "events", m.sum(), f"{time.time() - t0:.0f}s", flush=True)
    rng = np.random.default_rng(7); ri = rng.integers(i0, len(M["t"]), 30000); rk = rng.choice([-1, 1], 30000)
    rp = np.where(rk > 0, M["h"][ri], M["l"][ri]); D = Z.distances(ri, rp, rk)
    res["rnd_i"] = ri; res["rnd_k"] = rk
    for kk, v in D.items(): res[f"rnd_{kk}"] = v
    res["ndays"] = len(np.unique(M["day"][i0:])); res["years"] = np.array([datetime.datetime.utcfromtimestamp(int(tt)).year for tt in M["t"][[0]]])
    np.savez(f + ".tmp.npz", **res); os.replace(f + ".tmp.npz", f); print(mkt, "done", f"{time.time() - t0:.0f}s", flush=True)
    return res

if __name__ == "__main__":
    R = {m: run(m) for m in (sys.argv[1:] or MK)}
    if len(R) < 4: sys.exit()
    types = [k[len("rnd_"):] for k in R["real"] if k.startswith("rnd_") and k not in ("rnd_i", "rnd_k")]
    txt = []
    def say(s=""): print(s); txt.append(s)
    nd = int(R["real"]["ndays"])
    say(f"events from 2024-05-13, {nd} trading days. share of events within TOL of each zone | real reversals / random bar prices / random-direction reversals (mean of 3) | lift = real / random-direction")
    for x in XS:
        n = len(R["real"][f"x{x}_i"]); ns = np.mean([len(R[m][f"x{x}_i"]) for m in MK[1:]])
        say(f"\n=== X = ${x}: real reversals {n} ({n / nd:.1f}/day), random-direction markets {ns:.0f} ===")
        for tol in TOL:
            say(f"  tol ${tol:g}   " + "type".ljust(20) + "real   rndbar  sfrev   lift   z")
            rows = []
            for ty in types:
                a = np.mean(R["real"][f"x{x}_{ty}"] <= tol); b = np.mean(R["real"][f"rnd_{ty}"] <= tol)
                cs = [np.mean(R[m][f"x{x}_{ty}"] <= tol) for m in MK[1:]]; c = np.mean(cs)
                se = np.sqrt(c * (1 - c) / max(n, 1) + c * (1 - c) / max(ns * 3, 1))
                rows.append((ty, a, b, c, a / c if c > 0 else np.nan, (a - c) / se if se > 0 else np.nan))
            anyr = np.mean(np.any(np.c_[[R["real"][f"x{x}_{ty}"] <= tol for ty in types]].T, axis=1))
            anys = np.mean([np.mean(np.any(np.c_[[R[m][f"x{x}_{ty}"] <= tol for ty in types]].T, axis=1)) for m in MK[1:]])
            anyb = np.mean(np.any(np.c_[[R["real"][f"rnd_{ty}"] <= tol for ty in types]].T, axis=1))
            for r in sorted(rows, key=lambda r: -np.nan_to_num(r[5])):
                say(f"            {r[0]:20s}{r[1]:6.1%} {r[2]:6.1%} {r[3]:6.1%}  {r[4]:5.2f} {r[5]:+5.1f}")
            say(f"            {'ANY zone':20s}{anyr:6.1%} {anyb:6.1%} {anys:6.1%}  {anyr / anys:5.2f}")
    open(os.path.join(OUT, "zn_why.txt"), "w", encoding="utf-8").write("\n".join(txt))
