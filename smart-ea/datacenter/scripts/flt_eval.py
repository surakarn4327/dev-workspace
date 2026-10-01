r"""Evaluate the re-simulated filters (flt_resim.pkl). All 432 sets, then the AdxEmaVol-like set (M1 ADX8 EMA40 MinADX29 gap9.2 SL8 ladder).
Periods: P1 entries < 2025-05-08 (first half of the sandbox), P2 2025-05-08 .. 2026-05-31, P3 2026-06-01 .. latest (post-sandbox months).
Metrics per filter and period, summed over the 432 sets (R = r_std, one unit of risk per trade, no sizing):
  n trades, kept share, sum R, dR = sum R - sum R(no filter), sets improved, t of dR (clustered by trading day over the daily dR summed across sets)
V2-like set: sum R, mean R, winrate, 5% compounding with vol_mult (equity 10,000 reset each calendar year, no lot cap), max drawdown.
Output flt\flt_eval.txt"""
import sys, os, pickle, sqlite3, calendar, datetime
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np
OUT = r"C:\trade datacenter\flt"; txt = []
def say(s=""): print(s, flush=True); txt.append(s)
res = pickle.load(open(os.path.join(OUT, "flt_resim.pkl"), "rb"))
db = sqlite3.connect(r"C:\trade datacenter\adx_trades.sqlite")
P = {r[0]: r[1:] for r in db.execute("SELECT set_id, tf, adx_p, ema_p, min_adx, min_gap, sl_atr, exit_mode FROM params")}
ts = lambda y, m, d: calendar.timegm(datetime.datetime(y, m, d).timetuple())
H1, H2 = ts(2025, 5, 8), ts(2026, 6, 1)
V2 = [s for s, v in P.items() if v == (1, 8, 40, 29.0, 9.2, 8.0, "L")][0]
PER = {"P1": (0, H1), "P2": (H1, H2), "P3": (H2, 10 ** 12)}
base = res["none"]
def sel(a, p): lo, hi = PER[p]; return a[(a[:, 0] >= lo) & (a[:, 0] < hi)]
def tstat(x, day):
    u, inv = np.unique(day, return_inverse=True); s = np.bincount(inv, x); n = len(u)
    return s.mean() / (s.std(ddof=1) / np.sqrt(n)) if n > 2 and s.std() > 0 else np.nan
def daily(name, per, tfs=(1, 3, 5)):
    d = {}
    for s, a in res[name].items():
        if P[s][0] not in tfs: continue
        a = sel(a, per)
        for dd, r in zip(a[:, 2].astype(int), a[:, 4]): d[dd] = d.get(dd, 0.0) + r
    return d
say("=== all 432 sets (sum over sets), by period ===")
for name in res:
    if name == "none": continue
    line = f"{name:13s}"
    for per in PER:
        n0 = sum(len(sel(a, per)) for a in base.values()); n1 = sum(len(sel(a, per)) for a in res[name].values())
        R0 = sum(sel(a, per)[:, 4].sum() for a in base.values()); R1 = sum(sel(a, per)[:, 4].sum() for a in res[name].values())
        imp = np.mean([sel(res[name][s], per)[:, 4].sum() > sel(base[s], per)[:, 4].sum() for s in base]); d0 = daily("none", per); d1 = daily(name, per)
        days = sorted(set(d0) | set(d1)); x = np.array([d1.get(d, 0.0) - d0.get(d, 0.0) for d in days]); t = tstat(x, np.array(days))
        line += f" | {per}: kept {n1 / n0:.0%} dR {R1 - R0:+8.1f} (R0 {R0:+8.1f}) sets+ {imp:.0%} t {t:+.1f}"
    say(line)
say("\n=== by TF (dR sum over sets, P1 / P2 / P3) ===")
for name in res:
    if name == "none": continue
    line = f"{name:13s}"
    for tf in (1, 3, 5):
        v = []
        for per in PER:
            v.append(sum(sel(res[name][s], per)[:, 4].sum() - sel(base[s], per)[:, 4].sum() for s in base if P[s][0] == tf))
        line += f" | M{tf}: " + " / ".join(f"{x:+7.1f}" for x in v)
    say(line)
def equity(a, f=0.05):
    out = {}
    for y in (2024, 2025, 2026):
        lo = ts(y, 1, 1); hi = ts(y + 1, 1, 1); b = a[(a[:, 0] >= lo) & (a[:, 0] < hi)]; eq = 10000.0; pk = eq; dd = 0.0
        for r, vm in zip(b[:, 4], b[:, 5]):
            eq *= max(1 + f * vm * r, 0.0); pk = max(pk, eq); dd = max(dd, 1 - eq / pk)
        out[y] = (eq, dd, len(b))
    return out
say(f"\n=== V2-like set {V2} {P[V2]} ===")
for name in res:
    a = res[name][V2]; line = f"{name:13s}"
    for per in PER:
        b = sel(a, per); line += f" | {per}: n {len(b)} R {b[:, 4].sum():+7.1f} mean {b[:, 4].mean():+.3f} win {np.mean(b[:, 4] > 0):.1%}"
    e = equity(a); line += " | 5% vm: " + "  ".join(f"{y} {v[0]:,.0f} dd {v[1]:.0%}" for y, v in e.items())
    say(line)
say("\n=== neighbours of V2 (M1 ADX 8/14/28 x EMA 5/40, MinADX 29, gap 9.2, SL 4/8/12, ladder): dR per period for the best filters ===")
nb = [s for s, v in P.items() if v[0] == 1 and v[3] == 29.0 and v[4] == 9.2 and v[6] == "L"]
say(f"(neighbour sets: {len(nb)})")
for name in res:
    if name == "none": continue
    line = f"{name:13s}"
    for per in PER:
        line += f" | {per} " + f"{sum(sel(res[name][s], per)[:, 4].sum() - sel(base[s], per)[:, 4].sum() for s in nb):+7.1f} (sets+ {np.mean([sel(res[name][s], per)[:, 4].sum() > sel(base[s], per)[:, 4].sum() for s in nb]):.0%})"
    say(line)
open(os.path.join(OUT, "flt_eval.txt"), "w", encoding="utf-8").write("\n".join(txt))
