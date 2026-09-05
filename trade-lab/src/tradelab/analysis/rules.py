"""Find *combinations* without brute-forcing them.

Enumerating every 3-way mix of 180 conditions is ~950,000 tests, of which tens
of thousands look excellent by chance. A shallow decision tree finds the
interactions that actually carry information and produces far fewer candidates,
and - unlike a black box - each leaf reads back as a plain rule you can put
straight into an EA.

Depth is capped hard (default 3). Deeper trees fit the past better and the
future worse, every time.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.inspection import permutation_importance
from sklearn.tree import DecisionTreeRegressor

from ..config import AnalysisConfig
from . import episodes, stats


@dataclass
class Rule:
    """One leaf of the tree, expressed as a list of conditions."""

    clauses: list[str] = field(default_factory=list)
    mask: np.ndarray | None = None

    @property
    def text(self) -> str:
        return " AND ".join(self.clauses) if self.clauses else "(always)"


def mine_rules(
    features: pd.DataFrame,
    r_values: np.ndarray | pd.Series,
    *,
    cfg: AnalysisConfig | None = None,
    seed: int = 0,
    episode_gap: int = 0,
) -> pd.DataFrame:
    """Grow one shallow tree on expectancy and read its leaves back as rules.

    Leaf statistics are episode-clustered, same as the single-condition screen -
    a leaf that captures one long stretch of the past is not a discovery.
    """
    cfg = cfg or AnalysisConfig()
    n_all = len(features)
    X, y, keep_idx, cols = _prepare(features, r_values)
    if X.shape[0] < cfg.min_leaf_events * 2:
        return pd.DataFrame()

    tree = DecisionTreeRegressor(
        max_depth=cfg.max_rule_depth,
        min_samples_leaf=cfg.min_leaf_events,
        random_state=seed,
    )
    tree.fit(X, y)

    r_full = np.asarray(r_values, dtype=np.float64)

    def episode_means_for(compressed_mask: np.ndarray) -> np.ndarray:
        """Lift a mask from the compressed row space back to the bar timeline."""
        full = np.zeros(n_all, dtype=bool)
        full[keep_idx[compressed_mask]] = True
        return episodes.group_means(r_full, episodes.cluster_ids(full, episode_gap))

    all_rows = np.ones(X.shape[0], dtype=bool)
    overall = stats.expectancy(y, episode_means_for(all_rows))

    rows = []
    for rule in _extract_leaves(tree, cols, X):
        ep_means = episode_means_for(rule.mask)
        if ep_means.size < cfg.min_episodes:
            continue
        e = stats.expectancy(y[rule.mask], ep_means)
        if e.n < cfg.min_leaf_events:
            continue
        rows.append(
            {
                "rule": rule.text,
                "depth": len(rule.clauses),
                **e.as_dict(),
                "baseline_mean_r": overall.mean_r,
                "edge_vs_baseline_r": e.mean_r - overall.mean_r,
            }
        )

    out = pd.DataFrame(rows)
    if out.empty:
        return out
    out["passes_fdr"] = stats.benjamini_hochberg(out["p_value"].to_numpy(), cfg.fdr)
    out["single_trade_risk"] = out["top_trade_share"] > 0.30
    out["survives"] = (
        out["passes_fdr"]
        & (out["mean_r"] > 0)
        & (out["mean_r_episode"] > 0)
        & (out["ci_low"] > 0)
        & ~out["single_trade_risk"]
    )
    return out.sort_values("mean_r", ascending=False, ignore_index=True)


def feature_importance(
    features: pd.DataFrame,
    r_values: np.ndarray | pd.Series,
    *,
    top: int = 40,
    seed: int = 0,
) -> pd.DataFrame:
    """Permutation importance from a gradient-boosted model.

    Importance here means "shuffling this column costs the model accuracy", not
    "this column is profitable". It ranks what to look at next; it is not a
    finding on its own.
    """
    X, y, _, cols = _prepare(features, r_values)
    if X.shape[0] < 500:
        return pd.DataFrame()

    cut = int(X.shape[0] * 0.7)
    model = HistGradientBoostingRegressor(
        max_depth=3, max_iter=200, learning_rate=0.05, random_state=seed
    )
    model.fit(X[:cut], y[:cut])

    rng = np.random.default_rng(seed)
    result = permutation_importance(
        model, X[cut:], y[cut:], n_repeats=5, random_state=int(rng.integers(1 << 31))
    )
    out = pd.DataFrame(
        {
            "feature": cols,
            "importance": result.importances_mean,
            "importance_std": result.importances_std,
        }
    )
    return out.sort_values("importance", ascending=False, ignore_index=True).head(top)


# --- internals ----------------------------------------------------------------


def _prepare(features: pd.DataFrame, r_values) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[str]]:
    r = np.asarray(r_values, dtype=np.float64)
    usable = np.isfinite(r)
    F = features.loc[usable]
    # Columns that are all-NaN or constant carry nothing and upset the splitter.
    good = [c for c in F.columns if F[c].notna().sum() > 100 and F[c].std(skipna=True) > 0]
    F = F[good]
    X = F.to_numpy(dtype=np.float64)
    # Trees here need finite input; median fill is neutral and keeps rows.
    med = np.nanmedian(X, axis=0)
    med = np.where(np.isfinite(med), med, 0.0)
    X = np.where(np.isfinite(X), X, med)
    return X, r[usable], np.flatnonzero(usable), good


def _extract_leaves(tree: DecisionTreeRegressor, cols: list[str], X: np.ndarray) -> list[Rule]:
    t = tree.tree_
    rules: list[Rule] = []

    def walk(node: int, clauses: list[str], mask: np.ndarray) -> None:
        if t.children_left[node] == -1:
            rules.append(Rule(list(clauses), mask))
            return
        f = int(t.feature[node])
        thr = float(t.threshold[node])
        name = cols[f]
        left = mask & (X[:, f] <= thr)
        right = mask & (X[:, f] > thr)
        walk(t.children_left[node], clauses + [f"{name} <= {thr:.4g}"], left)
        walk(t.children_right[node], clauses + [f"{name} > {thr:.4g}"], right)

    walk(0, [], np.ones(X.shape[0], dtype=bool))
    return rules
