"""Task 3 report (reads cat_follow.pkl). Per event group:
  fwd3/12/48  mean move in direction s (ATR): real | drift-only expectation | sign-flip null
  P>0 (12)    ; first +1 = share reaching +1 ATR before -1 ATR within 48 bars (real | drift | null) ; bars to first touch (median)
  MFE/MAE 24  median ; extras (EPEND beyond old extreme, INSIDE next-6 range vs all bars, PDBRK back at level)
  z12         (real f12 - drift - null f12) / SE ; halves = drift-adjusted f12 in first / second half of the data (by event time)
SE assumes independent events (clustered events -> real uncertainty larger)."""
import pickle, numpy as np
A = pickle.load(open("cat_follow.pkl", "rb"))
R = A["real"]; NL = [A[f"flip{s}"] for s in range(3)]
def nm(tf): return f"M{tf}" if tf < 60 else f"H{tf // 60}"
DR = {k[1]: R[k] for k in R if k[0] == "DRIFT"}
def dmean(tf, h): return np.nanmean(DR[tf][f"f{h}"]) if tf in DR else 0.0          # M30 (INSIDE only): no drift table -> 0
def dfirst(tf): return np.nanmean(DR[tf]["first"]) if tf in DR else 0.5
def pool(key, f):
    v = [N[key][f] for N in NL if key in N]; return np.concatenate(v) if v else np.array([])
rows = []
print(f"{'event':34s} {'n':>6s} | {'fwd3 real/drift/null':>20s} | {'fwd12':>20s} | {'fwd48':>20s} | {'P>0 12':>6s} | {'first+1 r/d/n':>16s} {'bars':>4s} | "
      f"{'MFE':>5s} {'MAE':>6s} | {'z12':>5s} | {'halves12':>11s} | extra")
for key in R:
    if key[0] == "DRIFT": continue
    m = R[key]; tf = key[1]; s = m["s"]; n = len(s)
    if n < 30: continue
    cells = []
    for h in (3, 12, 48):
        r = np.nanmean(m[f"f{h}"]); d = np.nanmean(s) * dmean(tf, h); nu = np.nanmean(pool(key, f"f{h}")); cells.append(f"{r:+.2f}/{d:+.2f}/{nu:+.2f}")
    fr = np.nanmean(m["first"]); fd = np.nanmean(np.where(s > 0, dfirst(tf), 1 - dfirst(tf))); fn = np.nanmean(pool(key, "first"))
    f12 = m["f12"]; adj = f12 - s * dmean(tf, 12); n12 = pool(key, "f12")
    se = np.hypot(np.nanstd(adj) / np.sqrt(np.sum(np.isfinite(adj))), np.nanstd(n12) / np.sqrt(max(1, np.sum(np.isfinite(n12)))))
    z = (np.nanmean(adj) - np.nanmean(n12)) / se
    mid = np.median(m["i"]); h1 = np.nanmean(adj[m["i"] < mid]); h2 = np.nanmean(adj[m["i"] >= mid])
    ex = ""
    if "beyond" in m: ex = f"new extreme {np.mean(m['beyond']):.0%} / null {np.mean(pool(key, 'beyond')):.0%}"
    if "rng6" in m: ex = f"next-6 range {np.nanmedian(m['rng6']):.2f} (all bars {m['rng6_all']:.2f}) / null {np.nanmedian(pool(key, 'rng6')):.2f}"
    if "back12" in m: ex = f"back at level 12 bars {np.mean(m['back12']):.0%} / 48 {np.mean(m['back48']):.0%} ; null {np.mean(pool(key, 'back12')):.0%} / {np.mean(pool(key, 'back48')):.0%}"
    name = f"{key[0]} {nm(tf)} {key[2]}"
    print(f"{name:34s} {n:6d} | {cells[0]:>20s} | {cells[1]:>20s} | {cells[2]:>20s} | {np.mean(f12[np.isfinite(f12)] > 0):6.0%} | {fr:4.0%}/{fd:4.0%}/{fn:4.0%} "
          f"{np.nanmedian(m['tfirst']):4.0f} | {np.nanmedian(m['mfe24']):5.2f} {np.nanmedian(m['mae24']):6.2f} | {z:+5.1f} | {h1:+.2f}/{h2:+.2f} | {ex}")
    rows.append((key, n, z, h1, h2))
pickle.dump(rows, open("cat_follow_rows.pkl", "wb"))
