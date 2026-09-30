r"""Robustness of the 'break of yesterday's high/low, trade with it, no TP' pattern on M1 / M3 / M5 (real market, all data):
drop the best 10 / 20 trading days, share of the total from the top 1% of trades, per-quarter R, BUY / SELL, per-year R.
Output: po\po_pdx_robust.txt"""
import sys, os
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, po_lib as PO
BIT = {n: 1 << i for i, n in enumerate(["big", "pin", "vspike", "inside", "pivot", "regime", "boxbreak", "pdh", "pdl", "dayhigh", "daylow", "asiahigh", "asialow", "check"])}
LVi = lambda v: int(np.flatnonzero(np.isclose(PO.LV, v))[0])
out = []
def say(s=""): print(s, flush=True); out.append(s)
for tf in (1, 3, 5):
    R = dict(np.load(os.path.join(PO.OUTD, f"po_m{tf}_real.npz")))
    fl = R["flags"]; up = (fl & BIT["pdh"]) != 0; dn = (fl & BIT["pdl"]) != 0; m = up ^ dn; d = np.where(up, 1, -1)
    rows = np.flatnonzero(m); side = d[rows].astype(np.int64)
    say(f"\n===== M{tf}: {len(rows)} events, {len(np.unique(R['day'][rows]))} days =====")
    cells = [(f"SL{s}_TPnone", lambda rr, sd, s=s: PO.trade_R(R, rr, sd, LVi(s), None)) for s in (0.5, 1, 2, 3)] + \
            [("SLwick_TP4R", lambda rr, sd: PO.trade_R_struct(R, rr, sd, 5))]
    for name, fn in cells:
        r = np.empty(len(rows))
        for sd in (1, -1):
            k = side == sd; r[k] = fn(rows[k], sd)
        ok = np.isfinite(r); x, day, sd_ = r[ok], R["day"][rows][ok], side[ok]
        ud, inv = np.unique(day, return_inverse=True); ds = np.bincount(inv, x); order = np.argsort(-ds)
        top = np.sort(x)[::-1][:max(1, len(x) // 100)].sum() / x.sum()
        l = f"{name:13s} n {len(x)} mean {x.mean():+.3f} total {x.sum():+.0f}R | drop best 10 days {x[~np.isin(inv, order[:10])].mean():+.3f}, 20 days {x[~np.isin(inv, order[:20])].mean():+.3f} | top1% = {top:.0%}"
        say(l)
        q = (day - day.min()) // 91
        say("   quarters (total R): " + " ".join(f"{x[q == k].sum():+.0f}" for k in np.unique(q)) + f"   positive quarters {sum(x[q == k].sum() > 0 for k in np.unique(q))}/{len(np.unique(q))}")
        say(f"   BUY {x[sd_ > 0].mean():+.3f} (n {int((sd_ > 0).sum())})  SELL {x[sd_ < 0].mean():+.3f} (n {int((sd_ < 0).sum())})")
open(os.path.join(PO.OUTD, "po_pdx_robust.txt"), "w", encoding="utf-8").write("\n".join(out))
