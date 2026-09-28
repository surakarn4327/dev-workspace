"""Stage 3 (2026-09-28): strategies built from the catalog footprints, measured in R (user allowed R measurement 2026-09-28).
Rules are fixed in advance (not tuned). Simulation on M1 bars for every TF:
  entry   close of the signal bar (TF bar = its last M1 bar) ; allowed any time the market is open before the 16:00 UTC (23:00 Thai) forced close
  exit    SL / TP (TP = 2R or 3R) on M1 highs/lows ; SL and TP inside the same M1 bar = SL (conservative) ;
          forced close at the close of the last M1 bar before 16:00 UTC (23:00 Thai) or at the end of the trading day, whichever first
  cost    COST price units per trade (default 0.39 = real-tick spread 0.26 + calibrated execution/swap cost 0.13) -> R_net = R - COST / risk
Signals (TF bars, regime from cat_episodes zigzag k ATR, confirmed pivots only):
  S1a  a LOW pivot is confirmed and the regime right after it is UP (higher low + higher high) -> BUY, SL = that low
  S1b  a HIGH pivot is confirmed (price is already k ATR below the high = inside the pullback) and the regime right after it is UP -> BUY,
       SL = last confirmed low (the level that breaks the uptrend); skipped if SL is closer than 1 ATR
  S2   big DOWN bar (range >= 2 ATR, body >= 50%) while the TF regime is UP -> BUY, SL = entry - 2 ATR
  S3   first close above yesterday's high on that trading day -> BUY, SL = entry - 2 ATR
  mirror (SELL) for every rule: LOW<->HIGH, UP<->DOWN, down bar<->up bar, yesterday's low."""
import numpy as np
import cat_bars as CB, cat_struct as CS, cat_episodes as CE
M = CB.m1(); FS = set(int(x) for x in CB.full_list()); T = M["t"]; SID = M["sid"]; DAY = M["day"]
TP_R = (2.0, 3.0)
# last M1 index a trade entered at bar i may use: before the next 16:00 UTC and inside the same trading day
_n16 = ((T - 16 * 3600) // 86400 + 1) * 86400 + 16 * 3600
_last = np.searchsorted(T, _n16, "left") - 1
_send = np.r_[np.flatnonzero(np.diff(SID)), len(T) - 1]; _send_of = _send[SID - SID[0]] if np.all(np.diff(np.unique(SID)) == 1) else None
if _send_of is None:
    u, inv = np.unique(SID, return_inverse=True); _send_of = _send[inv]
LAST = np.minimum(_last, _send_of)
HOUR = ((T + 60) // 3600) % 24                                             # UTC hour at the entry bar's close
def entry_ok(i): return ((HOUR[i] < 16) | (HOUR[i] >= 21)) & (LAST[i] > i) & np.isin(DAY[i], list(FS))   # user 2026-09-28: no 21:00-Thai entry filter (EA add-on); 23:00 forced close stays

def simulate(ser, ei, d, sl, cost=0.39):
    """ser = (o,h,l,c) M1 ; ei M1 entry index (enter at c[ei]) ; d +1/-1 ; sl price. returns dict of arrays per TP"""
    o, h, l, c = ser; out = {tp: {"R": [], "exit": []} for tp in TP_R}; keep = []
    for k in range(len(ei)):
        i = int(ei[k]); e = c[i]; s = sl[k]; dd = d[k]; risk = (e - s) * dd
        if not (risk > 0): continue
        a, b = i + 1, LAST[i] + 1
        hh = h[a:b]; ll = l[a:b]
        adv = (ll <= s) if dd > 0 else (hh >= s); js = np.argmax(adv) if adv.any() else 10 ** 9
        keep.append(k)
        for tp in TP_R:
            tgt = e + dd * tp * risk; fav = (hh >= tgt) if dd > 0 else (ll <= tgt); jt = np.argmax(fav) if fav.any() else 10 ** 9
            if jt < js: r, x = tp, a + jt
            elif js < 10 ** 9: r, x = -1.0, a + js
            else: r, x = (c[b - 1] - e) * dd / risk, b - 1
            out[tp]["R"].append(r - cost / risk); out[tp]["exit"].append(x)
    keep = np.array(keep, int)
    for tp in TP_R:
        out[tp]["R"] = np.array(out[tp]["R"]); out[tp]["exit"] = np.array(out[tp]["exit"], int)
    out["keep"] = keep
    return out

def signals(ser, tf, k=3.0):
    """returns dict name -> (m1_entry_idx, dir, sl) for S1a/S1b/S2/S3 BUY and SELL"""
    o, h, l, c = ser; tv = M["tv"].astype(float)
    B = CS.resample(tf, T, SID, o, h, l, c, tv); a = B["atr"]; m1 = B["m1_end"] - 1; n = len(B["c"])
    idx, p, kind, conf = CS.zigzag(B["h"], B["l"], B["c"], a, k)
    st = np.zeros(len(p), int); Hs = []; Ls = []
    for j in range(len(p)):
        (Hs if kind[j] > 0 else Ls).append(p[j])
        if len(Hs) >= 2 and len(Ls) >= 2:
            st[j] = 1 if (Hs[-1] > Hs[-2] and Ls[-1] > Ls[-2]) else (-1 if (Hs[-1] < Hs[-2] and Ls[-1] < Ls[-2]) else 0)
    S = {}
    for dn, d in (("BUY", 1), ("SELL", -1)):
        E1, SL1, E2, SL2 = [], [], [], []
        last_opp = {1: None, -1: None}                                   # last confirmed low (for d=+1) / high (d=-1)
        for j in range(len(p)):
            if kind[j] == -d:                                            # pivot on the stop side (a low for BUY)
                if st[j] == d: E1.append(conf[j]); SL1.append(p[j])
                last_opp[d] = p[j]
            elif st[j] == d and last_opp[d] is not None:                 # a with-trend extreme confirmed = we are in the pullback
                ci = conf[j]
                if (B["c"][ci] - last_opp[d]) * d >= 1.0 * a[ci]: E2.append(ci); SL2.append(last_opp[d])
        S[f"S1a {dn}"] = (np.array(E1, int), np.array(SL1))
        S[f"S1b {dn}"] = (np.array(E2, int), np.array(SL2))
        R = CE.regime_bars(B, k); rng_ = B["h"] - B["l"]; col = np.sign(B["c"] - B["o"])
        big = np.isfinite(a) & (rng_ >= 2 * a) & (np.abs(B["c"] - B["o"]) >= 0.5 * rng_) & (col == -d) & (R == d)
        i = np.flatnonzero(big); S[f"S2 {dn}"] = (i, B["c"][i] - d * 2 * a[i])
        bday = DAY[m1]; ud = np.unique(bday); ext = {}
        for x in ud:
            mm = bday == x; ext[x] = (B["h"][mm].max(), B["l"][mm].min())
        prev = dict(zip(ud[1:], ud[:-1])); E3 = []
        for x in ud[1:]:
            lvl = ext[prev[x]][0 if d > 0 else 1]; ix = np.flatnonzero(bday == x); hit = ix[(B["c"][ix] - lvl) * d > 0]
            if len(hit): E3.append(hit[0])
        E3 = np.array(E3, int); S[f"S3 {dn}"] = (E3, B["c"][E3] - d * 2 * a[E3])
    out = {}
    for name, (bi, sl) in S.items():
        d = 1 if name.endswith("BUY") else -1
        ok = np.isfinite(a[bi]) & np.isfinite(sl) if len(bi) else np.zeros(0, bool)
        bi, sl = bi[ok], sl[ok]; ei = m1[bi]; g = entry_ok(ei); out[name] = (ei[g], np.full(g.sum(), d), sl[g], a[bi][g])
    return out

def one_at_a_time(ei, exit_idx):
    """accept a signal only when no earlier accepted trade of the same strategy is still open"""
    order = np.argsort(ei, kind="stable"); acc = np.zeros(len(ei), bool); busy = -1
    for q in order:
        if ei[q] > busy: acc[q] = True; busy = exit_idx[q]
    return acc
