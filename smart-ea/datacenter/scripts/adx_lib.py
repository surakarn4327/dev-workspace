r"""Phase 1 (smart-ea): trade-by-trade simulator of AdxEmaVol on any trade TF (M1/M3/M5...), same rules as the EA.

Mirrors src\adx-ema-vol\AdxEmaVolCore.mqh + src\shared\PositionLib.mqh (and the TF test copy AdxEmaVolReTF with re-entry off):
- indicators on the TRADE TF: MT5 iADX (+DI/-DI/ADX, EMA smoothing 2/(n+1), buffers start at 0), MT5 iATR (SMA of true range),
  EMA of the ADX main line (running EMA, alpha 2/(n+1))
- signal on a closed TF bar k: ADX[k-1] <= EMA[k-1] and ADX[k] > EMA[k]; filters ADX[k] >= min_adx, |+DI-(-DI)| >= min_gap;
  direction = +DI > -DI ? BUY : SELL
- entry at the first tick (= open of the first M1 bar) of TF bar k+1, if that time is inside the trading window
  [start_h, cutoff_h) server hours and no position is open (one position at a time)
- levels from ref = close of bar k: SL = ref -/+ sl*ATR; ladder TP1/2/3 = ref +/- 15/17/21 ATR (1/3 closed at TP1 and TP2),
  or a single TP = ref +/- tp_r*sl*ATR; SELL levels are shifted by the entry spread (checked against Ask)
- exits walked on M1 bars with the MT5 tick order bullish O-L-H-C / bearish O-H-L-C; SELL uses Ask = Bid + bar spread;
  SL checked before TPs at each point; fill at the level, or at the point price when the bar OPENS through it
- cutoff: at the first M1 bar whose server hour is outside the window, close at its open (Bid for BUY, Ask for SELL)
- R = sum(fraction * pnl) / |entry - SL(unshifted)| (lot rounding/swap ignored)
Every time here is SERVER time (the EA works in server hours); the builder converts to UTC for storage."""
import numpy as np
from scipy.signal import lfilter
import broker as BK

LADDER = (15.0, 17.0, 21.0)
ATR_P = 84

def load_m1(t_from, t_to):
    """M1 bars (server clock) with t_from <= t < t_to; spread converted to price."""
    z = np.load(BK.BARS)
    t = z["t"].astype(np.int64); m = (t >= t_from) & (t < t_to)
    return dict(t=t[m], o=z["o"][m], h=z["h"][m], l=z["l"][m], c=z["c"][m], tv=z["tv"][m].astype(float), sp=z["sp"][m] * BK.POINT)

def tf_bars(M, tf_min):
    """MT5-style TF bars: bar time = floor(t / tf) * tf (server clock); first/last M1 index of each bar."""
    key = M["t"] // (tf_min * 60)
    st = np.concatenate([[0], np.flatnonzero(np.diff(key)) + 1]); en = np.concatenate([st[1:], [len(key)]])
    return dict(t=key[st] * tf_min * 60, st=st, en=en, o=M["o"][st], c=M["c"][en - 1],
                h=np.maximum.reduceat(M["h"], st), l=np.minimum.reduceat(M["l"], st), tv=np.add.reduceat(M["tv"], st))

def _ema0(x, n):
    """y[0] = 0, y[i] = a*x[i] + (1-a)*y[i-1] for i >= 1 (MT5 ExponentialMA with a zero-initialised buffer)."""
    a = 2.0 / (n + 1.0); y = np.zeros(len(x))
    y[1:] = lfilter([a], [1, -(1 - a)], x[1:])
    return y

def mt5_adx(B, n):
    h, l, c = B["h"], B["l"], B["c"]
    ph, pl, pc = np.r_[h[0], h[:-1]], np.r_[l[0], l[:-1]], np.r_[c[0], c[:-1]]
    pos = np.maximum(h - ph, 0.0); neg = np.maximum(pl - l, 0.0)
    pos2 = np.where(pos > neg, pos, 0.0); neg2 = np.where(neg > pos, neg, 0.0)
    tr = np.maximum(np.maximum(np.abs(h - l), np.abs(h - pc)), np.abs(l - pc))
    with np.errstate(divide="ignore", invalid="ignore"):
        pd = np.where(tr != 0, 100.0 * pos2 / tr, 0.0); nd = np.where(tr != 0, 100.0 * neg2 / tr, 0.0)
    pdi = _ema0(pd, n); ndi = _ema0(nd, n); s = pdi + ndi
    with np.errstate(divide="ignore", invalid="ignore"):
        dx = np.where(s != 0, 100.0 * np.abs((pdi - ndi) / s), 0.0)
    return _ema0(dx, n), pdi, ndi

def mt5_atr(B, n):
    h, l, c = B["h"], B["l"], B["c"]; pc = np.r_[c[0], c[:-1]]
    tr = np.maximum(h, pc) - np.minimum(l, pc); tr[0] = h[0] - l[0]
    cs = np.r_[0.0, np.cumsum(tr)]; atr = np.full(len(tr), np.nan)
    atr[n:] = (cs[n + 1:] - cs[1:-n]) / n          # ATR[i] = mean(TR[i-n+1..i]), first value at i = n (MT5 skips TR[0])
    return atr

def ema_running(x, n):
    a = 2.0 / (max(2, n) + 1.0); y = np.empty(len(x)); y[0] = x[0]
    y[1:] = lfilter([a], [1, -(1 - a)], x[1:], zi=[(1 - a) * x[0]])[0]
    return y

def blocked_hour(hour, start_h, cutoff_h):
    allowed = (hour >= start_h) & (hour < cutoff_h) if start_h <= cutoff_h else (hour >= start_h) | (hour < cutoff_h)
    return ~allowed

class Market:
    """M1 bars + everything the exit walker needs (per-bar next-blocked index)."""
    def __init__(self, M, start_h=23, cutoff_h=16, no_entry_before_cutoff_min=0):
        self.M = M; self.start_h, self.cutoff_h = start_h, cutoff_h
        hour = (M["t"] // 3600) % 24
        self.blk = blocked_hour(hour, start_h, cutoff_h)
        mins_left = (cutoff_h * 60 - (M["t"] // 60) % 1440) % 1440   # EA's AdxEmaInLateWindow (phase-1 library uses 0 = off)
        self.no_entry = self.blk | ((mins_left < no_entry_before_cutoff_min) if no_entry_before_cutoff_min > 0 else False)
        n = len(hour); nxt = np.full(n + 1, n, dtype=np.int64)
        idx = np.flatnonzero(self.blk)
        pos = np.searchsorted(idx, np.arange(n))            # next_blk[i] = first blocked index >= i (n if none)
        nxt[:n] = np.where(pos < len(idx), idx[np.minimum(pos, max(len(idx) - 1, 0))], n)
        self.next_blk = nxt
        bull = M["c"] >= M["o"]
        # tick path per bar: open, first extreme, second extreme, close (Bid)
        self.P = np.stack([M["o"], np.where(bull, M["l"], M["h"]), np.where(bull, M["h"], M["l"]), M["c"]], axis=1)

def walk_exit(mk, e, d, sl, tp1, tp2, tp3, partial, entry_px):
    """Walk from entry M1 index e (entry tick = its open). Levels are the (already spread-shifted) broker levels.
    entry_px = the real fill (BUY Ask / SELL Bid); MFE/MAE are measured from it on the price that would close the trade
    (BUY Bid / SELL Ask). Bug fixed 2026-09-28: they used to be measured from the spread-shifted open (off by one spread)."""
    M = mk.M; n = len(M["t"]); cut = mk.next_blk[e + 1] if e + 1 < n else n
    P = mk.P[e:cut].copy()
    if d == -1: P += M["sp"][e:cut, None]
    flat = P.ravel()[1:]                                   # skip the entry tick
    isopen = np.zeros(len(flat), bool); isopen[3::4] = True   # flat 3,7,... = opens of later bars
    if d == 1:
        s_hit, h1, h2, h3 = flat <= sl, flat >= tp1, flat >= tp2, flat >= tp3
    else:
        s_hit, h1, h2, h3 = flat >= sl, flat <= tp1, flat <= tp2, flat <= tp3
    BIG = 10 ** 12
    def first(m):
        k = np.flatnonzero(m); return int(k[0]) if len(k) else BIG
    iS, i3 = first(s_hit), first(h3)
    iX = min(iS, i3)
    fills = []; rem = 1.0; hit = [False, False]
    if partial:
        for q, (lvl, hm) in enumerate(((tp1, h1), (tp2, h2))):
            k = first(hm)
            if k < iX or (k == iX and i3 < iS):
                fills.append((1.0 / 3.0, flat[k] if isopen[k] else lvl)); rem -= 1.0 / 3.0; hit[q] = True
    if iX < BIG:
        reason = 1 if iS <= i3 else 2
        fill = flat[iX] if isopen[iX] else (sl if reason == 1 else tp3)
        exit_i = e + (iX + 1) // 4; at_open = bool(isopen[iX]); seg = flat[:iX + 1]
    elif cut < n:
        exit_i = cut; reason = 3; at_open = True
        fill = M["o"][cut] + (M["sp"][cut] if d == -1 else 0.0); seg = flat
    else:
        exit_i = n - 1; reason = 4; at_open = False; fill = flat[-1] if len(flat) else entry_px; seg = flat
    fills.append((rem, fill))
    if len(seg):
        mfe = max(0.0, (seg.max() - entry_px) if d == 1 else (entry_px - seg.min()))
        mae = max(0.0, (entry_px - seg.min()) if d == 1 else (seg.max() - entry_px))
    else:
        mfe = mae = 0.0
    return dict(exit_i=exit_i, reason=reason, at_open=at_open, fills=fills, hit1=hit[0], hit2=hit[1], mfe=mfe, mae=mae)

def signals(mk, tf_min, adx_p, ema_p, vol_window=10, vol_base=1440):
    """All ADX-over-EMA crosses on the trade TF whose entry tick is inside the trading window."""
    M = mk.M; B = tf_bars(M, tf_min)
    adx, pdi, ndi = mt5_adx(B, adx_p); atr = mt5_atr(B, ATR_P); ema = ema_running(adx, ema_p)
    k = np.arange(1, len(adx) - 1)
    cross = (adx[k - 1] <= ema[k - 1]) & (adx[k] > ema[k]) & np.isfinite(atr[k])
    k = k[cross]
    e = B["st"][k + 1]                                     # M1 index of the entry tick
    ok = ~mk.no_entry[e]
    k, e = k[ok], e[ok]
    # tick-volume ratio as the EA: mean of last `vol_window` closed TF bars / mean of last `vol_base` closed TF bars
    cs = np.r_[0.0, np.cumsum(B["tv"])]; kk = k + 1
    nb = np.minimum(kk, vol_base); nw = np.minimum(kk, vol_window)
    base = (cs[kk] - cs[kk - nb]) / np.maximum(nb, 1); win = (cs[kk] - cs[kk - nw]) / np.maximum(nw, 1)
    vr = np.where((nw >= vol_window) & (base > 0), win / np.where(base > 0, base, 1), -1.0)
    return dict(k=k, e=e, sig_t=B["t"][k], vol_base_t=B["t"][kk - nb], dir=np.where(pdi[k] > ndi[k], 1, -1), adx=adx[k], ema=ema[k], pdi=pdi[k], ndi=ndi[k],
                gap=np.abs(pdi[k] - ndi[k]), atr=np.maximum(atr[k], BK.POINT), ref=B["c"][k], vol_ratio=vr)

def run_set(mk, S, min_adx, min_gap, sl_mult, exit_mode, cache=None):
    """One-position-at-a-time path for one parameter set. exit_mode 'L' (ladder) or 'T<r>' (single TP at r*SL)."""
    cache = {} if cache is None else cache
    sel = np.flatnonzero((S["adx"] >= min_adx) & (S["gap"] >= min_gap))
    out = []; busy_i = -1; busy_open = False
    for j in sel:
        e = S["e"][j]
        # position still open at this entry tick? (an exit on the very open tick of the entry bar frees the slot first)
        if busy_i > e or (busy_i == e and not busy_open): continue
        key = (int(j), sl_mult, exit_mode)
        T = cache.get(key)
        if T is None:
            T = trade(mk, S, j, sl_mult, exit_mode); cache[key] = T
        out.append(T); busy_i, busy_open = T["exit_i"], T["at_open"]
    return out

def trade(mk, S, j, sl_mult, exit_mode):
    M = mk.M; e = int(S["e"][j]); d = int(S["dir"][j]); ref = S["ref"][j]; atr = S["atr"][j]
    sp = M["sp"][e]; bid = M["o"][e]
    entry = bid + sp if d == 1 else bid
    sl0 = ref - d * sl_mult * atr
    if exit_mode == "L":
        tp1, tp2, tp3 = (ref + d * m * atr for m in LADDER); partial = True
    else:
        r = float(exit_mode[1:]); tp1 = tp2 = tp3 = ref + d * r * sl_mult * atr; partial = False
    shift = sp if d == -1 else 0.0
    W = walk_exit(mk, e, d, sl0 + shift, tp1 + shift, tp2 + shift, tp3 + shift, partial, entry)
    risk = abs(entry - sl0)
    pnl = sum(f * ((p - entry) if d == 1 else (entry - p)) for f, p in W["fills"])
    return dict(j=int(j), e=e, d=d, entry=entry, sl=sl0 + shift, tp1=tp1 + shift, tp2=tp2 + shift, tp3=tp3 + shift, risk=risk,
                sp_entry=sp, r=pnl / risk if risk > 0 else 0.0, exit_i=int(W["exit_i"]), at_open=W["at_open"], reason=W["reason"],
                hit1=W["hit1"], hit2=W["hit2"], mfe_r=W["mfe"] / risk if risk > 0 else 0.0, mae_r=W["mae"] / risk if risk > 0 else 0.0,
                exit_px=W["fills"][-1][1])
