"""Task 1 test: for each small-TF direction, is the episode anatomy different when it runs AGAINST the big TF (= big-TF pullback) vs WITH it?
diff = metric(against) - metric(with) ; the same diff on the sign-flip copies (pooled, both directions) is the mechanical/nesting baseline.
z = (real diff - null diff) / sqrt(SE_real^2 + SE_null^2), SE by bootstrap over episodes. Run for zigzag k = 2, 3, 4 (cat_nest_k*.pkl)."""
import pickle, numpy as np
rng = np.random.default_rng(7)
PAIRS = ((1, 5), (1, 15), (1, 60), (5, 15), (5, 60), (15, 60), (15, 240))
def nm(tf): return f"M{tf}" if tf < 60 else f"H{tf // 60}"
MET = {
    "depth1": lambda E: np.median([e["depths"][0] for e in E if e["depths"]]),
    "imp2/1": lambda E: np.median([e["imps"][1] / e["imps"][0] for e in E if len(e["imps"]) > 1]),
    "log2 minutes": lambda E: np.median(np.log2([max(e["minutes"], 1) for e in E])),
    "moveATR": lambda E: np.median([e["move_atr"] for e in E]),
    "pullbacks": lambda E: np.mean([e["pullbacks"] for e in E]),
    "lastShorter": lambda E: np.mean([e["last_shorter"] for e in E if len(e["imps"]) > 1]),
    "endFailed": lambda E: np.mean([e["end_failed"] for e in E]),
}
def rel(e, pa):
    s = e[f"par{pa}"]; return "side" if s == 0 else ("with" if s == e["dir"] else "against")
def boot(f, A, B, reps=100):
    A = np.array(A, dtype=object); B = np.array(B, dtype=object)
    v = [f(list(A[rng.integers(0, len(A), len(A))])) - f(list(B[rng.integers(0, len(B), len(B))])) for _ in range(reps)]
    return np.nanstd(v)
ROWS = []
for K in (2, 3, 4):
    EP = pickle.load(open(f"cat_nest_k{K}.pkl", "rb"))
    for c, pa in PAIRS:
        nul = [e for s in range(3) for e in EP[f"flip{s}"][c]]
        nA = [e for e in nul if rel(e, pa) == "against"]; nW = [e for e in nul if rel(e, pa) == "with"]
        for d, dn in ((1, "UP"), (-1, "DN")):
            rA = [e for e in EP["real"][c] if e["dir"] == d and rel(e, pa) == "against"]; rW = [e for e in EP["real"][c] if e["dir"] == d and rel(e, pa) == "with"]
            if min(len(rA), len(rW)) < 30: continue
            for m, f in MET.items():
                dr = f(rA) - f(rW); dn_ = f(nA) - f(nW); se = np.hypot(boot(f, rA, rW), boot(f, nA, nW) / np.sqrt(1))
                ROWS.append((K, f"{nm(c)} in {nm(pa)}", dn, m, dr, dn_, (dr - dn_) / se if se > 0 else np.nan, len(rA), len(rW)))
    print(f"k={K} done", flush=True)
pickle.dump(ROWS, open("cat_nest_test.pkl", "wb"))
for m in MET:
    print(f"\n### {m}: against - with  (real | random-direction | z)   [columns = k 2 / 3 / 4]")
    for pr in dict.fromkeys(r[1] for r in ROWS):
        for dn in ("UP", "DN"):
            cells = []
            for K in (2, 3, 4):
                r = [x for x in ROWS if x[0] == K and x[1] == pr and x[2] == dn and x[3] == m]
                cells.append(f"{r[0][4]:+.3f} | {r[0][5]:+.3f} | z{r[0][6]:+.1f} (n{r[0][7]}/{r[0][8]})" if r else "-")
            print(f"  {pr:10s} {dn}: " + "  ||  ".join(cells))
Z = np.array([r[6] for r in ROWS]); print(f"\ncells {len(Z)}, |z|>=2: {np.sum(np.abs(Z) >= 2)} (expected by chance ~{0.046 * len(Z):.0f}), |z|>=3: {np.sum(np.abs(Z) >= 3)}")
for r in ROWS:
    if abs(r[6]) >= 2.5: print("  ", r[0], r[1], r[2], r[3], f"real {r[4]:+.3f} null {r[5]:+.3f} z {r[6]:+.1f} n {r[7]}/{r[8]}")
