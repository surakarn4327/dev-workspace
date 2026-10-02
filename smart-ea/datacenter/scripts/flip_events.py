r"""Flip study (user question 2026-09-30): "hold a SELL opened at low volume; an opposite (BUY) signal appears at high volume — close the SELL
and open the BUY instead. Is that better than holding the SELL to its planned exit?"

Event level, sandbox only (entries >= 2024-04-15, trading day < 2026-06-01, bars before 2026-06-01; the exam period is never loaded).
For every trade T of every one of the 432 AdxEmaVol sets (same simulator/rules as adx_build.py) we look for the opposite-direction signals that
the set skipped while T was open (they pass the set's own ADX / gap filters and the trading window). Per trade we keep the FIRST such signal in each
volume class (vol_ratio >= 0.90 "high", < 0.90 "low"). For each event:
  r_plan = T's planned result (r_std, identical to the library)
  r_cut  = T closed at the entry tick of the signal (Bid for BUY / Ask for SELL, partial TP1/TP2 fills already taken kept), std cost
  r_new  = the opposite trade N opened at that tick with the signal's own SL/TP, walked to its own end, std cost
  flip result = r_cut + r_new ; delta = flip - plan.  Size-weighted version uses the EA's volume multipliers (0.5 / 1.5) for T and N.
Nothing is decided by the result here; this only builds the event table. Usage: python flip_events.py <real|sf1..sf5> """
import os, sys, time, itertools, pickle
import numpy as np
import broker as BK
if len(sys.argv) > 1 and sys.argv[1].startswith("sf"):
    d = os.path.join(os.path.dirname(BK.DB), "p3_null", sys.argv[1]); BK.BARS = os.path.join(d, "bars.npz"); BK.DB = os.path.join(d, "gold_dc.sqlite")
import adx_lib as A
from dc_sessions import sessions

END_UTC, LIB_FROM, WARM_FROM = os.environ.get("FLIP_END", "2026-06-01"), "2024-04-15", "2024-02-01"   # FLIP_END=2099-01-01 -> all data (uses the exam period; user's explicit order 2026-09-30)
SUFFIX = os.environ.get("FLIP_SUFFIX", "")
TFS, ADXS, EMAS, MINADX, GAPS, SLS, EXITS = (1, 3, 5), (8, 14, 28), (5, 40), (0.0, 29.0), (0.0, 9.2), (4.0, 8.0, 12.0), ("L", "T3")
if os.environ.get("FLIP_PILOT"): TFS, ADXS, EMAS = (1,), (8,), (40,)
COST = 0.31; VOL_THR = 0.90

class Prox:
    """Market view whose exit walker is forced to stop (cut) at M1 index cut_at."""
    def __init__(self, mk, cut_at):
        self.M, self.P = mk.M, mk.P
        class NB:
            def __getitem__(s, i): return min(int(mk.next_blk[i]), cut_at)
        self.next_blk = NB()

def cut_trade(mk, S, T, cut_at, sl_mult, exit_mode):
    """T closed at the open tick of M1 bar cut_at (same walker, same fills as the library up to that tick)."""
    j = T["j"]; d = T["d"]; e = T["e"]; ref = S["ref"][j]; atr = S["atr"][j]; sp = mk.M["sp"][e]
    if exit_mode == "L": tp = [ref + d * m * atr for m in A.LADDER]; partial = True
    else:
        r = float(exit_mode[1:]); tp = [ref + d * r * sl_mult * atr] * 3; partial = False
    shift = sp if d == -1 else 0.0; sl0 = ref - d * sl_mult * atr
    W = A.walk_exit(Prox(mk, cut_at), e, d, sl0 + shift, tp[0] + shift, tp[1] + shift, tp[2] + shift, partial, T["entry"])
    assert W["reason"] == 3 and W["exit_i"] == cut_at, (W["reason"], W["exit_i"], cut_at)
    pnl = sum(f * ((p - T["entry"]) if d == 1 else (T["entry"] - p)) for f, p in W["fills"])
    return pnl / T["risk"], W["hit1"], W["hit2"]

def std(r, sp, risk): return r - (COST - sp) / risk if risk > 0 else 0.0

def main():
    tag = sys.argv[1] if len(sys.argv) > 1 else "real"; t0 = time.time()
    lo = BK.utc_ts(LIB_FROM); hi = BK.utc_ts(END_UTC)
    M = A.load_m1(BK.utc_ts(WARM_FROM) - 86400, hi)
    mk = A.Market(M, 23, 16, 0)
    tu = BK.server_to_utc(M["t"]); _, day_all, _ = sessions(tu)
    day_lim = int((BK.utc_ts(END_UTC)) // 86400)          # trading days are keyed by calendar date of the day start; June 1 starts on May 31 17:00 ET
    ev = {}; base = {}; nsets = 0; sid = 0
    for tf, ap, ep in itertools.product(TFS, ADXS, EMAS):
        S = A.signals(mk, tf, ap, ep); cache = {}
        VR = np.where(BK.server_to_utc(S["vol_base_t"]) < BK.T0, -1.0, S["vol_ratio"])   # -1 = window reaches into the unusable (flat) data
        for ma, gp, sl, ex in itertools.product(MINADX, GAPS, SLS, EXITS):
            sid += 1
            sel = np.flatnonzero((S["adx"] >= ma) & (S["gap"] >= gp)); selE = S["e"][sel]
            trades = A.run_set(mk, S, ma, gp, sl, ex, cache)
            tot = 0.0; nt = 0
            for T in trades:
                e = T["e"]
                if not (lo <= tu[e] < hi) or T["reason"] == 4 or day_all[e] >= day_lim: continue
                r_plan = std(T["r"], T["sp_entry"], T["risk"]); tot += r_plan; nt += 1
                vrT = float(VR[T["j"]])
                a, b = np.searchsorted(selE, e, side="right"), np.searchsorted(selE, T["exit_i"], side="left")   # signals with e < e_sig < exit_i
                seen = {}
                if b > a:
                    cand = sel[a:b]; cand = cand[(S["dir"][cand] == -T["d"]) & (VR[cand] >= 0)]
                    if len(cand):
                        hi_ = cand[VR[cand] >= VOL_THR]; lo_ = cand[VR[cand] < VOL_THR]
                        if len(hi_): seen[1] = int(hi_[0])
                        if len(lo_): seen[0] = int(lo_[0])
                for cls, jj in seen.items():
                    key = (tf, ap, ep, sl, ex, T["j"], int(jj), cls)
                    if key in ev:
                        ev[key]["sets"].append(sid); continue
                    es = int(S["e"][jj])
                    rc, h1, h2 = cut_trade(mk, S, T, es, sl, ex)
                    kN = (int(jj), sl, ex); N = cache.get(kN)
                    if N is None: N = A.trade(mk, S, jj, sl, ex); cache[kN] = N
                    if N["reason"] == 4 or day_all[es] >= day_lim: continue
                    vrN = float(VR[jj])
                    ev[key] = dict(tf=tf, adx_p=ap, ema_p=ep, sl=sl, ex=ex, sets=[sid], dT=T["d"], eT=int(tu[e]), es=int(tu[es]), day=int(day_all[e]),
                                   hold_min=int((tu[es] - tu[e]) // 60), vrT=vrT, vrN=vrN, cls=cls,
                                   r_plan=r_plan, r_cut=std(rc, T["sp_entry"], T["risk"]), r_new=std(N["r"], N["sp_entry"], N["risk"]),
                                   hit1=int(h1), hit2=int(h2), plan_reason=T["reason"], new_reason=N["reason"], new_hold=int(N["exit_i"] - es),
                                   adxN=float(S["adx"][jj]), gapN=float(S["gap"][jj]), riskT=T["risk"], riskN=N["risk"])
            base[sid] = (tf, ap, ep, ma, gp, sl, ex, nt, tot)
        print(f"[{tag}] TF M{tf} ADX{ap} EMA{ep}: events {len(ev)}, sets {sid}, {time.time() - t0:.0f}s", flush=True)
    out = os.path.join(os.path.dirname(BK.DB) if tag == "real" else os.path.dirname(BK.DB), f"flip_events_{tag}{SUFFIX}.pkl")
    with open(out, "wb") as f: pickle.dump(dict(events=list(ev.values()), base=base), f)
    print("done", out, len(ev), f"{time.time() - t0:.0f}s")

if __name__ == "__main__":
    main()
