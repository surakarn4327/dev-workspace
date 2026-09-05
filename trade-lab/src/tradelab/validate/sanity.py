"""Checks that must pass before any result is believed.

CLAUDE.md rule 7: random entries must lose roughly the trading cost. If they do
not, the machinery is broken - usually look-ahead or a forgotten cost - and
every finding built on it is worthless. Running this first has saved more time
than any other single habit in this kind of work.

The random-entry test is deliberately **one-sided**. Losing a little *more* than
the linear cost estimate is expected: paying the spread on entry pushes the stop
closer and the target further, and that penalty compounds rather than adding up,
so the simple ``cost / stop`` figure is a lower bound on the true drag. Losing
*less* than it is the impossible direction, and the only one worth failing on.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from ..config import Costs, OutcomeConfig
from ..features.indicators import atr
from ..outcomes import label


@dataclass(frozen=True)
class Check:
    name: str
    passed: bool
    detail: str
    values: dict[str, float] = field(default_factory=dict)
    #: blocking checks say the machinery is wrong and must halt the study.
    #: advisory ones report a fact about the market that is worth knowing but
    #: does not invalidate anything - e.g. "the spread is brutal on M1".
    blocking: bool = True

    def __str__(self) -> str:
        if self.passed:
            tag = "PASS"
        else:
            tag = "FAIL" if self.blocking else "WARN"
        return f"[{tag}] {self.name}: {self.detail}"


def _random_entry_stats(
    bars: pd.DataFrame,
    outcome: OutcomeConfig,
    costs: Costs,
    n_trades: int,
    seed: int,
) -> tuple[float, float, int, float]:
    """Return (observed_r, expected_r, n, se)."""
    rng = np.random.default_rng(seed)
    a = atr(bars, 14)
    n = len(bars)

    direction = np.zeros(n, dtype=np.int8)
    pick = rng.choice(n, size=min(n_trades, n), replace=False)
    direction[pick] = rng.choice([-1, 1], size=pick.size)

    labels = label(bars, direction, a, outcome=outcome, costs=costs)
    col = f"r{f'{outcome.r_multiples[0]:g}'.replace('.', 'p')}_net"
    r = labels[col].to_numpy()
    r = r[np.isfinite(r)]
    if r.size < 200:
        return float("nan"), float("nan"), int(r.size), float("nan")

    stop = (outcome.sl_atr * a).to_numpy()
    stop = stop[np.isfinite(stop) & (stop > 0)]
    expected = -float(np.mean(costs.round_trip_price / stop))
    se = float(r.std(ddof=1)) / np.sqrt(r.size)
    return float(r.mean()), expected, int(r.size), se


def random_entry_check(
    bars: pd.DataFrame,
    *,
    outcome: OutcomeConfig | None = None,
    costs: Costs | None = None,
    n_trades: int = 20_000,
    seed: int = 0,
    tolerance_r: float = 0.02,
) -> Check:
    """Enter long/short at random and confirm the result is no better than cost.

    Passing means: ``observed <= expected + tolerance``. A random entry that
    beats the spread does not exist, so exceeding it proves the labelling reads
    the future or has lost a cost term somewhere.
    """
    outcome = outcome or OutcomeConfig()
    costs = costs or Costs()
    observed, expected, n, se = _random_entry_stats(bars, outcome, costs, n_trades, seed)

    if n < 200:
        return Check("random entry", False, f"only {n} usable random trades")

    gap = observed - expected
    allowance = max(tolerance_r, 3.0 * se)
    passed = gap <= allowance

    verdict = (
        "worse than the linear cost estimate, which is normal"
        if gap < 0
        else "better than cost - look-ahead or a missing cost term"
        if not passed
        else "within tolerance"
    )
    return Check(
        "random entry",
        passed,
        f"observed {observed:+.4f}R vs cost floor {expected:+.4f}R "
        f"(gap {gap:+.4f}R, allowance {allowance:.4f}R, n={n:,}) - {verdict}",
        {"observed": observed, "expected": expected, "gap": gap, "n": float(n)},
    )


def cost_monotonicity_check(
    bars: pd.DataFrame, *, outcome: OutcomeConfig | None = None, seed: int = 0
) -> Check:
    """Doubling the spread must make random trading worse. If not, costs are ignored."""
    outcome = outcome or OutcomeConfig()
    cheap, _, n_cheap, _ = _random_entry_stats(bars, outcome, Costs(spread_points=10), 20_000, seed)
    dear, _, n_dear, _ = _random_entry_stats(bars, outcome, Costs(spread_points=80), 20_000, seed)

    if n_cheap < 200 or n_dear < 200:
        return Check("cost monotonicity", False, "not enough usable random trades")
    return Check(
        "cost monotonicity",
        dear < cheap,
        f"spread 10 -> {cheap:+.4f}R, spread 80 -> {dear:+.4f}R (must decrease)",
        {"cheap": cheap, "dear": dear},
    )


def event_balance_check(event_counts: dict[str, int], *, min_each: int = 200) -> Check:
    """Every event family must actually fire. An empty family means a broken rule."""
    families = {"reversal": 0, "bounce": 0, "expansion": 0}
    for name, count in event_counts.items():
        for fam in families:
            if name.startswith(fam):
                families[fam] += count
    thin = {k: v for k, v in families.items() if v < min_each}
    return Check(
        "event balance",
        not thin,
        (f"too few events: {thin}" if thin else f"all families populated: {families}"),
        {k: float(v) for k, v in families.items()},
    )


def cost_burden_check(
    bars: pd.DataFrame,
    *,
    outcome: OutcomeConfig | None = None,
    costs: Costs | None = None,
    max_burden_r: float = 0.30,
) -> Check:
    """How much of the stop distance the spread eats.

    Not a correctness check - a feasibility one, and it matters most on M1. If
    the round trip costs 0.36R before the trade even starts, a rule needs to be
    that much better than break-even just to stand still. Better to see the
    number than to discover it after building an EA.
    """
    outcome = outcome or OutcomeConfig()
    costs = costs or Costs()
    a = atr(bars, 14).to_numpy()
    stop = outcome.sl_atr * a
    stop = stop[np.isfinite(stop) & (stop > 0)]
    if stop.size == 0:
        return Check("cost burden", False, "no usable ATR", blocking=False)
    burden = float(np.median(costs.round_trip_price / stop))
    return Check(
        "cost burden",
        burden <= max_burden_r,
        f"round trip costs {burden:.3f}R of the stop "
        f"(median ATR {np.median(a[np.isfinite(a)]):.3f}) - "
        + ("workable" if burden <= max_burden_r else "very heavy for this timeframe"),
        {"burden_r": burden},
        blocking=False,
    )


def run_all(bars: pd.DataFrame, event_counts: dict[str, int] | None = None) -> list[Check]:
    checks = [
        random_entry_check(bars),
        cost_monotonicity_check(bars),
        cost_burden_check(bars),
    ]
    if event_counts is not None:
        checks.append(event_balance_check(event_counts))
    return checks
