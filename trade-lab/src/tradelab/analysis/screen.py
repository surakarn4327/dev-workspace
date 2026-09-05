"""Screen every condition twice: does it mark events, and does it make money.

Two questions, deliberately separated:

* **Event rate vs baseline** - answers "is this really where price turns?"
* **Expectancy in R** - answers "would trading it have paid?"

A condition can pass the first and fail the second (common: real level, too
tight a stop) and that distinction is the most useful thing the report says.

Both are computed at *episode* level, never bar level - see
:mod:`tradelab.analysis.episodes`.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..config import AnalysisConfig
from . import episodes, stats
from .conditions import Condition


def screen_event_rate(
    conditions: list[Condition],
    event_mask: np.ndarray,
    *,
    cfg: AnalysisConfig | None = None,
    universe: np.ndarray | None = None,
    episode_gap: int = 0,
) -> pd.DataFrame:
    """Event rate under each condition against the unconditional rate.

    The reported ``rate`` is the plain bar-level frequency, but the significance
    test treats one episode as one observation. Without that, "every Friday"
    arrives with a p-value of 0.001 and no information.
    """
    cfg = cfg or AnalysisConfig()
    event_mask = np.asarray(event_mask, dtype=bool)
    universe = (
        np.ones_like(event_mask, dtype=bool) if universe is None else np.asarray(universe, bool)
    )

    base_n = int(universe.sum())
    base_hits = int((event_mask & universe).sum())
    base_rate = base_hits / base_n if base_n else float("nan")

    rows = []
    for c in conditions:
        m = c.mask & universe
        n = int(m.sum())
        if n < cfg.min_events:
            continue
        n_ep = episodes.count(m, episode_gap)
        if n_ep < cfg.min_episodes:
            continue

        hits = int((event_mask & m).sum())
        rate = hits / n

        # One episode = one observation. Scale the counts down accordingly so
        # the test sees the sample size that actually exists.
        eff_hits = int(round(rate * n_ep))
        eff_base_n = max(n_ep, min(base_n, n_ep * 20))
        eff_base_hits = int(round(base_rate * eff_base_n))

        row = {
            "condition": c.name,
            "feature": c.feature,
            "rule": c.description,
            "n": n,
            "n_episodes": n_ep,
            "hits": hits,
        }
        row.update(stats.rate_vs_baseline(eff_hits, n_ep, eff_base_hits, eff_base_n))
        # report the honest bar-level rate, keep the episode-level p-value
        row["rate"] = rate
        row["baseline_rate"] = base_rate
        row["lift"] = rate / base_rate if base_rate else float("nan")
        lo, hi = stats.wilson_interval(eff_hits, n_ep)
        row["rate_ci_low"], row["rate_ci_high"] = lo, hi
        rows.append(row)

    out = pd.DataFrame(rows)
    if out.empty:
        return out
    out["passes_fdr"] = stats.benjamini_hochberg(out["p_value"].to_numpy(), cfg.fdr)
    out["bonferroni_p"] = stats.deflated_threshold(len(out))
    out["passes_bonferroni"] = out["p_value"] <= out["bonferroni_p"]
    out["survives"] = out["passes_fdr"] & (out["lift"] > 1.0)
    return out.sort_values("lift", ascending=False, ignore_index=True)


def screen_expectancy(
    conditions: list[Condition],
    r_values: np.ndarray | pd.Series,
    *,
    cfg: AnalysisConfig | None = None,
    universe: np.ndarray | None = None,
    episode_gap: int = 0,
) -> pd.DataFrame:
    """Per-trade expectancy under each condition, net of costs."""
    cfg = cfg or AnalysisConfig()
    r = np.asarray(r_values, dtype=np.float64)
    tradable = np.isfinite(r)
    universe = tradable if universe is None else (np.asarray(universe, bool) & tradable)

    overall = stats.expectancy(
        r[universe], episodes.group_means(r, episodes.cluster_ids(universe, episode_gap))
    )

    rows = []
    for c in conditions:
        m = c.mask & universe
        if int(m.sum()) < cfg.min_events:
            continue
        ids = episodes.cluster_ids(m, episode_gap)
        ep_means = episodes.group_means(r, ids)
        if ep_means.size < cfg.min_episodes:
            continue

        e = stats.expectancy(r[m], ep_means)
        rows.append(
            {
                "condition": c.name,
                "feature": c.feature,
                "rule": c.description,
                **e.as_dict(),
                "baseline_mean_r": overall.mean_r,
                "edge_vs_baseline_r": e.mean_r - overall.mean_r,
            }
        )

    out = pd.DataFrame(rows)
    if out.empty:
        return out
    out["passes_fdr"] = stats.benjamini_hochberg(out["p_value"].to_numpy(), cfg.fdr)
    out["bonferroni_p"] = stats.deflated_threshold(len(out))
    out["passes_bonferroni"] = out["p_value"] <= out["bonferroni_p"]
    # A "winner" carried by one lucky trade is not a winner.
    out["single_trade_risk"] = out["top_trade_share"] > 0.30
    # The only column worth acting on. Statistical significance alone lets
    # through rows whose trade-weighted expectancy is still negative, because
    # the test is on episode means - both must be positive to mean anything.
    out["survives"] = (
        out["passes_fdr"]
        & (out["mean_r"] > 0)
        & (out["mean_r_episode"] > 0)
        & (out["ci_low"] > 0)
        & ~out["single_trade_risk"]
    )
    return out.sort_values("mean_r", ascending=False, ignore_index=True)


def redundancy_report(
    features: pd.DataFrame, *, cfg: AnalysisConfig | None = None, max_cols: int = 400
) -> pd.DataFrame:
    """Which features are saying the same thing.

    Answers the "five indicators confirming each other" question with a number:
    features in one group are one opinion, not five.
    """
    cfg = cfg or AnalysisConfig()
    numeric = features.loc[:, features.std(numeric_only=True) > 0]
    if numeric.shape[1] > max_cols:
        numeric = numeric.iloc[:, :max_cols]
    corr = numeric.corr(min_periods=200)
    groups = stats.redundancy_groups(corr, cfg.redundancy_threshold)
    rows = [
        {"group": i, "size": len(g), "members": ", ".join(g)}
        for i, g in enumerate(groups, start=1)
    ]
    return pd.DataFrame(rows)
