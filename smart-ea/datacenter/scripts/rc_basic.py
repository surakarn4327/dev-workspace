r"""Root cause study (2026-09-30): why can the Data Center / Selector / Risk Manager design not reach the user's expectation?
TRAINING FIELD ONLY (trade-day < 2026-06-01, read via adx_asof). Parts:
 A  requirement: what mean R/trade x trades/year is needed for 10,000 -> 20.6M USC in one year at 5% risk/trade (bootstrap of the
    real per-trade R shape, shifted), vs what the library has
 D  learning vs change: how fast set-level edges change (month-to-month rank correlation) and how many months are needed to
    measure an edge with the noise of one set (true spread of edges vs sampling noise)
 E  cost: mean R before cost (r_raw) vs after (r_std) per TF
 F  streaks: does the result of the previous k trades (same set) change the next trade?
Output: printed + C:\trade datacenter\rc\rc_basic.txt (caller redirects)."""
import sys, datetime as dt
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np
from adx_asof import as_of, params

LIM = (dt.date(2026, 6, 1) - dt.date(1970, 1, 1)).days
L = as_of("2026-06-01"); k = L["day"] < LIM; L = {c: v[k] for c, v in L.items()}
P = {p["set_id"]: p for p in params()}
sid = L["set_id"]; r = L["r_std"]; raw = L["r_raw"]; day = L["day"]
tf = np.array([P[int(s)]["tf"] for s in sid])
yrs = (day.max() - day.min() + 1) / 365.25
rng = np.random.default_rng(7)
print(f"training field {yrs:.2f} years, {len(r)} set-trades, {len(np.unique(sid))} sets")

# ---------------- A requirement ----------------
print("\n=== A: what is needed for x2060 in one year at 5% risk per trade (one position at a time) ===")
def med_final(base, shift, n, f=0.05, reps=2000):
    x = rng.choice(base, size=(reps, n)) + shift
    lg = np.log1p(np.clip(f * x, -0.999, None)).sum(1)
    return np.exp(np.median(lg)), np.mean(lg >= np.log(2060))
for name, m in (("live set 45 (M1 A8E40 SL8 L)", sid == 45), ("all sets pooled", np.ones(len(r), bool))):
    base = r[m] - r[m].mean(); sd = r[m].std()
    print(f"  shape of {name}: sd {sd:.2f} R/trade, trades/yr per set {m.sum() / yrs / (1 if name.startswith('live') else 432):.0f}")
    for n in (250, 500, 1000):
        lo, hi = 0.0, 2.0
        for _ in range(30):
            mid = (lo + hi) / 2
            if med_final(base, mid, n, reps=600)[0] >= 2060: hi = mid
            else: lo = mid
        print(f"    {n:5d} trades/yr: need mean >= {hi:+.3f} R/trade (median path)")
ms = np.array([r[sid == s].mean() for s in np.unique(sid)])
ns = np.array([(sid == s).sum() / yrs for s in np.unique(sid)])
print(f"  library: median set {np.median(ms):+.3f} R/trade, best set {ms.max():+.3f} (in-sample, n/yr {ns[ms.argmax()]:.0f}),"
      f" sets >= +0.20 with >=250 trades/yr: {((ms >= 0.20) & (ns >= 250)).sum()}")
for s in (45,):
    mu = r[sid == s].mean(); n = (sid == s).sum() / yrs
    print(f"  live set 45 here: {mu:+.3f} R/trade x {n:.0f}/yr ; 5% median final x{med_final(r[sid == s] - mu, mu, int(n))[0]:.2f}")

# ---------------- E cost ----------------
print("\n=== E: cost per TF (mean R/trade before cost r_raw vs after r_std) ===")
for t in (1, 3, 5):
    m = tf == t
    print(f"  M{t}: before {raw[m].mean():+.3f}  after {r[m].mean():+.3f}  cost {raw[m].mean() - r[m].mean():.3f} R/trade"
          f"  sets positive before {np.mean([raw[(sid == s)].mean() > 0 for s in np.unique(sid[m])]):.0%} after"
          f" {np.mean([r[(sid == s)].mean() > 0 for s in np.unique(sid[m])]):.0%}")

# ---------------- D learning vs change ----------------
print("\n=== D: can a learner keep up? (set-level monthly R) ===")
mon = np.array([(dt.date(1970, 1, 1) + dt.timedelta(days=int(d))).year * 12 + (dt.date(1970, 1, 1) + dt.timedelta(days=int(d))).month for d in day])
um = np.unique(mon); us = np.unique(sid)
M = np.full((len(us), len(um)), np.nan); N = np.zeros_like(M); V = np.zeros_like(M)
si = np.searchsorted(us, sid); mi = np.searchsorted(um, mon)
for a, b, x in zip(si, mi, r):
    N[a, b] += 1
S1 = np.zeros_like(M); S2 = np.zeros_like(M)
np.add.at(S1, (si, mi), r); np.add.at(S2, (si, mi), r * r)
with np.errstate(invalid="ignore", divide="ignore"):
    M = S1 / N; V = S2 / N - M ** 2
def rk(x): return np.argsort(np.argsort(x))
for lag in (1, 3, 6, 12):
    cs = []
    for b in range(len(um) - lag):
        ok = (N[:, b] >= 10) & (N[:, b + lag] >= 10)
        if ok.sum() > 30: cs.append(np.corrcoef(rk(M[ok, b]), rk(M[ok, b + lag]))[0, 1])
    print(f"  rank corr of set mean R, month m vs m+{lag:2d}: {np.mean(cs):+.3f}  (months {len(cs)})")
# true spread of set edges within one month vs sampling noise
tv, nv = [], []
for b in range(len(um)):
    ok = N[:, b] >= 10
    if ok.sum() < 30: continue
    tot = np.var(M[ok, b]); noise = np.mean(V[ok, b] / N[ok, b])
    tv.append(max(tot - noise, 0)); nv.append(noise)
true_sd = np.sqrt(np.mean(tv)); per_trade_sd = np.sqrt(np.mean(V[N >= 10]))
tpm = np.median(N[N > 0])
print(f"  within a month: spread of TRUE set edges ~{true_sd:.3f} R/trade, one-trade sd ~{per_trade_sd:.2f} R, median trades/set/month {tpm:.0f}")
need = (per_trade_sd / true_sd) ** 2
print(f"  trades needed so that SE = true spread: {need:.0f}  =  {need / tpm:.1f} months of one set")
# full-period: is there stable set edge at all? split halves
h = day < (dt.date(2025, 5, 8) - dt.date(1970, 1, 1)).days
a1 = np.array([r[(sid == s) & h].mean() for s in us]); a2 = np.array([r[(sid == s) & ~h].mean() for s in us])
print(f"  set mean R first half vs second half: rank corr {np.corrcoef(rk(a1), rk(a2))[0, 1]:+.3f}")

# ---------------- F streaks ----------------
print("\n=== F: does a losing streak say anything about the next trade? (same set, time order) ===")
o = np.lexsort((L["entry_t"], sid)); ss = sid[o]; ww = r[o] > 0
# residual vs the set's own mean: sets with low winrate / big wins have long streaks AND bigger wins -> would fake an effect
smean = {s: r[sid == s].mean() for s in np.unique(sid)}; swin = {s: (r[sid == s] > 0).mean() for s in np.unique(sid)}
rr = r[o] - np.array([smean[s] for s in ss]); wexp = np.array([swin[s] for s in ss])
for kk in (1, 2, 3, 5, 8):
    lose = np.ones(len(rr), bool)
    for j in range(1, kk + 1):
        prev = np.r_[np.zeros(j, bool), ~ww[:-j]] & np.r_[np.zeros(j, bool), ss[j:] == ss[:-j]]
        lose &= prev
    print(f"  after {kk} losses in a row: n {lose.sum():7d}  next R vs own set {rr[lose].mean():+.3f}"
          f"  win {ww[lose].mean():.1%} vs own-set expectation {wexp[lose].mean():.1%}")
