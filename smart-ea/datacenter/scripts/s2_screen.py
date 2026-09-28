"""Stage 2 strict screen for every event type, both orientations (as defined / reversed).
Cell (SL,TP) is chosen on H1 only (max t), then judged on: H2>0, quarters>0 share, BUY>0 & SELL>0, all 8-neighbours>0 (ALL data),
overall t, and a time-of-day-matched null (random day of the same half, same clock time, same direction)."""
import numpy as np, sys
import s2lib as L
TYPES = ["PREVDAY_BREAK", "PREVDAY_FALSEBREAK", "SWING_DOUBLE", "SWING_SWEEP", "SWING_BREAKOUT_THEN_REVERSAL", "SWING_LOWERHIGH_HIGHERLOW",
         "PULLBACK_SHALLOW", "PULLBACK_MID", "PULLBACK_DEEP", "PULLBACK_REVERSED", "FASTMOVE", "SQUEEZE_BREAK"]
if len(sys.argv) > 1: TYPES = sys.argv[1:]
B = L.bars(); bt, bday = B["t"], B["day"]; D = L.days(); Umap = dict(zip(D["day"], D["adr20"]))
rng = np.random.default_rng(11)
def tod_null(t, d, reps, sl, tp, tmid):
    days_all = np.array([k for k in D["day"] if Umap.get(k) is not None and np.isfinite(Umap[k])])
    pools = {1: days_all[days_all * 86400 < tmid], 2: days_all[days_all * 86400 >= tmid]}
    out = []
    for rep in range(reps):
        nt = np.empty(len(t), np.int64); nU = np.empty(len(t))
        for k in range(len(t)):
            tod = (t[k] + 3600) % 86400; pool = pools[1 if t[k] < tmid else 2]
            for _ in range(50):
                dk = pool[rng.integers(len(pool))]; cand = dk * 86400 - 3600 + tod
                j = np.searchsorted(bt, cand)
                if j < len(bt) and bt[j] == cand: nt[k] = cand; nU[k] = Umap[dk]; break
            else: nt[k] = t[k]; nU[k] = np.nan
        out.append(np.nanmean(L.simulate(nt, d, nU, sls=np.array([sl]), tps=np.array([tp]))[0]))
    return np.array(out)
print(" type / orientation            |   n  | cell(H1)   | H1    H2    | q+    | BUY   SELL  | nbr+ | all    t    | null(tod) z | wr  W/L  streak | PASS")
summary = []
for TY in TYPES:
    E = L.events([TY])
    R0, _ = L.simulate(E["t"], E["dir"], E["U"])
    for orient in (1, -1):
        R = R0 if orient == 1 else None
        if orient == -1: R, _ = L.simulate(E["t"], -E["dir"], E["U"])
        d = E["dir"] * orient; ok = np.isfinite(R[:, 0, 0]); n = ok.sum()
        if n < 60: continue
        t = E["t"]; tmid = np.median(t[ok]); h1 = ok & (t < tmid); h2 = ok & (t >= tmid)
        m1 = np.nanmean(R[h1], 0); se1 = np.nanstd(R[h1], 0) / np.sqrt(h1.sum()); a, b = np.unravel_index(np.argmax(m1 / se1), m1.shape)
        r = R[:, a, b]; st = L.stats(r[ok]); q = L.quarter_key(t); Q = sorted(set(q[ok]))
        qp = np.mean([np.nanmean(r[ok & (q == k)]) > 0 for k in Q])
        mb, ms = np.nanmean(r[ok & (d > 0)]), np.nanmean(r[ok & (d < 0)])
        nb = [np.nanmean(R[ok, aa, bb]) for aa in range(max(0, a - 1), min(len(L.SLS), a + 2)) for bb in range(max(0, b - 1), min(len(L.TPS), b + 2))]
        nbp = np.mean(np.array(nb) > 0)
        nl = tod_null(t[ok], d[ok], 12 if n > 1500 else 25, L.SLS[a], L.TPS[b], tmid); z = (st["mean"] - nl.mean()) / nl.std()
        m2 = np.nanmean(r[h2])
        ps = (m2 > 0) and qp >= 0.8 and mb > 0 and ms > 0 and nbp == 1 and st["t"] >= 3 and z >= 2
        tp = "EOD" if L.TPS[b] > 8 else f"{L.TPS[b]:.1f}"
        print(f" {TY[:24]:24s} {'def' if orient == 1 else 'rev'} | {n:4d} | {L.SLS[a]:.3f}/{tp:4s} | {m1[a, b]:+.2f} {m2:+.2f} | {qp:4.0%}  | {mb:+.2f} {ms:+.2f} | {nbp:4.0%} "
              f"| {st['mean']:+.3f} {st['t']:+.1f} | {nl.mean():+.2f} {z:+.1f} | {st['wr']:.0%} {st['aw']:.1f}/{st['al']:.1f} {st['streak']:3d} | {'YES' if ps else 'no'}", flush=True)
        summary.append((TY, orient, n, L.SLS[a], L.TPS[b], m1[a, b], m2, qp, mb, ms, nbp, st["mean"], st["t"], z, ps))
np.save("s2_screen.npy", np.array(summary, dtype=object), allow_pickle=True)
