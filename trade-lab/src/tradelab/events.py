"""The three things worth studying: reversals, bounces, and real runs.

Events are *labels*, so they are allowed to look forward. Definitions are rule
based rather than eyeballed, which is the whole point - a human scanning a chart
sees the reversals they already believe in and skips the rest.

All thresholds are ATR multiples, so the same definition works in a quiet Asia
session and a violent NFP candle.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .barriers import forward_extremes
from .config import EventConfig
from .features.indicators import atr
from .features.price_action import swing_pivots

#: label values in the ``event`` column
NONE, REVERSAL_UP, REVERSAL_DOWN, BOUNCE_UP, BOUNCE_DOWN, EXPANSION_UP, EXPANSION_DOWN = range(7)

LABELS: dict[int, str] = {
    NONE: "none",
    REVERSAL_UP: "reversal_up",
    REVERSAL_DOWN: "reversal_down",
    BOUNCE_UP: "bounce_up",
    BOUNCE_DOWN: "bounce_down",
    EXPANSION_UP: "expansion_up",
    EXPANSION_DOWN: "expansion_down",
}

#: which labels belong to which of the three families the user asked about
FAMILIES: dict[str, tuple[int, ...]] = {
    "reversal": (REVERSAL_UP, REVERSAL_DOWN),
    "bounce": (BOUNCE_UP, BOUNCE_DOWN),
    "expansion": (EXPANSION_UP, EXPANSION_DOWN),
}


@dataclass(frozen=True)
class EventStats:
    """Diagnostic counters - CLAUDE.md rule 6: never guess why a stage is empty."""

    bars: int
    valid_forward: int
    swing_highs: int
    swing_lows: int
    counts: dict[str, int]

    def report(self) -> str:
        lines = [
            f"bars                {self.bars:,}",
            f"usable forward win. {self.valid_forward:,}",
            f"confirmed swing hi  {self.swing_highs:,}",
            f"confirmed swing lo  {self.swing_lows:,}",
        ]
        lines += [f"{name:<20}{n:,}" for name, n in self.counts.items()]
        return "\n".join("  " + line for line in lines)


def detect(bars: pd.DataFrame, cfg: EventConfig | None = None) -> tuple[pd.DataFrame, EventStats]:
    """Label every bar, and return counters explaining how the labels were reached.

    Returns a frame with columns:

    ``event``      one of the label constants above
    ``direction``  +1 / -1 / 0, the direction the event points
    ``atr``        ATR at the event bar, used later for stop sizing
    ``fwd_up_atr`` how far price ran up afterwards, in ATR
    ``fwd_dn_atr`` how far it ran down afterwards, in ATR
    """
    cfg = cfg or EventConfig()
    a = atr(bars, cfg.atr_period)
    a_np = a.to_numpy()

    fwd_high, fwd_low, valid = forward_extremes(bars["high"], bars["low"], cfg.horizon_bars)
    close = bars["close"].to_numpy()

    with np.errstate(invalid="ignore", divide="ignore"):
        up_atr = (fwd_high - close) / a_np
        dn_atr = (close - fwd_low) / a_np

    ph, pl = swing_pivots(bars, cfg.swing_window)
    # The pivot flag sits at the confirmation bar; the pivot itself was
    # `swing_window` bars earlier. Events are anchored at the pivot bar, because
    # that is the price level a trader would actually be reacting to.
    at_swing_high = ph.shift(-cfg.swing_window).fillna(False).to_numpy(dtype=bool)
    at_swing_low = pl.shift(-cfg.swing_window).fillna(False).to_numpy(dtype=bool)

    event = np.full(len(bars), NONE, dtype=np.int8)
    direction = np.zeros(len(bars), dtype=np.int8)

    ok = valid & np.isfinite(up_atr) & np.isfinite(dn_atr)

    # --- reversals: at a swing extreme, price leaves decisively the other way,
    #     without first extending the move that made the extreme.
    rev_up = (
        ok
        & at_swing_low
        & (up_atr >= cfg.reversal_atr)
        & (dn_atr < cfg.bounce_atr)
    )
    rev_dn = (
        ok
        & at_swing_high
        & (dn_atr >= cfg.reversal_atr)
        & (up_atr < cfg.bounce_atr)
    )

    # --- bounces: a real reaction off the extreme, but the prior direction
    #     resumes and takes out the level anyway.
    bounce_up = (
        ok
        & at_swing_low
        & (up_atr >= cfg.bounce_atr)
        & (up_atr < cfg.reversal_atr)
        & (dn_atr >= cfg.bounce_atr)
    )
    bounce_dn = (
        ok
        & at_swing_high
        & (dn_atr >= cfg.bounce_atr)
        & (dn_atr < cfg.reversal_atr)
        & (up_atr >= cfg.bounce_atr)
    )

    # --- expansion: price actually ran from here, and barely went against you
    #     first. This is the family worth the most and the hardest to predict.
    exp_up = ok & (up_atr >= cfg.expansion_atr) & (dn_atr <= cfg.expansion_max_adverse_atr)
    exp_dn = ok & (dn_atr >= cfg.expansion_atr) & (up_atr <= cfg.expansion_max_adverse_atr)

    # Assignment order matters: reversal beats bounce beats expansion, so a bar
    # gets the most specific label that fits rather than an arbitrary one.
    event[exp_up] = EXPANSION_UP
    event[exp_dn] = EXPANSION_DOWN
    event[bounce_up] = BOUNCE_UP
    event[bounce_dn] = BOUNCE_DOWN
    event[rev_up] = REVERSAL_UP
    event[rev_dn] = REVERSAL_DOWN

    direction[np.isin(event, [REVERSAL_UP, BOUNCE_UP, EXPANSION_UP])] = 1
    direction[np.isin(event, [REVERSAL_DOWN, BOUNCE_DOWN, EXPANSION_DOWN])] = -1

    out = pd.DataFrame(
        {
            "event": event,
            "direction": direction,
            "atr": a_np,
            "fwd_up_atr": up_atr,
            "fwd_dn_atr": dn_atr,
            "forward_valid": ok,
            # Kept so the analysis can use the right comparison group: reversals
            # and bounces can only happen at a swing extreme, so scoring them
            # against "all bars" hands a free 2-3x lift to any feature that
            # merely correlates with being at a swing.
            "at_swing": at_swing_high | at_swing_low,
        },
        index=bars.index,
    )

    counts = {LABELS[k]: int((event == k).sum()) for k in LABELS if k != NONE}
    stats = EventStats(
        bars=len(bars),
        valid_forward=int(ok.sum()),
        swing_highs=int(at_swing_high.sum()),
        swing_lows=int(at_swing_low.sum()),
        counts=counts,
    )
    return out, stats


def family_mask(events: pd.DataFrame, family: str) -> pd.Series:
    """Boolean mask selecting one event family (``reversal``/``bounce``/``expansion``)."""
    if family not in FAMILIES:
        raise KeyError(f"unknown family {family!r}; expected one of {sorted(FAMILIES)}")
    return events["event"].isin(FAMILIES[family])


def family_universe(events: pd.DataFrame, family: str) -> np.ndarray:
    """The bars a family *could* have occurred on - the correct comparison group.

    Reversals and bounces are defined at swing extremes, so their baseline is
    "all swing extremes", not "all bars". Without this, ``sweep_high_depth``
    scores a 5x lift on pure random data purely because a sweep happens at a
    swing high by construction.

    Expansions can start anywhere, so their universe is every usable bar.
    """
    if family not in FAMILIES:
        raise KeyError(f"unknown family {family!r}; expected one of {sorted(FAMILIES)}")
    valid = events["forward_valid"].to_numpy(dtype=bool)
    if family == "expansion":
        return valid
    return valid & events["at_swing"].to_numpy(dtype=bool)
