r"""Pattern-outcome library, layer 1a (user 2026-09-30): more footprint families on M1/M3/M5, labelled on the SAME bars as the library
(adx_ctx.resample of the TF; library row = bar R["b"]). Every label of bar b uses bars <= b only (pivots once confirmed).
Structure = the verified integer zigzag 3 ATR (adx_ctx.zigzag_state); multi-pivot rules = cat_struct.formations / retests (catalog step 2).
Families (direction = what the pattern points to; the evaluation trades with / against it):
  tri       contracting triangle (4 legs each <= 0.85 x previous), at the confirmation of its last pivot; dir = first (largest) leg
  broaden   expanding (each leg >= 1.18 x previous); dir = last leg
  hs / ihs  head & shoulders top / inverse; dir = expected break (hs -1, ihs +1)
  triple    3 same-kind pivots within 0.5 ATR; dir = away from them
  flag      impulse >= 8 ATR then 3 small legs in its outer half; dir = impulse
  vrev      leg >= 6 ATR in <= 10 bars retraced >= 80% in <= 10 bars; dir = retracing leg
  exhaust   3 impulses making new extremes, each shorter; dir = the trend
  retest    after a swing level is broken (> 0.25 ATR) and price left it (>= 1 ATR), the first bar back within 0.25 ATR; dir = break
  pb_shallow / pb_mid / pb_deep   in a trend (higher high + higher low, or mirror) a pullback pivot is confirmed; depth = pullback / the
            trend leg before it  < 0.382 / 0.382-0.618 / > 0.618 ; dir = trend
Extra context per row: htf = zigzag-3 regime of the next TF up (M1 -> M5, M3 -> M15, M5 -> M15), last CLOSED bar at the decision time
(adx_ctx.last_closed, phase-2 verified rule).
Usage: python po_fam2.py <tf>    -> po\po_fam2_m<tf>_<market>.npz for real, sf1, sf2, sf3 (int8 direction per row, 0 = no event)"""
import sys, os, time
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, po_lib as PO, adx_ctx as X, cat_struct as CS
HTF = {1: 5, 3: 15, 5: 15}
FAM2 = ["tri", "broaden", "hs", "ihs", "triple", "flag", "vrev", "exhaust", "retest", "pb_shallow", "pb_mid", "pb_deep"]

def labels(M, tf, R):
    B = X.resample(M, tf); n = len(B["c"]); A = B["atr_prev"]
    idx, pp, kind, conf, ncf, EP = X.zigzag_state(B, 3)
    lab = {f: np.zeros(n, np.int8) for f in FAM2}
    j_of_conf = {int(c): j for j, c in enumerate(conf)}
    for typ, cb, d, x1 in CS.formations(idx, pp, kind, conf, A):
        j = j_of_conf[int(cb)]
        if typ == "TRIANGLE": d = int(np.sign(pp[j - 3] - pp[j - 4]))
        elif typ == "BROADEN": d = int(np.sign(pp[j] - pp[j - 1]))
        f = {"TRIANGLE": "tri", "BROADEN": "broaden", "HS": "hs", "IHS": "ihs", "TRIPLE": "triple", "FLAG": "flag", "V_REV": "vrev", "EXHAUST": "exhaust"}[typ]
        lab[f][cb] = d
    for out, b, r, d, _ in CS.retests(idx, pp, kind, conf, B["h"], B["l"], B["c"], A, B["sid"]):
        if r >= 0: lab["retest"][r] = d
    for j in range(3, len(pp)):                                     # pullback pivot j after a trend leg (pivot j-1 = end of the trend leg)
        s = -kind[j]                                                 # trend direction: pullback low (kind -1) in an up trend -> +1
        if not (s * (pp[j] - pp[j - 2]) > 0 and s * (pp[j - 1] - pp[j - 3]) > 0): continue
        leg = abs(pp[j - 1] - pp[j - 2]); pb = abs(pp[j - 1] - pp[j])
        if leg <= 0: continue
        q = pb / leg; f = "pb_shallow" if q < 0.382 else ("pb_mid" if q <= 0.618 else "pb_deep")
        lab[f][conf[j]] = s
    b = R["b"]
    out = {f"f_{f}": lab[f][b] for f in FAM2}
    # higher-TF regime at the decision time
    H = X.resample(M, HTF[tf]); hi, hp, hk, hc, _, _ = X.zigzag_state(H, 3); reg, known, chg, dH, dL = X.regime_after(hp, hk)
    nh = len(H["c"]); last = np.full(nh, -1); last[hc] = np.arange(len(hc)); last = np.maximum.accumulate(last)
    regbar = np.where(last >= 0, np.where(known, reg, 0)[np.clip(last, 0, None)], 0)
    jh = X.last_closed(H, R["dec_t"], R["day"])
    out["htf_reg"] = np.where(jh >= 0, regbar[np.clip(jh, 0, None)], 0).astype(np.int8)
    out["htf_bar"] = jh.astype(np.int64)
    return out

if __name__ == "__main__":
    tf = int(sys.argv[1])
    for mkt in ["real", "sf1", "sf2", "sf3"]:
        f = os.path.join(PO.OUTD, f"po_fam2_m{tf}_{mkt}.npz")
        if os.path.exists(f): print("skip", f); continue
        t0 = time.time(); M = PO.load_market(mkt)
        R = {k: v for k, v in np.load(os.path.join(PO.OUTD, f"po_m{tf}_{mkt}.npz")).items() if k in ("b", "dec_t", "day")}
        o = labels(M, tf, R); np.savez(f + ".tmp.npz", **o); os.replace(f + ".tmp.npz", f)
        print(mkt, {k: int((v != 0).sum()) for k, v in o.items() if k.startswith("f_")}, f"{time.time() - t0:.0f}s", flush=True)
