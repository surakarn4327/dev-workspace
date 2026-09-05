"""The study, start to finish.

One function per stage so each can be run and inspected on its own, plus
:func:`research` which chains them. Nothing here decides what is true - it
assembles the numbers and hands them to the report.

Order matters and is not negotiable:

  bars -> sanity -> events -> features -> look-ahead -> outcomes -> screening

Sanity before anything else: if random entries look profitable, no later number
means anything. Look-ahead before screening, for the same reason.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from . import events as events_mod
from . import features as features_mod
from . import outcomes as outcomes_mod
from .analysis import conditions, discover, episodes, rules, screen
from .analysis.stats import expectancy
from .config import Config
from .validate import lookahead, sanity, splits


@dataclass
class StudyResult:
    symbol: str
    timeframe: str
    bars: int
    span: str
    event_stats: events_mod.EventStats
    sanity: list[sanity.Check] = field(default_factory=list)
    lookahead_leaks: list[lookahead.LookaheadResult] = field(default_factory=list)
    n_features: int = 0
    n_conditions: int = 0
    #: per family: {"reversal": DataFrame, ...}
    event_rate: dict[str, pd.DataFrame] = field(default_factory=dict)
    expectancy_long: pd.DataFrame = field(default_factory=pd.DataFrame)
    expectancy_short: pd.DataFrame = field(default_factory=pd.DataFrame)
    mined_rules: pd.DataFrame = field(default_factory=pd.DataFrame)
    importance: pd.DataFrame = field(default_factory=pd.DataFrame)
    redundancy: pd.DataFrame = field(default_factory=pd.DataFrame)
    clusters: pd.DataFrame = field(default_factory=pd.DataFrame)
    cluster_profile: pd.DataFrame = field(default_factory=pd.DataFrame)
    walk_forward: pd.DataFrame = field(default_factory=pd.DataFrame)
    baseline: dict[str, float] = field(default_factory=dict)

    @property
    def sanity_ok(self) -> bool:
        """True when nothing *blocking* failed. Advisory warnings do not halt a study."""
        return all(c.passed for c in self.sanity if c.blocking)

    @property
    def warnings(self) -> list[sanity.Check]:
        return [c for c in self.sanity if not c.passed and not c.blocking]


def research(
    bars: pd.DataFrame,
    cfg: Config,
    *,
    timeframe: str,
    run_lookahead: bool = True,
    run_clusters: bool = True,
) -> StudyResult:
    """Run the full study on the research portion only.

    The holdout is never loaded here - see :func:`confirm_on_holdout`.
    """
    n_all = len(bars)
    research_end = splits.research_slice(n_all, cfg.split).stop
    research_bars = bars.iloc[:research_end]

    ev, ev_stats = events_mod.detect(research_bars, cfg.events)
    checks = sanity.run_all(research_bars, ev_stats.counts)

    feats = features_mod.build(research_bars)
    leaks: list[lookahead.LookaheadResult] = []
    if run_lookahead:
        leaks = lookahead.check(research_bars, features_mod.build)

    result = StudyResult(
        symbol=cfg.symbol,
        timeframe=timeframe,
        bars=len(research_bars),
        span=f"{research_bars.index[0]:%Y-%m-%d} .. {research_bars.index[-1]:%Y-%m-%d}",
        event_stats=ev_stats,
        sanity=checks,
        lookahead_leaks=leaks,
        n_features=feats.shape[1],
    )

    # A broken foundation makes every downstream number a lie - stop here.
    if not result.sanity_ok or leaks:
        return result

    # Trades held for `max_hold_bars` overlap, so entries closer than that are
    # one observation. Everything downstream uses this as the episode gap.
    gap = cfg.outcome.max_hold_bars

    conds = conditions.build(
        feats,
        min_n=cfg.analysis.min_events,
        min_episodes=cfg.analysis.min_episodes,
        episode_gap=gap,
    )
    result.n_conditions = len(conds)

    # --- question 1: where do the three event types happen
    for family in events_mod.FAMILIES:
        mask = events_mod.family_mask(ev, family).to_numpy()
        result.event_rate[family] = screen.screen_event_rate(
            conds,
            mask,
            cfg=cfg.analysis,
            # swing-anchored families are compared against swing bars only
            universe=events_mod.family_universe(ev, family),
            episode_gap=gap,
        )

    # --- question 2: would trading it have paid, long and short separately
    atr_at_entry = ev["atr"].to_numpy()
    for side, name in ((1, "long"), (-1, "short")):
        direction = np.full(len(research_bars), side, dtype=np.int8)
        lab = outcomes_mod.label(
            research_bars, direction, atr_at_entry, outcome=cfg.outcome, costs=cfg.costs
        )
        r_col = outcomes_mod.best_r_column(cfg.outcome)
        r = lab[r_col].to_numpy()
        table = screen.screen_expectancy(conds, r, cfg=cfg.analysis, episode_gap=gap)
        setattr(result, f"expectancy_{name}", table)
        result.baseline[f"{name}_mean_r"] = expectancy(r[np.isfinite(r)]).mean_r

        # --- question 3: combinations, mined rather than brute-forced
        if side == 1:
            result.mined_rules = rules.mine_rules(
                feats, r, cfg=cfg.analysis, seed=cfg.seed, episode_gap=gap
            )
            result.importance = rules.feature_importance(feats, r, seed=cfg.seed)
            result.walk_forward = _walk_forward_table(research_bars, feats, r, cfg)
            # --- question 4: patterns with no name yet
            if run_clusters:
                result.clusters, result.cluster_profile = discover.cluster_events(
                    feats,
                    r,
                    seed=cfg.seed,
                    min_episodes=cfg.analysis.min_episodes,
                    episode_gap=gap,
                )

    result.redundancy = screen.redundancy_report(feats, cfg=cfg.analysis)
    return result


def _walk_forward_table(
    bars: pd.DataFrame, feats: pd.DataFrame, r: np.ndarray, cfg: Config
) -> pd.DataFrame:
    """Mine rules on each fold's training block, score them on its test block.

    A rule that only works on the fold it was found in is noise, and this table
    is where that shows up before anyone gets attached to it.
    """
    n = len(bars)
    gap = cfg.outcome.max_hold_bars
    rows = []
    for fold in splits.walk_forward(n, cfg.split):
        train_mask = splits.mask_from_slice(n, fold.train)
        test_mask = splits.mask_from_slice(n, fold.test)

        r_train = np.where(train_mask, r, np.nan)
        mined = rules.mine_rules(
            feats, r_train, cfg=cfg.analysis, seed=cfg.seed, episode_gap=gap
        )
        if mined.empty:
            continue
        best = mined.iloc[0]

        test_sel = _apply_rule_text(feats, str(best["rule"])) & test_mask & np.isfinite(r)
        e = expectancy(r[test_sel], episodes.group_means(r, episodes.cluster_ids(test_sel, gap)))
        rows.append(
            {
                "fold": fold.name,
                "rule": best["rule"],
                "train_mean_r": best["mean_r"],
                "train_n": best["n"],
                "test_mean_r": e.mean_r,
                "test_n": e.n,
                "test_episodes": e.n_episodes,
                "held_up": bool(np.isfinite(e.mean_r) and e.mean_r > 0),
            }
        )
    return pd.DataFrame(rows)


def _apply_rule_text(feats: pd.DataFrame, rule: str) -> np.ndarray:
    """Re-evaluate a mined rule string against a feature frame."""
    mask = np.ones(len(feats), dtype=bool)
    if rule.strip() == "(always)":
        return mask
    for clause in rule.split(" AND "):
        for op in (" <= ", " > "):
            if op in clause:
                col, raw = clause.split(op)
                col, raw = col.strip(), raw.strip()
                if col not in feats.columns:
                    return np.zeros(len(feats), dtype=bool)
                values = feats[col].to_numpy(dtype=np.float64)
                thr = float(raw)
                # NaN fails every comparison, which is the safe direction here
                mask &= (values <= thr) if op == " <= " else (values > thr)
                break
    return mask


def confirm_on_holdout(
    bars: pd.DataFrame,
    cfg: Config,
    candidate_rules: list[str],
) -> pd.DataFrame:
    """Score a frozen shortlist of rules on the untouched slice. Run once.

    Do not use this to iterate. If a rule fails here, the honest move is to
    record that it failed - not to tweak it and come back.
    """
    n_all = len(bars)
    hold = splits.holdout_slice_final_check(n_all, cfg.split)
    hold_bars = bars.iloc[hold]

    ev, _ = events_mod.detect(hold_bars, cfg.events)
    feats = features_mod.build(hold_bars)
    direction = np.ones(len(hold_bars), dtype=np.int8)
    lab = outcomes_mod.label(
        hold_bars, direction, ev["atr"].to_numpy(), outcome=cfg.outcome, costs=cfg.costs
    )
    r = lab[outcomes_mod.best_r_column(cfg.outcome)].to_numpy()

    gap = cfg.outcome.max_hold_bars
    rows = []
    for rule in candidate_rules:
        m = _apply_rule_text(feats, rule) & np.isfinite(r)
        e = expectancy(r[m], episodes.group_means(r, episodes.cluster_ids(m, gap)))
        # Confirmation needs enough *independent occasions*, not just bars.
        confirmed = bool(e.n >= 50 and e.n_episodes >= 20 and e.mean_r > 0 and e.ci_low > 0)
        rows.append({"rule": rule, **e.as_dict(), "confirmed": confirmed})
    return pd.DataFrame(rows)
