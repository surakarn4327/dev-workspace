r"""Pattern-outcome library, layer 1a evaluation (user 2026-09-30). Same cells, comparisons, calibration and gates as po_eval2 (the
definitions are taken from po_eval2's source, so nothing is re-implemented differently):
  new families (po_fam2)  x with / against x 13 contexts (po_eval2's 10 + htf_with / htf_against / htf_side = regime of the next TF up)
  old families (po_eval2) x with / against x the 3 new htf contexts
Gates: G1 |t_excess| >= 3.5 and >= 100 days | G2 halves | G3 BUY & SELL | G4 neighbour cells | tradable = all + excess > 0 + mean R > 0
Usage: PO_TF=<tf> python po_eval3.py   Output: po\po_eval3_m<tf>.csv + .txt"""
import sys, os, csv, time
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, po_lib as PO
src = open(r"C:\trade datacenter\scripts\po_eval2.py", encoding="utf-8").read().split("t0 = time.time()")[0]
ns = {}; exec(compile(src, "po_eval2_defs", "exec"), ns)
TF = int(os.environ.get("PO_TF", 5)); ns["TF"] = TF
MK = ["real", "sf1", "sf2", "sf3"]; CELLS, cname, cell_R, cstat = ns["CELLS"], ns["cname"], ns["cell_R"], ns["cstat"]
SLS, RRS = ns["SLS"], ns["RRS"]
import po_fam2 as F2
NEW = F2.FAM2; OLD = ns["FAMS"]; HTFC = ["htf_with", "htf_against", "htf_side"]; CTX = ns["CTX"] + HTFC

t0 = time.time(); L = {}; C = {}
for m in MK:
    L[m] = dict(np.load(os.path.join(PO.OUTD, f"po_m{TF}_{m}.npz")))
    C[m] = ns["context_arrays"](PO.load_market(m), L[m])
    Z = np.load(os.path.join(PO.OUTD, f"po_fam2_m{TF}_{m}.npz"))
    for k in Z.files: C[m][k] = Z[k]
    print(m, "ready", f"{time.time() - t0:.0f}s", flush=True)
days = np.unique(L["real"]["day"]); MID = days[len(days) // 2]

BASE = ["all_htf", "all_reg", "all_day"]          # context alone as a family: EVERY bar, direction = the context (htf regime / own regime / day side)
def fam_rows(R, Cm, fam):
    if fam in OLD: return ns["fam_rows"](R, Cm, fam)
    if fam in BASE:
        d = {"all_htf": Cm["htf_reg"].astype(np.int64), "all_reg": Cm["reg"].astype(np.int64), "all_day": np.where(Cm["pos"] >= 0.5, 1, -1)}[fam]
        r = np.flatnonzero(d != 0); return r, d[r]
    d = Cm["f_" + fam].astype(np.int64); r = np.flatnonzero(d != 0); return r, d[r]

def ctx_mask(Cm, rows, side, ctx):
    if ctx in HTFC:
        g = Cm["htf_reg"][rows].astype(np.int64) * side
        return {"htf_with": g > 0, "htf_against": g < 0, "htf_side": Cm["htf_reg"][rows] == 0}[ctx]
    return ns["ctx_mask"](Cm, rows, side, ctx)

def evaluate(m, fam, mode, ctx, c):
    R, Cm = L[m], C[m]; rows, d = fam_rows(R, Cm, fam); side = d * (1 if mode == "with" else -1)
    k = ctx_mask(Cm, rows, side, ctx); rows, side = rows[k], side[k]
    return cell_R(R, rows, side, c), R["day"][rows], side

def base_random(c):
    R = L["real"]; rows = np.arange(len(R["b"]))
    return np.nanmean(np.r_[cell_R(R, rows, np.ones(len(rows), np.int64), c), cell_R(R, rows, -np.ones(len(rows), np.int64), c)])
BR = {cname(c): base_random(c) for c in CELLS}
jobs = [(f, mo, cx) for f in NEW for mo in ("with", "against") for cx in CTX] + [(f, mo, cx) for f in OLD for mo in ("with", "against") for cx in HTFC] \
     + [(f, "with", "none") for f in BASE]
out = []; nullz = []
for fam, mode, ctx in jobs:
    for c in CELLS:
        r, day, side = evaluate("real", fam, mode, ctx, c)
        mu, se, nd = cstat(r, day)
        nl = [evaluate(m, fam, mode, ctx, c) for m in MK[1:]]
        ns_ = [cstat(x[0], x[1])[:2] for x in nl]
        nmu = np.array([a for a, _ in ns_]); nse = np.array([b for _, b in ns_])
        null_mu = np.nanmean(nmu); null_se = np.sqrt(np.nanmean(nse ** 2) / 3)
        ex = mu - null_mu; tex = ex / np.sqrt(se ** 2 + null_se ** 2)
        for k in range(3):
            o = [j for j in range(3) if j != k]
            nullz.append((nmu[k] - np.nanmean(nmu[o])) / np.sqrt(nse[k] ** 2 + np.nanmean(nse[o] ** 2) / 2))
        hh = []
        for first in (True, False):
            sel = lambda dd: (dd < MID) if first else (dd >= MID)
            m_, s_, _ = cstat(r[sel(day)], day[sel(day)])
            nh = [cstat(x[0][sel(x[1])], x[1][sel(x[1])])[0] for x in nl]
            hh.append((m_ - np.nanmean(nh), s_))
        bs = []
        for sd in (1, -1):
            k = side == sd; m_, s_, _ = cstat(r[k], day[k])
            nb = [cstat(x[0][x[2] == sd], x[1][x[2] == sd])[0] for x in nl]
            bs.append((m_ - np.nanmean(nb), s_))
        ok = np.isfinite(r); rr = r[ok]
        out.append(dict(fam=fam, mode=mode, ctx=ctx, cell=cname(c), kind=c[0], sl=c[1] if c[0] == "grid" else "",
                        rr=("none" if c[0] == "grid" and c[2] is None else (c[2] if c[0] == "grid" else "")),
                        n=int(ok.sum()), days=nd, per_day=round(ok.sum() / len(days), 3), winrate=round(float(np.mean(rr > 0)), 3) if len(rr) else np.nan,
                        mean_R=round(mu, 4), se=round(se, 4), null_R=round(null_mu, 4), random_R=round(BR[cname(c)], 4),
                        excess=round(ex, 4), t_excess=round(tex, 2),
                        h1=round(hh[0][0], 4), t_h1=round(hh[0][0] / hh[0][1], 2), h2=round(hh[1][0], 4), t_h2=round(hh[1][0] / hh[1][1], 2),
                        buy=round(bs[0][0], 4), t_buy=round(bs[0][0] / bs[0][1], 2), sell=round(bs[1][0], 4), t_sell=round(bs[1][0] / bs[1][1], 2)))
    if ctx == CTX[-1] or fam in OLD: print(fam, mode, ctx, f"{time.time() - t0:.0f}s", flush=True)
key = {(o["fam"], o["mode"], o["ctx"], o["cell"]): o for o in out}
for o in out:
    sg = np.sign(o["excess"])
    o["G1"] = bool(abs(o["t_excess"]) >= 3.5 and o["days"] >= 100)
    o["G2"] = bool(np.sign(o["h1"]) == sg == np.sign(o["h2"]) and abs(o["t_h1"]) >= 1.5 and abs(o["t_h2"]) >= 1.5)
    o["G3"] = bool(np.sign(o["buy"]) == sg == np.sign(o["sell"]) and abs(o["t_buy"]) >= 1.5 and abs(o["t_sell"]) >= 1.5)
    nb = []
    if o["kind"] == "grid":
        si = SLS.index(o["sl"]); ri = RRS.index(None if o["rr"] == "none" else o["rr"])
        for ds, dr in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            if 0 <= si + ds < len(SLS) and 0 <= ri + dr < len(RRS):
                nm = cname(("grid", SLS[si + ds], RRS[ri + dr])); nb.append(np.sign(key[(o["fam"], o["mode"], o["ctx"], nm)]["excess"]) == sg)
    o["G4"] = bool(nb) and np.mean(nb) >= 0.75
    o["all"] = o["G1"] and o["G2"] and o["G3"] and o["G4"]
    o["tradable"] = o["all"] and o["excess"] > 0 and o["mean_R"] > 0
with open(os.path.join(PO.OUTD, f"po_eval3_m{TF}.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=list(out[0].keys())); w.writeheader(); w.writerows(out)
nz = np.abs(np.array(nullz)); nz = nz[np.isfinite(nz)]; tr = np.abs(np.array([o["t_excess"] for o in out], float)); tr = tr[np.isfinite(tr)]
txt = []
def say(s): print(s); txt.append(s)
say(f"M{TF} layer 1a: cells {len(out)} | G1 {sum(o['G1'] for o in out)} G2 {sum(o['G2'] for o in out)} G3 {sum(o['G3'] for o in out)} G4 {sum(o['G4'] for o in out)} | all gates {sum(o['all'] for o in out)} | tradable {sum(o['tradable'] for o in out)}")
for th in (2, 3, 3.5, 4, 5):
    say(f"  |t| >= {th}: real {np.sum(tr >= th)}  expected by chance {np.mean(nz >= th) * len(tr):.1f}")
say(f"  null-vs-null z sd {np.std(np.array(nullz)[np.isfinite(nullz)]):.3f}")
say("\nfamily counts per day (real / mean of random markets):")
for f in NEW:
    say(f"  {f:11s} {np.mean(C['real']['f_' + f] != 0) * len(L['real']['b']) / len(days):6.2f} / {np.mean([np.sum(C[m]['f_' + f] != 0) for m in MK[1:]]) / len(days):6.2f}")
tb = sorted([o for o in out if o["tradable"]], key=lambda o: -o["mean_R"])
say(f"\nTRADABLE ({len(tb)}):")
for o in tb[:60]:
    say(f"  {o['fam']:10s} {o['mode']:7s} {o['ctx']:11s} {o['cell']:14s} n/day {o['per_day']:5.2f} win {o['winrate']:.0%} R {o['mean_R']:+.3f} null {o['null_R']:+.3f}"
        f" random {o['random_R']:+.3f} t {o['t_excess']:+.1f} h {o['h1']:+.2f}/{o['h2']:+.2f} b/s {o['buy']:+.2f}/{o['sell']:+.2f}")
good = sorted([o for o in out if o["mean_R"] > 0 and o["excess"] > 0 and o["t_excess"] >= 3 and not o["tradable"]], key=lambda o: -o["t_excess"])
say(f"\nNEAR (mean R > 0, excess > 0, t >= 3, not every gate) {len(good)}:")
for o in good[:30]:
    g = "".join("1" if o[k] else "0" for k in ("G1", "G2", "G3", "G4"))
    say(f"  {o['fam']:10s} {o['mode']:7s} {o['ctx']:11s} {o['cell']:14s} n/day {o['per_day']:5.2f} win {o['winrate']:.0%} R {o['mean_R']:+.3f} null {o['null_R']:+.3f} t {o['t_excess']:+.1f} h {o['h1']:+.2f}/{o['h2']:+.2f} b/s {o['buy']:+.2f}/{o['sell']:+.2f} G{g}")
av = sorted([o for o in out if o["all"] and o["excess"] < 0], key=lambda o: o["excess"])
say(f"\nAVOID (all gates, worse than random-direction market) {len(av)}:")
for o in av[:30]:
    say(f"  {o['fam']:10s} {o['mode']:7s} {o['ctx']:11s} {o['cell']:14s} R {o['mean_R']:+.3f} null {o['null_R']:+.3f} excess {o['excess']:+.3f} t {o['t_excess']:+.1f}")
open(os.path.join(PO.OUTD, f"po_eval3_m{TF}.txt"), "w", encoding="utf-8").write("\n".join(txt))
print(f"done {time.time() - t0:.0f}s")
