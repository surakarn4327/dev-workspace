"""Catalog step 3: unnamed search. Every bar gets a code; every 1-bar, 2-bar and (coarse) 3-bar code is counted on the real series and on
3 sign-flipped copies (same bars, same volatility rhythm, direction = coin flip). Nothing is named in advance.
Bar code (36): size = range / ATR20 (<0.5, 0.5-1, 1-2, >=2) x body share of range (<0.3, 0.3-0.7, >=0.7) x close position in the bar (low / mid / high third)
Coarse code (6) for 3-bar sequences: size (< 1 ATR, >= 1 ATR) x close position (low / mid / high)
Two questions per code:
  SHAPE  does this shape (the code + its mirror image, pooled) occur more/less often than chance?          (direction-free)
  TILT   is the code more common than its own mirror image (e.g. the bullish version vs the bearish one)?  (direction; includes bull-market drift)
A finding must hold on all 3 null copies, in both halves of the data, with |z| >= 4 (thousands of codes are tested, so weaker ones are noise)."""
import numpy as np
import cat_bars as CB, cat_struct as CS
M = CB.m1(); FS = CB.full_list(); tv = M["tv"].astype(float)
SIZE = ["tiny", "small", "big", "huge"]; BODY = ["wick-bar", "mid-body", "full-body"]; POS = ["close-low", "close-mid", "close-high"]
def codes(B):
    o, h, l, c, atr = B["o"], B["h"], B["l"], B["c"], B["atr"]; rng = h - l; ok = np.isfinite(atr) & (atr > 0) & (rng > 0)
    r = np.where(ok, rng / np.where(ok, atr, 1), 0); s = np.digitize(r, [0.5, 1, 2])
    bs = np.where(ok, np.abs(c - o) / np.where(rng > 0, rng, 1), 0); b = np.digitize(bs, [0.3, 0.7])
    cp = np.where(ok, (c - l) / np.where(rng > 0, rng, 1), 0.5); p = np.digitize(cp, [1 / 3, 2 / 3])
    full = (s * 9 + b * 3 + p); coarse = (np.minimum(s, 2) // 2) * 3 + p              # size <1 ATR -> 0, >=1 ATR -> 1
    return np.where(ok, full, -1), np.where(ok, coarse, -1)
def mirror36(x): return (x // 3) * 3 + (2 - x % 3)
def mirror6(x): return (x // 3) * 3 + (2 - x % 3)
def desc36(x): return f"{SIZE[x // 9]} {BODY[(x // 3) % 3]} {POS[x % 3]}"
def desc6(x): return f"{'small' if x // 3 == 0 else 'big'} {POS[x % 3]}"
def count_all(o, h, l, c):
    out = {}
    for tf in (1, 5, 15):
        B = CS.resample(tf, M["t"], M["sid"], o, h, l, c, tv); full = np.isin(M["day"][B["m1_end"] - 1], FS)
        same = np.r_[False, B["sid"][1:] == B["sid"][:-1]]; half = M["t"][B["m1_end"] - 1] >= M["t"][len(M["t"]) // 2]
        f36, f6 = codes(B)
        for hh in (0, 1):
            m = full & (half == hh) & (f36 >= 0)
            out[(tf, 1, hh)] = np.bincount(f36[m], minlength=36)
            m2 = m & same & np.r_[False, f36[:-1] >= 0]
            out[(tf, 2, hh)] = np.bincount((np.r_[0, f36[:-1]] * 36 + f36)[m2], minlength=1296)
            same3 = same & np.r_[False, same[:-1]]
            m3 = full & (half == hh) & same3 & (f6 >= 0) & np.r_[False, f6[:-1] >= 0] & np.r_[False, False, f6[:-2] >= 0]
            out[(tf, 3, hh)] = np.bincount((np.r_[0, 0, f6[:-2]] * 36 + np.r_[0, f6[:-1]] * 6 + f6)[m3], minlength=216)
    return out
print("counting real + 3 sign-flipped copies ...", flush=True)
REAL = count_all(M["o"], M["h"], M["l"], M["c"])
NUL = [count_all(*CS.signflip_m1(M["o"], M["h"], M["l"], M["c"], tv, M["sid"], 700 + s)[:4]) for s in range(3)]
def mir(n, x):
    if n == 1: return mirror36(x)
    if n == 2: return mirror36(x // 36) * 36 + mirror36(x % 36)
    return mirror6(x // 36) * 36 + mirror6((x // 6) % 6) * 6 + mirror6(x % 6)
def desc(n, x):
    if n == 1: return desc36(x)
    if n == 2: return desc36(x // 36) + "  ->  " + desc36(x % 36)
    return "  ->  ".join(desc6(v) for v in (x // 36, (x // 6) % 6, x % 6))
found = []
for tf in (1, 5, 15):
    for n in (1, 2, 3):
        K = len(REAL[(tf, n, 0)]); tot_r = sum(REAL[(tf, n, hh)].sum() for hh in (0, 1))
        for x in range(K):
            xm = mir(n, x)
            if xm < x: continue
            def pooled(D, hh): return D[(tf, n, hh)][x] + (D[(tf, n, hh)][xm] if xm != x else 0)
            # SHAPE: real vs each null, per half
            zs = []; ratios = []
            for hh in (0, 1):
                r = pooled(REAL, hh)
                for Nn in NUL:
                    e = pooled(Nn, hh) * REAL[(tf, n, hh)].sum() / max(1, Nn[(tf, n, hh)].sum())
                    zs.append((r - e) / np.sqrt(max(e, 1))); ratios.append(r / max(e, 1e-9))
            zs = np.array(zs); ratios = np.array(ratios)
            if (np.all(zs >= 4) or np.all(zs <= -4)) and np.all(np.abs(np.log(ratios)) >= np.log(1.15)):
                found.append(("SHAPE", tf, n, x, xm, np.mean(ratios), zs.min() if zs.mean() > 0 else zs.max(), sum(pooled(REAL, hh) for hh in (0, 1)) / len(FS)))
            # TILT: code vs its mirror within the real data (null expectation 50/50 by construction)
            if xm != x:
                zt = []; sh = []
                for hh in (0, 1):
                    a, b = REAL[(tf, n, hh)][x], REAL[(tf, n, hh)][xm]
                    if a + b < 50: zt.append(0); sh.append(0.5); continue
                    sh.append(a / (a + b)); zt.append((a - b) / np.sqrt(a + b))
                zt = np.array(zt)
                if (np.all(zt >= 4) or np.all(zt <= -4)) and all(abs(v - 0.5) >= 0.05 for v in sh):
                    found.append(("TILT", tf, n, x, xm, np.mean(sh), zt.min() if zt.mean() > 0 else zt.max(),
                                  sum(REAL[(tf, n, hh)][x] + REAL[(tf, n, hh)][xm] for hh in (0, 1)) / len(FS)))
ntest = sum(len(REAL[(tf, n, 0)]) for tf in (1, 5, 15) for n in (1, 2, 3))
print(f"codes tested: {ntest} (x2 questions) | findings passing all filters: SHAPE {sum(f[0] == 'SHAPE' for f in found)}, TILT {sum(f[0] == 'TILT' for f in found)}")
for kind in ("SHAPE", "TILT"):
    F = sorted([f for f in found if f[0] == kind], key=lambda f: -abs(np.log(f[5])) if kind == "SHAPE" else -abs(f[5] - 0.5))
    print(f"\n== {kind} ({'real / null count, pooled with mirror' if kind == 'SHAPE' else 'share of the listed version vs its mirror image'}) ; per day = both versions")
    for f in F[:40]:
        _, tf, n, x, xm, val, z, pdy = f
        lab = desc(n, x) if kind == "SHAPE" or val >= 0.5 else desc(n, xm)
        v = val if kind == "SHAPE" else max(val, 1 - val)
        print(f"  M{tf:<2} {n}-bar  {'x' if kind == 'SHAPE' else ''}{v:5.2f}{'' if kind == 'SHAPE' else ' share'}  weakest z {z:+5.1f}  {pdy:7.2f}/day  | {lab}")
import pickle; pickle.dump((REAL, NUL, found), open("cat_unnamed.pkl", "wb"))
