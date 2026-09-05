"""Clock features. Trivially causal - the time of a bar is known when it opens."""

from __future__ import annotations

import numpy as np
import pandas as pd

from .levels import SESSIONS
from .registry import register

#: the windows scalpers actually watch, in UTC
KILLZONES: dict[str, tuple[float, float]] = {
    "london_open": (7.0, 10.0),
    "ny_open": (13.0, 16.0),
    "overlap": (13.0, 16.0),
    "asia_open": (0.0, 3.0),
}


@register("clock")
def clock(df: pd.DataFrame) -> pd.DataFrame:
    idx = df.index
    hour = idx.hour.to_numpy() + idx.minute.to_numpy() / 60.0
    out = pd.DataFrame(index=idx)

    out["hour"] = idx.hour.to_numpy().astype(float)
    out["dow"] = idx.dayofweek.to_numpy().astype(float)
    # circular encoding so "23:00 is next to 00:00" is representable
    out["hour_sin"] = np.sin(2 * np.pi * hour / 24.0)
    out["hour_cos"] = np.cos(2 * np.pi * hour / 24.0)

    for name, (start, end) in SESSIONS.items():
        out[f"in_{name}"] = (hour >= start) & (hour < end)
    for name, (start, end) in KILLZONES.items():
        out[f"kz_{name}"] = (hour >= start) & (hour < end)

    out["minutes_into_day"] = hour * 60.0
    out["is_monday"] = out["dow"] == 0
    out["is_friday"] = out["dow"] == 4
    # last two hours of the FX week: thin liquidity, worth isolating
    out["friday_late"] = out["is_friday"] & (hour >= 19.0)
    return out
