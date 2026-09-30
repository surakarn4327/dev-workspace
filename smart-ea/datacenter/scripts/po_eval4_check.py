r"""Independent check of po_eval4 (layer 1b), real market:
 A. bar codes / sequence shapes / directions of 4,000 random library rows recomputed with plain per-bar python (no numpy digitize/where)
 B. 12 cells of po_eval4_m<tf>.csv (random + the strongest) recomputed from the raw library: rows of the shape, own trade simulation from
    the first-passage columns, own day-clustered SE, null mean over the 3 random-direction markets, excess, t, halves, BUY/SELL
Usage: python po_eval4_check.py <tf>"""
import sys, os, csv
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, po_lib as PO, adx_ctx as X
tf = int(sys.argv[1]); os.environ["PO_TF"] = str(tf)
src = open(r"C:\trade datacenter\scripts\po_eval4.py", encoding="utf-8").read().split("\nt0 = time.time(); L = {}")[0]
ns = {}; exec(compile(src, "po_eval4_defs", "exec"), ns)
MK = ["real", "sf1", "sf2", "sf3"]; LV = PO.LV; COST = PO.COST
L = {m: dict(np.load(os.path.join(PO.OUTD, f"po_m{tf}_{m}.npz"))) for m in MK}
BB = {m: X.resample(PO.load_market(m), tf) for m in MK}
S = {m: ns["shapes"](BB[m], L[m]["b"]) for m in MK}
bad = 0
# A
def code1(B, i):
    a = B["atr_prev"][i]; h, l, o, c = B["h"][i], B["l"][i], B["o"][i], B["c"][i]; rg = h - l
    if not (a == a) or a <= 0 or rg <= 0: return None
    r = rg / a; s = 0 if r < 0.5 else (1 if r < 1 else (2 if r < 2 else 3))
    bs = abs(c - o) / rg; b = 0 if bs < 0.3 else (1 if bs < 0.7 else 2)
    cp = (c - l) / rg; p = 0 if cp < 1 / 3 else (1 if cp < 2 / 3 else 2)
    return s, b, p
def flip(x): return (x[0], x[1], 2 - x[2])
B = BB["real"]; rng = np.random.default_rng(tf); pick = rng.choice(len(L["real"]["b"]), 4000, replace=False)
for q in pick:
    i = L["real"]["b"][q]
    seq = []
    for k in range(3):
        j = i - k
        if j < 0 or (k and B["sid"][j] != B["sid"][i]): seq.append(None); continue
        seq.append(code1(B, j))
    for Ln, nb in (("L1", 1), ("L2", 2), ("L3", 3)):
        bars = seq[:nb]
        want = (-1, None)
        if all(x is not None for x in bars):
            d = 0
            for x in bars:                                    # last bar first
                if x[2] == 2: d = 1; break
                if x[2] == 0: d = -1; break
            if d != 0:
                bb = bars if d > 0 else [flip(x) for x in bars]
                if Ln == "L1": k = bb[0][0] * 9 + bb[0][1] * 3 + bb[0][2]
                elif Ln == "L2": k = (bb[1][0] * 9 + bb[1][1] * 3 + bb[1][2]) * 36 + bb[0][0] * 9 + bb[0][1] * 3 + bb[0][2]
                else:
                    c6 = lambda x: (min(x[0], 2) // 2) * 3 + x[2]
                    k = c6(bb[2]) * 36 + c6(bb[1]) * 6 + c6(bb[0])
                want = (k, d)
        got_k, got_d = int(S["real"][Ln][0][q]), int(S["real"][Ln][1][q])
        if want[0] != got_k or (got_k >= 0 and want[1] != got_d):
            bad += 1
            if bad < 10: print("SHAPE MISMATCH", Ln, q, want, (got_k, got_d))
print(f"A: 4000 rows x 3 lengths checked, mismatches {bad}")
# B
def one(R, q, sd, s, tp):
    li = int(np.flatnonzero(np.isclose(LV, s))[0]); ti = None if tp is None else int(np.flatnonzero(np.isclose(LV, s * tp))[0])
    U, D, UG, DG = (R["up_t"], R["dn_t"], R["up_g"], R["dn_g"]) if sd > 0 else (R["dn_t"], R["up_t"], R["dn_g"], R["up_g"])
    tS = D[q, li]; tT = -1 if ti is None else U[q, ti]
    if tS >= 0 and (tT < 0 or tS <= tT): x = -s - DG[q, li]
    elif tT >= 0: x = LV[ti] + UG[q, ti]
    else: x = sd * R["fin"][q]
    return x / s - COST / (s * R["atr"][q])
def stat(x, day):
    if len(x) < 30: return np.nan, np.nan
    mu = x.mean(); tot = {}
    for a, b in zip(day, x): tot[a] = tot.get(a, 0.0) + (b - mu)
    return mu, np.sqrt(sum(v * v for v in tot.values())) / len(x)
rows = list(csv.DictReader(open(os.path.join(PO.OUTD, f"po_eval4_m{tf}.csv"), encoding="utf-8")))
sel = [rows[i] for i in rng.choice(len(rows), 8, replace=False)] + sorted(rows, key=lambda r: -abs(float(r["t_excess"])) if r["t_excess"] not in ("", "nan") else 0)[:4]
days = np.unique(L["real"]["day"]); MID = days[len(days) // 2]; bB = 0
for r in sel:
    s = float(r["sl"]); tp = None if r["rr"] == "none" else float(r["rr"]); key = int(r["shape"]); sg = 1 if r["mode"] == "with" else -1
    res = {}
    for m in MK:
        k, d = S[m][r["len"]]; rr_ = np.flatnonzero(k == key); side = d[rr_] * sg
        res[m] = (np.array([one(L[m], q, sd, s, tp) for q, sd in zip(rr_, side)]), L[m]["day"][rr_], side)
    x, day, side = res["real"]; mu, se = stat(x, day)
    nst = [stat(res[m][0], res[m][1]) for m in MK[1:]]; null = np.nanmean([a for a, _ in nst]); nse = np.sqrt(np.nanmean(np.array([b for _, b in nst]) ** 2) / 3)
    t = (mu - null) / np.sqrt(se ** 2 + nse ** 2)
    h1 = stat(x[day < MID], day[day < MID])[0] - np.nanmean([stat(res[m][0][res[m][1] < MID], res[m][1][res[m][1] < MID])[0] for m in MK[1:]])
    by = stat(x[side > 0], day[side > 0])[0] - np.nanmean([stat(res[m][0][res[m][2] > 0], res[m][1][res[m][2] > 0])[0] for m in MK[1:]])
    comp = [("mean_R", mu, 6e-5), ("null_R", null, 6e-5), ("t_excess", t, 0.006), ("h1", h1, 6e-5), ("buy", by, 6e-5)]
    for nm, v, tol in comp:
        a = float(r[nm])
        if not ((np.isnan(a) and np.isnan(v)) or abs(a - v) <= tol): bB += 1; print("CELL MISMATCH", r["len"], r["desc"], r["mode"], r["cell"], nm, a, v)
print(f"B: {len(sel)} cells recomputed, mismatches {bB}")
print("TOTAL", bad + bB)
