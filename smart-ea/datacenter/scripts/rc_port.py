r"""Root cause follow-up (2026-09-30): how far does DIVERSIFICATION (many sets at once, no selection) go, and at which total risk?
Training field, trade-days 2025-04-01 .. 2026-05-29 (same 14 months as the selector walk). Equal weight: each set risks f/K of
equity per trade. CORRECT concurrent simulation: size fixed at ENTRY from the realised equity at that moment, P&L booked at exit
(the first version compounded trades one after another and counted the same move of many sets many times -> x1000s = artefact).
Also reports the worst simultaneous open risk. Portfolios fixed by rule (not chosen by result). M3 exit rule applied.
Not modelled: margin, min lot / lot step, swap, slippage beyond standard cost."""
import sys, datetime as dt
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np
from adx_asof import as_of, params
import sel_exit as X

LIM = (dt.date(2026, 6, 1) - dt.date(1970, 1, 1)).days; A = (dt.date(2025, 4, 1) - dt.date(1970, 1, 1)).days
L = as_of("2026-06-01"); k = (L["day"] < LIM) & (L["day"] >= A); L = {c: v[k] for c, v in L.items()}
r, ex, _ = X.adjusted(L)
P = {p["set_id"]: p for p in params()}
tf = np.array([P[int(s)]["tf"] for s in L["set_id"]])

def sim(en, ex_, rr, f, K):
    """events: entries and exits in time order (exit before entry at the same second). returns final multiple, maxDD of
    realised equity, max simultaneous risk (fraction of equity)"""
    n = len(rr); t = np.r_[en, ex_]; typ = np.r_[np.ones(n), np.zeros(n)]; idx = np.r_[np.arange(n), np.arange(n)]
    o = np.lexsort((typ, t)); eq = 1.0; pk = 1.0; dd = 0.0; size = np.zeros(n); open_risk = 0.0; mx = 0.0
    for j in o:
        i = idx[j]
        if typ[j] == 1:
            size[i] = f / K * eq; open_risk += size[i]; mx = max(mx, open_risk / eq)
        else:
            eq += size[i] * rr[i]; open_risk -= size[i]
            if eq <= 0: return 0.0, 1.0, mx
            pk = max(pk, eq); dd = max(dd, 1 - eq / pk)
    return eq, dd, mx

for name, m in (("all 432", np.ones(len(r), bool)), ("M5 only", tf == 5), ("M3 only", tf == 3), ("M1 only", tf == 1),
                ("live set 45", L["set_id"] == 45)):
    Ks = len(np.unique(L["set_id"][m]))
    print(f"{name}: {Ks} sets, {m.sum()} trades, R per set {r[m].sum() / Ks:+.1f}, mean {r[m].mean():+.4f} R/trade", flush=True)
    for f in (0.02, 0.05, 0.10, 0.20, 0.40):
        e, d, mx = sim(L["entry_t"][m], ex[m], r[m], f, Ks)
        print(f"   total risk {f:4.0%}: x{e:7.2f} in 14 months, maxDD {d:.0%}, worst open risk at once {mx:.1%} of equity", flush=True)
