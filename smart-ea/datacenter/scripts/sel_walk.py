r"""Walk-forward of the Selector (sel_lib.select + sel_exit exit rule) over the TRAINING FIELD only (trade-day < 2026-06-01).
Usage: python sel_walk.py [first YYYY-MM] [last YYYY-MM] [--noexit]
       default 2025-04 .. 2026-05 (14 months, each with a full 12-month window)
Month m: at T = first day 00:00 UTC, lib = as_of(T) (+ r_adj from sel_exit), picks = select(T, lib); trade the picks for trade-days
in [T, next month). Output -> sel_walk_out.npz (per-month picks and the trade list) and a printed summary.
Leak test each month: every trade not fully closed at T gets garbage R/day; picks must not change (and must change when the
garbage is fed unfiltered = the test has teeth).
Compounding: trades of all picks in exit-time order, each set risks f/K of equity per trade (sequential approximation;
simultaneous open trades are not modelled). Resets are not applied (one continuous path).
"""
import sys, os, datetime as dt
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np
import sel_lib as S, sel_exit as X
from adx_asof import as_of

LIM = (dt.date(2026, 6, 1) - dt.date(1970, 1, 1)).days
OUT = os.path.join(os.path.dirname(__file__), "..", "sel", "sel_walk_out.npz")
def dnum(y, m): return (dt.date(y, m, 1) - dt.date(1970, 1, 1)).days
def nxt(y, m): return (y + (m == 12), m % 12 + 1)

def with_adj(L, use_exit):
    L = dict(L)
    if use_exit: L["r_adj"], L["exit_adj"], L["cut"] = X.adjusted(L)
    else: L["r_adj"], L["exit_adj"], L["cut"] = L["r_std"].astype(float), L["exit_t"].copy(), np.zeros(len(L["r_std"]), bool)
    return L

def run(first="2025-04", last="2026-05", use_exit=True, leak=True, verbose=True):
    y, m = map(int, first.split("-")); y1, m1 = map(int, last.split("-"))
    ALL = as_of("2026-06-01"); k = ALL["day"] < LIM
    ALL = with_adj({c: v[k] for c, v in ALL.items()}, use_exit)
    months, trades = [], []
    while (y, m) <= (y1, m1):
        T = f"{y}-{m:02d}-01"; a = dnum(y, m); b = min(dnum(*nxt(y, m)), LIM); t0 = S.to_ts(T)
        lib = with_adj(as_of(T), use_exit)
        pick, dg = S.select(T, lib)
        teeth = None
        if leak:
            g = {c: v.copy() for c, v in ALL.items()}
            bad = ~(g["exit_t"] + 60 <= t0); rng = np.random.default_rng(y * 100 + m)
            g["r_adj"][bad] = rng.normal(0, 5, bad.sum()); g["day"][bad] += rng.integers(-300, 300, bad.sum())
            p2, _ = S.select(T, {c: v[~bad] for c, v in g.items()})
            assert p2 == pick, f"LEAK at {T}"
            teeth = S.select(T, g)[0] != pick
        nx = (ALL["day"] >= a) & (ALL["day"] < b)
        per = []
        for s in pick:
            kk = nx & (ALL["set_id"] == s)
            per.append(ALL["r_adj"][kk].sum())
            trades += list(zip(ALL["exit_adj"][kk], ALL["r_adj"][kk], [s] * kk.sum(), ALL["day"][kk]))
        months.append((T, [int(s) for s in pick], dg, float(np.mean(per)), teeth))
        if verbose: print(T, [int(s) for s in pick], "elig", dg["n_eligible"], "avg R/set %+.1f" % np.mean(per), "teeth" if teeth else "")
        y, m = nxt(y, m)
    trades.sort()
    return months, np.array(trades, dtype=float)

def compound(rs, f, k=S.K, start=10000.0):
    eq = start; peak = eq; dd = 0.0
    for x in rs:
        eq *= 1 + f / k * x; peak = max(peak, eq); dd = max(dd, 1 - eq / peak)
    return eq, dd

if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    f = args[0] if args else "2025-04"; l = args[1] if len(args) > 1 else "2026-05"
    ue = "--noexit" not in sys.argv
    months, tr = run(f, l, ue)
    r = np.array([x[3] for x in months])
    print("exit rule:", ue, " months", len(r), " sum avg-R-per-set %.1f  positive months %d/%d" % (r.sum(), (r > 0).sum(), len(r)))
    for f_ in (0.01, 0.02, 0.05):
        eq, dd = compound(tr[:, 1], f_)
        print("  total risk %.0f%%/trade (each set %.2f%%): 10000 -> %.0f  maxDD %.0f%%" % (f_ * 100, f_ * 100 / S.K, eq, dd * 100))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    np.savez(OUT.replace(".npz", "" if ue else "_noexit") + ("" if OUT.endswith(".npz") else ""),
             months=np.array([x[0] for x in months]), picks=np.array([x[1] for x in months]),
             month_r=r, trades=tr)
