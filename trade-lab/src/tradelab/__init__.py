"""trade-lab - ห้องแล็บวิจัยตลาด สำหรับ M1/M5

Answers four questions with numbers instead of opinions:

1. where reversals, bounces and real runs actually happen
2. which conditions make money once costs are paid
3. whether combining them helps, without brute-forcing 950,000 tests
4. whether any unnamed pattern is hiding in the data

Not a predictor and not an EA. Its output feeds a Pine indicator or ``smart-ea``.
"""

from __future__ import annotations

from .config import DEFAULT, TIMEFRAMES, Config

__all__ = ["Config", "DEFAULT", "TIMEFRAMES", "__version__"]
__version__ = "0.1.0"
