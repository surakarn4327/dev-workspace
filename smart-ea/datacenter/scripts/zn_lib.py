r"""Zone library (user 2026-09-30, step 2 "why does price turn / accumulate there"). For events (M1 bar index i, price P, kind +1 high /
-1 low) returns, per zone type, the distance in $ from P to the NEAREST level of that type plus where that level came from
(`<type>_s` = first M1 bar at which it was known, -1 for moving lines; `<type>_lo/_hi` = the level or zone range), using ONLY bars < i
(created before bar i and not dead before bar i). `quality()` adds, for events near a zone, how many times price had already visited it
since it was known (0 = first touch) and its age. Units: $ (user: 1,000 points = $10). M = po_lib.load_market (UTC).

A liquidity / structure
  swing_same (+ swing_same_s5/_s10/_s20/_s50 per zigzag size)  unbroken swing pivot of the same kind, confirmed before i, age <= 20 days
  swing_flip      pivot of the OTHER kind that price has closed beyond after its confirmation (broken level -> flip)
  swing_unbroken_any  unbroken pivot of either kind
  eq_pool         >= 2 unbroken same-kind $5 pivots within $1 of each other (equal highs / lows); level = their mean
  pd_hl pd_c pd_o previous trading day high|low / close / open ; pw_hl pw_c pw_o previous week ; pm_hl pm_c pm_o previous month
  sess_hl         high|low of today's finished sessions (Asia 17:00-03:00 ET, London 03:00-08:00 ET)
  orng            high|low of the first 30 min of today's Asia / London / New York (08:00 ET) session, once finished
  sess_open       today's open prices of Asia (day open), London 03:00 ET, New York 08:00 ET and 09:30 ET, once reached
B imbalance
  fvg_m5 fvg_m15  unfilled fair value gap [A high, C low] (bullish; mirror), dead once price trades through the A-side edge
  ds_m5 ds_m15    the user's demand/supply zone (smart-indicator demand_supply_zone.md): bar A of FVGs taken alternately along a
                  same-direction chain (A of the next zone = C of the previous one), full range of A; dead once price trades through
  ob_m5 ob_m15    order block: last opposite-colour bar at or before bar A of an FVG (within 5 bars); dead on a CLOSE through
C volume (tick volume spread evenly over each M1 bar's range, $0.50 bins, value area 70%)
  vp_pd           previous day POC / VAH / VAL ; vp_pw previous week ; vp_td today's POC of the bars before i
  vwap vwap_b1 vwap_b2        today's VWAP (typical price x tick volume) and +-1 / +-2 sigma bands ; vwap_w  this week's VWAP
D arithmetic / psychology
  rn10 rn50 rn100 round numbers ; piv floor pivots of the previous day (PP, R1, S1, R2, S2)
  fib_r / fib_x   38.2-50-61.8% retracement / 127.2-161.8% extension of the last confirmed $10-zigzag leg
  adr             today open +- ADR20, today low so far + ADR20, today high so far - ADR20
E moving lines (closed bars)
  ema_{m5,m15,h1}_{20,50,200} ; bb_{m5,m15} Bollinger 20, 2 sigma ; kc_{m5,m15} Keltner EMA20 +- 2 x ATR10
  tl              trendline through the last two same-kind $10 pivots (confirmed, <= 5 days apart), value at bar i
"""
import sys, datetime
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, broker as BK, adx_ctx as X

DAY = 86400; SW_SCALES = (5, 10, 20, 50); MAXAGE = 20        # trading days

def tf_atr_bar(M, tf):
    """for every M1 bar: ATR20 ($) of the TF, from the 20 TF bars closed before the TF bar that contains it (known at that bar)"""
    B = X.resample(M, tf); b = np.searchsorted(B["t_open"], M["t"], "right") - 1
    return B["atr_prev"][b]

def _deepest(P, a, j, side):
    """highest (side +1) / lowest (side -1) path point in (a, j], the later one on ties; (P[a], a) if the range is empty"""
    best, bi = P[a], a
    for q in range(a + 1, j + 1):
        if (side > 0 and P[q] >= best) or (side < 0 and P[q] <= best): best, bi = P[q], q
    return best, bi

def zigzag_path(M, th_bar, points=False):
    """zigzag on the 4-point path with a threshold per M1 bar ($; the threshold of the bar holding the path point is used).
    Causal: a confirmed pivot is never removed, so under a threshold that grows later price may move beyond an older pivot without a
    reversal. Returns pivot bar, price, kind, conf bar. Bars with an unknown threshold (nan) do not confirm."""
    o, h, l, c = (np.rint(M[x] / BK.POINT).astype(np.int64) for x in ("o", "h", "l", "c"))
    bull = c >= o; P = np.empty(4 * len(o), np.int64)
    P[0::4] = o; P[1::4] = np.where(bull, l, h); P[2::4] = np.where(bull, h, l); P[3::4] = c
    thp = np.where(np.isfinite(th_bar), np.rint(np.nan_to_num(th_bar) / BK.POINT), -1).astype(np.int64)
    # A varying threshold can shrink after the deepest retracement already happened. The retracement is therefore the DEEPEST point
    # since the leg's extreme (rx at ri), a pivot is confirmed at the first point where that depth >= the threshold of the current
    # point, and the new leg starts from that deepest point (bugs.md 2026-09-30). With a constant threshold the deepest point is always
    # the confirming point -> identical to zigzag_usd.
    TH = np.repeat(thp, 4).tolist(); P = P.tolist(); out = []; d = 0; ep = ei = 0; hi0 = lo0 = P[0]; ihi = ilo = 0; rx = ri = 0
    for j in range(1, len(P)):
        x = P[j]; th = TH[j]
        if d == 0:                                    # before the first pivot (start of the data only)
            if x >= hi0: hi0, ihi = x, j
            if x <= lo0: lo0, ilo = x, j
            if th > 0 and hi0 - lo0 >= th:
                if ihi > ilo: out.append((ilo, lo0, -1, j)); d, ep, ei = 1, hi0, ihi
                else: out.append((ihi, hi0, 1, j)); d, ep, ei = -1, lo0, ilo
                rx, ri = _deepest(P, ei, j, -d)
            if d == 0: continue
        elif d == 1:
            if x >= ep: ep, ei = x, j; rx, ri = x, j
            elif x <= rx: rx, ri = x, j
        else:
            if x <= ep: ep, ei = x, j; rx, ri = x, j
            elif x >= rx: rx, ri = x, j
        # confirm; the new leg may already be deep enough at this same point -> check again (bugs.md 2026-09-30: was one point late)
        while th > 0 and ((d == 1 and ep - rx >= th) or (d == -1 and rx - ep >= th)):
            out.append((ei, ep, d, j)); ep, ei = rx, ri; d = -d; rx, ri = _deepest(P, ei, j, -d)
    a = np.array(out, dtype=np.int64).reshape(-1, 4)
    if points: return a[:, 0], a[:, 1] * BK.POINT, a[:, 2], a[:, 3]
    return a[:, 0] // 4, a[:, 1] * BK.POINT, a[:, 2], a[:, 3] // 4

def zigzag_usd(M, X_usd, points=False):
    """fixed-$ zigzag on the 4-point price path of the M1 bars (O, L, H, C for a bull bar, O, H, L, C for a bear bar = the ordering
    used by the pattern library and verified against MT5), so one bar can hold both a pivot and the reversal that confirms it
    (bugs.md 2026-09-30: the bar-level version mis-placed ~3% of $10 pivots on bars wider than X). Returns pivot BAR index, price,
    kind (+1 high / -1 low), conf BAR (bar of the path point where the reversal of X was completed). Integer points, ties exact:
    an equal extreme moves the pivot to the later point."""
    o, h, l, c = (np.rint(M[x] / BK.POINT).astype(np.int64) for x in ("o", "h", "l", "c"))
    bull = c >= o; P = np.empty(4 * len(o), np.int64)
    P[0::4] = o; P[1::4] = np.where(bull, l, h); P[2::4] = np.where(bull, h, l); P[3::4] = c
    P = P.tolist(); th = int(round(X_usd / BK.POINT)); out = []; d = 0; ep = ei = 0
    hi0 = lo0 = P[0]; ihi = ilo = 0
    for j in range(1, len(P)):
        x = P[j]
        if d == 0:
            if x >= hi0: hi0, ihi = x, j
            if x <= lo0: lo0, ilo = x, j
            if x - lo0 >= th: out.append((ilo, lo0, -1, j)); d, ep, ei = 1, x, j
            elif hi0 - x >= th: out.append((ihi, hi0, 1, j)); d, ep, ei = -1, x, j
        elif d == 1:
            if x >= ep: ep, ei = x, j
            elif ep - x >= th: out.append((ei, ep, 1, j)); d, ep, ei = -1, x, j
        else:
            if x <= ep: ep, ei = x, j
            elif x - ep >= th: out.append((ei, ep, -1, j)); d, ep, ei = 1, x, j
    a = np.array(out, dtype=np.int64).reshape(-1, 4)
    if points: return a[:, 0], a[:, 1] * BK.POINT, a[:, 2], a[:, 3]              # path-point indices (for the audit)
    return a[:, 0] // 4, a[:, 1] * BK.POINT, a[:, 2], a[:, 3] // 4

def first_through(M, start, level, side, maxbars, use_close=False):
    """first M1 bar index >= start where price trades (or closes) beyond `level` on `side` (+1 above / -1 below); len(t) if never
    within maxbars"""
    n = len(M["t"]); e = min(n, start + maxbars)
    if start >= e: return n
    x = (M["c"] if use_close else (M["h"] if side > 0 else M["l"]))[start:e]
    # integer points: a close EXACTLY at a pivot price is not beyond it (float noise used to decide such ties; bugs.md 2026-10-01)
    xi = np.rint(x / BK.POINT).astype(np.int64); li = int(round(float(level) / BK.POINT))
    w = np.flatnonzero((xi - li) * side > 0)
    return start + w[0] if len(w) else n

def profile(l, h, v):
    """POC, VAH, VAL of bars (tick volume spread evenly over the $0.50 bins each bar spans)"""
    lo = np.floor(l / 0.5).astype(np.int64); hi = np.floor(h / 0.5).astype(np.int64); base = lo.min(); m = hi.max() - base + 2
    w = v / (hi - lo + 1); diff = np.zeros(m); np.add.at(diff, lo - base, w); np.add.at(diff, hi - base + 1, -w)
    hist = np.cumsum(diff)[:-1]; poc = int(hist.argmax()); tot = hist.sum(); a = b = poc; acc = hist[poc]
    while acc < 0.7 * tot:
        up = hist[b + 1] if b + 1 < len(hist) else -1; dn = hist[a - 1] if a > 0 else -1
        if up >= dn: b += 1; acc += up
        else: a -= 1; acc += dn
    return (base + poc + 0.5) * 0.5, (base + b + 1) * 0.5, (base + a) * 0.5

ZONE_TF = (1, 3, 5, 15); ZONE_AGE = {1: 2, 3: 5, 5: 20, 15: 20}          # imbalance zones per TF, max age in trading days
ATR_SW = {1: (2, 3, 5), 3: (2, 3, 5), 5: (2, 3, 5)}; ATR_SW_AGE = {1: 2, 3: 5, 5: 10}   # swings measured in ATR of the TF
LINE_TF = ((1, "m1"), (3, "m3"), (5, "m5"), (15, "m15"), (60, "h1")); BAND_TF = (1, 3, 5, 15)

class Zones:
    def __init__(self, M):
        self.M = M; t = M["t"]; n = len(t); self.n = n
        d = M["day"]; self.days, self.dstart = np.unique(d, return_index=True)
        self.dend = np.r_[self.dstart[1:], n]; self.di = np.searchsorted(self.days, d)
        self.maxbars = (MAXAGE + 2) * 1450          # break search must cover the whole age window (age counts from a day start)
        et = (t - np.where(BK.us_dst(t), 4, 5) * 3600); self.et_min = (et // 60) % 1440      # New York clock, minute of day
        self._day_levels(); self._swings(); self._imbalance(); self._vwap(); self._lines()

    # ---------------- A day / week / month / sessions ----------------
    def _day_levels(self):
        M = self.M; nd = len(self.days)
        H = np.maximum.reduceat(M["h"], self.dstart); L = np.minimum.reduceat(M["l"], self.dstart)
        C = M["c"][self.dend - 1]; O = M["o"][self.dstart]
        self.dH, self.dL, self.dC, self.dO = H, L, C, O
        dates = [datetime.date(1970, 1, 1) + datetime.timedelta(days=int(x)) for x in self.days]
        self.gkey = {"w": (self.days + 3) // 7, "m": np.array([x.year * 12 + x.month for x in dates])}
        self.prev = {}; self.gstart = {}
        for g, key in self.gkey.items():
            u, first = np.unique(key, return_index=True); pos = np.searchsorted(u, key)
            last = np.r_[first[1:], nd] - 1
            gH = np.array([H[a:b + 1].max() for a, b in zip(first, last)]); gL = np.array([L[a:b + 1].min() for a, b in zip(first, last)])
            gO = O[first]; gC = C[last]
            vp = np.array([profile(M["l"][self.dstart[a]:self.dend[b]], M["h"][self.dstart[a]:self.dend[b]], M["tv"][self.dstart[a]:self.dend[b]])
                           for a, b in zip(first, last)]) if g == "w" else None
            pp = pos - 1; okp = pp >= 0; pp = np.clip(pp, 0, None)
            f = lambda arr: np.where(okp[:, None] if arr.ndim > 1 else okp, arr[pp], np.nan)
            self.prev[g] = dict(H=f(gH), L=f(gL), O=f(gO), C=f(gC), VP=f(vp) if vp is not None else None)
            self.gstart[g] = self.dstart[first[pos]]                             # first M1 bar of the current week / month
        rng = H - L; self.adr = np.full(nd, np.nan)
        for i in range(20, nd): self.adr[i] = rng[i - 20:i].mean()
        self.vp = np.array([profile(M["l"][a:b], M["h"][a:b], M["tv"][a:b]) for a, b in zip(self.dstart, self.dend)])
        m = self.et_min; self.sess = {}
        for nm, a0, a1 in (("asia", 17 * 60, 3 * 60), ("london", 3 * 60, 8 * 60), ("ny", 8 * 60, 13 * 60)):
            ins = ((m >= a0) | (m < a1)) if a0 > a1 else ((m >= a0) & (m < a1))
            orng = (m >= a0) & (m < a0 + 30)
            self.sess[nm] = self._grp(ins), self._grp(orng)
        # session open bars: first bar of the day at / after the NY minute (Asia = the day's first bar)
        self.sopen = {}
        for nm, mm in (("london", 3 * 60), ("ny", 8 * 60), ("ny930", 9 * 60 + 30)):
            k = np.full(nd, -1); idx = np.flatnonzero((m >= mm) & (m < 17 * 60)); di = self.di[idx]
            u, f_ = np.unique(di, return_index=True); k[u] = idx[f_]; self.sopen[nm] = k
        self.sopen["asia"] = self.dstart.copy()
    def _grp(self, mask):
        """per day: high, low, last bar index of the bars of the day in mask"""
        nd = len(self.days); h = np.full(nd, np.nan); l = np.full(nd, np.nan); e = np.full(nd, -1)
        idx = np.flatnonzero(mask); di = self.di[idx]
        for i in np.unique(di):
            k = idx[di == i]; h[i] = self.M["h"][k].max(); l[i] = self.M["l"][k].min(); e[i] = k.max()
        return h, l, e

    # ---------------- A swings ----------------
    def _swings(self):
        M = self.M; self.sw = {}
        for s in SW_SCALES:
            idx, p, kind, conf = zigzag_usd(M, s)
            brk = np.array([first_through(M, c + 1, pp, k, self.maxbars, use_close=True) for pp, k, c in zip(p, kind, conf)])
            self.sw[s] = dict(idx=idx, p=p, kind=kind, conf=conf, brk=brk)
        self.z10 = self.sw[10]
        self.swa = {}; self.atr_tf = {}
        for tf, ks in ATR_SW.items():
            A = tf_atr_bar(M, tf); self.atr_tf[tf] = A; mb = (ATR_SW_AGE[tf] + 2) * 1450
            for k in ks:
                idx, p, kind, conf = zigzag_path(M, k * A)
                brk = np.array([first_through(M, c + 1, pp, kd, mb, use_close=True) for pp, kd, c in zip(p, kind, conf)])
                self.swa[(tf, k)] = dict(idx=idx, p=p, kind=kind, conf=conf, brk=brk, age=ATR_SW_AGE[tf])

    # ---------------- B imbalance ----------------
    def _imbalance(self):
        M = self.M; self.zn = {}; self.zn_age = {}
        for tf in ZONE_TF:
            mb = (ZONE_AGE[tf] + 2) * 1450                                 # bugs.md 2026-09-30: was age x 1450 (too short)
            B = X.resample(M, tf); m1end = np.searchsorted(M["t"], B["t_last"], "right")      # first M1 bar after the bar
            same = (B["sid"][2:] == B["sid"][:-2]) & (B["sid"][1:-1] == B["sid"][:-2])
            bull = np.r_[False, False, (B["l"][2:] > B["h"][:-2]) & same]; bear = np.r_[False, False, (B["h"][2:] < B["l"][:-2]) & same]
            fvg, ds, ob = [], [], []; last_dir = 0; expA = -1
            for c in np.flatnonzero(bull | bear):
                a = c - 2; s = 1 if bull[c] else -1; start = m1end[c]
                lo, hi = (B["h"][a], B["l"][c]) if s > 0 else (B["h"][c], B["l"][a])
                fvg.append((lo, hi, s, start, first_through(M, start, lo if s > 0 else hi, -s, mb)))
                make = True if (last_dir != s or a > expA) else (a == expA)          # user's chain rule
                if make:
                    zlo, zhi = B["l"][a], B["h"][a]
                    ds.append((zlo, zhi, s, start, first_through(M, start, zlo if s > 0 else zhi, -s, mb))); expA = c
                last_dir = s
                for k in range(a, max(a - 6, -1), -1):
                    if B["sid"][k] != B["sid"][a]: break
                    if (B["c"][k] - B["o"][k]) * s < 0:
                        ob.append((B["l"][k], B["h"][k], s, start, first_through(M, start, B["l"][k] if s > 0 else B["h"][k], -s, mb, True))); break
            for nm, L_ in (("fvg", fvg), ("ds", ds), ("ob", ob)):
                a_ = np.array(L_, dtype=float).reshape(-1, 5); o_ = np.argsort(a_[:, 3], kind="stable"); self.zn[f"{nm}_m{tf}"] = a_[o_]; self.zn_age[f"{nm}_m{tf}"] = ZONE_AGE[tf]

    # ---------------- C vwap (sums of prices centred on the day / week open, so the sums stay small: bugs.md 2026-09-30) ----------------
    def _vwap(self):
        M = self.M; tp = (M["h"] + M["l"] + M["c"]) / 3; v = M["tv"].astype(float); self.vw = {}
        for g, st in (("d", self.dstart[self.di]), ("w", self.gstart["w"][self.di])):
            ref = M["o"][st]; x = tp - ref; ex = [np.zeros(self.n + 1) for _ in range(3)]          # exclusive sums restarted at each group
            bounds = np.r_[np.unique(st), self.n]
            for a, b in zip(bounds[:-1], bounds[1:]):
                for arr, val in zip(ex, (v[a:b], x[a:b] * v[a:b], x[a:b] ** 2 * v[a:b])):
                    arr[a + 1:b + 1] = np.cumsum(val)                                          # arr[j] = sum of bars a .. j-1
            self.vw[g] = (st, ref, *ex)

    # ---------------- E moving lines ----------------
    def _lines(self):
        M = self.M; self.ma = {}
        from numpy.lib.stride_tricks import sliding_window_view as swv
        def ema(c, p):
            a = 2 / (p + 1); e = np.empty(len(c)); e[0] = c[0]
            for j in range(1, len(c)): e[j] = e[j - 1] + a * (c[j] - e[j - 1])
            e[:p] = np.nan; return e
        for tf, nm in LINE_TF:
            B = X.resample(M, tf); c = B["c"]
            for p in (20, 50, 200): self.ma[f"ema_{nm}_{p}"] = (B, ema(c, p)[:, None])
            if tf in BAND_TF:
                w = swv(c, 20); mu = np.r_[np.full(19, np.nan), w.mean(1)]; sd = np.r_[np.full(19, np.nan), w.std(1)]
                self.ma[f"bb_{nm}"] = (B, np.c_[mu + 2 * sd, mu - 2 * sd])
                e20 = ema(c, 20); tr = B["tr"]; atr10 = np.r_[np.full(9, np.nan), swv(tr, 10).mean(1)]
                self.ma[f"kc_{nm}"] = (B, np.c_[e20 + 2 * atr10, e20 - 2 * atr10])

    # ---------------- distances ----------------
    def distances(self, ev_i, ev_p, ev_k):
        M = self.M; t = M["t"]; ne = len(ev_i); out = {}
        di = self.di[ev_i]; pdx = di - 1; ok = pdx >= 0; pdx = np.clip(pdx, 0, None); today = self.dstart[di]
        def put(name, levels, starts=None):
            """levels: list of arrays (one level per event); starts: list of arrays or scalar-like of the same shape (first bar known)"""
            L_ = np.c_[tuple(np.asarray(x, float) for x in levels)] if levels else np.full((ne, 1), np.nan)
            S_ = np.c_[tuple(np.broadcast_to(np.asarray(s, np.int64), (ne,)) for s in starts)] if starts is not None else np.full(L_.shape, -1, np.int64)
            dd = np.abs(L_ - ev_p[:, None]); dd = np.where(np.isfinite(dd), dd, np.inf); j = dd.argmin(1); r = np.arange(ne)
            v = dd[r, j]; out[name] = np.where(np.isfinite(v), v, np.nan)
            out[name + "_lo"] = np.where(np.isfinite(v), L_[r, j], np.nan); out[name + "_hi"] = out[name + "_lo"]; out[name + "_s"] = np.where(np.isfinite(v), S_[r, j], -1)
        w = lambda x: np.where(ok, x, np.nan)
        put("pd_hl", [w(self.dH[pdx]), w(self.dL[pdx])], [today, today]); put("pd_c", [w(self.dC[pdx])], [today]); put("pd_o", [w(self.dO[pdx])], [today])
        for g in ("w", "m"):
            P_ = self.prev[g]; gs = self.gstart[g][di]
            put(f"p{g}_hl", [P_["H"][di], P_["L"][di]], [gs, gs]); put(f"p{g}_c", [P_["C"][di]], [gs]); put(f"p{g}_o", [P_["O"][di]], [gs])
        pvw = self.prev["w"]["VP"][di]; put("vp_pw", [pvw[:, 0], pvw[:, 1], pvw[:, 2]], [self.gstart["w"][di]] * 3)
        pp = (self.dH + self.dL + self.dC) / 3; r = self.dH - self.dL
        put("piv", [w(x[pdx]) for x in (pp, 2 * pp - self.dL, 2 * pp - self.dH, pp + r, pp - r)], [today] * 5)
        put("vp_pd", [w(self.vp[pdx, k]) for k in range(3)], [today] * 3)
        for s in (10, 50, 100): put(f"rn{s}", [np.round(ev_p / s) * s], [today])
        sl, ss_, orl, os_ = [], [], [], []
        for nm in ("asia", "london", "ny"):
            (h, l, e), (oh, ol, oe) = self.sess[nm]
            if nm != "ny":
                done = (e[di] >= 0) & (e[di] < ev_i); sl += [np.where(done, h[di], np.nan), np.where(done, l[di], np.nan)]; ss_ += [e[di] + 1] * 2
            od = (oe[di] >= 0) & (oe[di] < ev_i); orl += [np.where(od, oh[di], np.nan), np.where(od, ol[di], np.nan)]; os_ += [oe[di] + 1] * 2
        put("sess_hl", sl, ss_); put("orng", orl, os_)
        so, sos = [], []
        for nm in ("asia", "london", "ny", "ny930"):
            k = self.sopen[nm][di]; kn = (k >= 0) & (k < ev_i); so.append(np.where(kn, M["o"][np.clip(k, 0, None)], np.nan)); sos.append(k)
        put("sess_open", so, sos)
        a = self.adr[di]
        lo_sf = np.array([M["l"][s:i].min() if i > s else np.nan for s, i in zip(today, ev_i)])
        hi_sf = np.array([M["h"][s:i].max() if i > s else np.nan for s, i in zip(today, ev_i)])
        put("adr", [self.dO[di] + a, self.dO[di] - a, lo_sf + a, hi_sf - a], [today] * 4)
        vt = np.array([profile(M["l"][s:i], M["h"][s:i], M["tv"][s:i])[0] if i > s else np.nan for s, i in zip(today, ev_i)])
        put("vp_td", [vt])
        for g, nm in (("d", "vwap"), ("w", "vwap_w")):
            st, ref, cv, c1, c2 = self.vw[g]; s0 = st[ev_i]
            first = ev_i == s0                                                                # no bar of the group before i yet
            V = np.where(first, 0.0, cv[ev_i])
            with np.errstate(invalid="ignore", divide="ignore"):
                mu = np.where(V > 0, c1[ev_i] / V, np.nan); var = np.where(V > 0, c2[ev_i] / V, np.nan) - mu ** 2
            vw = ref[ev_i] + mu; sd = np.sqrt(np.maximum(var, 0))
            put(nm, [vw])
            if g == "d": put("vwap_b1", [vw + sd, vw - sd]); put("vwap_b2", [vw + 2 * sd, vw - 2 * sd])
        for k_, (B, e) in self.ma.items():
            j = X.last_closed(B, t[ev_i], M["day"][ev_i]); jj = np.clip(j, 0, None); val = np.where((j >= 0)[:, None], e[jj], np.nan)
            put(k_, [val[:, c] for c in range(val.shape[1])])
        # swings, pools, flips, fib, trendline, imbalance zones: per event
        loop = ["swing_same"] + [f"swing_same_s{s}" for s in SW_SCALES] + ["swing_flip", "swing_unbroken_any", "eq_pool", "fib_r", "fib_x", "tl"] + list(self.zn) \
            + [f"swa_{w}_m{tf}k{k}" for (tf, k) in self.swa for w in ("same", "flip")]
        for key in loop:
            out[key] = np.full(ne, np.nan); out[key + "_lo"] = np.full(ne, np.nan); out[key + "_hi"] = np.full(ne, np.nan); out[key + "_s"] = np.full(ne, -1, np.int64)
        def keep(key, q, dist, lo, hi, s):
            if not np.isfinite(out[key][q]) or dist < out[key][q]: out[key][q] = dist; out[key + "_lo"][q] = lo; out[key + "_hi"][q] = hi; out[key + "_s"][q] = s
        a0s = self.dstart[np.maximum(0, di - MAXAGE)]
        for q, (i, P, k) in enumerate(zip(ev_i, ev_p, ev_k)):
            a0 = a0s[q]
            for s in SW_SCALES:
                z = self.sw[s]; c = z["conf"]; lo = np.searchsorted(c, a0); hi = np.searchsorted(c, i)       # confirmed in [a0, i)
                if hi <= lo: continue
                p_, k_, b_, c_ = z["p"][lo:hi], z["kind"][lo:hi], z["brk"][lo:hi], c[lo:hi]; unb = b_ >= i; d_ = np.abs(p_ - P)
                for key, m in ((f"swing_same_s{s}", unb & (k_ == k)), ("swing_same", unb & (k_ == k)), ("swing_flip", (~unb) & (k_ == -k)), ("swing_unbroken_any", unb)):
                    if m.any():
                        j = np.flatnonzero(m)[d_[m].argmin()]; keep(key, q, d_[j], p_[j], p_[j], c_[j] + 1)
                if s == 5:
                    m = unb & (k_ == k)
                    if m.sum() >= 2:
                        o_ = np.argsort(p_[m]); srt = p_[m][o_]; cs = c_[m][o_]; g = np.flatnonzero(np.diff(srt) <= 1.0)
                        for gg in g:
                            lv = (srt[gg] + srt[gg + 1]) / 2; keep("eq_pool", q, abs(lv - P), lv, lv, max(cs[gg], cs[gg + 1]) + 1)
            z = self.z10; hi = np.searchsorted(z["conf"], i)
            if hi >= 2:
                p1, p2 = z["p"][hi - 2], z["p"][hi - 1]; leg = p2 - p1; s1 = z["conf"][hi - 1] + 1
                for f in (0.382, 0.5, 0.618): lv = p2 - f * leg; keep("fib_r", q, abs(lv - P), lv, lv, s1)
                for f in (1.272, 1.618): lv = p1 + f * leg; keep("fib_x", q, abs(lv - P), lv, lv, s1)
                ks = np.flatnonzero(z["kind"][:hi] == k)
                if len(ks) >= 2:
                    q1, q2 = ks[-2], ks[-1]; t1, t2 = t[z["idx"][q1]], t[z["idx"][q2]]
                    if t2 > t1 and t2 - t1 <= 5 * DAY:
                        lv = z["p"][q2] + (z["p"][q2] - z["p"][q1]) / (t2 - t1) * (t[i] - t2); keep("tl", q, abs(lv - P), lv, lv, -1)
            for (tf, kk), z in self.swa.items():                                                          # swings in ATR of M1 / M3 / M5
                c = z["conf"]; lo = np.searchsorted(c, self.dstart[max(0, di[q] - z["age"])]); hi = np.searchsorted(c, i)
                if hi <= lo: continue
                p_, k_, b_, c_ = z["p"][lo:hi], z["kind"][lo:hi], z["brk"][lo:hi], c[lo:hi]; unb = b_ >= i; d_ = np.abs(p_ - P)
                for key, m in ((f"swa_same_m{tf}k{kk}", unb & (k_ == k)), (f"swa_flip_m{tf}k{kk}", (~unb) & (k_ == -k))):
                    if m.any():
                        j = np.flatnonzero(m)[d_[m].argmin()]; keep(key, q, d_[j], p_[j], p_[j], c_[j] + 1)
            for key, Z in self.zn.items():
                a0z = self.dstart[max(0, di[q] - self.zn_age[key])]
                lo = np.searchsorted(Z[:, 3], a0z); hi = np.searchsorted(Z[:, 3], i)                    # created at M1 index in [a0z, i)
                if hi <= lo: continue
                zz = Z[lo:hi]; zz = zz[zz[:, 4] >= i]                                                    # not dead before bar i
                if not len(zz): continue
                dd = np.where((P >= zz[:, 0]) & (P <= zz[:, 1]), 0.0, np.minimum(np.abs(P - zz[:, 0]), np.abs(P - zz[:, 1])))
                j = dd.argmin(); keep(key, q, dd[j], zz[j, 0], zz[j, 1], int(zz[j, 3]))
        return out

    def types(self, D):
        return [k for k in D if not k.endswith(("_lo", "_hi", "_s"))]

    def quality(self, ev_i, D, near=1.0, band=0.5):
        """for events within `near` of a zone type whose level has a known start: visits = number of separate times price came within
        `band` of the level / zone between its start and bar i (0 = this is the first touch); age = minutes since start"""
        M = self.M; t = M["t"]; Q = {}
        for ty in self.types(D):
            vis = np.full(len(ev_i), -1); age = np.full(len(ev_i), np.nan)
            nr = np.broadcast_to(np.asarray(near, float), (len(ev_i),)); bd = np.broadcast_to(np.asarray(band, float), (len(ev_i),))
            for q in np.flatnonzero((D[ty] <= nr) & (D[ty + "_s"] >= 0)):
                s = int(D[ty + "_s"][q]); i = int(ev_i[q]); band_q = bd[q]
                if s >= i: vis[q] = 0; age[q] = 0; continue
                lo, hi = D[ty + "_lo"][q] - band_q, D[ty + "_hi"][q] + band_q
                tch = (M["l"][s:i] <= hi) & (M["h"][s:i] >= lo)
                runs = int(tch[0]) + int(np.sum(tch[1:] & ~tch[:-1]))
                vis[q] = runs - int(tch[-1]); age[q] = (t[i] - t[s]) / 60          # a run still going on at bar i-1 = the current approach
            Q[ty + "_vis"] = vis; Q[ty + "_age"] = age
        return Q
