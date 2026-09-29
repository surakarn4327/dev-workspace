r"""Phase 3B-b follow-up (descriptive, after the gates): why do the random-direction markets show non-zero effects ("mechanical")?
Hypothesis tested: the simulator's 4-point path inside each M1 bar (bullish O-L-H-C, bearish O-H-L-C) is not a martingale inside the bar,
so a stop close to the price (BE) would be swept by the first dip. Test: RAW deltas (alternative - plan, no baseline) at the first
check-only point in each open-R band, and the raw deltas of the patterns that passed every gate, in the real market and in a
random-direction market (needs p3b\sf1 rebuilt with p3b_grid.py sf1).
Result 2026-09-29: REJECTED — in sf1 every raw BE delta is ~0 (|t| <= 2.1, slightly positive), so the simulator is fair; the "mechanical"
effects come from the residual construction (the first occurrence of an event sits in other sub-states than the check-only rows of the
same coarse stratum). Output p3b\p3b_mech.txt"""
import os, pickle
import numpy as np
import broker as BK
import p3b_lib as B

BASE = os.path.join(os.path.dirname(BK.DB), "p3b")

def main():
    L = []; pr = lambda *a: (L.append(" ".join(str(x) for x in a)), print(*a, flush=True))
    rows = pickle.load(open(os.path.join(BASE, "p3b_rows.pkl"), "rb"))
    for name in ["real"] + [f"sf{s}" for s in range(1, 6)]:
        if name != "real" and not os.path.isdir(os.path.join(BASE, name)): continue
        M = B.load_market(os.path.join(BASE, name)); E = B.Engine(M, neighbours=False)
        pr(f"== {name}")
        # raw deltas of the patterns that passed every gate (first occurrence, mean of alt - plan, not residual) + BE / cut at checkpoints
        for tf in B.TFS:
            R = M["G"][tf]["R"]; ev = M["G"][tf]["ev"]; ti = R["ti"]
            fl = ev["fl_base"][R["b"]]; co = np.flatnonzero(R["check"] & ((fl & B.MKT_MASK) == 0))
            op = R["open_r"]; rk = M["T"]["risk"][ti]
            for lo, hi in ((0, 0.1), (0.1, 0.25), (0.25, 0.5), (0.5, 1.0), (1.0, 99)):
                m = co[(op[co] > lo) & (op[co] <= hi)]; fr = B.first_of(m, ti)
                s = B.stats(R["d_be"][fr], ti[fr], M, False)
                pr(f"  M{tf} BE at first checkpoint with open R in ({lo},{hi}]: raw delta {s['mean']:+.3f} t {s['t']:+.1f} n {s['n']}")
        for i, r in enumerate(rows):
            if not r["passed"]: continue
            p = dict(tf=r["tf"], alt=r["alt"], grp=r["grp"], feat=r["feat"], level=(int(r["level"]) if r["grp"] != "E" else r["level"]))
            tf = r["tf"]; R = M["G"][tf]["R"]; ev = M["G"][tf]["ev"]; b = R["b"]
            E._bits = {}; fl_of = lambda vn: ev["fl_" + vn][b]
            co = np.flatnonzero(R["check"] & ((fl_of("base") & B.MKT_MASK) == 0))
            fr, var, rows_ = E._rows(p, R, ev, b, fl_of, co, lambda f, v: E.tab[(tf, f, v)][R["cix"][co], (R["dir"][co] < 0).astype(int)], R["half"][co] == 0)
            s = B.stats(R["d_" + r["alt"]][fr], R["ti"][fr], M, False)
            pr(f"  passer M{tf} {r['alt']} {r['feat']} {r['level']}: raw delta (alt - plan) {s['mean']:+.3f} t {s['t']:+.1f} n {s['n']}"
               + (f"  | close half = {s['mean'] / 2:+.3f}" if r["alt"] == "cut" else ""))
        del M, E
    open(os.path.join(BASE, "p3b_mech.txt"), "w", encoding="utf-8").write("\n".join(L))

if __name__ == "__main__":
    main()
