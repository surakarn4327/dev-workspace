r"""Phase 3B-b (smart-ea): WHEN during an open trade is cut / BE / hold-long / close-half better than holding as planned?
Engine shared by p3b_run.py (real + random-direction markets), p3b_perm.py (day-swap / sign-flip nulls) and p3b_audit.py.
Input = the full decision grid of one market (p3b_grid.py). Descriptive statistics only: nothing here picks rules or parameters.

DECISIONS (agreed with the user 2026-09-29, fixed BEFORE any outcome was looked at)
- unit = unique trade (utrades): a trade that several sets share counts once. Rule-like counting: a pattern acts at its FIRST occurrence in
  a trade (a real rule would act there; later occurrences would not exist) -> one value per trade per pattern. Neighbour definition in G5:
  every occurrence, averaged within the trade.
- outcome per row: delta = r_alt - r_plan for alt in cut / be / hold (r_plan = utrades.r_std). close-half = (r_cut - r_plan) / 2 exactly,
  so its t and gates are those of cut (reported, not tested separately). BE exists only when the trade is in profit at the tick.
- exit families (SL 4/8/12 x ladder/T3) are pooled; G4 requires the same sign in >= 5/6 of the families that have >= 100 trades in the
  pattern (fewer than 2 such families -> not verifiable = fail).
- baseline = the time checkpoints (every 5 bars of the trade TF) that carry no market event ("check-only" rows): an event / context
  pattern must beat a decision taken at an arbitrary time IN THE SAME STATE, not just zero. Residual e = delta - base[stratum], stratum =
  family x direction x half x open-R bin (<=-0.5, -0.5..0, 0..0.5, 0.5..1, >1) x TP parts closed (0/1/2) x bars held (<=10, 11-30, >30)
  within the TF; base = mean over trades of the trade-mean delta of its check-only rows in the stratum; strata with < 30 trades -> no
  baseline, a trade whose first occurrence falls there is dropped from that pattern.
- pattern groups (per TF M1/M3/M5, per alternative):
  E events (residual vs baseline): 19 events relative to the trade direction x condition all / in profit (open_r > 0) / in loss (<= 0);
    BE: events in profit only. Neighbours: definition variants (big 1.5/2.5 ATR, pin wick 50/70 %, volume 2.5/4 x, zigzag 2/4 for pivot and
    regime, box >= 15/30 bars, new day extreme after 30/120 min), condition open_r > 0.25 / <= -0.25, every-occurrence version.
  S state at check-only rows (raw delta vs 0): open-R bins (neighbour: edges -0.1 / +0.1), give-back mfe-open quintiles, bars held quintiles,
    minutes to cutoff quintiles, distance to next TP quintiles (neighbour: bands -5/+5 percentile points), TP parts closed 0/1/2;
    + every-occurrence version. BE: in-profit check rows only (open-R bins <= 0 do not exist).
  C market context at check-only rows (residual vs baseline): p3lib specs A_reg, A_cyc, A_leg, A_retr, D_m15, D_h1, C_daypos, B_phase,
    B_mv60, B_cost of the ctx columns at the decision time (same definitions and neighbours as phase 3) + every-occurrence version.
  Quintile bands = percentiles of the first-half check-only rows of the TF (direction-relative values where p3lib says so).
- gates: G1 |t| >= 3 and >= 100 days; G2 halves (trading day 2025-05-08) same sign |t| >= 1.5; G3 BUY/SELL same sign |t| >= 1.5; G4 families;
  G5 every neighbour same sign |t| >= 1.5; G6 null p <= 0.01 (E/C: day swap of the market events and context, 2,000 permutations;
  S: the state belongs to the trade itself, so the null is a day-level sign flip of the delta, 2,000 draws) + family-wise p.
  Random-direction markets (5): label gold / mechanical / between as phase 3.
  Changes made BEFORE the gate results were read (p3b_report.py, bugs.md 2026-09-29): the day-swap null is not centred at 0 for many
  patterns (first occurrence picks systematic moments of the trade) -> G6 = two-sided p against the pattern's own null distribution, and
  the family-wise p uses per-pattern standardised z; patterns with < 30 days are "not testable" (cluster SE unreliable).
  Run order (user asked for speed, same gates): 500 draws for every pattern (family-wise p), then the 2,000 registered draws only for the
  patterns that pass G1-G5 (p3b_perm_top.py, same seeds 1000-2999 -> identical to a full run for those patterns).
  BE: must also pass every gate when rows closer than $0.31 (= COST_STD) to the entry are removed ("be_far").
- SE: day-clustered ratio estimator (p3lib.cstat), cluster = trading day of the trade (all decisions of a trade are on its day)."""
import os
import numpy as np
import p3lib as L

BITS = {n: 1 << i for i, n in enumerate(["big", "pin", "vspike", "inside", "pivot", "regime", "boxbreak", "pdh", "pdl", "dayhigh", "daylow",
                                          "asiahigh", "asialow", "check"])}
MKT_MASK = (1 << 13) - 1
TFS = (1, 3, 5)
ALTS = ("cut", "be", "hold")
OB_EDGES = np.array([-0.5, 0.0, 0.5, 1.0])
HALF_DAY = L.HALF_DAY
FAR_PX = 0.31
MIN_BASE = 30
CHECK_N = 5
NSTRATA = 6 * 2 * 2 * 5 * 3 * 3

# (name, bit or (up bit, down bit), direction key or None, relation to the trade, definition variants)
EVENTS = [("big_with", "big", "big", 1, ["big15", "big25"]), ("big_against", "big", "big", -1, ["big15", "big25"]),
          ("pin_with", "pin", "pin", 1, ["pin50", "pin70"]), ("pin_against", "pin", "pin", -1, ["pin50", "pin70"]),
          ("vspike", "vspike", None, 0, ["vsp25", "vsp40"]), ("inside", "inside", None, 0, []),
          ("pivot_with", "pivot", "piv", 1, ["zz2", "zz4"]), ("pivot_against", "pivot", "piv", -1, ["zz2", "zz4"]),
          ("regime_to_with", "regime", "reg", 1, ["zz2", "zz4"]), ("regime_to_against", "regime", "reg", -1, ["zz2", "zz4"]),
          ("regime_to_side", "regime", "reg", 0, ["zz2", "zz4"]),
          ("box_with", "boxbreak", "box", 1, ["box15", "box30"]), ("box_against", "boxbreak", "box", -1, ["box15", "box30"]),
          ("prevday_with", ("pdh", "pdl"), None, 1, []), ("prevday_against", ("pdh", "pdl"), None, -1, []),
          ("dayext_with", ("dayhigh", "daylow"), None, 1, ["st30", "st120"]), ("dayext_against", ("dayhigh", "daylow"), None, -1, ["st30", "st120"]),
          ("asia_with", ("asiahigh", "asialow"), None, 1, []), ("asia_against", ("asiahigh", "asialow"), None, -1, [])]
EVD = {e[0]: e for e in EVENTS}
CONDS = {"all": None, "profit": ("gt", 0.0), "loss": ("le", 0.0)}
COND_NB = {"profit": ("gt", 0.25), "loss": ("le", -0.25)}
CTX_SPECS = ["A_reg", "A_cyc", "A_leg", "A_retr", "D_m15", "D_h1", "C_daypos", "B_phase", "B_mv60", "B_cost"]
STATE_Q = ("S_give", "S_held", "S_mtc", "S_dtp")

# ---------------------------------------------------------------------------------------------------------------------------
def load_market(D, slim=False):
    """grid + events + trades + ctx of one market directory (p3b/<name>), per TF. slim = only what the day-swap null needs."""
    T = dict(np.load(os.path.join(D, "trades.npz"))); C = dict(np.load(os.path.join(D, "ctx.npz")))
    out = dict(T=T, C=C, G={})
    for tf in TFS:
        g = np.load(os.path.join(D, f"grid_{tf}.npz")); evz = np.load(os.path.join(D, f"ev_{tf}.npz"))
        ev = {k: (evz[k].astype(np.int16) if k.startswith("fl_") else evz[k]) for k in evz.files}
        assert max(int(evz[k].max()) for k in evz.files if k.startswith("fl_")) <= MKT_MASK
        uid = g["uid"]; ti = np.searchsorted(T["uid"], uid); assert np.array_equal(T["uid"][ti], uid)
        assert np.all(np.diff(uid) >= 0), "grid rows must be sorted by uid"
        rs = T["r_std"][ti]; bar_n = g["bar_n"].astype(np.int32); ntp = g["ntp"].astype(np.int8); open_r = g["open_r"]
        R = dict(ti=ti.astype(np.int32), b=g["b"].astype(np.int32), bar_n=bar_n, ntp=ntp, open_r=open_r,
                 d_cut=g["r_cut"] - rs, d_be=g["r_be"] - rs, d_hold=g["r_hold"] - rs)
        R["dir"] = T["dir"][ti].astype(np.int8); fam = T["fam"][ti]; half = (T["day"][ti] >= HALF_DAY).astype(np.int64)
        R["half"] = half.astype(np.int8)
        R["far"] = open_r * T["risk"][ti] >= FAR_PX
        R["check"] = bar_n % CHECK_N == 0
        ob = np.searchsorted(OB_EDGES, open_r, side="left"); hb = np.where(bar_n <= 10, 0, np.where(bar_n <= 30, 1, 2))
        R["stratum"] = (((((fam * 2 + (R["dir"] > 0)) * 2 + half) * 5 + ob) * 3 + np.minimum(ntp, 2)) * 3 + hb).astype(np.int16)
        dec_t = ev["dec_t"][R["b"]]
        cix = np.full(len(ti), -1, np.int32); ck = R["check"]; cix[ck] = np.searchsorted(C["t"], dec_t[ck])
        assert np.all(C["t"][cix[ck]] == dec_t[ck]), "checkpoint without ctx"
        R["cix"] = cix
        if not slim:
            R.update(mfe_r=g["mfe_r"], dist_tp=g["dist_tp"], mtc=g["mtc"].astype(float), dec_t=dec_t)
        else:                                  # null workers: t only, float32 deltas are plenty (saves ~40 % memory per worker)
            for a in ("d_cut", "d_be", "d_hold"): R[a] = R[a].astype(np.float32)
        out["G"][tf] = dict(R=R, ev=ev)
    ud, tday = np.unique(T["day"], return_inverse=True); out["days"] = ud; out["tday"] = tday
    return out

# ---------------------------------------------------------------------------------------------------------------------------
def first_of(idx, ti):
    """idx = sorted row indices -> the first index of every trade (rows are sorted by trade)"""
    if not len(idx): return idx
    t = ti[idx]; return idx[np.r_[True, t[1:] != t[:-1]]]

def cond_ok(cond, open_r):
    if cond is None: return np.ones(len(open_r), bool)
    return open_r > cond[1] if cond[0] == "gt" else open_r <= cond[1]

def baseline(R, delta, co, grp=None):
    """base[stratum] = mean over trades of the trade-mean delta of the check-only rows co in that stratum; NaN when < MIN_BASE trades.
    grp = base_groups(R, co) can be shared by several deltas (one sort instead of one per delta; identical sums: NaN rows add 0.0)."""
    uk_ks, inv = base_groups(R, co) if grp is None else grp
    x = np.asarray(delta[co], dtype=float); ok = np.isfinite(x)
    c = np.bincount(inv, ok.astype(float), len(uk_ks)); s = np.bincount(inv, np.where(ok, x, 0.0), len(uk_ks))
    have = c > 0; tm = s[have] / c[have]; ks = uk_ks[have]
    cnt = np.bincount(ks, minlength=NSTRATA); sm = np.bincount(ks, tm, minlength=NSTRATA)
    with np.errstate(invalid="ignore", divide="ignore"): b = sm / cnt
    b[cnt < MIN_BASE] = np.nan
    return b

def base_groups(R, co):
    nt = int(R["ti"].max()) + 1
    key = R["stratum"][co].astype(np.int64) * nt + R["ti"][co]
    uk, inv = np.unique(key, return_inverse=True)
    return uk // nt, inv

def stats(v, ti, M, full=True):
    """per-trade values v (trade indices ti; NaN = dropped) -> day-clustered statistics (p3lib.cstat) + halves / BUY-SELL / families"""
    T = M["T"]; di = M["tday"][ti]; nd = len(M["days"])
    ok = np.isfinite(v)
    def cs(m):
        if not m.any(): return np.nan, np.nan, 0.0, 0
        return L.cstat(v[m], np.ones(int(m.sum()), bool), di[m], nd)
    mu, se, t, n = cs(ok)
    R = dict(mean=mu, se=se, t=t, n=n)
    if not full: return R
    R["days"] = int(len(np.unique(di[ok]))) if n else 0
    half = T["day"][ti] >= HALF_DAY; d = T["dir"][ti]; fam = T["fam"][ti]
    for nm, m in (("h1", ~half), ("h2", half), ("buy", d > 0), ("sell", d < 0)):
        a, b, c, k = cs(ok & m); R[nm] = a; R[nm + "_t"] = c; R[nm + "_n"] = k
    R["fam_mean"] = []; R["fam_t"] = []; R["fam_n"] = []
    for f in range(6):
        a, b, c, k = cs(ok & (fam == f)); R["fam_mean"].append(a); R["fam_t"].append(c); R["fam_n"].append(k)
    return R

def q_edges(ref, lo, hi):
    v = ref[np.isfinite(ref)]
    a = -np.inf if lo <= 0 else np.percentile(v, lo); b = np.inf if hi >= 100 else np.percentile(v, hi)
    return a, b

def in_band(x, a, b, hi): return np.isfinite(x) & (x >= a) & ((x < b) if hi < 100 else True)

def shifted(lo, hi, sh):
    return (max(0, lo + sh) if lo > 0 else 0), (min(100, hi + sh) if hi < 100 else 100)

# ---------------------------------------------------------------------------------------------------------------------------
def patterns(tf):
    """pattern descriptors of one TF, fixed order (the nulls rely on it)"""
    P = []
    for alt in ALTS:
        for n, *_ in EVENTS:
            for c in (["profit"] if alt == "be" else list(CONDS)): P.append(dict(tf=tf, alt=alt, grp="E", feat=n, level=c))
        for lv in range(5):
            if alt == "be" and lv <= 1: continue
            P.append(dict(tf=tf, alt=alt, grp="S", feat="S_open", level=lv))
        for f in STATE_Q:
            for lv in range(5): P.append(dict(tf=tf, alt=alt, grp="S", feat=f, level=lv))
        for lv in range(3): P.append(dict(tf=tf, alt=alt, grp="S", feat="S_ntp", level=lv))
        for sp in L.specs(tf):
            if sp["name"] not in CTX_SPECS: continue
            for lv in range(len(sp["levels"]) if sp["kind"] == "cat" else 5): P.append(dict(tf=tf, alt=alt, grp="C", feat=sp["name"], level=lv))
    return P

def pkey(p):
    """the rows of a pattern depend on (group, feature, level, BE?) only; E-in-profit rows are the same for every alternative"""
    if p["grp"] == "E": return ("E", p["feat"], "profit" if p["alt"] == "be" else p["level"])
    return (p["grp"], p["feat"], p["level"], p["alt"] == "be")

class Engine:
    """statistics of every pattern of one market. bar_donor / ctx_donor None = the real assignment; else day-swap donors."""
    def __init__(self, M, neighbours=True):
        self.M = M; self.nb = neighbours
        self.specs = {tf: {sp["name"]: sp for sp in L.specs(tf) if sp["name"] in CTX_SPECS} for tf in TFS}
        self.P = {tf: patterns(tf) for tf in TFS}
        # ctx pattern tables per checkpoint time, for d = +1 (col 0) and d = -1 (col 1) (the spec functions are element-wise)
        C = M["C"]; nt = len(C["t"]); X = {k: v for k, v in C.items() if k != "t"}; dd = [np.ones(nt, np.int64), -np.ones(nt, np.int64)]
        self.tab = {}
        for tf in TFS:
            for nm, sp in self.specs[tf].items():
                if sp["kind"] == "cat":
                    for vi, v in enumerate(sp["variants"] if neighbours else sp["variants"][:1]):
                        self.tab[(tf, nm, vi)] = np.stack([np.asarray(sp["fn"](X, d, v)) for d in dd], 1).astype(np.int8)
                else:
                    for k in ((L.KV if sp["structural"] else [3]) if neighbours else [3]):
                        self.tab[(tf, nm, k)] = np.stack([np.asarray(sp["fn"](X, d, k), dtype=float) for d in dd], 1)

    # ---- rows of one pattern: (primary first rows, [neighbours as (row index array, first?)], all primary rows)
    def _event_rows(self, feat, vn, fl_of, R, ev, b):
        _, bits, dk, rel, _ = EVD[feat]; d = R["dir"]
        if isinstance(bits, tuple):
            up, dn = self._bit(fl_of, vn, bits[0]), self._bit(fl_of, vn, bits[1])
            a = up[d[up] > 0] if rel == 1 else up[d[up] < 0]
            z = dn[d[dn] < 0] if rel == 1 else dn[d[dn] > 0]
            return np.sort(np.concatenate([a, z]))
        idx = self._bit(fl_of, vn, bits)
        if dk is None: return idx
        x = ev[f"{dk}_{vn}"][b[idx]].astype(np.int64)
        if rel == 0: return idx[x == 0]
        return idx[(x * d[idx]) * rel > 0]

    def _bit(self, fl_of, vn, bit):
        """rows whose bar carries `bit` (one scan per flag variant: the rows with any bit, then each bit within those)"""
        key = (vn, bit)
        if key not in self._bits:
            if (vn, "*") not in self._bits:
                f = fl_of(vn); nz = np.flatnonzero(f); self._bits[(vn, "*")] = (nz, f[nz])
            nz, fv = self._bits[(vn, "*")]
            self._bits[key] = nz[(fv & BITS[bit]) != 0]
        return self._bits[key]

    def _rows(self, p, R, ev, b, fl_of, co, lab_of, h1c):
        grp, feat, lv, be = p["grp"], p["feat"], p["level"], p["alt"] == "be"
        ti = R["ti"]; op = R["open_r"]; nb = self.nb; var = []
        if grp == "E":
            cond = CONDS["profit" if be else lv]
            ev0 = self._event_rows(feat, "base", fl_of, R, ev, b)
            rows = ev0[cond_ok(cond, op[ev0])]
            if nb:
                for vn in EVD[feat][4]:
                    r = self._event_rows(feat, vn, fl_of, R, ev, b); var.append((first_of(r[cond_ok(cond, op[r])], ti), True))
                cname = "profit" if be else lv
                if cname in COND_NB: var.append((first_of(ev0[cond_ok(COND_NB[cname], op[ev0])], ti), True))
                var.append((rows, False))
            return first_of(rows, ti), var, rows
        app = op[co] > 0 if be else np.ones(len(co), bool)
        if grp == "S":
            if feat == "S_open":
                x = op[co]; masks = [np.searchsorted(OB_EDGES + s, x, side="left") == lv for s in ((0.0, -0.1, 0.1) if nb else (0.0,))]
            elif feat == "S_ntp":
                masks = [np.minimum(R["ntp"][co], 2) == lv]
            else:
                x = {"S_give": lambda: R["mfe_r"][co] - op[co], "S_held": lambda: R["bar_n"][co].astype(float),
                     "S_mtc": lambda: R["mtc"][co], "S_dtp": lambda: R["dist_tp"][co]}[feat]()
                ref = x[h1c]; lo, hi = L.PCT[lv], L.PCT[lv + 1]
                def bm(sh):
                    l2, h2 = shifted(lo, hi, sh); a, z = q_edges(ref, l2, h2); return in_band(x, a, z, h2)
                masks = [bm(0)] + ([bm(-5), bm(5)] if nb else [])
        else:
            sp = self.specs[p["tf"]][feat]
            if sp["kind"] == "cat":
                masks = [lab_of(feat, vi) == lv for vi in range(len(sp["variants"]) if nb else 1)]
            elif not nb:
                # nulls: quintile label of every row once per feature (edges = the same percentiles as q_edges; x == edge goes to the
                # upper band exactly like in_band's x >= a; NaN -> no band)
                if ("q", feat) not in self._bits:
                    x = lab_of(feat, 3); ref = x[h1c]; ref = ref[np.isfinite(ref)]
                    e = np.percentile(ref, L.PCT[1:-1]); lab = np.searchsorted(e, x, side="right")
                    self._bits[("q", feat)] = np.where(np.isfinite(x), lab, -1)
                masks = [self._bits[("q", feat)] == lv]
            else:
                lo, hi = L.PCT[lv], L.PCT[lv + 1]
                def band(k, l2, h2):
                    x = lab_of(feat, k); a, z = q_edges(x[h1c], l2, h2); return in_band(x, a, z, h2)
                masks = [band(3, lo, hi)]
                if nb:
                    masks += [band(3, *shifted(lo, hi, -5)), band(3, *shifted(lo, hi, 5))]
                    if sp["structural"]: masks += [band(2, lo, hi), band(4, lo, hi)]
        rows = co[masks[0] & app]
        if nb: var = [(first_of(co[mk & app], ti), True) for mk in masks[1:]] + [(rows, False)]
        return first_of(rows, ti), var, rows

    def run(self, bar_donor=None, ctx_donor=None, full=True, far_be=False, only_t=False, groups=("E", "S", "C"), s_collect=None, subset=None):
        """result dicts in the order of patterns(tf), TF 1/3/5 (only_t: array of t; groups not listed -> t NaN).
        far_be: BE also with rows closer than $0.31 to the entry removed (keys far_*). s_collect: list receiving (trade idx, value) of S patterns."""
        M = self.M; out = []; far_t = []; gi = -1                      # subset = global pattern indices to compute (others -> NaN)
        for tf in TFS:
            if subset is not None and not any(gi + 1 + j in subset for j in range(len(self.P[tf]))):
                for p in self.P[tf]:
                    gi += 1; out.append(np.nan if only_t else dict(p, t=np.nan))
                    if p["alt"] == "be" and far_be: far_t.append(np.nan)
                continue
            R, ev = M["G"][tf]["R"], M["G"][tf]["ev"]; ti = R["ti"]
            b = R["b"] if bar_donor is None else bar_donor[tf][R["b"]]
            fls = {}
            def fl_of(vn):
                if vn not in fls: fls[vn] = ev["fl_" + vn][b]
                return fls[vn]
            self._bits = {}
            checkonly = R["check"] & ((fl_of("base") & MKT_MASK) == 0); co = np.flatnonzero(checkonly)
            cix = R["cix"][co] if ctx_donor is None else ctx_donor[R["cix"][co]]
            ds = (R["dir"][co] < 0).astype(np.int64); h1c = R["half"][co] == 0
            labs = {}
            def lab_of(feat, v):
                if (feat, v) not in labs: labs[(feat, v)] = self.tab[(tf, feat, v)][cix, ds]
                return labs[(feat, v)]
            V = {}; bg = base_groups(R, co)
            for alt in ALTS:
                dl = R["d_" + alt]; V[alt] = (dl - baseline(R, dl, co, bg)[R["stratum"]], dl)
            if far_be:
                dl = np.where(R["far"], R["d_be"], np.nan); V["be_far"] = (dl - baseline(R, dl, co, bg)[R["stratum"]], dl)
            cache = {}
            for p in self.P[tf]:
                isfar = p["alt"] == "be" and far_be; gi += 1
                if p["grp"] not in groups or (subset is not None and gi not in subset):
                    out.append(np.nan if only_t else dict(p, t=np.nan))
                    if isfar: far_t.append(np.nan)
                    continue
                k = pkey(p)
                if k not in cache: cache[k] = self._rows(p, R, ev, b, fl_of, co, lab_of, h1c)
                fr, var, rows = cache[k]
                x = V[p["alt"]][1] if p["grp"] == "S" else V[p["alt"]][0]
                if s_collect is not None and p["grp"] == "S":
                    s_collect.append((ti[fr], x[fr]))
                    if isfar:
                        frf = first_of(rows[R["far"][rows]], ti); s_collect.append((ti[frf], V["be_far"][1][frf]))
                res = stats(x[fr], ti[fr], M, full and not only_t)
                if only_t:
                    out.append(res["t"])
                    if isfar:
                        xf = V["be_far"][1] if p["grp"] == "S" else V["be_far"][0]
                        frf = first_of(rows[R["far"][rows]], ti); far_t.append(stats(xf[frf], ti[frf], M, False)["t"])
                    continue
                if self.nb: res["var_t"], res["var_mean"] = self._var(var, ti, x)
                if p["alt"] == "be" and far_be:
                    xf = V["be_far"][1] if p["grp"] == "S" else V["be_far"][0]; far = R["far"]
                    frf = first_of(rows[far[rows]], ti); s = stats(xf[frf], ti[frf], M, full)
                    if self.nb:
                        s["var_t"], s["var_mean"] = self._var([(first_of(r[far[r]], ti) if f else r[far[r]], f) for r, f in var], ti, xf)
                    res.update({"far_" + kk: vv for kk, vv in s.items()})
                res.update(p); out.append(res)
        return np.array(out + far_t, dtype=float) if only_t else out

    def _var(self, var, ti, x):
        tt, mm = [], []
        for rows, first in var:
            if first: s = stats(x[rows], ti[rows], self.M, False)
            else:
                xr = x[rows]; ok = np.isfinite(xr); ut, inv = np.unique(ti[rows][ok], return_inverse=True)
                s = stats(np.bincount(inv, xr[ok]) / np.bincount(inv) if len(ut) else np.zeros(0), ut, self.M, False)
            tt.append(s["t"]); mm.append(s["mean"])
        return tt, mm

# ---------------------------------------------------------------------------------------------------------------------------
def day_perm_donors(M, seed):
    """one day permutation (within each half) applied to the market events of every TF bar and to the ctx of every checkpoint time.
    Donor = the bar / ctx time at the nearest minute of the trading day on the permuted day. Returns (bar_donor {tf: array}, ctx_donor)."""
    rng = np.random.default_rng(seed)
    days = M["days"]; pm = {}
    for h in (0, 1):
        ds = days[(days >= HALF_DAY) == bool(h)]; pm.update(zip(ds.tolist(), rng.permutation(ds).tolist()))
    def donors(day, minute):
        key = day * 10000 + minute; o = np.argsort(key, kind="stable"); ks = key[o]
        pd = np.array([pm.get(x, x) for x in day.tolist()], dtype=np.int64); tgt = pd * 10000 + minute
        p = np.searchsorted(ks, tgt); p0 = np.clip(p - 1, 0, len(ks) - 1); p1 = np.clip(p, 0, len(ks) - 1)
        ok0 = ks[p0] // 10000 == pd; ok1 = ks[p1] // 10000 == pd
        d0 = np.where(ok0, np.abs(ks[p0] - tgt), 1 << 40); d1 = np.where(ok1, np.abs(ks[p1] - tgt), 1 << 40)
        inset = np.isin(day, days)
        assert np.all(ok0 | ok1 | ~inset)
        return np.where(inset, o[np.where(d1 < d0, p1, p0)], np.arange(len(day)))
    def day_min(ev):
        day = ev["day"].astype(np.int64); t = ev["t_open"].astype(np.int64)
        first = np.r_[True, day[1:] != day[:-1]]; dopen = t[first][np.cumsum(first) - 1]
        return day, (t - dopen) // 60, dopen
    bar = {}; C = M["C"]; cday = np.full(len(C["t"]), -1, np.int64); cmin = np.zeros(len(C["t"]), np.int64)
    for tf in TFS:
        R, ev = M["G"][tf]["R"], M["G"][tf]["ev"]; day, mn, dopen = day_min(ev)
        bar[tf] = donors(day, mn)
        m = R["cix"] >= 0; bb = R["b"][m]; t = ev["dec_t"][bb]
        cday[R["cix"][m]] = day[bb]; cmin[R["cix"][m]] = (t - dopen[bb]) // 60
    assert np.all(cday >= 0)
    return bar, donors(cday, cmin)

def fam_gate(r):
    """G4: families with >= 100 trades; same sign as the pooled mean in >= 5/6 of them; < 2 such families -> False"""
    fm = [m for m, n in zip(r["fam_mean"], r["fam_n"]) if n >= 100 and np.isfinite(m)]
    if len(fm) < 2 or not np.isfinite(r["mean"]): return False, len(fm)
    same = np.mean([np.sign(m) == np.sign(r["mean"]) for m in fm]); return bool(same >= 5 / 6 - 1e-9), len(fm)
