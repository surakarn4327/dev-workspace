"""Task 1 companion: inside EACH big-TF state, is the small-TF UP-vs-DOWN asymmetry (cat_anatomy: up = shallow pullbacks, slower, pushes fade;
down = deep bounces, fast, pushes don't fade) still there?  diff = UP - DOWN of the same big-TF state; under the sign-flip null UP and DOWN
are mirror images so the expected diff is 0 -> z = diff / bootstrap SE ; also shown: the same diff on the sign-flip copies (pooled)."""
import pickle, numpy as np
rng = np.random.default_rng(11)
PAIRS = ((1, 15), (1, 60), (5, 15), (5, 60), (15, 60), (15, 240))
def nm(tf): return f"M{tf}" if tf < 60 else f"H{tf // 60}"
MET = {"depth1": lambda E: np.median([e["depths"][0] for e in E if e["depths"]]),
       "imp2/1": lambda E: np.median([e["imps"][1] / e["imps"][0] for e in E if len(e["imps"]) > 1]),
       "log2 min": lambda E: np.median(np.log2([max(e["minutes"], 1) for e in E])),
       "lastShorter": lambda E: np.mean([e["last_shorter"] for e in E if len(e["imps"]) > 1])}
def st(e, pa):  # big-TF state in the small episode's own frame: +1 with, -1 against, 0 side
    s = e[f"par{pa}"]; return 0 if s == 0 else (1 if s == e["dir"] else -1)
def big(e, pa): return e[f"par{pa}"]
def boot(f, A, B, reps=100):
    A = np.array(A, dtype=object); B = np.array(B, dtype=object)
    return np.nanstd([f(list(A[rng.integers(0, len(A), len(A))])) - f(list(B[rng.integers(0, len(B), len(B))])) for _ in range(reps)])
print("UP - DOWN of the small TF, grouped by the BIG-TF state (big UP / big DOWN / big SIDE); cells: real diff (z) | sign-flip diff")
for m, f in MET.items():
    print(f"\n### {m}")
    for K in (2, 3, 4):
        EP = pickle.load(open(f"cat_nest_k{K}.pkl", "rb"))
        for c, pa in PAIRS:
            cells = []
            for bs, bn in ((1, "bigUP"), (-1, "bigDN"), (0, "bigSIDE")):
                U = [e for e in EP["real"][c] if e["dir"] > 0 and big(e, pa) == bs]; D = [e for e in EP["real"][c] if e["dir"] < 0 and big(e, pa) == bs]
                nul = [e for s in range(3) for e in EP[f"flip{s}"][c] if big(e, pa) == bs]
                nU = [e for e in nul if e["dir"] > 0]; nD = [e for e in nul if e["dir"] < 0]
                if min(len(U), len(D)) < 30: cells.append(f"{bn}: -"); continue
                d = f(U) - f(D); cells.append(f"{bn}: {d:+.3f} (z{d / boot(f, U, D):+.1f}) | {f(nU) - f(nD):+.3f}")
            print(f"  k{K} {nm(c):3s} in {nm(pa):3s}  " + "   ".join(cells))
