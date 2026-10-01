r"""Report of flt_screen: every real cell with its null (5 random-direction markets) t values, gates, and the strongest cells.
Gates: G1 |t| >= 3 and >= 100 days | G2 both halves same sign |t| >= 1.5 | G3 BUY and SELL same sign |t| >= 1.5 | G4 >= 70% of sets same sign |
G6 |t| larger than the largest |t| the same cell reaches in any of the 5 random markets (the cell index is the same: same percentile bucket).
Calibration: share of |t| >= 3 cells real vs random. Output flt\flt_report.txt"""
import sys, os, pickle
import numpy as np
OUT = r"C:\trade datacenter\flt"; txt = []
def say(s=""): print(s); txt.append(s)
R = pickle.load(open(os.path.join(OUT, "flt_screen_real.pkl"), "rb"))["cells"]
N = {k: pickle.load(open(os.path.join(OUT, f"flt_screen_sf{k}.pkl"), "rb"))["cells"] for k in range(1, 6)}
key = lambda c: (c["tf"], c["feat"], c["bucket"], c["scope"])
Nd = {k: {key(c): c for c in v} for k, v in N.items()}
sb = [c for c in R if c["scope"] == "sb"]; post = {key(c): c for c in R if c["scope"] == "post"}
for c in sb:
    nt = [Nd[k][key(c)]["t"] for k in N if key(c) in Nd[k]]; c["null_t"] = nt
    sg = np.sign(c["e"]); ok = lambda t: np.isfinite(t) and np.sign(t) == sg and abs(t) >= 1.5
    c["G1"] = abs(c["t"]) >= 3 and c["days"] >= 100; c["G2"] = ok(c["t_h0"]) and ok(c["t_h1"]); c["G3"] = ok(c["t_buy"]) and ok(c["t_sell"])
    c["G4"] = bool(np.isfinite(c["set_share"]) and c["set_share"] >= 0.7); c["G6"] = bool(nt) and abs(c["t"]) > max(abs(x) for x in nt if np.isfinite(x))
    c["all"] = all(c[g] for g in ("G1", "G2", "G3", "G4", "G6"))
nr = np.array([abs(c["t"]) for c in sb]); nn = np.array([abs(x) for c in sb for x in c["null_t"] if np.isfinite(x)])
say(f"cells {len(sb)} | real |t| >= 3: {int((nr >= 3).sum())}  >= 2: {int((nr >= 2).sum())} | random (per market avg): >= 3 {np.mean(nn >= 3) * len(sb):.1f}  >= 2 {np.mean(nn >= 2) * len(sb):.1f}")
say("gates: " + " ".join(f"{g} {sum(c[g] for c in sb)}" for g in ("G1", "G2", "G3", "G4", "G6", "all")))
say("\n--- cells passing all gates ---")
def line(c):
    p = post.get(key(c)); ps = f" | post-2026-06 n {p['n']} e {p['e']:+.3f} t {p['t']:+.1f}" if p else ""
    return (f"M{c['tf']} {c['feat']:13s} bucket {c['bucket']}/{c['nb'] - 1} n {c['n']} days {c['days']} e {c['e']:+.3f} t {c['t']:+.1f} | halves {c['e_h0']:+.3f}/{c['e_h1']:+.3f} "
            f"BUY/SELL {c['e_buy']:+.3f}/{c['e_sell']:+.3f} sets {c['set_share']:.0%} | null t {' '.join(f'{x:+.1f}' for x in c['null_t'])}{ps} | edges {np.round(c['edges'], 2).tolist()}")
for c in sorted([c for c in sb if c["all"]], key=lambda c: -abs(c["t"])): say(line(c))
say("\n--- strongest |t| not passing all gates (top 30) ---")
for c in sorted([c for c in sb if not c["all"]], key=lambda c: -abs(c["t"]))[:30]:
    say(("fails " + "".join(g[1] for g in ("G1", "G2", "G3", "G4", "G6") if not c[g]) + " | ") + line(c))
open(os.path.join(OUT, "flt_report.txt"), "w", encoding="utf-8").write("\n".join(txt))
