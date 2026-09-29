r"""Phase 3: fast engine for the null runs (same numbers as the slow per-pattern code, ~50x faster).

The slow path (p3lib.pattern_masks + cstat) rebuilds every pattern mask from the ctx columns for all ~640k trades on every permutation.
But a pattern label depends only on (ctx row, trade direction). So: evaluate every spec ONCE per ctx row for direction +1 and -1
(label table / value table, shape n_ctx x 2), and a permutation only re-indexes those tables with the donor rows. Per level the sums
and counts per trading day come from one bincount; mean, day-clustered SE and t are then computed for all levels at once with the
same formulas as p3lib.cstat. Percentile bands of q features are recomputed from the first-half trades on every call, exactly like the
slow path (np.percentile of the same values), so identity and permuted results are identical, not approximations.
Checked by p3_fast_check.py (identity = p3_real.pkl t for all 549 patterns; seeds 1000-1039 = the slow p3_perm.py results).
Order of outputs = order of p3lib.all_patterns (TF 1/3/5, specs order, levels order)."""
import numpy as np
import p3lib as L

FAMS = [(sl, ex) for sl in (4.0, 8.0, 12.0) for ex in ("L", "T3")]

def _level_stats(S, C):
    """S, C: (days, levels) sums of e and counts -> mean, se, t, n per level (same as p3lib.cstat)"""
    N = C.sum(0); D = (C > 0).sum(0)
    with np.errstate(invalid="ignore", divide="ignore"):
        mu = S.sum(0) / N
        se = np.sqrt(((S - mu * C) ** 2).sum(0) * D / np.maximum(D - 1, 1)) / N
        t = np.where((N > 0) & (se > 0), mu / se, 0.0)
    return mu, se, t, N

class Fast:
    def __init__(self, T, X, fam_of_set=None):
        self.T, self.X = T, X; n = len(X["entry_t"]); self.G = []
        for g in L.TFS:
            m = T["tf"] == g
            ud, di = np.unique(T["day"][m], return_inverse=True)
            G = dict(m=m, e=T["e"][m], di=di, nd=len(ud), ds=(T["dir"][m] < 0).astype(np.int64), h1=T["half"][m] == 0, specs=[])
            if fam_of_set is not None: G["fam"] = np.array([fam_of_set[s] for s in T["set_id"][m]], dtype=np.int64)
            for sp in L.specs(g):
                if sp["kind"] == "cat":
                    v0 = sp["variants"][0]
                    tab = np.stack([np.asarray(sp["fn"](X, np.full(n, d), v0)) for d in (1, -1)], 1).astype(np.int64)
                    G["specs"].append(("cat", tab, len(sp["levels"])))
                else:
                    tab = np.stack([np.asarray(sp["fn"](X, np.full(n, d), 3), dtype=float) for d in (1, -1)], 1)
                    G["specs"].append(("q", tab, 5))
            self.G.append(G)

    def _labels(self, G, kind, tab, rows):
        x = tab[rows, G["ds"]]
        if kind == "cat": return x
        ref = x[G["h1"]]; ref = ref[np.isfinite(ref)]
        edges = np.percentile(ref, L.PCT[1:-1])
        lab = np.searchsorted(edges, x, side="right")
        return np.where(np.isfinite(x), lab, -1)

    def t_all(self, ci=None):
        """t of every pattern (primary definitions). ci = ctx row per trade (full length like T['ci']); None = real rows"""
        ci = self.T["ci"] if ci is None else ci; out = []
        for G in self.G:
            rows = ci[G["m"]]; di, nd, e = G["di"], G["nd"], G["e"]
            for kind, tab, nl in G["specs"]:
                lab = self._labels(G, kind, tab, rows); ok = lab >= 0
                idx = di[ok] * nl + lab[ok]
                S = np.bincount(idx, e[ok], nd * nl).reshape(nd, nl); C = np.bincount(idx, None, nd * nl).reshape(nd, nl).astype(float)
                out.extend(_level_stats(S, C)[2].tolist())
        return np.array(out)

    def q_all(self, ci=None, min_n=200):
        """heterogeneity Q of every pattern across exit families (same as the slow p3_audit.q_stats)"""
        ci = self.T["ci"] if ci is None else ci; out = []; nf = len(FAMS)
        for G in self.G:
            rows = ci[G["m"]]; di, nd, e, fam = G["di"], G["nd"], G["e"], G["fam"]
            for kind, tab, nl in G["specs"]:
                lab = self._labels(G, kind, tab, rows); ok = lab >= 0
                idx = (di[ok] * nf + fam[ok]) * nl + lab[ok]
                S = np.bincount(idx, e[ok], nd * nf * nl).reshape(nd, nf * nl)
                C = np.bincount(idx, None, nd * nf * nl).reshape(nd, nf * nl).astype(float)
                mu, se, t, N = _level_stats(S, C)
                mu, se, N = mu.reshape(nf, nl), se.reshape(nf, nl), N.reshape(nf, nl)
                for li in range(nl):
                    use = (N[:, li] >= min_n) & (se[:, li] > 0)
                    if use.sum() < 2: out.append(np.nan); continue
                    ls, ss = mu[use, li], se[use, li]; w = 1 / ss ** 2; mm = np.sum(w * ls) / w.sum()
                    out.append(float(np.sum(((ls - mm) / ss) ** 2)))
        return np.array(out)
