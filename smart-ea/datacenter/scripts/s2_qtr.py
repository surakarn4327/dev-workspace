"""Per-quarter BUY/SELL for an event type vs gold's quarterly move (regime check) + risk shape (streaks, monthly R) for reference cells."""
import numpy as np, sys
from datetime import datetime, timezone
import s2lib as L
TYPE = sys.argv[1] if len(sys.argv) > 1 else "PREVDAY_BREAK"
Z = np.load(f"s2_{TYPE}.npz", allow_pickle=True); ok = Z["ok"]; R = Z["R"]; t, d = Z["t"], Z["dir"]
X = np.load(f"s2ctx_{TYPE}.npz"); bk5 = Z["bk5"]
q = L.quarter_key(t); D = L.days()
dq = L.quarter_key(np.array([int(datetime.strptime(x, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp()) for x in D["date"]]))
a, b = int(np.argmin(abs(L.SLS - 0.10))), int(np.argmin(abs(L.TPS - 0.5))); r = R[:, a, b]
print(f"{TYPE} SL0.10/TP0.5, mean R after spread (n)  | gold quarter move %, mean ADR $")
print(" quarter | gold % | ADR $ | ALL          | BUY          | SELL         | with-backdrop5 BUY / SELL")
for k in sorted(set(q[ok])):
    dm = dq == k; g = (D["close"][dm][-1] / D["open"][dm][0] - 1) * 100; adr = np.nanmean(D["adr20"][dm])
    m = ok & (q == k); f = lambda mm: f"{np.nanmean(r[mm]):+.2f} ({mm.sum():3d})" if mm.sum() else "   --      "
    print(f" {k // 10}Q{k % 10}  | {g:+6.1f} | {adr:5.1f} | {f(m)} | {f(m & (d > 0))} | {f(m & (d < 0))} | {f(m & (d > 0) & (bk5 > 0))} / {f(m & (d < 0) & (bk5 > 0))}")
# risk shape at 1% risk per trade (no compounding): monthly R, worst month, max DD in R, longest losing streak, big-win dependence
for s, tp in ((0.075, 0.5), (0.10, 0.5), (0.125, 0.6), (0.20, 0.6)):
    a, b = int(np.argmin(abs(L.SLS - s))), int(np.argmin(abs(L.TPS - tp))); rr = R[ok, a, b]; tt = t[ok]
    order = np.argsort(tt); rr = rr[order]; tt = tt[order]
    eq = np.cumsum(rr); dd = np.max(np.maximum.accumulate(eq) - eq)
    mon = np.array([datetime.fromtimestamp(int(x), timezone.utc).strftime("%Y-%m") for x in tt])
    ms = np.array([rr[mon == m].sum() for m in sorted(set(mon))])
    srt = np.sort(rr)[::-1]; top10 = srt[:10].sum() / rr.sum()
    print(f"\nSL {s}/TP {tp}: n {len(rr)} total {rr.sum():+.1f}R  maxDD {dd:.1f}R  months+ {np.mean(ms > 0):.0%} ({(ms > 0).sum()}/{len(ms)})"
          f" worst month {ms.min():+.1f}R  longest losing streak {L.max_losing_streak(rr)}  top-10 trades = {top10:.0%} of total"
          f"  | without top-10: {rr.sum() - srt[:10].sum():+.1f}R")
