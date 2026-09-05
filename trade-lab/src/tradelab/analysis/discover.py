"""Look for patterns nobody named.

Everything else in the package tests concepts that already have names. This
module does the opposite: it groups event bars purely by how their context
*looks*, with no knowledge of what traders call things, then profiles each group.
A cluster that pays and does not line up with any known concept is the
interesting case - it gets read, argued about, and named by hand.

Still bound by the same discipline: a cluster is a lead, not a finding, until it
survives the holdout.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler

from . import episodes, stats


def cluster_events(
    features: pd.DataFrame,
    r_values: np.ndarray | pd.Series,
    *,
    n_clusters: int = 8,
    n_components: int = 10,
    seed: int = 0,
    min_cluster: int = 50,
    min_episodes: int = 30,
    episode_gap: int = 0,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Cluster event contexts and report each cluster's expectancy.

    Returns ``(summary, profile)``:

    * ``summary`` - one row per cluster with size and expectancy
    * ``profile`` - how far each cluster sits from the overall mean on every
      feature, in standard deviations, so a cluster can be described in words
    """
    r = np.asarray(r_values, dtype=np.float64)
    usable = np.isfinite(r)
    keep_idx = np.flatnonzero(usable)
    n_all = len(features)
    F = features.loc[usable]
    good = [c for c in F.columns if F[c].notna().sum() > 100 and F[c].std(skipna=True) > 0]
    F = F[good]
    if F.shape[0] < max(min_cluster * 2, 200) or not good:
        return pd.DataFrame(), pd.DataFrame()

    X = F.to_numpy(dtype=np.float64)
    med = np.nanmedian(X, axis=0)
    med = np.where(np.isfinite(med), med, 0.0)
    X = np.where(np.isfinite(X), X, med)

    Z = StandardScaler().fit_transform(X)
    comps = min(n_components, Z.shape[1], Z.shape[0] - 1)
    Zp = PCA(n_components=comps, random_state=seed).fit_transform(Z) if comps >= 2 else Z

    labels = KMeans(n_clusters=n_clusters, n_init=10, random_state=seed).fit_predict(Zp)
    y = r[usable]

    rows = []
    for k in range(n_clusters):
        m = labels == k
        if int(m.sum()) < min_cluster:
            continue
        # Lift the cluster mask back onto the bar timeline so its episodes -
        # not its bar count - drive the significance test.
        full = np.zeros(n_all, dtype=bool)
        full[keep_idx[m]] = True
        ep_means = episodes.group_means(r, episodes.cluster_ids(full, episode_gap))
        if ep_means.size < min_episodes:
            continue
        e = stats.expectancy(y[m], ep_means)
        rows.append({"cluster": k, **e.as_dict()})
    summary = pd.DataFrame(rows)
    if not summary.empty:
        summary["passes_fdr"] = stats.benjamini_hochberg(summary["p_value"].to_numpy(), 0.10)
        summary = summary.sort_values("mean_r", ascending=False, ignore_index=True)

    # Feature profile in z-units: what makes each cluster different
    Zdf = pd.DataFrame(Z, columns=good)
    Zdf["cluster"] = labels
    profile = Zdf.groupby("cluster").mean().T
    profile.index.name = "feature"
    return summary, profile


def describe_cluster(profile: pd.DataFrame, cluster: int, top: int = 8) -> pd.DataFrame:
    """The features that most distinguish one cluster, for hand interpretation."""
    if profile.empty or cluster not in profile.columns:
        return pd.DataFrame()
    s = profile[cluster].dropna()
    ranked = s.reindex(s.abs().sort_values(ascending=False).index).head(top)
    return pd.DataFrame({"feature": ranked.index, "z_vs_overall": ranked.to_numpy()})
