r"""Context numbers for the Phase-4 walk-forward (training field only, trade-days 2025-04-01 .. 2026-05-29):
selector (sel_walk_out.npz) vs (1) the first-month portfolio held fixed, (2) average of all 432 sets,
(3) the current live set (M1 ADX8 EMA40 MinADX29 gap9.2 SL8 ladder) — all with the M3 exit rule where it applies."""
import sys, os, datetime as dt
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np
from adx_asof import as_of, params
import sel_exit as X, sel_lib as S

LIM = (dt.date(2026, 6, 1) - dt.date(1970, 1, 1)).days; A = (dt.date(2025, 4, 1) - dt.date(1970, 1, 1)).days
Z = np.load(os.path.join(os.path.dirname(__file__), "..", "sel", "sel_walk_out.npz"), allow_pickle=True)
L = as_of("2026-06-01"); k = (L["day"] < LIM) & (L["day"] >= A); L = {c: v[k] for c, v in L.items()}
r, ex, _ = X.adjusted(L)
P = {p["set_id"]: p for p in params()}
cur = [s for s, p in P.items() if p["tf"] == 1 and p["adx_p"] == 8 and p["ema_p"] == 40 and p["min_adx"] == 29 and p["min_gap"] == 9.2 and p["sl_atr"] == 8 and p["exit_mode"] == "L"]
def port(sets):
    m = np.isin(L["set_id"], sets); o = np.argsort(ex[m]); rr = r[m][o]
    out = [rr.sum() / len(sets)]
    for f in (0.01, 0.02, 0.05):
        eq = 1e4; pk = eq; dd = 0
        for x in rr: eq *= 1 + f / len(sets) * x; pk = max(pk, eq); dd = max(dd, 1 - eq / pk)
        out += [eq, dd]
    return out
rows = {"selector (walk)": None, "first-month 5 held fixed": port(list(Z["picks"][0])),
        "all 432 sets equal": port(sorted(P)), "current live set " + str(cur): port(cur)}
tr = Z["trades"][:, 1]; out = [Z["month_r"].sum()]
for f in (0.01, 0.02, 0.05):
    eq = 1e4; pk = eq; dd = 0
    for x in tr: eq *= 1 + f / S.K * x; pk = max(pk, eq); dd = max(dd, 1 - eq / pk)
    out += [eq, dd]
rows["selector (walk)"] = out
print("%-40s %8s | %18s | %18s | %18s" % ("", "R/set", "1%", "2%", "5%"))
for n, v in rows.items():
    print("%-40s %+8.1f | %9.0f DD%4.0f%% | %9.0f DD%4.0f%% | %9.0f DD%4.0f%%" % (n, v[0], v[1], v[2] * 100, v[3], v[4] * 100, v[5], v[6] * 100))
