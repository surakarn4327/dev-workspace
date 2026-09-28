"""Stage 3 runner: every strategy x TF on real data (+ the same entries traded in the opposite direction) and on 3 sign-flipped copies.
usage: python s3_run.py [k] [cost]  -> s3_k<k>_c<cost>.pkl"""
import sys, pickle, numpy as np
import s3lib as L, cat_struct as CS
K = float(sys.argv[1]) if len(sys.argv) > 1 else 3.0; COST = float(sys.argv[2]) if len(sys.argv) > 2 else 0.39
M = L.M; tv = M["tv"].astype(float)
SER = {"real": (M["o"], M["h"], M["l"], M["c"])}
for s in range(3): SER[f"flip{s}"] = CS.signflip_m1(M["o"], M["h"], M["l"], M["c"], tv, M["sid"], 1300 + s)[:4]
TFS = (1, 2, 3, 5, 10, 15); RES = {}
for name, ser in SER.items():
    for tf in TFS:
        sig = L.signals(ser, tf, K)
        for st, (ei, d, sl, atr) in sig.items():
            r = L.simulate(ser, ei, d, sl, COST); kp = r["keep"]
            rec = dict(ei=ei[kp], d=d[kp], risk_atr=((ser[3][ei] - sl) * d / atr)[kp], R={tp: r[tp]["R"] for tp in L.TP_R}, exit={tp: r[tp]["exit"] for tp in L.TP_R})
            if name == "real":                                             # same entries, opposite direction, same risk
                e = ser[3][ei]; rv = L.simulate(ser, ei, -d, e + (e - sl), COST)
                rec["Rrev"] = {tp: rv[tp]["R"] for tp in L.TP_R}
            RES[(name, tf, st)] = rec
        print(name, f"M{tf}", {st: len(v[0]) for st, v in sig.items()}, flush=True)
pickle.dump(RES, open(f"s3_k{K:g}_c{COST:g}.pkl", "wb"))
