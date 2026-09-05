"""Feature computation.

Importing this package registers every block. ``build`` assembles them into one
frame; ``blocks()`` lists what is available.
"""

from __future__ import annotations

import pandas as pd

# side-effect imports: each module registers its blocks
from . import indicators, levels, price_action, session  # noqa: F401
from .registry import blocks, names, register  # noqa: F401

__all__ = ["build", "blocks", "names", "register", "indicators", "price_action", "levels", "session"]


def build(bars: pd.DataFrame, *, only: list[str] | None = None) -> pd.DataFrame:
    """Compute every registered feature block for ``bars``.

    Boolean columns are kept as ``float64`` (0.0/1.0) so the whole frame is one
    dtype: the analysis code treats "is this condition true" and "how far away is
    it" uniformly, and mixed dtypes here caused nothing but friction.
    """
    wanted = blocks()
    if only is not None:
        missing = [n for n in only if n not in wanted]
        if missing:
            raise KeyError(f"unknown feature blocks: {missing}")
        wanted = {n: wanted[n] for n in only}

    parts: list[pd.DataFrame] = []
    for name, fn in wanted.items():
        part = fn(bars)
        if not isinstance(part, pd.DataFrame):
            raise TypeError(f"feature block {name!r} must return a DataFrame")
        if not part.index.equals(bars.index):
            raise ValueError(f"feature block {name!r} returned a misaligned index")
        part = part.add_prefix(f"{name}.")
        parts.append(part)

    out = pd.concat(parts, axis=1)
    dupes = out.columns[out.columns.duplicated()].tolist()
    if dupes:
        raise ValueError(f"duplicate feature columns: {dupes}")
    return out.astype("float64")
