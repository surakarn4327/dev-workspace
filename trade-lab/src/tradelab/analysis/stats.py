"""Honest statistics.

Three ideas do most of the work here:

1. **Expectancy, not win rate.** 60% at R=0.5 loses money; 34% at R=3 makes it.
2. **Intervals, not point estimates.** ``41%`` hides the sample size; ``41% +/- 12%``
   does not.
3. **False discovery control.** Test 500 conditions and ~25 will look great by
   luck alone. Benjamini-Hochberg keeps that under control.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
from scipy import stats as sps


@dataclass(frozen=True)
class Expectancy:
    n: int
    #: independent episodes behind those n trades - the sample size that counts
    n_episodes: int
    #: trade-weighted average R - what the account would have earned
    mean_r: float
    #: episode-weighted average R - what inference is performed on. These differ
    #: when episodes vary in length, and the p-value belongs to this one, so both
    #: are reported rather than quietly mixing them.
    mean_r_episode: float
    #: standard error of the mean, in R (episode-clustered when episodes given)
    se_r: float
    ci_low: float
    ci_high: float
    win_rate: float
    #: t-test of mean_r > 0, computed on episode means when available
    p_value: float
    #: mean / std, the per-trade Sharpe of the R series
    sharpe: float
    #: worst peak-to-trough of the cumulative R curve, in R
    max_drawdown_r: float
    #: share of total profit contributed by the single best trade
    top_trade_share: float

    def as_dict(self) -> dict:
        return asdict(self)


def expectancy(r_values, episode_means=None) -> Expectancy:
    """Summarise per-trade R multiples.

    ``mean_r`` is always the plain average across trades - that is what the
    account would actually have earned. Inference (``se_r``, the interval,
    ``p_value``) uses ``episode_means`` when supplied, because adjacent bars
    inside one episode are a single observation sampled repeatedly, not many
    independent ones. See :mod:`tradelab.analysis.episodes` for the failure this
    prevents; it is not an optional refinement.
    """
    r = np.asarray(r_values, dtype=np.float64)
    r = r[np.isfinite(r)]
    n = int(r.size)
    if n == 0:
        nan = float("nan")
        return Expectancy(0, 0, nan, nan, nan, nan, nan, nan, nan, nan, nan, nan)

    mean = float(r.mean())
    sd = float(r.std(ddof=1)) if n > 1 else float("nan")

    if episode_means is None:
        infer = r
    else:
        infer = np.asarray(episode_means, dtype=np.float64)
        infer = infer[np.isfinite(infer)]
    n_ep = int(infer.size)
    mean_ep = float(infer.mean()) if n_ep else float("nan")

    if n_ep > 1:
        infer_se = float(infer.std(ddof=1)) / np.sqrt(n_ep)
        if np.isfinite(infer_se) and infer_se > 0:
            crit = float(sps.t.ppf(0.975, df=n_ep - 1))
            # Centre the interval on the quantity the test is about, otherwise a
            # row can show a negative mean next to a significant p-value.
            ci_low, ci_high = mean_ep - crit * infer_se, mean_ep + crit * infer_se
            p = float(sps.ttest_1samp(infer, 0.0, alternative="greater").pvalue)
        else:
            ci_low = ci_high = p = float("nan")
        se = infer_se
    else:
        se = ci_low = ci_high = p = float("nan")

    # Start the curve at 0, otherwise a run that loses from trade one reports a
    # drawdown smaller than the money actually lost.
    equity = np.concatenate(([0.0], np.cumsum(r)))
    peak = np.maximum.accumulate(equity)
    max_dd = float(np.max(peak - equity))

    gains = r[r > 0]
    total_gain = float(gains.sum())
    top_share = float(gains.max() / total_gain) if gains.size and total_gain > 0 else float("nan")

    return Expectancy(
        n=n,
        n_episodes=n_ep,
        mean_r=mean,
        mean_r_episode=mean_ep,
        se_r=float(se),
        ci_low=float(ci_low),
        ci_high=float(ci_high),
        win_rate=float((r > 0).mean()),
        p_value=p,
        sharpe=float(mean / sd) if n > 1 and np.isfinite(sd) and sd > 0 else float("nan"),
        max_drawdown_r=max_dd,
        top_trade_share=top_share,
    )


def wilson_interval(successes: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """Confidence interval for a proportion that stays sane at small ``n``.

    The textbook normal interval happily returns negative probabilities on rare
    events, which is exactly the regime a lot of these conditions live in.
    """
    if n <= 0:
        return (float("nan"), float("nan"))
    p = successes / n
    denom = 1.0 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = (z / denom) * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return (float(max(0.0, centre - half)), float(min(1.0, centre + half)))


def rate_vs_baseline(
    cond_hits: int, cond_n: int, base_hits: int, base_n: int
) -> dict[str, float]:
    """Compare an event rate under a condition against the unconditional rate."""
    p_cond = cond_hits / cond_n if cond_n else float("nan")
    p_base = base_hits / base_n if base_n else float("nan")
    lo, hi = wilson_interval(cond_hits, cond_n)

    if cond_n and base_n:
        table = [[cond_hits, cond_n - cond_hits], [base_hits, base_n - base_hits]]
        try:
            _, p_value = sps.fisher_exact(table, alternative="greater")
        except ValueError:
            p_value = float("nan")
    else:
        p_value = float("nan")

    return {
        "rate": p_cond,
        "rate_ci_low": lo,
        "rate_ci_high": hi,
        "baseline_rate": p_base,
        "lift": p_cond / p_base if p_base else float("nan"),
        "p_value": float(p_value),
    }


def benjamini_hochberg(p_values, fdr: float = 0.10) -> np.ndarray:
    """Which hypotheses survive at the given false discovery rate.

    Returns a boolean array aligned to the input. NaN p-values never pass.
    """
    p = np.asarray(p_values, dtype=np.float64)
    passed = np.zeros(p.shape, dtype=bool)
    finite = np.isfinite(p)
    m = int(finite.sum())
    if m == 0:
        return passed

    idx = np.flatnonzero(finite)
    order = idx[np.argsort(p[idx], kind="stable")]
    thresholds = fdr * (np.arange(1, m + 1) / m)
    below = p[order] <= thresholds
    if not below.any():
        return passed
    k = int(np.flatnonzero(below)[-1])
    passed[order[: k + 1]] = True
    return passed


def deflated_threshold(n_tests: int, alpha: float = 0.05) -> float:
    """Bonferroni p-threshold - the blunt instrument, reported alongside BH.

    Useful as a sanity anchor: if a rule cannot clear Bonferroni after a wide
    search, it should be treated as a lead rather than a finding.
    """
    return alpha / max(1, n_tests)


def redundancy_groups(corr, threshold: float = 0.90) -> list[list[str]]:
    """Cluster features whose absolute correlation exceeds ``threshold``.

    This is what makes "I use five indicators to confirm" measurable: if RSI,
    Stochastic, CCI and Williams %R land in one group, they are one opinion.
    """
    cols = list(corr.columns)
    seen: set[str] = set()
    groups: list[list[str]] = []
    m = corr.abs()
    for c in cols:
        if c in seen:
            continue
        members = [c] + [o for o in cols if o != c and o not in seen and m.at[c, o] >= threshold]
        seen.update(members)
        if len(members) > 1:
            groups.append(members)
    return groups
