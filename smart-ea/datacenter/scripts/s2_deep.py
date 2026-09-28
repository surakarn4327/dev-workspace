"""Deep dive for one event type + orientation on a wider grid: grids (ALL/H1/H2/BUY/SELL), quarters vs gold, risk shape, contexts.
usage: s2_deep.py TYPE [rev]"""
import numpy as np, sys
from datetime import datetime, timezone
import s2lib as L
TY = sys.argv[1]; orient = -1 if (len(sys.argv) > 2 and sys.argv[2] == "rev") else 1
SLS = np.array([0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50]); TPS = np.array([0.3, 0.5, 0.75, 1.0, 1.25, 1.5, 9.0])
E = L.events([TY]); d = E["dir"] * orient; t = E["t"]
R, HOLD = L.simulate(t, d, E["U"], sls=SLS, tps=TPS); ok = np.isfinite(R[:, 0, 0])
tmid = np.median(t[ok]); h1 = ok & (t < tmid); h2 = ok & (t >= tmid)
print(f"{TY} {'reversed' if orient < 0 else 'as defined'}: tradable n={ok.sum()}")
def grid(mask, title):
    print(f"\n{title} (n={mask.sum()})\n  SL\\TP " + " ".join(f"{('EOD' if v > 8 else f'{v:.2f}'):>6}" for v in TPS))
    for a, s in enumerate(SLS): print(f"  {s:5.2f} " + " ".join(f"{np.nanmean(R[mask, a, b]):+6.2f}" for b in range(len(TPS))))
for m, ti in ((ok, "ALL"), (h1, "H1"), (h2, "H2"), (ok & (d > 0), "BUY"), (ok & (d < 0), "SELL")): grid(m, ti)
D = L.days(); di = {k: i for i, k in enumerate(D["day"])}; day = E["day"]
q = L.quarter_key(t)
dq = L.quarter_key(np.array([int(datetime.strptime(x, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp()) for x in D["date"]]))
REF = [(0.20, 0.75), (0.30, 1.0), (0.40, 1.25)]
ci = [(int(np.argmin(abs(SLS - s))), int(np.argmin(abs(TPS - tp)))) for s, tp in REF]
a, b = ci[1]; r = R[:, a, b]
print(f"\nquarters, cell SL{REF[1][0]}/TP{REF[1][1]}:  quarter | gold % | ALL | BUY | SELL")
for k in sorted(set(q[ok])):
    dm = dq == k; g = (D["close"][dm][-1] / D["open"][dm][0] - 1) * 100; m = ok & (q == k)
    f = lambda mm: f"{np.nanmean(r[mm]):+.2f} ({mm.sum():3d})" if mm.sum() else "--"
    print(f"  {k // 10}Q{k % 10} | {g:+6.1f} | {f(m)} | {f(m & (d > 0))} | {f(m & (d < 0))}")
for (s, tp), (a, b) in zip(REF, ci):
    rr = R[ok, a, b]; tt = t[ok]; o = np.argsort(tt); rr, tt = rr[o], tt[o]
    eq = np.cumsum(rr); dd = np.max(np.maximum.accumulate(eq) - eq)
    mon = np.array([datetime.fromtimestamp(int(x), timezone.utc).strftime("%Y-%m") for x in tt]); ms = np.array([rr[mon == m].sum() for m in sorted(set(mon))])
    st = L.stats(rr); srt = np.sort(rr)[::-1]
    print(f"SL {s}/TP {tp}: mean {st['mean']:+.3f} t {st['t']:+.1f} wr {st['wr']:.0%} W {st['aw']:+.2f} L {st['al']:+.2f} | total {rr.sum():+.1f}R maxDD {dd:.1f}R "
          f"months+ {(ms > 0).sum()}/{len(ms)} worst {ms.min():+.1f}R streak {st['streak']} hold median {np.nanmedian(HOLD[ok, a, b]):.0f} min | w/o top-10 {rr.sum() - srt[:10].sum():+.1f}R")
# contexts (all known at entry)
def prev(arr, k, lag=1): j = di[day[k]] - lag; return arr[j] if j >= 0 else np.nan
bk20 = np.array([np.sign(prev(D["close"], k) - prev(D["close"], k, 21)) * d[k] for k in range(len(t))])
adr_pct = np.array([D["adr20"][di[day[k]]] / D["open"][di[day[k]]] * 100 for k in range(len(t))])
intraday = np.array([np.sign(0) for _ in t], float)
Bb = L.bars(); ix = np.searchsorted(Bb["t"], t)
intraday = np.array([np.sign(Bb["c"][ix[k]] - D["open"][di[day[k]]]) * d[k] for k in range(len(t))])   # price vs session open, in trade dir
def qcut(x, n=3):
    e = np.nanquantile(x[ok], np.linspace(0, 1, n + 1)); e[-1] += 1e-9
    return np.array([f"q{int(np.searchsorted(e, v, 'right'))}" if np.isfinite(v) else "nan" for v in x]), e
CTX = {"session": E["session"], "so_far": qcut(E["so_far"])[0], "activity ADR%price": qcut(adr_pct)[0], "spread/ADR": qcut(E["spread_adr"])[0],
       "backdrop5": np.where(E["bk5"] * orient > 0, "with", "against"), "backdrop20": np.where(bk20 > 0, "with", "against"),
       "vs session open": np.where(intraday > 0, "with", "against"), "x1": qcut(E["x1"])[0]}
print(f"\ncontexts: mean R  ALL(n) BUY SELL H1 H2 at SL{REF[0]} | SL{REF[1]} | SL{REF[2]}")
for name, lab in CTX.items():
    print(f"== {name}")
    for bk in sorted(set(lab[ok])):
        m = ok & (lab == bk)
        if m.sum() < 20: continue
        parts = []
        for a, b in ci:
            rr = R[:, a, b]; f = lambda mm: f"{np.nanmean(rr[mm]):+.2f}" if mm.sum() >= 8 else "  -- "
            parts.append(f"{f(m)}({m.sum()}) {f(m & (d > 0))} {f(m & (d < 0))} {f(m & h1)} {f(m & h2)}")
        print(f"  {bk:9s} " + " | ".join(parts))
