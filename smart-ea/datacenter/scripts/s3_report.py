"""Stage 3 report. usage: python s3_report.py [pkl]
per strategy x TF x TP (real data):
  n/day, winrate, avg R (net of cost), R per year, t (daily-clustered), halves avg R, share of positive quarters, max losing streak
  1-at-a-time: only one open trade per strategy -> n/day, avg R, R/yr, max drawdown in R
  rev = same entries traded the opposite way ; null = same strategy on 3 sign-flipped markets (avg R)"""
import sys, pickle, numpy as np
from datetime import datetime, timezone
import s3lib as L
F = sys.argv[1] if len(sys.argv) > 1 else "s3_k3_c0.39.pkl"
RES = pickle.load(open(F, "rb")); T = L.M["t"]; DAY = L.M["day"]; ND = len(L.FS); YRS = (T[-1] - T[0]) / (365.25 * 86400)
def qkey(t): d = datetime.fromtimestamp(int(t), timezone.utc); return d.year * 10 + (d.month - 1) // 3
def streak(r):
    m = c = 0
    for x in r:
        c = c + 1 if x < 0 else 0; m = max(m, c)
    return m
def maxdd(r): e = np.cumsum(r); return np.max(np.maximum.accumulate(np.r_[0, e])[1:] - e) if len(r) else 0
print(f"{F}  full days {ND}, years {YRS:.2f}")
print(f"{'strategy':10s} {'TF':3s} TP | {'n/d':>5s} {'WR':>4s} {'avgR':>6s} {'R/yr':>6s} {'t':>5s} | {'half1':>6s} {'half2':>6s} {'Q+':>4s} {'lose':>4s} | "
      f"{'1x n/d':>6s} {'avgR':>6s} {'R/yr':>6s} {'DD':>5s} | {'rev':>6s} {'null':>6s}")
ROWS = []
for (nm, tf, st), rec in RES.items():
    if nm != "real": continue
    for tp in L.TP_R:
        r = rec["R"][tp]; ei = rec["ei"]
        if len(r) < 30: continue
        o = np.argsort(ei, kind="stable"); r_o = r[o]; ei_o = ei[o]
        days = DAY[ei_o]; ud, inv = np.unique(days, return_inverse=True); dsum = np.bincount(inv, r_o)
        allday = np.zeros(ND); allday[:len(dsum)] = dsum
        t = allday.mean() / (allday.std(ddof=1) / np.sqrt(ND))
        mid = len(r_o) // 2; q = np.array([qkey(T[i]) for i in ei_o]); uq = np.unique(q); qp = np.mean([r_o[q == x].sum() > 0 for x in uq])
        acc = L.one_at_a_time(ei, rec["exit"][tp]); r1 = r[acc][np.argsort(ei[acc], kind="stable")]
        nul = [RES[(f"flip{s}", tf, st)]["R"][tp] for s in range(3) if (f"flip{s}", tf, st) in RES]; nu = np.mean(np.concatenate(nul)) if nul else np.nan
        row = (st, tf, tp, len(r) / ND, np.mean(r > 0), r.mean(), r.sum() / YRS, t, r_o[:mid].mean(), r_o[mid:].mean(), qp, streak(r_o),
               acc.sum() / ND, r1.mean(), r1.sum() / YRS, maxdd(r1), rec["Rrev"][tp].mean(), nu)
        ROWS.append(row)
        print(f"{st:10s} M{tf:<2d} {tp:.0f} | {row[3]:5.2f} {row[4]:4.0%} {row[5]:+6.3f} {row[6]:+6.0f} {row[7]:+5.1f} | {row[8]:+6.3f} {row[9]:+6.3f} {row[10]:4.0%} {row[11]:4d} | "
              f"{row[12]:6.2f} {row[13]:+6.3f} {row[14]:+6.0f} {row[15]:5.0f} | {row[16]:+6.3f} {row[17]:+6.3f}")
pickle.dump(ROWS, open(F.replace(".pkl", "_rows.pkl"), "wb"))
