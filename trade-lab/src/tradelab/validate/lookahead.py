"""Mechanically prove that features do not read the future.

The test is simple and hard to argue with: compute a feature on the full series,
then compute it again on the series truncated at bar ``k``. For a causal
feature, every value at ``t < k`` must be identical - it never had access to
anything past ``t`` in the first place. A feature that peeks will shift.

This is the check that makes CLAUDE.md rule 5 real rather than aspirational.
Being careful is not a method; this is.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class LookaheadResult:
    column: str
    max_abs_diff: float
    n_differing: int

    @property
    def leaks(self) -> bool:
        return self.n_differing > 0


def check(
    bars: pd.DataFrame,
    build_fn,
    *,
    cuts: tuple[float, ...] = (0.5, 0.75),
    rtol: float = 1e-9,
    atol: float = 1e-9,
) -> list[LookaheadResult]:
    """Compare full-series features against truncated recomputation.

    ``build_fn`` takes a bar frame and returns a feature frame (normally
    :func:`tradelab.features.build`). Only columns present in both runs are
    compared. Returns one result per column that differs, worst first.
    """
    full = build_fn(bars)
    offenders: dict[str, LookaheadResult] = {}

    for frac in cuts:
        k = int(len(bars) * frac)
        if k < 500:
            continue
        trunc = build_fn(bars.iloc[:k])
        shared = [c for c in trunc.columns if c in full.columns]

        a = full[shared].iloc[:k]
        b = trunc[shared]
        for col in shared:
            x = a[col].to_numpy(dtype=np.float64)
            y = b[col].to_numpy(dtype=np.float64)
            both_nan = np.isnan(x) & np.isnan(y)
            close = np.isclose(x, y, rtol=rtol, atol=atol, equal_nan=False) | both_nan
            n_diff = int((~close).sum())
            if n_diff == 0:
                continue
            diffs = np.abs(x - y)[~close]
            worst = float(np.nanmax(diffs)) if diffs.size else float("inf")
            prev = offenders.get(col)
            if prev is None or n_diff > prev.n_differing:
                offenders[col] = LookaheadResult(col, worst, n_diff)

    return sorted(offenders.values(), key=lambda r: r.n_differing, reverse=True)


def assert_causal(bars: pd.DataFrame, build_fn, **kwargs) -> None:
    """Raise if any feature leaks. Used by the test suite and the CLI."""
    leaks = check(bars, build_fn, **kwargs)
    if leaks:
        lines = [f"  {r.column}: {r.n_differing} bars differ (max {r.max_abs_diff:.3g})" for r in leaks[:20]]
        more = f"\n  ... and {len(leaks) - 20} more" if len(leaks) > 20 else ""
        raise AssertionError(
            "look-ahead detected - these features change when the future is removed:\n"
            + "\n".join(lines)
            + more
        )
