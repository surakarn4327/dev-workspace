r"""Zone library (user 2026-09-30, step 2 "why does price turn there"). For any list of events (M1 bar index i, price P, kind +1 = a high /
-1 = a low) returns the distance in $ from P to the nearest level of every zone type, using ONLY information available before bar i
(zones created by bars < i and not dead before bar i). Zone list = the list agreed with the user (A-E); time zones (F) are not price levels.
Units: $ (the user's "1,000 points" = $10). Market dict M = adx_ctx.load / po_lib.load_market (UTC t, o/h/l/c, tv, sid, day).

A liquidity / structure
  swing_same      unbroken swing pivot of the same kind (zigzag $5 / $10 / $20 / $50), confirmed before i, age <= 20 trading days
  swing_flip      swing pivot of the OTHER kind that price has closed beyond after it was confirmed (broken level -> flip)
  swing_unbroken_any  unbroken pivot of either kind
  eq_pool         >= 2 unbroken same-kind $5 pivots within $1 of each other (equal highs / lows) = liquidity pool; level = their mean
  pd_hl / pd_c / pd_o      previous trading day high|low / close / open ;  pw_hl previous week high|low ; pm_hl previous month high|low
  sess_hl         high|low of the sessions of today that are already finished (Asia 17:00-03:00 ET, London 03:00-08:00 ET)
  orng            high|low of the first 30 min of today's Asia / London / New York (08:00 ET) session, once the 30 min are over
B imbalance
  fvg_m5 / fvg_m15   unfilled fair value gap (bar C low > bar A high = bullish, mirror) zone [A high, C low]; dead once price trades
                     through the whole gap (the A-side edge)
  ds_m5 / ds_m15     the user's demand/supply zone (smart-indicator demand_supply_zone.md): bar A of FVGs taken alternately along a
                     same-direction chain (A of the next zone = C of the previous one), full A range; dead once price trades through it
  ob_m5 / ob_m15     order block: last opposite-colour bar at or before bar A of an FVG (within 5 bars), full range; dead on a CLOSE through
C volume (tick volume)
  vp_pd           previous day POC / VAH / VAL (tick volume spread evenly over each M1 bar's range, $0.50 bins, value area 70%)
  vwap / vwap_b1 / vwap_b2   today's VWAP (typical price x tick volume, bars < i) / +-1 sigma / +-2 sigma bands
D arithmetic / psychology
  rn10 / rn50 / rn100     round numbers ;  piv   floor pivots of the previous day (PP, R1, S1, R2, S2)
  fib_r           38.2 / 50 / 61.8% retracement of the last confirmed $10-zigzag leg ;  fib_x  127.2 / 161.8% extension of it
  adr             today open +- ADR20, today low + ADR20, today high - ADR20 (ADR20 = mean range of the 20 previous full days)
E moving
  ema_{m5,m15,h1}_{20,50,200}  EMA of closes of CLOSED bars ;  bb_{m5,m15}   Bollinger 20, 2 sigma (upper / lower) of closed bars
  tl              trendline through the last two same-kind $10 pivots (confirmed, <= 5 days apart), value at bar i
"""
import sys, calendar, datetime
sys.path.insert(0, r"C:\trade datacenter\scripts")
import numpy as np, broker as BK, adx_ctx as X

DAY = 86400; SW_SCALES = (5, 10, 20, 50); MAXAGE = 20        # trading days

def zigzag_usd(h, l, X_usd):
    """fixed-$ zigzag on bars (h, l arrays). returns pivot bar idx, price, kind (+1 high / -1 low), conf bar (where the reversal of X
    was completed). Integer points so ties are exact."""
    hi = np.rint(h / BK.POINT).astype(np.int64).tolist(); li = np.rint(l / BK.POINT).astype(np.int64).tolist(); th = int(round(X_usd / BK.POINT))
    n = len(hi); out = []; d = 0; ep = hi[0]; ei = 0; lo0 = li[0]; hi0 = hi[0]; i0lo = 0; i0hi = 0
    for j in range(1, n):
        if d == 0:
            if hi[j] > hi0: hi0, i0hi = hi[j], j
            if li[j] < lo0: lo0, i0lo = li[j], j
            if hi[j] - lo0 >= th: d, ep, ei = 1, hi[j], j; out.append((i0lo, lo0, -1, j))
            elif hi0 - li[j] >= th: d, ep, ei = -1, li[j], j; out.append((i0hi, hi0, 1, j))
        elif d == 1:
            if hi[j] >= ep: ep, ei = hi[j], j
            elif ep - li[j] >= th: out.append((ei, ep, 1, j)); d, ep, ei = -1, li[j], j
        else:
            if li[j] <= ep: ep, ei = li[j], j
            elif hi[j] - ep >= th: out.append((ei, ep, -1, j)); d, ep, ei = 1, hi[j], j
    a = np.array(out, dtype=np.int64).reshape(-1, 4)
    return a[:, 0], a[:, 1] * BK.POINT, a[:, 2], a[:, 3]

def first_through(M, start, level, side, maxbars, use_close=False):
    """first M1 bar index >= start where price trades (or closes) beyond `level` on `side` (+1 above / -1 below); len(t) if never
    within maxbars"""
    n = len(M["t"]); e = min(n, start + maxbars)
    if start >= e: return n
    x = (M["c"] if use_close else (M["h"] if side > 0 else M["l"]))[start:e]
    w = np.flatnonzero((x - level) * side > 0)
    return start + w[0] if len(w) else n

class Zones:
    def __init__(self, M):
        self.M = M; t = M["t"]; n = len(t); self.n = n
        d = M["day"]; self.days, self.dstart = np.unique(d, return_index=True)
        self.dend = np.r_[self.dstart[1:], n]; self.di = np.searchsorted(self.days, d)          # day ordinal of every bar
        self.maxbars = MAXAGE * 1450
        et = (t - np.where(BK.us_dst(t), 4, 5) * 3600); self.et_min = (et // 60) % 1440      # New York clock, minute of day
        self._day_levels(); self._swings(); self._imbalance(); self._vwap(); self._ema_bb()

    # ---------------- A day / week / month / sessions ----------------
    def _day_levels(self):
        M = self.M; nd = len(self.days)
        H = np.maximum.reduceat(M["h"], self.dstart); L = np.minimum.reduceat(M["l"], self.dstart)
        C = M["c"][self.dend - 1]; O = M["o"][self.dstart]
        self.dH, self.dL, self.dC, self.dO = H, L, C, O
        wk = (self.days + 3) // 7
        mo = np.array([(datetime.date(1970, 1, 1) + datetime.timedelta(days=int(x))).year * 12 +
                       (datetime.date(1970, 1, 1) + datetime.timedelta(days=int(x))).month for x in self.days])
        def prev_group(key):
            ph = np.full(nd, np.nan); pl = np.full(nd, np.nan); u = np.unique(key)
            gh = {k: H[key == k].max() for k in u}; gl = {k: L[key == k].min() for k in u}; ul = list(u)
            for i, k in enumerate(key):
                p = ul.index(k) - 1
                if p >= 0: ph[i] = gh[ul[p]]; pl[i] = gl[ul[p]]
            return ph, pl
        self.pwH, self.pwL = prev_group(wk); self.pmH, self.pmL = prev_group(mo)
        rng = H - L; self.adr = np.full(nd, np.nan)
        for i in range(20, nd): self.adr[i] = rng[i - 20:i].mean()
        # previous-day volume profile ($0.50 bins)
        self.vp = np.full((nd, 3), np.nan)
        for i in range(nd):
            a, b = self.dstart[i], self.dend[i]; lo = np.floor(M["l"][a:b] / 0.5).astype(int); hi = np.floor(M["h"][a:b] / 0.5).astype(int)
            base = lo.min(); hist = np.zeros(hi.max() - base + 1)
            for x, y, v in zip(lo - base, hi - base, M["tv"][a:b]): hist[x:y + 1] += v / (y - x + 1)
            poc = hist.argmax(); tot = hist.sum(); lo_i = hi_i = poc; acc = hist[poc]
            while acc < 0.7 * tot:
                up = hist[hi_i + 1] if hi_i + 1 < len(hist) else -1; dn = hist[lo_i - 1] if lo_i > 0 else -1
                if up >= dn: hi_i += 1; acc += up
                else: lo_i -= 1; acc += dn
            self.vp[i] = [(base + poc + 0.5) * 0.5, (base + hi_i + 1) * 0.5, (base + lo_i) * 0.5]
        # sessions (NY clock): today's finished Asia (-> 03:00) and London (-> 08:00) high/low; opening ranges 30 min
        m = self.et_min; self.sess = {}
        for nm, a0, a1 in (("asia", 17 * 60, 3 * 60), ("london", 3 * 60, 8 * 60), ("ny", 8 * 60, 13 * 60)):
            ins = ((m >= a0) | (m < a1)) if a0 > a1 else ((m >= a0) & (m < a1))
            orng = ((m >= a0) & (m < (a0 + 30) % 1440)) if nm != "asia" else ((m >= a0) & (m < a0 + 30))
            self.sess[nm] = self._grp(ins), self._grp(orng)
    def _grp(self, mask):
        """per day: high, low, end bar index of the bars of the day in mask"""
        nd = len(self.days); h = np.full(nd, np.nan); l = np.full(nd, np.nan); e = np.full(nd, -1)
        idx = np.flatnonzero(mask); di = self.di[idx]
        for i in np.unique(di):
            k = idx[di == i]; h[i] = self.M["h"][k].max(); l[i] = self.M["l"][k].min(); e[i] = k.max()
        return h, l, e

    # ---------------- A swings ----------------
    def _swings(self):
        M = self.M; self.sw = {}
        for s in SW_SCALES:
            idx, p, kind, conf = zigzag_usd(M["h"], M["l"], s)
            brk = np.array([first_through(M, c + 1, pp, k, self.maxbars, use_close=True) for pp, k, c in zip(p, kind, conf)])
            self.sw[s] = dict(idx=idx, p=p, kind=kind, conf=conf, brk=brk)
        z = self.sw[10]; self.z10 = z

    # ---------------- B imbalance ----------------
    def _imbalance(self):
        M = self.M; self.zn = {}
        for tf in (5, 15):
            B = X.resample(M, tf); n = len(B["c"]); m1end = np.searchsorted(M["t"], B["t_last"], "right")      # first M1 bar after bar
            same = (B["sid"][2:] == B["sid"][:-2]) & (B["sid"][1:-1] == B["sid"][:-2])
            bull = np.r_[False, False, (B["l"][2:] > B["h"][:-2]) & same]; bear = np.r_[False, False, (B["h"][2:] < B["l"][:-2]) & same]
            fvg, ds, ob = [], [], []
            last_dir = 0; expA = -1
            for c in np.flatnonzero(bull | bear):
                a = c - 2; s = 1 if bull[c] else -1; start = m1end[c]
                lo, hi = (B["h"][a], B["l"][c]) if s > 0 else (B["h"][c], B["l"][a])
                fvg.append((lo, hi, s, start, first_through(M, start, lo if s > 0 else hi, -s, self.maxbars)))
                # user's chain: reset on direction change or when A is later than the expected A; else create only if A == expected
                if last_dir != s or a > expA: make = True
                else: make = (a == expA)
                if make:
                    zlo, zhi = B["l"][a], B["h"][a]
                    ds.append((zlo, zhi, s, start, first_through(M, start, zlo if s > 0 else zhi, -s, self.maxbars))); expA = c
                last_dir = s
                for k in range(a, max(a - 6, -1), -1):                    # order block: last opposite-colour bar at/before A
                    if B["sid"][k] != B["sid"][a]: break
                    if (B["c"][k] - B["o"][k]) * s < 0:
                        ob.append((B["l"][k], B["h"][k], s, start, first_through(M, start, B["l"][k] if s > 0 else B["h"][k], -s, self.maxbars, True))); break
            for nm, L_ in (("fvg", fvg), ("ds", ds), ("ob", ob)):
                a_ = np.array(L_, dtype=float).reshape(-1, 5); o_ = np.argsort(a_[:, 3], kind="stable"); self.zn[f"{nm}_m{tf}"] = a_[o_]

    # ---------------- C vwap ----------------
    def _vwap(self):
        M = self.M; tp = (M["h"] + M["l"] + M["c"]) / 3; v = M["tv"].astype(float)
        self.cv = np.zeros(self.n + 1); self.cpv = np.zeros(self.n + 1); self.cp2v = np.zeros(self.n + 1)
        self.cv[1:] = np.cumsum(v); self.cpv[1:] = np.cumsum(tp * v); self.cp2v[1:] = np.cumsum(tp * tp * v)

    # ---------------- E ema / bollinger ----------------
    def _ema_bb(self):
        M = self.M; self.ma = {}
        for tf, nm in ((5, "m5"), (15, "m15"), (60, "h1")):
            B = X.resample(M, tf); c = B["c"]
            for p in (20, 50, 200):
                a = 2 / (p + 1); e = np.empty(len(c)); e[0] = c[0]
                for j in range(1, len(c)): e[j] = e[j - 1] + a * (c[j] - e[j - 1])
                e[:p] = np.nan; self.ma[f"ema_{nm}_{p}"] = (B, e)
            if tf in (5, 15):
                from numpy.lib.stride_tricks import sliding_window_view as swv
                w = swv(c, 20); mu = np.r_[np.full(19, np.nan), w.mean(1)]; sd = np.r_[np.full(19, np.nan), w.std(1)]
                self.ma[f"bb_{nm}"] = (B, np.c_[mu + 2 * sd, mu - 2 * sd])

    # ---------------- distances ----------------
    def distances(self, ev_i, ev_p, ev_k):
        M = self.M; t = M["t"]; out = {}
        di = self.di[ev_i]; pdx = di - 1; ok = pdx >= 0; pdx = np.clip(pdx, 0, None)
        nan = np.full(len(ev_i), np.nan)
        def near(*levels):
            L_ = np.c_[levels]; return np.nanmin(np.abs(L_ - ev_p[:, None]), axis=1) if L_.size else nan
        w = lambda x: np.where(ok, x, np.nan)
        out["pd_hl"] = near(w(self.dH[pdx]), w(self.dL[pdx])); out["pd_c"] = near(w(self.dC[pdx])); out["pd_o"] = near(w(self.dO[pdx]))
        out["pw_hl"] = near(self.pwH[di], self.pwL[di]); out["pm_hl"] = near(self.pmH[di], self.pmL[di])
        pp = (self.dH + self.dL + self.dC) / 3; r = self.dH - self.dL
        out["piv"] = near(*(w(x[pdx]) for x in (pp, 2 * pp - self.dL, 2 * pp - self.dH, pp + r, pp - r)))
        out["vp_pd"] = near(*(w(self.vp[pdx, k]) for k in range(3)))
        for s in (10, 50, 100): out[f"rn{s}"] = np.abs(ev_p - np.round(ev_p / s) * s)
        # sessions finished before bar i (end index < i) + opening ranges finished
        sl, orl = [], []
        for nm in ("asia", "london", "ny"):
            (h, l, e), (oh, ol, oe) = self.sess[nm]
            if nm != "ny": done = e[di] < ev_i; sl += [np.where(done, h[di], np.nan), np.where(done, l[di], np.nan)]
            od = (oe[di] >= 0) & (oe[di] < ev_i); orl += [np.where(od, oh[di], np.nan), np.where(od, ol[di], np.nan)]
        out["sess_hl"] = near(*sl); out["orng"] = near(*orl)
        # adr
        a = self.adr[di]; ds = self.dstart[di]
        lo_so_far = np.array([M["l"][s:i].min() if i > s else np.nan for s, i in zip(ds, ev_i)])
        hi_so_far = np.array([M["h"][s:i].max() if i > s else np.nan for s, i in zip(ds, ev_i)])
        out["adr"] = near(self.dO[di] + a, self.dO[di] - a, lo_so_far + a, hi_so_far - a)
        # vwap (bars of today before i)
        v = self.cv[ev_i] - self.cv[ds]; pv = self.cpv[ev_i] - self.cpv[ds]; p2 = self.cp2v[ev_i] - self.cp2v[ds]
        with np.errstate(invalid="ignore", divide="ignore"):
            vw = np.where(v > 0, pv / v, np.nan); sd = np.sqrt(np.maximum(np.where(v > 0, p2 / v, np.nan) - vw ** 2, 0))
        out["vwap"] = near(vw); out["vwap_b1"] = near(vw + sd, vw - sd); out["vwap_b2"] = near(vw + 2 * sd, vw - 2 * sd)
        # ema / bb of closed bars
        for k, (B, e) in self.ma.items():
            j = X.last_closed(B, t[ev_i], M["day"][ev_i]); jj = np.clip(j, 0, None)
            val = e[jj] if e.ndim == 1 else e[jj]
            val = np.where((j >= 0)[:, None] if val.ndim > 1 else (j >= 0), val, np.nan)
            out[k] = near(*(val.T if val.ndim > 1 else [val]))
        # swings / pools / flips / fib / trendline (loop per event on pivots confirmed before i)
        for key in ("swing_same", "swing_flip", "swing_unbroken_any", "eq_pool", "fib_r", "fib_x", "tl"): out[key] = nan.copy()
        for key in ("fvg_m5", "fvg_m15", "ds_m5", "ds_m15", "ob_m5", "ob_m15"): out[key] = nan.copy()
        age_min = [self.dstart[max(0, x - MAXAGE)] for x in di]
        for q, (i, P, k) in enumerate(zip(ev_i, ev_p, ev_k)):
            a0 = age_min[q]; best_same = best_flip = best_any = np.inf
            for s in SW_SCALES:
                z = self.sw[s]; c = z["conf"]; lo = np.searchsorted(c, a0); hi = np.searchsorted(c, i)       # confirmed in [a0, i)
                if hi <= lo: continue
                p_, k_, b_ = z["p"][lo:hi], z["kind"][lo:hi], z["brk"][lo:hi]; unb = b_ >= i
                d_ = np.abs(p_ - P)
                m = unb & (k_ == k)
                if m.any(): best_same = min(best_same, d_[m].min())
                m = (~unb) & (k_ == -k)
                if m.any(): best_flip = min(best_flip, d_[m].min())
                if unb.any(): best_any = min(best_any, d_[unb].min())
                if s == 5:
                    m = unb & (k_ == k); pm = p_[m]
                    if len(pm) >= 2:
                        srt = np.sort(pm); g = np.flatnonzero(np.diff(srt) <= 1.0)
                        if len(g): out["eq_pool"][q] = np.min(np.abs((srt[g] + srt[g + 1]) / 2 - P))
            out["swing_same"][q] = best_same if np.isfinite(best_same) else np.nan
            out["swing_flip"][q] = best_flip if np.isfinite(best_flip) else np.nan
            out["swing_unbroken_any"][q] = best_any if np.isfinite(best_any) else np.nan
            z = self.z10; hi = np.searchsorted(z["conf"], i)
            if hi >= 2:
                p1, p2 = z["p"][hi - 2], z["p"][hi - 1]; leg = p2 - p1
                out["fib_r"][q] = np.min(np.abs(p2 - np.array([0.382, 0.5, 0.618]) * leg - P))
                out["fib_x"][q] = np.min(np.abs(p1 + np.array([1.272, 1.618]) * leg - P))
                ks = np.flatnonzero(z["kind"][:hi] == k)
                if len(ks) >= 2:
                    q1, q2 = ks[-2], ks[-1]; t1, t2 = z["idx"][q1], z["idx"][q2]
                    if t[t2] - t[t1] <= 5 * DAY and t2 > t1:
                        slope = (z["p"][q2] - z["p"][q1]) / (t[t2] - t[t1]); out["tl"][q] = abs(z["p"][q2] + slope * (t[i] - t[t2]) - P)
            for key, Z in self.zn.items():
                st = t[a0]; lo = np.searchsorted(Z[:, 3], a0); hi = np.searchsorted(Z[:, 3], i, "right")   # created at M1 index < = i
                if hi <= lo: continue
                zz = Z[lo:hi]; alive = (zz[:, 3] <= i) & (zz[:, 4] > i - 1) & (zz[:, 3] < i)           # created before bar i, not dead before i
                zz = zz[alive]
                if not len(zz): continue
                dd = np.where((P >= zz[:, 0]) & (P <= zz[:, 1]), 0.0, np.minimum(np.abs(P - zz[:, 0]), np.abs(P - zz[:, 1])))
                out[key][q] = dd.min()
        return out
