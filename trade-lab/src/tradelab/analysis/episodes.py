"""Effective sample size, which is almost never the number of bars.

The trap this module exists to close:

``clock.is_friday`` selects 2,016 M5 bars out of two months - but only **7
Fridays**. Treating that as 2,016 independent observations shrinks the confidence
interval by a factor of ~17 and turns ordinary noise into a p-value of 0.001.
The first end-to-end run of this project duly "discovered" three profitable
conditions on a pure random walk, all of them calendar filters in disguise.
See bugs.md 2026-09-05.

The same applies to overlapping trades: with a 120-bar holding time, two entries
five bars apart are not two data points, they are one path sampled twice.

So conditions are grouped into **episodes**: contiguous runs of selected bars,
with runs closer together than the holding horizon merged. The number of
episodes - not bars - is the sample size that inference is allowed to use.
"""

from __future__ import annotations

import numpy as np

#: sentinel for "this bar is not selected"
NO_EPISODE = -1


def cluster_ids(mask, gap: int = 0) -> np.ndarray:
    """Label each selected bar with an episode id.

    ``gap`` merges runs separated by fewer than ``gap`` unselected bars, which is
    how overlapping trades get collapsed into one observation. Pass the holding
    horizon (``OutcomeConfig.max_hold_bars``) to do that.

    Unselected bars get :data:`NO_EPISODE`.
    """
    m = np.asarray(mask, dtype=bool)
    n = m.size
    ids = np.full(n, NO_EPISODE, dtype=np.int64)
    if not m.any():
        return ids

    if gap > 0:
        # Extend every run forward by `gap` bars, so runs within `gap` of each
        # other overlap and become a single connected block.
        idx = np.flatnonzero(m)
        extended = np.zeros(n + gap, dtype=bool)
        for start in idx:
            extended[start : start + gap + 1] = True
        connect = extended[:n]
    else:
        connect = m

    starts = connect & ~np.concatenate(([False], connect[:-1]))
    block = np.cumsum(starts) - 1
    ids[m] = block[m]
    return ids


def count(mask, gap: int = 0) -> int:
    """Number of distinct episodes in ``mask``."""
    ids = cluster_ids(mask, gap)
    selected = ids[ids != NO_EPISODE]
    return int(np.unique(selected).size) if selected.size else 0


def group_means(values, ids) -> np.ndarray:
    """Mean of ``values`` within each episode, ignoring NaN and unselected bars.

    Episode means are what inference treats as the independent observations.
    """
    v = np.asarray(values, dtype=np.float64)
    g = np.asarray(ids, dtype=np.int64)
    usable = (g != NO_EPISODE) & np.isfinite(v)
    if not usable.any():
        return np.empty(0, dtype=np.float64)

    labels = g[usable]
    vals = v[usable]
    uniq, inverse = np.unique(labels, return_inverse=True)
    sums = np.bincount(inverse, weights=vals, minlength=uniq.size)
    counts = np.bincount(inverse, minlength=uniq.size)
    return sums / counts
