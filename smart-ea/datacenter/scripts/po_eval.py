r"""Pilot report of the pattern-outcome library (M5): 4 pattern families x trade with / against the pattern x SL/TP grid (+ stop behind
the bar's wick, trailing, break-even at +1 ATR). Every cell compared with (a) the same pattern in 3 random-direction markets and
(b) a random entry (every bar, both directions). Gates fixed before looking at results:
  G1 |t| of (real - random-direction) >= 3 and >= 100 trading days with the pattern
  G2 both halves (by trading day) the same sign as the whole, |t| >= 1.5 each (real mean R minus null mean R of that half)
  G3 BUY and SELL trades the same sign, |t| >= 1.5 each
  G4 neighbour cells (SL one step, TP one step) the same sign in >= 75% of the neighbours
SE = clustered by trading day (events of one day are not independent). Output: po\po_eval_m5.csv (every cell) + po_eval_m5.txt"""
import sys, os, csv
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, po_lib as PO

TF = 5; MK = ["real", "sf1", "sf2", "sf3"]
L = {m: dict(np.load(os.path.join(PO.OUTD, f"po_m{TF}_{m}.npz"))) for m in MK}
B = {n: 1 << i for i, n in enumerate(["big", "pin", "vspike", "inside", "pivot", "regime", "boxbreak", "pdh", "pdl", "dayhigh", "daylow",
                                      "asiahigh", "asialow", "check"])}
days_all = np.unique(L["real"]["day"]); MID = days_all[len(days_all) // 2]

def events(R, fam):
    """rows and pattern direction (+1 / -1) of one family"""
    fl = R["flags"]
    if fam == "pin": m = (fl & B["pin"]) != 0; d = R["dir_pin"]
    elif fam == "big": m = (fl & B["big"]) != 0; d = R["dir_big"]
    elif fam == "pivot": m = (fl & B["pivot"]) != 0; d = R["dir_piv"]
    elif fam == "pdx":
        up = (fl & B["pdh"]) != 0; dn = (fl & B["pdl"]) != 0; m = up ^ dn; d = np.where(up, 1, -1)
    rows = np.flatnonzero(m & (d != 0)); return rows, d[rows]

def cstat(x, day):
    """mean, clustered SE by day, n days"""
    x = np.asarray(x, float); ok = np.isfinite(x); x = x[ok]; day = day[ok]
    if len(x) < 30: return np.nan, np.nan, 0
    ud, inv = np.unique(day, return_inverse=True); s = np.bincount(inv, x); c = np.bincount(inv)
    mu = x.mean(); r = s - c * mu; se = np.sqrt((r ** 2).sum()) / len(x)
    return mu, se, len(ud)

LVi = lambda v: int(np.flatnonzero(np.isclose(PO.LV, v))[0])
SLS = [0.5, 1, 1.5, 2, 3, 4]; RRS = [0.5, 1, 1.5, 2, 3, 4, 6, None]

def cell_R(R, rows, side, spec):
    kind = spec[0]
    if kind == "grid":
        _, s, rr, be = spec
        return PO.trade_R(R, rows, side, LVi(s), None if rr is None else LVi(s * rr), be)
    if kind == "struct":
        return PO.trade_R_struct(R, rows, side, spec[1])
    if kind == "trail":
        k = spec[1]; d = PO.TR_D[k]
        v = (R["tr_b"] if side > 0 else R["tr_s"])
        return v[rows, k] / d - PO.COST / (d * R["atr"][rows])

specs = [("grid", s, rr, None) for s in SLS for rr in RRS] + [("grid", s, rr, 1) for s in (1, 1.5, 2, 3) for rr in (2, 3, 4, 6, None)] \
      + [("struct", k) for k in range(len(PO.RR))] + [("trail", k) for k in range(len(PO.TR_D))]
def spec_name(sp):
    if sp[0] == "grid": return f"SL{sp[1]}_TP{'none' if sp[2] is None else sp[2]}R" + ("_BE1" if sp[3] is not None else "")
    if sp[0] == "struct": return f"SLwick_TP{PO.RR[sp[1]]}R"
    return f"trail{PO.TR_D[sp[1]]}"

def results(R, fam, mode, sp):
    rows, d = events(R, fam); side = d * (1 if mode == "with" else -1)
    r = np.empty(len(rows))
    for sd in (1, -1):
        k = side == sd
        if k.any(): r[k] = cell_R(R, rows[k], sd, sp)
    return r, R["day"][rows], side

def random_entry(R, sp):
    rows = np.arange(len(R["b"]))
    a = cell_R(R, rows, 1, sp); b = cell_R(R, rows, -1, sp)
    return np.nanmean(np.r_[a, b])

out = []; txt = []
base = {spec_name(sp): random_entry(L["real"], sp) for sp in specs}
for fam in ("pin", "big", "pdx", "pivot"):
    for mode in ("with", "against"):
        for sp in specs:
            nm = spec_name(sp)
            r, day, side = results(L["real"], fam, mode, sp)
            mu, se, nd = cstat(r, day)
            nulls = [results(L[m], fam, mode, sp) for m in MK[1:]]
            nmu = [cstat(x[0], x[1])[:2] for x in nulls]
            null_mu = np.nanmean([a for a, _ in nmu]); null_se = np.sqrt(np.nanmean([b ** 2 for _, b in nmu]) / 3)
            ex = mu - null_mu; ex_t = ex / np.sqrt(se ** 2 + null_se ** 2)
            h = []
            for first in (True, False):
                hm = (day < MID) if first else (day >= MID)
                m_, s_, _ = cstat(r[hm], day[hm])
                nh = []
                for x in nulls:
                    xm = (x[1] < MID) if first else (x[1] >= MID)
                    nh.append(cstat(x[0][xm], x[1][xm])[0])
                h.append((m_ - np.nanmean(nh), s_))
            bs = []
            for sd in (1, -1):
                k = side == sd; m_, s_, _ = cstat(r[k], day[k])
                nb = [cstat(x[0][x[2] == sd], x[1][x[2] == sd])[0] for x in nulls]
                bs.append((m_ - np.nanmean(nb), s_))
            win = np.nanmean(r > 0); aw = np.nanmean(r[r > 0]) if (r > 0).any() else np.nan; al = np.nanmean(r[r <= 0]) if (r <= 0).any() else np.nan
            out.append(dict(fam=fam, mode=mode, cell=nm, kind=sp[0], sl=sp[1] if sp[0] == "grid" else "", rr=(sp[2] if sp[0] == "grid" else ""),
                            n=int(np.isfinite(r).sum()), days=nd, per_day=round(np.isfinite(r).sum() / len(days_all), 2),
                            winrate=round(win, 3), avg_win=round(aw, 3), avg_loss=round(al, 3), mean_R=round(mu, 4), se=round(se, 4),
                            null_R=round(null_mu, 4), random_entry_R=round(base[nm], 4), excess=round(ex, 4), t_excess=round(ex_t, 2),
                            h1=round(h[0][0], 4), t_h1=round(h[0][0] / h[0][1], 2), h2=round(h[1][0], 4), t_h2=round(h[1][0] / h[1][1], 2),
                            buy=round(bs[0][0], 4), t_buy=round(bs[0][0] / bs[0][1], 2), sell=round(bs[1][0], 4), t_sell=round(bs[1][0] / bs[1][1], 2)))
# gates
key = {(o["fam"], o["mode"], o["cell"]): o for o in out}
for o in out:
    sg = np.sign(o["excess"])
    o["G1"] = abs(o["t_excess"]) >= 3 and o["days"] >= 100
    o["G2"] = np.sign(o["h1"]) == sg == np.sign(o["h2"]) and abs(o["t_h1"]) >= 1.5 and abs(o["t_h2"]) >= 1.5
    o["G3"] = np.sign(o["buy"]) == sg == np.sign(o["sell"]) and abs(o["t_buy"]) >= 1.5 and abs(o["t_sell"]) >= 1.5
    nb = []
    if o["kind"] == "grid" and "BE" not in o["cell"]:
        si = SLS.index(o["sl"]); ri = RRS.index(o["rr"] if o["rr"] != "" else None)
        for ds, dr in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            if 0 <= si + ds < len(SLS) and 0 <= ri + dr < len(RRS):
                nm = f"SL{SLS[si + ds]}_TP{'none' if RRS[ri + dr] is None else RRS[ri + dr]}R"
                nb.append(np.sign(key[(o["fam"], o["mode"], nm)]["excess"]) == sg)
    o["G4"] = bool(nb) and np.mean(nb) >= 0.75
    o["all"] = o["G1"] and o["G2"] and o["G3"] and o["G4"]
fn = os.path.join(PO.OUTD, "po_eval_m5.csv")
with open(fn, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=list(out[0].keys())); w.writeheader(); w.writerows(out)
def say(s): print(s); txt.append(s)
say(f"cells {len(out)} | G1 {sum(o['G1'] for o in out)} G2 {sum(o['G2'] for o in out)} G3 {sum(o['G3'] for o in out)} G4 {sum(o['G4'] for o in out)} all {sum(o['all'] for o in out)}")
say(f"|t_excess| >= 3: {sum(abs(o['t_excess']) >= 3 for o in out if np.isfinite(o['t_excess']))} of {len(out)}  (>= 2: {sum(abs(o['t_excess']) >= 2 for o in out if np.isfinite(o['t_excess']))})")
for fam in ("pin", "big", "pdx", "pivot"):
    for mode in ("with", "against"):
        cs = [o for o in out if o["fam"] == fam and o["mode"] == mode]
        b = max(cs, key=lambda o: o["mean_R"] if np.isfinite(o["mean_R"]) else -9)
        e = max(cs, key=lambda o: o["t_excess"] if np.isfinite(o["t_excess"]) else -99)
        say(f"{fam:6s} {mode:8s} n/day {cs[0]['per_day']:5.2f} | best mean R {b['cell']:16s} {b['mean_R']:+.3f} (win {b['winrate']:.0%}, null {b['null_R']:+.3f}, random {b['random_entry_R']:+.3f})"
            f" | best excess {e['cell']:16s} {e['excess']:+.3f} t {e['t_excess']:+.1f} gates {''.join('1' if e[g] else '.' for g in ('G1','G2','G3','G4'))}")
for o in [o for o in out if o["all"]]:
    say(f"PASS {o['fam']} {o['mode']} {o['cell']}: R {o['mean_R']:+.3f} win {o['winrate']:.0%} (+{o['avg_win']}/{o['avg_loss']}) null {o['null_R']:+.3f} excess {o['excess']:+.3f} t {o['t_excess']:+.1f}"
        f" halves {o['h1']:+.3f}/{o['h2']:+.3f} buy/sell {o['buy']:+.3f}/{o['sell']:+.3f} n/day {o['per_day']}")
open(os.path.join(PO.OUTD, "po_eval_m5.txt"), "w", encoding="utf-8").write("\n".join(txt))
