"""Task 2 extra: (1) UP share per group for k=2/3/4 with binomial z (vs 50%) and the sign-flip share ; (2) ASYM (UP - DOWN) per group and k
for depth1 / minutes (log2) / lastShorter, from cat_eptime_tests.pkl."""
import pickle, numpy as np
TFS = (1, 5, 15, 60)
def nm(tf): return f"M{tf}" if tf < 60 else f"H{tf // 60}"
G = ["asia", "london", "newyork", "late", "news0830", "vol low", "vol mid", "vol high"]
F = {"asia": lambda e: e["phase"] == "asia", "london": lambda e: e["phase"] == "london", "newyork": lambda e: e["phase"] == "newyork",
     "late": lambda e: e["phase"] == "late", "news0830": lambda e: e["news"], "vol low": lambda e: e["volq"] == 0, "vol mid": lambda e: e["volq"] == 1,
     "vol high": lambda e: e["volq"] == 2}
EP = {K: pickle.load(open(f"cat_eptime_k{K}.pkl", "rb")) for K in (2, 3, 4)}
print("(1) UP share of episodes  [k2 | k3 | k4]  real% (z vs 50%) / sign-flip%")
for tf in TFS:
    for g in G:
        cells = []
        for K in (2, 3, 4):
            E = [e for e in EP[K]["real"][tf] if F[g](e)]; N = [e for s in range(3) for e in EP[K][f"flip{s}"][tf] if F[g](e)]
            if len(E) < 40: cells.append("-"); continue
            p = np.mean([e["dir"] > 0 for e in E]); z = (p - 0.5) / np.sqrt(0.25 / len(E)); pn = np.mean([e["dir"] > 0 for e in N])
            cells.append(f"{p:5.1%} (z{z:+.1f}, n{len(E)}) / {pn:5.1%}")
        print(f"  {nm(tf):3s} {g:9s} " + " | ".join(cells))
ROWS = pickle.load(open("cat_eptime_tests.pkl", "rb"))
print("\n(2) UP - DOWN inside each group  [k2 | k3 | k4] diff (z)")
for m in ("depth1", "minutes", "lastShorter"):
    print(f"  --- {m}" + ("  (log2: +0.26 = x1.2, +0.58 = x1.5)" if m == "minutes" else ""))
    for tf in ("M1", "M5", "M15"):
        for g in G:
            rr = {r[1]: r for r in ROWS if r[0] == "ASYM" and r[2] == tf and r[3] == g and r[5] == m}
            if not rr: continue
            print(f"    {tf:3s} {g:9s} " + " | ".join(f"{rr[K][6]:+.3f} (z{rr[K][7]:+.1f})" if K in rr else "-" for K in (2, 3, 4)))
