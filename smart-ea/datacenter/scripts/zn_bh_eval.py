r"""Step 4 evaluation: which behaviour on a bar while price is IN the zone separates "reversal" from "break", and what does an entry
after that bar (next M1 open, no limit) give, per obs TF M1 / M3 / M5.
Rows = zn_bh stretch bars. Groups = each zone type + pooled "reason" (zn_ev.REASON) + pooled "pass" (zn_ev.PASS).
Measures: hit1 (= +1 ATR before -1 ATR, the separation question; primary) and the R cells of zn_bh.CELLS (tradability, after cost).
Directions: rev (trade the reversal = event side) / brk (trade the break).
Comparisons (as step 3): real vs the 3 random-direction markets (zones rebuilt there) -> excess, t (SE by trading day); vs fake zones
(+-2 ATR, real); vs 'any' stretch bar of the same group. Gates G1 |t| >= 3.5 & >= 100 days, G2 halves, G3 from above / below, G4 fake
same sign |t| >= 2, G5 approach distance D 0.5 / 2 same sign |t| >= 1.5. Calibration per measure family: random market vs the other two.
Unnamed codes (oriented 36-code of the bar, 36x36 two-bar code with >= 300 real rows) for the pooled groups, hit1 + SL1_TP2R.
Output zn\zn_bh_eval_m<tf>.csv + zn_bh_eval.txt (all TFs)."""
import sys, os, csv, time
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, zn_ev as EV, zn_bh as BH
OUT = r"C:\trade datacenter\zn"; MK = ["real", "sf1", "sf2", "sf3"]; MEAS = ["hit1"] + [c[0] for c in BH.CELLS]
GROUPS = [(t, [t]) for t in EV.TYPES] + [("REASON", EV.REASON), ("PASS", EV.PASS)]
txt = []
def say(s=""): print(s, flush=True); txt.append(s)

class Data:
    def __init__(self, tf):
        self.E = {m: np.load(os.path.join(OUT, f"zn_ev_m{tf}_{m}.npz")) for m in MK}
        self.H = {m: np.load(os.path.join(OUT, f"zn_bh_m{tf}_{m}.npz")) for m in MK}
        self.base = {}
        allday = np.unique(self.H["real"]["v0_day"]); self.days = allday; self.MID = allday[len(allday) // 2]
        for m in MK:
            for vi in range(len(EV.VARIANTS)):
                if m != "real" and vi in (3, 4): continue
                ev = self.H[m][f"v{vi}_ev"]; e = self.E[m]
                d = self.H[m][f"v{vi}_day"]
                self.base[(m, vi)] = dict(type=e[f"v{vi}_type"][ev], side=e[f"v{vi}_side"][ev], bits=self.H[m][f"v{vi}_bits"], k1=self.H[m][f"v{vi}_k1"],
                                         k2=self.H[m][f"v{vi}_k2"], di=np.searchsorted(allday, d), h1=d < self.MID)
        self.cache = {}; self.ix = {}
    def y(self, m, vi, dirn, meas):
        k = (m, vi, dirn, meas)
        if k not in self.cache: self.cache[k] = self.H[m][f"v{vi}_{dirn}_{meas}"]
        return self.cache[k]
    def select(self, sel):
        """row indices of sel for every (market, variant), computed once per selection"""
        self.ix = {k: np.flatnonzero(sel(b)) for k, b in self.base.items()}
    def drop(self): self.cache = {}

def cstat(y, di, nd):
    ok = np.isfinite(y); y = y[ok]; di = di[ok]
    if len(y) < 30: return np.nan, np.nan, 0
    s = np.bincount(di, y, nd); cc = np.bincount(di, minlength=nd); mu = y.mean()
    return mu, np.sqrt(((s - cc * mu) ** 2).sum()) / len(y), int((cc > 0).sum())

def test(Dt, dirn, meas, nullz):
    """rows = Dt.ix (set by Dt.select). Returns dict of stats or None"""
    nd = len(Dt.days)
    def st(m, vi, sub=None):
        b = Dt.base[(m, vi)]; idx = Dt.ix[(m, vi)]
        if sub is not None: idx = idx[sub({"h1": b["h1"][idx], "side": b["side"][idx]})]
        return cstat(Dt.y(m, vi, dirn, meas)[idx].astype(float), b["di"][idx], nd), len(idx)
    (mu, se, ndays), n = st("real", 0)
    if not np.isfinite(mu): return None
    ns = [st(m, 0)[0] for m in MK[1:]]; nmu = np.array([a[0] for a in ns]); nse = np.array([a[1] for a in ns])
    null = np.nanmean(nmu); nsd = np.sqrt(np.nanmean(nse ** 2) / 3); ex = mu - null; t = ex / np.sqrt(se ** 2 + nsd ** 2)
    for z in range(3):
        o = [x for x in range(3) if x != z]; nullz.append((nmu[z] - np.nanmean(nmu[o])) / np.sqrt(nse[z] ** 2 + np.nanmean(nse[o] ** 2) / 2))
    f = [st("real", vi)[0] for vi in (3, 4)]
    fmu = np.nanmean([a[0] for a in f]); fse = np.sqrt(np.nanmean([a[1] ** 2 for a in f]) / 2); exf = mu - fmu; tf_ = exf / np.sqrt(se ** 2 + fse ** 2)
    part = {}
    for nm, sub in (("h1", lambda b: b["h1"]), ("h2", lambda b: ~b["h1"]), ("above", lambda b: b["side"] > 0), ("below", lambda b: b["side"] < 0)):
        (m_, s_, _), _ = st("real", 0, sub); nn = [st(m, 0, sub)[0][0] for m in MK[1:]]; e_ = m_ - np.nanmean(nn); part[nm] = (e_, e_ / s_ if s_ else np.nan)
    for vi, nm in ((1, "D05"), (2, "D2")):
        (m_, s_, _), _ = st("real", vi); nn = [st(m, vi)[0] for m in MK[1:]]
        n_ = np.nanmean([a[0] for a in nn]); q_ = np.sqrt(np.nanmean(np.array([a[1] for a in nn]) ** 2) / 3); e_ = m_ - n_; part[nm] = (e_, e_ / np.sqrt(s_ ** 2 + q_ ** 2) if s_ else np.nan)
    sg = np.sign(ex); ok2 = lambda h, th: np.sign(part[h][0]) == sg and abs(part[h][1]) >= th
    G = dict(G1=bool(abs(t) >= 3.5 and ndays >= 100), G2=ok2("h1", 1.5) and ok2("h2", 1.5), G3=ok2("above", 1.5) and ok2("below", 1.5),
             G4=bool(np.sign(exf) == sg and abs(tf_) >= 2), G5=ok2("D05", 1.5) and ok2("D2", 1.5))
    G["all"] = all(G.values())
    return dict(n=n, per_day=round(n / nd, 3), days=ndays, mean=round(mu, 4), random=round(null, 4), excess=round(ex, 4), t=round(t, 2), fake=round(fmu, 4),
                t_fake=round(tf_, 2), **{f"{k}": round(v[0], 4) for k, v in part.items()}, **{f"t_{k}": round(v[1], 2) for k, v in part.items()}, **G)

def describe_rows(Dt, sel, dirn, tf):
    b = Dt.base[("real", 0)]; idx = np.flatnonzero(sel(b)); H = Dt.H["real"]; atr = H["v0_atr"][idx].astype(float)
    r = {k: H[f"v0_{dirn}_{k}"][idx].astype(float) for k in ("mfe24", "mae24", "t_up1", "t_dn1", "SL1_TP2R", "SL2_TP2R")}
    w = r["SL1_TP2R"]; w = w[np.isfinite(w)]
    tu = r["t_up1"][r["t_up1"] >= 0]; td = r["t_dn1"][r["t_dn1"] >= 0]
    return (f"MFE24 med {np.median(r['mfe24']):.2f} ATR (${np.median(r['mfe24'] * atr):.2f} = {np.median(r['mfe24'] * atr) * 100:.0f} pts) | MAE24 med {np.median(r['mae24']):.2f} ATR "
            f"(${np.median(r['mae24'] * atr):.2f}) | +1 ATR in {np.median(tu) if len(tu) else np.nan:.0f} min, -1 ATR in {np.median(td) if len(td) else np.nan:.0f} min | "
            f"SL1/TP2R win {np.mean(w > 0):.1%} avg win {w[w > 0].mean() if (w > 0).any() else np.nan:+.2f} loss {w[w <= 0].mean() if (w <= 0).any() else np.nan:+.2f} R")

allrows = []; calib = {"hit1": [], "R": [], "code": []}
for tf in EV.OBS:
    t0 = time.time(); Dt = Data(tf); out = []
    gid = {g: np.array([EV.TYPES.index(x) for x in tys]) for g, tys in GROUPS}
    ing = {g: {k: np.isin(b["type"], gid[g]) for k, b in Dt.base.items()} for g, _ in GROUPS}
    for g, _ in GROUPS:
        for lab in BH.LABELS:
            bit = BH.BIT[lab]; Dt.ix = {k: np.flatnonzero(ing[g][k] & ((b["bits"] & bit) != 0)) for k, b in Dt.base.items()}
            for meas in MEAS:
                for dirn in ("rev", "brk"):
                    r = test(Dt, dirn, meas, calib["hit1" if meas == "hit1" else "R"])
                    if r: out.append(dict(tf=tf, kind="named", group=g, label=lab, dir=dirn, meas=meas, **r))
        print(f"M{tf} {g} {time.time() - t0:.0f}s", flush=True)
    rv = Dt.base[("real", 0)]
    for g in ("REASON", "PASS"):
        cand = [("code1", int(c)) for c in range(36)] + [("code2", int(c)) for c, n in zip(*np.unique(rv["k2"][ing[g][("real", 0)] & (rv["k2"] >= 0)], return_counts=True)) if n >= 300]
        for kind, c in cand:
            Dt.ix = {k: np.flatnonzero(ing[g][k] & ((b["k1"] if kind == "code1" else b["k2"]) == c)) for k, b in Dt.base.items()}
            for meas in ("hit1", "SL1_TP2R"):
                for dirn in ("rev", "brk"):
                    r = test(Dt, dirn, meas, calib["code"])
                    if r: out.append(dict(tf=tf, kind=kind, group=g, label=str(c), dir=dirn, meas=meas, **r))
        print(f"M{tf} codes {g} {len(cand)} {time.time() - t0:.0f}s", flush=True)
    print(f"M{tf} done {time.time() - t0:.0f}s", flush=True)
    for o in out:
        if o["all"] and o["kind"] == "named":
            sel = lambda b, tys=gid[o["group"]], bit=BH.BIT[o["label"]]: np.isin(b["type"], tys) & ((b["bits"] & bit) != 0)
            o["desc"] = describe_rows(Dt, sel, o["dir"], tf)
    allrows += out
    with open(os.path.join(OUT, f"zn_bh_eval_m{tf}.csv"), "w", newline="", encoding="utf-8") as fh:
        keys = sorted({k for o in out for k in o}, key=lambda k: list(out[0].keys()).index(k) if k in out[0] else 999)
        w = csv.DictWriter(fh, fieldnames=keys); w.writeheader(); w.writerows(out)

def describe_code(kind, c):
    S = ["tiny", "small", "big", "huge"]; Bd = ["wick", "mid-body", "full-body"]; P = ["close-low", "close-mid", "close-high"]
    d = lambda x: f"{S[x // 9]} {Bd[(x // 3) % 3]} {P[x % 3]}"
    return d(c) if kind == "code1" else d(c // 36) + " > " + d(c % 36)
for fam, nm in (("hit1", "named / hit1"), ("R", "named / R cells"), ("code", "unnamed codes")):
    z = np.array(calib[fam]); z = z[np.isfinite(z)]
    rs = [o for o in allrows if (o["kind"] == "named" and (o["meas"] == "hit1") == (fam == "hit1") and fam != "code") or (fam == "code" and o["kind"] != "named")]
    say(f"\n[{nm}] tests {len(rs)} | |t| >= 3: {sum(abs(o['t']) >= 3 for o in rs)} vs chance {np.mean(np.abs(z) >= 3) * len(rs):.1f} | |t| >= 3.5: "
        f"{sum(abs(o['t']) >= 3.5 for o in rs)} vs {np.mean(np.abs(z) >= 3.5) * len(rs):.1f} (random vs random sd {z.std():.2f}) | "
        + " ".join(f"{g} {sum(o[g] for o in rs)}" for g in ("G1", "G2", "G3", "G4", "G5", "all")))
    for o in sorted([o for o in rs if o["all"]], key=lambda o: (o["tf"], -abs(o["t"]))):
        lab = o["label"] if o["kind"] == "named" else describe_code(o["kind"], int(o["label"]))
        say(f"  M{o['tf']} {o['group']:11s} {lab:28s} {o['dir']} {o['meas']:11s} n {o['n']} ({o['per_day']}/day) {o['mean']:+.3f} random {o['random']:+.3f} ex {o['excess']:+.3f} "
            f"t {o['t']:+.1f} | fake {o['fake']:+.3f} t {o['t_fake']:+.1f} | h {o['h1']:+.3f}/{o['h2']:+.3f} ab/be {o['above']:+.3f}/{o['below']:+.3f}")
        if o.get("desc"): say("      " + o["desc"])
open(os.path.join(OUT, "zn_bh_eval.txt"), "w", encoding="utf-8").write("\n".join(txt))
