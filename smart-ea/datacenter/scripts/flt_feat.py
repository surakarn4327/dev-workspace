r"""Entry-time filters for AdxEmaVol (user 2026-10-01): features known at an M1 entry bar i (only bars < i), for ANY entry bar
(not only the entries of the stored library, because a filter changes which later signals get taken).
Prices P = close of bar i-1. Everything is normalised by ADR20 of the trading day (Z.adr) so M1/M3/M5 sets compare.

Features (before direction adjustment; 'up' = above price, 'dn' = below):
  pos        position in today's range so far (bars < i) 0 = at the low, 1 = at the high   (= ctx d_day_pos, checked)
  pdc        (P - previous trading day close) / ADR
  up20 dn20 up50 dn50   distance (ADR) to the nearest UNBROKEN zigzag $20 / $50 pivot (confirmed before i, <= 20 trading days old, no
             close beyond it) above / below price (nan = none)
  pdh pdl pwh pwl       signed distance to previous day / week high (P below it = positive: (H - P)/ADR) and low ((P - L)/ADR)
  bu20 bd20 bu50 bd50   minutes since price last CLOSED through a $20 / $50 pivot high (bu) / low (bd); 9999 = none in the last 240 min
Trade-direction versions are made in flt_screen (d = +1 BUY / -1 SELL)."""
import sys
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, zn_lib as ZL, broker as BK

WIN_BRK = 240

def build_levels(Z):
    """per swing size: arrays sorted by conf (p, kind, conf, brk, cday) and by brk"""
    L = {}
    for s in (20, 50):
        z = Z.sw[s]; o = np.argsort(z["brk"], kind="stable")
        L[s] = dict(p=z["p"], kind=z["kind"], conf=z["conf"], brk=z["brk"], cday=Z.di[z["conf"]],
                    b_brk=z["brk"][o], b_kind=z["kind"][o])
    return L

def feats_at(M, Z, L, idx):
    """features for M1 entry bar indices idx (array)"""
    idx = np.asarray(idx, np.int64); n = len(idx); c = M["c"]; di = Z.di[idx]
    P = c[idx - 1]; adr = Z.adr[di]
    out = {"adr": adr, "P": P}
    ds = Z.dstart[di]
    hi = np.full(n, np.nan); lo = np.full(n, np.nan)
    for k in range(n):                                   # day range from the day start to bar i-1 (only n ~ 1e5)
        if idx[k] > ds[k]: hi[k] = M["h"][ds[k]:idx[k]].max(); lo[k] = M["l"][ds[k]:idx[k]].min()
    with np.errstate(invalid="ignore", divide="ignore"):
        out["pos"] = np.where(hi > lo, (P - lo) / (hi - lo), np.nan)
        pdx = di - 1; ok = pdx >= 0; pdx = np.clip(pdx, 0, None)
        out["pdc"] = np.where(ok, (P - Z.dC[pdx]) / adr, np.nan)
        out["pdh"] = np.where(ok, (Z.dH[pdx] - P) / adr, np.nan); out["pdl"] = np.where(ok, (P - Z.dL[pdx]) / adr, np.nan)
        out["pwh"] = (Z.prev["w"]["H"][di] - P) / adr; out["pwl"] = (P - Z.prev["w"]["L"][di]) / adr
    for s in (20, 50):
        D = L[s]; up = np.full(n, np.nan); dn = np.full(n, np.nan); bu = np.full(n, 9999.0); bd = np.full(n, 9999.0)
        for k in range(n):
            i = idx[k]; lo_ = np.searchsorted(D["cday"], di[k] - ZL.MAXAGE, "left"); hi_ = np.searchsorted(D["conf"], i, "left")
            if hi_ > lo_:
                sl = slice(lo_, hi_); un = D["brk"][sl] >= i; p_ = D["p"][sl][un]
                if len(p_):
                    a = p_[p_ > P[k]]; b = p_[p_ < P[k]]
                    if len(a): up[k] = (a.min() - P[k]) / adr[k]
                    if len(b): dn[k] = (P[k] - b.max()) / adr[k]
            a0 = np.searchsorted(D["b_brk"], i - WIN_BRK, "left"); a1 = np.searchsorted(D["b_brk"], i, "left")      # broken at bar < i
            if a1 > a0:
                kk = D["b_kind"][a0:a1]; bb = D["b_brk"][a0:a1]
                if (kk > 0).any(): bu[k] = i - bb[kk > 0].max()
                if (kk < 0).any(): bd[k] = i - bb[kk < 0].max()
        out[f"up{s}"] = up; out[f"dn{s}"] = dn; out[f"bu{s}"] = bu; out[f"bd{s}"] = bd
    return out

def directed(F, d):
    """direction-relative features (d +1 BUY / -1 SELL). rel_pos 1 = far side in trade direction; ahead/behind = nearest unbroken pivot in /
    against the trade direction; with/against = broke a pivot in the trade direction / against it (minutes ago)"""
    d = np.asarray(d); o = {}
    o["rel_pos"] = np.where(d > 0, F["pos"], 1 - F["pos"]); o["pdc_d"] = F["pdc"] * d
    for s in (20, 50):
        o[f"ahead{s}"] = np.where(d > 0, F[f"up{s}"], F[f"dn{s}"]); o[f"behind{s}"] = np.where(d > 0, F[f"dn{s}"], F[f"up{s}"])
        o[f"brk_with{s}"] = np.where(d > 0, F[f"bu{s}"], F[f"bd{s}"]); o[f"brk_against{s}"] = np.where(d > 0, F[f"bd{s}"], F[f"bu{s}"])
    o["pd_ahead"] = np.where(d > 0, F["pdh"], F["pdl"]); o["pd_behind"] = np.where(d > 0, F["pdl"], F["pdh"])
    o["pw_ahead"] = np.where(d > 0, F["pwh"], F["pwl"]); o["pw_behind"] = np.where(d > 0, F["pwl"], F["pwh"])
    return o
