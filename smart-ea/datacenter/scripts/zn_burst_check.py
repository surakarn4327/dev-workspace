r"""Check of zn_burst (real market): for 400 random boxes per X, with plain loops
 - all box bars in one session, >= 30 bars, high-low <= 0.3 X ; bar e+1 = the break bar, same session, it makes the box wider than 0.3 X
   and breaks on side s only ; the box high/low stored = the true high/low of bars a..e
 - burst / fail recomputed by walking the 4-point path bar by bar
 - the box can not be extended to the left by one bar (bar a-1 in the same session would already exceed 0.3 X, or a is a session start
   or the previous box's break bar)"""
import sys, os
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, po_lib as PO
src = open(r"C:\trade datacenter\scripts\zn_burst.py", encoding="utf-8").read().split('\nif __name__')[0]
ns = {}; exec(compile(src, "zn_burst_defs", "exec"), ns)
M = PO.load_market("real"); R = dict(np.load(r"C:\trade datacenter\zn\zn_burst_real.npz")); bad = 0; rng = np.random.default_rng(5)
for X in ns["XS"]:
    Bx = ns["boxes"](M, X); breaks = set(Bx[:, 2].astype(int).tolist()); nb = 0
    a_all = R[f"x{X}_a"]; ok_all = R[f"x{X}_ok"]; pos = {int(v): k for k, v in enumerate(Bx[:, 0].astype(int))}
    for q in rng.choice(len(a_all), min(400, len(a_all)), replace=False):
        a = int(a_all[q]); r = Bx[pos[a]]; e, b, s, bh, bl = int(r[1]), int(r[2]), int(r[3]), r[4], r[5]; W = 0.3 * X
        h, l = M["h"][a:e + 1], M["l"][a:e + 1]
        c = [len(set(M["sid"][a:b + 1].tolist())) == 1, e - a + 1 >= 30, h.max() - l.min() <= W + 1e-6, abs(h.max() - bh) < 1e-9 and abs(l.min() - bl) < 1e-9,
             b == e + 1, max(bh, M["h"][b]) - min(bl, M["l"][b]) > W + 1e-9, (M["h"][b] > bh) == (s > 0) and (M["l"][b] < bl) == (s < 0)]
        left = a == 0 or M["sid"][a - 1] != M["sid"][a] or a in breaks or (max(bh, M["h"][a - 1]) - min(bl, M["l"][a - 1]) > W + 1e-9)
        c.append(left)
        # outcome brute
        res = None
        for j in range(b, min(len(M["t"]), b + 2 * 1450)):
            pts = [M["o"][j], M["l"][j], M["h"][j], M["c"][j]] if M["c"][j] >= M["o"][j] else [M["o"][j], M["h"][j], M["l"][j], M["c"][j]]
            for x in pts:
                if (s > 0 and x >= bh + X) or (s < 0 and x <= bl - X): res = 1; break
                if (s > 0 and x <= bl) or (s < 0 and x >= bh): res = 0; break
            if res is not None: break
        c.append((res or 0) == ok_all[q])
        if not all(c): nb += 1; print("BOX MISMATCH X", X, "a", a, c) if nb < 8 else None
    print(f"X ${X}: boxes {len(a_all)} checked {min(400, len(a_all))} mismatches {nb}"); bad += nb
print("TOTAL", bad)
