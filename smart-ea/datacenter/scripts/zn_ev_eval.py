r"""Step 3 evaluation: after price ENTERS a zone (zn_ev events), does it reverse or break more often than it would without the zone?
Measure (fixed before results) = reversal share among resolved events (reversal k ATR before break k ATR; stalls excluded, their share is
reported), k = 1 and 2 (k = 3 reported). Per obs TF x zone type x condition:
  real (variant D=1) vs random-direction markets (same zones rebuilt there, mean of 3) -> excess, t (SE clustered by trading day)
  vs fake zones (same instance +-2 ATR, real market) -> zone effect beyond "price touched a line"
Conditions: all | first touch / touched before | zone created today / older (static zones) | approach speed v3 tertile | approach leg
  leg12 tertile | side agrees with the zone's role (support from above, resistance from below) / against (zones with a role).
  Tertile edges = real-market quantiles per TF x type, used for every market / variant.
Gates: G1 |t vs random| >= 3.5 and >= 100 days | G2 both halves (trading day) same sign, |t| >= 1.5 | G3 from above and from below same
  sign, |t| >= 1.5 | G4 vs fake zones same sign, |t| >= 2 | G5 neighbour approach distance D = 0.5 and 2 ATR same sign, |t| >= 1.5.
Search-wide calibration: each random market vs the other two (z), share |z| >= 3 -> expected chance count.
Output zn\zn_ev_eval.csv (every test) + zn_ev_eval.txt"""
import sys, os, csv
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, adx_ctx as X, zn_ev as EV
OUT = r"C:\trade datacenter\zn"; MK = ["real", "sf1", "sf2", "sf3"]; TY = EV.TYPES
M = X.load(None)

def cstat(y, day):
    ok = np.isfinite(y); y = y[ok]; day = day[ok]
    if len(y) < 30: return np.nan, np.nan, 0
    ud, inv = np.unique(day, return_inverse=True); s = np.bincount(inv, y); cc = np.bincount(inv)
    mu = y.mean(); return mu, np.sqrt(((s - cc * mu) ** 2).sum()) / len(y), len(ud)

rows = []; nullz = []; txt = []
def say(s=""): print(s, flush=True); txt.append(s)
for tf in EV.OBS:
    B = EV.obs_bars(M, tf); days = np.unique(B["day"]); MID = days[len(days) // 2]
    E = {m: dict(np.load(os.path.join(OUT, f"zn_ev_m{tf}_{m}.npz"))) for m in MK}
    say(f"\n===== M{tf} =====")
    def get(m, vi, ti):
        e = E[m]; k = e[f"v{vi}_type"] == ti
        return {x: e[f"v{vi}_{x}"][k] for x in ("j", "side", "role", "prior", "today", "v3", "leg12", "oc", "tm")} | {"day": B["day"][e[f"v{vi}_j"][k]]}
    for ti, ty in enumerate(TY):
        G = {(m, vi): get(m, vi, ti) for m in MK for vi in range(len(EV.VARIANTS))}
        g0 = G[("real", 0)]; nd = len(days)
        edges = {f: np.nanquantile(g0[f], [1 / 3, 2 / 3]) for f in ("v3", "leg12")}
        conds = [("all", lambda g: np.ones(len(g["j"]), bool)), ("first", lambda g: ~g["prior"]), ("again", lambda g: g["prior"])]
        if ty not in EV.LINES and ty not in ("rn50", "rn100"):
            conds += [("today", lambda g: g["today"]), ("older", lambda g: ~g["today"])]
        for f in ("v3", "leg12"):
            for q, nm in enumerate(("low", "mid", "high")):
                lo_, hi_ = (-np.inf, *edges[f], np.inf)[q], (-np.inf, *edges[f], np.inf)[q + 1]
                conds.append((f"{f}_{nm}", lambda g, f=f, lo_=lo_, hi_=hi_: (g[f] >= lo_) & (g[f] < hi_)))
        if np.any(g0["role"] != 0):
            conds += [("role_with", lambda g: g["role"] * g["side"] > 0), ("role_against", lambda g: g["role"] * g["side"] < 0)]
        oc0 = g0["oc"]
        say(f"{ty:12s} {len(g0['j']) / nd:6.1f}/day  k1 rev/brk/stall {np.mean(oc0[:, 0] == 1):.2f}/{np.mean(oc0[:, 0] == -1):.2f}/{np.mean(oc0[:, 0] == 0):.2f}"
            f"  k2 {np.mean(oc0[:, 1] == 1):.2f}/{np.mean(oc0[:, 1] == -1):.2f}/{np.mean(oc0[:, 1] == 0):.2f}")
        for cn, cf in conds:
            for kk, k in enumerate(EV.KS):
                def ys(m, vi, extra=None):
                    g = G[(m, vi)]; c = cf(g)
                    if extra is not None: c = c & extra(g)
                    o = g["oc"][c, kk]; y = np.where(o == 1, 1.0, np.where(o == -1, 0.0, np.nan))
                    return y, g["day"][c], g["side"][c], np.mean(o == 0) if len(o) else np.nan
                y, d, sd, stall = ys("real", 0); mu, se, ndays = cstat(y, d)
                if not np.isfinite(mu): continue
                nl = [ys(m, 0) for m in MK[1:]]; ns = [cstat(a, b)[:2] for a, b, *_ in nl]
                nmu = np.array([a for a, _ in ns]); nse = np.array([b for _, b in ns]); null = np.nanmean(nmu); nsd = np.sqrt(np.nanmean(nse ** 2) / 3)
                ex = mu - null; t = ex / np.sqrt(se ** 2 + nsd ** 2)
                for z in range(3):
                    o_ = [x for x in range(3) if x != z]; nullz.append((nmu[z] - np.nanmean(nmu[o_])) / np.sqrt(nse[z] ** 2 + np.nanmean(nse[o_] ** 2) / 2))
                fk = [ys("real", vi) for vi in (3, 4)]; fy = np.r_[fk[0][0], fk[1][0]]; fd = np.r_[fk[0][1], fk[1][1]]
                fmu, fse, _ = cstat(fy, fd); exf = mu - fmu; tf_ = exf / np.sqrt(se ** 2 + fse ** 2) if np.isfinite(fmu) else np.nan
                part = {}
                for nm, sel in (("h1", lambda g: g["day"] < MID), ("h2", lambda g: g["day"] >= MID), ("above", lambda g: g["side"] > 0), ("below", lambda g: g["side"] < 0)):
                    a = ys("real", 0, sel); m_, s_, _ = cstat(a[0], a[1]); nn = [cstat(*ys(m, 0, sel)[:2])[0] for m in MK[1:]]
                    part[nm] = (m_ - np.nanmean(nn), (m_ - np.nanmean(nn)) / s_ if s_ else np.nan)
                for vi, nm in ((1, "D05"), (2, "D2")):
                    a = ys("real", vi); m_, s_, _ = cstat(a[0], a[1]); nn = [cstat(*ys(m, vi)[:2]) for m in MK[1:]]
                    nm_ = np.nanmean([x[0] for x in nn]); ns_ = np.sqrt(np.nanmean(np.array([x[1] for x in nn]) ** 2) / 3)
                    part[nm] = (m_ - nm_, (m_ - nm_) / np.sqrt(s_ ** 2 + ns_ ** 2) if s_ else np.nan)
                sg = np.sign(ex)
                G1 = abs(t) >= 3.5 and ndays >= 100
                G2 = all(np.sign(part[h][0]) == sg and abs(part[h][1]) >= 1.5 for h in ("h1", "h2"))
                G3 = all(np.sign(part[h][0]) == sg and abs(part[h][1]) >= 1.5 for h in ("above", "below"))
                G4 = bool(np.sign(exf) == sg and abs(tf_) >= 2)
                G5 = all(np.sign(part[h][0]) == sg and abs(part[h][1]) >= 1.5 for h in ("D05", "D2"))
                rows.append(dict(tf=tf, type=ty, cond=cn, k=k, n=int(np.isfinite(y).sum()), per_day=round(len(y) / nd, 2), days=ndays, stall=round(stall, 3),
                                 rev_share=round(mu, 4), random=round(null, 4), excess=round(ex, 4), t=round(t, 2), fake=round(fmu, 4), ex_fake=round(exf, 4), t_fake=round(tf_, 2),
                                 h1=round(part["h1"][0], 4), t_h1=round(part["h1"][1], 2), h2=round(part["h2"][0], 4), t_h2=round(part["h2"][1], 2),
                                 above=round(part["above"][0], 4), t_above=round(part["above"][1], 2), below=round(part["below"][0], 4), t_below=round(part["below"][1], 2),
                                 D05=round(part["D05"][0], 4), t_D05=round(part["D05"][1], 2), D2=round(part["D2"][0], 4), t_D2=round(part["D2"][1], 2),
                                 G1=G1, G2=G2, G3=G3, G4=G4, G5=G5, all=G1 and G2 and G3 and G4 and G5, primary=k in (1, 2)))
nz = np.array(nullz); nz = nz[np.isfinite(nz)]; prim = [r for r in rows if r["primary"]]
say(f"\ntests (k 1/2): {len(prim)} | |t| >= 3: {sum(abs(r['t']) >= 3 for r in prim)} vs chance {np.mean(np.abs(nz) >= 3) * len(prim):.1f} (random vs random sd {nz.std():.2f}) | "
    f"|t| >= 3.5: {sum(abs(r['t']) >= 3.5 for r in prim)} vs {np.mean(np.abs(nz) >= 3.5) * len(prim):.1f}")
say(" | ".join(f"{g} {sum(r[g] for r in prim)}" for g in ("G1", "G2", "G3", "G4", "G5", "all")))
say("\n--- pass all gates (k 1/2) ---")
for r in sorted([r for r in prim if r["all"]], key=lambda r: -abs(r["t"])):
    say(f"M{r['tf']} {r['type']:12s} {r['cond']:12s} k{r['k']} n {r['n']} ({r['per_day']}/day) rev {r['rev_share']:.3f} random {r['random']:.3f} ex {r['excess']:+.3f} t {r['t']:+.1f} "
        f"| fake {r['fake']:.3f} t {r['t_fake']:+.1f} | halves {r['h1']:+.3f}/{r['h2']:+.3f} above/below {r['above']:+.3f}/{r['below']:+.3f} D0.5/2 {r['D05']:+.3f}/{r['D2']:+.3f}")
say("\n--- strongest |t| that fail a gate (top 25) ---")
for r in sorted([r for r in prim if not r["all"]], key=lambda r: -abs(r["t"]))[:25]:
    fl = "".join(g[1] for g in ("G1", "G2", "G3", "G4", "G5") if not r[g])
    say(f"M{r['tf']} {r['type']:12s} {r['cond']:12s} k{r['k']} ex {r['excess']:+.3f} t {r['t']:+.1f} fake-ex {r['ex_fake']:+.3f} t {r['t_fake']:+.1f} fails G{fl}")
with open(os.path.join(OUT, "zn_ev_eval.csv"), "w", newline="", encoding="utf-8") as fh:
    w = csv.DictWriter(fh, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
open(os.path.join(OUT, "zn_ev_eval.txt"), "w", encoding="utf-8").write("\n".join(txt))
