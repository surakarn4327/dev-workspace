"""Central configuration for trade-lab.

Every tunable that affects results lives here so a run can be reproduced from a
single object. Nothing in this module may import from the rest of the package.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from pathlib import Path

# Project layout ---------------------------------------------------------------

PACKAGE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = PACKAGE_DIR.parent.parent
DATA_DIR = PROJECT_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
BUILD_DIR = DATA_DIR / "build"
REPORT_DIR = PROJECT_DIR / "reports"

# The only timeframes this project studies. The user trades scalp only, so
# anything larger is out of scope and must not be added without asking.
TIMEFRAMES: tuple[str, ...] = ("M1", "M5")

TF_MINUTES: dict[str, int] = {"M1": 1, "M5": 5}


@dataclass(frozen=True)
class Costs:
    """Round-trip trading cost, expressed in price points.

    ``point`` is the size of one point in price units (XAUUSD on Exness: 0.01,
    confirmed with the user 2026-09-05). Spread and slippage are in *points*.
    """

    point: float = 0.01
    spread_points: float = 25.0
    slippage_points: float = 5.0
    commission_points: float = 0.0

    @property
    def entry_cost_price(self) -> float:
        """Price distance lost on entry (half spread + slippage)."""
        return (self.spread_points / 2.0 + self.slippage_points) * self.point

    @property
    def exit_cost_price(self) -> float:
        """Price distance lost on exit (half spread + slippage)."""
        return (self.spread_points / 2.0 + self.slippage_points) * self.point

    @property
    def round_trip_price(self) -> float:
        return self.entry_cost_price + self.exit_cost_price + self.commission_points * self.point


@dataclass(frozen=True)
class EventConfig:
    """How the three event types are defined.

    All thresholds are in ATR multiples so they adapt across symbols and
    volatility regimes instead of being hard-coded in price.
    """

    atr_period: int = 14
    swing_window: int = 5
    horizon_bars: int = 60
    #: how far price must travel against the prior leg to count as a reversal
    reversal_atr: float = 2.0
    #: reaction size that qualifies as a bounce before the prior direction resumes
    bounce_atr: float = 1.0
    #: move size that counts as "price actually ran"
    expansion_atr: float = 3.0
    #: max adverse excursion allowed before the run, as ATR multiple
    expansion_max_adverse_atr: float = 1.0


@dataclass(frozen=True)
class OutcomeConfig:
    """Triple-barrier settings used to turn an event into a P/L number."""

    #: stop distance as an ATR multiple
    sl_atr: float = 1.5
    #: reward multiples tested for every event
    r_multiples: tuple[float, ...] = (1.0, 2.0, 3.0, 5.0)
    #: bars before the trade is closed at market
    max_hold_bars: int = 120


@dataclass(frozen=True)
class SplitConfig:
    """Data partitioning. The holdout is sacred - see CLAUDE.md rule 2."""

    #: fraction of the newest data reserved as untouchable holdout
    holdout_frac: float = 0.2
    #: number of walk-forward folds carved out of the research portion
    n_folds: int = 4


@dataclass(frozen=True)
class AnalysisConfig:
    #: a condition needs at least this many events before it is reported at all
    min_events: int = 100
    #: ...and at least this many *independent occasions*. A condition covering
    #: thousands of bars across only a handful of episodes (every Friday, one
    #: calendar month) is a date filter wearing a market-state costume, and bar
    #: level statistics will call it significant. See analysis/episodes.py.
    min_episodes: int = 30
    #: Benjamini-Hochberg false discovery rate
    fdr: float = 0.10
    #: features correlated above this are treated as duplicates
    redundancy_threshold: float = 0.90
    #: max depth of the rule-mining tree (deeper = more overfit)
    max_rule_depth: int = 3
    #: minimum samples in a mined rule's leaf
    min_leaf_events: int = 50


@dataclass(frozen=True)
class Config:
    symbol: str = "XAUUSD"
    timeframes: tuple[str, ...] = TIMEFRAMES
    costs: Costs = field(default_factory=Costs)
    events: EventConfig = field(default_factory=EventConfig)
    outcome: OutcomeConfig = field(default_factory=OutcomeConfig)
    split: SplitConfig = field(default_factory=SplitConfig)
    analysis: AnalysisConfig = field(default_factory=AnalysisConfig)
    #: fixed seed so every run is reproducible
    seed: int = 20260905

    def with_(self, **kwargs) -> "Config":
        return replace(self, **kwargs)


DEFAULT = Config()


def ensure_dirs() -> None:
    for d in (RAW_DIR, BUILD_DIR, REPORT_DIR):
        d.mkdir(parents=True, exist_ok=True)
