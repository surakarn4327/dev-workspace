r"""Pattern-outcome library M5, round 2 (user 2026-09-30): every footprint family of the catalog x trade with / against it x context
("stacked" patterns) x SL/TP/management cells. Data 2024-04-15 .. latest (no hold-out; the user walks forward himself).
Families (direction = what the pattern points to):
  big (candle dir) | pin (wick side: long lower wick = up) | vspike (candle dir) | inside (direction of the mother bar) |
  pivot (new leg dir) | regime (new M5 regime up/down) | boxbreak (break dir) | pdx (break of yesterday high/low) |
  dayext (new day high = up / new day low = down, old extreme stood >= 60 min) | asia (close outside the Asia box after Asia)
Contexts (known at the close of the bar, relative to the TRADE direction):
  none | reg_with / reg_against / reg_side (M5 zigzag-3 regime at that bar) | day_with / day_against (price in the half of today's range
  on the trade side or not) | sess_asia / sess_london / sess_ny / sess_late (New York clock)
Cells: SL 0.5/1/2/3 ATR x TP 1/2/4R/no TP, stop behind the bar wick x TP 1/2/4R, trailing 1/2 ATR (22 cells).
Comparisons: (a) the same pattern + context in 3 random-direction markets (null) (b) random entry, both directions (c) the context alone
(every bar, trade in the context direction) where the context has a direction.
Search-wide calibration: in the random-direction markets, "excess" of market k vs the mean of the other two for every cell = what the
search finds by chance -> expected count of cells above each |t|.
Gates (fixed before results): G1 |t_excess| >= 3.5, >= 100 days | G2 both halves same sign |t| >= 1.5 | G3 BUY & SELL same sign
|t| >= 1.5 | G4 >= 75% of neighbour cells same sign | tradable = mean R > 0.
Output: po\po_eval2_m{TF}.csv + po_eval2_m{TF}.txt"""
import sys, os, csv, time
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, po_lib as PO, adx_ctx as X, broker as BK

TF = int(os.environ.get("PO_TF", 5)); MK = ["real", "sf1", "sf2", "sf3"]
BITS = {n: 1 << i for i, n in enumerate(["big", "pin", "vspike", "inside", "pivot", "regime", "boxbreak", "pdh", "pdl", "dayhigh", "daylow",
                                         "asiahigh", "asialow", "check"])}
FAMS = ["big", "pin", "vspike", "inside", "pivot", "regime", "boxbreak", "pdx", "dayext", "asia"]
CTX = ["none", "reg_with", "reg_against", "reg_side", "day_with", "day_against", "sess_asia", "sess_london", "sess_ny", "sess_late"]
LVi = lambda v: int(np.flatnonzero(np.isclose(PO.LV, v))[0])
SLS = [0.5, 1, 2, 3]; RRS = [1, 2, 4, None]
CELLS = [("grid", s, rr) for s in SLS for rr in RRS] + [("struct", k) for k in (1, 3, 5)] + [("trail", 0), ("trail", 2)]
def cname(c):
    if c[0] == "grid": return f"SL{c[1]}_TP{'none' if c[2] is None else str(c[2]) + 'R'}"
    if c[0] == "struct": return f"SLwick_TP{PO.RR[c[1]]:g}R"
    return f"trail{PO.TR_D[c[1]]:g}"

def context_arrays(M, R):
    """per library row: M5 regime at the bar (+1/-1/0), position in today's range so far (0..1), NY session code, mother-bar direction"""
    B = X.resample(M, TF); b = R["b"]
    idx, pp, kind, conf, ncf, EP = X.zigzag_state(B, 3)
    reg, known, chg, dH, dL = X.regime_after(pp, kind)
    regp = np.where(known, reg, 0)
    n = len(B["c"]); last = np.full(n, -1)
    last[conf] = np.arange(len(conf)); last = np.maximum.accumulate(last)
    reg_bar = np.where(last >= 0, regp[np.clip(last, 0, None)], 0)
    sid = B["sid"]; st = np.r_[0, np.flatnonzero(np.diff(sid)) + 1]
    hi = B["h"].copy(); lo = B["l"].copy()
    for a, z in zip(st, np.r_[st[1:], n]):
        hi[a:z] = np.maximum.accumulate(B["h"][a:z]); lo[a:z] = np.minimum.accumulate(B["l"][a:z])
    rng = hi - lo; pos = np.where(rng > 0, (B["c"] - lo) / np.where(rng > 0, rng, 1), 0.5)
    t = B["t_open"]; et = ((t - np.where(BK.us_dst(t), 4, 5) * 3600) // 3600) % 24
    sess = np.select([(et >= 17) | (et < 3), et < 8, et < 13], [0, 1, 2], 3)
    cd = np.sign(B["c"] - B["o"]); mother = np.r_[0, cd[:-1]]
    return dict(reg=reg_bar[b], pos=pos[b], sess=sess[b], mother=mother[b], cdir=cd[b])

def fam_rows(R, C, fam):
    fl = R["flags"]
    if fam in ("big", "vspike"): m = (fl & BITS[fam]) != 0; d = C["cdir"] if fam == "vspike" else R["dir_big"]
    elif fam == "pin": m = (fl & BITS["pin"]) != 0; d = R["dir_pin"]
    elif fam == "inside": m = (fl & BITS["inside"]) != 0; d = C["mother"]
    elif fam == "pivot": m = (fl & BITS["pivot"]) != 0; d = R["dir_piv"]
    elif fam == "regime": m = (fl & BITS["regime"]) != 0; d = R["dir_reg"]
    elif fam == "boxbreak": m = (fl & BITS["boxbreak"]) != 0; d = R["dir_box"]
    else:
        a, z = {"pdx": ("pdh", "pdl"), "dayext": ("dayhigh", "daylow"), "asia": ("asiahigh", "asialow")}[fam]
        up = (fl & BITS[a]) != 0; dn = (fl & BITS[z]) != 0; m = up ^ dn; d = np.where(up, 1, -1)
    rows = np.flatnonzero(m & (np.asarray(d) != 0)); return rows, np.asarray(d)[rows].astype(np.int64)

def ctx_mask(C, rows, side, ctx):
    if ctx == "none": return np.ones(len(rows), bool)
    if ctx.startswith("reg_"):
        rg = C["reg"][rows] * side
        return {"reg_with": rg > 0, "reg_against": rg < 0, "reg_side": C["reg"][rows] == 0}[ctx]
    if ctx.startswith("day_"):
        rel = np.where(side > 0, C["pos"][rows], 1 - C["pos"][rows])
        return rel >= 0.5 if ctx == "day_with" else rel < 0.5
    return C["sess"][rows] == {"sess_asia": 0, "sess_london": 1, "sess_ny": 2, "sess_late": 3}[ctx]

def cell_R(R, rows, side, c):
    out = np.empty(len(rows))
    for sd in (1, -1):
        k = side == sd
        if not k.any(): continue
        if c[0] == "grid": out[k] = PO.trade_R(R, rows[k], sd, LVi(c[1]), None if c[2] is None else LVi(c[1] * c[2]))
        elif c[0] == "struct": out[k] = PO.trade_R_struct(R, rows[k], sd, c[1])
        else:
            dd = PO.TR_D[c[1]]; out[k] = (R["tr_b"] if sd > 0 else R["tr_s"])[rows[k], c[1]] / dd - PO.COST / (dd * R["atr"][rows[k]])
    return out

def cstat(x, day):
    ok = np.isfinite(x); x = x[ok]; day = day[ok]
    if len(x) < 30: return np.nan, np.nan, 0
    ud, inv = np.unique(day, return_inverse=True); s = np.bincount(inv, x); cc = np.bincount(inv)
    mu = x.mean(); se = np.sqrt(((s - cc * mu) ** 2).sum()) / len(x)
    return mu, se, len(ud)

t0 = time.time()
L = {}; C = {}
for m in MK:
    L[m] = dict(np.load(os.path.join(PO.OUTD, f"po_m{TF}_{m}.npz")))
    C[m] = context_arrays(PO.load_market(m), L[m])
    print(m, "context ready", f"{time.time() - t0:.0f}s", flush=True)
days = np.unique(L["real"]["day"]); MID = days[len(days) // 2]

def evaluate(m, fam, mode, ctx, c):
    R, Cm = L[m], C[m]
    rows, d = fam_rows(R, Cm, fam); side = d * (1 if mode == "with" else -1)
    k = ctx_mask(Cm, rows, side, ctx); rows, side = rows[k], side[k]
    return cell_R(R, rows, side, c), R["day"][rows], side

# baselines: random entry (both dirs) and context alone
def base_random(c):
    R = L["real"]; rows = np.arange(len(R["b"]))
    return np.nanmean(np.r_[cell_R(R, rows, np.ones(len(rows), np.int64), c), cell_R(R, rows, -np.ones(len(rows), np.int64), c)])
def base_ctx(ctx, c):
    R, Cm = L["real"], C["real"]; rows = np.arange(len(R["b"]))
    if ctx in ("reg_with", "reg_against"):
        s = Cm["reg"] * (1 if ctx == "reg_with" else -1); k = s != 0; return np.nanmean(cell_R(R, rows[k], s[k].astype(np.int64), c))
    if ctx in ("day_with", "day_against"):
        s = np.where(Cm["pos"] >= 0.5, 1, -1) * (1 if ctx == "day_with" else -1); return np.nanmean(cell_R(R, rows, s.astype(np.int64), c))
    return np.nan
BR = {cname(c): base_random(c) for c in CELLS}
out = []; nullz = []
for fam in FAMS:
    for mode in ("with", "against"):
        for ctx in CTX:
            for c in CELLS:
                r, day, side = evaluate("real", fam, mode, ctx, c)
                mu, se, nd = cstat(r, day)
                nl = [evaluate(m, fam, mode, ctx, c) for m in MK[1:]]
                ns = [cstat(x[0], x[1])[:2] for x in nl]
                nmu = np.array([a for a, _ in ns]); nse = np.array([b for _, b in ns])
                null_mu = np.nanmean(nmu); null_se = np.sqrt(np.nanmean(nse ** 2) / 3)
                ex = mu - null_mu; tex = ex / np.sqrt(se ** 2 + null_se ** 2)
                for k in range(3):   # calibration: null market k vs the other two
                    o = [j for j in range(3) if j != k]
                    nullz.append((nmu[k] - np.nanmean(nmu[o])) / np.sqrt(nse[k] ** 2 + np.nanmean(nse[o] ** 2) / 2))
                hh = []
                for first in (True, False):
                    hm = (day < MID) if first else (day >= MID); m_, s_, _ = cstat(r[hm], day[hm])
                    nh = [cstat(x[0][(x[1] < MID) if first else (x[1] >= MID)], x[1][(x[1] < MID) if first else (x[1] >= MID)])[0] for x in nl]
                    hh.append((m_ - np.nanmean(nh), s_))
                bs = []
                for sd in (1, -1):
                    k = side == sd; m_, s_, _ = cstat(r[k], day[k])
                    nb = [cstat(x[0][x[2] == sd], x[1][x[2] == sd])[0] for x in nl]
                    bs.append((m_ - np.nanmean(nb), s_))
                ok = np.isfinite(r); rr = r[ok]
                out.append(dict(fam=fam, mode=mode, ctx=ctx, cell=cname(c), kind=c[0], sl=c[1] if c[0] == "grid" else "", rr=("none" if c[0] == "grid" and c[2] is None else (c[2] if c[0] == "grid" else "")),
                                n=int(ok.sum()), days=nd, per_day=round(ok.sum() / len(days), 3), winrate=round(float(np.mean(rr > 0)), 3) if len(rr) else np.nan,
                                mean_R=round(mu, 4), se=round(se, 4), null_R=round(null_mu, 4), random_R=round(BR[cname(c)], 4),
                                ctx_only_R=round(base_ctx(ctx, c), 4) if ctx != "none" else np.nan, excess=round(ex, 4), t_excess=round(tex, 2),
                                h1=round(hh[0][0], 4), t_h1=round(hh[0][0] / hh[0][1], 2), h2=round(hh[1][0], 4), t_h2=round(hh[1][0] / hh[1][1], 2),
                                buy=round(bs[0][0], 4), t_buy=round(bs[0][0] / bs[0][1], 2), sell=round(bs[1][0], 4), t_sell=round(bs[1][0] / bs[1][1], 2)))
        print(fam, mode, f"{time.time() - t0:.0f}s", flush=True)
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
with open(os.path.join(PO.OUTD, f"po_eval2_m{TF}.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=list(out[0].keys())); w.writeheader(); w.writerows(out)
nz = np.abs(np.array(nullz)); nz = nz[np.isfinite(nz)]; tr = np.abs(np.array([o["t_excess"] for o in out], float)); tr = tr[np.isfinite(tr)]
txt = []
def say(s): print(s); txt.append(s)
say(f"cells {len(out)} | G1 {sum(o['G1'] for o in out)} G2 {sum(o['G2'] for o in out)} G3 {sum(o['G3'] for o in out)} G4 {sum(o['G4'] for o in out)} | all gates {sum(o['all'] for o in out)} | tradable (all gates, excess>0, mean R>0) {sum(o['tradable'] for o in out)}")
for th in (2, 3, 3.5, 4, 5):
    say(f"  |t| >= {th}: real {np.sum(tr >= th)}  expected by chance (random-direction calibration) {np.mean(nz >= th) * len(tr):.1f}")
tb = sorted([o for o in out if o["tradable"]], key=lambda o: -o["mean_R"])
say(f"\nTRADABLE ({len(tb)}), sorted by mean R:")
for o in tb[:60]:
    say(f"  {o['fam']:8s} {o['mode']:7s} {o['ctx']:11s} {o['cell']:15s} n/day {o['per_day']:5.2f} win {o['winrate']:.0%} R {o['mean_R']:+.3f} null {o['null_R']:+.3f}"
        f" random {o['random_R']:+.3f} ctx-only {o['ctx_only_R']:+.3f} t {o['t_excess']:+.1f} h {o['h1']:+.2f}/{o['h2']:+.2f} b/s {o['buy']:+.2f}/{o['sell']:+.2f}")
av = sorted([o for o in out if o["all"] and o["excess"] < 0], key=lambda o: o["excess"])
say(f"\nAVOID (all gates, worse than random-direction market) {len(av)}:")
for o in av[:30]:
    say(f"  {o['fam']:8s} {o['mode']:7s} {o['ctx']:11s} {o['cell']:15s} R {o['mean_R']:+.3f} null {o['null_R']:+.3f} excess {o['excess']:+.3f} t {o['t_excess']:+.1f}")
open(os.path.join(PO.OUTD, f"po_eval2_m{TF}.txt"), "w", encoding="utf-8").write("\n".join(txt))
print(f"done {time.time() - t0:.0f}s")

