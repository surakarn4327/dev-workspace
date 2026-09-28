"""Context split for an event type (reads s2_<TYPE>.npz). For a few reference cells: mean R after spread by context, ALL/BUY/SELL, H1/H2."""
import numpy as np, sys
import s2lib as L
TYPE = sys.argv[1] if len(sys.argv) > 1 else "PREVDAY_BREAK"
Z = np.load(f"s2_{TYPE}.npz", allow_pickle=True); ok = Z["ok"]; R = Z["R"]
REF = [(0.075, 0.5), (0.10, 0.5), (0.125, 0.6), (0.20, 0.6)]
ci = [(int(np.argmin(abs(L.SLS - s))), int(np.argmin(abs(L.TPS - tp)))) for s, tp in REF]
D = L.days(); di = {dk: k for k, dk in enumerate(D["day"])}
t, d, day = Z["t"], Z["dir"], Z["day"]
tmid = np.median(t[ok]); half = np.where(t < tmid, 1, 2)
# extra contexts from the days table (all known before the session starts)
def prev(arr, k, lag=1): j = di[day[k]] - lag; return arr[j] if j >= 0 else np.nan
bk20 = np.array([np.sign(prev(D["close"], k) - prev(D["close"], k, 21)) * d[k] for k in range(len(t))])
bk5 = Z["bk5"].astype(float)
prev_net = np.array([prev(D["net_adr"], k) * d[k] for k in range(len(t))])            # yesterday's net move in trade dir (ADR)
prev_type = np.array([str(prev(D["day_type"], k)) for k in range(len(t))])
adr_pct = np.array([D["adr20"][di[day[k]]] / D["open"][di[day[k]]] * 100 for k in range(len(t))])  # market activity: ADR as % of price
act_prev = np.array([prev(D["act"], k) for k in range(len(t))])
gap = np.array([(D["open"][di[day[k]]] - prev(D["close"], k)) / D["adr20"][di[day[k]]] * d[k] for k in range(len(t))])
# both sides broken today before this event? (second break of the day)
second = np.zeros(len(t), bool)
for k in range(len(t)):
    same = (day == day[k]) & (t < t[k]); second[k] = same.any()
hour = Z["hour"]; open_bar = hour == 23
def qcut(x, n=3):
    e = np.nanquantile(x[ok], np.linspace(0, 1, n + 1)); e[-1] += 1e-9
    return np.array([f"q{int(np.searchsorted(e, v, 'right'))}" if np.isfinite(v) else "nan" for v in x]), e
CTX = {"session": Z["session"], "open_bar(23h)": np.where(open_bar, "open", "later"),
       "so_far(ADR)": qcut(Z["so_far"])[0], "activity ADR%price": qcut(adr_pct)[0], "activity prev 1m range": qcut(act_prev)[0],
       "spread/ADR": qcut(Z["spread_adr"])[0], "backdrop5": np.where(bk5 > 0, "with", "against"),
       "backdrop20": np.where(bk20 > 0, "with", "against"), "yesterday net in dir": qcut(prev_net)[0],
       "yesterday type": prev_type, "gap in dir": qcut(gap)[0], "2nd break of day": np.where(second, "second", "first")}
for name, lab in CTX.items():
    extra = ""
    if name in ("so_far(ADR)", "activity ADR%price", "spread/ADR", "yesterday net in dir", "gap in dir", "activity prev 1m range"):
        src = {"so_far(ADR)": Z["so_far"], "activity ADR%price": adr_pct, "spread/ADR": Z["spread_adr"], "yesterday net in dir": prev_net,
               "gap in dir": gap, "activity prev 1m range": act_prev}[name]
        extra = " edges " + " ".join(f"{v:.3g}" for v in qcut(src)[1])
    print(f"\n== {name}{extra}")
    print("  bucket          n  | " + " | ".join(f"SL{s}/TP{tp}: all  BUY  SELL  H1  H2" for s, tp in REF[:2]) + f" | SL{REF[2][0]}/TP{REF[2][1]} all | SL{REF[3][0]}/TP{REF[3][1]} all")
    for b in sorted(set(lab[ok])):
        m = ok & (lab == b)
        if m.sum() < 15: continue
        parts = []
        for a, bb in ci[:2]:
            r = R[:, a, bb]
            f = lambda mm: f"{np.nanmean(r[mm]):+.2f}({mm.sum()})" if mm.sum() >= 8 else "  --   "
            parts.append(f"{f(m)} {f(m & (d > 0))} {f(m & (d < 0))} {f(m & (half == 1))} {f(m & (half == 2))}")
        print(f"  {b:12s} {m.sum():4d} | " + " | ".join(parts) + f" | {np.nanmean(R[m, ci[2][0], ci[2][1]]):+.2f} | {np.nanmean(R[m, ci[3][0], ci[3][1]]):+.2f}")
np.savez(f"s2ctx_{TYPE}.npz", bk20=bk20, adr_pct=adr_pct, prev_net=prev_net, gap=gap, second=second, act_prev=act_prev)
