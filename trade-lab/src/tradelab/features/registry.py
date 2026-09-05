"""Feature block registry.

A *block* is a function ``(bars) -> DataFrame`` that returns one or more feature
columns aligned to ``bars.index``. Registering is how a new idea enters the
study; nothing else needs to change.

Hard rule (CLAUDE.md rule 5): a feature at bar ``t`` may only use information
available at the close of bar ``t``. ``tradelab.validate.lookahead`` enforces it
mechanically - it is not a matter of being careful.
"""

from __future__ import annotations

from collections.abc import Callable

import pandas as pd

Block = Callable[[pd.DataFrame], pd.DataFrame]

_BLOCKS: dict[str, Block] = {}


def register(name: str) -> Callable[[Block], Block]:
    def deco(fn: Block) -> Block:
        if name in _BLOCKS:
            raise ValueError(f"feature block {name!r} already registered")
        _BLOCKS[name] = fn
        return fn

    return deco


def blocks() -> dict[str, Block]:
    return dict(_BLOCKS)


def names() -> list[str]:
    return sorted(_BLOCKS)
