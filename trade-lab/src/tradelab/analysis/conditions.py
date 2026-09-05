"""Turn a feature frame into a set of testable yes/no conditions.

Continuous features become conditions at data-driven cut points (quantiles), so
nothing depends on folklore thresholds like "RSI below 30" - though those exact
textbook signals are tested too, as their own boolean features.

Every condition carries the number of cut points it was drawn from, because the
count of tests is what the false-discovery correction needs later.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from . import episodes

#: quantiles used to slice a continuous feature
QUANTILES: tuple[float, ...] = (0.10, 0.25, 0.75, 0.90)


@dataclass(frozen=True)
class Condition:
    name: str
    feature: str
    #: human-readable rule, e.g. "momentum.rsi_14 <= 31.2"
    description: str
    mask: np.ndarray

    @property
    def n(self) -> int:
        return int(self.mask.sum())

    def n_episodes(self, gap: int = 0) -> int:
        """Independent episodes, not bars - see :mod:`.episodes`."""
        return episodes.count(self.mask, gap)


def is_boolean_like(s: pd.Series) -> bool:
    vals = pd.unique(s.dropna())
    return len(vals) <= 2 and set(np.unique(vals)).issubset({0.0, 1.0})


def build(
    features: pd.DataFrame,
    *,
    quantiles: tuple[float, ...] = QUANTILES,
    min_n: int = 100,
    min_episodes: int = 30,
    episode_gap: int = 0,
) -> list[Condition]:
    """Enumerate single-feature conditions.

    Boolean features give one condition (the feature being true). Continuous
    features give a below/above condition per quantile.

    Two filters, and the second matters more than it looks:

    * ``min_n`` - too few bars to say anything.
    * ``min_episodes`` - too few *independent* occasions. ``is_friday`` may cover
      thousands of bars while happening only seven times; reported at bar level
      it looks like overwhelming evidence and is really a date filter. Dropping
      these is what stopped this pipeline finding fake edges in a random walk.
    """
    conditions: list[Condition] = []

    def keep(name: str, col: str, desc: str, mask: np.ndarray) -> None:
        if mask.sum() < min_n:
            return
        if episodes.count(mask, episode_gap) < min_episodes:
            return
        conditions.append(Condition(name, col, desc, mask))

    for col in features.columns:
        s = features[col]
        if s.notna().sum() < min_n:
            continue

        if is_boolean_like(s):
            keep(f"{col}=true", col, f"{col} is true", (s == 1.0).fillna(False).to_numpy())
            continue

        cuts = s.quantile(list(quantiles)).to_dict()
        for q, cut in cuts.items():
            if not np.isfinite(cut):
                continue
            pct = int(q * 100)
            if q <= 0.5:
                keep(
                    f"{col}<=q{pct}", col, f"{col} <= {cut:.4g} (q{pct})",
                    (s <= cut).fillna(False).to_numpy(),
                )
            else:
                keep(
                    f"{col}>=q{pct}", col, f"{col} >= {cut:.4g} (q{pct})",
                    (s >= cut).fillna(False).to_numpy(),
                )

    return conditions
