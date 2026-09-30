r"""Phase 3B-c (smart-ea): at the moment of a signal, in which market state is which parameter set / TF (M1/M3/M5) better?

Decisions (user 2026-09-30): ALL 432 parameter sets, ALL ctx columns (195 minus the 3 keys entry_t/day/m1_last_t = 192 state values),
tradable TF = M1/M3/M5 only, "do not trade" is never an answer. Sandbox only (p3lib.load: entry >= 2024-04-15, closed before 2026-06-01).

Question = SET x STATE INTERACTION (the part phase 3 removed on purpose):
  e      = r_std - mean r_std of the same (set, direction, half)            (p3lib.load; removes "this set is always better")
  I(s,L) = mean e of set s in state level L  -  mean e of ALL 432 sets in L  (removes "state L is good / bad for everyone")
A set that is better than its own average in L by more than every set is -> I > 0. The same for groups of sets along one parameter
(tf, adx_p, ema_p, min_adx, min_gap, sl_atr, exit_mode): I(group, L) = mean e of the group in L - mean e of all sets in L.
Trades of different sets at the same time are not independent -> day-clustered SE of the linearised difference of the two ratio means
(same ratio estimator as p3lib.cstat).

States (features): every ctx column raw, and for direction-carrying columns also relative to the trade (x dir / position from the
trade's side / own-side vs other-side of yesterday's levels). Levels: <= 10 distinct values -> one level per value; otherwise quintiles of
the first-half trades (pooled over all sets), a single value with >= 20 % of the first half (e.g. -1 = "none", 0 legs) becomes its own
level and the rest is cut in quintiles. Neighbour definitions (gate G5): quintile edges shifted -5 / +5 percentile points; columns of a
zigzag k (k2/k3/k4) also the same column with the other two k. Nothing here selects parameters (phase 4)."""
import re
import numpy as np
import p3lib as L

KEYS = ("entry_t", "day", "m1_last_t")
PARAM_DIMS = ("tf", "adx_p", "ema_p", "min_adx", "min_gap", "sl_atr", "exit_mode")
MIN_N, MIN_D = 30, 30                      # cells with fewer trades / days are not tested (t = nan)
SPECIAL_SHARE = 0.20
MAXCAT = 10
# time-of-day states: the day swap (nearest minute of another day) keeps them almost unchanged (label change 0.03-0.23 of the change
# expected under random reassignment; every other feature >= 0.69, median 0.99; measured 2026-09-30 with seed 999) -> the day swap cannot
# test them. They get null 1b = circular time shift inside the same trading day (shift_ci).
TIME_FEATS = ("d_asia_done", "t_phase", "t_min_open", "d_today_bars", "t_min_830", "t_et_hour", "t_min_cutoff", "t_th_hour")

# ---------------------------------------------------------------------------------------------------------------------------
SIGNED = re.compile(r"(_reg|_leg_dir|_dh_atr|_dl_atr|_big_dir|_pin_dir)$|^(d_pdc_adr|d_gap_adr|d_r10_atr5)$")
POSN = re.compile(r"(_rng_pos)$|^(d_day_pos|d_asia_pos)$")
KCOL = re.compile(r"^(m1|m3|m5|m15|h1)k([234])_(.+)$")

def feature_defs(cols):
    """list of dict(name, base, fn(X, d) -> float array over ctx rows, kgroup) ; kgroup = (prefix, suffix, rel-tag) for zigzag columns"""
    F = []
    def add(name, base, fn):
        m = KCOL.match(base)
        F.append(dict(name=name, base=base, fn=fn, kgroup=(m.group(1), m.group(3), name[len(base):]) if m else None, k=int(m.group(2)) if m else None))
    for c in cols:
        if c in KEYS: continue
        add(c, c, (lambda c: lambda X, d: X[c])(c))
        if SIGNED.search(c): add(c + "~rel", c, (lambda c: lambda X, d: X[c] * d)(c))
        elif POSN.search(c): add(c + "~rel", c, (lambda c: lambda X, d: np.where(d > 0, X[c], 1.0 - X[c]))(c))
    for side, a, b in (("own", "pdh", "pdl"), ("other", "pdl", "pdh")):
        # own side = the level in the trade direction (BUY: yesterday's high), + = already beyond it in the trade direction
        F.append(dict(name=f"d_pdx_{side}~rel", base="d_pdh_adr", kgroup=None, k=None,
                      fn=(lambda a, b: lambda X, d: np.where(d > 0, X[f"d_{a}_adr"], -X[f"d_{b}_adr"]))(a, b)))
        F.append(dict(name=f"d_broke_{side}~rel", base="d_broke_pdh", kgroup=None, k=None,
                      fn=(lambda a, b: lambda X, d: np.where(d > 0, X[f"d_broke_{a}"], X[f"d_broke_{b}"]))(a, b)))
    return F

# ---------------------------------------------------------------------------------------------------------------------------
class Levels:
    """fixed level structure of one feature (decided once on the REAL data: categorical values / special value); the quintile edges are
    recomputed from the first-half trades on every call (like p3fast), so permuted runs cut their own distribution."""
    def __init__(self, v_h1):
        f = v_h1[np.isfinite(v_h1)]
        u, c = np.unique(f, return_counts=True)
        self.cat = len(u) <= MAXCAT
        if self.cat:
            self.vals = u; self.names = [f"={x + 0.0:g}" for x in u]; self.special = None; return
        top = np.argmax(c)
        self.special = u[top] if c[top] / len(f) >= SPECIAL_SHARE else None
        self.names = ([f"={self.special:g}"] if self.special is not None else []) + [f"Q{b + 1} ({L.PCT[b]}-{L.PCT[b + 1]}%)" for b in range(5)]
    def labels(self, x, h1, shift=0):
        """int level per value (-1 = excluded). shift = percentile points added to the inner quintile edges (neighbour definitions)."""
        ok = np.isfinite(x); lab = np.full(len(x), -1, np.int64)
        if self.cat:
            p = np.searchsorted(self.vals, x[ok]); p = np.clip(p, 0, len(self.vals) - 1)
            hit = self.vals[p] == x[ok]; o = np.flatnonzero(ok); lab[o[hit]] = p[hit]; return lab
        off = 0
        if self.special is not None:
            sp = ok & (x == self.special); lab[sp] = 0; ok = ok & ~sp; off = 1
        ref = x[ok & h1]
        if len(ref) == 0: return lab
        edges = np.percentile(ref, np.array(L.PCT[1:-1], float) + shift)
        lab[ok] = off + np.searchsorted(edges, x[ok], side="right")
        return lab

# ---------------------------------------------------------------------------------------------------------------------------
def interaction(lab, key, nk, e, di, nd, sub=None, nl=None):
    """I, se, t, n, days per (key, level). key = set index or group index per trade (-1 = not in any group of this dimension).
    I = mean e of key in level - mean e of all trades (all sets) in level. Linearised day-clustered SE of that difference.
    Reference implementation (one key layer per call); the Engine uses the equivalent one-pass _cells_multi (checked by p3c_pilot)."""
    nl = (int(lab.max()) + 1 if (lab >= 0).any() else 1) if nl is None else nl
    ok = lab >= 0
    if sub is not None: ok = ok & sub
    lb, dd, ee, kk = lab[ok], di[ok], e[ok], key[ok]
    Sa = np.bincount(dd * nl + lb, ee, nd * nl).reshape(nd, nl); Ca = np.bincount(dd * nl + lb, None, nd * nl).reshape(nd, nl)
    g = kk >= 0
    ix = (dd[g] * nk + kk[g]) * nl + lb[g]
    Sd = np.bincount(ix, ee[g], nd * nk * nl); Cd = np.bincount(ix, None, nd * nk * nl)
    return _cells(Sd, Cd, Sa, Ca, nd, nk, nl)

def _cells(Sd, Cd, Sa, Ca, nd, nk, nl):
    """statistics from the flat dense (day, key, level) sums/counts Sd, Cd and the all-set (day, level) sums Sa, Ca.
    The (day, key, level) table is mostly empty -> work on its non-empty entries only.
    z_dkl = A_dkl - B_dl with A = (S - mu C)/N (0 where key has no trade that day) and B = (Sa - mua Ca)/Na
    sum_d z^2 = sum_nz A^2 - 2 sum_nz A B + sum_d B^2   (exact algebra, same number as the dense form)"""
    nz = np.flatnonzero(Cd); s, c = Sd[nz], Cd[nz]; kl = nz % (nk * nl); dl = (nz // (nk * nl)) * nl + nz % nl
    N = np.bincount(kl, c, nk * nl); Ssum = np.bincount(kl, s, nk * nl); Dk = np.bincount(kl, None, nk * nl)
    Na = Ca.sum(0); Da = (Ca > 0).sum(0)
    with np.errstate(invalid="ignore", divide="ignore"):
        mu = Ssum / N; mua = Sa.sum(0) / Na
        Bf = ((Sa - mua[None] * Ca) / Na[None]).ravel()                 # (nd*nl)
        A = (s - mu[kl] * c) / N[kl]
        sA2 = np.bincount(kl, A * A, nk * nl); sAB = np.bincount(kl, A * Bf[dl], nk * nl)
        sB2 = (Bf.reshape(nd, nl) ** 2).sum(0)                          # (nl)
        var = (sA2 - 2 * sAB + np.tile(sB2, nk)) * np.tile(Da / np.maximum(Da - 1, 1), nk)
        var = np.maximum(var, 0.0)
        I = mu - np.tile(mua, nk); se = np.sqrt(var)
        t = np.where((N >= MIN_N) & (Dk >= MIN_D) & (se > 0), I / se, np.nan)
    sh = (nk, nl)
    return I.reshape(sh), se.reshape(sh), t.reshape(sh), N.reshape(sh), Dk.reshape(sh)

# ---------------------------------------------------------------------------------------------------------------------------
class Engine:
    """all features, both layers (set, parameter groups). Label tables per ctx row for d = +1 / -1 computed once; a permutation only
    re-indexes them (same idea as p3fast)."""
    def __init__(self, T, X, P, feats=None, lev=None):
        self.T, self.X = T, X
        cols = [c for c in X.keys()]
        F = feature_defs(cols)
        if feats is not None: F = [f for f in F if f["name"] in feats]
        self.F = F; n = len(X["entry_t"])
        self.tab = [np.stack([np.asarray(f["fn"](X, np.full(n, dd)), float) for dd in (1, -1)], 1) for f in F]
        self.ds = (T["dir"] < 0).astype(np.int64); self.h1 = T["half"] == 0
        ud, self.di = np.unique(T["day"], return_inverse=True); self.nd = len(ud)
        us, self.si = np.unique(T["set_id"], return_inverse=True); self.ns = len(us); self.set_ids = us
        self.P = P
        self.dims = []
        for dim in PARAM_DIMS:
            vals = sorted(set(P[s][dim] for s in us), key=lambda v: (isinstance(v, str), v))
            vi = {v: i for i, v in enumerate(vals)}
            gset = np.array([vi[P[s][dim]] for s in us], np.int64)
            self.dims.append(dict(dim=dim, vals=vals, key=gset[self.si], nk=len(vals), gset=gset))
        # membership matrix set -> every group of every dimension (group sums = sums of their sets)
        self.ng = sum(D["nk"] for D in self.dims); self.M = np.zeros((self.ns, self.ng)); o = 0
        for D in self.dims:
            self.M[np.arange(self.ns), o + D["gset"]] = 1.0; D["off"] = o; o += D["nk"]
        # fixed level structure from the REAL rows (a synthetic market passes the real engine's `lev` so that cells line up;
        # its quintile edges are still cut from its own first half, like the permutations)
        if lev is not None:
            assert [f["name"] for f in F] == lev[0]; self.lev = lev[1]
        else:
            self.lev = []
            for j, f in enumerate(F):
                x = self.tab[j][T["ci"], self.ds]
                self.lev.append(Levels(x[self.h1]))

    def labels(self, j, ci, shift=0, tab=None):
        tab = self.tab[j] if tab is None else tab
        x = tab[ci, self.ds]
        return self.lev[j].labels(x, self.h1, shift)

    def layout(self):
        """cell keys in output order: for every feature, levels x (432 sets, then every group of every dimension)"""
        out = []
        for j, f in enumerate(self.F):
            for li, ln in enumerate(self.lev[j].names):
                for s in self.set_ids: out.append((f["name"], ln, "set", int(s)))
                for D in self.dims:
                    for v in D["vals"]: out.append((f["name"], ln, D["dim"], v))
        return out

    def t_all(self, ci=None, ci_time=None):
        """primary t of every cell (layout order). ci = ctx row per trade (None = real); ci_time = the rows used for TIME_FEATS
        (null 1b); None = the same as ci"""
        ci = self.T["ci"] if ci is None else ci; e = self.T["e"]; out = []
        ci_time = ci if ci_time is None else ci_time
        for j in range(len(self.F)):
            nl = len(self.lev[j].names); lab = self.labels(j, ci_time if self.F[j]["name"] in TIME_FEATS else ci)
            parts = self._both(lab, e, nl=nl)
            for li in range(nl):
                for r in parts: out.append(r[2][:, li])
        return np.concatenate(out)

    def full(self):
        """real data: every statistic needed by the gates, layout order. returns dict of arrays"""
        ci = self.T["ci"]; e = self.T["e"]; T = self.T
        subs = dict(h1=T["half"] == 0, h2=T["half"] == 1, buy=T["dir"] > 0, sell=T["dir"] < 0)
        acc = {k: [] for k in ("I", "se", "t", "n", "days", "h1", "h2", "buy", "sell", "h1_t", "h2_t", "buy_t", "sell_t", "var_t", "var_I")}
        for j, f in enumerate(self.F):
            nl = len(self.lev[j].names); lab = self.labels(j, ci)
            main = self._both(lab, e, nl=nl)
            sp = {k: self._both(lab, e, m, nl=nl) for k, m in subs.items()}
            vlabs = [self.labels(j, ci, s) for s in (-5, 5)] if not self.lev[j].cat else []
            for kj in self.kneighbours(j): vlabs.append(self.labels(kj, ci))
            var = [self._both(v, e, nl=nl) for v in vlabs]
            for li in range(nl):
                for part in range(len(main)):
                    R = main[part]; nk = R[0].shape[0]
                    def col(A, li=li, nk=nk): return A[:, li] if li < A.shape[1] else np.full(nk, np.nan)
                    acc["I"].append(col(R[0])); acc["se"].append(col(R[1])); acc["t"].append(col(R[2]))
                    acc["n"].append(col(R[3])); acc["days"].append(col(R[4]))
                    for k in subs:
                        acc[k].append(col(sp[k][part][0])); acc[k + "_t"].append(col(sp[k][part][2]))
                    acc["var_t"].append(np.stack([col(v[part][2]) for v in var], 1) if var else np.zeros((nk, 0)))
                    acc["var_I"].append(np.stack([col(v[part][0]) for v in var], 1) if var else np.zeros((nk, 0)))
        out = {k: np.concatenate(v) for k, v in acc.items() if k not in ("var_t", "var_I")}
        out["var_t"] = acc["var_t"]; out["var_I"] = acc["var_I"]
        return out

    def _both(self, lab, e, sub=None, nl=None):
        """[set layer, dim 1 groups, ..., dim 7 groups] in one pass: set sums per (day, set, level) once, group sums = M-weighted sums"""
        nd, ns = self.nd, self.ns
        nl = (int(lab.max()) + 1 if (lab >= 0).any() else 1) if nl is None else nl
        ok = lab >= 0
        if sub is not None: ok = ok & sub
        lb, dd, ee, kk = lab[ok], self.di[ok], e[ok], self.si[ok]
        Sa = np.bincount(dd * nl + lb, ee, nd * nl).reshape(nd, nl); Ca = np.bincount(dd * nl + lb, None, nd * nl).reshape(nd, nl)
        ix = (dd * ns + kk) * nl + lb
        Sd = np.bincount(ix, ee, nd * ns * nl); Cd = np.bincount(ix, None, nd * ns * nl)
        out = [_cells(Sd, Cd, Sa, Ca, nd, ns, nl)]
        Sg = np.tensordot(Sd.reshape(nd, ns, nl), self.M, axes=([1], [0])).transpose(0, 2, 1).ravel()   # (d, g, l)
        Cg = np.tensordot(Cd.reshape(nd, ns, nl), self.M, axes=([1], [0])).transpose(0, 2, 1).ravel()
        G = _cells(Sg, Cg, Sa, Ca, nd, self.ng, nl)
        for D in self.dims:
            a, b = D["off"], D["off"] + D["nk"]; out.append(tuple(A[a:b] for A in G))
        return out

    def kneighbours(self, j):
        """features that are the same column (and the same ~rel transform) with the other zigzag k"""
        kg = self.F[j]["kgroup"]
        if kg is None: return []
        # only when the level structure is the same (same names), otherwise level i would mean different things
        return [i for i, f in enumerate(self.F) if i != j and f["kgroup"] == kg and self.lev[i].names == self.lev[j].names]

def _col(A, li, nk):
    return A[:, li] if li < A.shape[1] else np.full(nk, np.nan)

def shift_ci(T, X, seed):
    """null 1b for TIME_FEATS: every trade keeps its day, outcome and direction; the ctx row becomes the entry of the same TF on the SAME
    trading day nearest to (minute of day + one random offset per day), wrapped circularly over the trading minutes 60..1139 after the open.
    Breaks only the link time-of-day <-> outcome; the day, its clustering and the spacing of that day's entries stay."""
    rng = np.random.default_rng(seed); out = T["ci"].copy()
    xt = X["entry_t"].astype(np.int64); LO, SPAN = 60, 1080
    for g in L.TFS:
        m = T["tf"] == g
        ue = np.unique(T["entry_t"][m]); row = np.searchsorted(xt, ue)
        day = X["day"][row].astype(np.int64); mo = X["t_min_open"][row].astype(np.int64)
        key = day * 10000 + mo; o = np.argsort(key, kind="stable"); key, row, day, mo = key[o], row[o], day[o], mo[o]
        ud = np.unique(day); off = dict(zip(ud, rng.integers(0, SPAN, len(ud))))
        tm = LO + (mo - LO + np.array([off[d] for d in day])) % SPAN; tgt = day * 10000 + tm
        p = np.searchsorted(key, tgt); p0 = np.clip(p - 1, 0, len(key) - 1); p1 = np.clip(p, 0, len(key) - 1)
        ok0 = day[p0] == day; ok1 = day[p1] == day
        d0 = np.where(ok0, np.abs(key[p0] - tgt), 1 << 40); d1 = np.where(ok1, np.abs(key[p1] - tgt), 1 << 40)
        assert np.all(ok0 | ok1)
        newrow = np.where(d1 < d0, row[p1], row[p0])
        idx = np.searchsorted(xt[row], T["entry_t"][m])            # row sorted by (day, minute) = chronological
        out[np.flatnonzero(m)] = newrow[idx]
    return out

def load_sandbox(dbt):
    """p3lib.load + drop trades of trading days >= 2026-06-01. p3lib.load cuts at UTC midnight 2026-06-01, which lets trades of the
    Sunday-evening open (trading day 2026-06-01 = exam) through when they close before midnight: none in the real market, 36 / 72 in the
    random-direction markets sf3 / sf5 (bugs.md 2026-09-30). The residuals e / ew are recomputed on the kept trades."""
    T, X = L.load(dbt); keep = T["day"] < L.SANDBOX_END // 86400
    if keep.all(): return T, X
    T = {k: (v[keep] if isinstance(v, np.ndarray) and len(v) == len(keep) else v) for k, v in T.items()}
    g = (T["set_id"] * 2 + (T["dir"] > 0)) * 2 + T["half"]; ug, gi = np.unique(g, return_inverse=True)
    mu = np.bincount(gi, T["r"]) / np.bincount(gi); win = (T["r"] > 0).astype(float); wmu = np.bincount(gi, win) / np.bincount(gi)
    T["e"] = T["r"] - mu[gi]; T["ew"] = win - wmu[gi]
    return T, X

def load_params(dbt):
    import sqlite3
    db = sqlite3.connect(dbt)
    return {r[0]: dict(tf=r[1], adx_p=r[2], ema_p=r[3], min_adx=r[4], min_gap=r[5], sl_atr=r[6], exit_mode=r[7])
            for r in db.execute("SELECT set_id, tf, adx_p, ema_p, min_adx, min_gap, sl_atr, exit_mode FROM params")}
