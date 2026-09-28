"""Follow-up of cat_unnamed.py: are the TILT findings (bullish version more common than its mirror) just the bull-market drift?
Compare each TILT code's share in the real data with the same share in 3 SHUFFLED copies (bars reordered inside each day: the day's net
drift is kept, serial structure is destroyed). real ~ shuffle -> it is the drift; real > shuffle -> sequence-specific upward asymmetry.
Also re-reads the SHAPE findings and states what they have in common (sign of consecutive big bars)."""
import numpy as np, pickle
import cat_bars as CB, cat_struct as CS
import importlib.util, sys
REAL, NUL, found = pickle.load(open("cat_unnamed.pkl", "rb"))
spec = importlib.util.spec_from_file_location("u", "cat_unnamed.py")
src = open("cat_unnamed.py", encoding="utf-8").read().split('print("counting real')[0]       # reuse the definitions only
g = {}; exec(src, g)
M = g["M"]; tv = g["tv"]
def desc(n, x):
    if n == 1: return g["desc36"](x)
    if n == 2: return g["desc36"](x // 36) + "  ->  " + g["desc36"](x % 36)
    return "  ->  ".join(g["desc6"](v) for v in (x // 36, (x // 6) % 6, x % 6))
g["desc"] = desc
SHF = [g["count_all"](*CS.shuffle_m1(M["o"], M["h"], M["l"], M["c"], tv, M["sid"], 800 + s)[:4]) for s in range(3)]
print("TILT code (listed = the more common version) | real share | shuffle share (3 copies) | verdict")
for f in sorted([f for f in found if f[0] == "TILT"], key=lambda f: -abs(f[5] - 0.5)):
    _, tf, n, x, xm, val, z, pdy = f
    a_, b_ = (x, xm) if val >= 0.5 else (xm, x)
    real = sum(REAL[(tf, n, hh)][a_] for hh in (0, 1)) / sum(REAL[(tf, n, hh)][a_] + REAL[(tf, n, hh)][b_] for hh in (0, 1))
    sh = [sum(S[(tf, n, hh)][a_] for hh in (0, 1)) / max(1, sum(S[(tf, n, hh)][a_] + S[(tf, n, hh)][b_] for hh in (0, 1))) for S in SHF]
    ntot = sum(REAL[(tf, n, hh)][a_] + REAL[(tf, n, hh)][b_] for hh in (0, 1)); se = np.sqrt(0.25 / ntot)
    verdict = "drift (~ shuffle)" if abs(real - np.mean(sh)) < 2 * se else ("MORE than drift" if real > np.mean(sh) else "less than drift")
    print(f"  M{tf:<2} {n}-bar {g['desc'](n, a_):70s} | {real:.2f} | {np.mean(sh):.2f} ({min(sh):.2f}-{max(sh):.2f}) | {verdict}")
