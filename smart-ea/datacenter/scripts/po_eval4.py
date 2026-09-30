r"""Pattern-outcome library, layer 1b (user 2026-09-30): UNNAMED bar sequences on M1/M3/M5, evaluated as trade entries.
Bar code (36) = catalog step 3 code (cat_unnamed.codes, copied here because cat_unnamed runs its study at import):
  size = range / ATR20 of the 20 previous bars (< 0.5, 0.5-1, 1-2, >= 2) x body share of range (< 0.3, 0.3-0.7, >= 0.7) x close position
  in the bar (low / mid / high third).  Coarse code (6) = size (< 1 ATR, >= 1 ATR) x close position.
Sequences ending at bar b (all bars in the same session): 1 bar (36 codes), 2 bars (36 x 36), 3 bars coarse (6 x 6 x 6).
Direction of a sequence = where the closes point: last bar closes high -> +1, low -> -1, mid -> look at the bar before (then the one before);
all mid -> no direction (skipped). A sequence and its mirror image (every bar flipped) are ONE shape: shape key = the +1 member, so every
row gets (shape, direction). The evaluation trades WITH the direction or AGAINST it.
Cells = po_eval2 grid SL 0.5/1/2/3 ATR x TP 1/2/4R/none (16), context none. Same comparisons (3 random-direction markets), SE by day,
halves, BUY/SELL, neighbour cells, gates G1-G4 and search-wide calibration as po_eval2.
Usage: PO_TF=<tf> python po_eval4.py   Output: po\po_eval4_m<tf>.csv + .txt  (shape described in words)"""
import sys, os, csv, time
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, po_lib as PO, adx_ctx as X
src = open(r"C:\trade datacenter\scripts\po_eval2.py", encoding="utf-8").read().split("t0 = time.time()")[0]
ns = {}; exec(compile(src, "po_eval2_defs", "exec"), ns)
TF = int(os.environ.get("PO_TF", 5)); MK = ["real", "sf1", "sf2", "sf3"]
cname, cell_R, cstat, SLS, RRS = ns["cname"], ns["cell_R"], ns["cstat"], ns["SLS"], ns["RRS"]
CELLS = [c for c in ns["CELLS"] if c[0] == "grid"]
SIZE = ["tiny", "small", "big", "huge"]; BODY = ["wick", "mid-body", "full-body"]; POS = ["close-low", "close-mid", "close-high"]

def codes(B):
    o, h, l, c, atr = B["o"], B["h"], B["l"], B["c"], B["atr_prev"]; rng = h - l; ok = np.isfinite(atr) & (atr > 0) & (rng > 0)
    r = np.where(ok, rng / np.where(ok, atr, 1), 0); s = np.digitize(r, [0.5, 1, 2])
    bs = np.where(ok, np.abs(c - o) / np.where(rng > 0, rng, 1), 0); b = np.digitize(bs, [0.3, 0.7])
    cp = np.where(ok, (c - l) / np.where(rng > 0, rng, 1), 0.5); p = np.digitize(cp, [1 / 3, 2 / 3])
    return np.where(ok, s * 9 + b * 3 + p, -1), np.where(ok, (np.minimum(s, 2) // 2) * 3 + p, -1), np.where(ok, p, -1)
mir36 = lambda x: (x // 3) * 3 + (2 - x % 3)

def shapes(B, rows):
    """per library row: shape id (string key) and direction for L1 / L2 / L3 sequences ending at the row's bar"""
    f36, f6, p = codes(B); sid = B["sid"]; n = len(sid)
    prev = lambda a, k: np.r_[np.full(k, -1), a[:-k]]
    same1 = np.r_[False, sid[1:] == sid[:-1]]; same2 = same1 & np.r_[False, same1[:-1]]
    p1, p2 = prev(p, 1), prev(p, 2)
    def direction(ps):                       # ps = close positions from the LAST bar backwards
        d = np.zeros(n, np.int64); done = np.zeros(n, bool)
        for q in ps:
            d = np.where(~done & (q == 2), 1, np.where(~done & (q == 0), -1, d)); done |= (q == 0) | (q == 2)
        return d
    out = {}
    d1 = direction([p]); v1 = f36 >= 0
    k1 = np.where(d1 > 0, f36, mir36(f36))
    out["L1"] = (np.where(v1 & (d1 != 0), k1, -1), d1)
    a36 = prev(f36, 1); d2 = direction([p, p1]); v2 = v1 & same1 & (a36 >= 0)
    k2 = np.where(d2 > 0, a36 * 36 + f36, mir36(a36) * 36 + mir36(f36))
    out["L2"] = (np.where(v2 & (d2 != 0), k2, -1), d2)
    a6, b6 = prev(f6, 2), prev(f6, 1); d3 = direction([p, p1, p2]); v3 = (f6 >= 0) & (a6 >= 0) & (b6 >= 0) & same2
    m6 = lambda x: (x // 3) * 3 + (2 - x % 3)
    k3 = np.where(d3 > 0, a6 * 36 + b6 * 6 + f6, m6(a6) * 36 + m6(b6) * 6 + m6(f6))
    out["L3"] = (np.where(v3 & (d3 != 0), k3, -1), d3)
    return {L: (k[rows], d[rows]) for L, (k, d) in out.items()}

def describe(L, k):
    d36 = lambda x: f"{SIZE[x // 9]} {BODY[(x // 3) % 3]} {POS[x % 3]}"
    d6 = lambda x: f"{'small' if x // 3 == 0 else 'big'} {POS[x % 3]}"
    if L == "L1": return d36(k)
    if L == "L2": return d36(k // 36) + " > " + d36(k % 36)
    return d6(k // 36) + " > " + d6((k // 6) % 6) + " > " + d6(k % 6)

t0 = time.time(); L = {}; S = {}
for m in MK:
    L[m] = dict(np.load(os.path.join(PO.OUTD, f"po_m{TF}_{m}.npz")))
    S[m] = shapes(X.resample(PO.load_market(m), TF), L[m]["b"])
    print(m, "codes ready", f"{time.time() - t0:.0f}s", flush=True)
days = np.unique(L["real"]["day"]); MID = days[len(days) // 2]
MINROWS = 100                                                     # shapes seen < 100 times in the real market are not evaluated
jobs = []
for Ln in ("L1", "L2", "L3"):
    k, d = S["real"][Ln]; u, cnt = np.unique(k[k >= 0], return_counts=True)
    jobs += [(Ln, int(x)) for x, cc in zip(u, cnt) if cc >= MINROWS]
print("shapes to evaluate", len(jobs), {Ln: sum(j[0] == Ln for j in jobs) for Ln in ("L1", "L2", "L3")}, flush=True)
out = []; nullz = []
for ji, (Ln, key) in enumerate(jobs):
    base = {}
    for m in MK:
        k, d = S[m][Ln]; r = np.flatnonzero(k == key); base[m] = (r, d[r])
    for mode in ("with", "against"):
        sidem = {m: base[m][1] * (1 if mode == "with" else -1) for m in MK}
        for c in CELLS:
            res = {m: (cell_R(L[m], base[m][0], sidem[m], c), L[m]["day"][base[m][0]], sidem[m]) for m in MK}
            r, day, side = res["real"]; mu, se, nd = cstat(r, day)
            st = [cstat(res[m][0], res[m][1])[:2] for m in MK[1:]]; nmu = np.array([a for a, _ in st]); nse = np.array([b for _, b in st])
            null_mu = np.nanmean(nmu); null_se = np.sqrt(np.nanmean(nse ** 2) / 3); ex = mu - null_mu; tex = ex / np.sqrt(se ** 2 + null_se ** 2)
            for kk in range(3):
                o = [j for j in range(3) if j != kk]
                nullz.append((nmu[kk] - np.nanmean(nmu[o])) / np.sqrt(nse[kk] ** 2 + np.nanmean(nse[o] ** 2) / 2))
            hh = []
            for first in (True, False):
                sel = lambda dd: (dd < MID) if first else (dd >= MID)
                m_, s_, _ = cstat(r[sel(day)], day[sel(day)])
                hh.append((m_ - np.nanmean([cstat(res[m][0][sel(res[m][1])], res[m][1][sel(res[m][1])])[0] for m in MK[1:]]), s_))
            bs = []
            for sd in (1, -1):
                q = side == sd; m_, s_, _ = cstat(r[q], day[q])
                bs.append((m_ - np.nanmean([cstat(res[m][0][res[m][2] == sd], res[m][1][res[m][2] == sd])[0] for m in MK[1:]]), s_))
            ok = np.isfinite(r); rr = r[ok]
            out.append(dict(len=Ln, shape=key, desc=describe(Ln, key), mode=mode, cell=cname(c), sl=c[1], rr="none" if c[2] is None else c[2],
                            n=int(ok.sum()), n_null=int(np.mean([len(base[m][0]) for m in MK[1:]])), days=nd, per_day=round(ok.sum() / len(days), 3),
                            winrate=round(float(np.mean(rr > 0)), 3) if len(rr) else np.nan, mean_R=round(mu, 4), se=round(se, 4), null_R=round(null_mu, 4),
                            excess=round(ex, 4), t_excess=round(tex, 2), h1=round(hh[0][0], 4), t_h1=round(hh[0][0] / hh[0][1], 2),
                            h2=round(hh[1][0], 4), t_h2=round(hh[1][0] / hh[1][1], 2), buy=round(bs[0][0], 4), t_buy=round(bs[0][0] / bs[0][1], 2),
                            sell=round(bs[1][0], 4), t_sell=round(bs[1][0] / bs[1][1], 2)))
    if ji % 50 == 0: print(ji, "/", len(jobs), f"{time.time() - t0:.0f}s", flush=True)
key = {(o["len"], o["shape"], o["mode"], o["cell"]): o for o in out}
for o in out:
    sg = np.sign(o["excess"])
    o["G1"] = bool(abs(o["t_excess"]) >= 3.5 and o["days"] >= 100)
    o["G2"] = bool(np.sign(o["h1"]) == sg == np.sign(o["h2"]) and abs(o["t_h1"]) >= 1.5 and abs(o["t_h2"]) >= 1.5)
    o["G3"] = bool(np.sign(o["buy"]) == sg == np.sign(o["sell"]) and abs(o["t_buy"]) >= 1.5 and abs(o["t_sell"]) >= 1.5)
    si = SLS.index(o["sl"]); ri = RRS.index(None if o["rr"] == "none" else o["rr"]); nb = []
    for ds, dr in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        if 0 <= si + ds < len(SLS) and 0 <= ri + dr < len(RRS):
            nb.append(np.sign(key[(o["len"], o["shape"], o["mode"], cname(("grid", SLS[si + ds], RRS[ri + dr])))]["excess"]) == sg)
    o["G4"] = bool(nb) and np.mean(nb) >= 0.75
    o["all"] = o["G1"] and o["G2"] and o["G3"] and o["G4"]
    o["tradable"] = o["all"] and o["excess"] > 0 and o["mean_R"] > 0
with open(os.path.join(PO.OUTD, f"po_eval4_m{TF}.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=list(out[0].keys())); w.writeheader(); w.writerows(out)
nz = np.abs(np.array(nullz)); nz = nz[np.isfinite(nz)]; tr = np.abs(np.array([o["t_excess"] for o in out], float)); tr = tr[np.isfinite(tr)]
txt = []
def say(s): print(s); txt.append(s)
say(f"M{TF} layer 1b: shapes {len(jobs)} cells {len(out)} | G1 {sum(o['G1'] for o in out)} G2 {sum(o['G2'] for o in out)} G3 {sum(o['G3'] for o in out)} G4 {sum(o['G4'] for o in out)} | all {sum(o['all'] for o in out)} | tradable {sum(o['tradable'] for o in out)}")
for th in (2, 3, 3.5, 4, 5):
    say(f"  |t| >= {th}: real {np.sum(tr >= th)}  expected by chance {np.mean(nz >= th) * len(tr):.1f}")
say(f"  null-vs-null z sd {np.std(np.array(nullz)[np.isfinite(nullz)]):.3f}")
for title, sel, srt in (("TRADABLE", lambda o: o["tradable"], lambda o: -o["mean_R"]),
                        ("NEAR (mean R > 0, excess > 0, t >= 3, not every gate)", lambda o: o["mean_R"] > 0 and o["excess"] > 0 and o["t_excess"] >= 3 and not o["tradable"], lambda o: -o["t_excess"]),
                        ("AVOID (all gates, excess < 0)", lambda o: o["all"] and o["excess"] < 0, lambda o: o["excess"]),
                        ("STRONGEST |t| (any sign)", lambda o: abs(o["t_excess"]) >= 3.5, lambda o: -abs(o["t_excess"]))):
    lst = sorted([o for o in out if sel(o)], key=srt); say(f"\n{title}: {len(lst)}")
    for o in lst[:30]:
        g = "".join("1" if o[k] else "0" for k in ("G1", "G2", "G3", "G4"))
        say(f"  {o['len']} {o['desc']:62s} {o['mode']:7s} {o['cell']:12s} n/d {o['per_day']:6.2f} (null {o['n_null'] / len(days):6.2f}) win {o['winrate']:.0%} R {o['mean_R']:+.3f} null {o['null_R']:+.3f} t {o['t_excess']:+.1f} h {o['h1']:+.2f}/{o['h2']:+.2f} b/s {o['buy']:+.2f}/{o['sell']:+.2f} G{g}")
open(os.path.join(PO.OUTD, f"po_eval4_m{TF}.txt"), "w", encoding="utf-8").write("\n".join(txt))
print(f"done {time.time() - t0:.0f}s")
