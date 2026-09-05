"""Time-ordered data splits.

The holdout is the newest slice and it is *not* returned by the research API -
you have to ask for it explicitly, by a function whose name says what you are
doing. That is deliberate friction: CLAUDE.md rule 2 says the holdout is touched
once, and the code should make an accidental peek awkward.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from ..config import SplitConfig


@dataclass(frozen=True)
class Fold:
    name: str
    train: slice
    test: slice

    def describe(self, index: pd.DatetimeIndex) -> str:
        return (
            f"{self.name}: train {index[self.train][0]:%Y-%m-%d}..{index[self.train][-1]:%Y-%m-%d}"
            f"  test {index[self.test][0]:%Y-%m-%d}..{index[self.test][-1]:%Y-%m-%d}"
        )


def research_slice(n: int, cfg: SplitConfig | None = None) -> slice:
    """The portion you are allowed to explore freely."""
    cfg = cfg or SplitConfig()
    cut = int(n * (1.0 - cfg.holdout_frac))
    return slice(0, cut)


def holdout_slice_final_check(n: int, cfg: SplitConfig | None = None) -> slice:
    """The untouchable slice.

    Named the long way round on purpose - if you are typing this, you should be
    at the end of the study with a short, frozen list of candidate rules.
    """
    cfg = cfg or SplitConfig()
    cut = int(n * (1.0 - cfg.holdout_frac))
    return slice(cut, n)


def walk_forward(n: int, cfg: SplitConfig | None = None) -> list[Fold]:
    """Expanding-window folds inside the research portion.

    Fold ``k`` trains on everything before its test block, so no fold ever sees
    its own future. Test blocks are contiguous and non-overlapping.
    """
    cfg = cfg or SplitConfig()
    research_end = research_slice(n, cfg).stop
    if cfg.n_folds < 1:
        raise ValueError("n_folds must be >= 1")

    # first fold trains on the first (n_folds/(n_folds+1)) of the research data
    block = research_end // (cfg.n_folds + 1)
    if block < 1:
        raise ValueError(f"not enough rows ({n}) for {cfg.n_folds} folds")

    folds = []
    for k in range(cfg.n_folds):
        train_end = block * (k + 1)
        test_end = min(block * (k + 2), research_end)
        if test_end <= train_end:
            break
        folds.append(Fold(f"fold{k + 1}", slice(0, train_end), slice(train_end, test_end)))
    return folds


def mask_from_slice(n: int, s: slice) -> np.ndarray:
    m = np.zeros(n, dtype=bool)
    m[s] = True
    return m
