r"""Follow-up of po_eval (M5): (1) cells that make money (mean R > 0) and beat the random-direction market, (2) robustness of the
best ones: drop the 10 / 20 best days, per quarter, share of R from the top 1% trades."""
import sys, os, csv
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, po_lib as PO, po_eval as EV

rows = list(csv.DictRecader if False else csv.DictReader(open(os.path.join(PO.OUTD, "po_eval_m5.csv"), encoding="utf-8")))
f = lambda o, k: float(o[k]) if o[k] not in ("", "nan") else np.nan
good = [o for o in rows if f(o, "mean_R") > 0 and f(o, "t_excess") >= 2]
good.sort(key=lambda o: -f(o, "mean_R"))
print("cells with mean R > 0 and t_excess >= 2:", len(good))
for o in good[:25]:
    print(f"  {o['fam']:6s} {o['mode']:8s} {o['cell']:16s} R {f(o,'mean_R'):+.3f} win {f(o,'winrate'):.0%} random {f(o,'random_entry_R'):+.3f} null {f(o,'null_R'):+.3f}"
          f" t {f(o,'t_excess'):+.1f} h {f(o,'h1'):+.2f}/{f(o,'h2'):+.2f} b/s {f(o,'buy'):+.2f}/{f(o,'sell'):+.2f} n/day {o['per_day']} all={o['all']}")

R = EV.L["real"]
def robust(fam, mode, sp):
    r, day, side = EV.results(R, fam, mode, sp); ok = np.isfinite(r); r, day, side = r[ok], day[ok], side[ok]
    ud, inv = np.unique(day, return_inverse=True); ds = np.bincount(inv, r)
    order = np.argsort(-ds)
    out = [f"{fam} {mode} {EV.spec_name(sp)}: n {len(r)} mean {r.mean():+.3f} total {r.sum():+.0f}R"]
    for k in (10, 20):
        keep = ~np.isin(inv, order[:k]); out.append(f"drop best {k} days -> mean {r[keep].mean():+.3f} total {r[keep].sum():+.0f}R")
    top = np.sort(r)[::-1]; out.append(f"top 1% trades = {top[:max(1, len(r) // 100)].sum() / r.sum():.0%} of total")
    q = (day - day.min()) // 91
    out.append("quarters: " + " ".join(f"{r[q == k].sum():+.0f}" for k in np.unique(q)))
    out.append(f"BUY {r[side > 0].mean():+.3f} (n {int((side > 0).sum())})  SELL {r[side < 0].mean():+.3f} (n {int((side < 0).sum())})")
    print("\n  ".join(out))

for sp in (("grid", 0.5, None, None), ("grid", 1, None, None), ("grid", 1.5, None, None), ("grid", 1, 6, None), ("grid", 1, 4, None)):
    robust("pdx", "with", sp)
for fam, mode, sp in (("big", "with", ("grid", 3, None, None)), ("pin", "against", ("grid", 3, None, None)), ("pivot", "with", ("grid", 1.5, None, None))):
    robust(fam, mode, sp)
