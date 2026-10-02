r"""Whole-path flip test (user 2026-09-30: "just run 1 Jan 2026 -> today: how many R, how much money").
Runs the AdxEmaVol one-position-at-a-time path for every set, twice: (a) hold to the planned exit (= library), (b) flip rule: while a position is open, the FIRST
opposite-direction signal (passes the set's ADX/gap filters, inside the trading window) whose volume ratio is >= 0.90 while the open position was entered at
volume ratio < 0.90 closes it at that tick (r_cut) and opens the opposite trade N (its own SL/TP). N can be flipped again by the same rule.
Rule fixed in advance (not tuned): user's case "SELL opened at low volume, BUY signal at high volume". Also shown: flip on any high-volume opposite signal.
Money: start 10,000 USC on 2026-01-01, risk 5% of equity x volume multiplier (0.5 / 1.5), lot cap 200 (USC: lot = risk*0.01/SL$), r_std (cost $0.31 per trade),
no swap / lot rounding. Usage: python flip_path.py [YYYY-MM-DD start] [YYYY-MM-DD end-exclusive]"""
import os, sys, itertools, time
import numpy as np
os.environ.setdefault("FLIP_END", "2099-01-01")
import broker as BK, adx_lib as A
import flip_events as F
from dc_sessions import sessions

START = sys.argv[1] if len(sys.argv) > 1 else "2026-01-01"; STOP = sys.argv[2] if len(sys.argv) > 2 else "2099-01-01"
COST, THR = F.COST, F.VOL_THR
EA_SET = (1, 8, 40, 29.0, 9.2, 8.0, "L")             # M1 ADX8 EMA40 MinADX29 gap9.2 SL8 ATR84 ladder = the EA's current set

def mult(vr): return 1.0 if vr < 0 else (0.5 if vr < THR else 1.5)
def std(r, sp, risk): return r - (COST - sp) / risk if risk > 0 else 0.0

def path(mk, S, VR, ma, gp, sl, ex, cache, rule, lo, hi, tu):
    """rule: None (hold) | 'user' (T low & signal high) | 'high' (signal high, any T). Returns list of (entry_t, r_std, mult, risk_px, kind)."""
    sel = np.flatnonzero((S["adx"] >= ma) & (S["gap"] >= gp)); out = []; cur = None
    def get(j):
        k = (int(j), sl, ex); T = cache.get(k)
        if T is None: T = A.trade(mk, S, j, sl, ex); cache[k] = T
        return T
    def close_plan(T, j):
        if T["reason"] == 4: return
        out.append((int(tu[T["e"]]), std(T["r"], T["sp_entry"], T["risk"]), mult(VR[j]), T["risk"], "plan"))
    for j in sel:
        e = int(S["e"][j])
        if not (lo <= tu[e] < hi): continue
        if cur is not None:
            Tc, jc = cur
            if Tc["exit_i"] < e or (Tc["exit_i"] == e and Tc["at_open"]): close_plan(Tc, jc); cur = None
        if cur is None:
            cur = (get(j), int(j)); continue
        Tc, jc = cur
        if rule and S["dir"][j] == -Tc["d"] and VR[j] >= THR and (rule == "high" or 0 <= VR[jc] < THR):
            rc, _, _ = F.cut_trade(mk, S, Tc, e, sl, ex)
            out.append((int(tu[Tc["e"]]), std(rc, Tc["sp_entry"], Tc["risk"]), mult(VR[jc]), Tc["risk"], "cut"))
            cur = (get(j), int(j))
    if cur is not None: close_plan(*cur)
    return out

def money(trs, start=10000.0, risk=0.05, cap=200.0, unit=0.01):
    eq = start; peak = eq; mdd = 0.0; capped = 0
    for _, r, m, rk, _k in sorted(trs, key=lambda x: x[0]):
        want = eq * risk * m; cr = cap * rk / unit; use = min(want, cr); capped += want > cr
        eq = max(eq + use * r, 0.0); peak = max(peak, eq); mdd = max(mdd, 1 - eq / peak if peak > 0 else 0)
    return eq, mdd, capped

def summ(trs):
    R = sum(x[1] for x in trs); Rw = sum(x[1] * x[2] for x in trs); eq, dd, cp = money(trs)
    return dict(n=len(trs), R=R, Rw=Rw, eq=eq, dd=dd, capped=cp, cuts=sum(x[4] == "cut" for x in trs))

def main():
    t0 = time.time(); lo, hi = BK.utc_ts(START), BK.utc_ts(STOP)
    M = A.load_m1(BK.utc_ts(F.WARM_FROM) - 86400, BK.utc_ts("2099-01-01")); mk = A.Market(M, 23, 16, 0); tu = BK.server_to_utc(M["t"])
    res = {}
    for tf, ap, ep in itertools.product(F.TFS, F.ADXS, F.EMAS):
        S = A.signals(mk, tf, ap, ep); cache = {}
        VR = np.where(BK.server_to_utc(S["vol_base_t"]) < BK.T0, -1.0, S["vol_ratio"])
        for ma, gp, sl, ex in itertools.product(F.MINADX, F.GAPS, F.SLS, F.EXITS):
            key = (tf, ap, ep, ma, gp, sl, ex)
            res[key] = {rule: summ(path(mk, S, VR, ma, gp, sl, ex, cache, rule, lo, hi, tu)) for rule in (None, "user", "high")}
        print(f"M{tf} ADX{ap} EMA{ep} done {time.time() - t0:.0f}s", flush=True)
    print(f"\n=== {START} -> latest bar ({time.strftime('%Y-%m-%d', time.gmtime(int(tu[-1])))}) ===")
    e = res[EA_SET]
    print("EA set (M1 ADX8 EMA40 MinADX29 gap9.2 SL8 ladder), start 10,000 USC, risk 5% x vol multiplier, lot cap 200:")
    for rule, lab in ((None, "ถือตามแผน (EA ปัจจุบัน)"), ("user", "พลิก: ไม้เดิม vol ต่ำ + สวน vol สูง"), ("high", "พลิก: สวน vol สูง (ไม้เดิมอะไรก็ได้)")):
        s = e[rule]; print(f"  {lab:40s} trades {s['n']:4d} (cut {s['cuts']:3d})  R {s['R']:+8.1f}  R×size {s['Rw']:+8.1f}  final {s['eq']:>16,.0f} USC  DD {s['dd']:.0%}  capped {s['capped']}")
    for rule, lab in (("user", "user-rule"), ("high", "high-rule")):
        dR = np.array([v[rule]["R"] - v[None]["R"] for v in res.values()]); dW = np.array([v[rule]["Rw"] - v[None]["Rw"] for v in res.values()])
        print(f"all 432 sets, {lab}: sets with higher total R {np.mean(dR > 0):.0%} (median dR {np.median(dR):+.1f}, mean {dR.mean():+.1f}); R×size higher {np.mean(dW > 0):.0%} (median {np.median(dW):+.1f})")
    print("by TF (median dR×size user-rule):", {tf: round(float(np.median([v['user']['Rw'] - v[None]['Rw'] for k, v in res.items() if k[0] == tf])), 1) for tf in (1, 3, 5)})

if __name__ == "__main__":
    main()
